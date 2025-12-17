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

		this._logService.info(`[ClaudeCodeAgentExecutor] ========== CLAUDE CODE BACKEND ==========`);
		// this._logService.info(`[ClaudeCodeAgentExecutor] Starting execution for task ${taskId} in ${worktreePath}`);

		try {
			// Auto-migrate Claude configuration on first task (once per session)
			if (!this._migrationAttempted) {
				this._migrationAttempted = true;
				await this._ensureClaudeConfiguration();
			}

			// Get or create session for this worktree
			const session = await this._claudeAgentManager.getOrCreateWorktreeSession(worktreePath);

			// Set worker context for A2A orchestration if provided
			if (workerContext) {
				// this._logService.info(`[ClaudeCodeAgentExecutor] Setting worker context: depth=${workerContext.depth}, spawnContext=${workerContext.spawnContext}`);
				session.session.setWorkerContext(workerContext);
			}

			// Track worker state
			this._activeWorkers.set(taskId, {
				status: { state: 'running', startTime },
				session,
				worktreePath,
				startTime,
				toolInvocationToken,
			});

			// Build prompt with slash command if specified
			const fullPrompt = this._buildPrompt(prompt, agentType);

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
			// This is critical for the stop button to actually stop the worker
			const cancellationListener = token.onCancellationRequested(() => {
				this._logService.info(`[ClaudeCodeAgentExecutor] Cancellation requested - aborting Claude session`);
				session.session.abort();
			});

			try {
				// Execute via Claude session
				// CRITICAL: Pass the real toolInvocationToken from the orchestrator, not a mock.
				// Without a valid token, tool confirmations fail and the session completes immediately.
				await session.session.invoke(
					fullPrompt,
					toolInvocationToken!,
					responseStream,
					token
				);
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

			// this._logService.info(`[ClaudeCodeAgentExecutor] Completed execution for task ${taskId} in ${executionTime}ms`);

			return {
				status: 'success',
				output: collectedOutput.join(''),
				metadata: {
					executionTime,
					sessionId: session.sessionId,
				},
			};
		} catch (error) {
			const workerState = this._activeWorkers.get(taskId);
			if (workerState) {
				workerState.status = {
					state: 'failed',
					error: error instanceof Error ? error.message : String(error),
				};
			}

			const errorMessage = error instanceof Error ? error.message : String(error);
			this._logService.error(`[ClaudeCodeAgentExecutor] Execution failed for task ${taskId}: ${errorMessage}`);

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
	 * Builds the full prompt with optional slash command prefix.
	 */
	private _buildPrompt(prompt: string, agentType: ParsedAgentType): string {
		// Check if agent name maps to a slash command
		const slashCommand = agentType.slashCommand ?? CLAUDE_SLASH_COMMAND_MAP[agentType.agentName];

		if (slashCommand) {
			// If prompt doesn't already start with a slash command, prepend it
			if (!prompt.startsWith('/')) {
				return `${slashCommand} ${prompt}`;
			}
		}

		return prompt;
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
