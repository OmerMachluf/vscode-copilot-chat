/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { beforeEach, describe, it, vi } from 'vitest';
import type { ILogService } from '../../../platform/log/common/logService';
import type { Event } from '../../../util/vs/base/common/event';
import { Emitter } from '../../../util/vs/base/common/event';
import { CompletionManager } from '../completionManager';
import type { IOrchestratorPermissionService, IOrchestratorPermissions, PermissionDecision } from '../orchestratorPermissions';
import { WorkerSession } from '../workerSession';

class TestPermissionService implements IOrchestratorPermissionService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangePermissionsEmitter = new Emitter<void>();
	readonly onDidChangePermissions: Event<void> = this._onDidChangePermissionsEmitter.event;

	constructor(
		private decision: PermissionDecision,
		private readonly permissions: IOrchestratorPermissions,
	) { }

	loadPermissions(): Promise<IOrchestratorPermissions> {
		return Promise.resolve(this.permissions);
	}

	evaluatePermission(_action: string, _context?: Record<string, unknown>): PermissionDecision {
		return this.decision;
	}

	checkLimit(_limitType: keyof IOrchestratorPermissions['limits'], _currentValue: number): boolean {
		return true;
	}

	getPermissions(): IOrchestratorPermissions {
		return this.permissions;
	}

	setDecision(decision: PermissionDecision): void {
		this.decision = decision;
	}
}

class TestLogService implements ILogService {
	declare readonly _serviceBrand: undefined;

	trace(_message: string): void { }
	debug(_message: string): void { }
	info(_message: string): void { }
	warn(_message: string): void { }
	error(_error: string | Error, _message?: string): void { }
	show(_preserveFocus?: boolean): void { }
}

describe('CompletionManager', () => {
	let permissionService: TestPermissionService;
	let completionManager: CompletionManager;
	let execGit: ReturnType<typeof vi.fn>;
	let execCommand: ReturnType<typeof vi.fn>;

	const defaultPermissions: IOrchestratorPermissions = {
		auto_approve: ['worktree_cleanup', 'file_edits_in_worktree'],
		ask_user: [],
		auto_deny: [],
		limits: {
			max_subtask_depth: 2,
			max_subtasks_per_worker: 10,
			max_parallel_subtasks: 5,
			subtask_spawn_rate_limit: 20,
		},
	};

	beforeEach(() => {
		execGit = vi.fn();
		execCommand = vi.fn();
		permissionService = new TestPermissionService('auto_approve', defaultPermissions);
		completionManager = new CompletionManager(permissionService, new TestLogService(), execGit, execCommand);
	});

	describe('generateCompletionSummary', () => {
		it('parses modified/created files and commit messages', async () => {
			const worker = new WorkerSession(
				'worker-name',
				'Implement feature X',
				'/tmp/.worktrees/feature-x',
				'plan-1',
				'main',
				'agent'
			);

			execGit.mockImplementation(async (args: string[]) => {
				if (args[0] === 'diff' && args[1] === '--name-status') {
					return [
						'M\tsrc/feature.ts',
						'A\tsrc/feature.spec.ts',
					].join('\n');
				}
				if (args[0] === 'log' && args[1] === '--oneline') {
					return [
						'abc1234 Implement feature X',
						'def5678 Add tests for feature X',
					].join('\n');
				}
				return '';
			});

			const summary = await completionManager.generateCompletionSummary(worker);
			assert.strictEqual(summary.taskId, 'plan-1');
			assert.strictEqual(summary.workerId, worker.id);
			assert.deepStrictEqual(summary.filesModified, ['src/feature.ts']);
			assert.deepStrictEqual(summary.filesCreated, ['src/feature.spec.ts']);
			assert.deepStrictEqual(summary.testsAdded, ['src/feature.spec.ts']);
			assert.strictEqual(summary.branchName, 'feature-x');
			assert.strictEqual(summary.commitMessages.length, 2);
			assert.ok(summary.summary.length > 0);

			worker.dispose();
		});
	});

	describe('createPullRequest', () => {
		it('is denied when permissions auto_deny', async () => {
			permissionService.setDecision('auto_deny');
			const result = await completionManager.createPullRequest({
				headBranch: 'feature-x',
				worktreePath: '/tmp/.worktrees/feature-x',
			});
			assert.strictEqual(result.success, false);
			assert.ok(result.error?.includes('denied'));
		});

		it('parses PR URL from gh output', async () => {
			execGit.mockResolvedValue('');
			execCommand.mockResolvedValue('https://github.com/org/repo/pull/123\n');
			const result = await completionManager.createPullRequest({
				headBranch: 'feature-x',
				worktreePath: '/tmp/.worktrees/feature-x',
				title: 'Test PR',
				body: 'Body',
			});
			assert.strictEqual(result.success, true);
			assert.strictEqual(result.prUrl, 'https://github.com/org/repo/pull/123');
			assert.strictEqual(result.prNumber, 123);
		});
	});
});
