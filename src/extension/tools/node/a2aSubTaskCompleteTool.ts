/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import { CancellationToken, LanguageModelTextPart, LanguageModelToolInvocationOptions, LanguageModelToolInvocationPrepareOptions, LanguageModelToolResult, ProviderResult } from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { IOrchestratorQueueService } from '../../orchestrator/orchestratorQueue';
import { ISubTaskManager, ISubTaskResult } from '../../orchestrator/subTaskManager';
import { IWorkerContext } from '../../orchestrator/workerToolsService';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

interface A2ASubTaskCompleteParams {
	status: 'success' | 'partial' | 'failed';
	output: string;
	outputFile?: string;
	metadata?: Record<string, unknown>;
	error?: string;
	/** Sub-task ID to complete */
	subTaskId: string;
	/**
	 * If provided, commits changes and merges to target branch before completing.
	 * Only works when running in a worktree.
	 */
	commitMessage?: string;
	/**
	 * Merge strategy when commitMessage is provided: 'merge', 'squash', or 'rebase'.
	 * Default: 'squash'
	 */
	mergeStrategy?: 'merge' | 'squash' | 'rebase';
	/**
	 * Whether to delete the source branch after merge.
	 * Default: true
	 */
	deleteBranchAfterMerge?: boolean;
}

interface IGitWorkResult {
	success: boolean;
	error?: string;
	filesChanged?: string[];
	hasConflicts?: boolean;
	conflictingFiles?: string[];
}

interface IWorktreeChangeSummary {
	readonly changedFiles: string[];
	readonly hasChanges: boolean;
}

/**
 * Helper function to execute git commands
 */
async function execGit(args: string[], cwd: string): Promise<string> {
	return new Promise((resolve, reject) => {
		cp.exec(`git ${args.map(a => `"${a}"`).join(' ')}`, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
			if (err) {
				reject(new Error(stderr || err.message));
			} else {
				resolve(stdout.trim());
			}
		});
	});
}

export class A2ASubTaskCompleteTool implements ICopilotTool<A2ASubTaskCompleteParams> {
	static readonly toolName = ToolName.A2ASubTaskComplete;

	constructor(
		@ISubTaskManager private readonly _subTaskManager: ISubTaskManager,
		@IOrchestratorQueueService private readonly _queueService: IOrchestratorQueueService,
		@IWorkerContext private readonly _workerContext: IWorkerContext,
		@ILogService private readonly _logService: ILogService,
	) { }

	get enabled(): boolean {
		return this._workerContext !== undefined;
	}

	prepareInvocation(options: LanguageModelToolInvocationPrepareOptions<A2ASubTaskCompleteParams>, _token: CancellationToken): ProviderResult<any> {
		// Show invocation message if doing git work
		if (options.input.commitMessage) {
			return { invocationMessage: 'Completing work and merging changes...' };
		}
		return { presentation: 'hidden' };
	}

	async invoke(
		options: LanguageModelToolInvocationOptions<A2ASubTaskCompleteParams>,
		_token: CancellationToken
	): Promise<LanguageModelToolResult> {
		const {
			subTaskId,
			status,
			output,
			outputFile,
			metadata,
			error,
			commitMessage,
			mergeStrategy = 'squash',
			deleteBranchAfterMerge = true,
		} = options.input;

		const worktreePath = this._workerContext.worktreePath;

		// If commitMessage provided and we have a worktree, do git workflow
		if (commitMessage && worktreePath) {
			return this._completeWithGitWorkflow(subTaskId, status, output, commitMessage, mergeStrategy, deleteBranchAfterMerge, metadata);
		}

		// Standard completion without git workflow
		return this._standardComplete(subTaskId, status, output, outputFile, metadata, error);
	}

	private async _standardComplete(
		subTaskId: string,
		status: 'success' | 'partial' | 'failed',
		output: string,
		outputFile?: string,
		metadata?: Record<string, unknown>,
		error?: string,
	): Promise<LanguageModelToolResult> {
		try {
			const worktreePath = this._workerContext.worktreePath;
			const changeSummary = worktreePath ? await this._getWorktreeChangeSummary(worktreePath) : undefined;

			const result: ISubTaskResult = {
				taskId: subTaskId,
				status,
				output,
				outputFile,
				metadata: {
					...metadata,
					completedViaTool: true,
					changedFiles: changeSummary?.changedFiles,
					hasChanges: changeSummary?.hasChanges,
				},
				error,
			};
			this._subTaskManager.updateStatus(subTaskId, status === 'success' ? 'completed' : 'failed', result);

			const targetDescription = this._workerContext.owner
				? `${this._workerContext.owner.ownerType} (${this._workerContext.owner.ownerId})`
				: 'orchestrator';

			this._logService.info(`[A2ASubTaskCompleteTool] Sending completion to ${targetDescription}`);

			this._queueService.enqueueMessage({
				id: generateUuid(),
				timestamp: Date.now(),
				planId: this._workerContext.planId ?? 'standalone',
				taskId: subTaskId,
				workerId: this._workerContext.workerId,
				worktreePath: this._workerContext.worktreePath,
				depth: this._workerContext.depth,
				owner: this._workerContext.owner,
				type: 'completion',
				priority: 'normal',
				content: result
			});

			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Sub-task completion recorded and ${targetDescription} notified.`),
			]);
		} catch (e) {
			this._logService.error(e instanceof Error ? e : String(e), `[A2ASubTaskCompleteTool] Failed to complete sub-task`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`ERROR: Failed to complete sub-task: ${e instanceof Error ? e.message : String(e)}`),
			]);
		}
	}

	private async _completeWithGitWorkflow(
		subTaskId: string,
		status: 'success' | 'partial' | 'failed',
		output: string,
		commitMessage: string,
		mergeStrategy: 'merge' | 'squash' | 'rebase',
		deleteBranchAfterMerge: boolean,
		metadata?: Record<string, unknown>,
	): Promise<LanguageModelToolResult> {
		const worktreePath = this._workerContext.worktreePath;

		this._logService.info(`[A2ASubTaskCompleteTool] Starting git workflow for subtask ${subTaskId}`);
		this._logService.debug(`[A2ASubTaskCompleteTool] Worktree: ${worktreePath}`);

		try {
			// Step 1: Get current branch name
			const branchName = await this._getCurrentBranch(worktreePath);
			this._logService.info(`[A2ASubTaskCompleteTool] Current branch: ${branchName}`);

			// Step 2: Stage and commit changes
			const commitResult = await this._commitChanges(worktreePath, commitMessage);
			if (!commitResult.success) {
				return this._reportGitError(subTaskId, commitResult.error || 'Failed to commit changes', output, metadata);
			}

			// If there were no changes to commit, do not attempt to merge/push/cleanup.
			// This prevents confusing failures like "nothing to commit" after a squash merge.
			if (commitResult.filesChanged && commitResult.filesChanged.length === 0) {
				const result: ISubTaskResult = {
					taskId: subTaskId,
					status: status === 'success' ? 'partial' : status,
					output,
					metadata: {
						...metadata,
						completedViaTool: true,
						noChangesToCommit: true,
						filesChanged: [],
					},
					error: status === 'success' ? 'No file changes detected in the worktree to commit/merge.' : undefined,
				};

				this._subTaskManager.updateStatus(subTaskId, result.status === 'success' ? 'completed' : 'failed', result);
				this._sendCompletionMessage(result);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(
						`✓ Completion recorded, but no file changes were found.\n` +
						`  - No commit/merge performed\n` +
						`  - Parent agent notified`
					),
				]);
			}

			// Step 3: Get files changed for report
			const filesChanged = await this._getFilesChanged(worktreePath);
			this._logService.debug(`[A2ASubTaskCompleteTool] Files changed: ${filesChanged.length}`);

			// Step 4: Determine target branch and merge
			const targetBranch = await this._getTargetBranch(worktreePath);
			this._logService.info(`[A2ASubTaskCompleteTool] Merging ${branchName} into ${targetBranch} using ${mergeStrategy}`);

			const mergeResult = await this._mergeBranch(worktreePath, branchName, targetBranch, mergeStrategy, commitMessage);
			if (!mergeResult.success) {
				if (mergeResult.hasConflicts) {
					return this._reportConflicts(subTaskId, mergeResult.conflictingFiles || [], output, metadata);
				}
				return this._reportGitError(subTaskId, mergeResult.error || 'Failed to merge branch', output, metadata);
			}

			// Step 5: Push changes (non-fatal if fails)
			const pushResult = await this._pushChanges(worktreePath, targetBranch);
			if (!pushResult.success) {
				this._logService.warn(`[A2ASubTaskCompleteTool] Push failed (non-fatal): ${pushResult.error}`);
			}

			// Step 6: Cleanup worktree (non-fatal if fails)
			const cleanupResult = await this._cleanupWorktree(worktreePath, branchName, deleteBranchAfterMerge);
			if (!cleanupResult.success) {
				this._logService.warn(`[A2ASubTaskCompleteTool] Worktree cleanup failed (non-fatal): ${cleanupResult.error}`);
			}

			// Step 7: Report success
			return this._reportGitSuccess(subTaskId, status, output, filesChanged, targetBranch, metadata);

		} catch (e) {
			const errorMessage = e instanceof Error ? e.message : String(e);
			this._logService.error(e instanceof Error ? e : errorMessage, `[A2ASubTaskCompleteTool] Unexpected error`);
			return this._reportGitError(subTaskId, errorMessage, output, metadata);
		}
	}

	// --- Git helper methods ---

	private async _getCurrentBranch(worktreePath: string): Promise<string> {
		return execGit(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath);
	}

	private async _getTargetBranch(worktreePath: string): Promise<string> {
		try {
			const remoteBranch = await execGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], worktreePath);
			const match = remoteBranch.match(/refs\/remotes\/origin\/(.+)/);
			if (match) {
				return match[1];
			}
		} catch { /* ignore */ }

		for (const branch of ['main', 'master']) {
			try {
				await execGit(['rev-parse', '--verify', branch], worktreePath);
				return branch;
			} catch { /* ignore */ }
		}
		return 'main';
	}

	private async _commitChanges(worktreePath: string, commitMessage: string): Promise<IGitWorkResult> {
		try {
			const status = await execGit(['status', '--porcelain'], worktreePath);
			if (!status.trim()) {
				this._logService.info(`[A2ASubTaskCompleteTool] No changes to commit`);
				return { success: true, filesChanged: [] };
			}

			await execGit(['add', '-A'], worktreePath);
			await execGit(['commit', '-m', commitMessage], worktreePath);

			this._logService.info(`[A2ASubTaskCompleteTool] Changes committed successfully`);
			return { success: true };
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e);
			this._logService.error(e instanceof Error ? e : error, `[A2ASubTaskCompleteTool] Commit failed`);
			return { success: false, error };
		}
	}

	private async _getFilesChanged(worktreePath: string): Promise<string[]> {
		try {
			const output = await execGit(['diff', '--name-only', 'HEAD~1..HEAD'], worktreePath);
			return output.split('\n').filter(f => f.trim());
		} catch {
			return [];
		}
	}

	private async _mergeBranch(
		worktreePath: string,
		sourceBranch: string,
		targetBranch: string,
		strategy: 'merge' | 'squash' | 'rebase',
		commitMessage: string
	): Promise<IGitWorkResult> {
		try {
			await execGit(['fetch', 'origin'], worktreePath);
			await execGit(['checkout', targetBranch], worktreePath);

			try {
				await execGit(['pull', 'origin', targetBranch], worktreePath);
			} catch {
				// Pull might fail if branch doesn't exist on remote yet
			}

			let mergeArgs: string[];
			switch (strategy) {
				case 'squash':
					mergeArgs = ['merge', '--squash', sourceBranch];
					break;
				case 'rebase':
					mergeArgs = ['rebase', sourceBranch];
					break;
				default:
					mergeArgs = ['merge', sourceBranch, '-m', commitMessage];
			}

			await execGit(mergeArgs, worktreePath);

			if (strategy === 'squash') {
				await execGit(['commit', '-m', commitMessage], worktreePath);
			}

			return { success: true };
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e);

			try { await execGit(['merge', '--abort'], worktreePath); } catch { /* ignore */ }
			try { await execGit(['rebase', '--abort'], worktreePath); } catch { /* ignore */ }

			// Check if it's a conflict
			if (error.includes('CONFLICT') || error.includes('conflict')) {
				return { success: false, hasConflicts: true, error };
			}

			return { success: false, error };
		}
	}

	private async _pushChanges(worktreePath: string, targetBranch: string): Promise<IGitWorkResult> {
		try {
			await execGit(['push', 'origin', targetBranch], worktreePath);
			return { success: true };
		} catch (e) {
			return { success: false, error: e instanceof Error ? e.message : String(e) };
		}
	}

	private async _cleanupWorktree(worktreePath: string, branchName: string, deleteBranch: boolean): Promise<IGitWorkResult> {
		try {
			const gitDir = await execGit(['rev-parse', '--git-dir'], worktreePath);
			let mainRepoPath = worktreePath;

			if (gitDir.includes('.git/worktrees/')) {
				const match = gitDir.match(/(.+)\.git\/worktrees\//);
				if (match) {
					mainRepoPath = match[1];
				}
			} else if (gitDir.endsWith('.git')) {
				mainRepoPath = gitDir.slice(0, -5);
			}

			await execGit(['worktree', 'remove', worktreePath, '--force'], mainRepoPath);

			if (deleteBranch) {
				try { await execGit(['branch', '-D', branchName], mainRepoPath); } catch { /* ignore */ }
				try { await execGit(['push', 'origin', '--delete', branchName], mainRepoPath); } catch { /* ignore */ }
			}

			return { success: true };
		} catch (e) {
			return { success: false, error: e instanceof Error ? e.message : String(e) };
		}
	}

	private async _getWorktreeChangeSummary(worktreePath: string): Promise<IWorktreeChangeSummary> {
		try {
			const status = await execGit(['status', '--porcelain'], worktreePath);
			const files = new Set<string>();
			for (const line of status.split('\n').map(l => l.trim()).filter(Boolean)) {
				const file = line.slice(3).trim();
				if (file) {
					files.add(file);
				}
			}
			return {
				changedFiles: [...files.values()],
				hasChanges: files.size > 0,
			};
		} catch {
			return { changedFiles: [], hasChanges: false };
		}
	}

	// --- Reporting methods ---

	private _reportGitSuccess(
		subTaskId: string,
		status: 'success' | 'partial' | 'failed',
		output: string,
		filesChanged: string[],
		targetBranch: string,
		metadata?: Record<string, unknown>,
	): LanguageModelToolResult {
		const result: ISubTaskResult = {
			taskId: subTaskId,
			status,
			output,
			metadata: {
				...metadata,
				completedViaTool: true,
				filesChanged,
				targetBranch,
				mergedSuccessfully: true,
			},
		};

		this._subTaskManager.updateStatus(subTaskId, status === 'success' ? 'completed' : 'failed', result);
		this._sendCompletionMessage(result);

		const fileCountMsg = filesChanged.length > 0
			? `${filesChanged.length} file(s) changed: ${filesChanged.slice(0, 5).join(', ')}${filesChanged.length > 5 ? '...' : ''}`
			: 'No files changed';

		return new LanguageModelToolResult([
			new LanguageModelTextPart(
				`✓ Work completed successfully!\n` +
				`  - Changes merged to: ${targetBranch}\n` +
				`  - ${fileCountMsg}\n` +
				`  - Worktree cleaned up\n` +
				`  - Parent agent notified`
			),
		]);
	}

	private _reportGitError(
		subTaskId: string,
		error: string,
		output: string,
		metadata?: Record<string, unknown>,
	): LanguageModelToolResult {
		const result: ISubTaskResult = {
			taskId: subTaskId,
			status: 'failed',
			output,
			error,
			metadata,
		};

		this._subTaskManager.updateStatus(subTaskId, 'failed', result);
		this._sendCompletionMessage(result);

		return new LanguageModelToolResult([
			new LanguageModelTextPart(
				`✗ Work completion failed: ${error}\n` +
				`Parent agent has been notified of the failure.`
			),
		]);
	}

	private _reportConflicts(
		subTaskId: string,
		conflictingFiles: string[],
		output: string,
		metadata?: Record<string, unknown>,
	): LanguageModelToolResult {
		const result: ISubTaskResult = {
			taskId: subTaskId,
			status: 'failed',
			output,
			error: `Merge conflicts detected`,
			metadata: {
				...metadata,
				hasConflicts: true,
				conflictingFiles,
			},
		};

		this._subTaskManager.updateStatus(subTaskId, 'failed', result);
		this._sendCompletionMessage(result);

		return new LanguageModelToolResult([
			new LanguageModelTextPart(
				`✗ Merge conflicts detected!\n` +
				`Parent agent has been notified. Manual conflict resolution required.`
			),
		]);
	}

	private _sendCompletionMessage(result: ISubTaskResult): void {
		const targetDescription = this._workerContext.owner
			? `${this._workerContext.owner.ownerType} (${this._workerContext.owner.ownerId})`
			: 'orchestrator';

		this._logService.info(`[A2ASubTaskCompleteTool] Sending completion to ${targetDescription}`);

		this._queueService.enqueueMessage({
			id: generateUuid(),
			timestamp: Date.now(),
			planId: this._workerContext.planId ?? 'standalone',
			taskId: result.taskId,
			workerId: this._workerContext.workerId,
			worktreePath: this._workerContext.worktreePath,
			depth: this._workerContext.depth,
			owner: this._workerContext.owner,
			type: 'completion',
			priority: 'normal',
			content: result,
		});
	}
}

// Safe to cast: A2ASubTaskCompleteTool satisfies ICopilotToolCtor requirements
// eslint-disable-next-line @typescript-eslint/no-explicit-any
ToolRegistry.registerTool(A2ASubTaskCompleteTool as any);
