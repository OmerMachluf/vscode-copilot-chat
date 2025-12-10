/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DisposableStore } from '../../../util/vs/base/common/lifecycle';
import {
	hashPrompt,
	ISubTaskAncestry,
	ITokenUsage,
	SafetyLimitsService,
} from '../safetyLimits';
import { ISubTaskCreateOptions, SubTaskManager } from '../subTaskManager';

// ============================================================================
// Mock Services
// ============================================================================

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

// ============================================================================
// SafetyLimitsService Tests
// ============================================================================

describe('SafetyLimitsService', () => {
	let disposables: DisposableStore;
	let safetyLimitsService: SafetyLimitsService;
	let mockLogService: ReturnType<typeof createMockLogService>;

	beforeEach(() => {
		disposables = new DisposableStore();
		mockLogService = createMockLogService();
		safetyLimitsService = new SafetyLimitsService(mockLogService as any);
		disposables.add(safetyLimitsService);
	});

	describe('enforceDepthLimit', () => {
		it('should allow spawning within depth limit', () => {
			expect(() => safetyLimitsService.enforceDepthLimit(0)).not.toThrow();
			expect(() => safetyLimitsService.enforceDepthLimit(1)).not.toThrow();
		});

		it('should throw when depth limit exceeded', () => {
			expect(() => safetyLimitsService.enforceDepthLimit(2)).toThrow(/depth limit.*exceeded/i);
			expect(() => safetyLimitsService.enforceDepthLimit(3)).toThrow(/depth limit.*exceeded/i);
		});

		it('should respect custom max depth', () => {
			expect(() => safetyLimitsService.enforceDepthLimit(2, 3)).not.toThrow();
			expect(() => safetyLimitsService.enforceDepthLimit(3, 3)).toThrow(/depth limit.*exceeded/i);
		});

		it('should include clear error message', () => {
			try {
				safetyLimitsService.enforceDepthLimit(2);
				expect.fail('Should have thrown');
			} catch (error) {
				expect((error as Error).message).toContain('Cannot spawn deeper');
				expect((error as Error).message).toContain('restructuring');
			}
		});
	});

	describe('detectCycle', () => {
		it('should return false for empty ancestry', () => {
			expect(safetyLimitsService.detectCycle('sub-1', [])).toBe(false);
		});

		it('should return false for linear ancestry', () => {
			const ancestry: ISubTaskAncestry[] = [
				{ subTaskId: 'sub-1', workerId: 'w1', planId: 'p1', agentType: '@architect', promptHash: 'a1' },
				{ subTaskId: 'sub-2', workerId: 'w1', planId: 'p1', agentType: '@reviewer', promptHash: 'r1' },
			];
			expect(safetyLimitsService.detectCycle('sub-3', ancestry)).toBe(false);
		});

		it('should detect cycle when same agent+prompt appears twice', () => {
			const ancestry: ISubTaskAncestry[] = [
				{ subTaskId: 'sub-1', workerId: 'w1', planId: 'p1', agentType: '@architect', promptHash: 'a1' },
				{ subTaskId: 'sub-2', workerId: 'w1', planId: 'p1', agentType: '@reviewer', promptHash: 'r1' },
				{ subTaskId: 'sub-3', workerId: 'w1', planId: 'p1', agentType: '@architect', promptHash: 'a1' }, // cycle!
			];
			expect(safetyLimitsService.detectCycle('sub-4', ancestry)).toBe(true);
		});

		it('should detect direct ID cycles', () => {
			const ancestry: ISubTaskAncestry[] = [
				{ subTaskId: 'sub-1', workerId: 'w1', planId: 'p1', agentType: '@architect', promptHash: 'a1' },
				{ subTaskId: 'sub-2', workerId: 'w1', planId: 'p1', agentType: '@reviewer', promptHash: 'r1' },
				{ subTaskId: 'sub-1', workerId: 'w1', planId: 'p1', agentType: '@agent', promptHash: 'x1' }, // ID cycle!
			];
			expect(safetyLimitsService.detectCycle('sub-3', ancestry)).toBe(true);
		});

		it('should log warning when cycle detected', () => {
			const ancestry: ISubTaskAncestry[] = [
				{ subTaskId: 'sub-1', workerId: 'w1', planId: 'p1', agentType: '@architect', promptHash: 'a1' },
				{ subTaskId: 'sub-2', workerId: 'w1', planId: 'p1', agentType: '@architect', promptHash: 'a1' },
			];
			safetyLimitsService.detectCycle('sub-3', ancestry);
			expect(mockLogService.warn).toHaveBeenCalled();
		});
	});

	describe('rate limiting', () => {
		it('should allow spawns within rate limit', () => {
			for (let i = 0; i < 19; i++) {
				safetyLimitsService.recordSpawn('worker-1');
			}
			expect(safetyLimitsService.checkRateLimit('worker-1')).toBe(true);
		});

		it('should block spawns exceeding rate limit', () => {
			for (let i = 0; i < 20; i++) {
				safetyLimitsService.recordSpawn('worker-1');
			}
			expect(safetyLimitsService.checkRateLimit('worker-1')).toBe(false);
		});

		it('should track spawns per worker independently', () => {
			for (let i = 0; i < 20; i++) {
				safetyLimitsService.recordSpawn('worker-1');
			}
			expect(safetyLimitsService.checkRateLimit('worker-1')).toBe(false);
			expect(safetyLimitsService.checkRateLimit('worker-2')).toBe(true);
		});

		it('should log warning when rate limit exceeded', () => {
			for (let i = 0; i < 20; i++) {
				safetyLimitsService.recordSpawn('worker-1');
			}
			safetyLimitsService.checkRateLimit('worker-1');
			expect(mockLogService.warn).toHaveBeenCalledWith(
				expect.stringContaining('Rate limit exceeded')
			);
		});
	});

	describe('total limit', () => {
		it('should allow within total limit', () => {
			expect(safetyLimitsService.checkTotalLimit('worker-1', 9)).toBe(true);
		});

		it('should block when total limit exceeded', () => {
			expect(safetyLimitsService.checkTotalLimit('worker-1', 10)).toBe(false);
			expect(safetyLimitsService.checkTotalLimit('worker-1', 15)).toBe(false);
		});
	});

	describe('parallel limit', () => {
		it('should allow within parallel limit', () => {
			expect(safetyLimitsService.checkParallelLimit('worker-1', 4)).toBe(true);
		});

		it('should block when parallel limit exceeded', () => {
			expect(safetyLimitsService.checkParallelLimit('worker-1', 5)).toBe(false);
			expect(safetyLimitsService.checkParallelLimit('worker-1', 10)).toBe(false);
		});
	});

	describe('cost tracking', () => {
		it('should track sub-task cost', () => {
			const usage: ITokenUsage = {
				promptTokens: 1000,
				completionTokens: 500,
				totalTokens: 1500,
			};

			safetyLimitsService.trackSubTaskCost('sub-1', usage, 'gpt-4o');

			const cost = safetyLimitsService.getSubTaskCost('sub-1');
			expect(cost).toBeDefined();
			expect(cost?.tokensUsed).toBe(1500);
			expect(cost?.model).toBe('gpt-4o');
			expect(cost?.estimatedCost).toBeGreaterThan(0);
		});

		it('should calculate cost based on model', () => {
			const usage: ITokenUsage = {
				promptTokens: 1000,
				completionTokens: 1000,
				totalTokens: 2000,
			};

			// gpt-4o: $0.005/1K input, $0.015/1K output
			// Expected: (1000/1000)*0.005 + (1000/1000)*0.015 = 0.005 + 0.015 = 0.02
			safetyLimitsService.trackSubTaskCost('sub-1', usage, 'gpt-4o');

			const cost = safetyLimitsService.getSubTaskCost('sub-1');
			expect(cost?.estimatedCost).toBeCloseTo(0.02, 4);
		});

		it('should aggregate cost for worker', () => {
			// Register ancestry to associate sub-tasks with worker
			safetyLimitsService.registerAncestry({
				subTaskId: 'sub-1', workerId: 'worker-1', planId: 'p1', agentType: '@agent', promptHash: 'h1',
			});
			safetyLimitsService.registerAncestry({
				subTaskId: 'sub-2', workerId: 'worker-1', planId: 'p1', agentType: '@agent', promptHash: 'h2',
			});

			const usage1: ITokenUsage = { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 };
			const usage2: ITokenUsage = { promptTokens: 2000, completionTokens: 1000, totalTokens: 3000 };

			safetyLimitsService.trackSubTaskCost('sub-1', usage1, 'gpt-4o');
			safetyLimitsService.trackSubTaskCost('sub-2', usage2, 'gpt-4o');

			const totalCost = safetyLimitsService.getTotalCostForWorker('worker-1');
			expect(totalCost).toBeGreaterThan(0);

			const entries = safetyLimitsService.getCostEntriesForWorker('worker-1');
			expect(entries).toHaveLength(2);
		});
	});

	describe('emergency stop', () => {
		beforeEach(() => {
			// Register some ancestry
			safetyLimitsService.registerAncestry({
				subTaskId: 'sub-1', workerId: 'worker-1', planId: 'plan-1', agentType: '@agent', promptHash: 'h1',
			});
			safetyLimitsService.registerAncestry({
				subTaskId: 'sub-2', workerId: 'worker-1', planId: 'plan-1', agentType: '@agent', promptHash: 'h2',
			});
			safetyLimitsService.registerAncestry({
				subTaskId: 'sub-3', workerId: 'worker-2', planId: 'plan-1', agentType: '@agent', promptHash: 'h3',
			});
			safetyLimitsService.registerAncestry({
				subTaskId: 'sub-4', workerId: 'worker-3', planId: 'plan-2', agentType: '@agent', promptHash: 'h4',
			});
		});

		it('should stop single sub-task', async () => {
			const result = await safetyLimitsService.emergencyStop({
				scope: 'subtask',
				targetId: 'sub-1',
				reason: 'Test stop',
			});

			expect(result.subTasksKilled).toBe(1);
			expect(result.killedSubTaskIds).toContain('sub-1');
		});

		it('should stop all sub-tasks for worker', async () => {
			const result = await safetyLimitsService.emergencyStop({
				scope: 'worker',
				targetId: 'worker-1',
				reason: 'Test stop',
			});

			expect(result.subTasksKilled).toBe(2);
			expect(result.killedSubTaskIds).toContain('sub-1');
			expect(result.killedSubTaskIds).toContain('sub-2');
		});

		it('should stop all sub-tasks for plan', async () => {
			const result = await safetyLimitsService.emergencyStop({
				scope: 'plan',
				targetId: 'plan-1',
				reason: 'Test stop',
			});

			expect(result.subTasksKilled).toBe(3);
			expect(result.killedSubTaskIds).toContain('sub-1');
			expect(result.killedSubTaskIds).toContain('sub-2');
			expect(result.killedSubTaskIds).toContain('sub-3');
		});

		it('should stop all sub-tasks globally', async () => {
			const result = await safetyLimitsService.emergencyStop({
				scope: 'global',
				reason: 'Test stop',
			});

			expect(result.subTasksKilled).toBe(4);
		});

		it('should fire onEmergencyStop event', async () => {
			const handler = vi.fn();
			disposables.add(safetyLimitsService.onEmergencyStop(handler));

			await safetyLimitsService.emergencyStop({
				scope: 'global',
				reason: 'Test stop',
			});

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					scope: 'global',
					reason: 'Test stop',
				})
			);
		});

		it('should log warning on emergency stop', async () => {
			await safetyLimitsService.emergencyStop({
				scope: 'global',
				reason: 'Test stop',
			});

			expect(mockLogService.warn).toHaveBeenCalledWith(
				expect.stringContaining('Emergency stop initiated')
			);
		});
	});

	describe('config updates', () => {
		it('should update config', () => {
			safetyLimitsService.updateConfig({
				maxSubTaskDepth: 5,
				subTaskSpawnRateLimit: 50,
			});

			const config = safetyLimitsService.config;
			expect(config.maxSubTaskDepth).toBe(5);
			expect(config.subTaskSpawnRateLimit).toBe(50);
			// Other values should remain default
			expect(config.maxSubTasksPerWorker).toBe(10);
		});
	});

	describe('resetWorkerTracking', () => {
		it('should clear all tracking for worker', () => {
			// Set up tracking
			safetyLimitsService.registerAncestry({
				subTaskId: 'sub-1', workerId: 'worker-1', planId: 'p1', agentType: '@agent', promptHash: 'h1',
			});
			safetyLimitsService.recordSpawn('worker-1');
			safetyLimitsService.trackSubTaskCost('sub-1', { promptTokens: 100, completionTokens: 50, totalTokens: 150 }, 'gpt-4o');

			// Reset
			safetyLimitsService.resetWorkerTracking('worker-1');

			// Verify cleared
			expect(safetyLimitsService.getAncestryChain('sub-1')).toHaveLength(0);
			expect(safetyLimitsService.getTotalCostForWorker('worker-1')).toBe(0);
			expect(safetyLimitsService.checkRateLimit('worker-1')).toBe(true);
		});
	});
});

// ============================================================================
// hashPrompt Tests
// ============================================================================

describe('hashPrompt', () => {
	it('should return same hash for identical prompts', () => {
		const hash1 = hashPrompt('Design the API');
		const hash2 = hashPrompt('Design the API');
		expect(hash1).toBe(hash2);
	});

	it('should return same hash regardless of whitespace', () => {
		const hash1 = hashPrompt('Design   the   API');
		const hash2 = hashPrompt('Design the API');
		expect(hash1).toBe(hash2);
	});

	it('should return same hash regardless of case', () => {
		const hash1 = hashPrompt('Design the API');
		const hash2 = hashPrompt('DESIGN THE API');
		expect(hash1).toBe(hash2);
	});

	it('should return different hash for different prompts', () => {
		const hash1 = hashPrompt('Design the API');
		const hash2 = hashPrompt('Review the code');
		expect(hash1).not.toBe(hash2);
	});
});

// ============================================================================
// SubTaskManager with SafetyLimitsService Integration Tests
// ============================================================================

describe('SubTaskManager with Safety Limits', () => {
	let disposables: DisposableStore;
	let subTaskManager: SubTaskManager;
	let safetyLimitsService: SafetyLimitsService;
	let mockAgentRunner: ReturnType<typeof createMockAgentRunner>;
	let mockWorkerToolsService: ReturnType<typeof createMockWorkerToolsService>;
	let mockLogService: ReturnType<typeof createMockLogService>;

	const createOptions = (overrides: Partial<ISubTaskCreateOptions> = {}): ISubTaskCreateOptions => ({
		parentWorkerId: 'worker-1',
		parentTaskId: 'task-1',
		planId: 'plan-1',
		worktreePath: '/test/worktree',
		agentType: '@agent',
		prompt: 'Test task',
		expectedOutput: 'Test output',
		currentDepth: 0,
		...overrides,
	});

	beforeEach(() => {
		disposables = new DisposableStore();
		mockAgentRunner = createMockAgentRunner();
		mockWorkerToolsService = createMockWorkerToolsService();
		mockLogService = createMockLogService();
		safetyLimitsService = new SafetyLimitsService(mockLogService as any);
		disposables.add(safetyLimitsService);

		subTaskManager = new SubTaskManager(
			mockAgentRunner as any,
			mockWorkerToolsService as any,
			mockLogService as any,
			safetyLimitsService as any,
		);
		disposables.add(subTaskManager);
	});

	describe('depth limit enforcement', () => {
		it('should create sub-task at valid depth', () => {
			const subTask = subTaskManager.createSubTask(createOptions({ currentDepth: 0 }));
			expect(subTask.depth).toBe(1);
		});

		it('should throw when depth limit exceeded', () => {
			expect(() => subTaskManager.createSubTask(createOptions({ currentDepth: 2 })))
				.toThrow(/depth limit.*exceeded/i);
		});

		it('should provide clear error message on depth limit', () => {
			try {
				subTaskManager.createSubTask(createOptions({ currentDepth: 2 }));
				expect.fail('Should have thrown');
			} catch (error) {
				expect((error as Error).message).toContain('Cannot spawn deeper');
			}
		});
	});

	describe('cycle detection', () => {
		it('should create sub-task when no cycle', () => {
			const subTask1 = subTaskManager.createSubTask(createOptions({
				prompt: 'First task',
				agentType: '@architect',
			}));

			const subTask2 = subTaskManager.createSubTask(createOptions({
				prompt: 'Second task',
				agentType: '@reviewer',
				parentSubTaskId: subTask1.id,
				currentDepth: 1,
			}));

			expect(subTask2).toBeDefined();
		});

		it('should block when cycle detected', () => {
			// Create first sub-task
			const subTask1 = subTaskManager.createSubTask(createOptions({
				prompt: 'Design API',
				agentType: '@architect',
			}));

			// Try to create a sub-task with same agent+prompt (cycle)
			expect(() => subTaskManager.createSubTask(createOptions({
				prompt: 'Design API', // Same prompt
				agentType: '@architect', // Same agent
				parentSubTaskId: subTask1.id,
				currentDepth: 1,
			}))).toThrow(/cycle detected/i);
		});
	});

	describe('rate limiting', () => {
		it('should allow spawns within rate limit', () => {
			// Spawn 19 sub-tasks (under limit of 20)
			for (let i = 0; i < 19; i++) {
				subTaskManager.createSubTask(createOptions({ prompt: `Task ${i}` }));
			}

			// 20th should still work
			const subTask = subTaskManager.createSubTask(createOptions({ prompt: 'Task 20' }));
			expect(subTask).toBeDefined();
		});

		it('should block when rate limit exceeded', () => {
			// Spawn 20 sub-tasks (at limit)
			for (let i = 0; i < 20; i++) {
				subTaskManager.createSubTask(createOptions({ prompt: `Task ${i}` }));
			}

			// 21st should fail
			expect(() => subTaskManager.createSubTask(createOptions({ prompt: 'Task 21' })))
				.toThrow(/rate limit exceeded/i);
		});

		it('should suggest waiting in error message', () => {
			for (let i = 0; i < 20; i++) {
				subTaskManager.createSubTask(createOptions({ prompt: `Task ${i}` }));
			}

			try {
				subTaskManager.createSubTask(createOptions({ prompt: 'Over limit' }));
				expect.fail('Should have thrown');
			} catch (error) {
				expect((error as Error).message).toContain('wait');
			}
		});
	});

	describe('total sub-task limit', () => {
		it('should block when total limit exceeded', () => {
			// Create 10 sub-tasks (at limit)
			for (let i = 0; i < 10; i++) {
				subTaskManager.createSubTask(createOptions({
					prompt: `Task ${i}`,
					agentType: `@agent${i}`, // Different agents to avoid cycle detection
				}));
			}

			// 11th should fail
			expect(() => subTaskManager.createSubTask(createOptions({
				prompt: 'Over limit',
				agentType: '@agent99',
			}))).toThrow(/total sub-task limit exceeded/i);
		});
	});

	describe('parallel sub-task limit', () => {
		it('should block when parallel limit exceeded', () => {
			// Create 5 sub-tasks and set them to running
			for (let i = 0; i < 5; i++) {
				const subTask = subTaskManager.createSubTask(createOptions({
					prompt: `Task ${i}`,
					agentType: `@agent${i}`,
				}));
				subTaskManager.updateStatus(subTask.id, 'running');
			}

			// 6th should fail
			expect(() => subTaskManager.createSubTask(createOptions({
				prompt: 'Over limit',
				agentType: '@agent99',
			}))).toThrow(/parallel sub-task limit exceeded/i);
		});

		it('should allow more sub-tasks when some complete', () => {
			// Create and start 5 sub-tasks
			const subTasks: any[] = [];
			for (let i = 0; i < 5; i++) {
				const subTask = subTaskManager.createSubTask(createOptions({
					prompt: `Task ${i}`,
					agentType: `@agent${i}`,
				}));
				subTaskManager.updateStatus(subTask.id, 'running');
				subTasks.push(subTask);
			}

			// Complete one
			subTaskManager.updateStatus(subTasks[0].id, 'completed');

			// Should now be able to create another
			const newSubTask = subTaskManager.createSubTask(createOptions({
				prompt: 'New task',
				agentType: '@agent99',
			}));
			expect(newSubTask).toBeDefined();
		});
	});

	describe('emergency stop', () => {
		it('should cancel all sub-tasks on global emergency stop', async () => {
			// Create several sub-tasks
			const subTask1 = subTaskManager.createSubTask(createOptions({ prompt: 'Task 1', agentType: '@agent1' }));
			const subTask2 = subTaskManager.createSubTask(createOptions({ prompt: 'Task 2', agentType: '@agent2' }));
			subTaskManager.updateStatus(subTask1.id, 'running');
			subTaskManager.updateStatus(subTask2.id, 'running');

			// Emergency stop
			const result = await subTaskManager.emergencyStop({
				scope: 'global',
				reason: 'Test emergency',
			});

			expect(result.subTasksKilled).toBeGreaterThan(0);

			// Verify sub-tasks are cancelled
			const st1 = subTaskManager.getSubTask(subTask1.id);
			const st2 = subTaskManager.getSubTask(subTask2.id);
			expect(st1?.status).toBe('cancelled');
			expect(st2?.status).toBe('cancelled');
		});

		it('should cancel only worker sub-tasks on worker emergency stop', async () => {
			// Create sub-tasks for different workers
			const subTask1 = subTaskManager.createSubTask(createOptions({
				prompt: 'Task 1',
				agentType: '@agent1',
				parentWorkerId: 'worker-1',
			}));
			const subTask2 = subTaskManager.createSubTask(createOptions({
				prompt: 'Task 2',
				agentType: '@agent2',
				parentWorkerId: 'worker-2',
			}));
			subTaskManager.updateStatus(subTask1.id, 'running');
			subTaskManager.updateStatus(subTask2.id, 'running');

			// Emergency stop for worker-1 only
			await subTaskManager.emergencyStop({
				scope: 'worker',
				targetId: 'worker-1',
				reason: 'Test emergency',
			});

			// Verify only worker-1's sub-task is cancelled
			const st1 = subTaskManager.getSubTask(subTask1.id);
			const st2 = subTaskManager.getSubTask(subTask2.id);
			expect(st1?.status).toBe('cancelled');
			expect(st2?.status).toBe('running'); // Should still be running
		});
	});

	describe('cost tracking', () => {
		it('should track sub-task cost', () => {
			const subTask = subTaskManager.createSubTask(createOptions());

			subTaskManager.trackSubTaskCost(subTask.id, {
				promptTokens: 1000,
				completionTokens: 500,
				totalTokens: 1500,
			}, 'gpt-4o');

			const cost = subTaskManager.getSubTaskCost(subTask.id);
			expect(cost).toBeDefined();
			expect(cost?.tokensUsed).toBe(1500);
		});

		it('should aggregate worker cost', () => {
			const subTask1 = subTaskManager.createSubTask(createOptions({ prompt: 'Task 1', agentType: '@agent1' }));
			const subTask2 = subTaskManager.createSubTask(createOptions({ prompt: 'Task 2', agentType: '@agent2' }));

			subTaskManager.trackSubTaskCost(subTask1.id, {
				promptTokens: 1000,
				completionTokens: 500,
				totalTokens: 1500,
			}, 'gpt-4o');

			subTaskManager.trackSubTaskCost(subTask2.id, {
				promptTokens: 2000,
				completionTokens: 1000,
				totalTokens: 3000,
			}, 'gpt-4o');

			const totalCost = subTaskManager.getTotalCostForWorker('worker-1');
			expect(totalCost).toBeGreaterThan(0);
		});
	});

	describe('configurable limits', () => {
		it('should use updated limits', () => {
			subTaskManager.updateSafetyLimits({
				maxSubTaskDepth: 5,
			});

			// Should now allow depth 3
			const subTask = subTaskManager.createSubTask(createOptions({ currentDepth: 3 }));
			expect(subTask.depth).toBe(4);
		});

		it('should expose current limits', () => {
			const limits = subTaskManager.safetyLimits;
			expect(limits.maxSubTaskDepth).toBe(2);
			expect(limits.maxSubTasksPerWorker).toBe(10);
			expect(limits.maxParallelSubTasks).toBe(5);
			expect(limits.subTaskSpawnRateLimit).toBe(20);
		});
	});

	describe('worker tracking reset', () => {
		it('should clear all tracking on worker reset', () => {
			// Create sub-tasks
			subTaskManager.createSubTask(createOptions({ prompt: 'Task 1', agentType: '@agent1' }));
			subTaskManager.createSubTask(createOptions({ prompt: 'Task 2', agentType: '@agent2' }));

			// Reset worker tracking
			subTaskManager.resetWorkerTracking('worker-1');

			// Sub-tasks should be cleared
			const subTasks = subTaskManager.getSubTasksForWorker('worker-1');
			expect(subTasks).toHaveLength(0);
		});
	});

	describe('getRunningSubTasksCount', () => {
		it('should count only running sub-tasks', () => {
			const subTask1 = subTaskManager.createSubTask(createOptions({ prompt: 'Task 1', agentType: '@agent1' }));
			const subTask2 = subTaskManager.createSubTask(createOptions({ prompt: 'Task 2', agentType: '@agent2' }));
			const subTask3 = subTaskManager.createSubTask(createOptions({ prompt: 'Task 3', agentType: '@agent3' }));

			subTaskManager.updateStatus(subTask1.id, 'running');
			subTaskManager.updateStatus(subTask2.id, 'running');
			subTaskManager.updateStatus(subTask3.id, 'completed');

			expect(subTaskManager.getRunningSubTasksCount('worker-1')).toBe(2);
		});
	});

	describe('getTotalSubTasksCount', () => {
		it('should count all sub-tasks for worker', () => {
			subTaskManager.createSubTask(createOptions({ prompt: 'Task 1', agentType: '@agent1' }));
			subTaskManager.createSubTask(createOptions({ prompt: 'Task 2', agentType: '@agent2' }));
			subTaskManager.createSubTask(createOptions({ prompt: 'Task 3', agentType: '@agent3' }));

			expect(subTaskManager.getTotalSubTasksCount('worker-1')).toBe(3);
		});
	});
});
