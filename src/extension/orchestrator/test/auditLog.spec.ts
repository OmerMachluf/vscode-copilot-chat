/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import {
	AuditEventType,
	AuditLogService,
} from '../auditLog';

describe('AuditLogService', () => {
	let auditLogService: AuditLogService;
	let workspaceFolder: string;
	let stateFile: string;

	beforeEach(() => {
		// Set up mock workspace folder
		workspaceFolder = path.join(process.cwd(), 'test-workspace-audit');
		if (!fs.existsSync(workspaceFolder)) {
			fs.mkdirSync(workspaceFolder, { recursive: true });
		}
		stateFile = path.join(workspaceFolder, '.copilot-audit-log.json');

		// Mock vscode
		vi.mock('vscode', () => {
			const testPath = path.join(process.cwd(), 'test-workspace-audit');
			return {
				workspace: {
					workspaceFolders: [{ uri: { fsPath: testPath } }]
				},
				Uri: {
					joinPath: (base: any, ...segments: string[]) => ({
						fsPath: path.join(base.fsPath, ...segments)
					})
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

		auditLogService = new AuditLogService();
	});

	afterEach(() => {
		auditLogService.dispose();
		if (fs.existsSync(stateFile)) {
			fs.unlinkSync(stateFile);
		}
		if (fs.existsSync(workspaceFolder)) {
			fs.rmSync(workspaceFolder, { recursive: true, force: true });
		}
		vi.restoreAllMocks();
	});

	describe('log()', () => {
		it('should create an entry with correct properties', () => {
			const entry = auditLogService.log(
				AuditEventType.TaskCreated,
				'orchestrator',
				'Task created: implement-feature',
				{
					planId: 'plan-1',
					taskId: 'task-1',
					details: { priority: 'high' }
				}
			);

			assert.ok(entry.id, 'Entry should have an ID');
			assert.ok(entry.timestamp, 'Entry should have a timestamp');
			assert.strictEqual(entry.eventType, AuditEventType.TaskCreated);
			assert.strictEqual(entry.category, 'task');
			assert.strictEqual(entry.severity, 'info');
			assert.strictEqual(entry.actor, 'orchestrator');
			assert.strictEqual(entry.description, 'Task created: implement-feature');
			assert.strictEqual(entry.planId, 'plan-1');
			assert.strictEqual(entry.taskId, 'task-1');
			assert.deepStrictEqual(entry.details, { priority: 'high' });
		});

		it('should assign correct category based on event type', () => {
			const testCases: Array<{ eventType: AuditEventType; expectedCategory: string }> = [
				{ eventType: AuditEventType.PlanCreated, expectedCategory: 'plan' },
				{ eventType: AuditEventType.TaskStarted, expectedCategory: 'task' },
				{ eventType: AuditEventType.WorkerSpawned, expectedCategory: 'worker' },
				{ eventType: AuditEventType.SubtaskSpawned, expectedCategory: 'subtask' },
				{ eventType: AuditEventType.PermissionRequested, expectedCategory: 'permission' },
				{ eventType: AuditEventType.ApprovalGranted, expectedCategory: 'permission' },
				{ eventType: AuditEventType.OrchestratorDecisionMade, expectedCategory: 'orchestrator' },
				{ eventType: AuditEventType.MessageSent, expectedCategory: 'communication' },
				{ eventType: AuditEventType.QueueMessageEnqueued, expectedCategory: 'communication' },
				{ eventType: AuditEventType.DepthLimitReached, expectedCategory: 'safety' },
				{ eventType: AuditEventType.EmergencyStop, expectedCategory: 'safety' },
				{ eventType: AuditEventType.PullRequestCreated, expectedCategory: 'completion' },
				{ eventType: AuditEventType.SystemError, expectedCategory: 'system' },
			];

			for (const { eventType, expectedCategory } of testCases) {
				const entry = auditLogService.log(eventType, 'test', 'test');
				assert.strictEqual(entry.category, expectedCategory, `Event type ${eventType} should have category ${expectedCategory}`);
			}
		});

		it('should assign correct severity based on event type', () => {
			const criticalEntry = auditLogService.log(AuditEventType.EmergencyStop, 'system', 'Emergency stop');
			assert.strictEqual(criticalEntry.severity, 'critical');

			const errorEntry = auditLogService.log(AuditEventType.TaskFailed, 'worker-1', 'Task failed');
			assert.strictEqual(errorEntry.severity, 'error');

			const warningEntry = auditLogService.log(AuditEventType.DepthLimitReached, 'orchestrator', 'Depth limit');
			assert.strictEqual(warningEntry.severity, 'warning');

			const infoEntry = auditLogService.log(AuditEventType.TaskCreated, 'user', 'Task created');
			assert.strictEqual(infoEntry.severity, 'info');
		});

		it('should set target from workerId, taskId, or planId', () => {
			const entry1 = auditLogService.log(AuditEventType.WorkerStarted, 'orchestrator', 'Worker started', { workerId: 'worker-1' });
			assert.strictEqual(entry1.target, 'worker-1');

			const entry2 = auditLogService.log(AuditEventType.TaskStarted, 'orchestrator', 'Task started', { taskId: 'task-1' });
			assert.strictEqual(entry2.target, 'task-1');

			const entry3 = auditLogService.log(AuditEventType.PlanStarted, 'user', 'Plan started', { planId: 'plan-1' });
			assert.strictEqual(entry3.target, 'plan-1');
		});
	});

	describe('getEntries()', () => {
		beforeEach(() => {
			// Create some test entries
			auditLogService.log(AuditEventType.PlanCreated, 'user', 'Plan created', { planId: 'plan-1' });
			auditLogService.log(AuditEventType.TaskCreated, 'orchestrator', 'Task 1 created', { planId: 'plan-1', taskId: 'task-1' });
			auditLogService.log(AuditEventType.TaskCreated, 'orchestrator', 'Task 2 created', { planId: 'plan-1', taskId: 'task-2' });
			auditLogService.log(AuditEventType.WorkerSpawned, 'orchestrator', 'Worker spawned', { workerId: 'worker-1', taskId: 'task-1' });
			auditLogService.log(AuditEventType.TaskFailed, 'worker-1', 'Task failed', { taskId: 'task-1' });
		});

		it('should return all entries when no filter provided', () => {
			const entries = auditLogService.getEntries();
			assert.strictEqual(entries.length, 5);
		});

		it('should return entries sorted by timestamp descending', () => {
			const entries = auditLogService.getEntries();
			for (let i = 1; i < entries.length; i++) {
				assert.ok(entries[i - 1].timestamp >= entries[i].timestamp, 'Entries should be sorted by timestamp descending');
			}
		});

		it('should filter by event types', () => {
			const entries = auditLogService.getEntries({
				eventTypes: [AuditEventType.TaskCreated]
			});
			assert.strictEqual(entries.length, 2);
			assert.ok(entries.every(e => e.eventType === AuditEventType.TaskCreated));
		});

		it('should filter by single event type string', () => {
			const entries = auditLogService.getEntries({
				eventType: AuditEventType.PlanCreated
			});
			assert.strictEqual(entries.length, 1);
			assert.strictEqual(entries[0].eventType, AuditEventType.PlanCreated);
		});

		it('should filter by categories', () => {
			const entries = auditLogService.getEntries({
				categories: ['task']
			});
			assert.strictEqual(entries.length, 3); // 2 TaskCreated + 1 TaskFailed
			assert.ok(entries.every(e => e.category === 'task'));
		});

		it('should filter by severities', () => {
			const entries = auditLogService.getEntries({
				severities: ['error']
			});
			assert.strictEqual(entries.length, 1);
			assert.strictEqual(entries[0].eventType, AuditEventType.TaskFailed);
		});

		it('should filter by actor', () => {
			const entries = auditLogService.getEntries({
				actor: 'user'
			});
			assert.strictEqual(entries.length, 1);
			assert.strictEqual(entries[0].actor, 'user');
		});

		it('should filter by planId', () => {
			const entries = auditLogService.getEntries({
				planId: 'plan-1'
			});
			assert.strictEqual(entries.length, 3);
			assert.ok(entries.every(e => e.planId === 'plan-1'));
		});

		it('should filter by taskId', () => {
			const entries = auditLogService.getEntries({
				taskId: 'task-1'
			});
			assert.strictEqual(entries.length, 2);
			assert.ok(entries.every(e => e.taskId === 'task-1'));
		});

		it('should filter by workerId', () => {
			const entries = auditLogService.getEntries({
				workerId: 'worker-1'
			});
			assert.strictEqual(entries.length, 1);
			assert.strictEqual(entries[0].workerId, 'worker-1');
		});

		it('should filter by time range', () => {
			const now = Date.now();
			const entries = auditLogService.getEntries({
				since: now - 1000, // Last second
				until: now + 1000  // Next second
			});
			assert.strictEqual(entries.length, 5); // All entries within range
		});

		it('should filter by search text in description', () => {
			const entries = auditLogService.getEntries({
				search: 'spawned'
			});
			assert.strictEqual(entries.length, 1);
			assert.ok(entries[0].description.includes('spawned'));
		});

		it('should apply pagination with limit and offset', () => {
			const page1 = auditLogService.getEntries({ limit: 2 });
			assert.strictEqual(page1.length, 2);

			const page2 = auditLogService.getEntries({ limit: 2, offset: 2 });
			assert.strictEqual(page2.length, 2);

			const page3 = auditLogService.getEntries({ limit: 2, offset: 4 });
			assert.strictEqual(page3.length, 1);

			// Ensure no overlap
			const allIds = [...page1, ...page2, ...page3].map(e => e.id);
			const uniqueIds = new Set(allIds);
			assert.strictEqual(uniqueIds.size, 5);
		});
	});

	describe('getStats()', () => {
		beforeEach(() => {
			auditLogService.log(AuditEventType.PlanCreated, 'user', 'Plan created');
			auditLogService.log(AuditEventType.TaskCreated, 'orchestrator', 'Task created');
			auditLogService.log(AuditEventType.TaskFailed, 'worker-1', 'Task failed');
			auditLogService.log(AuditEventType.EmergencyStop, 'system', 'Emergency stop');
		});

		it('should return correct total count', () => {
			const stats = auditLogService.getStats();
			assert.strictEqual(stats.totalEntries, 4);
		});

		it('should return correct counts by category', () => {
			const stats = auditLogService.getStats();
			assert.strictEqual(stats.byCategory.plan, 1);
			assert.strictEqual(stats.byCategory.task, 2);
			assert.strictEqual(stats.byCategory.safety, 1);
		});

		it('should return correct counts by severity', () => {
			const stats = auditLogService.getStats();
			assert.strictEqual(stats.bySeverity.info, 2);
			assert.strictEqual(stats.bySeverity.error, 1);
			assert.strictEqual(stats.bySeverity.critical, 1);
		});

		it('should return correct time range', () => {
			const stats = auditLogService.getStats();
			assert.ok(stats.oldestEntry !== undefined);
			assert.ok(stats.newestEntry !== undefined);
			assert.ok(stats.oldestEntry! <= stats.newestEntry!);
		});

		it('should return retention days', () => {
			const stats = auditLogService.getStats();
			assert.strictEqual(stats.retentionDays, 30); // Default value
		});
	});

	describe('export()', () => {
		beforeEach(() => {
			auditLogService.log(AuditEventType.TaskCreated, 'user', 'Task created', {
				taskId: 'task-1',
				details: { name: 'test-task' }
			});
		});

		it('should export to JSON format', () => {
			const json = auditLogService.export('json');
			const parsed = JSON.parse(json);
			assert.ok(Array.isArray(parsed));
			assert.strictEqual(parsed.length, 1);
			assert.strictEqual(parsed[0].eventType, AuditEventType.TaskCreated);
		});

		it('should export to CSV format', () => {
			const csv = auditLogService.export('csv');
			const lines = csv.split('\n');
			assert.strictEqual(lines.length, 2); // Header + 1 entry
			assert.ok(lines[0].includes('id,timestamp,eventType'));
			assert.ok(lines[1].includes('task_created'));
		});

		it('should export to Markdown format', () => {
			const md = auditLogService.export('markdown');
			assert.ok(md.includes('# Audit Log Export'));
			assert.ok(md.includes('## task_created'));
			assert.ok(md.includes('**Actor:** user'));
			assert.ok(md.includes('**Task ID:** task-1'));
		});
	});

	describe('retention', () => {
		it('should set and get retention days', () => {
			auditLogService.setRetentionDays(7);
			assert.strictEqual(auditLogService.getRetentionDays(), 7);
		});

		it('should throw error for invalid retention days', () => {
			assert.throws(() => auditLogService.setRetentionDays(0));
			assert.throws(() => auditLogService.setRetentionDays(-1));
		});
	});

	describe('clear()', () => {
		it('should remove all entries', () => {
			auditLogService.log(AuditEventType.TaskCreated, 'user', 'Task 1');
			auditLogService.log(AuditEventType.TaskCreated, 'user', 'Task 2');
			assert.strictEqual(auditLogService.getEntries().length, 2);

			auditLogService.clear();
			assert.strictEqual(auditLogService.getEntries().length, 0);
		});
	});
});
