/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable, IDisposable, toDisposable } from '../../../util/vs/base/common/lifecycle';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { createDecorator } from '../../../util/vs/platform/instantiation/common/instantiation';
import {
	deserializeMessage,
	IA2AMessage,
	IAgentIdentifier,
	ICreateMessageOptions,
	IMessageAcknowledgment,
	IMessageDeliveryOptions,
	IMessageMetadata,
	ISerializedA2AMessage,
	MessagePriority,
	MessageStatus,
	serializeMessage,
} from './messageTypes';

export const IA2AMessageQueue = createDecorator<IA2AMessageQueue>('a2aMessageQueue');

/**
 * Configuration for the message queue.
 */
export interface IMessageQueueConfig {
	/** Maximum queue size before rejecting new messages */
	readonly maxQueueSize: number;
	/** Default message TTL in milliseconds */
	readonly defaultTtl: number;
	/** Default timeout for message delivery */
	readonly defaultTimeout: number;
	/** Default retry count for failed deliveries */
	readonly defaultRetryCount: number;
	/** Interval for cleaning up expired messages (ms) */
	readonly cleanupInterval: number;
	/** Whether to persist queue to disk */
	readonly persistQueue: boolean;
	/** Path for queue persistence file */
	readonly persistencePath?: string;
}

/**
 * Metrics for the message queue.
 */
export interface IMessageQueueMetrics {
	/** Total messages enqueued since start */
	readonly totalEnqueued: number;
	/** Total messages delivered successfully */
	readonly totalDelivered: number;
	/** Total messages that failed delivery */
	readonly totalFailed: number;
	/** Total messages expired */
	readonly totalExpired: number;
	/** Current queue depth */
	readonly queueDepth: number;
	/** Average delivery time in milliseconds */
	readonly avgDeliveryTime: number;
	/** Messages by priority */
	readonly byPriority: Record<MessagePriority, number>;
}

/**
 * Handler function for processing messages.
 */
export type MessageHandler = (message: IA2AMessage) => Promise<void>;

/**
 * Inter-agent message queue service interface.
 */
export interface IA2AMessageQueue {
	readonly _serviceBrand: undefined;

	/** Event fired when a message is enqueued */
	readonly onMessageEnqueued: Event<IA2AMessage>;
	/** Event fired when a message is delivered */
	readonly onMessageDelivered: Event<IA2AMessage>;
	/** Event fired when a message delivery fails */
	readonly onMessageFailed: Event<{ message: IA2AMessage; error: string }>;
	/** Event fired when a message expires */
	readonly onMessageExpired: Event<IA2AMessage>;
	/** Event fired when a message is acknowledged */
	readonly onMessageAcknowledged: Event<IMessageAcknowledgment>;

	/**
	 * Create and enqueue a new message.
	 */
	enqueue(options: ICreateMessageOptions): IA2AMessage;

	/**
	 * Acknowledge receipt of a message.
	 */
	acknowledge(messageId: string, acknowledger: IAgentIdentifier, success: boolean, error?: string): void;

	/**
	 * Register a handler for messages to a specific agent.
	 * Returns a disposable to unregister the handler.
	 */
	registerHandler(agentId: string, handler: MessageHandler): IDisposable;

	/**
	 * Get all pending messages for an agent.
	 */
	getPendingMessages(agentId: string): IA2AMessage[];

	/**
	 * Get all messages in the queue (for debugging/monitoring).
	 */
	getAllMessages(): IA2AMessage[];

	/**
	 * Get a specific message by ID.
	 */
	getMessage(messageId: string): IA2AMessage | undefined;

	/**
	 * Check if a message has been processed.
	 */
	isMessageProcessed(messageId: string): boolean;

	/**
	 * Cancel a pending message.
	 */
	cancelMessage(messageId: string): boolean;

	/**
	 * Get queue metrics.
	 */
	getMetrics(): IMessageQueueMetrics;

	/**
	 * Clear all messages (for testing/reset).
	 */
	clear(): void;
}

/**
 * Priority queue implementation for messages.
 * Higher priority messages are dequeued first.
 * Within the same priority, messages are processed FIFO.
 */
class MessagePriorityQueue {
	private readonly _queues: Map<MessagePriority, IA2AMessage[]> = new Map([
		['critical', []],
		['high', []],
		['normal', []],
		['low', []],
	]);

	private static readonly PRIORITY_ORDER: MessagePriority[] = ['critical', 'high', 'normal', 'low'];

	enqueue(message: IA2AMessage): void {
		const queue = this._queues.get(message.priority);
		if (queue) {
			queue.push(message);
		}
	}

	dequeue(): IA2AMessage | undefined {
		for (const priority of MessagePriorityQueue.PRIORITY_ORDER) {
			const queue = this._queues.get(priority);
			if (queue && queue.length > 0) {
				return queue.shift();
			}
		}
		return undefined;
	}

	peek(): IA2AMessage | undefined {
		for (const priority of MessagePriorityQueue.PRIORITY_ORDER) {
			const queue = this._queues.get(priority);
			if (queue && queue.length > 0) {
				return queue[0];
			}
		}
		return undefined;
	}

	remove(messageId: string): boolean {
		for (const queue of this._queues.values()) {
			const index = queue.findIndex(m => m.id === messageId);
			if (index !== -1) {
				queue.splice(index, 1);
				return true;
			}
		}
		return false;
	}

	size(): number {
		let total = 0;
		for (const queue of this._queues.values()) {
			total += queue.length;
		}
		return total;
	}

	isEmpty(): boolean {
		return this.size() === 0;
	}

	getAll(): IA2AMessage[] {
		const all: IA2AMessage[] = [];
		for (const priority of MessagePriorityQueue.PRIORITY_ORDER) {
			const queue = this._queues.get(priority);
			if (queue) {
				all.push(...queue);
			}
		}
		return all;
	}

	getByPriority(): Record<MessagePriority, number> {
		return {
			critical: this._queues.get('critical')?.length ?? 0,
			high: this._queues.get('high')?.length ?? 0,
			normal: this._queues.get('normal')?.length ?? 0,
			low: this._queues.get('low')?.length ?? 0,
		};
	}

	clear(): void {
		for (const queue of this._queues.values()) {
			queue.length = 0;
		}
	}
}

/**
 * Default configuration for the message queue.
 */
const DEFAULT_CONFIG: IMessageQueueConfig = {
	maxQueueSize: 10000,
	defaultTtl: 5 * 60 * 1000, // 5 minutes
	defaultTimeout: 30 * 1000, // 30 seconds
	defaultRetryCount: 3,
	cleanupInterval: 60 * 1000, // 1 minute
	persistQueue: true,
	persistencePath: undefined,
};

/**
 * Implementation of the inter-agent message queue.
 */
export class A2AMessageQueue extends Disposable implements IA2AMessageQueue {
	declare readonly _serviceBrand: undefined;

	private static readonly STATE_FILE_NAME = '.copilot-a2a-message-queue.json';

	private readonly _config: IMessageQueueConfig;
	private readonly _queue = new MessagePriorityQueue();
	private readonly _processedMessageIds = new Set<string>();
	private readonly _handlers = new Map<string, MessageHandler>();
	private readonly _pendingDeliveries = new Map<string, { message: IA2AMessage; attempts: number; timer: ReturnType<typeof setTimeout> }>();
	private readonly _messageHistory = new Map<string, IA2AMessage>(); // For debugging/correlation

	private _isProcessing = false;
	private _cleanupTimer: ReturnType<typeof setInterval> | undefined;
	private _metrics: {
		totalEnqueued: number;
		totalDelivered: number;
		totalFailed: number;
		totalExpired: number;
		totalDeliveryTime: number;
		deliveryCount: number;
	} = {
			totalEnqueued: 0,
			totalDelivered: 0,
			totalFailed: 0,
			totalExpired: 0,
			totalDeliveryTime: 0,
			deliveryCount: 0,
		};

	private readonly _onMessageEnqueued = this._register(new Emitter<IA2AMessage>());
	public readonly onMessageEnqueued: Event<IA2AMessage> = this._onMessageEnqueued.event;

	private readonly _onMessageDelivered = this._register(new Emitter<IA2AMessage>());
	public readonly onMessageDelivered: Event<IA2AMessage> = this._onMessageDelivered.event;

	private readonly _onMessageFailed = this._register(new Emitter<{ message: IA2AMessage; error: string }>());
	public readonly onMessageFailed: Event<{ message: IA2AMessage; error: string }> = this._onMessageFailed.event;

	private readonly _onMessageExpired = this._register(new Emitter<IA2AMessage>());
	public readonly onMessageExpired: Event<IA2AMessage> = this._onMessageExpired.event;

	private readonly _onMessageAcknowledged = this._register(new Emitter<IMessageAcknowledgment>());
	public readonly onMessageAcknowledged: Event<IMessageAcknowledgment> = this._onMessageAcknowledged.event;

	constructor(
		@ILogService private readonly _logService: ILogService,
		config?: Partial<IMessageQueueConfig>,
	) {
		super();
		this._config = { ...DEFAULT_CONFIG, ...config };

		this._restoreState();
		this._startCleanupTimer();

		this._logService.debug('[A2AMessageQueue] Service initialized');
	}

	private _getStateFilePath(): string | undefined {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceFolder) {
			return undefined;
		}
		return this._config.persistencePath ?? path.join(workspaceFolder, A2AMessageQueue.STATE_FILE_NAME);
	}

	private _saveState(): void {
		if (!this._config.persistQueue) {
			return;
		}

		const stateFilePath = this._getStateFilePath();
		if (!stateFilePath) {
			return;
		}

		try {
			const serializedMessages = this._queue.getAll().map(serializeMessage);
			const state = {
				messages: serializedMessages,
				processedIds: Array.from(this._processedMessageIds),
				metrics: this._metrics,
			};
			fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
		} catch (error) {
			this._logService.error('[A2AMessageQueue] Failed to save state:', error);
		}
	}

	private _restoreState(): void {
		if (!this._config.persistQueue) {
			return;
		}

		const stateFilePath = this._getStateFilePath();
		if (!stateFilePath || !fs.existsSync(stateFilePath)) {
			return;
		}

		try {
			const content = fs.readFileSync(stateFilePath, 'utf-8');
			const state = JSON.parse(content);

			if (state.messages && Array.isArray(state.messages)) {
				for (const serialized of state.messages as ISerializedA2AMessage[]) {
					const message = deserializeMessage(serialized);
					// Only restore messages that haven't expired
					if (!this._isMessageExpired(message)) {
						this._queue.enqueue(message);
					}
				}
				this._logService.debug(`[A2AMessageQueue] Restored ${this._queue.size()} messages from state`);
			}

			if (state.processedIds && Array.isArray(state.processedIds)) {
				for (const id of state.processedIds) {
					this._processedMessageIds.add(id);
				}
			}

			if (state.metrics) {
				this._metrics = { ...this._metrics, ...state.metrics };
			}
		} catch (error) {
			this._logService.error('[A2AMessageQueue] Failed to restore state:', error);
		}
	}

	private _startCleanupTimer(): void {
		this._cleanupTimer = setInterval(() => {
			this._cleanupExpiredMessages();
		}, this._config.cleanupInterval);

		this._register(toDisposable(() => {
			if (this._cleanupTimer) {
				clearInterval(this._cleanupTimer);
			}
		}));
	}

	private _cleanupExpiredMessages(): void {
		const allMessages = this._queue.getAll();
		const expiredIds: string[] = [];

		for (const message of allMessages) {
			if (this._isMessageExpired(message)) {
				expiredIds.push(message.id);
			}
		}

		for (const id of expiredIds) {
			const removed = this._queue.remove(id);
			if (removed) {
				const message = this._messageHistory.get(id);
				if (message) {
					this._metrics.totalExpired++;
					this._onMessageExpired.fire(message);
				}
				this._logService.debug(`[A2AMessageQueue] Expired message ${id}`);
			}
		}

		// Also cleanup pending deliveries
		for (const [id, pending] of this._pendingDeliveries) {
			if (this._isMessageExpired(pending.message)) {
				clearTimeout(pending.timer);
				this._pendingDeliveries.delete(id);
				this._metrics.totalExpired++;
				this._onMessageExpired.fire(pending.message);
				this._logService.debug(`[A2AMessageQueue] Expired pending delivery ${id}`);
			}
		}

		if (expiredIds.length > 0) {
			this._saveState();
		}
	}

	private _isMessageExpired(message: IA2AMessage): boolean {
		const ttl = message.deliveryOptions.ttl ?? this._config.defaultTtl;
		const expiresAt = message.metadata.createdAt + ttl;
		return Date.now() > expiresAt;
	}

	enqueue(options: ICreateMessageOptions): IA2AMessage {
		// Check queue size limit
		if (this._queue.size() >= this._config.maxQueueSize) {
			throw new Error(`Message queue is full (max: ${this._config.maxQueueSize})`);
		}

		const now = Date.now();
		const messageId = generateUuid();

		const metadata: IMessageMetadata = {
			createdAt: now,
			deliveryAttempts: 0,
			correlationId: options.correlationId,
			traceId: options.traceId ?? generateUuid(),
		};

		const deliveryOptions: IMessageDeliveryOptions = {
			timeout: options.deliveryOptions?.timeout ?? this._config.defaultTimeout,
			retryCount: options.deliveryOptions?.retryCount ?? this._config.defaultRetryCount,
			requireAck: options.deliveryOptions?.requireAck ?? false,
			ttl: options.deliveryOptions?.ttl ?? this._config.defaultTtl,
		};

		const message: IA2AMessage = {
			id: messageId,
			type: options.type,
			priority: options.priority ?? 'normal',
			status: 'pending',
			sender: options.sender,
			receiver: options.receiver,
			content: options.content,
			metadata,
			deliveryOptions,
			planId: options.planId,
			taskId: options.taskId,
			subTaskId: options.subTaskId,
			depth: options.depth,
		};

		this._queue.enqueue(message);
		this._messageHistory.set(messageId, message);
		this._metrics.totalEnqueued++;

		this._logService.debug(`[A2AMessageQueue] Enqueued message ${messageId} (type: ${message.type}, priority: ${message.priority}, receiver: ${message.receiver.id})`);

		this._onMessageEnqueued.fire(message);
		this._saveState();

		// Trigger processing
		this._processQueue();

		return message;
	}

	acknowledge(messageId: string, acknowledger: IAgentIdentifier, success: boolean, error?: string): void {
		const pending = this._pendingDeliveries.get(messageId);
		if (!pending) {
			this._logService.warn(`[A2AMessageQueue] Cannot acknowledge unknown message ${messageId}`);
			return;
		}

		clearTimeout(pending.timer);
		this._pendingDeliveries.delete(messageId);

		const message = pending.message;
		(message as { status: MessageStatus }).status = success ? 'acknowledged' : 'failed';
		(message.metadata as { acknowledgedAt: number }).acknowledgedAt = Date.now();

		const ack: IMessageAcknowledgment = {
			messageId,
			acknowledgedAt: Date.now(),
			acknowledgedBy: acknowledger,
			success,
			error,
		};

		this._onMessageAcknowledged.fire(ack);
		this._processedMessageIds.add(messageId);
		this._saveState();

		this._logService.debug(`[A2AMessageQueue] Acknowledged message ${messageId} (success: ${success})`);
	}

	registerHandler(agentId: string, handler: MessageHandler): IDisposable {
		this._handlers.set(agentId, handler);
		this._logService.debug(`[A2AMessageQueue] Registered handler for agent ${agentId}`);

		// Check for pending messages
		const pending = this.getPendingMessages(agentId);
		if (pending.length > 0) {
			this._logService.debug(`[A2AMessageQueue] Found ${pending.length} pending messages for agent ${agentId}`);
			this._processQueue();
		}

		return toDisposable(() => {
			this._handlers.delete(agentId);
			this._logService.debug(`[A2AMessageQueue] Unregistered handler for agent ${agentId}`);
		});
	}

	getPendingMessages(agentId: string): IA2AMessage[] {
		return this._queue.getAll().filter(m =>
			m.receiver.id === agentId && m.status === 'pending'
		);
	}

	getAllMessages(): IA2AMessage[] {
		return this._queue.getAll();
	}

	getMessage(messageId: string): IA2AMessage | undefined {
		// Check queue first
		const inQueue = this._queue.getAll().find(m => m.id === messageId);
		if (inQueue) {
			return inQueue;
		}
		// Check history
		return this._messageHistory.get(messageId);
	}

	isMessageProcessed(messageId: string): boolean {
		return this._processedMessageIds.has(messageId);
	}

	cancelMessage(messageId: string): boolean {
		// Remove from queue
		const removed = this._queue.remove(messageId);

		// Cancel pending delivery
		const pending = this._pendingDeliveries.get(messageId);
		if (pending) {
			clearTimeout(pending.timer);
			this._pendingDeliveries.delete(messageId);
		}

		if (removed || pending) {
			this._logService.debug(`[A2AMessageQueue] Cancelled message ${messageId}`);
			this._saveState();
			return true;
		}

		return false;
	}

	getMetrics(): IMessageQueueMetrics {
		return {
			totalEnqueued: this._metrics.totalEnqueued,
			totalDelivered: this._metrics.totalDelivered,
			totalFailed: this._metrics.totalFailed,
			totalExpired: this._metrics.totalExpired,
			queueDepth: this._queue.size(),
			avgDeliveryTime: this._metrics.deliveryCount > 0
				? this._metrics.totalDeliveryTime / this._metrics.deliveryCount
				: 0,
			byPriority: this._queue.getByPriority(),
		};
	}

	clear(): void {
		// Cancel all pending deliveries
		for (const [, pending] of this._pendingDeliveries) {
			clearTimeout(pending.timer);
		}
		this._pendingDeliveries.clear();

		this._queue.clear();
		this._processedMessageIds.clear();
		this._messageHistory.clear();
		this._metrics = {
			totalEnqueued: 0,
			totalDelivered: 0,
			totalFailed: 0,
			totalExpired: 0,
			totalDeliveryTime: 0,
			deliveryCount: 0,
		};

		this._saveState();
		this._logService.debug('[A2AMessageQueue] Queue cleared');
	}

	private async _processQueue(): Promise<void> {
		if (this._isProcessing || this._queue.isEmpty()) {
			return;
		}

		this._isProcessing = true;

		try {
			while (!this._queue.isEmpty()) {
				const message = this._queue.peek();
				if (!message) {
					break;
				}

				// Check if expired
				if (this._isMessageExpired(message)) {
					this._queue.dequeue();
					this._metrics.totalExpired++;
					this._onMessageExpired.fire(message);
					continue;
				}

				// Find handler for receiver
				const handler = this._handlers.get(message.receiver.id);
				if (!handler) {
					// No handler registered, leave in queue for later
					break;
				}

				// Dequeue and attempt delivery
				this._queue.dequeue();
				await this._deliverMessage(message, handler);
			}
		} finally {
			this._isProcessing = false;
			this._saveState();
		}
	}

	private async _deliverMessage(message: IA2AMessage, handler: MessageHandler): Promise<void> {
		const startTime = Date.now();
		const maxRetries = message.deliveryOptions.retryCount ?? this._config.defaultRetryCount;
		let attempts = (message.metadata as { deliveryAttempts: number }).deliveryAttempts;

		const attemptDelivery = async (): Promise<boolean> => {
			attempts++;
			(message.metadata as { deliveryAttempts: number }).deliveryAttempts = attempts;

			try {
				await handler(message);

				// Delivery successful
				(message as { status: MessageStatus }).status = 'delivered';
				(message.metadata as { deliveredAt: number }).deliveredAt = Date.now();

				const deliveryTime = Date.now() - startTime;
				this._metrics.totalDelivered++;
				this._metrics.totalDeliveryTime += deliveryTime;
				this._metrics.deliveryCount++;

				this._onMessageDelivered.fire(message);
				this._logService.debug(`[A2AMessageQueue] Delivered message ${message.id} in ${deliveryTime}ms (attempts: ${attempts})`);

				// If acknowledgment is required, set up waiting
				if (message.deliveryOptions.requireAck) {
					this._setupAckWait(message);
				} else {
					this._processedMessageIds.add(message.id);
				}

				return true;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				(message.metadata as { lastError: string }).lastError = errorMessage;

				this._logService.warn(`[A2AMessageQueue] Delivery attempt ${attempts} failed for message ${message.id}: ${errorMessage}`);

				if (attempts >= maxRetries) {
					// Max retries exceeded
					(message as { status: MessageStatus }).status = 'failed';
					this._metrics.totalFailed++;
					this._onMessageFailed.fire({ message, error: errorMessage });
					this._processedMessageIds.add(message.id);
					return false;
				}

				// Retry with exponential backoff
				const backoffMs = Math.min(1000 * Math.pow(2, attempts - 1), 30000);
				await new Promise(resolve => setTimeout(resolve, backoffMs));
				return attemptDelivery();
			}
		};

		await attemptDelivery();
	}

	private _setupAckWait(message: IA2AMessage): void {
		const timeout = message.deliveryOptions.timeout ?? this._config.defaultTimeout;

		const timer = setTimeout(() => {
			// Acknowledgment timeout
			const pending = this._pendingDeliveries.get(message.id);
			if (pending) {
				this._pendingDeliveries.delete(message.id);
				(message as { status: MessageStatus }).status = 'failed';
				this._metrics.totalFailed++;
				this._onMessageFailed.fire({ message, error: 'Acknowledgment timeout' });
				this._processedMessageIds.add(message.id);
				this._logService.warn(`[A2AMessageQueue] Acknowledgment timeout for message ${message.id}`);
			}
		}, timeout);

		this._pendingDeliveries.set(message.id, {
			message,
			attempts: message.metadata.deliveryAttempts,
			timer,
		});
	}

	override dispose(): void {
		// Cancel all pending deliveries
		for (const [, pending] of this._pendingDeliveries) {
			clearTimeout(pending.timer);
		}
		this._pendingDeliveries.clear();

		if (this._cleanupTimer) {
			clearInterval(this._cleanupTimer);
		}

		this._saveState();
		super.dispose();
	}
}
