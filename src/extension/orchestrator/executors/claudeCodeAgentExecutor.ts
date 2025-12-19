/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { IClaudeAgentManager } from '../../agents/claude/node/claudeAgentManagerTypes';
import { ClaudeWorktreeSession } from '../../agents/claude/node/claudeWorktreeSession';
import {
	AgentBackendType,
	AgentExecuteParams,
	AgentExecuteResult,
	AgentWorkerStatus,
	IAgentExecutor,
	ParsedAgentType,
} from '../agentExecutor';
import { IClaudeMigrationService } from '../claudeMigrationService';
import { IUnifiedDefinitionService } from '../unifiedDefinitionService';

/**
 * Maps Claude agent names to their corresponding slash commands
 */
const CLAUDE_SLASH_COMMAND_MAP: Record<string, string> = {
	'architect': '/architect',
	'review': '/review',
	'reviewer': '/review',
};

interface ActiveClaudeWorkerState {
	status: AgentWorkerStatus;
	session: ClaudeWorktreeSession;
	worktreePath: string;
	startTime: number;
	toolInvocationToken?: vscode.ChatParticipantToolToken;
}

/**
 * ClaudeCodeAgentExecutor implements IAgentExecutor for the Claude Code backend.
 *
 * This executor uses the ClaudeAgentManager to create worktree-scoped sessions
 * and execute tasks via the Claude SDK. It supports slash commands like
 * /architect and /review which map to Claude's built-in capabilities.
 */
export class ClaudeCodeAgentExecutor implements IAgentExecutor {
	readonly _serviceBrand: undefined;
	readonly backendType: AgentBackendType = 'claude';

	private readonly _activeWorkers = new Map<string, ActiveClaudeWorkerState>();
	private readonly _pendingMessages = new Map<string, string[]>();
	private _migrationAttempted = false;

	constructor(
		@IClaudeAgentManager private readonly _claudeAgentManager: IClaudeAgentManager,
		@ILogService private readonly _logService: ILogService,
		@IClaudeMigrationService private readonly _claudeMigrationService: IClaudeMigrationService,
		@IUnifiedDefinitionService private readonly _unifiedDefinitionService: IUnifiedDefinitionService,
	) { }

	/**
	 * Executes a task in the specified worktree using Claude Code.
	 */
	async execute(params: AgentExecuteParams, stream?: vscode.ChatResponseStream): Promise<AgentExecuteResult> {
		const {
			taskId,
			prompt,
			worktreePath,
			agentType,
			token,
			workerContext,
			toolInvocationToken,
		} = params;

		const startTime = Date.now();

		this._logService.info(`[ClaudeExecutor:execute] ========== CLAUDE CODE BACKEND EXECUTE ==========`);
		this._logService.info(`[ClaudeExecutor:execute] taskId=${taskId}, worktreePath=${worktreePath}`);
		this._logService.info(`[ClaudeExecutor:execute] hasWorkerContext=${!!workerContext}, hasToolToken=${!!toolInvocationToken}, hasStream=${!!stream}`);
		this._logService.info(`[ClaudeExecutor:execute] agentType: backend=${agentType.backend}, name=${agentType.agentName}, slashCommand=${agentType.slashCommand ?? '(none)'}`);
		this._logService.info(`[ClaudeExecutor:execute] prompt length=${prompt.length}, preview="${prompt.slice(0, 300).replace(/\n/g, '\\n')}..."`);

		// CRITICAL: Validate worktree path before proceeding
		// Without a valid worktree, Claude will start in the wrong directory and fail silently
		if (!worktreePath) {
			const errorMsg = `No worktree path provided for task ${taskId}. ` +
				`This usually indicates the orchestrator failed to set up the worktree. ` +
				`workerContext.worktreePath=${workerContext?.worktreePath}`;
			this._logService.error(`[ClaudeCodeAgentExecutor] ${errorMsg}`);
			return {
				status: 'failed',
				output: '',
				error: errorMsg,
			};
		}

		// Detect invalid VS Code installation directory
		const invalidPaths = ['Microsoft VS Code', 'Visual Studio Code', 'VSCode'];
		if (invalidPaths.some(p => worktreePath.includes(p))) {
			const errorMsg = `Invalid worktree path for task ${taskId}: ${worktreePath}. ` +
				`This appears to be VS Code installation directory, not a project workspace. ` +
				`The orchestrator must provide a valid workspace or worktree path.`;
			this._logService.error(`[ClaudeCodeAgentExecutor] ${errorMsg}`);
			return {
				status: 'failed',
				output: '',
				error: errorMsg,
			};
		}

		// Validate toolInvocationToken - without it, tool confirmations fail
		if (!toolInvocationToken) {
			this._logService.warn(`[ClaudeCodeAgentExecutor] No toolInvocationToken provided for task ${taskId}. Tool confirmations may fail.`);
		}

		try {
			// Auto-migrate Claude configuration on first task (once per session)
			if (!this._migrationAttempted) {
				this._migrationAttempted = true;
				await this._ensureClaudeConfiguration();
			}

			// Get or create session for this worktree
			this._logService.info(`[ClaudeExecutor:execute] Getting/creating Claude session for worktree: ${worktreePath}`);
			const session = await this._claudeAgentManager.getOrCreateWorktreeSession(worktreePath);
			this._logService.info(`[ClaudeExecutor:execute] Got session: sessionId=${session.sessionId}`);

			// Set worker context for A2A orchestration if provided
			if (workerContext) {
				this._logService.info(`[ClaudeExecutor:execute] Setting workerContext: workerId=${workerContext.workerId}, depth=${workerContext.depth}, spawnContext=${workerContext.spawnContext}, owner=${workerContext.owner?.ownerType}:${workerContext.owner?.ownerId}`);
				session.session.setWorkerContext(workerContext);
			} else {
				this._logService.info(`[ClaudeExecutor:execute] No workerContext provided - worker will not have A2A context`);
			}

			// Track worker state
			this._activeWorkers.set(taskId, {
				status: { state: 'running', startTime },
				session,
				worktreePath,
				startTime,
				toolInvocationToken,
			});
			this._logService.info(`[ClaudeExecutor:execute] Worker state tracked, total active workers: ${this._activeWorkers.size}`);

			// Build prompt with custom instructions and slash command if specified
			const fullPrompt = await this._buildPrompt(prompt, agentType);
			this._logService.info(`[ClaudeExecutor:execute] Built fullPrompt: length=${fullPrompt.length}, starts with slash=${fullPrompt.startsWith('/')}`);
			this._logService.info(`[ClaudeExecutor:execute] fullPrompt preview="${fullPrompt.slice(0, 300).replace(/\n/g, '\\n')}..."`);

			// Create a collector stream if no stream provided
			const responseStream = stream ?? this._createCollectorStream();
			const collectedOutput: string[] = [];

			// If using collector stream, capture the output
			if (!stream) {
				const originalMarkdown = responseStream.markdown;
				responseStream.markdown = (value: string | vscode.MarkdownString) => {
					const text = typeof value === 'string' ? value : value.value;
					collectedOutput.push(text);
					return originalMarkdown.call(responseStream, value);
				};
			}

			// Listen for cancellation to abort the Claude session
			// This provides immediate stopping when user clicks stop or when interrupted.
			// The session can recover because claudeCodeAgent.ts clears _queryGenerator on error,
			// allowing the next invoke() to create a fresh session.
			const cancellationListener = token.onCancellationRequested(() => {
				this._logService.info(`[ClaudeCodeAgentExecutor] Cancellation requested - aborting Claude session`);
				session.session.abort();
			});

			try {
				// Execute via Claude session
				// CRITICAL: Pass the real toolInvocationToken from the orchestrator, not a mock.
				// Without a valid token, tool confirmations fail and the session completes immediately.
				this._logService.info(`[ClaudeExecutor:execute] ========== INVOKING CLAUDE SESSION ==========`);
				this._logService.info(`[ClaudeExecutor:execute] Calling session.session.invoke() with fullPrompt length=${fullPrompt.length}`);
				this._logService.info(`[ClaudeExecutor:execute] toolInvocationToken.sessionId=${(toolInvocationToken as { sessionId: string })?.sessionId ?? '(no token)'}`);
				await session.session.invoke(
					fullPrompt,
					toolInvocationToken!,
					responseStream,
					token
				);
				this._logService.info(`[ClaudeExecutor:execute] session.session.invoke() COMPLETED`);
			} finally {
				cancellationListener.dispose();
			}

			const endTime = Date.now();
			const executionTime = endTime - startTime;

			// Update status
			const workerState = this._activeWorkers.get(taskId);
			if (workerState) {
				workerState.status = {
					state: 'completed',
					result: {
						status: 'success',
						output: collectedOutput.join(''),
						metadata: {
							executionTime,
							sessionId: session.sessionId,
						},
					},
				};
			}

			this._logService.info(`[ClaudeExecutor:execute] Execution SUCCESS for taskId=${taskId} in ${executionTime}ms, output length=${collectedOutput.join('').length}`);

			return {
				status: 'success',
				output: collectedOutput.join(''),
				metadata: {
					executionTime,
					sessionId: session.sessionId,
				},
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const errorStack = error instanceof Error ? error.stack : undefined;

			this._logService.error(`[ClaudeExecutor:execute] ========== EXECUTION FAILED ==========`);
			this._logService.error(`[ClaudeExecutor:execute] taskId=${taskId}, error: ${errorMessage}`);
			if (errorStack) {
				this._logService.error(`[ClaudeExecutor:execute] Stack trace: ${errorStack}`);
			}

			const workerState = this._activeWorkers.get(taskId);
			if (workerState) {
				workerState.status = {
					state: 'failed',
					error: errorMessage,
				};
			}

			return {
				status: 'failed',
				output: '',
				error: errorMessage,
			};
		}
	}

	/**
	 * Sends a message to a running worker session.
	 * The message will be queued and sent when the session is ready for input.
	 */
	async sendMessage(workerId: string, message: string): Promise<void> {
		const workerState = this._activeWorkers.get(workerId);
		if (!workerState) {
			// Queue message for later if worker hasn't started yet
			if (!this._pendingMessages.has(workerId)) {
				this._pendingMessages.set(workerId, []);
			}
			this._pendingMessages.get(workerId)!.push(message);
			// this._logService.info(`[ClaudeCodeAgentExecutor] Message queued for worker ${workerId}: ${message.substring(0, 100)}...`);
			return;
		}

		// this._logService.info(`[ClaudeCodeAgentExecutor] Sending message to worker ${workerId}: ${message.substring(0, 100)}...`);

		// Create a dummy stream for the follow-up message
		const collectorStream = this._createCollectorStream();

		try {
			// Use the stored toolInvocationToken from the original execute call
			await workerState.session.session.invoke(
				message,
				workerState.toolInvocationToken!,
				collectorStream,
				CancellationToken.None
			);
		} catch (error) {
			this._logService.error(`[ClaudeCodeAgentExecutor] Failed to send message to worker ${workerId}: ${error}`);
			throw error;
		}
	}

	/**
	 * Cancels a running worker and cleans up its session.
	 */
	async cancel(workerId: string): Promise<void> {
		const workerState = this._activeWorkers.get(workerId);
		if (workerState) {
			// this._logService.info(`[ClaudeCodeAgentExecutor] Cancelling execution for worker ${workerId}`);

			// Mark session as inactive
			workerState.session.markInactive();

			// Update status
			workerState.status = {
				state: 'failed',
				error: 'Cancelled by user',
			};

			// Remove worktree session from manager
			this._claudeAgentManager.removeWorktreeSession(workerState.worktreePath);

			// Clean up
			this._activeWorkers.delete(workerId);
		}

		// Clean up pending messages
		this._pendingMessages.delete(workerId);
	}

	/**
	 * Gets the current status of a worker.
	 */
	getStatus(workerId: string): AgentWorkerStatus | undefined {
		const workerState = this._activeWorkers.get(workerId);
		return workerState?.status;
	}

	/**
	 * Checks if this executor supports the given agent type.
	 * Supports all Claude backend agent types.
	 */
	supports(parsedType: ParsedAgentType): boolean {
		return parsedType.backend === 'claude';
	}

	/**
	 * Builds the full prompt with optional slash command prefix and custom instructions.
	 */
	private async _buildPrompt(prompt: string, agentType: ParsedAgentType): Promise<string> {
		const parts: string[] = [];

		// 1. Add custom instructions wrapped in metadata tags
		try {
			const agentId = agentType.agentName || 'agent';
			const composed = await this._unifiedDefinitionService.getInstructionsForAgent(agentId);

			if (composed.instructions.length > 0) {
				const instructionsContent = composed.instructions.join('\n\n');
				parts.push(
					`<custom-instructions source="repo" agent="${agentId}">`,
					instructionsContent,
					`</custom-instructions>`,
					''
				);
			}
		} catch (error) {
			// Instructions not available, continue without them
			this._logService.debug(`[ClaudeExecutor] Failed to load instructions for ${agentType.agentName}: ${error}`);
		}

		// 2. Add the prompt with optional slash command prefix
		const slashCommand = agentType.slashCommand ?? CLAUDE_SLASH_COMMAND_MAP[agentType.agentName];

		if (slashCommand && !prompt.startsWith('/')) {
			parts.push(`${slashCommand} ${prompt}`);
		} else {
			parts.push(prompt);
		}

		return parts.join('\n');
	}

	/**
	 * Creates a simple collector stream for cases where no stream is provided.
	 * This captures all output but doesn't display it anywhere.
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
	 * Cleans up any pending worker state for a specific worktree path.
	 * This is useful when a worktree is removed externally.
	 */
	cleanupWorktree(worktreePath: string): void {
		for (const [workerId, workerState] of this._activeWorkers) {
			if (workerState.worktreePath === worktreePath) {
				// this._logService.info(`[ClaudeCodeAgentExecutor] Cleaning up worker ${workerId} for removed worktree`);
				this._activeWorkers.delete(workerId);
				this._pendingMessages.delete(workerId);
			}
		}
	}

	/**
	 * Ensures Claude configuration files are generated if needed.
	 * This triggers auto-migration on first Claude task.
	 */
	private async _ensureClaudeConfiguration(): Promise<void> {
		try {
			const shouldMigrate = await this._claudeMigrationService.shouldMigrate();
			if (shouldMigrate) {
				// this._logService.info('[ClaudeCodeAgentExecutor] Auto-migrating Claude configuration...');
				const result = await this._claudeMigrationService.migrate();
				if (result.status === 'completed') {
					// this._logService.info(`[ClaudeCodeAgentExecutor] Claude configuration generated: ${result.generatedFiles.join(', ')}`);
				} else if (result.status === 'failed') {
					// this._logService.warn(`[ClaudeCodeAgentExecutor] Claude configuration migration failed: ${result.error}`);
				}
			}
		} catch (error) {
			// Don't fail the task if migration fails - it's optional
			// this._logService.warn(`[ClaudeCodeAgentExecutor] Auto-migration check failed: ${error}`);
		}
	}
}
