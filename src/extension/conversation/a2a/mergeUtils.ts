/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	abortMerge,
	abortRebase,
	checkout,
	commit,
	deleteBranch,
	deleteRemoteBranch,
	execGit,
	execGitOrThrow,
	fetch,
	getChangedFiles,
	getConflictedFiles,
	getCurrentBranch,
	getDefaultBranch,
	getFilesBetweenRefs,
	getMainRepoPath,
	getMergeBase,
	GitOperationResult,
	hasUncommittedChanges,
	isInMerge,
	isInRebase,
	isWorktree,
	pull,
	push,
	removeWorktree,
	stageAllChanges,
	stash,
} from './gitOperations';

/**
 * Merge strategy types
 */
export type MergeStrategy = 'merge' | 'squash' | 'rebase';

/**
 * Result of a merge operation
 */
export interface MergeResult {
	readonly success: boolean;
	readonly strategy: MergeStrategy;
	readonly sourceBranch: string;
	readonly targetBranch: string;
	readonly filesChanged?: string[];
	readonly hasConflicts?: boolean;
	readonly conflictingFiles?: string[];
	readonly mergeCommit?: string;
	readonly error?: string;
}

/**
 * Options for merge operations
 */
export interface MergeOptions {
	/** The merge strategy to use */
	readonly strategy?: MergeStrategy;
	/** Custom commit message (used for merge and squash) */
	readonly commitMessage?: string;
	/** Whether to auto-commit (for squash strategy, default: true) */
	readonly autoCommit?: boolean;
	/** Whether to abort on conflicts (default: true) */
	readonly abortOnConflict?: boolean;
	/** Whether to push after successful merge (default: false) */
	readonly push?: boolean;
	/** Remote to push to (default: 'origin') */
	readonly remote?: string;
}

/**
 * Result of a worktree cleanup operation
 */
export interface WorktreeCleanupResult {
	readonly success: boolean;
	readonly worktreePath: string;
	readonly branchDeleted?: boolean;
	readonly remoteBranchDeleted?: boolean;
	readonly error?: string;
}

/**
 * Options for worktree cleanup
 */
export interface WorktreeCleanupOptions {
	/** Whether to delete the local branch (default: true) */
	readonly deleteLocalBranch?: boolean;
	/** Whether to delete the remote branch (default: false) */
	readonly deleteRemoteBranch?: boolean;
	/** Whether to force removal even with uncommitted changes (default: false) */
	readonly force?: boolean;
	/** Remote name (default: 'origin') */
	readonly remote?: string;
}

/**
 * Result of conflict detection
 */
export interface ConflictDetectionResult {
	readonly hasConflicts: boolean;
	readonly conflictType?: 'merge' | 'rebase' | 'uncommitted' | 'diverged';
	readonly conflictingFiles?: string[];
	readonly uncommittedChanges?: string[];
	readonly divergedCommits?: {
		ahead: number;
		behind: number;
	};
	readonly details?: string;
}

/**
 * Pre-merge check result
 */
export interface PreMergeCheckResult {
	readonly canMerge: boolean;
	readonly conflicts?: ConflictDetectionResult;
	readonly sourceBranchExists: boolean;
	readonly targetBranchExists: boolean;
	readonly isCleanWorkingTree: boolean;
	readonly warnings: string[];
	readonly errors: string[];
}

/**
 * Checks if a merge can proceed without conflicts
 * @param cwd Working directory
 * @param sourceBranch Source branch to merge from
 * @param targetBranch Target branch to merge into
 */
export async function detectConflicts(
	cwd: string,
	sourceBranch: string,
	targetBranch: string
): Promise<ConflictDetectionResult> {
	// Check for in-progress merge or rebase
	if (await isInMerge(cwd)) {
		const files = await getConflictedFiles(cwd);
		return {
			hasConflicts: true,
			conflictType: 'merge',
			conflictingFiles: files,
			details: 'There is an in-progress merge with conflicts',
		};
	}

	if (await isInRebase(cwd)) {
		const files = await getConflictedFiles(cwd);
		return {
			hasConflicts: true,
			conflictType: 'rebase',
			conflictingFiles: files,
			details: 'There is an in-progress rebase with conflicts',
		};
	}

	// Check for uncommitted changes
	const uncommitted = await getChangedFiles(cwd);
	if (uncommitted.length > 0) {
		return {
			hasConflicts: true,
			conflictType: 'uncommitted',
			uncommittedChanges: uncommitted,
			details: 'There are uncommitted changes that may conflict with merge',
		};
	}

	// Check if branches have diverged
	const mergeBase = await getMergeBase(cwd, sourceBranch, targetBranch);
	if (!mergeBase) {
		return {
			hasConflicts: true,
			conflictType: 'diverged',
			details: `Cannot find common ancestor between ${sourceBranch} and ${targetBranch}`,
		};
	}

	// Try a dry-run merge to detect conflicts
	// Save current state
	const currentBranch = await getCurrentBranch(cwd);

	try {
		// Checkout target branch if not already there
		if (currentBranch !== targetBranch) {
			await execGitOrThrow(['checkout', targetBranch], { cwd });
		}

		// Try merge with --no-commit to check for conflicts
		const mergeResult = await execGit(['merge', '--no-commit', '--no-ff', sourceBranch], { cwd });

		// Abort the merge (we were just checking)
		await execGit(['merge', '--abort'], { cwd });

		// Return to original branch if needed
		if (currentBranch !== targetBranch) {
			await execGit(['checkout', currentBranch], { cwd });
		}

		if (!mergeResult.success) {
			const output = (mergeResult.stderr || '') + (mergeResult.stdout || '');
			if (output.includes('CONFLICT') || output.includes('Automatic merge failed')) {
				const files = await getConflictedFiles(cwd);
				return {
					hasConflicts: true,
					conflictType: 'merge',
					conflictingFiles: files.length > 0 ? files : extractConflictFilesFromOutput(output),
					details: 'Merge would result in conflicts',
				};
			}
		}

		return { hasConflicts: false };

	} catch (error) {
		// Make sure to return to original branch on error
		try {
			await execGit(['merge', '--abort'], { cwd });
			if (currentBranch !== targetBranch) {
				await execGit(['checkout', currentBranch], { cwd });
			}
		} catch { /* ignore cleanup errors */ }

		return {
			hasConflicts: true,
			details: `Failed to check for conflicts: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Extracts conflict file names from merge output
 */
function extractConflictFilesFromOutput(output: string): string[] {
	const files: string[] = [];
	const lines = output.split('\n');

	for (const line of lines) {
		// Match patterns like "CONFLICT (content): Merge conflict in <file>"
		const contentMatch = line.match(/CONFLICT.*?:\s*Merge conflict in\s+(.+)/i);
		if (contentMatch) {
			files.push(contentMatch[1].trim());
			continue;
		}

		// Match patterns like "CONFLICT (modify/delete): <file>"
		const modifyMatch = line.match(/CONFLICT.*?:\s*([^\s]+)\s+deleted/i);
		if (modifyMatch) {
			files.push(modifyMatch[1].trim());
			continue;
		}

		// Match patterns like "Auto-merging <file>"
		const autoMergeMatch = line.match(/Auto-merging\s+(.+)/);
		if (autoMergeMatch && line.toLowerCase().includes('conflict')) {
			files.push(autoMergeMatch[1].trim());
		}
	}

	return [...new Set(files)]; // Remove duplicates
}

/**
 * Performs pre-merge checks to determine if merge can proceed
 */
export async function performPreMergeChecks(
	cwd: string,
	sourceBranch: string,
	targetBranch: string
): Promise<PreMergeCheckResult> {
	const warnings: string[] = [];
	const errors: string[] = [];

	// Check if source branch exists
	const sourceResult = await execGit(['rev-parse', '--verify', sourceBranch], { cwd });
	const sourceBranchExists = sourceResult.success;
	if (!sourceBranchExists) {
		errors.push(`Source branch '${sourceBranch}' does not exist`);
	}

	// Check if target branch exists
	const targetResult = await execGit(['rev-parse', '--verify', targetBranch], { cwd });
	const targetBranchExists = targetResult.success;
	if (!targetBranchExists) {
		errors.push(`Target branch '${targetBranch}' does not exist`);
	}

	// Check for clean working tree
	const isCleanWorkingTree = !(await hasUncommittedChanges(cwd));
	if (!isCleanWorkingTree) {
		warnings.push('Working tree has uncommitted changes');
	}

	// Check for in-progress operations
	if (await isInMerge(cwd)) {
		errors.push('There is an in-progress merge that must be completed or aborted');
	}
	if (await isInRebase(cwd)) {
		errors.push('There is an in-progress rebase that must be completed or aborted');
	}

	// Detect potential conflicts if branches exist
	let conflicts: ConflictDetectionResult | undefined;
	if (sourceBranchExists && targetBranchExists && errors.length === 0) {
		conflicts = await detectConflicts(cwd, sourceBranch, targetBranch);
		if (conflicts.hasConflicts) {
			warnings.push(`Merge may result in conflicts: ${conflicts.details}`);
		}
	}

	return {
		canMerge: errors.length === 0 && (!conflicts?.hasConflicts || conflicts.conflictType === 'uncommitted'),
		conflicts,
		sourceBranchExists,
		targetBranchExists,
		isCleanWorkingTree,
		warnings,
		errors,
	};
}

/**
 * Merges a source branch into a target branch
 */
export async function mergeBranches(
	cwd: string,
	sourceBranch: string,
	targetBranch: string,
	options: MergeOptions = {}
): Promise<MergeResult> {
	const {
		strategy = 'squash',
		commitMessage,
		autoCommit = true,
		abortOnConflict = true,
		push: shouldPush = false,
		remote = 'origin',
	} = options;

	const result: MergeResult = {
		success: false,
		strategy,
		sourceBranch,
		targetBranch,
	};

	try {
		// Get current branch to restore later if needed
		const originalBranch = await getCurrentBranch(cwd);

		// Fetch latest from remote
		await fetch(cwd, remote);

		// Checkout target branch
		const checkoutResult = await checkout(cwd, targetBranch);
		if (!checkoutResult.success) {
			return {
				...result,
				error: `Failed to checkout target branch: ${checkoutResult.stderr || checkoutResult.error}`,
			};
		}

		// Try to pull latest changes
		await pull(cwd, remote, targetBranch);

		// Get files that will change
		const filesChanged = await getFilesBetweenRefs(cwd, targetBranch, sourceBranch);

		// Perform the merge based on strategy
		let mergeResult: GitOperationResult;
		const message = commitMessage || `Merge ${sourceBranch} into ${targetBranch}`;

		switch (strategy) {
			case 'squash':
				mergeResult = await performSquashMerge(cwd, sourceBranch, message, autoCommit);
				break;
			case 'rebase':
				mergeResult = await performRebaseMerge(cwd, sourceBranch, targetBranch);
				break;
			case 'merge':
			default:
				mergeResult = await performRegularMerge(cwd, sourceBranch, message);
				break;
		}

		if (!mergeResult.success) {
			const output = (mergeResult.stderr || '') + (mergeResult.stdout || '');

			// Check if it's a conflict
			if (output.includes('CONFLICT') || output.includes('conflict')) {
				const conflictingFiles = await getConflictedFiles(cwd);

				if (abortOnConflict) {
					// Abort the failed merge/rebase
					if (strategy === 'rebase') {
						await abortRebase(cwd);
					} else {
						await abortMerge(cwd);
					}

					// Return to original branch
					if (originalBranch !== targetBranch) {
						await checkout(cwd, originalBranch);
					}
				}

				return {
					...result,
					filesChanged,
					hasConflicts: true,
					conflictingFiles: conflictingFiles.length > 0 ? conflictingFiles : extractConflictFilesFromOutput(output),
					error: 'Merge resulted in conflicts',
				};
			}

			return {
				...result,
				error: mergeResult.stderr || mergeResult.error || 'Merge failed',
			};
		}

		// Get the merge commit
		const mergeCommit = await execGit(['rev-parse', 'HEAD'], { cwd });

		// Push if requested
		if (shouldPush) {
			const pushResult = await push(cwd, remote, targetBranch);
			if (!pushResult.success) {
				return {
					...result,
					success: true,
					filesChanged,
					mergeCommit: mergeCommit.stdout?.trim(),
					error: `Merge succeeded but push failed: ${pushResult.stderr || pushResult.error}`,
				};
			}
		}

		return {
			...result,
			success: true,
			filesChanged,
			mergeCommit: mergeCommit.stdout?.trim(),
		};

	} catch (error) {
		return {
			...result,
			error: `Merge failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Performs a regular merge
 */
async function performRegularMerge(cwd: string, sourceBranch: string, message: string): Promise<GitOperationResult> {
	return execGit(['merge', sourceBranch, '-m', message, '--no-ff'], { cwd });
}

/**
 * Performs a squash merge
 */
async function performSquashMerge(
	cwd: string,
	sourceBranch: string,
	message: string,
	autoCommit: boolean
): Promise<GitOperationResult> {
	// Squash merge
	const squashResult = await execGit(['merge', '--squash', sourceBranch], { cwd });

	if (!squashResult.success) {
		return squashResult;
	}

	if (autoCommit) {
		// Commit the squashed changes
		return execGit(['commit', '-m', message], { cwd });
	}

	return squashResult;
}

/**
 * Performs a rebase merge
 */
async function performRebaseMerge(
	cwd: string,
	sourceBranch: string,
	targetBranch: string
): Promise<GitOperationResult> {
	// First rebase target onto source
	const rebaseResult = await execGit(['rebase', sourceBranch], { cwd });

	if (!rebaseResult.success) {
		return rebaseResult;
	}

	return { success: true, stdout: rebaseResult.stdout, stderr: rebaseResult.stderr };
}

/**
 * Merges worktree changes back to the parent branch and cleans up
 */
export async function mergeWorktreeAndCleanup(
	worktreePath: string,
	options: MergeOptions & WorktreeCleanupOptions = {}
): Promise<MergeResult & { cleanup?: WorktreeCleanupResult }> {
	const {
		strategy = 'squash',
		commitMessage,
		autoCommit = true,
		abortOnConflict = true,
		push: shouldPush = false,
		remote = 'origin',
		deleteLocalBranch = true,
		deleteRemoteBranch = false,
		force = false,
	} = options;

	// Get worktree branch
	const worktreeBranch = await getCurrentBranch(worktreePath);

	// Get main repo path
	const mainRepoPath = await getMainRepoPath(worktreePath);
	if (!mainRepoPath) {
		return {
			success: false,
			strategy,
			sourceBranch: worktreeBranch,
			targetBranch: 'unknown',
			error: 'Could not determine main repository path',
		};
	}

	// Get target branch (usually main/master or the branch worktree was created from)
	const targetBranch = await getDefaultBranch(mainRepoPath);

	// Check if there are uncommitted changes in the worktree
	if (await hasUncommittedChanges(worktreePath)) {
		if (!commitMessage) {
			return {
				success: false,
				strategy,
				sourceBranch: worktreeBranch,
				targetBranch,
				error: 'Worktree has uncommitted changes. Provide a commitMessage to auto-commit them.',
			};
		}

		// Stage and commit changes
		await stageAllChanges(worktreePath);
		const commitResult = await commit(worktreePath, commitMessage);
		if (!commitResult.success) {
			return {
				success: false,
				strategy,
				sourceBranch: worktreeBranch,
				targetBranch,
				error: `Failed to commit changes: ${commitResult.stderr || commitResult.error}`,
			};
		}
	}

	// Perform the merge from the main repo
	const mergeResult = await mergeBranches(mainRepoPath, worktreeBranch, targetBranch, {
		strategy,
		commitMessage: commitMessage || `Merge worktree branch ${worktreeBranch}`,
		autoCommit,
		abortOnConflict,
		push: shouldPush,
		remote,
	});

	// If merge failed, return without cleanup
	if (!mergeResult.success) {
		return mergeResult;
	}

	// Cleanup worktree
	const cleanupResult = await cleanupWorktree(worktreePath, {
		deleteLocalBranch,
		deleteRemoteBranch,
		force,
		remote,
	});

	return {
		...mergeResult,
		cleanup: cleanupResult,
	};
}

/**
 * Cleans up a worktree and optionally its branch
 */
export async function cleanupWorktree(
	worktreePath: string,
	options: WorktreeCleanupOptions = {}
): Promise<WorktreeCleanupResult> {
	const {
		deleteLocalBranch = true,
		deleteRemoteBranch: deleteRemote = false,
		force = false,
		remote = 'origin',
	} = options;

	const result: WorktreeCleanupResult = {
		success: false,
		worktreePath,
	};

	try {
		// Check if it's actually a worktree
		if (!(await isWorktree(worktreePath))) {
			return {
				...result,
				error: 'Path is not a git worktree',
			};
		}

		// Get the branch name before removing
		const branchName = await getCurrentBranch(worktreePath);

		// Get main repo path
		const mainRepoPath = await getMainRepoPath(worktreePath);
		if (!mainRepoPath) {
			return {
				...result,
				error: 'Could not determine main repository path',
			};
		}

		// Check for uncommitted changes if not forcing
		if (!force && await hasUncommittedChanges(worktreePath)) {
			// Try to stash changes
			const stashResult = await stash(worktreePath, 'Auto-stash before worktree removal', true);
			if (!stashResult.success) {
				return {
					...result,
					error: 'Worktree has uncommitted changes. Use force=true to remove anyway.',
				};
			}
		}

		// Remove the worktree
		const removeResult = await removeWorktree(mainRepoPath, worktreePath, force);
		if (!removeResult.success) {
			return {
				...result,
				error: `Failed to remove worktree: ${removeResult.stderr || removeResult.error}`,
			};
		}

		let branchDeleted = false;
		let remoteBranchDeleted = false;

		// Delete local branch if requested
		if (deleteLocalBranch) {
			const deleteResult = await deleteBranch(mainRepoPath, branchName, force);
			branchDeleted = deleteResult.success;
		}

		// Delete remote branch if requested
		if (deleteRemote) {
			const deleteRemoteResult = await deleteRemoteBranch(mainRepoPath, remote, branchName);
			remoteBranchDeleted = deleteRemoteResult.success;
		}

		return {
			success: true,
			worktreePath,
			branchDeleted,
			remoteBranchDeleted,
		};

	} catch (error) {
		return {
			...result,
			error: `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Safely aborts any in-progress merge or rebase operation
 */
export async function abortInProgressOperation(cwd: string): Promise<{ aborted: boolean; operation?: 'merge' | 'rebase' }> {
	if (await isInMerge(cwd)) {
		const result = await abortMerge(cwd);
		return { aborted: result.success, operation: 'merge' };
	}

	if (await isInRebase(cwd)) {
		const result = await abortRebase(cwd);
		return { aborted: result.success, operation: 'rebase' };
	}

	return { aborted: false };
}

/**
 * Resolves merge conflicts by accepting either 'ours' or 'theirs' for all files
 */
export async function resolveAllConflicts(
	cwd: string,
	resolution: 'ours' | 'theirs'
): Promise<GitOperationResult> {
	const conflictedFiles = await getConflictedFiles(cwd);

	if (conflictedFiles.length === 0) {
		return { success: true };
	}

	// Checkout the chosen version for all conflicted files
	const checkoutResult = await execGit(['checkout', `--${resolution}`, '--', ...conflictedFiles], { cwd });

	if (!checkoutResult.success) {
		return checkoutResult;
	}

	// Stage the resolved files
	return stageAllChanges(cwd);
}

/**
 * Gets detailed information about the merge state
 */
export async function getMergeState(cwd: string): Promise<{
	isInMerge: boolean;
	isInRebase: boolean;
	hasUncommittedChanges: boolean;
	conflictedFiles: string[];
	changedFiles: string[];
	currentBranch: string;
}> {
	const [inMerge, inRebase, hasChanges, conflicts, changed, branch] = await Promise.all([
		isInMerge(cwd),
		isInRebase(cwd),
		hasUncommittedChanges(cwd),
		getConflictedFiles(cwd),
		getChangedFiles(cwd),
		getCurrentBranch(cwd),
	]);

	return {
		isInMerge: inMerge,
		isInRebase: inRebase,
		hasUncommittedChanges: hasChanges,
		conflictedFiles: conflicts,
		changedFiles: changed,
		currentBranch: branch,
	};
}

/**
 * Prepares worktree changes for merge by committing if needed
 */
export async function prepareWorktreeForMerge(
	worktreePath: string,
	commitMessage?: string
): Promise<{
	ready: boolean;
	wasCommitted: boolean;
	commitHash?: string;
	error?: string;
}> {
	// Check for uncommitted changes
	if (!(await hasUncommittedChanges(worktreePath))) {
		return { ready: true, wasCommitted: false };
	}

	// Need to commit changes
	if (!commitMessage) {
		return {
			ready: false,
			wasCommitted: false,
			error: 'Worktree has uncommitted changes but no commit message was provided',
		};
	}

	// Stage all changes
	const stageResult = await stageAllChanges(worktreePath);
	if (!stageResult.success) {
		return {
			ready: false,
			wasCommitted: false,
			error: `Failed to stage changes: ${stageResult.stderr || stageResult.error}`,
		};
	}

	// Commit changes
	const commitResult = await commit(worktreePath, commitMessage);
	if (!commitResult.success) {
		return {
			ready: false,
			wasCommitted: false,
			error: `Failed to commit: ${commitResult.stderr || commitResult.error}`,
		};
	}

	// Get the commit hash
	const hashResult = await execGit(['rev-parse', 'HEAD'], { cwd: worktreePath });

	return {
		ready: true,
		wasCommitted: true,
		commitHash: hashResult.stdout?.trim(),
	};
}
