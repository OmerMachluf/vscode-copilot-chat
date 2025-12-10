/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkerSession } from './workerSession';
import { IOrchestratorPermissionService } from './orchestratorPermissions';
import { ILogService } from '../../platform/log/common/logService';
import * as cp from 'child_process';

/**
 * Summary of a worker's completed work
 */
export interface ICompletionSummary {
	/**
	 * ID of the task that was completed
	 */
	taskId: string;

	/**
	 * ID of the worker that completed the task
	 */
	workerId: string;

	/**
	 * List of files that were modified by the worker
	 */
	filesModified: string[];

	/**
	 * List of files that were created by the worker
	 */
	filesCreated: string[];

	/**
	 * List of tests that were added by the worker
	 */
	testsAdded: string[];

	/**
	 * List of commit messages from the worker's branch
	 */
	commitMessages: string[];

	/**
	 * Overall summary of the work done
	 */
	summary: string;

	/**
	 * Branch name where work was done
	 */
	branchName: string;

	/**
	 * Worktree path where work was done
	 */
	worktreePath: string;
}

/**
 * Options for completing a worker's task
 */
export type ICompletionOptions =
	| 'approve_and_merge'
	| 'create_pr'
	| 'request_changes'
	| 'send_to_reviewer';

/**
 * Result of handling a completion
 */
export interface ICompletionResult {
	/**
	 * Whether the completion was successful
	 */
	success: boolean;

	/**
	 * Action that was taken
	 */
	action: ICompletionOptions;

	/**
	 * Error message if unsuccessful
	 */
	error?: string;

	/**
	 * PR URL if a PR was created
	 */
	prUrl?: string;

	/**
	 * Whether the branch was merged
	 */
	merged?: boolean;

	/**
	 * Whether the worktree was cleaned up
	 */
	worktreeCleaned?: boolean;
}

/**
 * Result of creating a pull request
 */
export interface IPullRequestResult {
	/**
	 * Whether PR creation was successful
	 */
	success: boolean;

	/**
	 * URL of the created PR
	 */
	prUrl?: string;

	/**
	 * PR number
	 */
	prNumber?: number;

	/**
	 * Error message if unsuccessful
	 */
	error?: string;
}

/**
 * Result of merging a branch
 */
export interface IMergeResult {
	/**
	 * Whether the merge was successful
	 */
	success: boolean;

	/**
	 * Whether there were merge conflicts
	 */
	hasConflicts?: boolean;

	/**
	 * List of conflicting files
	 */
	conflictingFiles?: string[];

	/**
	 * Error message if unsuccessful
	 */
	error?: string;
}

/**
 * Result of worktree cleanup
 */
export interface ICleanupResult {
	/**
	 * Whether cleanup was successful
	 */
	success: boolean;

	/**
	 * Error message if unsuccessful
	 */
	error?: string;
}

/**
 * Options for creating a pull request
 */
export interface IPullRequestOptions {
	/**
	 * Title for the PR (auto-generated if not provided)
	 */
	title?: string;

	/**
	 * Body/description for the PR (auto-generated if not provided)
	 */
	body?: string;

	/**
	 * Target branch for the PR (defaults to main/master)
	 */
	baseBranch?: string;

	/**
	 * Source branch for the PR
	 */
	headBranch: string;

	/**
	 * Worktree path where branch exists
	 */
	worktreePath: string;

	/**
	 * Completion summary to use for auto-generating title/body
	 */
	summary?: ICompletionSummary;

	/**
	 * Labels to add to the PR
	 */
	labels?: string[];

	/**
	 * Whether to create as draft PR
	 */
	draft?: boolean;
}

/**
 * Options for merging a branch
 */
export interface IMergeOptions {
	/**
	 * Source branch to merge
	 */
	sourceBranch: string;

	/**
	 * Target branch to merge into (defaults to main/master)
	 */
	targetBranch?: string;

	/**
	 * Worktree path
	 */
	worktreePath: string;

	/**
	 * Merge strategy: 'merge', 'squash', or 'rebase'
	 */
	strategy?: 'merge' | 'squash' | 'rebase';

	/**
	 * Commit message for the merge
	 */
	commitMessage?: string;

	/**
	 * Whether to delete the source branch after merge
	 */
	deleteBranchAfterMerge?: boolean;
}

/**
 * Service for managing worker completion workflows including PR creation,
 * merge handling, and worktree cleanup
 */
export class CompletionManager {
	constructor(
		private readonly permissionService: IOrchestratorPermissionService,
		private readonly logService: ILogService,
		private readonly execGit: (args: string[], cwd: string) => Promise<string> = defaultExecGit,
		private readonly execCommand: (command: string, args: string[], cwd: string) => Promise<string> = defaultExecCommand
	) { }

	/**
	 * Generate a completion summary for a worker
	 */
	async generateCompletionSummary(worker: WorkerSession): Promise<ICompletionSummary> {
		const worktreePath = worker.worktreePath;
		// Worker branch is derived from the worktree - typically the worktree name is the branch name
		const branchName = this.extractBranchFromWorktree(worktreePath);

		if (!worktreePath) {
			throw new Error(`Worker ${worker.id} does not have a worktree path`);
		}

		// Get the list of files modified/created
		const diffOutput = await this.execGit(['diff', '--name-status', 'HEAD~10..HEAD'], worktreePath).catch(() => '');
		const { modified, created } = this.parseDiffOutput(diffOutput);

		// Get commit messages
		const logOutput = await this.execGit(['log', '--oneline', 'HEAD~10..HEAD'], worktreePath).catch(() => '');
		const commitMessages = this.parseCommitMessages(logOutput);

		// Find test files
		const testsAdded = created.filter(f => this.isTestFile(f));

		// Generate summary from commit messages
		const summary = this.generateSummaryFromCommits(commitMessages, modified, created);

		// Use planId as taskId (plan is the overarching task)
		const taskId = worker.planId || worker.name;

		return {
			taskId,
			workerId: worker.id,
			filesModified: modified,
			filesCreated: created,
			testsAdded,
			commitMessages,
			summary,
			branchName,
			worktreePath,
		};
	}

	/**
	 * Handle the completion of a worker based on the selected action
	 */
	async handleCompletion(
		worker: WorkerSession,
		action: ICompletionOptions,
		feedback?: string
	): Promise<ICompletionResult> {
		this.logService.info(`[CompletionManager] Handling completion for worker ${worker.id} with action: ${action}`);

		const summary = await this.generateCompletionSummary(worker);

		switch (action) {
			case 'approve_and_merge':
				return this.handleApproveAndMerge(worker, summary);

			case 'create_pr':
				return this.handleCreatePR(worker, summary);

			case 'request_changes':
				return this.handleRequestChanges(worker, feedback);

			case 'send_to_reviewer':
				return this.handleSendToReviewer(worker, summary);

			default:
				return {
					success: false,
					action,
					error: `Unknown completion action: ${action}`,
				};
		}
	}

	/**
	 * Create a pull request for a worker's changes
	 */
	async createPullRequest(options: IPullRequestOptions): Promise<IPullRequestResult> {
		// Check permission
		const permission = this.permissionService.evaluatePermission('pr_creation');
		if (permission === 'auto_deny') {
			return {
				success: false,
				error: 'PR creation is denied by permission settings',
			};
		}

		const { worktreePath, headBranch, baseBranch = 'main', summary, draft = false, labels = [] } = options;

		// Auto-generate title and body if not provided
		const title = options.title || this.generatePRTitle(summary);
		const body = options.body || this.generatePRBody(summary);

		try {
			// First push the branch to remote
			await this.execGit(['push', '-u', 'origin', headBranch], worktreePath);

			// Create the PR using GitHub CLI
			const args = [
				'pr', 'create',
				'--title', title,
				'--body', body,
				'--base', baseBranch,
				'--head', headBranch,
			];

			if (draft) {
				args.push('--draft');
			}

			for (const label of labels) {
				args.push('--label', label);
			}

			const output = await this.execCommand('gh', args, worktreePath);

			// Parse PR URL from output
			const prUrl = this.extractPRUrl(output);
			const prNumber = this.extractPRNumber(prUrl);

			this.logService.info(`[CompletionManager] Created PR: ${prUrl}`);

			return {
				success: true,
				prUrl,
				prNumber,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logService.warn(`[CompletionManager] Failed to create PR: ${errorMessage}`);

			return {
				success: false,
				error: errorMessage,
			};
		}
	}

	/**
	 * Merge a worker's branch into the target branch
	 */
	async mergeWorkerBranch(options: IMergeOptions): Promise<IMergeResult> {
		// Check permission
		const permission = this.permissionService.evaluatePermission('branch_merge');
		if (permission === 'auto_deny') {
			return {
				success: false,
				error: 'Branch merge is denied by permission settings',
			};
		}

		const {
			sourceBranch,
			targetBranch = 'main',
			worktreePath,
			strategy = 'merge',
			commitMessage,
			deleteBranchAfterMerge = false,
		} = options;

		try {
			// Fetch latest from remote
			await this.execGit(['fetch', 'origin'], worktreePath);

			// Checkout target branch
			await this.execGit(['checkout', targetBranch], worktreePath);

			// Pull latest
			await this.execGit(['pull', 'origin', targetBranch], worktreePath);

			// Check for conflicts
			const hasConflicts = await this.checkForMergeConflicts(sourceBranch, targetBranch, worktreePath);
			if (hasConflicts.hasConflicts) {
				return hasConflicts;
			}

			// Perform merge based on strategy
			let mergeArgs: string[];
			switch (strategy) {
				case 'squash':
					mergeArgs = ['merge', '--squash', sourceBranch];
					break;
				case 'rebase':
					mergeArgs = ['rebase', sourceBranch];
					break;
				default:
					mergeArgs = ['merge', sourceBranch];
			}

			if (commitMessage && strategy !== 'rebase') {
				mergeArgs.push('-m', commitMessage);
			}

			await this.execGit(mergeArgs, worktreePath);

			// For squash merges, we need to commit separately
			if (strategy === 'squash') {
				const squashMessage = commitMessage || `Merged ${sourceBranch} into ${targetBranch}`;
				await this.execGit(['commit', '-m', squashMessage], worktreePath);
			}

			// Push the merge
			await this.execGit(['push', 'origin', targetBranch], worktreePath);

			// Delete source branch if requested
			if (deleteBranchAfterMerge) {
				await this.execGit(['branch', '-d', sourceBranch], worktreePath).catch(() => { });
				await this.execGit(['push', 'origin', '--delete', sourceBranch], worktreePath).catch(() => { });
			}

			this.logService.info(`[CompletionManager] Successfully merged ${sourceBranch} into ${targetBranch}`);

			return {
				success: true,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logService.warn(`[CompletionManager] Failed to merge: ${errorMessage}`);

			// Try to recover from failed merge
			await this.execGit(['merge', '--abort'], worktreePath).catch(() => { });
			await this.execGit(['rebase', '--abort'], worktreePath).catch(() => { });

			return {
				success: false,
				error: errorMessage,
			};
		}
	}

	/**
	 * Clean up a worker's worktree after successful merge
	 */
	async cleanupWorktree(worktreePath: string, branchName: string): Promise<ICleanupResult> {
		// Check permission
		const permission = this.permissionService.evaluatePermission('worktree_cleanup');
		if (permission === 'auto_deny') {
			return {
				success: false,
				error: 'Worktree cleanup is denied by permission settings',
			};
		}

		try {
			// Get the main repo path (parent of worktrees folder)
			const mainRepoPath = await this.getMainRepoPath(worktreePath);

			// Remove the worktree
			await this.execGit(['worktree', 'remove', worktreePath, '--force'], mainRepoPath);

			// Delete the branch locally
			await this.execGit(['branch', '-D', branchName], mainRepoPath).catch(() => { });

			this.logService.info(`[CompletionManager] Cleaned up worktree: ${worktreePath}`);

			return {
				success: true,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logService.warn(`[CompletionManager] Failed to cleanup worktree: ${errorMessage}`);

			return {
				success: false,
				error: errorMessage,
			};
		}
	}

	/**
	 * Spawn a reviewer worker for the given changes
	 */
	async spawnReviewer(summary: ICompletionSummary): Promise<void> {
		// This would integrate with the orchestrator to spawn a reviewer worker
		// The actual implementation depends on the orchestrator's API
		this.logService.info(`[CompletionManager] Spawning reviewer for task ${summary.taskId}`);
		// TODO: Implement reviewer spawning through orchestrator service
	}

	// Private helper methods

	private async handleApproveAndMerge(
		worker: WorkerSession,
		summary: ICompletionSummary
	): Promise<ICompletionResult> {
		const mergeResult = await this.mergeWorkerBranch({
			sourceBranch: summary.branchName,
			worktreePath: summary.worktreePath,
			strategy: 'squash',
			commitMessage: summary.summary,
			deleteBranchAfterMerge: true,
		});

		if (!mergeResult.success) {
			if (mergeResult.hasConflicts) {
				return {
					success: false,
					action: 'approve_and_merge',
					error: `Merge conflicts detected in: ${mergeResult.conflictingFiles?.join(', ')}`,
					merged: false,
				};
			}
			return {
				success: false,
				action: 'approve_and_merge',
				error: mergeResult.error,
				merged: false,
			};
		}

		// Cleanup worktree after successful merge
		const cleanupResult = await this.cleanupWorktree(summary.worktreePath, summary.branchName);

		return {
			success: true,
			action: 'approve_and_merge',
			merged: true,
			worktreeCleaned: cleanupResult.success,
		};
	}

	private async handleCreatePR(
		worker: WorkerSession,
		summary: ICompletionSummary
	): Promise<ICompletionResult> {
		const prResult = await this.createPullRequest({
			headBranch: summary.branchName,
			worktreePath: summary.worktreePath,
			summary,
		});

		return {
			success: prResult.success,
			action: 'create_pr',
			prUrl: prResult.prUrl,
			error: prResult.error,
		};
	}

	private async handleRequestChanges(
		worker: WorkerSession,
		feedback?: string
	): Promise<ICompletionResult> {
		// Send feedback back to the worker for revision
		if (feedback) {
			// This would send the feedback through the messaging system
			this.logService.info(`[CompletionManager] Requesting changes for worker ${worker.id}: ${feedback}`);
		}

		return {
			success: true,
			action: 'request_changes',
		};
	}

	private async handleSendToReviewer(
		worker: WorkerSession,
		summary: ICompletionSummary
	): Promise<ICompletionResult> {
		await this.spawnReviewer(summary);

		return {
			success: true,
			action: 'send_to_reviewer',
		};
	}

	private parseDiffOutput(output: string): { modified: string[]; created: string[] } {
		const modified: string[] = [];
		const created: string[] = [];

		const lines = output.split('\n').filter(l => l.trim());
		for (const line of lines) {
			const [status, file] = line.split('\t');
			if (!file) {
				continue;
			}

			switch (status?.charAt(0)) {
				case 'A':
					created.push(file);
					break;
				case 'M':
				case 'R':
				case 'C':
					modified.push(file);
					break;
			}
		}

		return { modified, created };
	}

	private parseCommitMessages(output: string): string[] {
		return output
			.split('\n')
			.filter(l => l.trim())
			.map(l => {
				// Remove the commit hash prefix (7 chars + space)
				const parts = l.split(' ');
				return parts.slice(1).join(' ');
			})
			.filter(msg => msg.length > 0);
	}

	private isTestFile(filename: string): boolean {
		const testPatterns = [
			/\.test\.[tj]sx?$/,
			/\.spec\.[tj]sx?$/,
			/test\/.*\.[tj]sx?$/,
			/__tests__\/.*\.[tj]sx?$/,
		];
		return testPatterns.some(pattern => pattern.test(filename));
	}

	private generateSummaryFromCommits(
		commits: string[],
		modified: string[],
		created: string[]
	): string {
		const parts: string[] = [];

		if (commits.length > 0) {
			parts.push(`Changes: ${commits.slice(0, 3).join('; ')}`);
		}

		if (modified.length > 0) {
			parts.push(`Modified ${modified.length} file(s)`);
		}

		if (created.length > 0) {
			parts.push(`Created ${created.length} file(s)`);
		}

		return parts.join('. ') || 'No changes detected';
	}

	private generatePRTitle(summary?: ICompletionSummary): string {
		if (!summary) {
			return 'Worker changes';
		}

		// Use first commit message or generate from task
		if (summary.commitMessages.length > 0) {
			return summary.commitMessages[0];
		}

		return `Task ${summary.taskId}: ${summary.summary.substring(0, 50)}`;
	}

	private generatePRBody(summary?: ICompletionSummary): string {
		if (!summary) {
			return 'Automated changes by Copilot worker.';
		}

		const lines: string[] = [
			`## Summary`,
			summary.summary,
			'',
			'## Changes',
		];

		if (summary.filesModified.length > 0) {
			lines.push('### Modified Files');
			for (const file of summary.filesModified.slice(0, 10)) {
				lines.push(`- \`${file}\``);
			}
			if (summary.filesModified.length > 10) {
				lines.push(`- ... and ${summary.filesModified.length - 10} more`);
			}
			lines.push('');
		}

		if (summary.filesCreated.length > 0) {
			lines.push('### Created Files');
			for (const file of summary.filesCreated.slice(0, 10)) {
				lines.push(`- \`${file}\``);
			}
			if (summary.filesCreated.length > 10) {
				lines.push(`- ... and ${summary.filesCreated.length - 10} more`);
			}
			lines.push('');
		}

		if (summary.testsAdded.length > 0) {
			lines.push('### Tests Added');
			for (const test of summary.testsAdded) {
				lines.push(`- \`${test}\``);
			}
			lines.push('');
		}

		lines.push('---');
		lines.push(`*Worker ID: ${summary.workerId}*`);
		lines.push(`*Task ID: ${summary.taskId}*`);

		return lines.join('\n');
	}

	private extractPRUrl(output: string): string {
		// GitHub CLI outputs the PR URL on success
		const urlMatch = output.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
		return urlMatch ? urlMatch[0] : '';
	}

	private extractPRNumber(prUrl: string): number | undefined {
		const match = prUrl.match(/\/pull\/(\d+)$/);
		return match ? parseInt(match[1], 10) : undefined;
	}

	private async checkForMergeConflicts(
		sourceBranch: string,
		targetBranch: string,
		worktreePath: string
	): Promise<IMergeResult> {
		try {
			// Try a dry-run merge to check for conflicts
			await this.execGit(['merge', '--no-commit', '--no-ff', sourceBranch], worktreePath);
			// If successful, abort the merge (we just wanted to check)
			await this.execGit(['merge', '--abort'], worktreePath);

			return { success: true };
		} catch (error) {
			// Check if it's a conflict error
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (errorMessage.includes('CONFLICT') || errorMessage.includes('Automatic merge failed')) {
				// Get conflicting files
				try {
					const statusOutput = await this.execGit(['diff', '--name-only', '--diff-filter=U'], worktreePath);
					const conflictingFiles = statusOutput.split('\n').filter(f => f.trim());

					// Abort the failed merge
					await this.execGit(['merge', '--abort'], worktreePath).catch(() => { });

					return {
						success: false,
						hasConflicts: true,
						conflictingFiles,
					};
				} catch {
					// Abort the failed merge
					await this.execGit(['merge', '--abort'], worktreePath).catch(() => { });

					return {
						success: false,
						hasConflicts: true,
					};
				}
			}

			return {
				success: false,
				error: errorMessage,
			};
		}
	}

	private async getMainRepoPath(worktreePath: string): Promise<string> {
		// Get the git dir and derive the main repo path
		const gitDir = await this.execGit(['rev-parse', '--git-dir'], worktreePath);
		// For worktrees, the git dir is usually .git/worktrees/<name>
		// The main repo is two levels up from there
		const normalized = gitDir.trim();
		if (normalized.includes('.git/worktrees/')) {
			const parts = normalized.split('.git/worktrees/');
			return parts[0];
		}
		// Fallback: just use the parent of .git
		return normalized.replace(/\/.git$/, '').replace(/\\.git$/, '');
	}

	private extractBranchFromWorktree(worktreePath: string): string {
		// Extract branch name from worktree path
		// Typically: /path/to/.worktrees/branch-name
		const parts = worktreePath.split(/[/\\]/);
		const worktreesIndex = parts.findIndex(p => p === '.worktrees');
		if (worktreesIndex >= 0 && parts.length > worktreesIndex + 1) {
			return parts[worktreesIndex + 1];
		}
		// Fallback to last part of path
		return parts[parts.length - 1] || '';
	}
}

// Default implementation for executing git commands
async function defaultExecGit(args: string[], cwd: string): Promise<string> {
	return new Promise((resolve, reject) => {
		cp.exec(`git ${args.map(a => `"${a}"`).join(' ')}`, { cwd }, (err, stdout, stderr) => {
			if (err) {
				reject(new Error(stderr || err.message));
			} else {
				resolve(stdout);
			}
		});
	});
}

// Default implementation for executing arbitrary commands
async function defaultExecCommand(command: string, args: string[], cwd: string): Promise<string> {
	return new Promise((resolve, reject) => {
		cp.exec(`${command} ${args.map(a => `"${a}"`).join(' ')}`, { cwd }, (err, stdout, stderr) => {
			if (err) {
				reject(new Error(stderr || err.message));
			} else {
				resolve(stdout);
			}
		});
	});
}
