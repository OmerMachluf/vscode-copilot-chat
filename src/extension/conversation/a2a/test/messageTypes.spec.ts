/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
	deserializeMessage,
	IA2AMessage,
	IAgentIdentifier,
	isCompletionContent,
	isStatusUpdateContent,
	MessagePriority,
	MessageStatus,
	serializeMessage,
} from '../messageTypes';

describe('messageTypes', () => {
	describe('serializeMessage', () => {
		it('should serialize a message correctly', () => {
			const message: IA2AMessage = {
				id: 'test-id',
				type: 'status_update',
				priority: 'normal',
				status: 'pending',
				sender: { type: 'worker', id: 'worker-1' },
				receiver: { type: 'orchestrator', id: 'orchestrator-1' },
				content: {
					type: 'status_update',
					status: 'Working on task',
					progress: 50,
				},
				metadata: {
					createdAt: 1000,
					deliveryAttempts: 0,
				},
				deliveryOptions: {
					timeout: 30000,
					retryCount: 3,
				},
				planId: 'plan-1',
				taskId: 'task-1',
			};

			const serialized = serializeMessage(message);

			expect(serialized.id).toBe('test-id');
			expect(serialized.type).toBe('status_update');
			expect(serialized.priority).toBe('normal');
			expect(serialized.sender.id).toBe('worker-1');
			expect(serialized.receiver.id).toBe('orchestrator-1');
			expect(serialized.planId).toBe('plan-1');
		});

		it('should handle optional fields', () => {
			const message: IA2AMessage = {
				id: 'test-id',
				type: 'completion',
				priority: 'high',
				status: 'delivered',
				sender: { type: 'agent', id: 'agent-1' },
				receiver: { type: 'worker', id: 'worker-1' },
				content: {
					type: 'completion',
					success: true,
					output: 'Task completed',
				},
				metadata: {
					createdAt: 1000,
					deliveryAttempts: 1,
					deliveredAt: 2000,
				},
				deliveryOptions: {},
			};

			const serialized = serializeMessage(message);

			expect(serialized.planId).toBeUndefined();
			expect(serialized.taskId).toBeUndefined();
			expect(serialized.subTaskId).toBeUndefined();
		});
	});

	describe('deserializeMessage', () => {
		it('should deserialize a message correctly', () => {
			const serialized = {
				id: 'test-id',
				type: 'status_update' as const,
				priority: 'normal' as MessagePriority,
				status: 'pending' as MessageStatus,
				sender: { type: 'worker' as const, id: 'worker-1' },
				receiver: { type: 'orchestrator' as const, id: 'orchestrator-1' },
				content: {
					type: 'status_update' as const,
					status: 'Working',
				},
				metadata: {
					createdAt: 1000,
					deliveryAttempts: 0,
				},
				deliveryOptions: {
					timeout: 30000,
				},
			};

			const message = deserializeMessage(serialized);

			expect(message.id).toBe('test-id');
			expect(message.type).toBe('status_update');
			expect(message.sender.id).toBe('worker-1');
			expect(isStatusUpdateContent(message.content)).toBe(true);
		});

		it('should handle round-trip serialization', () => {
			const original: IA2AMessage = {
				id: 'round-trip-id',
				type: 'completion',
				priority: 'high',
				status: 'acknowledged',
				sender: { type: 'agent', id: 'agent-1', worktreePath: '/path/to/worktree' },
				receiver: { type: 'worker', id: 'worker-1' },
				content: {
					type: 'completion',
					success: true,
					output: 'Done',
					modifiedFiles: ['file1.ts', 'file2.ts'],
				},
				metadata: {
					createdAt: 1000,
					deliveryAttempts: 2,
					deliveredAt: 2000,
					acknowledgedAt: 3000,
					correlationId: 'corr-1',
					traceId: 'trace-1',
				},
				deliveryOptions: {
					timeout: 60000,
					retryCount: 5,
					requireAck: true,
					ttl: 300000,
				},
				planId: 'plan-1',
				taskId: 'task-1',
				subTaskId: 'subtask-1',
				depth: 2,
			};

			const serialized = serializeMessage(original);
			const deserialized = deserializeMessage(serialized);

			expect(deserialized.id).toBe(original.id);
			expect(deserialized.type).toBe(original.type);
			expect(deserialized.priority).toBe(original.priority);
			expect(deserialized.status).toBe(original.status);
			expect(deserialized.sender.id).toBe(original.sender.id);
			expect(deserialized.sender.worktreePath).toBe(original.sender.worktreePath);
			expect(deserialized.metadata.correlationId).toBe(original.metadata.correlationId);
			expect(deserialized.deliveryOptions.requireAck).toBe(original.deliveryOptions.requireAck);
			expect(deserialized.depth).toBe(original.depth);
		});
	});

	describe('type guards', () => {
		it('isStatusUpdateContent should identify status updates', () => {
			const statusContent = {
				type: 'status_update' as const,
				status: 'Working',
				progress: 50,
			};

			const completionContent = {
				type: 'completion' as const,
				success: true,
				output: 'Done',
			};

			expect(isStatusUpdateContent(statusContent)).toBe(true);
			expect(isStatusUpdateContent(completionContent)).toBe(false);
		});

		it('isCompletionContent should identify completions', () => {
			const completionContent = {
				type: 'completion' as const,
				success: true,
				output: 'Done',
			};

			const statusContent = {
				type: 'status_update' as const,
				status: 'Working',
			};

			expect(isCompletionContent(completionContent)).toBe(true);
			expect(isCompletionContent(statusContent)).toBe(false);
		});
	});

	describe('IAgentIdentifier', () => {
		it('should support all agent types', () => {
			const orchestrator: IAgentIdentifier = {
				type: 'orchestrator',
				id: 'main-orchestrator',
			};

			const worker: IAgentIdentifier = {
				type: 'worker',
				id: 'worker-1',
				worktreePath: '/path/to/worktree',
			};

			const agent: IAgentIdentifier = {
				type: 'agent',
				id: 'agent-1',
				sessionUri: 'vscode://session/123',
			};

			expect(orchestrator.type).toBe('orchestrator');
			expect(worker.worktreePath).toBe('/path/to/worktree');
			expect(agent.sessionUri).toBe('vscode://session/123');
		});
	});

	describe('MessagePriority', () => {
		it('should support all priority levels', () => {
			const priorities: MessagePriority[] = ['critical', 'high', 'normal', 'low'];
			expect(priorities).toHaveLength(4);
		});
	});

	describe('MessageStatus', () => {
		it('should support all status values', () => {
			const statuses: MessageStatus[] = ['pending', 'delivered', 'acknowledged', 'failed', 'expired'];
			expect(statuses).toHaveLength(5);
		});
	});
});
