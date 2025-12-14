/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock gitOperations before importing mergeUtils
vi.mock('../gitOperations', () => ({
	abortMerge: vi.fn().mockResolvedValue({ success: true }),
	abortRebase: vi.fn().mockResolvedValue({ success: true }),
	checkout: vi.fn().mockResolvedValue({ success: true }),
	commit: vi.fn().mockResolvedValue({ success: true }),
	deleteBranch: vi.fn().mockResolvedValue({ success: true }),
	deleteRemoteBranch: vi.fn().mockResolvedValue({ success: true }),
	execGit: vi.fn().mockResolvedValue({ success: true, stdout: '' }),
	execGitOrThrow: vi.fn().mockResolvedValue(''),
	fetch: vi.fn().mockResolvedValue({ success: true }),
	getChangedFiles: vi.fn().mockResolvedValue([]),
	getConflictedFiles: vi.fn().mockResolvedValue([]),
	getCurrentBranch: vi.fn().mockResolvedValue('main'),
	getDefaultBranch: vi.fn().mockResolvedValue('main'),
	getFilesBetweenRefs: vi.fn().mockResolvedValue([]),
	getMainRepoPath: vi.fn().mockResolvedValue('/main/repo'),
	getMergeBase: vi.fn().mockResolvedValue('abc123'),
	hasUncommittedChanges: vi.fn().mockResolvedValue(false),
	isInMerge: vi.fn().mockResolvedValue(false),
	isInRebase: vi.fn().mockResolvedValue(false),
	isWorktree: vi.fn().mockResolvedValue(true),
	pull: vi.fn().mockResolvedValue({ success: true }),
	push: vi.fn().mockResolvedValue({ success: true }),
	removeWorktree: vi.fn().mockResolvedValue({ success: true }),
	stageAllChanges: vi.fn().mockResolvedValue({ success: true }),
	stash: vi.fn().mockResolvedValue({ success: true }),
}));

import {
	abortInProgressOperation,
	cleanupWorktree,
	detectConflicts,
	getMergeState,
	mergeBranches,
	mergeWorktreeAndCleanup,
	performPreMergeChecks,
	prepareWorktreeForMerge,
	resolveAllConflicts,
} from '../mergeUtils';

import * as gitOperations from '../gitOperations';

describe('mergeUtils', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset default mocks
		vi.mocked(gitOperations.execGit).mockResolvedValue({ success: true, stdout: '' });
		vi.mocked(gitOperations.getCurrentBranch).mockResolvedValue('main');
		vi.mocked(gitOperations.getDefaultBranch).mockResolvedValue('main');
		vi.mocked(gitOperations.hasUncommittedChanges).mockResolvedValue(false);
		vi.mocked(gitOperations.isInMerge).mockResolvedValue(false);
		vi.mocked(gitOperations.isInRebase).mockResolvedValue(false);
		vi.mocked(gitOperations.getMergeBase).mockResolvedValue('abc123');
		vi.mocked(gitOperations.getChangedFiles).mockResolvedValue([]);
		vi.mocked(gitOperations.getConflictedFiles).mockResolvedValue([]);
		vi.mocked(gitOperations.isWorktree).mockResolvedValue(true);
		vi.mocked(gitOperations.getMainRepoPath).mockResolvedValue('/main/repo');
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('detectConflicts', () => {
		it('should detect in-progress merge conflicts', async () => {
			vi.mocked(gitOperations.isInMerge).mockResolvedValue(true);
			vi.mocked(gitOperations.getConflictedFiles).mockResolvedValue(['file1.txt', 'file2.txt']);

			const result = await detectConflicts('/test', 'feature', 'main');

			expect(result.hasConflicts).toBe(true);
			expect(result.conflictType).toBe('merge');
			expect(result.conflictingFiles).toContain('file1.txt');
			expect(result.conflictingFiles).toContain('file2.txt');
		});

		it('should detect in-progress rebase conflicts', async () => {
			vi.mocked(gitOperations.isInRebase).mockResolvedValue(true);
			vi.mocked(gitOperations.getConflictedFiles).mockResolvedValue(['file.txt']);

			const result = await detectConflicts('/test', 'feature', 'main');

			expect(result.hasConflicts).toBe(true);
			expect(result.conflictType).toBe('rebase');
		});

		it('should detect uncommitted changes', async () => {
			vi.mocked(gitOperations.getChangedFiles).mockResolvedValue(['modified.txt']);

			const result = await detectConflicts('/test', 'feature', 'main');

			expect(result.hasConflicts).toBe(true);
			expect(result.conflictType).toBe('uncommitted');
			expect(result.uncommittedChanges).toContain('modified.txt');
		});

		it('should detect diverged branches without common ancestor', async () => {
			vi.mocked(gitOperations.getMergeBase).mockResolvedValue(undefined);

			const result = await detectConflicts('/test', 'feature', 'main');

			expect(result.hasConflicts).toBe(true);
			expect(result.conflictType).toBe('diverged');
		});

		it('should detect potential merge conflicts with dry-run', async () => {
			vi.mocked(gitOperations.execGit).mockResolvedValueOnce({
				success: false,
				stdout: 'Auto-merging file.txt\nCONFLICT (content): Merge conflict in file.txt',
				stderr: '',
			});

			const result = await detectConflicts('/test', 'feature', 'main');

			expect(result.hasConflicts).toBe(true);
			expect(result.conflictType).toBe('merge');
		});

		it('should return no conflicts when merge can proceed', async () => {
			const result = await detectConflicts('/test', 'feature', 'main');

			expect(result.hasConflicts).toBe(false);
		});

		it('should cleanup after conflict check', async () => {
			vi.mocked(gitOperations.getCurrentBranch).mockResolvedValue('original');

			await detectConflicts('/test', 'feature', 'main');

			// Should attempt to abort merge and return to original branch
			expect(gitOperations.execGit).toHaveBeenCalledWith(
				expect.arrayContaining(['merge', '--abort']),
				expect.anything(),
			);
		});
	});

	describe('performPreMergeChecks', () => {
		it('should report missing source branch', async () => {
			vi.mocked(gitOperations.execGit)
				.mockResolvedValueOnce({ success: false, stdout: '', stderr: 'not found' }) // source branch check
				.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' }); // target branch check

			const result = await performPreMergeChecks('/test', 'nonexistent', 'main');

			expect(result.canMerge).toBe(false);
			expect(result.sourceBranchExists).toBe(false);
			expect(result.errors).toContain(expect.stringContaining('Source branch'));
		});

		it('should report missing target branch', async () => {
			vi.mocked(gitOperations.execGit)
				.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' }) // source branch check
				.mockResolvedValueOnce({ success: false, stdout: '', stderr: 'not found' }); // target branch check

			const result = await performPreMergeChecks('/test', 'feature', 'nonexistent');

			expect(result.canMerge).toBe(false);
			expect(result.targetBranchExists).toBe(false);
			expect(result.errors).toContain(expect.stringContaining('Target branch'));
		});

		it('should report uncommitted changes as warning', async () => {
			vi.mocked(gitOperations.hasUncommittedChanges).mockResolvedValue(true);

			const result = await performPreMergeChecks('/test', 'feature', 'main');

			expect(result.isCleanWorkingTree).toBe(false);
			expect(result.warnings).toContain(expect.stringContaining('uncommitted changes'));
		});

		it('should report in-progress merge as error', async () => {
			vi.mocked(gitOperations.isInMerge).mockResolvedValue(true);

			const result = await performPreMergeChecks('/test', 'feature', 'main');

			expect(result.canMerge).toBe(false);
			expect(result.errors).toContain(expect.stringContaining('in-progress merge'));
		});

		it('should report in-progress rebase as error', async () => {
			vi.mocked(gitOperations.isInRebase).mockResolvedValue(true);

			const result = await performPreMergeChecks('/test', 'feature', 'main');

			expect(result.canMerge).toBe(false);
			expect(result.errors).toContain(expect.stringContaining('in-progress rebase'));
		});

		it('should allow merge when all checks pass', async () => {
			const result = await performPreMergeChecks('/test', 'feature', 'main');

			expect(result.canMerge).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.sourceBranchExists).toBe(true);
			expect(result.targetBranchExists).toBe(true);
			expect(result.isCleanWorkingTree).toBe(true);
		});
	});

	describe('mergeBranches', () => {
		beforeEach(() => {
			vi.mocked(gitOperations.checkout).mockResolvedValue({ success: true });
			vi.mocked(gitOperations.pull).mockResolvedValue({ success: true });
			vi.mocked(gitOperations.fetch).mockResolvedValue({ success: true });
			vi.mocked(gitOperations.getFilesBetweenRefs).mockResolvedValue(['file1.txt', 'file2.txt']);
		});

		it('should perform squash merge by default', async () => {
			vi.mocked(gitOperations.execGit)
				.mockResolvedValueOnce({ success: true }) // merge --squash
				.mockResolvedValueOnce({ success: true }) // commit
				.mockResolvedValueOnce({ success: true, stdout: 'abc123' }); // rev-parse HEAD

			const result = await mergeBranches('/test', 'feature', 'main');

			expect(result.success).toBe(true);
			expect(result.strategy).toBe('squash');
			expect(gitOperations.execGit).toHaveBeenCalledWith(
				expect.arrayContaining(['merge', '--squash', 'feature']),
				expect.anything(),
			);
		});

		it('should perform regular merge when requested', async () => {
			vi.mocked(gitOperations.execGit)
				.mockResolvedValueOnce({ success: true }) // merge
				.mockResolvedValueOnce({ success: true, stdout: 'abc123' }); // rev-parse HEAD

			const result = await mergeBranches('/test', 'feature', 'main', { strategy: 'merge' });

			expect(result.success).toBe(true);
			expect(result.strategy).toBe('merge');
			expect(gitOperations.execGit).toHaveBeenCalledWith(
				expect.arrayContaining(['merge', 'feature', '-m', expect.any(String), '--no-ff']),
				expect.anything(),
			);
		});

		it('should perform rebase merge when requested', async () => {
			vi.mocked(gitOperations.execGit)
				.mockResolvedValueOnce({ success: true }) // rebase
				.mockResolvedValueOnce({ success: true, stdout: 'abc123' }); // rev-parse HEAD

			const result = await mergeBranches('/test', 'feature', 'main', { strategy: 'rebase' });

			expect(result.success).toBe(true);
			expect(result.strategy).toBe('rebase');
			expect(gitOperations.execGit).toHaveBeenCalledWith(
				expect.arrayContaining(['rebase', 'feature']),
				expect.anything(),
			);
		});

		it('should use custom commit message', async () => {
			vi.mocked(gitOperations.execGit)
				.mockResolvedValueOnce({ success: true }) // merge
				.mockResolvedValueOnce({ success: true, stdout: 'abc123' }); // rev-parse HEAD

			await mergeBranches('/test', 'feature', 'main', {
				strategy: 'merge',
				commitMessage: 'Custom merge message',
			});

			expect(gitOperations.execGit).toHaveBeenCalledWith(
				expect.arrayContaining(['-m', 'Custom merge message']),
				expect.anything(),
			);
		});

		it('should handle merge conflicts', async () => {
			vi.mocked(gitOperations.execGit).mockResolvedValueOnce({
				success: false,
				stdout: '',
				stderr: 'CONFLICT (content): Merge conflict in file.txt',
			});
			vi.mocked(gitOperations.getConflictedFiles).mockResolvedValue(['file.txt']);
			vi.mocked(gitOperations.abortMerge).mockResolvedValue({ success: true });

			const result = await mergeBranches('/test', 'feature', 'main');

			expect(result.success).toBe(false);
			expect(result.hasConflicts).toBe(true);
			expect(result.conflictingFiles).toContain('file.txt');
		});

		it('should push after merge when requested', async () => {
			vi.mocked(gitOperations.execGit)
				.mockResolvedValueOnce({ success: true }) // merge --squash
				.mockResolvedValueOnce({ success: true }) // commit
				.mockResolvedValueOnce({ success: true, stdout: 'abc123' }); // rev-parse HEAD
			vi.mocked(gitOperations.push).mockResolvedValue({ success: true });

			const result = await mergeBranches('/test', 'feature', 'main', { push: true });

			expect(result.success).toBe(true);
			expect(gitOperations.push).toHaveBeenCalled();
		});

		it('should report push failure after successful merge', async () => {
			vi.mocked(gitOperations.execGit)
				.mockResolvedValueOnce({ success: true }) // merge --squash
				.mockResolvedValueOnce({ success: true }) // commit
				.mockResolvedValueOnce({ success: true, stdout: 'abc123' }); // rev-parse HEAD
			vi.mocked(gitOperations.push).mockResolvedValue({
				success: false,
				stderr: 'Push rejected',
			});

			const result = await mergeBranches('/test', 'feature', 'main', { push: true });

			expect(result.success).toBe(true);
			expect(result.error).toContain('push failed');
		});

		it('should include files changed in result', async () => {
			vi.mocked(gitOperations.execGit)
				.mockResolvedValueOnce({ success: true }) // merge --squash
				.mockResolvedValueOnce({ success: true }) // commit
				.mockResolvedValueOnce({ success: true, stdout: 'abc123' }); // rev-parse HEAD
			vi.mocked(gitOperations.getFilesBetweenRefs).mockResolvedValue(['a.txt', 'b.txt', 'c.txt']);

			const result = await mergeBranches('/test', 'feature', 'main');

			expect(result.filesChanged).toHaveLength(3);
		});
	});

	describe('cleanupWorktree', () => {
		beforeEach(() => {
			vi.mocked(gitOperations.isWorktree).mockResolvedValue(true);
			vi.mocked(gitOperations.getCurrentBranch).mockResolvedValue('feature');
			vi.mocked(gitOperations.getMainRepoPath).mockResolvedValue('/main/repo');
			vi.mocked(gitOperations.hasUncommittedChanges).mockResolvedValue(false);
			vi.mocked(gitOperations.removeWorktree).mockResolvedValue({ success: true });
			vi.mocked(gitOperations.deleteBranch).mockResolvedValue({ success: true });
		});

		it('should remove worktree', async () => {
			const result = await cleanupWorktree('/worktree/path');

			expect(result.success).toBe(true);
			expect(gitOperations.removeWorktree).toHaveBeenCalledWith(
				'/main/repo',
				'/worktree/path',
				false,
			);
		});

		it('should delete local branch by default', async () => {
			const result = await cleanupWorktree('/worktree/path');

			expect(result.success).toBe(true);
			expect(result.branchDeleted).toBe(true);
			expect(gitOperations.deleteBranch).toHaveBeenCalled();
		});

		it('should not delete local branch when disabled', async () => {
			const result = await cleanupWorktree('/worktree/path', { deleteLocalBranch: false });

			expect(result.success).toBe(true);
			expect(gitOperations.deleteBranch).not.toHaveBeenCalled();
		});

		it('should delete remote branch when requested', async () => {
			vi.mocked(gitOperations.deleteRemoteBranch).mockResolvedValue({ success: true });

			const result = await cleanupWorktree('/worktree/path', { deleteRemoteBranch: true });

			expect(result.success).toBe(true);
			expect(result.remoteBranchDeleted).toBe(true);
			expect(gitOperations.deleteRemoteBranch).toHaveBeenCalled();
		});

		it('should fail if path is not a worktree', async () => {
			vi.mocked(gitOperations.isWorktree).mockResolvedValue(false);

			const result = await cleanupWorktree('/not/a/worktree');

			expect(result.success).toBe(false);
			expect(result.error).toContain('not a git worktree');
		});

		it('should stash uncommitted changes when not forcing', async () => {
			vi.mocked(gitOperations.hasUncommittedChanges).mockResolvedValue(true);
			vi.mocked(gitOperations.stash).mockResolvedValue({ success: true });

			await cleanupWorktree('/worktree/path');

			expect(gitOperations.stash).toHaveBeenCalled();
		});

		it('should fail on uncommitted changes when stash fails', async () => {
			vi.mocked(gitOperations.hasUncommittedChanges).mockResolvedValue(true);
			vi.mocked(gitOperations.stash).mockResolvedValue({ success: false });

			const result = await cleanupWorktree('/worktree/path');

			expect(result.success).toBe(false);
			expect(result.error).toContain('uncommitted changes');
		});

		it('should force removal when requested', async () => {
			vi.mocked(gitOperations.hasUncommittedChanges).mockResolvedValue(true);

			await cleanupWorktree('/worktree/path', { force: true });

			expect(gitOperations.removeWorktree).toHaveBeenCalledWith(
				'/main/repo',
				'/worktree/path',
				true,
			);
		});
	});

	describe('mergeWorktreeAndCleanup', () => {
		beforeEach(() => {
			vi.mocked(gitOperations.getCurrentBranch).mockResolvedValue('feature');
			vi.mocked(gitOperations.getMainRepoPath).mockResolvedValue('/main/repo');
			vi.mocked(gitOperations.getDefaultBranch).mockResolvedValue('main');
			vi.mocked(gitOperations.hasUncommittedChanges).mockResolvedValue(false);
			vi.mocked(gitOperations.isWorktree).mockResolvedValue(true);
			vi.mocked(gitOperations.checkout).mockResolvedValue({ success: true });
			vi.mocked(gitOperations.pull).mockResolvedValue({ success: true });
			vi.mocked(gitOperations.fetch).mockResolvedValue({ success: true });
			vi.mocked(gitOperations.removeWorktree).mockResolvedValue({ success: true });
			vi.mocked(gitOperations.deleteBranch).mockResolvedValue({ success: true });
		});

		it('should merge and cleanup worktree', async () => {
			vi.mocked(gitOperations.execGit)
				.mockResolvedValueOnce({ success: true }) // merge --squash
				.mockResolvedValueOnce({ success: true }) // commit
				.mockResolvedValueOnce({ success: true, stdout: 'abc123' }); // rev-parse HEAD

			const result = await mergeWorktreeAndCleanup('/worktree/path');

			expect(result.success).toBe(true);
			expect(result.cleanup).toBeDefined();
			expect(result.cleanup?.success).toBe(true);
		});

		it('should fail if main repo path cannot be determined', async () => {
			vi.mocked(gitOperations.getMainRepoPath).mockResolvedValue(undefined);

			const result = await mergeWorktreeAndCleanup('/worktree/path');

			expect(result.success).toBe(false);
			expect(result.error).toContain('main repository path');
		});

		it('should commit uncommitted changes when message provided', async () => {
			vi.mocked(gitOperations.hasUncommittedChanges).mockResolvedValue(true);
			vi.mocked(gitOperations.stageAllChanges).mockResolvedValue({ success: true });
			vi.mocked(gitOperations.commit).mockResolvedValue({ success: true });
			vi.mocked(gitOperations.execGit)
				.mockResolvedValueOnce({ success: true }) // merge --squash
				.mockResolvedValueOnce({ success: true }) // commit
				.mockResolvedValueOnce({ success: true, stdout: 'abc123' }); // rev-parse HEAD

			const result = await mergeWorktreeAndCleanup('/worktree/path', {
				commitMessage: 'Auto commit',
			});

			expect(result.success).toBe(true);
			expect(gitOperations.stageAllChanges).toHaveBeenCalled();
			expect(gitOperations.commit).toHaveBeenCalled();
		});

		it('should fail if uncommitted changes exist without commit message', async () => {
			vi.mocked(gitOperations.hasUncommittedChanges).mockResolvedValue(true);

			const result = await mergeWorktreeAndCleanup('/worktree/path');

			expect(result.success).toBe(false);
			expect(result.error).toContain('uncommitted changes');
		});

		it('should not cleanup if merge fails', async () => {
			vi.mocked(gitOperations.checkout).mockResolvedValue({
				success: false,
				stderr: 'Checkout failed',
			});

			const result = await mergeWorktreeAndCleanup('/worktree/path');

			expect(result.success).toBe(false);
			expect(result.cleanup).toBeUndefined();
		});
	});

	describe('abortInProgressOperation', () => {
		it('should abort merge if in progress', async () => {
			vi.mocked(gitOperations.isInMerge).mockResolvedValue(true);
			vi.mocked(gitOperations.abortMerge).mockResolvedValue({ success: true });

			const result = await abortInProgressOperation('/test');

			expect(result.aborted).toBe(true);
			expect(result.operation).toBe('merge');
		});

		it('should abort rebase if in progress', async () => {
			vi.mocked(gitOperations.isInMerge).mockResolvedValue(false);
			vi.mocked(gitOperations.isInRebase).mockResolvedValue(true);
			vi.mocked(gitOperations.abortRebase).mockResolvedValue({ success: true });

			const result = await abortInProgressOperation('/test');

			expect(result.aborted).toBe(true);
			expect(result.operation).toBe('rebase');
		});

		it('should return false when no operation in progress', async () => {
			vi.mocked(gitOperations.isInMerge).mockResolvedValue(false);
			vi.mocked(gitOperations.isInRebase).mockResolvedValue(false);

			const result = await abortInProgressOperation('/test');

			expect(result.aborted).toBe(false);
			expect(result.operation).toBeUndefined();
		});
	});

	describe('resolveAllConflicts', () => {
		it('should resolve conflicts with ours strategy', async () => {
			vi.mocked(gitOperations.getConflictedFiles).mockResolvedValue(['file1.txt', 'file2.txt']);
			vi.mocked(gitOperations.execGit).mockResolvedValue({ success: true });
			vi.mocked(gitOperations.stageAllChanges).mockResolvedValue({ success: true });

			const result = await resolveAllConflicts('/test', 'ours');

			expect(result.success).toBe(true);
			expect(gitOperations.execGit).toHaveBeenCalledWith(
				expect.arrayContaining(['checkout', '--ours', '--', 'file1.txt', 'file2.txt']),
				expect.anything(),
			);
		});

		it('should resolve conflicts with theirs strategy', async () => {
			vi.mocked(gitOperations.getConflictedFiles).mockResolvedValue(['file.txt']);
			vi.mocked(gitOperations.execGit).mockResolvedValue({ success: true });
			vi.mocked(gitOperations.stageAllChanges).mockResolvedValue({ success: true });

			const result = await resolveAllConflicts('/test', 'theirs');

			expect(result.success).toBe(true);
			expect(gitOperations.execGit).toHaveBeenCalledWith(
				expect.arrayContaining(['checkout', '--theirs', '--']),
				expect.anything(),
			);
		});

		it('should succeed when no conflicts exist', async () => {
			vi.mocked(gitOperations.getConflictedFiles).mockResolvedValue([]);

			const result = await resolveAllConflicts('/test', 'ours');

			expect(result.success).toBe(true);
		});
	});

	describe('getMergeState', () => {
		it('should return complete merge state', async () => {
			vi.mocked(gitOperations.isInMerge).mockResolvedValue(true);
			vi.mocked(gitOperations.isInRebase).mockResolvedValue(false);
			vi.mocked(gitOperations.hasUncommittedChanges).mockResolvedValue(true);
			vi.mocked(gitOperations.getConflictedFiles).mockResolvedValue(['conflict.txt']);
			vi.mocked(gitOperations.getChangedFiles).mockResolvedValue(['changed.txt']);
			vi.mocked(gitOperations.getCurrentBranch).mockResolvedValue('feature');

			const state = await getMergeState('/test');

			expect(state.isInMerge).toBe(true);
			expect(state.isInRebase).toBe(false);
			expect(state.hasUncommittedChanges).toBe(true);
			expect(state.conflictedFiles).toContain('conflict.txt');
			expect(state.changedFiles).toContain('changed.txt');
			expect(state.currentBranch).toBe('feature');
		});
	});

	describe('prepareWorktreeForMerge', () => {
		it('should return ready when no uncommitted changes', async () => {
			vi.mocked(gitOperations.hasUncommittedChanges).mockResolvedValue(false);

			const result = await prepareWorktreeForMerge('/worktree');

			expect(result.ready).toBe(true);
			expect(result.wasCommitted).toBe(false);
		});

		it('should fail if uncommitted changes exist without message', async () => {
			vi.mocked(gitOperations.hasUncommittedChanges).mockResolvedValue(true);

			const result = await prepareWorktreeForMerge('/worktree');

			expect(result.ready).toBe(false);
			expect(result.error).toContain('no commit message');
		});

		it('should commit changes when message provided', async () => {
			vi.mocked(gitOperations.hasUncommittedChanges).mockResolvedValue(true);
			vi.mocked(gitOperations.stageAllChanges).mockResolvedValue({ success: true });
			vi.mocked(gitOperations.commit).mockResolvedValue({ success: true });
			vi.mocked(gitOperations.execGit).mockResolvedValue({ success: true, stdout: 'def456' });

			const result = await prepareWorktreeForMerge('/worktree', 'Commit message');

			expect(result.ready).toBe(true);
			expect(result.wasCommitted).toBe(true);
			expect(result.commitHash).toBe('def456');
		});

		it('should fail if staging fails', async () => {
			vi.mocked(gitOperations.hasUncommittedChanges).mockResolvedValue(true);
			vi.mocked(gitOperations.stageAllChanges).mockResolvedValue({
				success: false,
				stderr: 'Stage failed',
			});

			const result = await prepareWorktreeForMerge('/worktree', 'Commit message');

			expect(result.ready).toBe(false);
			expect(result.error).toContain('stage changes');
		});

		it('should fail if commit fails', async () => {
			vi.mocked(gitOperations.hasUncommittedChanges).mockResolvedValue(true);
			vi.mocked(gitOperations.stageAllChanges).mockResolvedValue({ success: true });
			vi.mocked(gitOperations.commit).mockResolvedValue({
				success: false,
				stderr: 'Commit failed',
			});

			const result = await prepareWorktreeForMerge('/worktree', 'Commit message');

			expect(result.ready).toBe(false);
			expect(result.error).toContain('commit');
		});
	});
});
