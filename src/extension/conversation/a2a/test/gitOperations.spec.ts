/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	branchExists,
	checkout,
	commit,
	createBranch,
	createWorktree,
	deleteBranch,
	deleteRemoteBranch,
	execGit,
	execGitOrThrow,
	fetch,
	getChangedFiles,
	getConflictedFiles,
	getCurrentBranch,
	getCurrentCommit,
	getDefaultBranch,
	getDiffStats,
	getFilesBetweenRefs,
	getLog,
	getMainRepoPath,
	getMergeBase,
	hasUncommittedChanges,
	isInMerge,
	isInRebase,
	isWorktree,
	listWorktrees,
	pull,
	push,
	removeWorktree,
	reset,
	stageAllChanges,
	stash,
	stashPop,
	abortMerge,
	abortRebase,
	clean,
	pruneWorktrees,
} from '../gitOperations';

// Mock child_process
vi.mock('child_process', () => ({
	exec: vi.fn(),
}));

import * as cp from 'child_process';

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

function mockExecSuccess(stdout: string = '', stderr: string = '') {
	vi.mocked(cp.exec).mockImplementation(
		((_cmd: string, _options: unknown, callback?: ExecCallback) => {
			if (callback) {
				callback(null, stdout, stderr);
			}
			return {} as cp.ChildProcess;
		}) as typeof cp.exec,
	);
}

function mockExecFailure(error: Error, stdout: string = '', stderr: string = '') {
	vi.mocked(cp.exec).mockImplementation(
		((_cmd: string, _options: unknown, callback?: ExecCallback) => {
			if (callback) {
				callback(error, stdout, stderr);
			}
			return {} as cp.ChildProcess;
		}) as typeof cp.exec,
	);
}

function mockExecSequence(results: Array<{ success: boolean; stdout?: string; stderr?: string; error?: Error }>) {
	let callIndex = 0;
	vi.mocked(cp.exec).mockImplementation(
		((_cmd: string, _options: unknown, callback?: ExecCallback) => {
			const result = results[callIndex++] || results[results.length - 1];
			if (callback) {
				if (result.success) {
					callback(null, result.stdout || '', result.stderr || '');
				} else {
					const error = result.error || new Error('Command failed');
					(error as any).code = 1;
					callback(error, result.stdout || '', result.stderr || '');
				}
			}
			return {} as cp.ChildProcess;
		}) as typeof cp.exec,
	);
}

describe('gitOperations', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('execGit', () => {
		it('should execute git command and return success result', async () => {
			mockExecSuccess('output text', '');

			const result = await execGit(['status'], { cwd: '/test' });

			expect(result.success).toBe(true);
			expect(result.stdout).toBe('output text');
			expect(result.exitCode).toBe(0);
		});

		it('should return failure result when command fails', async () => {
			const error = new Error('Command failed');
			(error as any).code = 1;
			mockExecFailure(error, '', 'error message');

			const result = await execGit(['invalid-command'], { cwd: '/test' });

			expect(result.success).toBe(false);
			expect(result.error).toBe('Command failed');
		});

		it('should trim stdout and stderr', async () => {
			mockExecSuccess('  output with spaces  \n', '  stderr  ');

			const result = await execGit(['status'], { cwd: '/test' });

			expect(result.stdout).toBe('output with spaces');
			expect(result.stderr).toBe('stderr');
		});

		it('should handle arguments with spaces', async () => {
			mockExecSuccess('', '');

			await execGit(['commit', '-m', 'message with spaces'], { cwd: '/test' });

			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('"message with spaces"'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('execGitOrThrow', () => {
		it('should return stdout on success', async () => {
			mockExecSuccess('output text', '');

			const result = await execGitOrThrow(['status'], { cwd: '/test' });

			expect(result).toBe('output text');
		});

		it('should throw on failure', async () => {
			const error = new Error('Command failed');
			(error as any).code = 1;
			mockExecFailure(error, '', 'error message');

			await expect(execGitOrThrow(['invalid-command'], { cwd: '/test' }))
				.rejects.toThrow('Git command failed');
		});
	});

	describe('getCurrentBranch', () => {
		it('should return current branch name', async () => {
			mockExecSuccess('main\n', '');

			const branch = await getCurrentBranch('/test');

			expect(branch).toBe('main');
		});

		it('should trim whitespace from branch name', async () => {
			mockExecSuccess('  feature/test  \n', '');

			const branch = await getCurrentBranch('/test');

			expect(branch).toBe('feature/test');
		});
	});

	describe('getCurrentCommit', () => {
		it('should return full commit hash', async () => {
			mockExecSuccess('abc123def456\n', '');

			const commit = await getCurrentCommit('/test');

			expect(commit).toBe('abc123def456');
		});

		it('should return short commit hash when requested', async () => {
			mockExecSuccess('abc123d\n', '');

			const commit = await getCurrentCommit('/test', true);

			expect(commit).toBe('abc123d');
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('--short'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('hasUncommittedChanges', () => {
		it('should return true when there are uncommitted changes', async () => {
			mockExecSuccess('M file.txt\n', '');

			const hasChanges = await hasUncommittedChanges('/test');

			expect(hasChanges).toBe(true);
		});

		it('should return false when there are no uncommitted changes', async () => {
			mockExecSuccess('', '');

			const hasChanges = await hasUncommittedChanges('/test');

			expect(hasChanges).toBe(false);
		});
	});

	describe('getChangedFiles', () => {
		it('should return list of changed files', async () => {
			mockExecSuccess(' M file1.txt\n?? file2.txt\n', '');

			const files = await getChangedFiles('/test');

			expect(files).toContain('file1.txt');
			expect(files).toContain('file2.txt');
		});

		it('should handle renamed files', async () => {
			mockExecSuccess('R  old.txt -> new.txt\n', '');

			const files = await getChangedFiles('/test');

			expect(files).toContain('new.txt');
		});

		it('should return empty array when no changes', async () => {
			mockExecSuccess('', '');

			const files = await getChangedFiles('/test');

			expect(files).toHaveLength(0);
		});
	});

	describe('getDiffStats', () => {
		it('should return diff statistics', async () => {
			mockExecSuccess('10\t5\tfile1.txt\n20\t3\tfile2.txt\n', '');

			const stats = await getDiffStats('/test', 'main', 'feature');

			expect(stats.files).toBe(2);
			expect(stats.insertions).toBe(30);
			expect(stats.deletions).toBe(8);
		});

		it('should handle binary files', async () => {
			mockExecSuccess('10\t5\ttext.txt\n-\t-\timage.png\n', '');

			const stats = await getDiffStats('/test', 'main', 'feature');

			expect(stats.files).toBe(2);
			expect(stats.insertions).toBe(10);
			expect(stats.deletions).toBe(5);
		});

		it('should return zeros on failure', async () => {
			const error = new Error('Failed');
			(error as any).code = 1;
			mockExecFailure(error, '', '');

			const stats = await getDiffStats('/test', 'main', 'feature');

			expect(stats.files).toBe(0);
			expect(stats.insertions).toBe(0);
			expect(stats.deletions).toBe(0);
		});
	});

	describe('getFilesBetweenRefs', () => {
		it('should return list of files changed between refs', async () => {
			mockExecSuccess('file1.txt\nfile2.txt\nfile3.txt\n', '');

			const files = await getFilesBetweenRefs('/test', 'main', 'feature');

			expect(files).toHaveLength(3);
			expect(files).toContain('file1.txt');
			expect(files).toContain('file2.txt');
			expect(files).toContain('file3.txt');
		});

		it('should return empty array on failure', async () => {
			const error = new Error('Failed');
			(error as any).code = 1;
			mockExecFailure(error, '', '');

			const files = await getFilesBetweenRefs('/test', 'main', 'feature');

			expect(files).toHaveLength(0);
		});
	});

	describe('stageAllChanges', () => {
		it('should stage all changes', async () => {
			mockExecSuccess('', '');

			const result = await stageAllChanges('/test');

			expect(result.success).toBe(true);
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git add -A'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('commit', () => {
		it('should commit with message', async () => {
			mockExecSuccess('', '');

			const result = await commit('/test', 'Test commit message');

			expect(result.success).toBe(true);
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('commit'),
				expect.anything(),
				expect.anything(),
			);
		});

		it('should support --allow-empty', async () => {
			mockExecSuccess('', '');

			await commit('/test', 'Empty commit', true);

			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('--allow-empty'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('getDefaultBranch', () => {
		it('should return branch from remote HEAD', async () => {
			mockExecSuccess('refs/remotes/origin/main\n', '');

			const branch = await getDefaultBranch('/test');

			expect(branch).toBe('main');
		});

		it('should fallback to main if remote HEAD fails', async () => {
			mockExecSequence([
				{ success: false },
				{ success: true },
			]);

			const branch = await getDefaultBranch('/test');

			expect(branch).toBe('main');
		});

		it('should fallback to master if main does not exist', async () => {
			mockExecSequence([
				{ success: false },
				{ success: false },
				{ success: true },
			]);

			const branch = await getDefaultBranch('/test');

			expect(branch).toBe('master');
		});
	});

	describe('branchExists', () => {
		it('should return true if branch exists locally', async () => {
			mockExecSuccess('', '');

			const exists = await branchExists('/test', 'feature');

			expect(exists).toBe(true);
		});

		it('should return false if branch does not exist', async () => {
			const error = new Error('Not found');
			(error as any).code = 1;
			mockExecFailure(error, '', '');

			const exists = await branchExists('/test', 'nonexistent');

			expect(exists).toBe(false);
		});

		it('should check remote branches when includeRemote is true', async () => {
			mockExecSequence([
				{ success: false },
				{ success: true },
			]);

			const exists = await branchExists('/test', 'feature', true);

			expect(exists).toBe(true);
		});
	});

	describe('createBranch', () => {
		it('should create a new branch', async () => {
			mockExecSuccess('', '');

			const result = await createBranch('/test', 'new-feature');

			expect(result.success).toBe(true);
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git branch new-feature'),
				expect.anything(),
				expect.anything(),
			);
		});

		it('should create branch from start point', async () => {
			mockExecSuccess('', '');

			await createBranch('/test', 'new-feature', 'main');

			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git branch new-feature main'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('checkout', () => {
		it('should checkout a branch', async () => {
			mockExecSuccess('', '');

			const result = await checkout('/test', 'feature');

			expect(result.success).toBe(true);
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git checkout feature'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('fetch', () => {
		it('should fetch from remote', async () => {
			mockExecSuccess('', '');

			const result = await fetch('/test');

			expect(result.success).toBe(true);
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git fetch origin'),
				expect.anything(),
				expect.anything(),
			);
		});

		it('should fetch specific ref', async () => {
			mockExecSuccess('', '');

			await fetch('/test', 'origin', 'main');

			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git fetch origin main'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('pull', () => {
		it('should pull from remote', async () => {
			mockExecSuccess('', '');

			const result = await pull('/test');

			expect(result.success).toBe(true);
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git pull origin'),
				expect.anything(),
				expect.anything(),
			);
		});

		it('should pull specific branch', async () => {
			mockExecSuccess('', '');

			await pull('/test', 'origin', 'main');

			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git pull origin main'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('push', () => {
		it('should push to remote', async () => {
			mockExecSuccess('', '');

			const result = await push('/test');

			expect(result.success).toBe(true);
		});

		it('should support force push with lease', async () => {
			mockExecSuccess('', '');

			await push('/test', 'origin', 'feature', true);

			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('--force-with-lease'),
				expect.anything(),
				expect.anything(),
			);
		});

		it('should support setting upstream', async () => {
			mockExecSuccess('', '');

			await push('/test', 'origin', 'feature', false, true);

			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('-u'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('getMergeBase', () => {
		it('should return merge base commit', async () => {
			mockExecSuccess('abc123\n', '');

			const base = await getMergeBase('/test', 'main', 'feature');

			expect(base).toBe('abc123');
		});

		it('should return undefined on failure', async () => {
			const error = new Error('Failed');
			(error as any).code = 1;
			mockExecFailure(error, '', '');

			const base = await getMergeBase('/test', 'main', 'feature');

			expect(base).toBeUndefined();
		});
	});

	describe('listWorktrees', () => {
		it('should parse worktree list', async () => {
			const output = `worktree /repo
HEAD abc123
branch refs/heads/main

worktree /repo/worktrees/feature
HEAD def456
branch refs/heads/feature
`;
			mockExecSuccess(output, '');

			const worktrees = await listWorktrees('/test');

			expect(worktrees).toHaveLength(2);
			expect(worktrees[0].path).toBe('/repo');
			expect(worktrees[0].head).toBe('abc123');
			expect(worktrees[0].branch).toBe('main');
			expect(worktrees[1].path).toBe('/repo/worktrees/feature');
		});

		it('should handle bare and detached states', async () => {
			const output = `worktree /repo
HEAD abc123
bare

worktree /repo/worktrees/detached
HEAD def456
detached
`;
			mockExecSuccess(output, '');

			const worktrees = await listWorktrees('/test');

			expect(worktrees[0].bare).toBe(true);
			expect(worktrees[1].detached).toBe(true);
		});

		it('should return empty array on failure', async () => {
			const error = new Error('Failed');
			(error as any).code = 1;
			mockExecFailure(error, '', '');

			const worktrees = await listWorktrees('/test');

			expect(worktrees).toHaveLength(0);
		});
	});

	describe('createWorktree', () => {
		it('should create a worktree', async () => {
			mockExecSuccess('', '');

			const result = await createWorktree('/test', '/path/to/worktree');

			expect(result.success).toBe(true);
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git worktree add'),
				expect.anything(),
				expect.anything(),
			);
		});

		it('should support creating new branch', async () => {
			mockExecSuccess('', '');

			await createWorktree('/test', '/path/to/worktree', { newBranch: 'feature' });

			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('-b feature'),
				expect.anything(),
				expect.anything(),
			);
		});

		it('should support detached mode', async () => {
			mockExecSuccess('', '');

			await createWorktree('/test', '/path/to/worktree', { detach: true });

			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('--detach'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('removeWorktree', () => {
		it('should remove a worktree', async () => {
			mockExecSuccess('', '');

			const result = await removeWorktree('/test', '/path/to/worktree');

			expect(result.success).toBe(true);
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git worktree remove'),
				expect.anything(),
				expect.anything(),
			);
		});

		it('should support force removal', async () => {
			mockExecSuccess('', '');

			await removeWorktree('/test', '/path/to/worktree', true);

			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('--force'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('pruneWorktrees', () => {
		it('should prune worktrees', async () => {
			mockExecSuccess('', '');

			const result = await pruneWorktrees('/test');

			expect(result.success).toBe(true);
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git worktree prune'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('getMainRepoPath', () => {
		it('should return main repo path for worktree', async () => {
			mockExecSuccess('/main/repo/.git/worktrees/feature', '');

			const path = await getMainRepoPath('/worktree/feature');

			expect(path).toBe('/main/repo');
		});

		it('should return parent path for main repo', async () => {
			mockExecSuccess('/repo/.git', '');

			const path = await getMainRepoPath('/repo');

			expect(path).toBe('/repo/');
		});

		it('should return undefined on failure', async () => {
			const error = new Error('Failed');
			(error as any).code = 1;
			mockExecFailure(error, '', '');

			const path = await getMainRepoPath('/invalid');

			expect(path).toBeUndefined();
		});
	});

	describe('isWorktree', () => {
		it('should return true for worktree path', async () => {
			mockExecSuccess('/main/repo/.git/worktrees/feature', '');

			const result = await isWorktree('/worktree/feature');

			expect(result).toBe(true);
		});

		it('should return false for main repo', async () => {
			mockExecSuccess('/repo/.git', '');

			const result = await isWorktree('/repo');

			expect(result).toBe(false);
		});

		it('should return false on failure', async () => {
			const error = new Error('Failed');
			(error as any).code = 1;
			mockExecFailure(error, '', '');

			const result = await isWorktree('/invalid');

			expect(result).toBe(false);
		});
	});

	describe('deleteBranch', () => {
		it('should delete a branch', async () => {
			mockExecSuccess('', '');

			const result = await deleteBranch('/test', 'feature');

			expect(result.success).toBe(true);
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git branch -d feature'),
				expect.anything(),
				expect.anything(),
			);
		});

		it('should force delete when requested', async () => {
			mockExecSuccess('', '');

			await deleteBranch('/test', 'feature', true);

			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git branch -D feature'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('deleteRemoteBranch', () => {
		it('should delete remote branch', async () => {
			mockExecSuccess('', '');

			const result = await deleteRemoteBranch('/test', 'origin', 'feature');

			expect(result.success).toBe(true);
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git push origin --delete feature'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('abortMerge', () => {
		it('should abort merge', async () => {
			mockExecSuccess('', '');

			const result = await abortMerge('/test');

			expect(result.success).toBe(true);
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git merge --abort'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('abortRebase', () => {
		it('should abort rebase', async () => {
			mockExecSuccess('', '');

			const result = await abortRebase('/test');

			expect(result.success).toBe(true);
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git rebase --abort'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('isInMerge', () => {
		it('should return true when in merge', async () => {
			mockExecSuccess('abc123', '');

			const result = await isInMerge('/test');

			expect(result).toBe(true);
		});

		it('should return false when not in merge', async () => {
			const error = new Error('Not found');
			(error as any).code = 1;
			mockExecFailure(error, '', '');

			const result = await isInMerge('/test');

			expect(result).toBe(false);
		});
	});

	describe('isInRebase', () => {
		it('should return true when in rebase', async () => {
			mockExecSuccess('abc123', '');

			const result = await isInRebase('/test');

			expect(result).toBe(true);
		});

		it('should return false when not in rebase', async () => {
			const error = new Error('Not found');
			(error as any).code = 1;
			mockExecFailure(error, '', '');

			const result = await isInRebase('/test');

			expect(result).toBe(false);
		});
	});

	describe('getConflictedFiles', () => {
		it('should return list of conflicted files', async () => {
			mockExecSuccess('file1.txt\nfile2.txt\n', '');

			const files = await getConflictedFiles('/test');

			expect(files).toHaveLength(2);
			expect(files).toContain('file1.txt');
			expect(files).toContain('file2.txt');
		});

		it('should return empty array on failure', async () => {
			const error = new Error('Failed');
			(error as any).code = 1;
			mockExecFailure(error, '', '');

			const files = await getConflictedFiles('/test');

			expect(files).toHaveLength(0);
		});
	});

	describe('reset', () => {
		it('should reset to ref with default mixed mode', async () => {
			mockExecSuccess('', '');

			const result = await reset('/test', 'HEAD~1');

			expect(result.success).toBe(true);
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git reset --mixed HEAD~1'),
				expect.anything(),
				expect.anything(),
			);
		});

		it('should support soft mode', async () => {
			mockExecSuccess('', '');

			await reset('/test', 'HEAD~1', 'soft');

			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('--soft'),
				expect.anything(),
				expect.anything(),
			);
		});

		it('should support hard mode', async () => {
			mockExecSuccess('', '');

			await reset('/test', 'HEAD~1', 'hard');

			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('--hard'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('clean', () => {
		it('should clean untracked files', async () => {
			mockExecSuccess('', '');

			const result = await clean('/test');

			expect(result.success).toBe(true);
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git clean'),
				expect.anything(),
				expect.anything(),
			);
		});

		it('should support force and directories options', async () => {
			mockExecSuccess('', '');

			await clean('/test', { force: true, directories: true });

			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('-f'),
				expect.anything(),
				expect.anything(),
			);
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('-d'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('stash', () => {
		it('should stash changes', async () => {
			mockExecSuccess('', '');

			const result = await stash('/test');

			expect(result.success).toBe(true);
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git stash push'),
				expect.anything(),
				expect.anything(),
			);
		});

		it('should support message', async () => {
			mockExecSuccess('', '');

			await stash('/test', 'Work in progress');

			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('-m'),
				expect.anything(),
				expect.anything(),
			);
		});

		it('should support including untracked', async () => {
			mockExecSuccess('', '');

			await stash('/test', undefined, true);

			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('-u'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('stashPop', () => {
		it('should pop stash', async () => {
			mockExecSuccess('', '');

			const result = await stashPop('/test');

			expect(result.success).toBe(true);
			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('git stash pop'),
				expect.anything(),
				expect.anything(),
			);
		});
	});

	describe('getLog', () => {
		it('should get commit log', async () => {
			mockExecSuccess('commit abc123\ncommit def456\n', '');

			const log = await getLog('/test');

			expect(log).toContain('abc123');
			expect(log).toContain('def456');
		});

		it('should support maxCount', async () => {
			mockExecSuccess('', '');

			await getLog('/test', { maxCount: 5 });

			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('-5'),
				expect.anything(),
				expect.anything(),
			);
		});

		it('should support custom format', async () => {
			mockExecSuccess('', '');

			await getLog('/test', { format: '%H %s' });

			expect(cp.exec).toHaveBeenCalledWith(
				expect.stringContaining('--format=%H %s'),
				expect.anything(),
				expect.anything(),
			);
		});
	});
});
