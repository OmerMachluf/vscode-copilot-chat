/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { IOrchestratorQueueMessage, OrchestratorQueueService } from '../orchestratorQueue';

describe('OrchestratorQueueService', () => {
	let queueService: OrchestratorQueueService;
	let workspaceFolder: string;
	let stateFile: string;
	let mockLogService: any;

	beforeEach(() => {
		// Mock vscode.workspace
		workspaceFolder = path.join(process.cwd(), 'test-workspace');
		if (!fs.existsSync(workspaceFolder)) {
			fs.mkdirSync(workspaceFolder, { recursive: true });
		}
		stateFile = path.join(workspaceFolder, '.copilot-orchestrator-queue.json');

		vi.mock('vscode', () => {
			const path = require('path');
			const workspaceFolder = path.join(process.cwd(), 'test-workspace');
			return {
				workspace: {
					workspaceFolders: [{ uri: { fsPath: workspaceFolder } }]
				},
				Disposable: {
					from: (...disposables: any[]) => ({ dispose: () => disposables.forEach(d => d.dispose()) })
				},
				EventEmitter: class {
					event = () => { };
					fire = () => { };
					dispose = () => { };
				}
			};
		});

		mockLogService = {
			_serviceBrand: undefined,
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			trace: vi.fn(),
		};

		queueService = new OrchestratorQueueService(mockLogService);
	});

	afterEach(() => {
		queueService.dispose();
		if (fs.existsSync(stateFile)) {
			fs.unlinkSync(stateFile);
		}
		if (fs.existsSync(workspaceFolder)) {
			fs.rmSync(workspaceFolder, { recursive: true, force: true });
		}
		vi.restoreAllMocks();
	});

	it('should process messages in priority order', async () => {
		const processed: string[] = [];
		queueService.registerHandler(async (msg) => {
			processed.push(msg.id);
		});

		// Enqueue in reverse priority order
		queueService.enqueueMessage(createMessage('1', 'low'));
		queueService.enqueueMessage(createMessage('2', 'normal'));
		queueService.enqueueMessage(createMessage('3', 'high'));
		queueService.enqueueMessage(createMessage('4', 'critical'));

		// Wait for processing
		await new Promise(resolve => setTimeout(resolve, 100));

		assert.deepStrictEqual(processed, ['4', '3', '2', '1']);
	});

	it('should deduplicate messages', async () => {
		const processed: string[] = [];
		queueService.registerHandler(async (msg) => {
			processed.push(msg.id);
		});

		const msg = createMessage('1', 'normal');
		queueService.enqueueMessage(msg);
		queueService.enqueueMessage(msg); // Duplicate

		await new Promise(resolve => setTimeout(resolve, 50));

		assert.strictEqual(processed.length, 1);
	});

	it('should persist and reload state', async () => {
		// Enqueue a message but don't process it (no handler)
		const msg = createMessage('1', 'normal');
		queueService.enqueueMessage(msg);

		// Wait for save
		await new Promise(resolve => setTimeout(resolve, 50));
		assert.ok(fs.existsSync(stateFile));

		// Create new service instance
		const newService = new OrchestratorQueueService(mockLogService);

		// Register handler to process the persisted message
		const processed: string[] = [];
		newService.registerHandler(async (m) => {
			processed.push(m.id);
		});

		await new Promise(resolve => setTimeout(resolve, 50));
		assert.strictEqual(processed.length, 1);
		assert.strictEqual(processed[0], '1');

		newService.dispose();
	});

	it('should process >100 messages/sec', async () => {
		const count = 500;
		let processedCount = 0;

		queueService.registerHandler(async () => {
			processedCount++;
		});

		const startTime = Date.now();
		for (let i = 0; i < count; i++) {
			queueService.enqueueMessage(createMessage(`${i}`, 'normal'));
		}

		// Wait for all to process
		while (processedCount < count) {
			await new Promise(resolve => setTimeout(resolve, 10));
			if (Date.now() - startTime > 5000) {
				throw new Error('Timeout waiting for messages');
			}
		}

		const duration = Date.now() - startTime;
		const rate = count / (duration / 1000);

		console.log(`Processed ${count} messages in ${duration}ms (${rate.toFixed(2)} msg/sec)`);
		assert.ok(rate > 100, `Rate ${rate} should be > 100 msg/sec`);
	});
});

function createMessage(id: string, priority: 'critical' | 'high' | 'normal' | 'low'): IOrchestratorQueueMessage {
	return {
		id,
		timestamp: Date.now(),
		priority,
		planId: 'plan-1',
		taskId: 'task-1',
		workerId: 'worker-1',
		worktreePath: '/tmp/worktree',
		type: 'status_update',
		content: 'test'
	};
}
