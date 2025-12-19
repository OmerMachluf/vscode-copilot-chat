/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../../util/vs/base/common/event';
import { ISubTask, ISubTaskManager, ISubTaskResult } from '../orchestratorInterfaces';
import { ITaskUpdate, TaskMonitorService, TaskUpdateType } from '../taskMonitorService';

/**
 * Mock SubTaskManager for testing TaskMonitorService
 */
class MockSubTaskManager implements Partial<ISubTaskManager> {
	readonly _serviceBrand: undefined;

	private _subTasks = new Map<string, ISubTask>();

	private readonly _onDidCompleteSubTask = new Emitter<ISubTask>();
	public readonly onDidCompleteSubTask = this._onDidCompleteSubTask.event;

	addSubTask(subTask: ISubTask): void {
		this._subTasks.set(subTask.id, subTask);
	}

	getSubTask(id: string): ISubTask | undefined {
		return this._subTasks.get(id);
	}

	updateSubTaskStatus(id: string, status: ISubTask['status'], result?: ISubTaskResult): void {
		const subTask = this._subTasks.get(id);
		if (subTask) {
			subTask.status = status;
			subTask.result = result;
			if (['completed', 'failed', 'cancelled'].includes(status)) {
				this._onDidCompleteSubTask.fire(subTask);
			}
		}
	}

	dispose(): void {
		this._onDidCompleteSubTask.dispose();
	}
}

/**
 * Mock LogService for testing
 */
class MockLogService {
	readonly _serviceBrand: undefined;
	trace = vi.fn();
	debug = vi.fn();
	info = vi.fn();
	warn = vi.fn();
	error = vi.fn();
}

describe('TaskMonitorService', () => {
	let taskMonitor: TaskMonitorService;
	let mockSubTaskManager: MockSubTaskManager;
	let mockLogService: MockLogService;

	beforeEach(() => {
		mockSubTaskManager = new MockSubTaskManager();
		mockLogService = new MockLogService();

		taskMonitor = new TaskMonitorService(
			mockSubTaskManager as unknown as ISubTaskManager,
			mockLogService as any,
			{ pollIntervalMs: 100, maxQueueSize: 50 }
		);
	});

	afterEach(() => {
		taskMonitor.dispose();
		mockSubTaskManager.dispose();
		vi.restoreAllMocks();
	});

	describe('queueUpdate (Error Updates)', () => {
		it('should correctly create and queue error updates with all fields', () => {
			const parentWorkerId = 'parent-worker-1';
			taskMonitor.registerParent(parentWorkerId);

			const errorUpdate: ITaskUpdate = {
				type: 'error',
				subTaskId: 'subtask-123',
				parentWorkerId,
				error: 'Rate limit exceeded: 429 Too Many Requests',
				timestamp: Date.now(),
			};

			taskMonitor.queueUpdate(errorUpdate);

			const updates = taskMonitor.consumeUpdates(parentWorkerId);
			expect(updates).toHaveLength(1);
			expect(updates[0].type).toBe('error');
			expect(updates[0].subTaskId).toBe('subtask-123');
			expect(updates[0].parentWorkerId).toBe(parentWorkerId);
			expect(updates[0].error).toBe('Rate limit exceeded: 429 Too Many Requests');
			expect(updates[0].timestamp).toBeDefined();
		});

		it('should queue error updates with optional result field', () => {
			const parentWorkerId = 'parent-worker-2';
			taskMonitor.registerParent(parentWorkerId);

			const errorUpdate: ITaskUpdate = {
				type: 'error',
				subTaskId: 'subtask-456',
				parentWorkerId,
				error: 'Network error: ECONNRESET',
				result: {
					taskId: 'subtask-456',
					status: 'failed',
					output: '',
					error: 'Network error: ECONNRESET',
				},
				timestamp: Date.now(),
			};

			taskMonitor.queueUpdate(errorUpdate);

			const updates = taskMonitor.consumeUpdates(parentWorkerId);
			expect(updates).toHaveLength(1);
			expect(updates[0].result).toBeDefined();
			expect(updates[0].result?.status).toBe('failed');
			expect(updates[0].result?.error).toBe('Network error: ECONNRESET');
		});

		it('should preserve all error fields through queue/retrieve cycle', () => {
			const parentWorkerId = 'parent-worker-3';
			taskMonitor.registerParent(parentWorkerId);

			const timestamp = Date.now();
			const errorUpdate: ITaskUpdate = {
				type: 'error' as TaskUpdateType,
				subTaskId: 'subtask-789',
				parentWorkerId,
				error: 'Fatal error: Out of memory',
				result: {
					taskId: 'subtask-789',
					status: 'failed',
					output: 'Partial output before crash',
					metadata: { retryCount: 3 },
					error: 'Fatal error: Out of memory',
				},
				progress: 75,
				progressReport: 'Processing step 3 of 4',
				timestamp,
			};

			taskMonitor.queueUpdate(errorUpdate);

			const updates = taskMonitor.consumeUpdates(parentWorkerId);
			expect(updates).toHaveLength(1);

			const retrieved = updates[0];
			expect(retrieved.type).toBe('error');
			expect(retrieved.subTaskId).toBe('subtask-789');
			expect(retrieved.parentWorkerId).toBe(parentWorkerId);
			expect(retrieved.error).toBe('Fatal error: Out of memory');
			expect(retrieved.result?.output).toBe('Partial output before crash');
			expect(retrieved.result?.metadata?.retryCount).toBe(3);
			expect(retrieved.progress).toBe(75);
			expect(retrieved.progressReport).toBe('Processing step 3 of 4');
			expect(retrieved.timestamp).toBe(timestamp);
		});
	});

	describe('Error update queue behavior', () => {
		it('should queue error updates and make them retrievable via getUpdates (peekUpdates)', () => {
			const parentWorkerId = 'parent-worker-4';
			taskMonitor.registerParent(parentWorkerId);

			const errorUpdate1: ITaskUpdate = {
				type: 'error',
				subTaskId: 'subtask-1',
				parentWorkerId,
				error: 'Error 1',
				timestamp: Date.now(),
			};

			const errorUpdate2: ITaskUpdate = {
				type: 'error',
				subTaskId: 'subtask-2',
				parentWorkerId,
				error: 'Error 2',
				timestamp: Date.now() + 1,
			};

			taskMonitor.queueUpdate(errorUpdate1);
			taskMonitor.queueUpdate(errorUpdate2);

			// peekUpdates should return all updates without consuming
			const peeked = taskMonitor.peekUpdates(parentWorkerId);
			expect(peeked).toHaveLength(2);

			// peekUpdates again should still return same updates
			const peekedAgain = taskMonitor.peekUpdates(parentWorkerId);
			expect(peekedAgain).toHaveLength(2);

			// consumeUpdates should return and clear
			const consumed = taskMonitor.consumeUpdates(parentWorkerId);
			expect(consumed).toHaveLength(2);
			expect(consumed[0].error).toBe('Error 1');
			expect(consumed[1].error).toBe('Error 2');

			// After consuming, queue should be empty
			expect(taskMonitor.peekUpdates(parentWorkerId)).toHaveLength(0);
		});

		it('should report pending updates correctly', () => {
			const parentWorkerId = 'parent-worker-5';
			taskMonitor.registerParent(parentWorkerId);

			expect(taskMonitor.hasPendingUpdates(parentWorkerId)).toBe(false);
			expect(taskMonitor.getPendingUpdateCount(parentWorkerId)).toBe(0);

			taskMonitor.queueUpdate({
				type: 'error',
				subTaskId: 'subtask-1',
				parentWorkerId,
				error: 'Test error',
				timestamp: Date.now(),
			});

			expect(taskMonitor.hasPendingUpdates(parentWorkerId)).toBe(true);
			expect(taskMonitor.getPendingUpdateCount(parentWorkerId)).toBe(1);

			taskMonitor.consumeUpdates(parentWorkerId);

			expect(taskMonitor.hasPendingUpdates(parentWorkerId)).toBe(false);
			expect(taskMonitor.getPendingUpdateCount(parentWorkerId)).toBe(0);
		});

		it('should auto-register parent when queueUpdate is called for unknown parent', () => {
			const parentWorkerId = 'auto-registered-parent';

			// Don't explicitly register - queueUpdate should auto-register
			taskMonitor.queueUpdate({
				type: 'error',
				subTaskId: 'subtask-1',
				parentWorkerId,
				error: 'Test error',
				timestamp: Date.now(),
			});

			expect(taskMonitor.hasPendingUpdates(parentWorkerId)).toBe(true);
			const updates = taskMonitor.consumeUpdates(parentWorkerId);
			expect(updates).toHaveLength(1);
		});
	});

	describe('onUpdatesAvailable event', () => {
		it('should fire onUpdatesAvailable when error update is queued', async () => {
			const parentWorkerId = 'parent-worker-6';
			taskMonitor.registerParent(parentWorkerId);

			const events: { parentWorkerId: string; count: number }[] = [];
			taskMonitor.onUpdatesAvailable(e => events.push(e));

			taskMonitor.queueUpdate({
				type: 'error',
				subTaskId: 'subtask-1',
				parentWorkerId,
				error: 'Rate limit error',
				timestamp: Date.now(),
			});

			// Event should fire immediately (synchronous)
			expect(events).toHaveLength(1);
			expect(events[0].parentWorkerId).toBe(parentWorkerId);
			expect(events[0].count).toBe(1);
		});

		it('should fire onUpdatesAvailable with correct count for multiple updates', () => {
			const parentWorkerId = 'parent-worker-7';
			taskMonitor.registerParent(parentWorkerId);

			const events: { parentWorkerId: string; count: number }[] = [];
			taskMonitor.onUpdatesAvailable(e => events.push(e));

			// Queue multiple updates
			taskMonitor.queueUpdate({
				type: 'error',
				subTaskId: 'subtask-1',
				parentWorkerId,
				error: 'Error 1',
				timestamp: Date.now(),
			});

			taskMonitor.queueUpdate({
				type: 'error',
				subTaskId: 'subtask-2',
				parentWorkerId,
				error: 'Error 2',
				timestamp: Date.now() + 1,
			});

			expect(events).toHaveLength(2);
			expect(events[0].count).toBe(1);
			expect(events[1].count).toBe(2);
		});
	});

	describe('Error type classification', () => {
		it('should handle rate limit errors', () => {
			const parentWorkerId = 'parent-rate-limit';
			taskMonitor.registerParent(parentWorkerId);

			taskMonitor.queueUpdate({
				type: 'error',
				subTaskId: 'subtask-rate',
				parentWorkerId,
				error: '429 Too Many Requests - Rate limit exceeded',
				timestamp: Date.now(),
			});

			const updates = taskMonitor.consumeUpdates(parentWorkerId);
			expect(updates[0].error).toContain('Rate limit');
		});

		it('should handle network errors', () => {
			const parentWorkerId = 'parent-network';
			taskMonitor.registerParent(parentWorkerId);

			taskMonitor.queueUpdate({
				type: 'error',
				subTaskId: 'subtask-network',
				parentWorkerId,
				error: 'ECONNRESET: Connection reset by peer',
				timestamp: Date.now(),
			});

			const updates = taskMonitor.consumeUpdates(parentWorkerId);
			expect(updates[0].error).toContain('ECONNRESET');
		});

		it('should handle fatal/timeout errors', () => {
			const parentWorkerId = 'parent-fatal';
			taskMonitor.registerParent(parentWorkerId);

			taskMonitor.queueUpdate({
				type: 'error',
				subTaskId: 'subtask-fatal',
				parentWorkerId,
				error: 'Fatal error: Worker exceeded maximum execution time',
				result: {
					taskId: 'subtask-fatal',
					status: 'timeout',
					output: '',
					error: 'Fatal error: Worker exceeded maximum execution time',
				},
				timestamp: Date.now(),
			});

			const updates = taskMonitor.consumeUpdates(parentWorkerId);
			expect(updates[0].error).toContain('Fatal error');
			expect(updates[0].result?.status).toBe('timeout');
		});
	});

	describe('Queue size limits', () => {
		it('should drop oldest updates when queue exceeds maxSize', () => {
			const parentWorkerId = 'parent-overflow';
			taskMonitor.registerParent(parentWorkerId);

			// Queue 55 updates (maxSize is 50)
			for (let i = 0; i < 55; i++) {
				taskMonitor.queueUpdate({
					type: 'error',
					subTaskId: `subtask-${i}`,
					parentWorkerId,
					error: `Error ${i}`,
					timestamp: Date.now() + i,
				});
			}

			const updates = taskMonitor.consumeUpdates(parentWorkerId);
			// Should only have 50 updates (oldest 5 dropped)
			expect(updates).toHaveLength(50);
			// First update should be subtask-5 (0-4 were dropped)
			expect(updates[0].subTaskId).toBe('subtask-5');
			// Last update should be subtask-54
			expect(updates[49].subTaskId).toBe('subtask-54');
		});
	});

	describe('Stats tracking', () => {
		it('should track queued updates in stats', () => {
			const parentWorkerId1 = 'parent-stats-1';
			const parentWorkerId2 = 'parent-stats-2';

			taskMonitor.registerParent(parentWorkerId1);
			taskMonitor.registerParent(parentWorkerId2);

			taskMonitor.queueUpdate({
				type: 'error',
				subTaskId: 'subtask-1',
				parentWorkerId: parentWorkerId1,
				error: 'Error 1',
				timestamp: Date.now(),
			});

			taskMonitor.queueUpdate({
				type: 'error',
				subTaskId: 'subtask-2',
				parentWorkerId: parentWorkerId1,
				error: 'Error 2',
				timestamp: Date.now(),
			});

			taskMonitor.queueUpdate({
				type: 'error',
				subTaskId: 'subtask-3',
				parentWorkerId: parentWorkerId2,
				error: 'Error 3',
				timestamp: Date.now(),
			});

			const stats = taskMonitor.getStats();
			expect(stats.registeredParents).toBe(2);
			expect(stats.totalQueuedUpdates).toBe(3);
		});
	});

	describe('SubTask completion with errors', () => {
		it('should queue failed update when subtask fails', async () => {
			const parentWorkerId = 'parent-completion';
			const subTaskId = 'subtask-fail-completion';

			taskMonitor.registerParent(parentWorkerId);
			taskMonitor.startMonitoring(subTaskId, parentWorkerId);

			// Create a failed subtask
			const failedSubTask: ISubTask = {
				id: subTaskId,
				parentWorkerId,
				parentTaskId: 'task-1',
				planId: 'plan-1',
				worktreePath: '/tmp/worktree',
				agentType: '@agent',
				prompt: 'Test prompt',
				expectedOutput: 'Test output',
				depth: 1,
				status: 'failed',
				result: {
					taskId: subTaskId,
					status: 'failed',
					output: '',
					error: 'Subtask execution failed',
				},
				createdAt: Date.now(),
			};

			mockSubTaskManager.addSubTask(failedSubTask);
			mockSubTaskManager.updateSubTaskStatus(subTaskId, 'failed', failedSubTask.result);

			// Allow time for event processing
			await new Promise(resolve => setTimeout(resolve, 10));

			const updates = taskMonitor.consumeUpdates(parentWorkerId);
			expect(updates.length).toBeGreaterThanOrEqual(1);

			const failedUpdate = updates.find(u => u.type === 'failed');
			expect(failedUpdate).toBeDefined();
			expect(failedUpdate?.subTaskId).toBe(subTaskId);
			expect(failedUpdate?.error).toBe('Subtask execution failed');
		});
	});

	describe('Mixed update types', () => {
		it('should handle mix of error and other update types correctly', () => {
			const parentWorkerId = 'parent-mixed';
			taskMonitor.registerParent(parentWorkerId);

			// Queue different types of updates
			taskMonitor.queueUpdate({
				type: 'progress',
				subTaskId: 'subtask-1',
				parentWorkerId,
				progress: 50,
				progressReport: 'Halfway done',
				timestamp: Date.now(),
			});

			taskMonitor.queueUpdate({
				type: 'error',
				subTaskId: 'subtask-2',
				parentWorkerId,
				error: 'Rate limit hit',
				timestamp: Date.now() + 1,
			});

			taskMonitor.queueUpdate({
				type: 'idle',
				subTaskId: 'subtask-3',
				parentWorkerId,
				idleReason: 'waiting_for_input',
				timestamp: Date.now() + 2,
			});

			taskMonitor.queueUpdate({
				type: 'error',
				subTaskId: 'subtask-4',
				parentWorkerId,
				error: 'Network timeout',
				timestamp: Date.now() + 3,
			});

			const updates = taskMonitor.consumeUpdates(parentWorkerId);
			expect(updates).toHaveLength(4);

			const errorUpdates = updates.filter(u => u.type === 'error');
			expect(errorUpdates).toHaveLength(2);
			expect(errorUpdates[0].error).toBe('Rate limit hit');
			expect(errorUpdates[1].error).toBe('Network timeout');

			const progressUpdate = updates.find(u => u.type === 'progress');
			expect(progressUpdate?.progress).toBe(50);

			const idleUpdate = updates.find(u => u.type === 'idle');
			expect(idleUpdate?.idleReason).toBe('waiting_for_input');
		});
	});
});
