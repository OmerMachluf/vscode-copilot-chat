/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { Emitter } from '../../../util/vs/base/common/event';
import { IAgentInstructionService } from '../agentInstructionService';
import { IAgentRunner } from '../agentRunner';
import { IOrchestratorPermissions } from '../orchestratorPermissions';
import { IOrchestratorQueueMessage, OrchestratorQueueService } from '../orchestratorQueue';
import { OrchestratorService } from '../orchestratorServiceV2';
import { WorkerSession } from '../workerSession';
import { IWorkerToolsService } from '../workerToolsService';

describe('Orchestrator Communication', () => {
	let orchestratorService: OrchestratorService;
	let queueService: OrchestratorQueueService;
	let permissionService: any;
	let agentInstructionService: IAgentInstructionService;
	let agentRunner: IAgentRunner;
	let workerToolsService: IWorkerToolsService;
	let subTaskManager: any;
	let logService: any;
	let mockVscodeWindow: any;

	beforeEach(() => {
		// Mock dependencies
		queueService = new OrchestratorQueueService();

		const defaultPermissions: IOrchestratorPermissions = {
			auto_approve: ['file_edits_in_worktree', 'subtask_spawning'],
			ask_user: ['pr_creation', 'branch_merge'],
			auto_deny: ['edits_outside_worktree'],
			limits: {
				max_subtask_depth: 2,
				max_subtasks_per_worker: 10,
				max_parallel_subtasks: 5,
				subtask_spawn_rate_limit: 20
			}
		};

		permissionService = {
			_serviceBrand: undefined,
			evaluatePermission: vi.fn().mockReturnValue('ask_user'),
			loadPermissions: vi.fn().mockResolvedValue(defaultPermissions),
			checkLimit: vi.fn().mockReturnValue(true),
			getPermissions: vi.fn().mockReturnValue(defaultPermissions),
			onDidChangePermissions: new Emitter().event,
		};

		agentInstructionService = {
			loadInstructions: vi.fn().mockResolvedValue({ instructions: [] }),
		} as any;

		agentRunner = {
			run: vi.fn(),
		} as any;

		workerToolsService = {
			createWorkerToolSet: vi.fn(),
			disposeWorkerToolSet: vi.fn(),
		} as any;

		subTaskManager = {
			_serviceBrand: undefined,
			createSubTask: vi.fn(),
			executeSubTask: vi.fn(),
			updateStatus: vi.fn(),
			getSubTask: vi.fn(),
			setOrchestratorService: vi.fn(),
		} as any;

		logService = {
			_serviceBrand: undefined,
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		} as any;

		mockVscodeWindow = {
			showInformationMessage: vi.fn(),
			showWarningMessage: vi.fn(),
		};

		// Mock VS Code
		vi.mock('vscode', () => ({
			workspace: {
				workspaceFolders: [{ uri: { fsPath: '/tmp/workspace' } }],
				onDidChangeConfiguration: vi.fn(),
				getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }),
			},
			window: mockVscodeWindow,
			Disposable: {
				from: (...disposables: any[]) => ({ dispose: () => disposables.forEach(d => d.dispose?.()) })
			},
			EventEmitter: class {
				event = () => { };
				fire = () => { };
				dispose = () => { };
			},
			Uri: {
				file: (path: string) => ({ fsPath: path }),
				parse: (path: string) => ({ fsPath: path }),
				joinPath: (base: any, ...segments: string[]) => ({ fsPath: base.fsPath + '/' + segments.join('/') }),
			},
			env: {
				openExternal: vi.fn(),
			},
		}));

		// Mock child_process for git detection
		vi.mock('child_process', () => ({
			exec: (cmd: string, opts: any, cb: any) => cb(null, 'refs/remotes/origin/main'),
			spawn: () => ({
				stdout: { on: () => { } },
				stderr: { on: () => { } },
				on: (event: string, cb: any) => { if (event === 'close') cb(0); }
			})
		}));

		// Mock fs
		vi.mock('fs', () => ({
			existsSync: () => false,
			writeFileSync: () => { },
			readFileSync: () => '{}',
			mkdirSync: () => { },
			rmSync: () => { },
		}));

		orchestratorService = new OrchestratorService(
			agentInstructionService,
			agentRunner,
			workerToolsService,
			queueService,
			subTaskManager,
			permissionService,
			logService
		);

		// Add a dummy task to allow processing
		(orchestratorService as any)._tasks.push({
			id: 'task-1',
			name: 'test-task',
			description: 'Test task',
			planId: 'plan-1',
			status: 'running',
			workerId: 'worker-1',
			dependencies: [],
			priority: 'normal',
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		orchestratorService.dispose();
	});

	describe('Worker Question Handling', () => {
		it('should add question to inbox when permission is ask_user', async () => {
			const message: IOrchestratorQueueMessage = {
				id: 'msg-1',
				timestamp: Date.now(),
				priority: 'normal',
				planId: 'plan-1',
				taskId: 'task-1',
				workerId: 'worker-1',
				worktreePath: '/tmp/worktree',
				type: 'question',
				content: 'Can I proceed with the refactoring?'
			};

			(permissionService.evaluatePermission as any).mockReturnValue('ask_user');

			queueService.enqueueMessage(message);
			await new Promise(resolve => setTimeout(resolve, 50));

			// Check the inbox has the item
			const pendingItems = orchestratorService.getInboxPendingItems();
			assert.strictEqual(pendingItems.length, 1);
			assert.strictEqual(pendingItems[0].message.type, 'question');
			assert.strictEqual(pendingItems[0].requiresUserAction, true);
		});

		it('should group inbox items by plan', async () => {
			const message1: IOrchestratorQueueMessage = {
				id: 'msg-1',
				timestamp: Date.now(),
				priority: 'normal',
				planId: 'plan-1',
				taskId: 'task-1',
				workerId: 'worker-1',
				worktreePath: '/tmp/worktree',
				type: 'question',
				content: 'Question 1'
			};

			const message2: IOrchestratorQueueMessage = {
				id: 'msg-2',
				timestamp: Date.now(),
				priority: 'normal',
				planId: 'plan-2',
				taskId: 'task-2',
				workerId: 'worker-2',
				worktreePath: '/tmp/worktree2',
				type: 'question',
				content: 'Question 2'
			};

			// Add second task for plan-2
			(orchestratorService as any)._tasks.push({
				id: 'task-2',
				name: 'test-task-2',
				description: 'Test task 2',
				planId: 'plan-2',
				status: 'running',
				workerId: 'worker-2',
				dependencies: [],
				priority: 'normal',
			});

			(permissionService.evaluatePermission as any).mockReturnValue('ask_user');

			queueService.enqueueMessage(message1);
			queueService.enqueueMessage(message2);
			await new Promise(resolve => setTimeout(resolve, 100));

			const plan1Items = orchestratorService.getInboxItemsByPlan('plan-1');
			const plan2Items = orchestratorService.getInboxItemsByPlan('plan-2');

			assert.strictEqual(plan1Items.length, 1);
			assert.strictEqual(plan2Items.length, 1);
			assert.strictEqual(plan1Items[0].message.content, 'Question 1');
			assert.strictEqual(plan2Items[0].message.content, 'Question 2');
		});
	});

	describe('Permission Request Auto-Response', () => {
		it('should auto-approve permission request when in auto_approve list', async () => {
			const message: IOrchestratorQueueMessage = {
				id: 'msg-2',
				timestamp: Date.now(),
				priority: 'normal',
				planId: 'plan-1',
				taskId: 'task-1',
				workerId: 'worker-1',
				worktreePath: '/tmp/worktree',
				type: 'permission_request',
				content: { permission: 'file_edits_in_worktree', id: 'approval-1' }
			};

			(permissionService.evaluatePermission as any).mockReturnValue('auto_approve');

			queueService.enqueueMessage(message);
			await new Promise(resolve => setTimeout(resolve, 50));

			// Should NOT be in inbox (auto-approved)
			const pendingItems = orchestratorService.getInboxPendingItems();
			assert.strictEqual(pendingItems.length, 0);
		});

		it('should auto-deny permission request when in auto_deny list', async () => {
			const message: IOrchestratorQueueMessage = {
				id: 'msg-3',
				timestamp: Date.now(),
				priority: 'normal',
				planId: 'plan-1',
				taskId: 'task-1',
				workerId: 'worker-1',
				worktreePath: '/tmp/worktree',
				type: 'permission_request',
				content: { permission: 'edits_outside_worktree', id: 'approval-2' }
			};

			(permissionService.evaluatePermission as any).mockReturnValue('auto_deny');

			queueService.enqueueMessage(message);
			await new Promise(resolve => setTimeout(resolve, 50));

			// Should NOT be in inbox (auto-denied)
			const pendingItems = orchestratorService.getInboxPendingItems();
			assert.strictEqual(pendingItems.length, 0);
		});

		it('should add permission request to inbox when in ask_user list', async () => {
			const message: IOrchestratorQueueMessage = {
				id: 'msg-4',
				timestamp: Date.now(),
				priority: 'normal',
				planId: 'plan-1',
				taskId: 'task-1',
				workerId: 'worker-1',
				worktreePath: '/tmp/worktree',
				type: 'permission_request',
				content: { permission: 'pr_creation', id: 'approval-3' }
			};

			(permissionService.evaluatePermission as any).mockReturnValue('ask_user');

			queueService.enqueueMessage(message);
			await new Promise(resolve => setTimeout(resolve, 50));

			const pendingItems = orchestratorService.getInboxPendingItems();
			assert.strictEqual(pendingItems.length, 1);
			assert.strictEqual(pendingItems[0].message.type, 'permission_request');
		});
	});

	describe('Status Update Handling', () => {
		it('should log status updates correctly', async () => {
			const message: IOrchestratorQueueMessage = {
				id: 'msg-5',
				timestamp: Date.now(),
				priority: 'low',
				planId: 'plan-1',
				taskId: 'task-1',
				workerId: 'worker-1',
				worktreePath: '/tmp/worktree',
				type: 'status_update',
				content: 'idle'
			};

			let idleEventFired = false;
			orchestratorService.onOrchestratorEvent(event => {
				if (event.type === 'worker.idle') {
					idleEventFired = true;
				}
			});

			queueService.enqueueMessage(message);
			await new Promise(resolve => setTimeout(resolve, 50));

			assert.strictEqual(idleEventFired, true);
		});
	});

	describe('Inbox Item Processing', () => {
		it('should process inbox item and mark as processed', async () => {
			const message: IOrchestratorQueueMessage = {
				id: 'msg-6',
				timestamp: Date.now(),
				priority: 'normal',
				planId: 'plan-1',
				taskId: 'task-1',
				workerId: 'worker-1',
				worktreePath: '/tmp/worktree',
				type: 'question',
				content: 'Should I continue?'
			};

			(permissionService.evaluatePermission as any).mockReturnValue('ask_user');

			queueService.enqueueMessage(message);
			await new Promise(resolve => setTimeout(resolve, 50));

			const pendingBefore = orchestratorService.getInboxPendingItems();
			assert.strictEqual(pendingBefore.length, 1);

			const itemId = pendingBefore[0].id;
			orchestratorService.processInboxItem(itemId, 'Yes, please continue');

			const pendingAfter = orchestratorService.getInboxPendingItems();
			assert.strictEqual(pendingAfter.length, 0);
		});

		it('should defer inbox item correctly', async () => {
			const message: IOrchestratorQueueMessage = {
				id: 'msg-7',
				timestamp: Date.now(),
				priority: 'normal',
				planId: 'plan-1',
				taskId: 'task-1',
				workerId: 'worker-1',
				worktreePath: '/tmp/worktree',
				type: 'question',
				content: 'Need input on architecture'
			};

			(permissionService.evaluatePermission as any).mockReturnValue('ask_user');

			queueService.enqueueMessage(message);
			await new Promise(resolve => setTimeout(resolve, 50));

			const pendingBefore = orchestratorService.getInboxPendingItems();
			const itemId = pendingBefore[0].id;

			orchestratorService.deferInboxItem(itemId, 'Will review later');

			const pendingAfter = orchestratorService.getInboxPendingItems();
			assert.strictEqual(pendingAfter.length, 0);
		});
	});

	describe('Task Completion via Queue', () => {
		it('should mark task as completed when completion message is received', async () => {
			const message: IOrchestratorQueueMessage = {
				id: 'msg-8',
				timestamp: Date.now(),
				priority: 'normal',
				planId: 'plan-1',
				taskId: 'task-1',
				workerId: 'worker-1',
				worktreePath: '/tmp/worktree',
				type: 'completion',
				content: { sessionUri: 'orchestrator:/task-1' }
			};

			let completedEventFired = false;
			orchestratorService.onOrchestratorEvent(event => {
				if (event.type === 'task.completed' && event.taskId === 'task-1') {
					completedEventFired = true;
				}
			});

			queueService.enqueueMessage(message);
			await new Promise(resolve => setTimeout(resolve, 50));

			assert.strictEqual(completedEventFired, true);
			const task = orchestratorService.getTaskById('task-1');
			assert.strictEqual(task?.status, 'completed');
		});

		it('should mark task as failed when error message is received', async () => {
			const message: IOrchestratorQueueMessage = {
				id: 'msg-9',
				timestamp: Date.now(),
				priority: 'high',
				planId: 'plan-1',
				taskId: 'task-1',
				workerId: 'worker-1',
				worktreePath: '/tmp/worktree',
				type: 'error',
				content: 'Task failed due to compilation errors'
			};

			let failedEventFired = false;
			orchestratorService.onOrchestratorEvent(event => {
				if (event.type === 'task.failed' && event.taskId === 'task-1') {
					failedEventFired = true;
				}
			});

			queueService.enqueueMessage(message);
			await new Promise(resolve => setTimeout(resolve, 50));

			assert.strictEqual(failedEventFired, true);
			const task = orchestratorService.getTaskById('task-1');
			assert.strictEqual(task?.status, 'failed');
			assert.strictEqual(task?.error, 'Task failed due to compilation errors');
		});
	});
});

describe('WorkerSession Conversation Threading', () => {
	it('should create and manage conversation threads', () => {
		const session = new WorkerSession(
			'test-worker',
			'Test task',
			'/tmp/worktree',
			'plan-1',
			'main',
			'agent'
		);

		// Start a conversation thread
		const thread = session.startConversationThread('Architecture decision');
		assert.ok(thread.id);
		assert.strictEqual(thread.topic, 'Architecture decision');
		assert.strictEqual(thread.status, 'active');
		assert.strictEqual(thread.messages.length, 0);

		// Add messages to the thread
		const msg1 = session.addThreadMessage(thread.id, 'worker', 'Should we use microservices?');
		assert.ok(msg1);
		assert.strictEqual(msg1.sender, 'worker');

		const msg2 = session.addThreadMessage(thread.id, 'orchestrator', 'Yes, proceed with microservices.');
		assert.ok(msg2);
		assert.strictEqual(msg2.sender, 'orchestrator');

		// Verify thread has messages
		const retrievedThread = session.getConversationThread(thread.id);
		assert.strictEqual(retrievedThread?.messages.length, 2);

		// Resolve the thread
		session.resolveConversationThread(thread.id);
		assert.strictEqual(session.getConversationThread(thread.id)?.status, 'resolved');

		session.dispose();
	});

	it('should track multiple conversation threads', () => {
		const session = new WorkerSession(
			'test-worker',
			'Test task',
			'/tmp/worktree',
			'plan-1'
		);

		const thread1 = session.startConversationThread('Topic 1');
		const thread2 = session.startConversationThread('Topic 2');

		session.addThreadMessage(thread1.id, 'worker', 'Message in thread 1');
		session.addThreadMessage(thread2.id, 'worker', 'Message in thread 2');

		const allThreads = session.getConversationThreads();
		assert.strictEqual(allThreads.length, 2);

		const activeThreads = session.getActiveConversationThreads();
		assert.strictEqual(activeThreads.length, 2);

		session.resolveConversationThread(thread1.id);
		const activeAfterResolve = session.getActiveConversationThreads();
		assert.strictEqual(activeAfterResolve.length, 1);

		session.dispose();
	});

	it('should not add messages to resolved threads', () => {
		const session = new WorkerSession(
			'test-worker',
			'Test task',
			'/tmp/worktree'
		);

		const thread = session.startConversationThread('Test topic');
		session.addThreadMessage(thread.id, 'worker', 'First message');
		session.resolveConversationThread(thread.id);

		const result = session.addThreadMessage(thread.id, 'worker', 'Should not be added');
		assert.strictEqual(result, undefined);

		const retrievedThread = session.getConversationThread(thread.id);
		assert.strictEqual(retrievedThread?.messages.length, 1);

		session.dispose();
	});
});