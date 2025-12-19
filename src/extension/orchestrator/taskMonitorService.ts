/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../platform/log/common/logService';
import { createServiceIdentifier } from '../../util/common/services';
import { Emitter, Event } from '../../util/vs/base/common/event';
import { Disposable, IDisposable, toDisposable } from '../../util/vs/base/common/lifecycle';
import { ISubTask, ISubTaskManager, ISubTaskResult } from './orchestratorInterfaces';

// ============================================================================
// Types
// ============================================================================

/**
 * Types of updates that can be queued for a parent agent
 */
export type TaskUpdateType = 'completed' | 'failed' | 'idle' | 'progress' | 'idle_response' | 'error';

/**
 * Types of errors that can occur during task execution
 */
export type ErrorType = 'rate_limit' | 'network' | 'auth' | 'fatal' | 'timeout' | 'unknown';

/**
 * Information about retry attempts for error reporting
 */
export interface RetryInfo {
	/** Current retry attempt number (1-based) */
	attempt: number;
	/** Maximum number of retry attempts */
	maxAttempts: number;
	/** Time in ms until the next retry (if applicable) */
	nextRetryInMs?: number;
	/** Whether the worker will continue retrying */
	willRetry: boolean;
}

/**
 * An update from a monitored subtask to its parent
 */
export interface ITaskUpdate {
	/** Type of update */
	type: TaskUpdateType;
	/** ID of the subtask that generated this update */
	subTaskId: string;
	/** ID of the parent worker that should receive this update */
	parentWorkerId: string;
	/** Result of the subtask (for completed/failed) */
	result?: ISubTaskResult;
	/** Error details (for failed/error) */
	error?: string;
	/** Type of error (for error updates) */
	errorType?: ErrorType;
	/** Retry information (for error updates) */
	retryInfo?: RetryInfo;
	/** Idle reason (for idle/idle_response) */
	idleReason?: string;
	/** Progress percentage (for progress) */
	progress?: number;
	/** Progress report text from periodic check (for progress) */
	progressReport?: string;
	/** Timestamp when this update was created */
	timestamp: number;
}

/**
 * Queue of updates for a specific parent agent
 */
interface IParentUpdateQueue {
	/** Parent worker ID */
	parentWorkerId: string;
	/** Queued updates waiting to be consumed */
	updates: ITaskUpdate[];
	/** Maximum queue size before oldest are dropped */
	maxSize: number;
}

/**
 * Configuration for the task monitor
 */
export interface ITaskMonitorConfig {
	/** Polling interval in ms (default: 5000) */
	pollIntervalMs: number;
	/** Maximum updates per parent queue (default: 100) */
	maxQueueSize: number;
}

const DEFAULT_CONFIG: ITaskMonitorConfig = {
	pollIntervalMs: 5000, // 5 seconds
	maxQueueSize: 100,
};

// ============================================================================
// Service Interface
// ============================================================================

export const ITaskMonitorService = createServiceIdentifier<ITaskMonitorService>('taskMonitorService');

/**
 * Service for monitoring spawned subtasks and queueing updates for parent agents.
 *
 * This service runs a background polling loop that checks on monitored subtasks
 * and pushes updates to per-parent queues. Parents consume updates when they
 * pause their execution loop.
 *
 * Key behaviors:
 * - Polling every ~5 seconds to check subtask status
 * - Per-parent update queues that accumulate until consumed
 * - Event-driven updates for immediate notifications (completion events)
 * - Queue size limits with oldest-drop policy
 */
export interface ITaskMonitorService {
	readonly _serviceBrand: undefined;

	/**
	 * Register a parent to receive updates from its subtasks.
	 * Creates an update queue for this parent.
	 */
	registerParent(parentWorkerId: string): IDisposable;

	/**
	 * Start monitoring a subtask for a specific parent.
	 * Updates from this subtask will be queued for the parent.
	 */
	startMonitoring(subTaskId: string, parentWorkerId: string): void;

	/**
	 * Stop monitoring a subtask.
	 */
	stopMonitoring(subTaskId: string): void;

	/**
	 * Consume all pending updates for a parent.
	 * Returns the updates and clears them from the queue.
	 * Call this when the agent pauses its tool loop.
	 */
	consumeUpdates(parentWorkerId: string): ITaskUpdate[];

	/**
	 * Peek at pending updates without consuming them.
	 */
	peekUpdates(parentWorkerId: string): readonly ITaskUpdate[];

	/**
	 * Check if a parent has any pending updates.
	 */
	hasPendingUpdates(parentWorkerId: string): boolean;

	/**
	 * Get the count of pending updates for a parent.
	 */
	getPendingUpdateCount(parentWorkerId: string): number;

	/**
	 * Manually queue an update for a parent.
	 * Used by other services to push updates (e.g., idle responses).
	 */
	queueUpdate(update: ITaskUpdate): void;

	/**
	 * Queue an error update immediately without waiting for task completion.
	 * Called during retry loops to notify parents of transient errors.
	 *
	 * @param subTaskId - ID of the subtask that encountered the error
	 * @param parentWorkerId - ID of the parent worker to notify
	 * @param error - Error message describing what went wrong
	 * @param errorType - Category of error (rate_limit, network, fatal, etc.)
	 * @param retryInfo - Optional retry information if the worker will retry
	 */
	queueErrorUpdate(
		subTaskId: string,
		parentWorkerId: string,
		error: string,
		errorType: ErrorType,
		retryInfo?: RetryInfo,
	): void;

	/**
	 * Event fired when new updates are available for a parent.
	 * Listeners can use this to proactively notify agents.
	 */
	readonly onUpdatesAvailable: Event<{ parentWorkerId: string; count: number }>;

	/**
	 * Get current monitoring stats for debugging.
	 */
	getStats(): {
		monitoredTasks: number;
		registeredParents: number;
		totalQueuedUpdates: number;
	};
}

// ============================================================================
// Implementation
// ============================================================================

export class TaskMonitorService extends Disposable implements ITaskMonitorService {
	readonly _serviceBrand: undefined;

	/** Map of parentWorkerId -> update queue */
	private readonly _parentQueues = new Map<string, IParentUpdateQueue>();

	/** Map of subTaskId -> parentWorkerId for routing updates */
	private readonly _monitoredTasks = new Map<string, string>();

	/** Set of subTaskIds that have already been processed (for dedup) */
	private readonly _processedTasks = new Set<string>();

	/** Polling interval handle */
	private _pollHandle: ReturnType<typeof setInterval> | undefined;

	/** Configuration */
	private readonly _config: ITaskMonitorConfig;

	/** Event emitter for update notifications */
	private readonly _onUpdatesAvailable = this._register(new Emitter<{ parentWorkerId: string; count: number }>());
	public readonly onUpdatesAvailable = this._onUpdatesAvailable.event;

	constructor(
		@ISubTaskManager private readonly _subTaskManager: ISubTaskManager,
		@ILogService private readonly _logService: ILogService,
		config: Partial<ITaskMonitorConfig> = {},
	) {
		super();
		this._config = { ...DEFAULT_CONFIG, ...config };

		// Start the polling loop
		this._startPolling();

		// Also listen to SubTaskManager completion events for immediate updates
		// This is in addition to polling - we want BOTH for reliability
		this._register(this._subTaskManager.onDidCompleteSubTask(subTask => {
			this._handleSubTaskCompletion(subTask);
		}));

		this._log('Initialized', { pollIntervalMs: this._config.pollIntervalMs, maxQueueSize: this._config.maxQueueSize });
	}

	private _log(message: string, data?: Record<string, unknown>): void {
		const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
		this._logService.info(`[ORCH-DEBUG][TaskMonitor] ${message}${dataStr}`);
	}

	// --- Public API ---

	public registerParent(parentWorkerId: string): IDisposable {
		if (this._parentQueues.has(parentWorkerId)) {
			this._log('Parent already registered', { parentWorkerId });
			return toDisposable(() => this._unregisterParent(parentWorkerId));
		}

		this._parentQueues.set(parentWorkerId, {
			parentWorkerId,
			updates: [],
			maxSize: this._config.maxQueueSize,
		});

		this._log('Registered parent', { parentWorkerId, totalParents: this._parentQueues.size });

		return toDisposable(() => this._unregisterParent(parentWorkerId));
	}

	public startMonitoring(subTaskId: string, parentWorkerId: string): void {
		// Ensure parent is registered
		if (!this._parentQueues.has(parentWorkerId)) {
			this.registerParent(parentWorkerId);
		}

		this._monitoredTasks.set(subTaskId, parentWorkerId);
		this._log('Started monitoring subtask', { subTaskId, parentWorkerId, totalMonitored: this._monitoredTasks.size });
	}

	public stopMonitoring(subTaskId: string): void {
		const parentWorkerId = this._monitoredTasks.get(subTaskId);
		this._monitoredTasks.delete(subTaskId);
		this._log('Stopped monitoring subtask', { subTaskId, parentWorkerId: parentWorkerId ?? null, remainingMonitored: this._monitoredTasks.size });
	}

	public consumeUpdates(parentWorkerId: string): ITaskUpdate[] {
		const queue = this._parentQueues.get(parentWorkerId);
		if (!queue || queue.updates.length === 0) {
			this._log('No updates to consume', { parentWorkerId });
			return [];
		}

		// Take all updates and clear the queue
		const updates = [...queue.updates];
		queue.updates = [];

		this._log('Parent consumed updates', {
			parentWorkerId,
			count: updates.length,
			updateTypes: updates.map(u => u.type),
			subTaskIds: updates.map(u => u.subTaskId),
		});
		return updates;
	}

	public peekUpdates(parentWorkerId: string): readonly ITaskUpdate[] {
		const queue = this._parentQueues.get(parentWorkerId);
		return queue?.updates ?? [];
	}

	public hasPendingUpdates(parentWorkerId: string): boolean {
		const queue = this._parentQueues.get(parentWorkerId);
		return queue ? queue.updates.length > 0 : false;
	}

	public getPendingUpdateCount(parentWorkerId: string): number {
		const queue = this._parentQueues.get(parentWorkerId);
		return queue?.updates.length ?? 0;
	}

	public queueUpdate(update: ITaskUpdate): void {
		this._log('queueUpdate called', {
			type: update.type,
			subTaskId: update.subTaskId,
			parentWorkerId: update.parentWorkerId,
			hasIdleReason: !!update.idleReason,
			hasProgressReport: !!update.progressReport,
			hasResult: !!update.result,
			hasError: !!update.error,
		});
		this._pushUpdate(update.parentWorkerId, update);
	}

	public queueErrorUpdate(
		subTaskId: string,
		parentWorkerId: string,
		error: string,
		errorType: ErrorType,
		retryInfo?: RetryInfo,
	): void {
		this._log('queueErrorUpdate called', {
			subTaskId,
			parentWorkerId,
			error,
			errorType,
			retryInfo: retryInfo ? {
				attempt: retryInfo.attempt,
				maxAttempts: retryInfo.maxAttempts,
				willRetry: retryInfo.willRetry,
				nextRetryInMs: retryInfo.nextRetryInMs,
			} : undefined,
		});

		const update: ITaskUpdate = {
			type: 'error',
			subTaskId,
			parentWorkerId,
			error,
			errorType,
			retryInfo,
			timestamp: Date.now(),
		};

		this._pushUpdate(parentWorkerId, update);
	}

	public getStats(): { monitoredTasks: number; registeredParents: number; totalQueuedUpdates: number } {
		let totalQueuedUpdates = 0;
		for (const queue of this._parentQueues.values()) {
			totalQueuedUpdates += queue.updates.length;
		}

		return {
			monitoredTasks: this._monitoredTasks.size,
			registeredParents: this._parentQueues.size,
			totalQueuedUpdates,
		};
	}

	// --- Private Methods ---

	private _unregisterParent(parentWorkerId: string): void {
		const queue = this._parentQueues.get(parentWorkerId);
		const droppedUpdates = queue?.updates.length ?? 0;
		this._parentQueues.delete(parentWorkerId);

		// Remove all monitored tasks for this parent
		const removedTasks: string[] = [];
		for (const [subTaskId, ownerId] of this._monitoredTasks) {
			if (ownerId === parentWorkerId) {
				this._monitoredTasks.delete(subTaskId);
				removedTasks.push(subTaskId);
			}
		}

		this._log('Unregistered parent', {
			parentWorkerId,
			droppedUpdates,
			removedTasks,
			remainingParents: this._parentQueues.size,
		});
	}

	private _startPolling(): void {
		this._pollHandle = setInterval(() => {
			this._pollMonitoredTasks();
		}, this._config.pollIntervalMs);

		this._register(toDisposable(() => {
			if (this._pollHandle) {
				clearInterval(this._pollHandle);
				this._pollHandle = undefined;
			}
		}));

		this._log('Started polling loop', { intervalMs: this._config.pollIntervalMs });
	}

	/**
	 * Poll all monitored tasks and queue updates for any that have changed status.
	 * This runs every pollIntervalMs.
	 */
	private _pollMonitoredTasks(): void {
		if (this._monitoredTasks.size === 0) {
			return;
		}

		this._log('Polling monitored tasks', { count: this._monitoredTasks.size });

		for (const [subTaskId, parentWorkerId] of this._monitoredTasks) {
			const subTask = this._subTaskManager.getSubTask(subTaskId);

			if (!subTask) {
				// Task no longer exists - clean up
				this._log('Monitored task no longer exists, removing', { subTaskId, parentWorkerId });
				this._monitoredTasks.delete(subTaskId);
				continue;
			}

			this._log('Polled task status', { subTaskId, parentWorkerId, status: subTask.status });

			// Check if task is in a terminal state and we haven't already processed it
			if (['completed', 'failed', 'cancelled'].includes(subTask.status)) {
				if (!this._processedTasks.has(subTaskId)) {
					this._log('Task reached terminal state (from polling)', { subTaskId, parentWorkerId, status: subTask.status });
					this._processedTasks.add(subTaskId);
					this._queueCompletionUpdate(subTask, parentWorkerId);
					this._monitoredTasks.delete(subTaskId);
				}
			}
		}
	}

	/**
	 * Handle immediate completion events from SubTaskManager.
	 * This provides faster updates than polling alone.
	 */
	private _handleSubTaskCompletion(subTask: ISubTask): void {
		const parentWorkerId = this._monitoredTasks.get(subTask.id);
		if (!parentWorkerId) {
			// Not a task we're monitoring
			this._log('Received completion for unmonitored task', { subTaskId: subTask.id, status: subTask.status });
			return;
		}

		// Check if we already processed this (from polling)
		if (this._processedTasks.has(subTask.id)) {
			this._log('Completion already processed (skipping duplicate)', { subTaskId: subTask.id, parentWorkerId });
			return;
		}

		this._log('Task reached terminal state (from event)', { subTaskId: subTask.id, parentWorkerId, status: subTask.status });
		this._processedTasks.add(subTask.id);
		this._queueCompletionUpdate(subTask, parentWorkerId);
		this._monitoredTasks.delete(subTask.id);
	}

	/**
	 * Queue a completion update for a subtask.
	 */
	private _queueCompletionUpdate(subTask: ISubTask, parentWorkerId: string): void {
		const updateType: TaskUpdateType = subTask.status === 'completed' ? 'completed' : 'failed';

		const update: ITaskUpdate = {
			type: updateType,
			subTaskId: subTask.id,
			parentWorkerId,
			result: subTask.result,
			error: subTask.result?.error,
			timestamp: Date.now(),
		};

		this._log('Queuing completion update', {
			type: updateType,
			subTaskId: subTask.id,
			parentWorkerId,
			hasResult: !!subTask.result,
			hasError: !!subTask.result?.error,
		});
		this._pushUpdate(parentWorkerId, update);
	}

	/**
	 * Push an update to a parent's queue.
	 */
	private _pushUpdate(parentWorkerId: string, update: ITaskUpdate): void {
		let queue = this._parentQueues.get(parentWorkerId);

		// Auto-register parent if not already registered
		if (!queue) {
			this._log('Auto-registering parent for update', { parentWorkerId, updateType: update.type });
			this.registerParent(parentWorkerId);
			queue = this._parentQueues.get(parentWorkerId)!;
		}

		// Check queue size limit
		if (queue.updates.length >= queue.maxSize) {
			const droppedUpdate = queue.updates[0];
			this._log('Queue full, dropping oldest update', {
				parentWorkerId,
				droppedType: droppedUpdate?.type,
				droppedSubTaskId: droppedUpdate?.subTaskId,
				maxSize: queue.maxSize,
			});
			queue.updates.shift();
		}

		queue.updates.push(update);

		this._log('Pushed update to parent queue', {
			parentWorkerId,
			type: update.type,
			subTaskId: update.subTaskId,
			queueLength: queue.updates.length,
		});

		// Fire event so listeners know updates are available
		this._onUpdatesAvailable.fire({
			parentWorkerId,
			count: queue.updates.length,
		});

		this._log('FIRED onUpdatesAvailable event', { parentWorkerId, count: queue.updates.length });
	}

	public override dispose(): void {
		this._parentQueues.clear();
		this._monitoredTasks.clear();
		this._processedTasks.clear();
		super.dispose();
	}
}
