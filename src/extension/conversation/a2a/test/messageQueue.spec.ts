/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../../../util/vs/base/common/lifecycle';
import { A2AMessageQueue, IA2AMessageQueue, IMessageQueueConfig } from '../messageQueue';
import { IAgentIdentifier, IStatusUpdateContent, MessagePriority } from '../messageTypes';

// Mock logger
class MockLogService {
	debug = vi.fn();
	info = vi.fn();
	warn = vi.fn();
	error = vi.fn();
	trace = vi.fn();
}

// Mock vscode.workspace
vi.mock('vscode', () => ({
	workspace: {
		workspaceFolders: undefined,
	},
}));

// Mock fs
vi.mock('fs', () => ({
	existsSync: vi.fn().mockReturnValue(false),
	writeFileSync: vi.fn(),
	readFileSync: vi.fn(),
}));

describe('A2AMessageQueue', () => {
	let queue: A2AMessageQueue;
	let logService: MockLogService;
	let testConfig: Partial<IMessageQueueConfig>;

	const createSender = (id: string = 'sender-1'): IAgentIdentifier => ({
		type: 'worker',
		id,
	});

	const createReceiver = (id: string = 'receiver-1'): IAgentIdentifier => ({
		type: 'orchestrator',
		id,
	});

	beforeEach(() => {
		logService = new MockLogService();
		testConfig = {
			maxQueueSize: 100,
			defaultTtl: 60000, // 1 minute for tests
			defaultTimeout: 5000,
			defaultRetryCount: 2,
			cleanupInterval: 60000,
			persistQueue: false, // Disable persistence for tests
		};
		queue = new A2AMessageQueue(logService as any, testConfig);
	});

	afterEach(() => {
		queue.dispose();
		vi.clearAllMocks();
	});

	describe('enqueue', () => {
		it('should enqueue a message with correct properties', () => {
			const sender = createSender();
			const receiver = createReceiver();

			const message = queue.enqueue({
				type: 'status_update',
				sender,
				receiver,
				content: {
					type: 'status_update',
					status: 'Working',
				},
			});

			expect(message.id).toBeDefined();
			expect(message.type).toBe('status_update');
			expect(message.priority).toBe('normal'); // Default priority
			expect(message.status).toBe('pending');
			expect(message.sender.id).toBe('sender-1');
			expect(message.receiver.id).toBe('receiver-1');
			expect(message.metadata.createdAt).toBeDefined();
			expect(message.metadata.deliveryAttempts).toBe(0);
		});

		it('should respect custom priority', () => {
			const message = queue.enqueue({
				type: 'error',
				priority: 'critical',
				sender: createSender(),
				receiver: createReceiver(),
				content: {
					type: 'error',
					code: 'ERR001',
					message: 'Critical error',
					recoverable: false,
				},
			});

			expect(message.priority).toBe('critical');
		});

		it('should fire onMessageEnqueued event', () => {
			const handler = vi.fn();
			queue.onMessageEnqueued(handler);

			queue.enqueue({
				type: 'status_update',
				sender: createSender(),
				receiver: createReceiver(),
				content: {
					type: 'status_update',
					status: 'Working',
				},
			});

			expect(handler).toHaveBeenCalledTimes(1);
		});

		it('should reject when queue is full', () => {
			const smallQueue = new A2AMessageQueue(logService as any, {
				...testConfig,
				maxQueueSize: 2,
			});

			smallQueue.enqueue({
				type: 'status_update',
				sender: createSender(),
				receiver: createReceiver(),
				content: { type: 'status_update', status: 'msg1' },
			});

			smallQueue.enqueue({
				type: 'status_update',
				sender: createSender(),
				receiver: createReceiver(),
				content: { type: 'status_update', status: 'msg2' },
			});

			expect(() => {
				smallQueue.enqueue({
					type: 'status_update',
					sender: createSender(),
					receiver: createReceiver(),
					content: { type: 'status_update', status: 'msg3' },
				});
			}).toThrow(/queue is full/i);

			smallQueue.dispose();
		});

		it('should include optional fields', () => {
			const message = queue.enqueue({
				type: 'completion',
				sender: createSender(),
				receiver: createReceiver(),
				content: {
					type: 'completion',
					success: true,
					output: 'Done',
				},
				planId: 'plan-123',
				taskId: 'task-456',
				subTaskId: 'subtask-789',
				depth: 2,
				correlationId: 'corr-001',
				traceId: 'trace-001',
			});

			expect(message.planId).toBe('plan-123');
			expect(message.taskId).toBe('task-456');
			expect(message.subTaskId).toBe('subtask-789');
			expect(message.depth).toBe(2);
			expect(message.metadata.correlationId).toBe('corr-001');
			expect(message.metadata.traceId).toBe('trace-001');
		});
	});

	describe('getPendingMessages', () => {
		it('should return pending messages for a specific agent', () => {
			queue.enqueue({
				type: 'status_update',
				sender: createSender(),
				receiver: createReceiver('agent-1'),
				content: { type: 'status_update', status: 'msg1' },
			});

			queue.enqueue({
				type: 'status_update',
				sender: createSender(),
				receiver: createReceiver('agent-2'),
				content: { type: 'status_update', status: 'msg2' },
			});

			queue.enqueue({
				type: 'status_update',
				sender: createSender(),
				receiver: createReceiver('agent-1'),
				content: { type: 'status_update', status: 'msg3' },
			});

			const pendingForAgent1 = queue.getPendingMessages('agent-1');
			const pendingForAgent2 = queue.getPendingMessages('agent-2');

			expect(pendingForAgent1).toHaveLength(2);
			expect(pendingForAgent2).toHaveLength(1);
		});

		it('should return empty array for unknown agent', () => {
			const pending = queue.getPendingMessages('unknown-agent');
			expect(pending).toHaveLength(0);
		});
	});

	describe('getAllMessages', () => {
		it('should return all messages in the queue', () => {
			queue.enqueue({
				type: 'status_update',
				sender: createSender(),
				receiver: createReceiver(),
				content: { type: 'status_update', status: 'msg1' },
			});

			queue.enqueue({
				type: 'completion',
				sender: createSender(),
				receiver: createReceiver(),
				content: { type: 'completion', success: true, output: 'done' },
			});

			const all = queue.getAllMessages();
			expect(all).toHaveLength(2);
		});
	});

	describe('getMessage', () => {
		it('should return message by ID', () => {
			const message = queue.enqueue({
				type: 'status_update',
				sender: createSender(),
				receiver: createReceiver(),
				content: { type: 'status_update', status: 'test' },
			});

			const retrieved = queue.getMessage(message.id);
			expect(retrieved).toBeDefined();
			expect(retrieved?.id).toBe(message.id);
		});

		it('should return undefined for unknown ID', () => {
			const retrieved = queue.getMessage('unknown-id');
			expect(retrieved).toBeUndefined();
		});
	});

	describe('cancelMessage', () => {
		it('should cancel a pending message', () => {
			const message = queue.enqueue({
				type: 'status_update',
				sender: createSender(),
				receiver: createReceiver(),
				content: { type: 'status_update', status: 'test' },
			});

			const cancelled = queue.cancelMessage(message.id);
			expect(cancelled).toBe(true);

			const pending = queue.getPendingMessages('receiver-1');
			expect(pending).toHaveLength(0);
		});

		it('should return false for unknown message', () => {
			const cancelled = queue.cancelMessage('unknown-id');
			expect(cancelled).toBe(false);
		});
	});

	describe('registerHandler', () => {
		it('should register a handler and return disposable', () => {
			const handler = vi.fn();
			const disposable = queue.registerHandler('test-agent', handler);

			expect(disposable).toBeDefined();
			expect(typeof disposable.dispose).toBe('function');

			disposable.dispose();
		});

		it('should process pending messages when handler is registered', async () => {
			const handler = vi.fn().mockResolvedValue(undefined);

			// Enqueue message before handler is registered
			queue.enqueue({
				type: 'status_update',
				sender: createSender(),
				receiver: createReceiver('test-agent'),
				content: { type: 'status_update', status: 'test' },
			});

			// Register handler
			queue.registerHandler('test-agent', handler);

			// Wait for async processing
			await new Promise(resolve => setTimeout(resolve, 50));

			expect(handler).toHaveBeenCalledTimes(1);
		});
	});

	describe('getMetrics', () => {
		it('should return queue metrics', () => {
			queue.enqueue({
				type: 'status_update',
				sender: createSender(),
				receiver: createReceiver(),
				content: { type: 'status_update', status: 'msg1' },
			});

			queue.enqueue({
				type: 'completion',
				priority: 'high',
				sender: createSender(),
				receiver: createReceiver(),
				content: { type: 'completion', success: true, output: 'done' },
			});

			const metrics = queue.getMetrics();

			expect(metrics.totalEnqueued).toBe(2);
			expect(metrics.queueDepth).toBe(2);
			expect(metrics.byPriority.high).toBe(1);
			expect(metrics.byPriority.normal).toBe(1);
		});
	});

	describe('priority ordering', () => {
		it('should process higher priority messages first', async () => {
			const processedOrder: string[] = [];
			const handler = vi.fn().mockImplementation(async (msg) => {
				processedOrder.push((msg.content as IStatusUpdateContent).status);
			});

			// Register handler first
			queue.registerHandler('test-agent', handler);

			// Enqueue in non-priority order
			queue.enqueue({
				type: 'status_update',
				priority: 'low',
				sender: createSender(),
				receiver: createReceiver('test-agent'),
				content: { type: 'status_update', status: 'low-msg' },
			});

			queue.enqueue({
				type: 'status_update',
				priority: 'critical',
				sender: createSender(),
				receiver: createReceiver('test-agent'),
				content: { type: 'status_update', status: 'critical-msg' },
			});

			queue.enqueue({
				type: 'status_update',
				priority: 'normal',
				sender: createSender(),
				receiver: createReceiver('test-agent'),
				content: { type: 'status_update', status: 'normal-msg' },
			});

			queue.enqueue({
				type: 'status_update',
				priority: 'high',
				sender: createSender(),
				receiver: createReceiver('test-agent'),
				content: { type: 'status_update', status: 'high-msg' },
			});

			// Wait for processing
			await new Promise(resolve => setTimeout(resolve, 100));

			// Should be processed in priority order: critical, high, normal, low
			expect(processedOrder).toEqual([
				'critical-msg',
				'high-msg',
				'normal-msg',
				'low-msg',
			]);
		});
	});

	describe('clear', () => {
		it('should clear all messages and reset metrics', () => {
			queue.enqueue({
				type: 'status_update',
				sender: createSender(),
				receiver: createReceiver(),
				content: { type: 'status_update', status: 'test' },
			});

			queue.clear();

			expect(queue.getAllMessages()).toHaveLength(0);
			expect(queue.getMetrics().totalEnqueued).toBe(0);
			expect(queue.getMetrics().queueDepth).toBe(0);
		});
	});

	describe('isMessageProcessed', () => {
		it('should track processed messages', async () => {
			const handler = vi.fn().mockResolvedValue(undefined);
			queue.registerHandler('test-agent', handler);

			const message = queue.enqueue({
				type: 'status_update',
				sender: createSender(),
				receiver: createReceiver('test-agent'),
				content: { type: 'status_update', status: 'test' },
			});

			// Not processed initially
			expect(queue.isMessageProcessed(message.id)).toBe(false);

			// Wait for processing
			await new Promise(resolve => setTimeout(resolve, 50));

			// Should be processed after delivery
			expect(queue.isMessageProcessed(message.id)).toBe(true);
		});
	});
});
