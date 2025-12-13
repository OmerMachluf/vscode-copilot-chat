/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';

/**
 * Result of a git operation
 */
export interface GitOperationResult {
	readonly success: boolean;
	readonly stdout?: string;
	readonly stderr?: string;
	readonly error?: string;
	readonly exitCode?: number;
}

/**
 * Options for executing git commands
 */
export interface GitExecOptions {
	/** Working directory for the command */
	readonly cwd: string;
	/** Maximum buffer size in bytes (default: 10MB) */
	readonly maxBuffer?: number;
	/** Timeout in milliseconds */
	readonly timeout?: number;
	/** Environment variables to add */
	readonly env?: Record<string, string>;
}

/**
 * Information about a git branch
 */
export interface GitBranchInfo {
	readonly name: string;
	readonly commit: string;
	readonly isRemote: boolean;
	readonly upstream?: string;
	readonly ahead?: number;
	readonly behind?: number;
}

/**
 * Information about a git worktree
 */
export interface GitWorktreeInfo {
	readonly path: string;
	readonly head: string;
	readonly branch?: string;
	readonly bare: boolean;
	readonly detached: boolean;
	readonly locked?: boolean;
	readonly prunable?: boolean;
}

/**
 * Executes a git command and returns the result
 */
export async function execGit(args: string[], options: GitExecOptions): Promise<GitOperationResult> {
	const { cwd, maxBuffer = 10 * 1024 * 1024, timeout, env } = options;

	return new Promise((resolve) => {
		const command = `git ${args.map(a => a.includes(' ') || a.includes('"') ? `"${a.replace(/"/g, '\\"')}"` : a).join(' ')}`;

		cp.exec(command, {
			cwd,
			maxBuffer,
			timeout,
			env: env ? { ...process.env, ...env } : undefined,
		}, (error, stdout, stderr) => {
			if (error) {
				resolve({
					success: false,
					stdout: stdout?.trim(),
					stderr: stderr?.trim(),
					error: error.message,
					exitCode: error.code,
				});
			} else {
				resolve({
					success: true,
					stdout: stdout?.trim(),
					stderr: stderr?.trim(),
					exitCode: 0,
				});
			}
		});
	});
}

/**
 * Executes a git command and throws on failure
 */
export async function execGitOrThrow(args: string[], options: GitExecOptions): Promise<string> {
	const result = await execGit(args, options);
	if (!result.success) {
		throw new Error(`Git command failed: git ${args.join(' ')}\n${result.stderr || result.error}`);
	}
	return result.stdout || '';
}

/**
 * Gets the current branch name
 */
export async function getCurrentBranch(cwd: string): Promise<string> {
	const result = await execGitOrThrow(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
	return result.trim();
}

/**
 * Gets the current commit hash
 */
export async function getCurrentCommit(cwd: string, short = false): Promise<string> {
	const args = short ? ['rev-parse', '--short', 'HEAD'] : ['rev-parse', 'HEAD'];
	const result = await execGitOrThrow(args, { cwd });
	return result.trim();
}

/**
 * Checks if there are uncommitted changes
 */
export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
	const result = await execGitOrThrow(['status', '--porcelain'], { cwd });
	return result.trim().length > 0;
}

/**
 * Gets the list of changed files (staged, unstaged, and untracked)
 */
export async function getChangedFiles(cwd: string): Promise<string[]> {
	const result = await execGitOrThrow(['status', '--porcelain'], { cwd });
	const files = new Set<string>();

	for (const line of result.split('\n')) {
		const trimmed = line.trim();
		if (trimmed) {
			// Git status format: XY filename
			// Skip the first 3 characters (status + space)
			const file = trimmed.slice(3).trim();
			// Handle renamed files: "old -> new"
			const parts = file.split(' -> ');
			files.add(parts[parts.length - 1]);
		}
	}

	return Array.from(files);
}

/**
 * Gets the diff stats between two refs
 */
export async function getDiffStats(
	cwd: string,
	fromRef: string,
	toRef: string = 'HEAD'
): Promise<{ files: number; insertions: number; deletions: number }> {
	const result = await execGit(['diff', '--stat', '--numstat', fromRef, toRef], { cwd });

	if (!result.success) {
		return { files: 0, insertions: 0, deletions: 0 };
	}

	let insertions = 0;
	let deletions = 0;
	let files = 0;

	for (const line of (result.stdout || '').split('\n')) {
		const match = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/);
		if (match) {
			files++;
			if (match[1] !== '-') {
				insertions += parseInt(match[1], 10);
			}
			if (match[2] !== '-') {
				deletions += parseInt(match[2], 10);
			}
		}
	}

	return { files, insertions, deletions };
}

/**
 * Gets the list of files changed between two refs
 */
export async function getFilesBetweenRefs(
	cwd: string,
	fromRef: string,
	toRef: string = 'HEAD'
): Promise<string[]> {
	const result = await execGit(['diff', '--name-only', fromRef, toRef], { cwd });

	if (!result.success) {
		return [];
	}

	return (result.stdout || '').split('\n').filter(f => f.trim());
}

/**
 * Stages all changes
 */
export async function stageAllChanges(cwd: string): Promise<GitOperationResult> {
	return execGit(['add', '-A'], { cwd });
}

/**
 * Commits staged changes
 */
export async function commit(cwd: string, message: string, allowEmpty = false): Promise<GitOperationResult> {
	const args = ['commit', '-m', message];
	if (allowEmpty) {
		args.push('--allow-empty');
	}
	return execGit(args, { cwd });
}

/**
 * Gets the default branch name (main or master)
 */
export async function getDefaultBranch(cwd: string): Promise<string> {
	// Try to get from remote HEAD
	const remoteResult = await execGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd });
	if (remoteResult.success && remoteResult.stdout) {
		const match = remoteResult.stdout.match(/refs\/remotes\/origin\/(.+)/);
		if (match) {
			return match[1];
		}
	}

	// Fall back to checking if main or master exists
	const mainResult = await execGit(['rev-parse', '--verify', 'main'], { cwd });
	if (mainResult.success) {
		return 'main';
	}

	const masterResult = await execGit(['rev-parse', '--verify', 'master'], { cwd });
	if (masterResult.success) {
		return 'master';
	}

	return 'main';
}

/**
 * Checks if a branch exists
 */
export async function branchExists(cwd: string, branchName: string, includeRemote = false): Promise<boolean> {
	const result = await execGit(['rev-parse', '--verify', branchName], { cwd });
	if (result.success) {
		return true;
	}

	if (includeRemote) {
		const remoteResult = await execGit(['rev-parse', '--verify', `origin/${branchName}`], { cwd });
		return remoteResult.success;
	}

	return false;
}

/**
 * Creates a new branch
 */
export async function createBranch(cwd: string, branchName: string, startPoint?: string): Promise<GitOperationResult> {
	const args = ['branch', branchName];
	if (startPoint) {
		args.push(startPoint);
	}
	return execGit(args, { cwd });
}

/**
 * Checks out a branch
 */
export async function checkout(cwd: string, branchName: string): Promise<GitOperationResult> {
	return execGit(['checkout', branchName], { cwd });
}

/**
 * Fetches from remote
 */
export async function fetch(cwd: string, remote = 'origin', ref?: string): Promise<GitOperationResult> {
	const args = ['fetch', remote];
	if (ref) {
		args.push(ref);
	}
	return execGit(args, { cwd });
}

/**
 * Pulls from remote
 */
export async function pull(cwd: string, remote = 'origin', branch?: string): Promise<GitOperationResult> {
	const args = ['pull', remote];
	if (branch) {
		args.push(branch);
	}
	return execGit(args, { cwd });
}

/**
 * Pushes to remote
 */
export async function push(cwd: string, remote = 'origin', branch?: string, force = false, setUpstream = false): Promise<GitOperationResult> {
	const args = ['push'];
	if (setUpstream) {
		args.push('-u');
	}
	args.push(remote);
	if (branch) {
		args.push(branch);
	}
	if (force) {
		args.push('--force-with-lease');
	}
	return execGit(args, { cwd });
}

/**
 * Gets the merge base between two refs
 */
export async function getMergeBase(cwd: string, ref1: string, ref2: string): Promise<string | undefined> {
	const result = await execGit(['merge-base', ref1, ref2], { cwd });
	return result.success ? result.stdout?.trim() : undefined;
}

/**
 * Lists worktrees for a repository
 */
export async function listWorktrees(cwd: string): Promise<GitWorktreeInfo[]> {
	const result = await execGit(['worktree', 'list', '--porcelain'], { cwd });

	if (!result.success || !result.stdout) {
		return [];
	}

	// Use a mutable type for building the result
	interface MutableWorktreeInfo {
		path?: string;
		head?: string;
		branch?: string;
		bare?: boolean;
		detached?: boolean;
		locked?: boolean;
		prunable?: boolean;
	}

	const worktrees: GitWorktreeInfo[] = [];
	let current: MutableWorktreeInfo = {};

	for (const line of result.stdout.split('\n')) {
		if (line.startsWith('worktree ')) {
			if (current.path) {
				worktrees.push({
					path: current.path,
					head: current.head || '',
					branch: current.branch,
					bare: current.bare || false,
					detached: current.detached || false,
					locked: current.locked,
					prunable: current.prunable,
				});
			}
			current = { path: line.slice(9).trim() };
		} else if (line.startsWith('HEAD ')) {
			current.head = line.slice(5).trim();
		} else if (line.startsWith('branch ')) {
			current.branch = line.slice(7).replace('refs/heads/', '').trim();
		} else if (line === 'bare') {
			current.bare = true;
		} else if (line === 'detached') {
			current.detached = true;
		} else if (line === 'locked') {
			current.locked = true;
		} else if (line === 'prunable') {
			current.prunable = true;
		}
	}

	if (current.path) {
		worktrees.push({
			path: current.path,
			head: current.head || '',
			branch: current.branch,
			bare: current.bare || false,
			detached: current.detached || false,
			locked: current.locked,
			prunable: current.prunable,
		});
	}

	return worktrees;
}

/**
 * Creates a worktree
 */
export async function createWorktree(
	cwd: string,
	worktreePath: string,
	options?: { branch?: string; newBranch?: string; commitish?: string; detach?: boolean }
): Promise<GitOperationResult> {
	const args = ['worktree', 'add'];

	if (options?.newBranch) {
		args.push('-b', options.newBranch);
	} else if (options?.detach) {
		args.push('--detach');
	}

	args.push(worktreePath);

	if (options?.commitish) {
		args.push(options.commitish);
	} else if (options?.branch) {
		args.push(options.branch);
	}

	return execGit(args, { cwd });
}

/**
 * Removes a worktree
 */
export async function removeWorktree(cwd: string, worktreePath: string, force = false): Promise<GitOperationResult> {
	const args = ['worktree', 'remove', worktreePath];
	if (force) {
		args.push('--force');
	}
	return execGit(args, { cwd });
}

/**
 * Prunes worktree administrative files
 */
export async function pruneWorktrees(cwd: string): Promise<GitOperationResult> {
	return execGit(['worktree', 'prune'], { cwd });
}

/**
 * Gets the main repository path from a worktree
 */
export async function getMainRepoPath(worktreePath: string): Promise<string | undefined> {
	const result = await execGit(['rev-parse', '--git-dir'], { cwd: worktreePath });

	if (!result.success || !result.stdout) {
		return undefined;
	}

	const gitDir = result.stdout.trim();

	// Check if this is a worktree (gitdir file points to .git/worktrees/name)
	if (gitDir.includes('.git/worktrees/') || gitDir.includes('.git\\worktrees\\')) {
		const match = gitDir.match(/(.+)[\/\\]\.git[\/\\]worktrees[\/\\]/);
		if (match) {
			return match[1];
		}
	}

	// If gitdir ends with .git, return the parent
	if (gitDir.endsWith('.git')) {
		return gitDir.slice(0, -5);
	}

	// Return the worktree path itself if it's the main repo
	return worktreePath;
}

/**
 * Checks if a path is inside a worktree (not the main repo)
 */
export async function isWorktree(path: string): Promise<boolean> {
	const result = await execGit(['rev-parse', '--git-dir'], { cwd: path });

	if (!result.success || !result.stdout) {
		return false;
	}

	const gitDir = result.stdout.trim();
	return gitDir.includes('.git/worktrees/') || gitDir.includes('.git\\worktrees\\');
}

/**
 * Deletes a branch
 */
export async function deleteBranch(cwd: string, branchName: string, force = false): Promise<GitOperationResult> {
	const args = ['branch', force ? '-D' : '-d', branchName];
	return execGit(args, { cwd });
}

/**
 * Deletes a remote branch
 */
export async function deleteRemoteBranch(cwd: string, remote: string, branchName: string): Promise<GitOperationResult> {
	return execGit(['push', remote, '--delete', branchName], { cwd });
}

/**
 * Aborts an in-progress merge
 */
export async function abortMerge(cwd: string): Promise<GitOperationResult> {
	return execGit(['merge', '--abort'], { cwd });
}

/**
 * Aborts an in-progress rebase
 */
export async function abortRebase(cwd: string): Promise<GitOperationResult> {
	return execGit(['rebase', '--abort'], { cwd });
}

/**
 * Checks if there's an in-progress merge
 */
export async function isInMerge(cwd: string): Promise<boolean> {
	const result = await execGit(['rev-parse', '--verify', 'MERGE_HEAD'], { cwd });
	return result.success;
}

/**
 * Checks if there's an in-progress rebase
 */
export async function isInRebase(cwd: string): Promise<boolean> {
	const result = await execGit(['rev-parse', '--verify', 'REBASE_HEAD'], { cwd });
	return result.success;
}

/**
 * Gets list of files with merge conflicts
 */
export async function getConflictedFiles(cwd: string): Promise<string[]> {
	const result = await execGit(['diff', '--name-only', '--diff-filter=U'], { cwd });

	if (!result.success || !result.stdout) {
		return [];
	}

	return result.stdout.split('\n').filter(f => f.trim());
}

/**
 * Resets the repository to a specific state
 */
export async function reset(cwd: string, ref: string, mode: 'soft' | 'mixed' | 'hard' = 'mixed'): Promise<GitOperationResult> {
	return execGit(['reset', `--${mode}`, ref], { cwd });
}

/**
 * Cleans untracked files
 */
export async function clean(cwd: string, options?: { directories?: boolean; force?: boolean }): Promise<GitOperationResult> {
	const args = ['clean'];
	if (options?.force) {
		args.push('-f');
	}
	if (options?.directories) {
		args.push('-d');
	}
	return execGit(args, { cwd });
}

/**
 * Stashes changes
 */
export async function stash(cwd: string, message?: string, includeUntracked = false): Promise<GitOperationResult> {
	const args = ['stash', 'push'];
	if (includeUntracked) {
		args.push('-u');
	}
	if (message) {
		args.push('-m', message);
	}
	return execGit(args, { cwd });
}

/**
 * Pops the top stash entry
 */
export async function stashPop(cwd: string): Promise<GitOperationResult> {
	return execGit(['stash', 'pop'], { cwd });
}

/**
 * Gets the commit log
 */
export async function getLog(cwd: string, options?: {
	maxCount?: number;
	format?: string;
	ref?: string;
}): Promise<string> {
	const args = ['log'];
	if (options?.maxCount) {
		args.push(`-${options.maxCount}`);
	}
	if (options?.format) {
		args.push(`--format=${options.format}`);
	}
	if (options?.ref) {
		args.push(options.ref);
	}
	const result = await execGit(args, { cwd });
	return result.stdout || '';
}
