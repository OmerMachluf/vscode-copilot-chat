/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { HookInput, HookJSONOutput, Options, PreToolUseHookInput, Query, SDKAssistantMessage, SDKResultMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import Anthropic from '@anthropic-ai/sdk';
import type * as vscode from 'vscode';
import { ConfigKey, IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { IEnvService } from '../../../../platform/env/common/envService';
import { ILanguageFeaturesService } from '../../../../platform/languages/common/languageFeaturesService';
import { ILogService } from '../../../../platform/log/common/logService';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { isLocation } from '../../../../util/common/types';
import { DeferredPromise } from '../../../../util/vs/base/common/async';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { Disposable, DisposableMap } from '../../../../util/vs/base/common/lifecycle';
import { isWindows } from '../../../../util/vs/base/common/platform';
import { URI } from '../../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelTextPart } from '../../../../vscodeTypes';
import { IAgentDiscoveryService } from '../../../orchestrator/agentDiscoveryService';
import { IClaudeCommandService } from '../../../orchestrator/claudeCommandService';
import { ISubTaskManager } from '../../../orchestrator/orchestratorInterfaces';
import { IOrchestratorService } from '../../../orchestrator/orchestratorServiceV2';
import { ISafetyLimitsService } from '../../../orchestrator/safetyLimits';
import { ITaskMonitorService } from '../../../orchestrator/taskMonitorService';
import { IWorkerContext } from '../../../orchestrator/workerToolsService';
import { ToolName } from '../../../tools/common/toolNames';
import { IToolsService } from '../../../tools/common/toolsService';
import { isFileOkForTool } from '../../../tools/node/toolUtils';
import { ExternalEditTracker } from '../../common/externalEditTracker';
import { ILanguageModelServerConfig, LanguageModelServer } from '../../node/langModelServer';
import { claudeEditTools, ClaudeToolNames, getAffectedUrisForEditTool, IExitPlanModeInput, ITodoWriteInput } from '../common/claudeTools';
import { createFormattedToolInvocation } from '../common/toolInvocationFormatter';
import { createA2AMcpServer } from './claudeA2AMcpServer';
import { IClaudeAgentManager } from './claudeAgentManagerTypes';
import { IClaudeCodeSdkService } from './claudeCodeSdkService';
import { ClaudeWorktreeSession, IWorktreeSessionConfig, IWorktreeSessionFactory } from './claudeWorktreeSession';

// Re-export the interface and service identifier for consumers
export { IClaudeAgentManager } from './claudeAgentManagerTypes';

/**
 * Factory for creating ClaudeWorktreeSession instances.
 * Lives in this file to avoid circular dependencies with claudeWorktreeSession.ts.
 */
export class ClaudeWorktreeSessionFactory implements IWorktreeSessionFactory {
	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) { }

	/**
	 * Creates a new worktree-scoped Claude session
	 */
	public createSession(config: IWorktreeSessionConfig): ClaudeWorktreeSession {
		// Create the underlying Claude code session with worktree as cwd
		const session = this.instantiationService.createInstance(
			ClaudeCodeSession,
			config.serverConfig,
			config.sessionId,
			config.worktreePath  // Pass worktreePath so Claude process starts in the right directory
		);

		const worktreeUri = URI.file(config.worktreePath);

		return new ClaudeWorktreeSession(session, config.worktreePath, worktreeUri);
	}
}

// Manages Claude Code agent interactions and language model server lifecycle
export class ClaudeAgentManager extends Disposable implements IClaudeAgentManager {
	declare readonly _serviceBrand: undefined;

	private _langModelServer: LanguageModelServer | undefined;
	private _sessions = this._register(new DisposableMap<string, ClaudeCodeSession>());

	// Worktree-scoped sessions keyed by normalized worktree path
	private readonly _worktreeSessions = this._register(new DisposableMap<string, ClaudeWorktreeSession>());
	private _worktreeSessionFactory: ClaudeWorktreeSessionFactory | undefined;

	private async getLangModelServer(): Promise<LanguageModelServer> {
		if (!this._langModelServer) {
			this._langModelServer = this.instantiationService.createInstance(LanguageModelServer);
			await this._langModelServer.start();
		}

		return this._langModelServer;
	}

	private _getWorktreeSessionFactory(): ClaudeWorktreeSessionFactory {
		if (!this._worktreeSessionFactory) {
			this._worktreeSessionFactory = this.instantiationService.createInstance(ClaudeWorktreeSessionFactory);
		}
		return this._worktreeSessionFactory;
	}

	constructor(
		@ILogService private readonly logService: ILogService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IClaudeCommandService private readonly claudeCommandService: IClaudeCommandService,
	) {
		super();
		// Initialize the command service for watching .claude/commands/
		this.claudeCommandService.initialize();
	}

	/**
	 * Gets or creates a session scoped to a worktree path.
	 * Creates a new ClaudeCodeSession with the worktree path as its working directory.
	 */
	public async getOrCreateWorktreeSession(worktreePath: string): Promise<ClaudeWorktreeSession> {
		const normalizedPath = this._normalizeWorktreePath(worktreePath);

		// Check for existing active session
		const existing = this._worktreeSessions.get(normalizedPath);
		if (existing && existing.isActive) {
			// this.logService.trace(`[ClaudeAgentManager] Reusing worktree session for: ${normalizedPath}`);
			return existing;
		}

		// Get server config for the session
		const serverConfig = (await this.getLangModelServer()).getConfig();

		// this.logService.trace(`[ClaudeAgentManager] Creating worktree session for: ${normalizedPath}`);

		const config: IWorktreeSessionConfig = {
			worktreePath: worktreePath, // Use original path for the session
			serverConfig,
		};

		const session = this._getWorktreeSessionFactory().createSession(config);
		this._worktreeSessions.set(normalizedPath, session);

		return session;
	}

	/**
	 * Removes and disposes a worktree session
	 */
	public removeWorktreeSession(worktreePath: string): boolean {
		const normalizedPath = this._normalizeWorktreePath(worktreePath);
		const session = this._worktreeSessions.get(normalizedPath);

		if (session) {
			// this.logService.trace(`[ClaudeAgentManager] Removing worktree session for: ${normalizedPath}`);
			this._worktreeSessions.deleteAndDispose(normalizedPath);
			return true;
		}

		return false;
	}

	/**
	 * Gets all active worktree paths with sessions
	 */
	public getActiveWorktreePaths(): readonly string[] {
		const paths: string[] = [];
		for (const [path, session] of this._worktreeSessions) {
			if (session.isActive) {
				paths.push(path);
			}
		}
		return paths;
	}

	public async handleRequest(
		claudeSessionId: string | undefined,
		request: vscode.ChatRequest,
		_context: vscode.ChatContext,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
		worktreePath?: string
	): Promise<vscode.ChatResult & { claudeSessionId?: string }> {
		try {
			// If worktree path is specified, use worktree session
			if (worktreePath) {
				return await this._handleWorktreeRequest(worktreePath, request, stream, token);
			}

			// Get server config, start server if needed
			const serverConfig = (await this.getLangModelServer()).getConfig();

			const sessionIdForLog = claudeSessionId ?? 'new';
			// this.logService.trace(`[ClaudeAgentManager] Handling request for sessionId=${sessionIdForLog}.`);
			let session: ClaudeCodeSession;
			if (claudeSessionId && this._sessions.has(claudeSessionId)) {
				// this.logService.trace(`[ClaudeAgentManager] Reusing Claude session ${claudeSessionId}.`);
				session = this._sessions.get(claudeSessionId)!;
			} else {
				// this.logService.trace(`[ClaudeAgentManager] Creating Claude session for sessionId=${sessionIdForLog}.`);
				const newSession = this.instantiationService.createInstance(ClaudeCodeSession, serverConfig, claudeSessionId, undefined);
				if (newSession.sessionId) {
					this._sessions.set(newSession.sessionId, newSession);
				}
				session = newSession;
			}

			await session.invoke(
				await this.resolvePrompt(request),
				request.toolInvocationToken,
				stream,
				token
			);

			// Store the session if sessionId was assigned during invoke
			if (session.sessionId && !this._sessions.has(session.sessionId)) {
				// this.logService.trace(`[ClaudeAgentManager] Tracking Claude session ${claudeSessionId} -> ${session.sessionId}`);
				this._sessions.set(session.sessionId, session);
			}

			return {
				claudeSessionId: session.sessionId
			};
		} catch (invokeError) {
			this.logService.error(invokeError as Error);
			const errorMessage = (invokeError instanceof KnownClaudeError) ? invokeError.message : `Claude CLI Error: ${invokeError.message}`;
			stream.markdown('❌ Error: ' + errorMessage);
			return {
				// This currently can't be used by the sessions API https://github.com/microsoft/vscode/issues/263111
				errorDetails: { message: errorMessage },
			};
		}
	}

	/**
	 * Handles a request within a worktree context
	 */
	private async _handleWorktreeRequest(
		worktreePath: string,
		request: vscode.ChatRequest,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<vscode.ChatResult & { claudeSessionId?: string }> {
		// this.logService.trace(`[ClaudeAgentManager] Handling worktree request for: ${worktreePath}`);

		const worktreeSession = await this.getOrCreateWorktreeSession(worktreePath);

		await worktreeSession.session.invoke(
			await this.resolvePrompt(request),
			request.toolInvocationToken,
			stream,
			token
		);

		return {
			claudeSessionId: worktreeSession.sessionId
		};
	}

	/**
	 * Normalizes a worktree path for use as a map key
	 */
	private _normalizeWorktreePath(path: string): string {
		return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
	}

	private async resolvePrompt(request: vscode.ChatRequest): Promise<string> {
		let prompt = request.prompt;

		// Handle slash commands with potential custom command resolution
		if (prompt.startsWith('/')) {
			// Extract command name (e.g., "/architect" -> "architect")
			const spaceIndex = prompt.indexOf(' ');
			const commandName = spaceIndex > 0
				? prompt.slice(1, spaceIndex)
				: prompt.slice(1);
			const args = spaceIndex > 0 ? prompt.slice(spaceIndex + 1).trim() : '';

			// Try to find a custom command in .claude/commands/
			const commandContent = await this.claudeCommandService.getCommandContent(commandName);
			if (commandContent) {
				// Prepend the command instructions to the prompt
				// this.logService.trace(`[ClaudeAgentManager] Resolved custom command: /${commandName}`);
				prompt = `<command-instructions name="${commandName}">\n${commandContent}\n</command-instructions>\n\n${args || ''}`;
			}
			// If not found as custom command, pass through as-is (Claude CLI handles built-in commands)
			return prompt;
		}

		const extraRefsTexts: string[] = [];
		request.references.forEach(ref => {
			const valueText = URI.isUri(ref.value) ?
				ref.value.fsPath :
				isLocation(ref.value) ?
					`${ref.value.uri.fsPath}:${ref.value.range.start.line + 1}` :
					undefined;
			if (valueText) {
				if (ref.range) {
					prompt = prompt.slice(0, ref.range[0]) + valueText + prompt.slice(ref.range[1]);
				} else {
					extraRefsTexts.push(`- ${valueText}`);
				}
			}
		});

		if (extraRefsTexts.length > 0) {
			prompt = `<system-reminder>\nThe user provided the following references:\n${extraRefsTexts.join('\n')}\n\nIMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.\n</system-reminder>\n\n` + prompt;
		}

		return prompt;
	}
}

class KnownClaudeError extends Error { }

/**
 * Represents a queued chat request waiting to be processed by the Claude session
 */
interface QueuedRequest {
	readonly prompt: string;
	readonly stream: vscode.ChatResponseStream;
	readonly toolInvocationToken: vscode.ChatParticipantToolToken;
	readonly token: vscode.CancellationToken;
	readonly deferred: DeferredPromise<void>;
}

/**
 * Represents the currently active request being processed
 */
interface CurrentRequest {
	readonly stream: vscode.ChatResponseStream;
	readonly toolInvocationToken: vscode.ChatParticipantToolToken;
	readonly token: vscode.CancellationToken;
}

export class ClaudeCodeSession extends Disposable {
	private static readonly DenyToolMessage = 'The user declined to run the tool';
	private _queryGenerator: Query | undefined;
	private _promptQueue: QueuedRequest[] = [];
	private _currentRequest: CurrentRequest | undefined;
	private _pendingPrompt: DeferredPromise<QueuedRequest> | undefined;
	private _abortController = new AbortController();
	private _editTracker = new ExternalEditTracker();

	/**
	 * Pending updates from child subtasks.
	 * These are injected into the next prompt when the session processes a new request.
	 */
	private _pendingChildUpdates: string[] = [];

	/**
	 * Last tool invocation token used.
	 * Stored so we can create synthetic requests when child updates arrive.
	 */
	private _lastToolInvocationToken: vscode.ChatParticipantToolToken | undefined;

	/**
	 * Worker context for A2A orchestration.
	 * Set by executor when running as a subtask in a worktree.
	 */
	private _workerContext: IWorkerContext | undefined;

	constructor(
		private readonly serverConfig: ILanguageModelServerConfig,
		public sessionId: string | undefined,
		private readonly _worktreePath: string | undefined,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configService: IConfigurationService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IEnvService private readonly envService: IEnvService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IToolsService private readonly toolsService: IToolsService,
		@IClaudeCodeSdkService private readonly claudeCodeService: IClaudeCodeSdkService,
		@ILogService private readonly _log: ILogService,
		@ISubTaskManager private readonly subTaskManager: ISubTaskManager,
		@IAgentDiscoveryService private readonly agentDiscoveryService: IAgentDiscoveryService,
		@ISafetyLimitsService private readonly safetyLimitsService: ISafetyLimitsService,
		@ITaskMonitorService private readonly taskMonitorService: ITaskMonitorService,
	) {
		super();
	}

	/**
	 * Sets the worker context for A2A orchestration.
	 * Should be called by the executor before the first invoke() when running as a subtask.
	 * @param context The worker context containing task hierarchy information
	 */
	public setWorkerContext(context: IWorkerContext): void {
		this._workerContext = context;
	}

	/**
	 * Gets the current worker context, if set.
	 */
	public get workerContext(): IWorkerContext | undefined {
		return this._workerContext;
	}

	/**
	 * Receives an update message from a child subtask.
	 * The message will be included in the next prompt to the session.
	 * If the session is idle, this will wake it up to process the updates.
	 * @param message The formatted update message from the child
	 */
	public receiveChildUpdate(message: string): void {
		this.logService.info(`[ClaudeCodeSession] Received child update: ${message.substring(0, 100)}...`);
		this._pendingChildUpdates.push(message);
		// Try to wake up the session if it's idle and waiting for input
		this._tryWakeUpSession();
	}

	public override dispose(): void {
		this._abortController.abort();
		this._promptQueue.forEach(req => req.deferred.error(new Error('Session disposed')));
		this._promptQueue = [];
		this._pendingPrompt?.error(new Error('Session disposed'));
		this._pendingPrompt = undefined;
		super.dispose();
	}

	/**
	 * Aborts the current operation without disposing the session.
	 * The session can still be used for future invocations after calling this.
	 */
	public abort(): void {
		this.logService.info(`[ClaudeCodeSession] abort() called - aborting current operation`);
		// Abort current operation - this signals the Claude SDK to stop
		this._abortController.abort();
		// Create new controller for future operations
		this._abortController = new AbortController();
		// Invalidate the session so it will be re-started on next invoke
		// The Claude process was killed by the abort, so _queryGenerator is now dead
		this._queryGenerator = undefined;
		// Reject current request if any
		if (this._promptQueue.length > 0) {
			const currentRequest = this._promptQueue.shift();
			this.logService.info(`[ClaudeCodeSession] Rejecting current request from queue`);
			currentRequest?.deferred.error(new Error('Operation aborted by user'));
		}
	}

	/**
	 * Tries to wake up the session if it's idle and waiting for input.
	 * Called when child updates arrive to allow the session to continue processing.
	 */
	private _tryWakeUpSession(): void {
		// Only wake up if:
		// 1. Session is waiting for next prompt (_pendingPrompt is set)
		// 2. We have a stored tool invocation token
		// 3. The session generator is still running
		if (!this._pendingPrompt || !this._lastToolInvocationToken || !this._queryGenerator) {
			this.logService.debug(
				`[ClaudeCodeSession] Cannot wake up: pendingPrompt=${!!this._pendingPrompt}, ` +
				`hasToken=${!!this._lastToolInvocationToken}, hasGenerator=${!!this._queryGenerator}`
			);
			return;
		}

		this.logService.info(`[ClaudeCodeSession] Waking up session with ${this._pendingChildUpdates.length} pending child updates`);

		// Create a continuation prompt - the actual updates will be injected by _createPromptIterable
		const continuationPrompt = 'Continue your work. Review the updates from your spawned subtasks (shown in the system reminder above) and proceed accordingly.';

		// Create a collector stream for the response (we don't have a real VS Code stream)
		const collectorStream = this._createCollectorStream();

		// Create the synthetic request
		const deferred = new DeferredPromise<void>();
		const request: QueuedRequest = {
			prompt: continuationPrompt,
			stream: collectorStream,
			toolInvocationToken: this._lastToolInvocationToken,
			token: CancellationToken.None,
			deferred,
		};

		// Add to queue
		this._promptQueue.push(request);

		// Resolve the pending prompt to wake up the session
		const pendingPrompt = this._pendingPrompt;
		this._pendingPrompt = undefined;
		pendingPrompt.complete(request);

		// Log that we're not awaiting the deferred - the session loop handles completion
		this.logService.debug(`[ClaudeCodeSession] Wake-up request queued, session loop will process it`);
	}

	/**
	 * Creates a collector stream that captures output but doesn't display it.
	 * Used for synthetic requests when no VS Code stream is available.
	 */
	private _createCollectorStream(): vscode.ChatResponseStream {
		const collected: string[] = [];
		return {
			markdown: (value: string | vscode.MarkdownString) => {
				const text = typeof value === 'string' ? value : value.value;
				collected.push(text);
			},
			anchor: () => { },
			button: () => { },
			filetree: () => { },
			progress: () => { },
			reference: () => { },
			push: () => { },
			confirmation: () => { },
			warning: () => { },
			textEdit: () => { },
			codeblockUri: () => { },
			detectedParticipant: () => { },
		} as unknown as vscode.ChatResponseStream;
	}

	/**
	 * Invokes the Claude Code session with a user prompt
	 * @param prompt The user's prompt text
	 * @param toolInvocationToken Token for invoking tools
	 * @param stream Response stream for sending results back to VS Code
	 * @param token Cancellation token for request cancellation
	 */
	public async invoke(
		prompt: string,
		toolInvocationToken: vscode.ChatParticipantToolToken,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<void> {
		if (this._store.isDisposed) {
			throw new Error('Session disposed');
		}

		if (!this._queryGenerator) {
			await this._startSession(token);
		}

		// Add this request to the queue and wait for completion
		const deferred = new DeferredPromise<void>();
		const request: QueuedRequest = {
			prompt,
			stream,
			toolInvocationToken,
			token,
			deferred
		};

		// Store the token for potential use in child update wake-ups
		this._lastToolInvocationToken = toolInvocationToken;

		this._promptQueue.push(request);

		// Handle cancellation
		token.onCancellationRequested(() => {
			const index = this._promptQueue.indexOf(request);
			if (index !== -1) {
				this._promptQueue.splice(index, 1);
				deferred.error(new Error('Request was cancelled'));
			}
		});

		// If there's a pending prompt request, fulfill it immediately
		if (this._pendingPrompt) {
			const pendingPrompt = this._pendingPrompt;
			this._pendingPrompt = undefined;
			pendingPrompt.complete(request);
		}

		return deferred.p;
	}

	/**
	 * Starts a new Claude Code session with the configured options
	 */
	private async _startSession(token: vscode.CancellationToken): Promise<void> {
		// Build options for the Claude Code SDK
		const isDebugEnabled = this.configService.getConfig(ConfigKey.Advanced.ClaudeCodeDebugEnabled);
		const pathSep = isWindows ? ';' : ':';

		// Determine working directory: use constructor worktreePath first, then workerContext, then main workspace
		const mainWorkspace = this.workspaceService.getWorkspaceFolders().at(0)?.fsPath;
		const workingDirectory = this._worktreePath || this._workerContext?.worktreePath || mainWorkspace;

		// CRITICAL: Validate working directory to prevent using VS Code installation directory
		// This can happen when no workspace is open or worktree paths are not properly propagated
		if (!workingDirectory) {
			throw new Error(
				'[ClaudeCodeSession] No valid working directory found. ' +
				'Please open a workspace folder before running Claude tasks. ' +
				`(worktreePath=${this._worktreePath}, workerContextPath=${this._workerContext?.worktreePath}, mainWorkspace=${mainWorkspace})`
			);
		}

		// Detect if we're about to use VS Code's installation directory (common misconfiguration)
		const invalidPaths = ['Microsoft VS Code', 'Visual Studio Code', 'VSCode'];
		if (invalidPaths.some(p => workingDirectory.includes(p))) {
			throw new Error(
				`[ClaudeCodeSession] Invalid working directory detected: ${workingDirectory}. ` +
				'This appears to be VS Code installation directory, not a project workspace. ' +
				`Please ensure worktree path is correctly propagated. ` +
				`(worktreePath=${this._worktreePath}, workerContextPath=${this._workerContext?.worktreePath}, mainWorkspace=${mainWorkspace})`
			);
		}

		this.logService.info(`[ClaudeCodeSession] Starting session with cwd: ${workingDirectory} (worktreePath=${this._worktreePath}, workerContextPath=${this._workerContext?.worktreePath}, mainWorkspace=${mainWorkspace})`);

		// Create in-process MCP server for A2A orchestration tools
		// Get optional services via instantiation service to avoid circular dependency issues
		const a2aMcpServer = this.instantiationService.invokeFunction(accessor => {
			const orchestratorService = accessor.getIfExists(IOrchestratorService);
			const languageFeaturesService = accessor.getIfExists(ILanguageFeaturesService);

			return createA2AMcpServer({
				subTaskManager: this.subTaskManager,
				agentDiscoveryService: this.agentDiscoveryService,
				safetyLimitsService: this.safetyLimitsService,
				taskMonitorService: this.taskMonitorService,
				workerContext: this._workerContext,
				orchestratorService,
				languageFeaturesService,
				workspaceRoot: workingDirectory,
				// Callback for receiving pushed updates from child subtasks
				onChildUpdate: (message: string) => this.receiveChildUpdate(message),
			});
		});

		const options: Options = {
			cwd: workingDirectory,
			abortController: this._abortController,
			executable: process.execPath as 'node', // get it to fork the EH node process
			env: {
				...process.env,
				ANTHROPIC_BASE_URL: `http://localhost:${this.serverConfig.port}`,
				ANTHROPIC_API_KEY: this.serverConfig.nonce,
				CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
				USE_BUILTIN_RIPGREP: '0',
				PATH: `${this.envService.appRoot}/node_modules/@vscode/ripgrep/bin${pathSep}${process.env.PATH}`
			},
			resume: this.sessionId,
			// Register the A2A MCP server as an in-process SDK server
			mcpServers: {
				'a2a-orchestration': a2aMcpServer
			},
			hooks: {
				PreToolUse: [
					{
						matcher: claudeEditTools.join('|'),
						hooks: [(input, toolID) => this._onWillEditTool(input, toolID, token)]
					}
				],
				PostToolUse: [
					{
						matcher: claudeEditTools.join('|'),
						hooks: [(input, toolID) => this._onDidEditTool(input, toolID)]
					}
				],
			},
			canUseTool: async (name, input) => {
				return this._currentRequest ?
					this.canUseTool(name, input, this._currentRequest.toolInvocationToken) :
					{ behavior: 'deny', message: 'No active request' };
			},
			systemPrompt: {
				type: 'preset',
				preset: 'claude_code',
				append: 'Your responses will be rendered as markdown, so please reply with properly formatted markdown when appropriate. When replying with code or the name of a symbol, wrap it in backticks.'
			},
			settingSources: ['user', 'project', 'local'],
			...(isDebugEnabled && {
				stderr: data => {
					// this.logService.trace(`claude-agent-sdk stderr: ${data}`);
				}
			})
		};

		// this.logService.trace(`claude-agent-sdk: Starting query with options: ${JSON.stringify(options)}`);
		this._queryGenerator = await this.claudeCodeService.query({
			prompt: this._createPromptIterable(),
			options
		});

		// Start the message processing loop
		this._processMessages();
	}

	private async _onWillEditTool(input: HookInput, toolUseID: string | undefined, token: CancellationToken): Promise<HookJSONOutput> {
		let uris: URI[] = [];
		try {
			uris = getAffectedUrisForEditTool(input as PreToolUseHookInput);
		} catch (error) {
			this._log.error('Error getting affected URIs for edit tool', error);
		}
		if (!this._currentRequest) {
			return {};
		}

		await this._editTracker.trackEdit(
			toolUseID ?? '',
			uris,
			this._currentRequest.stream,
			token
		);
		return {};
	}

	private async _onDidEditTool(_input: HookInput, toolUseID: string | undefined) {
		await this._editTracker.completeEdit(toolUseID ?? '');
		return {};
	}

	private async *_createPromptIterable(): AsyncIterable<SDKUserMessage> {
		while (true) {
			// Wait for a request to be available
			const request = await this._getNextRequest();

			this._currentRequest = {
				stream: request.stream,
				toolInvocationToken: request.toolInvocationToken,
				token: request.token
			};

			// Build prompt with any pending child updates prepended
			let prompt = request.prompt;
			if (this._pendingChildUpdates.length > 0) {
				const updates = this._pendingChildUpdates.splice(0, this._pendingChildUpdates.length);
				const updatesText = updates.join('\n\n');
				prompt = `<system-reminder>\nUpdates from your spawned subtasks:\n${updatesText}\n</system-reminder>\n\n${prompt}`;
				this.logService.info(`[ClaudeCodeSession] Injected ${updates.length} child updates into prompt`);
			}

			yield {
				type: 'user',
				message: {
					role: 'user',
					content: prompt
				},
				parent_tool_use_id: null,
				session_id: this.sessionId ?? ''
			};

			// Wait for this request to complete before yielding the next one
			await request.deferred.p;
		}
	}

	/**
	 * Gets the next request from the queue or waits for one to be available
	 * @returns Promise that resolves with the next queued request
	 */
	private async _getNextRequest(): Promise<QueuedRequest> {
		if (this._promptQueue.length > 0) {
			return this._promptQueue[0]; // Don't shift yet, keep for resolution
		}

		// Wait for a request to be queued
		this._pendingPrompt = new DeferredPromise<QueuedRequest>();
		return this._pendingPrompt.p;
	}

	/**
	 * Processes messages from the Claude Code query generator
	 * Routes messages to appropriate handlers and manages request completion
	 */
	private async _processMessages(): Promise<void> {
		// Capture the generator we're processing - used to detect if we've been superseded
		// by a new loop after abort(). Without this check, the old loop's catch block
		// would trample the new loop's state (_promptQueue, _queryGenerator, _pendingPrompt).
		const myGenerator = this._queryGenerator;

		try {
			const unprocessedToolCalls = new Map<string, Anthropic.ToolUseBlock>();
			for await (const message of this._queryGenerator!) {
				// Check if current request was cancelled
				if (this._currentRequest?.token.isCancellationRequested) {
					throw new Error('Request was cancelled');
				}

				// this.logService.trace(`claude-agent-sdk Message: ${JSON.stringify(message, null, 2)}`);
				if (message.session_id) {
					this.sessionId = message.session_id;
				}

				if (message.type === 'assistant') {
					this.handleAssistantMessage(message, this._currentRequest!.stream, unprocessedToolCalls);
				} else if (message.type === 'user') {
					this.handleUserMessage(message, this._currentRequest!.stream, unprocessedToolCalls, this._currentRequest!.toolInvocationToken, this._currentRequest!.token);
				} else if (message.type === 'result') {
					this.handleResultMessage(message, this._currentRequest!.stream);
					// Resolve and remove the completed request
					if (this._promptQueue.length > 0) {
						const completedRequest = this._promptQueue.shift()!;
						completedRequest.deferred.complete();
					}
					this._currentRequest = undefined;
				}
			}
		} catch (error) {
			// Only clean up state if we're still the active loop.
			// If abort() was called and a new invoke() started a new loop, the generator
			// reference will have changed. In that case, we must NOT touch the shared state
			// because it now belongs to the new loop.
			if (this._queryGenerator === myGenerator || this._queryGenerator === undefined) {
				// Reject all pending requests that belong to this loop
				this._promptQueue.forEach(req => req.deferred.error(error as Error));
				this._promptQueue = [];
				this._pendingPrompt?.error(error as Error);
				this._pendingPrompt = undefined;
				// Clear the query generator so next invoke() will start a fresh session
				// This is important for recovery after cancellation/interruption
				this._queryGenerator = undefined;
			}
			// If _queryGenerator !== myGenerator, a new loop has taken over - don't interfere
		}
	}

	/**
	 * Handles assistant messages containing text content and tool use blocks
	 */
	private handleAssistantMessage(
		message: SDKAssistantMessage,
		stream: vscode.ChatResponseStream,
		unprocessedToolCalls: Map<string, Anthropic.ToolUseBlock>
	): void {
		for (const item of message.message.content) {
			if (item.type === 'text' && item.text) {
				stream.markdown(item.text);
			} else if (item.type === 'tool_use') {
				// Don't show progress message for TodoWrite tool
				if (item.name !== ClaudeToolNames.TodoWrite) {
					stream.progress(`\n\n🛠️ Using tool: ${item.name}...`);
				}
				unprocessedToolCalls.set(item.id!, item as Anthropic.ToolUseBlock);
			}
		}
	}

	/**
	 * Handles user messages containing tool results
	 */
	private handleUserMessage(
		message: SDKUserMessage,
		stream: vscode.ChatResponseStream,
		unprocessedToolCalls: Map<string, Anthropic.ToolUseBlock>,
		toolInvocationToken: vscode.ChatParticipantToolToken,
		token: vscode.CancellationToken
	): void {
		if (Array.isArray(message.message.content)) {
			for (const toolResult of message.message.content) {
				if (toolResult.type === 'tool_result') {
					this.processToolResult(toolResult, stream, unprocessedToolCalls, toolInvocationToken, token);
				}
			}
		}
	}

	/**
	 * Processes individual tool results and handles special tool types
	 */
	private processToolResult(
		toolResult: Anthropic.Messages.ToolResultBlockParam,
		stream: vscode.ChatResponseStream,
		unprocessedToolCalls: Map<string, Anthropic.ToolUseBlock>,
		toolInvocationToken: vscode.ChatParticipantToolToken,
		token: vscode.CancellationToken
	): void {
		const toolUse = unprocessedToolCalls.get(toolResult.tool_use_id!);
		if (!toolUse) {
			return;
		}

		unprocessedToolCalls.delete(toolResult.tool_use_id!);
		const invocation = createFormattedToolInvocation(toolUse, toolResult);
		if (toolResult?.content === ClaudeCodeSession.DenyToolMessage && invocation) {
			invocation.isConfirmed = false;
		}

		if (toolUse.name === ClaudeToolNames.TodoWrite) {
			this.processTodoWriteTool(toolUse, toolInvocationToken, token);
		}

		if (invocation) {
			stream.push(invocation);
		}
	}

	/**
	 * Handles the TodoWrite tool by converting Claude's todo format to the core todo list format
	 */
	private processTodoWriteTool(
		toolUse: Anthropic.ToolUseBlock,
		toolInvocationToken: vscode.ChatParticipantToolToken,
		token: vscode.CancellationToken
	): void {
		const input = toolUse.input as ITodoWriteInput;
		this.toolsService.invokeTool(ToolName.CoreManageTodoList, {
			input: {
				operation: 'write',
				todoList: input.todos.map((todo, i) => ({
					id: i,
					title: todo.content,
					description: '',
					status: todo.status === 'pending' ?
						'not-started' :
						(todo.status === 'in_progress' ?
							'in-progress' :
							'completed')
				} satisfies IManageTodoListToolInputParams['todoList'][number])),
			} satisfies IManageTodoListToolInputParams,
			toolInvocationToken,
		}, token);
	}

	/**
	 * Handles result messages that indicate completion or errors
	 */
	private handleResultMessage(
		message: SDKResultMessage,
		stream: vscode.ChatResponseStream
	): void {
		if (message.subtype === 'error_max_turns') {
			stream.progress(`⚠️ Maximum turns reached (${message.num_turns})`);
		} else if (message.subtype === 'error_during_execution') {
			throw new KnownClaudeError(`Error during execution`);
		}
	}

	/**
	 * Handles tool permission requests by showing a confirmation dialog to the user
	 */
	private async canUseTool(toolName: string, input: Record<string, unknown>, toolInvocationToken: vscode.ChatParticipantToolToken): Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }> {
		// this.logService.trace(`ClaudeCodeSession: canUseTool: ${toolName}(${JSON.stringify(input)})`);
		if (await this.canAutoApprove(toolName, input)) {
			// this.logService.trace(`ClaudeCodeSession: auto-approving ${toolName}`);

			return {
				behavior: 'allow',
				updatedInput: input
			};
		}

		try {
			const result = await this.toolsService.invokeTool(ToolName.CoreConfirmationTool, {
				input: this.getConfirmationToolParams(toolName, input),
				toolInvocationToken,
			}, CancellationToken.None);
			const firstResultPart = result.content.at(0);
			if (firstResultPart instanceof LanguageModelTextPart && firstResultPart.value === 'yes') {
				return {
					behavior: 'allow',
					updatedInput: input
				};
			}
		} catch { }
		return {
			behavior: 'deny',
			message: ClaudeCodeSession.DenyToolMessage
		};
	}

	private getConfirmationToolParams(toolName: string, input: Record<string, unknown>): IConfirmationToolParams {
		if (toolName === ClaudeToolNames.Bash) {
			return {
				title: `Use ${toolName}?`,
				message: `\`\`\`\n${JSON.stringify(input, null, 2)}\n\`\`\``,
				confirmationType: 'terminal',
				terminalCommand: input.command as string | undefined
			};
		} else if (toolName === ClaudeToolNames.ExitPlanMode) {
			const plan = (input as unknown as IExitPlanModeInput).plan;
			return {
				title: `Ready to code?`,
				message: 'Here is Claude\'s plan:\n\n' + plan,
				confirmationType: 'basic'
			};
		}

		return {
			title: `Use ${toolName}?`,
			message: `\`\`\`\n${JSON.stringify(input, null, 2)}\n\`\`\``,
			confirmationType: 'basic'
		};
	}

	private async canAutoApprove(toolName: string, input: Record<string, unknown>): Promise<boolean> {
		if (toolName === ClaudeToolNames.Edit || toolName === ClaudeToolNames.Write || toolName === ClaudeToolNames.MultiEdit) {
			return await this.instantiationService.invokeFunction(isFileOkForTool, URI.file(input.file_path as string));
		}

		return false;
	}
}

/**
 * Tool params from core
 */
interface IConfirmationToolParams {
	readonly title: string;
	readonly message: string;
	readonly confirmationType?: 'basic' | 'terminal';
	readonly terminalCommand?: string;
}

interface IManageTodoListToolInputParams {
	readonly operation?: 'write' | 'read'; // Optional in write-only mode
	readonly todoList: readonly {
		readonly id: number;
		readonly title: string;
		readonly description: string;
		readonly status: 'not-started' | 'in-progress' | 'completed';
	}[];
}
