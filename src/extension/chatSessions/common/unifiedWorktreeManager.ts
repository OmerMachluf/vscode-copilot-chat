/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { IRunCommandExecutionService } from '../../../platform/commands/common/runCommandExecutionService';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { IGitService } from '../../../platform/git/common/gitService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { createDecorator } from '../../../util/vs/platform/instantiation/common/instantiation';

export const IUnifiedWorktreeManager = createDecorator<IUnifiedWorktreeManager>('unifiedWorktreeManager');

/**
 * Information about a session's worktree
 */
export interface SessionWorktreeInfo {
	readonly sessionId: string;
	readonly worktreePath: string;
	readonly branchName: string;
	readonly baseBranch: string;
	readonly repoPath: string;
	readonly createdAt: number;
}

/**
 * Options for creating a worktree
 */
export interface CreateWorktreeOptions {
	/** Base branch to create from (defaults to main/master) */
	baseBranch?: string;
	/** Custom branch name (defaults to session-based name) */
	branchName?: string;
	/** Custom worktree path (defaults to .worktrees/<sessionId>) */
	worktreePath?: string;
	/** Whether to use VS Code's git extension for creation */
	useGitExtension?: boolean;
}

/**
 * Options for completing a worktree session
 */
export interface CompleteWorktreeOptions {
	/** Commit message for pending changes */
	commitMessage?: string;
	/** Whether to push to origin */
	push?: boolean;
	/** Whether to create a pull request */
	createPullRequest?: boolean;
	/** PR title (defaults to commit message) */
	prTitle?: string;
	/** PR body/description */
	prBody?: string;
	/** Base branch for PR (defaults to worktree's base branch) */
	prBaseBranch?: string;
}

/**
 * Result of completing a worktree session
 */
export interface CompleteWorktreeResult {
	readonly branchName: string;
	readonly committed: boolean;
	readonly pushed: boolean;
	readonly prCreated: boolean;
	readonly prUrl?: string;
	readonly prNumber?: number;
}

/**
 * Unified worktree manager that provides worktree isolation for any session type.
 * Extracted and generalized from CopilotCLIWorktreeManager.
 */
export interface IUnifiedWorktreeManager {
	readonly _serviceBrand: undefined;

	/**
	 * Create a new worktree for a session
	 * @param sessionId Unique session identifier
	 * @param options Worktree creation options
	 * @param stream Optional chat response stream for progress reporting
	 * @returns The worktree path, or undefined if creation failed
	 */
	createWorktree(sessionId: string, options?: CreateWorktreeOptions, stream?: vscode.ChatResponseStream): Promise<string | undefined>;

	/**
	 * Get the worktree path for a session
	 */
	getWorktreePath(sessionId: string): string | undefined;

	/**
	 * Get full worktree info for a session
	 */
	getWorktreeInfo(sessionId: string): SessionWorktreeInfo | undefined;

	/**
	 * Get all session worktrees
	 */
	getAllWorktrees(): SessionWorktreeInfo[];

	/**
	 * Store worktree path for a session (used when worktree created externally)
	 */
	storeWorktree(info: SessionWorktreeInfo): Promise<void>;

	/**
	 * Get the relative path of a worktree (just the folder name)
	 */
	getWorktreeRelativePath(sessionId: string): string | undefined;

	/**
	 * Complete a worktree session: commit changes, push, optionally create PR
	 */
	completeWorktree(sessionId: string, options?: CompleteWorktreeOptions): Promise<CompleteWorktreeResult>;

	/**
	 * Remove a worktree and clean up associated resources
	 */
	removeWorktree(sessionId: string): Promise<void>;

	/**
	 * Check if a session has uncommitted changes in its worktree
	 */
	hasUncommittedChanges(sessionId: string): Promise<boolean>;

	/**
	 * Get git diff statistics for a session's worktree
	 */
	getWorktreeStats(sessionId: string): Promise<{ files: number; insertions: number; deletions: number } | undefined>;
}

const WORKTREE_STORAGE_KEY = 'github.copilot.unified.sessionWorktrees';

/**
 * Implementation of the unified worktree manager
 */
export class UnifiedWorktreeManager extends Disposable implements IUnifiedWorktreeManager {
	readonly _serviceBrand: undefined;

	private _worktrees: Map<string, SessionWorktreeInfo> = new Map();
	private _defaultBaseBranch: string = 'main';

	constructor(
		@IVSCodeExtensionContext private readonly extensionContext: IVSCodeExtensionContext,
		@IRunCommandExecutionService private readonly commandExecutionService: IRunCommandExecutionService,
		@IGitService private readonly gitService: IGitService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
	) {
		super();
		this._loadWorktrees();
		this._detectDefaultBranch();
	}

	private _loadWorktrees(): void {
		const stored = this.extensionContext.globalState.get<Record<string, SessionWorktreeInfo>>(WORKTREE_STORAGE_KEY, {});
		for (const [sessionId, info] of Object.entries(stored)) {
			this._worktrees.set(sessionId, info);
		}
	}

	private async _saveWorktrees(): Promise<void> {
		const toStore: Record<string, SessionWorktreeInfo> = {};
		for (const [sessionId, info] of this._worktrees) {
			toStore[sessionId] = info;
		}
		await this.extensionContext.globalState.update(WORKTREE_STORAGE_KEY, toStore);
	}

	private async _detectDefaultBranch(): Promise<void> {
		const workspaceFolder = this.workspaceService.getWorkspaceFolders()[0]?.fsPath;
		if (!workspaceFolder) {
			return;
		}

		return new Promise((resolve) => {
			// Try to detect the default branch from remote
			cp.exec('git symbolic-ref refs/remotes/origin/HEAD', { cwd: workspaceFolder }, (err, stdout) => {
				if (!err && stdout) {
					const match = stdout.trim().match(/refs\/remotes\/origin\/(.+)/);
					if (match) {
						this._defaultBaseBranch = match[1];
						resolve();
						return;
					}
				}
				// Fallback: check if main or master exists
				cp.exec('git rev-parse --verify main', { cwd: workspaceFolder }, (err2) => {
					this._defaultBaseBranch = err2 ? 'master' : 'main';
					resolve();
				});
			});
		});
	}

	async createWorktree(sessionId: string, options?: CreateWorktreeOptions, stream?: vscode.ChatResponseStream): Promise<string | undefined> {
		// Check if already exists
		const existing = this._worktrees.get(sessionId);
		if (existing && fs.existsSync(existing.worktreePath)) {
			return existing.worktreePath;
		}

		const baseBranch = options?.baseBranch || this._defaultBaseBranch;
		const workspaceFolder = this.workspaceService.getWorkspaceFolders()[0]?.fsPath;
		if (!workspaceFolder) {
			return undefined;
		}

		// Use VS Code git extension if requested
		if (options?.useGitExtension) {
			return this._createWorktreeViaExtension(sessionId, baseBranch, stream);
		}

		// Create worktree manually
		return this._createWorktreeManually(sessionId, baseBranch, workspaceFolder, options, stream);
	}

	private async _createWorktreeViaExtension(sessionId: string, baseBranch: string, stream?: vscode.ChatResponseStream): Promise<string | undefined> {
		return new Promise<string | undefined>(async (resolve) => {
			const reportProgress = async (message: string) => {
				if (stream) {
					stream.progress(message);
				}
			};

			try {
				await reportProgress(vscode.l10n.t('Creating isolated worktree...'));
				const worktreePath = await this.commandExecutionService.executeCommand('git.createWorktreeWithDefaults') as string | undefined;

				if (worktreePath) {
					const workspaceFolder = this.workspaceService.getWorkspaceFolders()[0]?.fsPath;
					const branchName = path.basename(worktreePath);

					const info: SessionWorktreeInfo = {
						sessionId,
						worktreePath,
						branchName,
						baseBranch,
						repoPath: workspaceFolder || '',
						createdAt: Date.now(),
					};

					this._worktrees.set(sessionId, info);
					await this._saveWorktrees();
					resolve(worktreePath);
				} else {
					resolve(undefined);
				}
			} catch (error) {
				console.error('Failed to create worktree via extension:', error);
				resolve(undefined);
			}
		});
	}

	private async _createWorktreeManually(
		sessionId: string,
		baseBranch: string,
		workspaceFolder: string,
		options?: CreateWorktreeOptions,
		stream?: vscode.ChatResponseStream
	): Promise<string | undefined> {
		const branchName = options?.branchName || `session/${sessionId}`;
		// Use path.dirname() to reliably get the parent directory on all platforms
		const worktreesDir = path.join(path.dirname(workspaceFolder), '.worktrees');
		const worktreePath = options?.worktreePath || path.join(worktreesDir, sessionId);

		try {
			// Report progress
			if (stream) {
				stream.progress(vscode.l10n.t('Creating isolated worktree at {0}...', worktreePath));
			}

			// Ensure worktrees directory exists
			if (!fs.existsSync(worktreesDir)) {
				fs.mkdirSync(worktreesDir, { recursive: true });
			}

			// Create the worktree with a new branch
			await this._execGit(['worktree', 'add', '-b', branchName, worktreePath, baseBranch], workspaceFolder);

			const info: SessionWorktreeInfo = {
				sessionId,
				worktreePath,
				branchName,
				baseBranch,
				repoPath: workspaceFolder,
				createdAt: Date.now(),
			};

			this._worktrees.set(sessionId, info);
			await this._saveWorktrees();

			return worktreePath;
		} catch (error) {
			console.error('Failed to create worktree manually:', error);
			if (stream) {
				stream.markdown(vscode.l10n.t('⚠️ Failed to create worktree: {0}', error instanceof Error ? error.message : String(error)));
			}
			return undefined;
		}
	}

	getWorktreePath(sessionId: string): string | undefined {
		return this._worktrees.get(sessionId)?.worktreePath;
	}

	getWorktreeInfo(sessionId: string): SessionWorktreeInfo | undefined {
		return this._worktrees.get(sessionId);
	}

	getAllWorktrees(): SessionWorktreeInfo[] {
		return Array.from(this._worktrees.values());
	}

	async storeWorktree(info: SessionWorktreeInfo): Promise<void> {
		this._worktrees.set(info.sessionId, info);
		await this._saveWorktrees();
	}

	getWorktreeRelativePath(sessionId: string): string | undefined {
		const worktreePath = this.getWorktreePath(sessionId);
		if (!worktreePath) {
			return undefined;
		}
		const lastIndex = worktreePath.lastIndexOf(path.sep);
		return lastIndex >= 0 ? worktreePath.substring(lastIndex + 1) : worktreePath;
	}

	async completeWorktree(sessionId: string, options?: CompleteWorktreeOptions): Promise<CompleteWorktreeResult> {
		const info = this._worktrees.get(sessionId);
		if (!info) {
			throw new Error(`No worktree found for session ${sessionId}`);
		}

		const result: CompleteWorktreeResult = {
			branchName: info.branchName,
			committed: false,
			pushed: false,
			prCreated: false,
		};

		const worktreePath = info.worktreePath;

		try {
			// Stage all changes
			await this._execGit(['add', '-A'], worktreePath);

			// Check if there are changes to commit
			const statusOutput = await this._execGit(['status', '--porcelain'], worktreePath);
			if (statusOutput.trim()) {
				// Commit changes
				const commitMessage = options?.commitMessage || `Complete session: ${sessionId}`;
				await this._execGit(['commit', '-m', commitMessage, '--allow-empty'], worktreePath);
				(result as { committed: boolean }).committed = true;
			}

			// Push if requested
			if (options?.push !== false) {
				await this._execGit(['push', '-u', 'origin', info.branchName], worktreePath);
				(result as { pushed: boolean }).pushed = true;
			}

			// Create PR if requested
			if (options?.createPullRequest) {
				const prResult = await this._createPullRequest(info, options);
				if (prResult) {
					(result as { prCreated: boolean }).prCreated = true;
					(result as { prUrl?: string }).prUrl = prResult.url;
					(result as { prNumber?: number }).prNumber = prResult.number;
				}
			}

			return result;
		} catch (error) {
			console.error('Failed to complete worktree:', error);
			throw error;
		}
	}

	private async _createPullRequest(
		info: SessionWorktreeInfo,
		options: CompleteWorktreeOptions
	): Promise<{ url: string; number: number } | undefined> {
		const baseBranch = options.prBaseBranch || info.baseBranch;
		const title = options.prTitle || `Session: ${info.sessionId}`;
		const body = options.prBody || '';

		try {
			// Use gh CLI to create PR
			const output = await this._execCommand(
				'gh',
				['pr', 'create', '--base', baseBranch, '--head', info.branchName, '--title', title, '--body', body],
				info.worktreePath
			);

			// Parse PR URL from output
			const urlMatch = output.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/);
			if (urlMatch) {
				return {
					url: urlMatch[0],
					number: parseInt(urlMatch[1], 10),
				};
			}
		} catch (error) {
			console.error('Failed to create PR:', error);
		}

		return undefined;
	}

	async removeWorktree(sessionId: string): Promise<void> {
		const info = this._worktrees.get(sessionId);
		if (!info) {
			return;
		}

		try {
			// Try to remove via git extension first
			try {
				await this.commandExecutionService.executeCommand('git.deleteWorktree', vscode.Uri.file(info.worktreePath));
			} catch {
				// Fall back to manual removal
				if (info.repoPath) {
					await this._execGit(['worktree', 'remove', info.worktreePath, '--force'], info.repoPath);
				}
			}

			// Try to delete the branch
			if (info.repoPath) {
				try {
					await this._execGit(['branch', '-D', info.branchName], info.repoPath);
				} catch {
					// Branch might not exist or be checked out elsewhere
				}
			}
		} catch (error) {
			console.error('Failed to remove worktree:', error);
		}

		// Always remove from our tracking
		this._worktrees.delete(sessionId);
		await this._saveWorktrees();
	}

	async hasUncommittedChanges(sessionId: string): Promise<boolean> {
		const info = this._worktrees.get(sessionId);
		if (!info) {
			return false;
		}

		try {
			const output = await this._execGit(['status', '--porcelain'], info.worktreePath);
			return output.trim().length > 0;
		} catch {
			return false;
		}
	}

	async getWorktreeStats(sessionId: string): Promise<{ files: number; insertions: number; deletions: number } | undefined> {
		const info = this._worktrees.get(sessionId);
		if (!info) {
			return undefined;
		}

		try {
			return await this.gitService.diffIndexWithHEADShortStats(vscode.Uri.file(info.worktreePath));
		} catch {
			return undefined;
		}
	}

	private async _execGit(args: string[], cwd: string): Promise<string> {
		return this._execCommand('git', args, cwd);
	}

	private _execCommand(command: string, args: string[], cwd: string): Promise<string> {
		return new Promise((resolve, reject) => {
			cp.execFile(command, args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
				if (error) {
					reject(new Error(`${command} ${args.join(' ')} failed: ${stderr || error.message}`));
				} else {
					resolve(stdout);
				}
			});
		});
	}
}
