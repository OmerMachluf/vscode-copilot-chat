/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Emitter, Event } from '../../util/vs/base/common/event';
import { Disposable, IDisposable, toDisposable } from '../../util/vs/base/common/lifecycle';
import { createDecorator } from '../../util/vs/platform/instantiation/common/instantiation';

export const IOrchestratorQueueService = createDecorator<IOrchestratorQueueService>('orchestratorQueueService');

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

	// Message content
	type: 'status_update' | 'permission_request' | 'question' | 'completion' | 'error';
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
	registerHandler(handler: (message: IOrchestratorQueueMessage) => Promise<void>): IDisposable;
}

export class OrchestratorQueueService extends Disposable implements IOrchestratorQueueService {
	declare readonly _serviceBrand: undefined;

	private static readonly STATE_FILE_NAME = '.copilot-orchestrator-queue.json';
	private readonly _queue = new PriorityQueue<IOrchestratorQueueMessage>();
	private readonly _processedMessageIds = new Set<string>();
	private _isProcessing = false;
	private _metrics = { depth: 0, processingTime: 0, waitTime: 0 };
	private _handler: ((message: IOrchestratorQueueMessage) => Promise<void>) | undefined;

	private readonly _onMessageEnqueued = this._register(new Emitter<IOrchestratorQueueMessage>());
	public readonly onMessageEnqueued: Event<IOrchestratorQueueMessage> = this._onMessageEnqueued.event;

	private readonly _onMessageProcessed = this._register(new Emitter<IOrchestratorQueueMessage>());
	public readonly onMessageProcessed: Event<IOrchestratorQueueMessage> = this._onMessageProcessed.event;

	constructor() {
		super();
		this._restoreState();
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
			console.error('Failed to save orchestrator queue state:', error);
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
			}

			if (state.processedMessageIds && Array.isArray(state.processedMessageIds)) {
				for (const id of state.processedMessageIds) {
					this._processedMessageIds.add(id);
				}
			}
		} catch (error) {
			console.error('Failed to restore orchestrator queue state:', error);
		}
	}

	registerHandler(handler: (message: IOrchestratorQueueMessage) => Promise<void>): IDisposable {
		this._handler = handler;
		// Trigger processing if queue is not empty
		if (!this._queue.isEmpty()) {
			setTimeout(() => this.processNext(), 0);
		}
		return toDisposable(() => { this._handler = undefined; });
	}

	enqueueMessage(message: IOrchestratorQueueMessage): void {
		if (this._processedMessageIds.has(message.id)) {
			return; // Deduplication
		}

		// Check if already in queue
		const currentQueue = this._queue.getAll();
		if (currentQueue.some(m => m.id === message.id)) {
			return;
		}

		this._queue.enqueue(message);
		this._onMessageEnqueued.fire(message);
		this._saveState();

		// Trigger async processing
		setTimeout(() => this.processNext(), 0);
	}

	async processNext(): Promise<void> {
		if (this._isProcessing || this._queue.isEmpty() || !this._handler) {
			return;
		}

		this._isProcessing = true;
		const startTime = Date.now();

		try {
			const message = this._queue.peek();
			if (message) {
				this._queue.dequeue();

				this._metrics.waitTime = startTime - message.timestamp;

				await this._handler(message);

				this._processedMessageIds.add(message.id);
				this._onMessageProcessed.fire(message);

				this._metrics.processingTime = Date.now() - startTime;
				this._metrics.depth = this._queue.size();

				this._saveState();
			}
		} catch (err) {
			console.error("Error processing message", err);
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
