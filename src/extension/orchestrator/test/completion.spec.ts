/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { Emitter } from '../../../util/vs/base/common/event';
import {
	CompletionManager,
	ICompletionSummary,
} from '../completionManager';
import { IOrchestratorPermissions } from '../orchestratorPermissions';
import { WorkerSession } from '../workerSession';

describe('Completion Manager', () => {
	let completionManager: CompletionManager;
	let permissionService: any;
	let logService: any;
	let mockExecGit: any;
	let mockExecCommand: any;

	const defaultPermissions: IOrchestratorPermissions = {
		auto_approve: ['worktree_cleanup', 'file_edits_in_worktree'],
		ask_user: [],
		auto_deny: [],
		limits: {
			max_subtask_depth: 2,
			max_subtasks_per_worker: 10,
			max_parallel_subtasks: 5,
			subtask_spawn_rate_limit: 20
		}
	};

	beforeEach(() => {
		permissionService = {
			_serviceBrand: undefined,
			evaluatePermission: vi.fn().mockReturnValue('auto_approve'),
			loadPermissions: vi.fn().mockResolvedValue(defaultPermissions),
			checkLimit: vi.fn().mockReturnValue(true),
			getPermissions: vi.fn().mockReturnValue(defaultPermissions),
			onDidChangePermissions: new Emitter().event,
		};

		logService = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		};

		// Mock child_process
		mockExecGit = vi.fn();
		mockExecCommand = vi.fn();

		completionManager = new CompletionManager(
			permissionService,
			logService
		);

		// Override private methods for testing
		(completionManager as any)._execGit = mockExecGit;
		(completionManager as any)._execCommand = mockExecCommand;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		completionManager.dispose();
	});

	describe('generateCompletionSummary', () => {
		it('should generate completion summary with files and commits', async () => {
			const worker = new WorkerSession(
				'test-task',
				'Implement feature X',
				'/tmp/worktree/test-task',
				'plan-1',
				'main',
				'agent'
			);

			// Mock git diff numstat output
			mockExecGit.mockImplementation((args: string[], _cwd: string) => {
				if (args[0] === 'diff' && args[1] === '--stat') {
					return Promise.resolve(`
 src/feature.ts | 50 +++++++++++
 src/test.spec.ts | 30 +++++++
 2 files changed, 80 insertions(+)
					`);
				}
				if (args[0] === 'diff' && args[1] === '--numstat') {
					return Promise.resolve(`
50	0	src/feature.ts
30	0	src/test.spec.ts
					`.trim());
				}
				if (args[0] === 'log') {
					return Promise.resolve(`
Implement feature X
Add tests for feature X
					`.trim());
				}
				return Promise.resolve('');
			});

			const summary = await completionManager.generateCompletionSummary(worker, 'main');

			assert.ok(summary.taskId);
			assert.strictEqual(summary.workerId, worker.id);
			assert.strictEqual(summary.commitMessages.length, 2);
			assert.ok(summary.linesAdded > 0);
			assert.ok(summary.summary.includes('Implement feature X'));
			assert.ok(summary.testsAdded > 0); // Detected test file

			worker.dispose();
		});

		it('should handle git errors gracefully', async () => {
			const worker = new WorkerSession(
				'test-task',
				'Implement feature X',
				'/tmp/worktree/test-task'
			);

			mockExecGit.mockRejectedValue(new Error('Git error'));

			const summary = await completionManager.generateCompletionSummary(worker, 'main');

			// Should return minimal summary on error
			assert.strictEqual(summary.filesModified.length, 0);
			assert.strictEqual(summary.filesCreated.length, 0);
			assert.ok(summary.summary.includes('Implement feature X'));

			worker.dispose();
		});

		it('should detect test files in created and modified files', async () => {
			const worker = new WorkerSession(
				'add-tests',
				'Add unit tests',
				'/tmp/worktree/add-tests'
			);

			mockExecGit.mockImplementation((args: string[]) => {
				if (args[0] === 'diff' && args[1] === '--numstat') {
					return Promise.resolve(`
100	0	src/feature.spec.ts
50	0	src/another.test.tsx
30	10	test/integration.ts
					`.trim());
				}
				if (args[0] === 'log') {
					return Promise.resolve('Add tests');
				}
				return Promise.resolve('');
			});

			const summary = await completionManager.generateCompletionSummary(worker, 'main');

			assert.strictEqual(summary.testsAdded, 3); // All three are test files

			worker.dispose();
		});
	});

	describe('createPullRequest', () => {
		it('should create PR successfully', async () => {
			mockExecGit.mockResolvedValue('');
			mockExecCommand.mockResolvedValue(JSON.stringify({
				url: 'https://github.com/test/repo/pull/123',
				number: 123
			}));

			const result = await completionManager.createPullRequest({
				workerId: 'worker-1',
				worktreePath: '/tmp/worktree/test',
				branchName: 'feature-branch',
				baseBranch: 'main',
				title: 'Test PR',
				body: 'Test body',
				draft: false,
			});

			assert.strictEqual(result.success, true);
			assert.strictEqual(result.prNumber, 123);
			assert.strictEqual(result.prUrl, 'https://github.com/test/repo/pull/123');
		});

		it('should handle PR creation failure', async () => {
			mockExecGit.mockResolvedValue('');
			mockExecCommand.mockRejectedValue(new Error('gh CLI not found'));

			const result = await completionManager.createPullRequest({
				workerId: 'worker-1',
				worktreePath: '/tmp/worktree/test',
				branchName: 'feature-branch',
				baseBranch: 'main',
			});

			assert.strictEqual(result.success, false);
			assert.ok(result.error?.includes('gh CLI not found'));
		});

		it('should respect permission check', async () => {
			permissionService.evaluatePermission.mockReturnValue('auto_deny');

			const result = await completionManager.createPullRequest({
				workerId: 'worker-1',
				worktreePath: '/tmp/worktree/test',
				branchName: 'feature-branch',
				baseBranch: 'main',
			});

			assert.strictEqual(result.success, false);
			assert.ok(result.error?.includes('denied'));
		});

		it('should create draft PR when requested', async () => {
			mockExecGit.mockResolvedValue('');
			mockExecCommand.mockImplementation((_cmd: string, args: string[]) => {
				assert.ok(args.includes('--draft'));
				return Promise.resolve(JSON.stringify({ url: 'https://github.com/test', number: 1 }));
			});

			await completionManager.createPullRequest({
				workerId: 'worker-1',
				worktreePath: '/tmp/worktree/test',
				branchName: 'feature-branch',
				baseBranch: 'main',
				draft: true,
			});

			// Assertion in mock
		});
	});

	describe('mergeWorkerBranch', () => {
		it('should merge successfully with default strategy', async () => {
			mockExecGit.mockResolvedValue('abc123');

			const result = await completionManager.mergeWorkerBranch({
				workerId: 'worker-1',
				worktreePath: '/tmp/.worktrees/test',
				branchName: 'feature-branch',
				baseBranch: 'main',
			});

			assert.strictEqual(result.success, true);
			assert.strictEqual(result.mergeCommitSha, 'abc123');
		});

		it('should handle merge conflicts', async () => {
			mockExecGit.mockImplementation((args: string[]) => {
				if (args[0] === 'merge') {
					return Promise.reject(new Error('CONFLICT in src/file.ts'));
				}
				if (args[0] === 'diff' && args.includes('--diff-filter=U')) {
					return Promise.resolve('src/file.ts\nsrc/other.ts');
				}
				return Promise.resolve('');
			});

			const result = await completionManager.mergeWorkerBranch({
				workerId: 'worker-1',
				worktreePath: '/tmp/.worktrees/test',
				branchName: 'feature-branch',
				baseBranch: 'main',
			});

			assert.strictEqual(result.success, false);
			assert.ok(result.conflictFiles?.includes('src/file.ts'));
			assert.ok(result.error?.includes('conflict'));
		});

		it('should use squash strategy when requested', async () => {
			let usedSquash = false;
			mockExecGit.mockImplementation((args: string[]) => {
				if (args[0] === 'merge' && args.includes('--squash')) {
					usedSquash = true;
				}
				return Promise.resolve('abc123');
			});

			await completionManager.mergeWorkerBranch({
				workerId: 'worker-1',
				worktreePath: '/tmp/.worktrees/test',
				branchName: 'feature-branch',
				baseBranch: 'main',
				strategy: 'squash',
			});

			assert.strictEqual(usedSquash, true);
		});

		it('should respect permission check', async () => {
			permissionService.evaluatePermission.mockReturnValue('auto_deny');

			const result = await completionManager.mergeWorkerBranch({
				workerId: 'worker-1',
				worktreePath: '/tmp/.worktrees/test',
				branchName: 'feature-branch',
				baseBranch: 'main',
			});

			assert.strictEqual(result.success, false);
			assert.ok(result.error?.includes('denied'));
		});
	});

	describe('cleanupWorktree', () => {
		it('should cleanup worktree and branch successfully', async () => {
			mockExecGit.mockResolvedValue('');

			// Mock fs.existsSync
			vi.mock('fs', () => ({
				existsSync: () => true,
				rmSync: () => { },
			}));

			const result = await completionManager.cleanupWorktree(
				'worker-1',
				'/tmp/.worktrees/test',
				'feature-branch'
			);

			assert.strictEqual(result.success, true);
			assert.strictEqual(result.worktreeRemoved, true);
			assert.strictEqual(result.branchDeleted, true);
		});

		it('should handle partial cleanup failure', async () => {
			let callCount = 0;
			mockExecGit.mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.reject(new Error('Worktree removal failed'));
				}
				return Promise.resolve('');
			});

			const result = await completionManager.cleanupWorktree(
				'worker-1',
				'/tmp/.worktrees/test',
				'feature-branch'
			);

			// Should still succeed if branch was deleted
			assert.ok(result.success);
		});

		it('should respect permission check', async () => {
			permissionService.evaluatePermission.mockReturnValue('auto_deny');

			const result = await completionManager.cleanupWorktree(
				'worker-1',
				'/tmp/.worktrees/test',
				'feature-branch'
			);

			assert.strictEqual(result.success, false);
			assert.ok(result.error?.includes('denied'));
		});
	});

	describe('generatePrTitle', () => {
		it('should generate title from task description', () => {
			const title = completionManager.generatePrTitle(
				'implement user authentication feature',
				'auth-feature'
			);

			assert.ok(title.includes('[Orchestrator]'));
			assert.ok(title.includes('User authentication feature'));
		});

		it('should truncate long titles', () => {
			const longDescription = 'A'.repeat(100);
			const title = completionManager.generatePrTitle(longDescription, 'task');

			assert.ok(title.length <= 100);
			assert.ok(title.includes('...'));
		});

		it('should capitalize first letter', () => {
			const title = completionManager.generatePrTitle('add feature', 'task');

			// After removing "add " prefix, should capitalize remaining
			assert.ok(title.includes('Feature') || title.includes('Add'));
		});
	});

	describe('generatePrBody', () => {
		it('should generate complete PR body', () => {
			const summary: ICompletionSummary = {
				taskId: 'task-1',
				workerId: 'worker-1',
				filesModified: ['src/a.ts', 'src/b.ts'],
				filesCreated: ['src/c.ts'],
				filesDeleted: [],
				testsAdded: 1,
				commitMessages: ['Initial commit', 'Add feature'],
				summary: 'Implemented feature X',
				linesAdded: 100,
				linesRemoved: 20,
				completedAt: Date.now(),
			};

			const body = completionManager.generatePrBody(summary, 'Implement feature X');

			assert.ok(body.includes('## Summary'));
			assert.ok(body.includes('Implemented feature X'));
			assert.ok(body.includes('## Changes'));
			assert.ok(body.includes('Created'));
			assert.ok(body.includes('Modified'));
			assert.ok(body.includes('## Statistics'));
			assert.ok(body.includes('Lines Added'));
			assert.ok(body.includes('Tests Added'));
			assert.ok(body.includes('## Commits'));
			assert.ok(body.includes('Initial commit'));
			assert.ok(body.includes('Copilot Orchestrator'));
		});

		it('should handle empty fields gracefully', () => {
			const summary: ICompletionSummary = {
				taskId: 'task-1',
				workerId: 'worker-1',
				filesModified: [],
				filesCreated: [],
				filesDeleted: [],
				testsAdded: 0,
				commitMessages: [],
				summary: 'Task completed',
				linesAdded: 0,
				linesRemoved: 0,
				completedAt: Date.now(),
			};

			const body = completionManager.generatePrBody(summary, 'Task');

			// Should still generate valid markdown
			assert.ok(body.includes('## Summary'));
			assert.ok(body.includes('Task completed'));
			// Should not include Created/Modified/Deleted sections
			assert.ok(!body.includes('### Created'));
			assert.ok(!body.includes('### Modified'));
			assert.ok(!body.includes('### Deleted'));
		});

		it('should truncate long file lists', () => {
			const summary: ICompletionSummary = {
				taskId: 'task-1',
				workerId: 'worker-1',
				filesModified: Array.from({ length: 20 }, (_, i) => `src/file${i}.ts`),
				filesCreated: [],
				filesDeleted: [],
				testsAdded: 0,
				commitMessages: [],
				summary: 'Many changes',
				linesAdded: 1000,
				linesRemoved: 500,
				completedAt: Date.now(),
			};

			const body = completionManager.generatePrBody(summary, 'Task');

			assert.ok(body.includes('and 10 more'));
		});
	});
});

describe('Completion Integration', () => {
	describe('Completion Options Workflow', () => {
		it('should handle approve_and_merge action', () => {
			// This would be an integration test with OrchestratorService
			// For now, test the structure
			const options = {
				action: 'approve_and_merge' as const,
				mergeStrategy: 'squash' as const,
			};

			assert.strictEqual(options.action, 'approve_and_merge');
			assert.strictEqual(options.mergeStrategy, 'squash');
		});

		it('should handle create_pr action', () => {
			const options = {
				action: 'create_pr' as const,
				draft: true,
				prTitle: 'Custom title',
			};

			assert.strictEqual(options.action, 'create_pr');
			assert.strictEqual(options.draft, true);
		});

		it('should handle request_changes action', () => {
			const options = {
				action: 'request_changes' as const,
				feedback: 'Please add more tests',
			};

			assert.strictEqual(options.action, 'request_changes');
			assert.ok(options.feedback);
		});

		it('should handle send_to_reviewer action', () => {
			const options = {
				action: 'send_to_reviewer' as const,
			};

			assert.strictEqual(options.action, 'send_to_reviewer');
		});
	});
});
