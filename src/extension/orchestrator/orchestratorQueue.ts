/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ILogService } from '../../platform/log/common/logService';
import { Emitter, Event } from '../../util/vs/base/common/event';
import { Disposable, IDisposable, toDisposable } from '../../util/vs/base/common/lifecycle';
import { createDecorator } from '../../util/vs/platform/instantiation/common/instantiation';

export const IOrchestratorQueueService = createDecorator<IOrchestratorQueueService>('orchestratorQueueService');

/**
 * Owner context for message routing.
 * Identifies who should receive messages from a worker/subtask.
 */
export interface IOwnerContext {
	/** Type of owner */
	ownerType: 'orchestrator' | 'worker' | 'agent';
	/** Unique ID of the owner (worker ID, session ID, or 'orchestrator') */
	ownerId: string;
	/** Session URI for agent sessions */
	sessionUri?: string;
}

export interface IOrchestratorQueueMessage {
	id: string;
	timestamp: number;
	priority: 'critical' | 'high' | 'normal' | 'low';

	// Full context (required)
	planId: string;
	taskId: string;
	workerId: string;
	worktreePath: string;

	// Sub-task context (optional)
	parentAgentId?: string;
	subTaskId?: string;
	depth?: number;

	// Owner context for routing (optional - defaults to orchestrator)
	owner?: IOwnerContext;

	// Message content
	type: 'status_update' | 'permission_request' | 'permission_response' | 'question' | 'completion' | 'error' | 'answer' | 'refinement' | 'retry_request' | 'approval_request' | 'approval_response';
	content: unknown;
}

export class PriorityQueue<T extends { priority: 'critical' | 'high' | 'normal' | 'low' }> {
	private _items: T[] = [];

	private _priorityValue(priority: 'critical' | 'high' | 'normal' | 'low'): number {
		switch (priority) {
			case 'critical': return 4;
			case 'high': return 3;
			case 'normal': return 2;
			case 'low': return 1;
			default: return 0;
		}
	}

	enqueue(item: T): void {
		this._items.push(item);
		this._items.sort((a, b) => this._priorityValue(b.priority) - this._priorityValue(a.priority));
	}

	dequeue(): T | undefined {
		return this._items.shift();
	}

	peek(): T | undefined {
		return this._items[0];
	}

	size(): number {
		return this._items.length;
	}

	clear(): void {
		this._items = [];
	}

	isEmpty(): boolean {
		return this._items.length === 0;
	}

	getAll(): T[] {
		return [...this._items];
	}
}

export interface IOrchestratorQueueService {
	readonly _serviceBrand: undefined;

	readonly onMessageEnqueued: Event<IOrchestratorQueueMessage>;
	readonly onMessageProcessed: Event<IOrchestratorQueueMessage>;

	enqueueMessage(message: IOrchestratorQueueMessage): void;
	processNext(): Promise<void>;
	getMetrics(): { depth: number; processingTime: number; waitTime: number };

	/** Register the default handler (orchestrator) */
	registerHandler(handler: (message: IOrchestratorQueueMessage) => Promise<void>): IDisposable;

	/** Register a handler for a specific owner ID */
	registerOwnerHandler(ownerId: string, handler: (message: IOrchestratorQueueMessage) => Promise<void>): IDisposable;

	/** Get messages pending for a specific owner */
	getPendingMessagesForOwner(ownerId: string): IOrchestratorQueueMessage[];

	/** Check if a message has been processed (for de-duplication) */
	isMessageProcessed(messageId: string): boolean;

	/** Manually mark a message as processed (for external de-duplication) */
	markMessageProcessed(messageId: string): void;

	/** Get a message by ID from the queue (if still pending) */
	getMessageById(messageId: string): IOrchestratorQueueMessage | undefined;

	/** Check if a handler is registered for the given owner */
	hasOwnerHandler(ownerId: string): boolean;
}

export class OrchestratorQueueService extends Disposable implements IOrchestratorQueueService {
	declare readonly _serviceBrand: undefined;

	private static readonly STATE_FILE_NAME = '.copilot-orchestrator-queue.json';
	private readonly _queue = new PriorityQueue<IOrchestratorQueueMessage>();
	private readonly _processedMessageIds = new Set<string>();
	private _isProcessing = false;
	private _metrics = { depth: 0, processingTime: 0, waitTime: 0 };
	private _handler: ((message: IOrchestratorQueueMessage) => Promise<void>) | undefined;

	/** Per-owner handlers for routing messages */
	private readonly _ownerHandlers = new Map<string, (message: IOrchestratorQueueMessage) => Promise<void>>();

	private readonly _onMessageEnqueued = this._register(new Emitter<IOrchestratorQueueMessage>());
	public readonly onMessageEnqueued: Event<IOrchestratorQueueMessage> = this._onMessageEnqueued.event;

	private readonly _onMessageProcessed = this._register(new Emitter<IOrchestratorQueueMessage>());
	public readonly onMessageProcessed: Event<IOrchestratorQueueMessage> = this._onMessageProcessed.event;

	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._restoreState();
		this._qLog('Service initialized');
	}

	private _qLog(message: string, data?: Record<string, unknown>): void {
		const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
		this._logService.info(`[ORCH-DEBUG][Queue] ${message}${dataStr}`);
	}

	private _getStateFilePath(): string | undefined {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceFolder) {
			return undefined;
		}
		return path.join(workspaceFolder, OrchestratorQueueService.STATE_FILE_NAME);
	}

	private _saveState(): void {
		const stateFilePath = this._getStateFilePath();
		if (!stateFilePath) {
			return;
		}

		try {
			const state = {
				queue: this._queue.getAll(),
				processedMessageIds: Array.from(this._processedMessageIds)
			};
			fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
		} catch (error) {
			this._logService.error('[OrchestratorQueue] Failed to save queue state:', error);
		}
	}

	private _restoreState(): void {
		const stateFilePath = this._getStateFilePath();
		if (!stateFilePath || !fs.existsSync(stateFilePath)) {
			return;
		}

		try {
			const content = fs.readFileSync(stateFilePath, 'utf-8');
			const state = JSON.parse(content);

			if (state.queue && Array.isArray(state.queue)) {
				for (const msg of state.queue) {
					this._queue.enqueue(msg);
				}
				this._logService.debug(`[OrchestratorQueue] Restored ${state.queue.length} messages from state`);
			}

			if (state.processedMessageIds && Array.isArray(state.processedMessageIds)) {
				for (const id of state.processedMessageIds) {
					this._processedMessageIds.add(id);
				}
			}
		} catch (error) {
			this._logService.error('[OrchestratorQueue] Failed to restore queue state:', error);
		}
	}

	registerHandler(handler: (message: IOrchestratorQueueMessage) => Promise<void>): IDisposable {
		this._qLog('Registered default handler', { queueSize: this._queue.size() });
		this._handler = handler;
		// Trigger processing if queue is not empty
		if (!this._queue.isEmpty()) {
			this._qLog('Queue not empty, triggering processing');
			setTimeout(() => this.processNext(), 0);
		}
		return toDisposable(() => {
			this._handler = undefined;
			this._qLog('Disposed default handler');
		});
	}

	registerOwnerHandler(ownerId: string, handler: (message: IOrchestratorQueueMessage) => Promise<void>): IDisposable {
		this._qLog('Registered owner handler', { ownerId });
		this._ownerHandlers.set(ownerId, handler);
		// Check for any pending messages for this owner
		const pending = this.getPendingMessagesForOwner(ownerId);
		if (pending.length > 0) {
			this._qLog('Found pending messages for owner', { ownerId, pendingCount: pending.length });
			setTimeout(() => this.processNext(), 0);
		}
		return toDisposable(() => {
			this._ownerHandlers.delete(ownerId);
			this._qLog('Disposed owner handler', { ownerId });
		});
	}

	hasOwnerHandler(ownerId: string): boolean {
		return this._ownerHandlers.has(ownerId);
	}

	getPendingMessagesForOwner(ownerId: string): IOrchestratorQueueMessage[] {
		return this._queue.getAll().filter(m => m.owner?.ownerId === ownerId);
	}

	isMessageProcessed(messageId: string): boolean {
		return this._processedMessageIds.has(messageId);
	}

	markMessageProcessed(messageId: string): void {
		this._processedMessageIds.add(messageId);
		this._saveState();
	}

	getMessageById(messageId: string): IOrchestratorQueueMessage | undefined {
		return this._queue.getAll().find(m => m.id === messageId);
	}

	private _getHandlerForMessage(message: IOrchestratorQueueMessage): ((message: IOrchestratorQueueMessage) => Promise<void>) | undefined {
		// If message has an owner, try to route to owner handler first
		if (message.owner?.ownerId) {
			const ownerHandler = this._ownerHandlers.get(message.owner.ownerId);
			if (ownerHandler) {
				this._qLog('Routing message to owner handler', { messageId: message.id, ownerId: message.owner.ownerId, type: message.type });
				return ownerHandler;
			}
			this._qLog('No handler found for owner, will use default', { messageId: message.id, ownerId: message.owner.ownerId, type: message.type });
		}
		// Fall back to default handler (orchestrator)
		return this._handler;
	}

	enqueueMessage(message: IOrchestratorQueueMessage): void {
		if (this._processedMessageIds.has(message.id)) {
			this._qLog('Skipping duplicate message (already processed)', { messageId: message.id, type: message.type });
			return; // Deduplication
		}

		// Check if already in queue
		const currentQueue = this._queue.getAll();
		if (currentQueue.some(m => m.id === message.id)) {
			this._qLog('Skipping duplicate message (already in queue)', { messageId: message.id, type: message.type });
			return;
		}

		this._qLog('Enqueuing message', {
			messageId: message.id,
			type: message.type,
			ownerId: message.owner?.ownerId ?? 'none',
			ownerType: message.owner?.ownerType ?? 'none',
			priority: message.priority,
			workerId: message.workerId,
			taskId: message.taskId,
		});
		this._queue.enqueue(message);
		this._onMessageEnqueued.fire(message);
		this._saveState();

		this._qLog('FIRED onMessageEnqueued event', { messageId: message.id, queueSize: this._queue.size() });

		// Trigger async processing
		setTimeout(() => this.processNext(), 0);
	}

	async processNext(): Promise<void> {
		if (this._isProcessing || this._queue.isEmpty()) {
			return;
		}

		this._isProcessing = true;
		const startTime = Date.now();

		try {
			const message = this._queue.peek();
			if (message) {
				// Find the appropriate handler for this message
				const handler = this._getHandlerForMessage(message);
				if (!handler) {
					// No handler available, leave message in queue
					this._qLog('No handler for message, leaving in queue', {
						messageId: message.id,
						ownerId: message.owner?.ownerId ?? 'none',
						type: message.type,
					});
					this._isProcessing = false;
					return;
				}

				this._queue.dequeue();

				this._metrics.waitTime = startTime - message.timestamp;

				this._qLog('Processing message', {
					messageId: message.id,
					type: message.type,
					waitedMs: this._metrics.waitTime,
					ownerId: message.owner?.ownerId ?? 'none',
					workerId: message.workerId,
					taskId: message.taskId,
				});

				await handler(message);

				this._processedMessageIds.add(message.id);
				this._onMessageProcessed.fire(message);

				this._metrics.processingTime = Date.now() - startTime;
				this._metrics.depth = this._queue.size();

				this._qLog('Processed message', {
					messageId: message.id,
					type: message.type,
					processingTimeMs: this._metrics.processingTime,
					remainingQueueDepth: this._metrics.depth,
				});

				this._saveState();
			}
		} catch (err) {
			this._logService.error('[OrchestratorQueue] Error processing message:', err);
			this._qLog('Error processing message', { error: String(err) });
		} finally {
			this._isProcessing = false;

			// Continue processing if there are more items
			if (!this._queue.isEmpty()) {
				setTimeout(() => this.processNext(), 0);
			}
		}
	}

	getMetrics() {
		return { ...this._metrics };
	}
}
