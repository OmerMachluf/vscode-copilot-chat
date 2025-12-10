/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DisposableStore } from '../../../util/vs/base/common/lifecycle';
import { ISubTaskCreateOptions, ISubTaskResult, SubTaskManager } from '../subTaskManager';

// Mock services
const createMockLogService = () => ({
	_serviceBrand: undefined,
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	trace: vi.fn(),
});

const createMockAgentRunner = () => ({
	_serviceBrand: undefined,
	run: vi.fn().mockResolvedValue({
		success: true,
		response: 'Sub-task completed successfully',
		metadata: {},
	}),
});

const createMockWorkerToolsService = () => ({
	_serviceBrand: undefined,
	createWorkerToolSet: vi.fn().mockReturnValue({
		scopedInstantiationService: {},
		worktreePath: '/test/worktree',
		dispose: vi.fn(),
	}),
	getWorkerToolSet: vi.fn(),
	disposeWorkerToolSet: vi.fn(),
	getWorktreeForPath: vi.fn(),
	getActiveWorktrees: vi.fn().mockReturnValue([]),
	onDidCreateToolSet: { event: vi.fn() },
	onDidDisposeToolSet: { event: vi.fn() },
});


const createMockSafetyLimitsService = () => ({
	_serviceBrand: undefined,
	config: {
		maxSubTaskDepth: 2,
		maxSubTasksPerWorker: 10,
		maxParallelSubTasks: 5,
		subTaskSpawnRateLimit: 20,
	},
	onEmergencyStop: vi.fn(() => ({ dispose: () => {} })),
	// Methods required by SubTaskManager.createSubTask
	enforceDepthLimit: vi.fn(), // Does nothing by default, can be configured to throw
	checkRateLimit: vi.fn().mockReturnValue(true),
	checkTotalLimit: vi.fn().mockReturnValue(true),
	checkParallelLimit: vi.fn().mockReturnValue(true),
	getAncestryChain: vi.fn().mockReturnValue([]),
	detectCycle: vi.fn().mockReturnValue(false),
	registerAncestry: vi.fn(),
	recordSpawn: vi.fn(),
	clearAncestry: vi.fn(),
	// Cost tracking methods
	trackSubTaskCost: vi.fn(),
	getTotalCostForWorker: vi.fn().mockReturnValue(0),
	getSubTaskCost: vi.fn().mockReturnValue(undefined),
	getCostEntriesForWorker: vi.fn().mockReturnValue([]),
	// Emergency stop
	emergencyStop: vi.fn().mockResolvedValue({ subTasksKilled: 0, killedSubTaskIds: [], timestamp: Date.now(), reason: '' }),
	// Configuration
	updateConfig: vi.fn(),
	resetWorkerTracking: vi.fn(),
});

describe('SubTaskManager', () => {
	let disposables: DisposableStore;
	let subTaskManager: SubTaskManager;
	let mockAgentRunner: ReturnType<typeof createMockAgentRunner>;
	let mockWorkerToolsService: ReturnType<typeof createMockWorkerToolsService>;
	let mockLogService: ReturnType<typeof createMockLogService>;
	let mockSafetyLimitsService: ReturnType<typeof createMockSafetyLimitsService>;

	beforeEach(() => {
		disposables = new DisposableStore();
		mockAgentRunner = createMockAgentRunner();
		mockWorkerToolsService = createMockWorkerToolsService();
		mockLogService = createMockLogService();
		mockSafetyLimitsService = createMockSafetyLimitsService();

		subTaskManager = new SubTaskManager(
			mockAgentRunner as any,
			mockWorkerToolsService as any,
			mockLogService as any,
			mockSafetyLimitsService as any,
		);
		disposables.add(subTaskManager);
	});

	describe('createSubTask', () => {
		it('should create a sub-task with correct properties', () => {
			const options: ISubTaskCreateOptions = {
				parentWorkerId: 'worker-1',
				parentTaskId: 'task-1',
				planId: 'plan-1',
				worktreePath: '/test/worktree',
				agentType: '@architect',
				prompt: 'Design the API',
				expectedOutput: 'API design document',
				currentDepth: 0,
			};

			const subTask = subTaskManager.createSubTask(options);

			expect(subTask).toBeDefined();
			expect(subTask.id).toMatch(/^subtask-/);
			expect(subTask.parentWorkerId).toBe('worker-1');
			expect(subTask.parentTaskId).toBe('task-1');
			expect(subTask.planId).toBe('plan-1');
			expect(subTask.worktreePath).toBe('/test/worktree');
			expect(subTask.agentType).toBe('@architect');
			expect(subTask.prompt).toBe('Design the API');
			expect(subTask.expectedOutput).toBe('API design document');
			expect(subTask.depth).toBe(1); // currentDepth (0) + 1
			expect(subTask.status).toBe('pending');
			expect(subTask.createdAt).toBeDefined();
		});

		it('should increment depth correctly', () => {
			const options: ISubTaskCreateOptions = {
				parentWorkerId: 'worker-1',
				parentTaskId: 'task-1',
				planId: 'plan-1',
				worktreePath: '/test/worktree',
				agentType: '@reviewer',
				prompt: 'Review code',
				expectedOutput: 'Review feedback',
				currentDepth: 1, // Already at depth 1
			};

			const subTask = subTaskManager.createSubTask(options);
			expect(subTask.depth).toBe(2); // currentDepth (1) + 1
		});

		it('should enforce depth limit', () => {
			// Configure mock to throw when depth limit is exceeded
			mockSafetyLimitsService.enforceDepthLimit.mockImplementation((parentDepth: number) => {
				if (parentDepth >= 2) {
					throw new Error('Depth limit exceeded: cannot spawn sub-task beyond maximum depth');
				}
			});

			const options: ISubTaskCreateOptions = {
				parentWorkerId: 'worker-1',
				parentTaskId: 'task-1',
				planId: 'plan-1',
				worktreePath: '/test/worktree',
				agentType: '@agent',
				prompt: 'Do something',
				expectedOutput: 'Result',
				currentDepth: 2, // At max depth
			};

			expect(() => subTaskManager.createSubTask(options)).toThrow(/depth limit exceeded/i);
		});

		it('should track target files', () => {
			const options: ISubTaskCreateOptions = {
				parentWorkerId: 'worker-1',
				parentTaskId: 'task-1',
				planId: 'plan-1',
				worktreePath: '/test/worktree',
				agentType: '@agent',
				prompt: 'Modify files',
				expectedOutput: 'Modified files',
				currentDepth: 0,
				targetFiles: ['src/file1.ts', 'src/file2.ts'],
			};

			const subTask = subTaskManager.createSubTask(options);
			expect(subTask.targetFiles).toEqual(['src/file1.ts', 'src/file2.ts']);
		});
	});

	describe('getSubTask', () => {
		it('should retrieve a created sub-task', () => {
			const options: ISubTaskCreateOptions = {
				parentWorkerId: 'worker-1',
				parentTaskId: 'task-1',
				planId: 'plan-1',
				worktreePath: '/test/worktree',
				agentType: '@architect',
				prompt: 'Design',
				expectedOutput: 'Design doc',
				currentDepth: 0,
			};

			const created = subTaskManager.createSubTask(options);
			const retrieved = subTaskManager.getSubTask(created.id);

			expect(retrieved).toBe(created);
		});

		it('should return undefined for non-existent task', () => {
			const result = subTaskManager.getSubTask('non-existent');
			expect(result).toBeUndefined();
		});
	});

	describe('getSubTasksForWorker', () => {
		it('should return all sub-tasks for a worker', () => {
			// Create sub-tasks for worker-1
			subTaskManager.createSubTask({
				parentWorkerId: 'worker-1',
				parentTaskId: 'task-1',
				planId: 'plan-1',
				worktreePath: '/test/worktree',
				agentType: '@architect',
				prompt: 'Task 1',
				expectedOutput: 'Output 1',
				currentDepth: 0,
			});

			subTaskManager.createSubTask({
				parentWorkerId: 'worker-1',
				parentTaskId: 'task-1',
				planId: 'plan-1',
				worktreePath: '/test/worktree',
				agentType: '@reviewer',
				prompt: 'Task 2',
				expectedOutput: 'Output 2',
				currentDepth: 0,
			});

			// Create sub-task for worker-2
			subTaskManager.createSubTask({
				parentWorkerId: 'worker-2',
				parentTaskId: 'task-2',
				planId: 'plan-1',
				worktreePath: '/test/worktree2',
				agentType: '@agent',
				prompt: 'Task 3',
				expectedOutput: 'Output 3',
				currentDepth: 0,
			});

			const worker1Tasks = subTaskManager.getSubTasksForWorker('worker-1');
			const worker2Tasks = subTaskManager.getSubTasksForWorker('worker-2');

			expect(worker1Tasks).toHaveLength(2);
			expect(worker2Tasks).toHaveLength(1);
		});
	});

	describe('updateStatus', () => {
		it('should update sub-task status', () => {
			const subTask = subTaskManager.createSubTask({
				parentWorkerId: 'worker-1',
				parentTaskId: 'task-1',
				planId: 'plan-1',
				worktreePath: '/test/worktree',
				agentType: '@agent',
				prompt: 'Task',
				expectedOutput: 'Output',
				currentDepth: 0,
			});

			subTaskManager.updateStatus(subTask.id, 'running');

			const updated = subTaskManager.getSubTask(subTask.id);
			expect(updated?.status).toBe('running');
		});

		it('should set completedAt when status is terminal', () => {
			const subTask = subTaskManager.createSubTask({
				parentWorkerId: 'worker-1',
				parentTaskId: 'task-1',
				planId: 'plan-1',
				worktreePath: '/test/worktree',
				agentType: '@agent',
				prompt: 'Task',
				expectedOutput: 'Output',
				currentDepth: 0,
			});

			const result: ISubTaskResult = {
				taskId: subTask.id,
				status: 'success',
				output: 'Done',
			};

			subTaskManager.updateStatus(subTask.id, 'completed', result);

			const updated = subTaskManager.getSubTask(subTask.id);
			expect(updated?.status).toBe('completed');
			expect(updated?.completedAt).toBeDefined();
			expect(updated?.result).toEqual(result);
		});

		it('should fire onDidChangeSubTask event', () => {
			const handler = vi.fn();
			disposables.add(subTaskManager.onDidChangeSubTask(handler));

			const subTask = subTaskManager.createSubTask({
				parentWorkerId: 'worker-1',
				parentTaskId: 'task-1',
				planId: 'plan-1',
				worktreePath: '/test/worktree',
				agentType: '@agent',
				prompt: 'Task',
				expectedOutput: 'Output',
				currentDepth: 0,
			});

			// Handler is called on creation too
			expect(handler).toHaveBeenCalled();
			handler.mockClear();

			subTaskManager.updateStatus(subTask.id, 'running');

			expect(handler).toHaveBeenCalledWith(expect.objectContaining({
				id: subTask.id,
				status: 'running',
			}));
		});

		it('should fire onDidCompleteSubTask for terminal states', () => {
			const handler = vi.fn();
			disposables.add(subTaskManager.onDidCompleteSubTask(handler));

			const subTask = subTaskManager.createSubTask({
				parentWorkerId: 'worker-1',
				parentTaskId: 'task-1',
				planId: 'plan-1',
				worktreePath: '/test/worktree',
				agentType: '@agent',
				prompt: 'Task',
				expectedOutput: 'Output',
				currentDepth: 0,
			});

			subTaskManager.updateStatus(subTask.id, 'completed');

			expect(handler).toHaveBeenCalledWith(expect.objectContaining({
				id: subTask.id,
				status: 'completed',
			}));
		});
	});

	describe('checkFileConflicts', () => {
		it('should detect no conflicts when no tasks are running', () => {
			const conflicts = subTaskManager.checkFileConflicts(['src/file.ts']);
			expect(conflicts).toHaveLength(0);
		});

		it('should detect conflicts with running tasks', () => {
			const subTask = subTaskManager.createSubTask({
				parentWorkerId: 'worker-1',
				parentTaskId: 'task-1',
				planId: 'plan-1',
				worktreePath: '/test/worktree',
				agentType: '@agent',
				prompt: 'Modify file',
				expectedOutput: 'Output',
				currentDepth: 0,
				targetFiles: ['src/file.ts'],
			});

			// Set to running
			subTaskManager.updateStatus(subTask.id, 'running');

			const conflicts = subTaskManager.checkFileConflicts(['src/file.ts']);
			expect(conflicts).toContain(subTask.id);
		});

		it('should not detect conflicts with completed tasks', () => {
			const subTask = subTaskManager.createSubTask({
				parentWorkerId: 'worker-1',
				parentTaskId: 'task-1',
				planId: 'plan-1',
				worktreePath: '/test/worktree',
				agentType: '@agent',
				prompt: 'Modify file',
				expectedOutput: 'Output',
				currentDepth: 0,
				targetFiles: ['src/file.ts'],
			});

			subTaskManager.updateStatus(subTask.id, 'completed');

			const conflicts = subTaskManager.checkFileConflicts(['src/file.ts']);
			expect(conflicts).toHaveLength(0);
		});

		it('should handle case-insensitive path matching', () => {
			const subTask = subTaskManager.createSubTask({
				parentWorkerId: 'worker-1',
				parentTaskId: 'task-1',
				planId: 'plan-1',
				worktreePath: '/test/worktree',
				agentType: '@agent',
				prompt: 'Modify file',
				expectedOutput: 'Output',
				currentDepth: 0,
				targetFiles: ['SRC/File.ts'],
			});

			subTaskManager.updateStatus(subTask.id, 'running');

			const conflicts = subTaskManager.checkFileConflicts(['src/file.ts']);
			expect(conflicts).toContain(subTask.id);
		});

		it('should exclude specified task from conflict check', () => {
			const subTask = subTaskManager.createSubTask({
				parentWorkerId: 'worker-1',
				parentTaskId: 'task-1',
				planId: 'plan-1',
				worktreePath: '/test/worktree',
				agentType: '@agent',
				prompt: 'Modify file',
				expectedOutput: 'Output',
				currentDepth: 0,
				targetFiles: ['src/file.ts'],
			});

			subTaskManager.updateStatus(subTask.id, 'running');

			// Exclude self from check
			const conflicts = subTaskManager.checkFileConflicts(['src/file.ts'], subTask.id);
			expect(conflicts).toHaveLength(0);
		});
	});

	describe('cancelSubTask', () => {
		it('should cancel a running sub-task', () => {
			const subTask = subTaskManager.createSubTask({
				parentWorkerId: 'worker-1',
				parentTaskId: 'task-1',
				planId: 'plan-1',
				worktreePath: '/test/worktree',
				agentType: '@agent',
				prompt: 'Task',
				expectedOutput: 'Output',
				currentDepth: 0,
			});

			subTaskManager.updateStatus(subTask.id, 'running');
			subTaskManager.cancelSubTask(subTask.id);

			const updated = subTaskManager.getSubTask(subTask.id);
			expect(updated?.status).toBe('cancelled');
			expect(updated?.result?.status).toBe('failed');
			expect(updated?.result?.error).toContain('cancelled');
		});
	});

	describe('getTaskDepth', () => {
		it('should return depth for existing sub-task', () => {
			const subTask = subTaskManager.createSubTask({
				parentWorkerId: 'worker-1',
				parentTaskId: 'task-1',
				planId: 'plan-1',
				worktreePath: '/test/worktree',
				agentType: '@agent',
				prompt: 'Task',
				expectedOutput: 'Output',
				currentDepth: 1,
			});

			const depth = subTaskManager.getTaskDepth(subTask.id);
			expect(depth).toBe(2); // currentDepth (1) + 1
		});

		it('should return 0 for non-existent task (main task)', () => {
			const depth = subTaskManager.getTaskDepth('non-existent');
			expect(depth).toBe(0);
		});
	});

	describe('maxDepth', () => {
		it('should have maxDepth of 2', () => {
			expect(subTaskManager.maxDepth).toBe(2);
		});
	});
});
