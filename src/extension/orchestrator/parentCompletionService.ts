/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../platform/log/common/logService';
import { createServiceIdentifier } from '../../util/common/services';
import { Emitter, Event } from '../../util/vs/base/common/event';
import { Disposable, IDisposable, toDisposable } from '../../util/vs/base/common/lifecycle';
import { ISubTask, ISubTaskManager, ISubTaskResult } from './orchestratorInterfaces';
import { IOrchestratorQueueMessage, IOrchestratorQueueService } from './orchestratorQueue';
import { WorkerSession } from './workerSession';

export const IParentCompletionService = createServiceIdentifier<IParentCompletionService>('parentCompletionService');

/**
 * Represents a formatted "as-if-user" completion message for parent wake-up.
 */
export interface IParentCompletionMessage {
	/** The subtask that completed */
	subTaskId: string;
	/** Agent type that ran the subtask (e.g., '@architect') */
	agentType: string;
	/** Original task prompt given to the subtask */
	taskPrompt: string;
	/** The subtask's response/output */
	response: string;
	/** Path to the worktree where work was done */
	worktreePath: string;
	/** Number of files changed (if available) */
	changedFilesCount?: number;
	/** Number of insertions (if available) */
	insertions?: number;
	/** Number of deletions (if available) */
	deletions?: number;
	/** Status of the completion */
	status: 'success' | 'partial' | 'failed' | 'timeout';
	/** Error message if failed */
	error?: string;
	/** Timestamp of completion */
	timestamp: number;
}

/**
 * Registered parent handler that receives completion messages.
 */
export interface IParentHandler {
	/** The owner ID (workerId or session ID) */
	ownerId: string;
	/** Callback to handle completion messages */
	onCompletion: (message: IParentCompletionMessage) => Promise<void>;
	/** Whether to inject as synthetic user message */
	injectAsUserMessage: boolean;
}

/**
 * Service for managing parent wake-up on subtask completion.
 *
 * Key responsibilities:
 * 1. Register persistent owner handlers for parent sessions
 * 2. Listen for subtask completions (both from queue and SubTaskManager events)
 * 3. Format completion messages in "as-if-user" format
 * 4. De-duplicate completion deliveries
 * 5. Trigger parent wake-up/continuation
 */
export interface IParentCompletionService {
	readonly _serviceBrand: undefined;

	/**
	 * Register a persistent handler for a parent session.
	 * The handler will receive completion messages for all subtasks spawned by this parent.
	 *
	 * @param ownerId The parent's unique ID (workerId or chat session ID)
	 * @param onCompletion Callback invoked when a subtask completes
	 * @param options Additional handler options
	 * @returns Disposable to unregister the handler
	 */
	registerParentHandler(
		ownerId: string,
		onCompletion: (message: IParentCompletionMessage) => Promise<void>,
		options?: { injectAsUserMessage?: boolean }
	): IDisposable;

	/**
	 * Check if a parent handler is registered for the given owner.
	 */
	hasParentHandler(ownerId: string): boolean;

	/**
	 * Get pending completions for an owner that were delivered before handler registration.
	 */
	getPendingCompletions(ownerId: string): IParentCompletionMessage[];

	/**
	 * Format a completion as an "as-if-user" message string.
	 */
	formatAsUserMessage(message: IParentCompletionMessage): string;

	/**
	 * Event fired when a completion is delivered to a parent.
	 */
	readonly onCompletionDelivered: Event<{ ownerId: string; message: IParentCompletionMessage }>;

	/**
	 * Event fired when a completion is queued (no handler available).
	 */
	readonly onCompletionQueued: Event<{ ownerId: string; message: IParentCompletionMessage }>;

	/**
	 * Manually deliver a completion message (used by fallback path).
	 */
	deliverCompletion(subTask: ISubTask, result: ISubTaskResult): Promise<void>;
}

/**
 * Implementation of the parent completion service.
 */
export class ParentCompletionService extends Disposable implements IParentCompletionService {
	readonly _serviceBrand: undefined;

	/** Registered parent handlers keyed by ownerId */
	private readonly _parentHandlers = new Map<string, IParentHandler>();

	/** Pending completions for owners without registered handlers */
	private readonly _pendingCompletions = new Map<string, IParentCompletionMessage[]>();

	/** Set of processed completion IDs for de-duplication */
	private readonly _processedCompletions = new Set<string>();

	/** Map of subTaskId -> ownerId for routing */
	private readonly _subtaskToOwner = new Map<string, string>();

	private readonly _onCompletionDelivered = this._register(new Emitter<{ ownerId: string; message: IParentCompletionMessage }>());
	readonly onCompletionDelivered = this._onCompletionDelivered.event;

	private readonly _onCompletionQueued = this._register(new Emitter<{ ownerId: string; message: IParentCompletionMessage }>());
	readonly onCompletionQueued = this._onCompletionQueued.event;

	constructor(
		@ISubTaskManager private readonly _subTaskManager: ISubTaskManager,
		@IOrchestratorQueueService private readonly _queueService: IOrchestratorQueueService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Listen to SubTaskManager completion events as a fallback source
		this._register(this._subTaskManager.onDidCompleteSubTask(subTask => {
			this._handleSubTaskCompletion(subTask);
		}));

		// Register ourselves as a queue handler for completion messages
		this._register(this._queueService.registerHandler(async (message) => {
			if (message.type === 'completion') {
				await this._handleQueueCompletion(message);
			}
		}));

		this._logService.debug('[ParentCompletionService] Service initialized');
	}

	registerParentHandler(
		ownerId: string,
		onCompletion: (message: IParentCompletionMessage) => Promise<void>,
		options?: { injectAsUserMessage?: boolean }
	): IDisposable {
		this._logService.debug(`[ParentCompletionService] Registered handler for owner ${ownerId}`);

		const handler: IParentHandler = {
			ownerId,
			onCompletion,
			injectAsUserMessage: options?.injectAsUserMessage ?? true,
		};

		this._parentHandlers.set(ownerId, handler);

		// Deliver any pending completions
		const pending = this._pendingCompletions.get(ownerId);
		if (pending && pending.length > 0) {
			this._logService.debug(`[ParentCompletionService] Delivering ${pending.length} pending completions to ${ownerId}`);
			this._pendingCompletions.delete(ownerId);

			// Deliver asynchronously to avoid blocking registration
			Promise.resolve().then(async () => {
				for (const message of pending) {
					await this._deliverToHandler(handler, message);
				}
			});
		}

		return toDisposable(() => {
			this._parentHandlers.delete(ownerId);
			this._logService.debug(`[ParentCompletionService] Disposed handler for owner ${ownerId}`);
		});
	}

	hasParentHandler(ownerId: string): boolean {
		return this._parentHandlers.has(ownerId);
	}

	getPendingCompletions(ownerId: string): IParentCompletionMessage[] {
		return this._pendingCompletions.get(ownerId) ?? [];
	}

	formatAsUserMessage(message: IParentCompletionMessage): string {
		const lines: string[] = [];

		// Format: "@{AgentType} subagent received task to: {task}."
		lines.push(`${message.agentType} subagent received task to: ${message.taskPrompt}`);
		lines.push('');

		// Include status indicator
		const statusIcon = message.status === 'success' ? '✅' :
			message.status === 'partial' ? '⚠️' :
				message.status === 'timeout' ? '⏱️' : '❌';

		lines.push(`${statusIcon} **Status:** ${message.status}`);

		// Format: "@{AgentType} response: {response}"
		if (message.response) {
			lines.push('');
			lines.push(`${message.agentType} response:`);
			lines.push(message.response);
		}

		// Include error if present
		if (message.error) {
			lines.push('');
			lines.push(`**Error:** ${message.error}`);
		}

		// Include worktree path
		lines.push('');
		lines.push(`**Worktree:** ${message.worktreePath}`);

		// Include changed files stats if available
		if (message.changedFilesCount !== undefined) {
			const statsLine = message.insertions !== undefined && message.deletions !== undefined
				? `**Changed files:** ${message.changedFilesCount} (+${message.insertions}/-${message.deletions})`
				: `**Changed files:** ${message.changedFilesCount}`;
			lines.push(statsLine);
		}

		return lines.join('\n');
	}

	async deliverCompletion(subTask: ISubTask, result: ISubTaskResult): Promise<void> {
		const completionId = `${subTask.id}-${result.taskId}`;

		// De-duplicate
		if (this._processedCompletions.has(completionId)) {
			this._logService.debug(`[ParentCompletionService] Skipping duplicate completion for ${subTask.id}`);
			return;
		}
		this._processedCompletions.add(completionId);

		// Format the completion message
		const message = this._createCompletionMessage(subTask, result);

		// Determine the owner
		const ownerId = subTask.parentWorkerId;
		this._logService.info(`[ParentCompletionService] Delivering completion for subtask ${subTask.id} to owner ${ownerId}`);

		// Try to find and invoke handler
		const handler = this._parentHandlers.get(ownerId);
		if (handler) {
			await this._deliverToHandler(handler, message);
		} else {
			// Queue for later delivery
			this._queuePendingCompletion(ownerId, message);
		}
	}

	private _createCompletionMessage(subTask: ISubTask, result: ISubTaskResult): IParentCompletionMessage {
		return {
			subTaskId: subTask.id,
			agentType: subTask.agentType,
			taskPrompt: subTask.prompt.slice(0, 500) + (subTask.prompt.length > 500 ? '...' : ''),
			response: result.output,
			worktreePath: subTask.worktreePath,
			status: result.status,
			error: result.error,
			timestamp: Date.now(),
			// Note: changedFilesCount, insertions, deletions can be populated by git diff stats
			// This will be enhanced in Phase 5 (worktree semantics)
		};
	}

	private async _deliverToHandler(handler: IParentHandler, message: IParentCompletionMessage): Promise<void> {
		try {
			await handler.onCompletion(message);
			this._logService.debug(`[ParentCompletionService] Delivered completion to handler ${handler.ownerId}`);
			this._onCompletionDelivered.fire({ ownerId: handler.ownerId, message });
		} catch (error) {
			this._logService.error(`[ParentCompletionService] Error delivering completion to ${handler.ownerId}:`, error);
		}
	}

	private _queuePendingCompletion(ownerId: string, message: IParentCompletionMessage): void {
		let pending = this._pendingCompletions.get(ownerId);
		if (!pending) {
			pending = [];
			this._pendingCompletions.set(ownerId, pending);
		}
		pending.push(message);
		this._logService.debug(`[ParentCompletionService] Queued completion for owner ${ownerId} (${pending.length} pending)`);
		this._onCompletionQueued.fire({ ownerId, message });
	}

	private _handleSubTaskCompletion(subTask: ISubTask): void {
		// Only handle terminal states
		if (!['completed', 'failed', 'cancelled'].includes(subTask.status)) {
			return;
		}

		// Create a result from the subTask if not present
		const result: ISubTaskResult = subTask.result ?? {
			taskId: subTask.id,
			status: subTask.status === 'completed' ? 'success' :
				subTask.status === 'cancelled' ? 'failed' : 'failed',
			output: '',
			error: subTask.status === 'cancelled' ? 'Task was cancelled' :
				subTask.status === 'failed' ? 'Task failed' : undefined,
		};

		// Deliver the completion
		this.deliverCompletion(subTask, result).catch(error => {
			this._logService.error(`[ParentCompletionService] Failed to deliver SubTaskManager completion:`, error);
		});
	}

	private async _handleQueueCompletion(message: IOrchestratorQueueMessage): Promise<void> {
		// Only process messages with owner context (routed to specific parent)
		if (!message.owner?.ownerId) {
			return;
		}

		// Extract the result from the message content
		const result = message.content as ISubTaskResult;
		if (!result || !result.taskId) {
			this._logService.warn(`[ParentCompletionService] Received completion message without valid result`);
			return;
		}

		// Get the subtask for additional context
		const subTask = this._subTaskManager.getSubTask(result.taskId);
		if (!subTask) {
			this._logService.warn(`[ParentCompletionService] Subtask ${result.taskId} not found for queue completion`);
			return;
		}

		// Deliver via the main path (handles dedup)
		await this.deliverCompletion(subTask, result);
	}

	/**
	 * Register a subtask -> owner mapping for routing.
	 * Called when a subtask is created.
	 */
	registerSubtaskOwner(subTaskId: string, ownerId: string): void {
		this._subtaskToOwner.set(subTaskId, ownerId);
	}

	/**
	 * Clear old processed completions to prevent memory growth.
	 * Called periodically or when worker tracking is reset.
	 */
	clearProcessedCompletions(ownerId?: string): void {
		if (ownerId) {
			// Clear only completions for this owner
			for (const completionId of this._processedCompletions) {
				if (completionId.includes(ownerId)) {
					this._processedCompletions.delete(completionId);
				}
			}
			this._pendingCompletions.delete(ownerId);
		} else {
			this._processedCompletions.clear();
			this._pendingCompletions.clear();
		}
	}
}

/**
 * Helper class to integrate parent completion with WorkerSession.
 * This adapter handles injecting completion messages into a worker's conversation
 * and triggering continuation.
 */
export class WorkerSessionWakeUpAdapter {
	constructor(
		private readonly _workerSession: WorkerSession,
		private readonly _parentCompletionService: IParentCompletionService,
		private readonly _logService: ILogService,
	) { }

	/**
	 * Register this worker session to receive completions from its subtasks.
	 * Returns a disposable that unregisters the handler.
	 */
	register(): IDisposable {
		return this._parentCompletionService.registerParentHandler(
			this._workerSession.id,
			async (message) => {
				await this._handleCompletion(message);
			},
			{ injectAsUserMessage: true }
		);
	}

	private async _handleCompletion(message: IParentCompletionMessage): Promise<void> {
		this._logService.info(`[WorkerSessionWakeUpAdapter] Received completion for worker ${this._workerSession.id}: ${message.subTaskId}`);

		// Format as "as-if-user" message
		const userMessage = this._parentCompletionService.formatAsUserMessage(message);

		// Inject as clarification message (this wakes up the worker if idle)
		this._workerSession.sendClarification(userMessage);

		this._logService.debug(`[WorkerSessionWakeUpAdapter] Injected completion as clarification for ${this._workerSession.id}`);
	}
}

/**
 * Helper function to get git diff stats for a worktree.
 * Used to populate changedFilesCount, insertions, deletions in completion messages.
 */
export async function getWorktreeDiffStats(worktreePath: string): Promise<{
	changedFilesCount: number;
	insertions: number;
	deletions: number;
} | undefined> {
	try {
		// Run git diff --stat --numstat
		const result = await new Promise<string>((resolve, reject) => {
			const { exec } = require('child_process');
			exec(
				'git diff --stat --numstat HEAD',
				{ cwd: worktreePath, encoding: 'utf-8' },
				(error: Error | null, stdout: string) => {
					if (error) {
						reject(error);
					} else {
						resolve(stdout);
					}
				}
			);
		});

		// Parse the output
		const lines = result.split('\n').filter(l => l.trim());
		let insertions = 0;
		let deletions = 0;
		let changedFilesCount = 0;

		for (const line of lines) {
			const match = line.match(/^(\d+)\s+(\d+)\s+/);
			if (match) {
				insertions += parseInt(match[1], 10);
				deletions += parseInt(match[2], 10);
				changedFilesCount++;
			}
		}

		return { changedFilesCount, insertions, deletions };
	} catch {
		return undefined;
	}
}
