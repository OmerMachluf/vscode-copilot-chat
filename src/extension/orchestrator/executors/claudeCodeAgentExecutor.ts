/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken, CancellationTokenSource } from '../../../util/vs/base/common/cancellation';
import { IClaudeAgentManager } from '../../agents/claude/node/claudeCodeAgent';
import { ClaudeWorktreeSession } from '../../agents/claude/node/claudeWorktreeSession';
import {
	AgentBackendType,
	AgentExecuteParams,
	AgentExecuteResult,
	AgentWorkerStatus,
	IAgentExecutor,
	ParsedAgentType,
} from '../agentExecutor';

/**
 * State tracked for each active Claude worker
 */
interface ActiveClaudeWorkerState {
	status: AgentWorkerStatus;
	cancellation: CancellationTokenSource;
	session: ClaudeWorktreeSession;
	startTime: number;
	pendingMessages: string[];
}

/**
 * Collector stream that captures markdown output from Claude responses
 */
class ClaudeResponseCollector {
	private _collected: string[] = [];

	public get content(): string {
		return this._collected.join('');
	}

	public createStream(): vscode.ChatResponseStream {
		return {
			markdown: (value: string | vscode.MarkdownString) => {
				const text = typeof value === 'string' ? value : value.value;
				this._collected.push(text);
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
}

/**
 * ClaudeCodeAgentExecutor integrates with the Claude Agent SDK to provide
 * the IAgentExecutor interface for the Claude backend.
 *
 * This executor creates worktree-scoped Claude sessions and manages their
 * lifecycle for orchestrated multi-agent workflows.
 */
export class ClaudeCodeAgentExecutor implements IAgentExecutor {
	readonly _serviceBrand: undefined;
	readonly backendType: AgentBackendType = 'claude';

	private readonly _activeWorkers = new Map<string, ActiveClaudeWorkerState>();

	constructor(
		@IClaudeAgentManager private readonly _claudeManager: IClaudeAgentManager,
		@ILogService private readonly _logService: ILogService,
	) { }

	async execute(params: AgentExecuteParams, stream?: vscode.ChatResponseStream): Promise<AgentExecuteResult> {
		const {
			taskId,
			prompt,
			worktreePath,
			agentType,
			token,
			additionalInstructions,
		} = params;

		const startTime = Date.now();
		this._logService.info(`[ClaudeCodeAgentExecutor] Starting execution for task ${taskId} in worktree: ${worktreePath}`);

		// Create cancellation source for this worker
		const cancellationSource = new CancellationTokenSource();

		// Link to the parent token if provided
		if (token && !token.isCancellationRequested) {
			token.onCancellationRequested(() => {
				cancellationSource.cancel();
			});
		}

		try {
			// Get or create a Claude session for the worktree
			const session = await this._claudeManager.getOrCreateWorktreeSession(worktreePath);

			// Track worker state
			this._activeWorkers.set(taskId, {
				status: { state: 'running', startTime },
				cancellation: cancellationSource,
				session,
				startTime,
				pendingMessages: [],
			});

			// Build the full prompt with slash command and additional instructions
			const fullPrompt = this._buildPrompt(prompt, agentType, additionalInstructions);

			// Create a response collector if no stream provided
			const collector = new ClaudeResponseCollector();
			const responseStream = stream ?? collector.createStream();

			// Create a mock ChatRequest to invoke the Claude session
			const mockRequest = this._createMockChatRequest(fullPrompt, agentType);

			// Execute via Claude SDK session
			await session.session.invoke(
				fullPrompt,
				mockRequest.toolInvocationToken,
				responseStream,
				this._createCancellationToken(cancellationSource, token)
			);

			const endTime = Date.now();
			const executionTime = endTime - startTime;

			// Update worker status
			const workerState = this._activeWorkers.get(taskId);
			if (workerState) {
				const output = stream ? '' : collector.content;
				workerState.status = {
					state: 'completed',
					result: {
						status: 'success',
						output,
						metadata: {
							executionTime,
							sessionId: session.sessionId,
						},
					},
				};
			}

			this._logService.info(`[ClaudeCodeAgentExecutor] Completed execution for task ${taskId} in ${executionTime}ms`);

			return {
				status: 'success',
				output: stream ? '' : collector.content,
				metadata: {
					executionTime,
					sessionId: session.sessionId,
					backend: 'claude',
				},
			};
		} catch (error) {
			const workerState = this._activeWorkers.get(taskId);
			const errorMessage = error instanceof Error ? error.message : String(error);

			if (workerState) {
				workerState.status = {
					state: 'failed',
					error: errorMessage,
				};
			}

			this._logService.error(`[ClaudeCodeAgentExecutor] Execution failed for task ${taskId}: ${errorMessage}`);

			return {
				status: 'failed',
				output: '',
				error: errorMessage,
			};
		}
	}

	async sendMessage(workerId: string, message: string): Promise<void> {
		const workerState = this._activeWorkers.get(workerId);
		if (!workerState) {
			this._logService.warn(`[ClaudeCodeAgentExecutor] Cannot send message - worker ${workerId} not found`);
			return;
		}

		// Queue the message for the next interaction
		// Claude sessions are turn-based, so we need to invoke a new turn with the message
		workerState.pendingMessages.push(message);

		this._logService.info(`[ClaudeCodeAgentExecutor] Queued message for worker ${workerId}: ${message.substring(0, 100)}...`);

		// If the worker is currently idle/completed, we could trigger a new invocation
		// For now, we just queue it - the orchestrator should call execute again
		// with the message as part of the prompt
	}

	async cancel(workerId: string): Promise<void> {
		const workerState = this._activeWorkers.get(workerId);
		if (workerState) {
			workerState.cancellation.cancel();
			workerState.status = {
				state: 'failed',
				error: 'Cancelled by user',
			};
			this._logService.info(`[ClaudeCodeAgentExecutor] Cancelled execution for worker ${workerId}`);
		}
	}

	getStatus(workerId: string): AgentWorkerStatus | undefined {
		const workerState = this._activeWorkers.get(workerId);
		return workerState?.status;
	}

	supports(parsedType: ParsedAgentType): boolean {
		// Claude executor supports claude backend with any agent name
		if (parsedType.backend !== 'claude') {
			return false;
		}

		// Support common agent types for Claude backend
		const supportedAgents = ['agent', 'architect', 'reviewer', 'sonnet', 'opus', 'haiku'];
		return supportedAgents.includes(parsedType.agentName) || parsedType.backend === 'claude';
	}

	/**
	 * Builds the full prompt including slash commands and additional instructions
	 */
	private _buildPrompt(
		prompt: string,
		agentType: ParsedAgentType,
		additionalInstructions?: string
	): string {
		let fullPrompt = '';

		// Add slash command if specified (e.g., /architect, /reviewer)
		if (agentType.slashCommand) {
			fullPrompt = `/${agentType.slashCommand} `;
		} else if (agentType.agentName && agentType.agentName !== 'agent') {
			// Map agent names to slash commands
			const agentToSlashCommand: Record<string, string> = {
				'architect': 'architect',
				'reviewer': 'reviewer',
			};
			const slashCommand = agentToSlashCommand[agentType.agentName];
			if (slashCommand) {
				fullPrompt = `/${slashCommand} `;
			}
		}

		// Add the main prompt
		fullPrompt += prompt;

		// Add additional instructions if provided
		if (additionalInstructions) {
			fullPrompt += `\n\n<additional-instructions>\n${additionalInstructions}\n</additional-instructions>`;
		}

		return fullPrompt.trim();
	}

	/**
	 * Creates a mock ChatRequest for use with Claude session invoke
	 */
	private _createMockChatRequest(prompt: string, agentType: ParsedAgentType): vscode.ChatRequest {
		return {
			prompt,
			command: agentType.slashCommand,
			references: [],
			toolInvocationToken: undefined as unknown as vscode.ChatParticipantToolToken,
			acceptedConfirmationData: undefined,
			rejectedConfirmationData: undefined,
			attempt: 0,
			enableCommandDetection: false,
			location: vscode.ChatLocation.Panel,
			toolReferences: [],
			model: undefined as unknown as vscode.LanguageModelChat,
		} as unknown as vscode.ChatRequest;
	}

	/**
	 * Creates a combined cancellation token from the source and parent token
	 */
	private _createCancellationToken(
		source: CancellationTokenSource,
		parentToken?: CancellationToken
	): CancellationToken {
		// Create a wrapper that checks both tokens
		return {
			isCancellationRequested: source.token.isCancellationRequested ||
				(parentToken?.isCancellationRequested ?? false),
			onCancellationRequested: (listener, thisArgs?, disposables?) => {
				const d1 = source.token.onCancellationRequested(listener, thisArgs, disposables);
				if (parentToken) {
					const d2 = parentToken.onCancellationRequested(listener, thisArgs, disposables);
					return {
						dispose: () => {
							d1.dispose();
							d2.dispose();
						}
					};
				}
				return d1;
			}
		};
	}

	/**
	 * Cleans up resources for a completed/failed worker
	 */
	public cleanupWorker(workerId: string): void {
		const workerState = this._activeWorkers.get(workerId);
		if (workerState) {
			workerState.cancellation.dispose();
			this._activeWorkers.delete(workerId);
			this._logService.info(`[ClaudeCodeAgentExecutor] Cleaned up worker ${workerId}`);
		}
	}

	/**
	 * Gets pending messages for a worker and clears them
	 */
	public consumePendingMessages(workerId: string): string[] {
		const workerState = this._activeWorkers.get(workerId);
		if (workerState) {
			const messages = [...workerState.pendingMessages];
			workerState.pendingMessages = [];
			return messages;
		}
		return [];
	}
}
