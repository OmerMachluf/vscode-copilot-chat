/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../platform/log/common/logService';
import { createServiceIdentifier } from '../../util/common/services';
import { Emitter, Event } from '../../util/vs/base/common/event';
import { Disposable, IDisposable, toDisposable } from '../../util/vs/base/common/lifecycle';
import { ISubTask, ISubTaskManager, ISubTaskResult } from './orchestratorInterfaces';
import { IOrchestratorQueueMessage, IOrchestratorQueueService } from './orchestratorQueue';
import { WorkerSession } from './workerSession';

/**
 * Escape a file path for safe display in markdown.
 */
function escapePathForMarkdown(filePath: string | undefined): string {
	if (!filePath) {
		return '';
	}
	return filePath.replace(/\\/g, '\\\\');
}

export const IParentCompletionService = createServiceIdentifier<IParentCompletionService>('parentCompletionService');

/**
 * Represents a formatted "as-if-user" completion message for parent wake-up.
 */
export interface IParentCompletionMessage {
	/** The subtask that completed */
	subTaskId: string;
	/** Agent type that ran the subtask (e.g., '@architect') */
	agentType: string;
	/** Original task prompt given to the subtask */
	taskPrompt: string;
	/** The subtask's response/output */
	response: string;
	/** Path to the worktree where work was done */
	worktreePath: string;
	/** Number of files changed (if available) */
	changedFilesCount?: number;
	/** Number of insertions (if available) */
	insertions?: number;
	/** Number of deletions (if available) */
	deletions?: number;
	/** Optional list of changed files (best effort, may be truncated) */
	changedFiles?: string[];
	/** Whether the sub-agent explicitly called a2a_subtask_complete */
	completedViaTool?: boolean;
	/** If the sub-agent merged changes as part of completion */
	mergedToBranch?: string;
	/** Status of the completion */
	status: 'success' | 'partial' | 'failed' | 'timeout';
	/** Error message if failed */
	error?: string;
	/** Timestamp of completion */
	timestamp: number;
}

/**
 * Registered parent handler that receives completion messages.
 */
export interface IParentHandler {
	/** The owner ID (workerId or session ID) */
	ownerId: string;
	/** Callback to handle completion messages */
	onCompletion: (message: IParentCompletionMessage) => Promise<void>;
	/** Whether to inject as synthetic user message */
	injectAsUserMessage: boolean;
}

/**
 * Service for managing parent wake-up on subtask completion.
 *
 * Key responsibilities:
 * 1. Register persistent owner handlers for parent sessions
 * 2. Listen for subtask completions (both from queue and SubTaskManager events)
 * 3. Format completion messages in "as-if-user" format
 * 4. De-duplicate completion deliveries
 * 5. Trigger parent wake-up/continuation
 */
export interface IParentCompletionService {
	readonly _serviceBrand: undefined;

	/**
	 * Register a persistent handler for a parent session.
	 * The handler will receive completion messages for all subtasks spawned by this parent.
	 *
	 * @param ownerId The parent's unique ID (workerId or chat session ID)
	 * @param onCompletion Callback invoked when a subtask completes
	 * @param options Additional handler options
	 * @returns Disposable to unregister the handler
	 */
	registerParentHandler(
		ownerId: string,
		onCompletion: (message: IParentCompletionMessage) => Promise<void>,
		options?: { injectAsUserMessage?: boolean }
	): IDisposable;

	/**
	 * Check if a parent handler is registered for the given owner.
	 */
	hasParentHandler(ownerId: string): boolean;

	/**
	 * Get pending completions for an owner that were delivered before handler registration.
	 */
	getPendingCompletions(ownerId: string): IParentCompletionMessage[];

	/**
	 * Format a completion as an "as-if-user" message string.
	 */
	formatAsUserMessage(message: IParentCompletionMessage): string;

	/**
	 * Event fired when a completion is delivered to a parent.
	 */
	readonly onCompletionDelivered: Event<{ ownerId: string; message: IParentCompletionMessage }>;

	/**
	 * Event fired when a completion is queued (no handler available).
	 */
	readonly onCompletionQueued: Event<{ ownerId: string; message: IParentCompletionMessage }>;

	/**
	 * Manually deliver a completion message (used by fallback path).
	 */
	deliverCompletion(subTask: ISubTask, result: ISubTaskResult): Promise<void>;
}

/**
 * Implementation of the parent completion service.
 */
export class ParentCompletionService extends Disposable implements IParentCompletionService {
	readonly _serviceBrand: undefined;

	/** Registered parent handlers keyed by ownerId */
	private readonly _parentHandlers = new Map<string, IParentHandler>();

	/** Pending completions for owners without registered handlers */
	private readonly _pendingCompletions = new Map<string, IParentCompletionMessage[]>();

	/** Set of processed completion IDs for de-duplication */
	private readonly _processedCompletions = new Set<string>();

	/** Map of subTaskId -> ownerId for routing */
	private readonly _subtaskToOwner = new Map<string, string>();

	private readonly _onCompletionDelivered = this._register(new Emitter<{ ownerId: string; message: IParentCompletionMessage }>());
	readonly onCompletionDelivered = this._onCompletionDelivered.event;

	private readonly _onCompletionQueued = this._register(new Emitter<{ ownerId: string; message: IParentCompletionMessage }>());
	readonly onCompletionQueued = this._onCompletionQueued.event;

	constructor(
		@ISubTaskManager private readonly _subTaskManager: ISubTaskManager,
		@IOrchestratorQueueService private readonly _queueService: IOrchestratorQueueService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Listen to SubTaskManager completion events as a fallback source
		this._register(this._subTaskManager.onDidCompleteSubTask(subTask => {
			this._handleSubTaskCompletion(subTask);
		}));

		// Register ourselves as a queue handler for completion messages
		this._register(this._queueService.registerHandler(async (message) => {
			if (message.type === 'completion') {
				await this._handleQueueCompletion(message);
			}
		}));

		this._logService.debug('[ParentCompletionService] Service initialized');
	}

	registerParentHandler(
		ownerId: string,
		onCompletion: (message: IParentCompletionMessage) => Promise<void>,
		options?: { injectAsUserMessage?: boolean }
	): IDisposable {
		this._logService.debug(`[ParentCompletionService] Registered handler for owner ${ownerId}`);

		const handler: IParentHandler = {
			ownerId,
			onCompletion,
			injectAsUserMessage: options?.injectAsUserMessage ?? true,
		};

		this._parentHandlers.set(ownerId, handler);

		// Deliver any pending completions
		const pending = this._pendingCompletions.get(ownerId);
		if (pending && pending.length > 0) {
			this._logService.debug(`[ParentCompletionService] Delivering ${pending.length} pending completions to ${ownerId}`);
			this._pendingCompletions.delete(ownerId);

			// Deliver asynchronously to avoid blocking registration
			Promise.resolve().then(async () => {
				for (const message of pending) {
					await this._deliverToHandler(handler, message);
				}
			});
		}

		return toDisposable(() => {
			this._parentHandlers.delete(ownerId);
			this._logService.debug(`[ParentCompletionService] Disposed handler for owner ${ownerId}`);
		});
	}

	hasParentHandler(ownerId: string): boolean {
		return this._parentHandlers.has(ownerId);
	}

	getPendingCompletions(ownerId: string): IParentCompletionMessage[] {
		return this._pendingCompletions.get(ownerId) ?? [];
	}

	formatAsUserMessage(message: IParentCompletionMessage): string {
		const lines: string[] = [];

		// Format: "@{AgentType} subagent received task to: {task}."
		lines.push(`${message.agentType} subagent received task to: ${message.taskPrompt}`);
		lines.push('');

		// Include status indicator
		const statusIcon = message.status === 'success' ? '✅' :
			message.status === 'partial' ? '⚠️' :
				message.status === 'timeout' ? '⏱️' : '❌';

		lines.push(`${statusIcon} **Status:** ${message.status}`);

		// Format: "@{AgentType} response: {response}"
		if (message.response) {
			lines.push('');
			lines.push(`${message.agentType} response:`);
			lines.push(message.response);
		}

		// Include error if present
		if (message.error) {
			lines.push('');
			lines.push(`**Error:** ${message.error}`);
		}

		// Include worktree path
		lines.push('');
		lines.push(`**Worktree:** ${escapePathForMarkdown(message.worktreePath)}`);

		// Include changed files stats if available
		if (message.changedFilesCount !== undefined) {
			const statsLine = message.insertions !== undefined && message.deletions !== undefined
				? `**Changed files:** ${message.changedFilesCount} (+${message.insertions}/-${message.deletions})`
				: `**Changed files:** ${message.changedFilesCount}`;
			lines.push(statsLine);
		}

		if (message.mergedToBranch) {
			lines.push(`**Merged to:** ${message.mergedToBranch}`);
		}

		if (message.completedViaTool !== undefined) {
			lines.push(`**Completion tool used:** ${message.completedViaTool ? 'yes' : 'no (fallback completion)'}`);
		}

		if (message.changedFiles && message.changedFiles.length > 0) {
			const maxFiles = 20;
			const shown = message.changedFiles.slice(0, maxFiles);
			lines.push('');
			lines.push('**Changed files (preview):**');
			lines.push(shown.map(f => `- ${f}`).join('\n') + (message.changedFiles.length > maxFiles ? `\n- …and ${message.changedFiles.length - maxFiles} more` : ''));
		}

		// Add guidance for parent on what to do next
		lines.push('');
		lines.push('---');
		lines.push('**YOUR NEXT STEP:** As the parent, decide what to do:');
		lines.push('- If changes look good and you want to integrate them now: commit/merge using your normal workflow (git / PR).');
		lines.push('- If the sub-agent is expected to have made file changes but did not: send follow-up instructions (ask for concrete edits + rerun).');
		lines.push('- If this completion was a fallback (tool not used): treat results as lower confidence and consider asking the sub-agent to call `a2a_subtask_complete` explicitly.');

		return lines.join('\n');
	}

	async deliverCompletion(subTask: ISubTask, result: ISubTaskResult): Promise<void> {
		const completionId = `${subTask.id}-${result.taskId}`;

		// De-duplicate
		if (this._processedCompletions.has(completionId)) {
			this._logService.debug(`[ParentCompletionService] Skipping duplicate completion for ${subTask.id}`);
			return;
		}
		this._processedCompletions.add(completionId);

		// Format the completion message (including diff stats)
		const message = await this._createCompletionMessage(subTask, result);

		// Determine the owner
		const ownerId = subTask.parentWorkerId;
		this._logService.info(`[ParentCompletionService] Delivering completion for subtask ${subTask.id} to owner ${ownerId}`);

		// Try to find and invoke handler
		const handler = this._parentHandlers.get(ownerId);
		if (handler) {
			await this._deliverToHandler(handler, message);
		} else {
			// Queue for later delivery
			this._queuePendingCompletion(ownerId, message);
		}
	}

	private async _createCompletionMessage(subTask: ISubTask, result: ISubTaskResult): Promise<IParentCompletionMessage> {
		// Fetch diff stats for the worktree to include in completion payload
		let diffStats: { changedFilesCount: number; insertions: number; deletions: number } | undefined;
		let changedFiles: string[] | undefined;
		if (subTask.worktreePath) {
			diffStats = await getWorktreeDiffStats(subTask.worktreePath);
			changedFiles = await getWorktreeChangedFiles(subTask.worktreePath);
		}

		const completedViaTool = Boolean(result.metadata && (result.metadata as any).completedViaTool);
		const mergedToBranch = (result.metadata as any)?.targetBranch || (result.metadata as any)?.mergedToBranch;
		const metadataFilesChanged = (result.metadata as any)?.filesChanged;
		if (Array.isArray(metadataFilesChanged) && metadataFilesChanged.length > 0) {
			// Prefer metadata from explicit completion tool when available
			changedFiles = metadataFilesChanged;
		}

		return {
			subTaskId: subTask.id,
			agentType: subTask.agentType,
			taskPrompt: subTask.prompt.slice(0, 500) + (subTask.prompt.length > 500 ? '...' : ''),
			response: result.output,
			worktreePath: subTask.worktreePath,
			status: result.status,
			error: result.error,
			timestamp: Date.now(),
			changedFilesCount: diffStats?.changedFilesCount,
			insertions: diffStats?.insertions,
			deletions: diffStats?.deletions,
			changedFiles,
			completedViaTool,
			mergedToBranch,
		};
	}

	private async _deliverToHandler(handler: IParentHandler, message: IParentCompletionMessage): Promise<void> {
		try {
			await handler.onCompletion(message);
			this._logService.debug(`[ParentCompletionService] Delivered completion to handler ${handler.ownerId}`);
			this._onCompletionDelivered.fire({ ownerId: handler.ownerId, message });
		} catch (error) {
			this._logService.error(`[ParentCompletionService] Error delivering completion to ${handler.ownerId}:`, error);
		}
	}

	private _queuePendingCompletion(ownerId: string, message: IParentCompletionMessage): void {
		let pending = this._pendingCompletions.get(ownerId);
		if (!pending) {
			pending = [];
			this._pendingCompletions.set(ownerId, pending);
		}
		pending.push(message);
		this._logService.debug(`[ParentCompletionService] Queued completion for owner ${ownerId} (${pending.length} pending)`);
		this._onCompletionQueued.fire({ ownerId, message });
	}

	private _handleSubTaskCompletion(subTask: ISubTask): void {
		// Only handle terminal states
		if (!['completed', 'failed', 'cancelled'].includes(subTask.status)) {
			return;
		}

		// Create a result from the subTask if not present
		const result: ISubTaskResult = subTask.result ?? {
			taskId: subTask.id,
			status: subTask.status === 'completed' ? 'success' :
				subTask.status === 'cancelled' ? 'failed' : 'failed',
			output: '',
			error: subTask.status === 'cancelled' ? 'Task was cancelled' :
				subTask.status === 'failed' ? 'Task failed' : undefined,
		};

		// Deliver the completion
		this.deliverCompletion(subTask, result).catch(error => {
			this._logService.error(`[ParentCompletionService] Failed to deliver SubTaskManager completion:`, error);
		});
	}

	private async _handleQueueCompletion(message: IOrchestratorQueueMessage): Promise<void> {
		// Only process messages with owner context (routed to specific parent)
		if (!message.owner?.ownerId) {
			return;
		}

		// Extract the result from the message content
		const result = message.content as ISubTaskResult;
		if (!result || !result.taskId) {
			this._logService.warn(`[ParentCompletionService] Received completion message without valid result`);
			return;
		}

		// Get the subtask for additional context
		const subTask = this._subTaskManager.getSubTask(result.taskId);
		if (!subTask) {
			this._logService.warn(`[ParentCompletionService] Subtask ${result.taskId} not found for queue completion`);
			return;
		}

		// Deliver via the main path (handles dedup)
		await this.deliverCompletion(subTask, result);
	}

	/**
	 * Register a subtask -> owner mapping for routing.
	 * Called when a subtask is created.
	 */
	registerSubtaskOwner(subTaskId: string, ownerId: string): void {
		this._subtaskToOwner.set(subTaskId, ownerId);
	}

	/**
	 * Clear old processed completions to prevent memory growth.
	 * Called periodically or when worker tracking is reset.
	 */
	clearProcessedCompletions(ownerId?: string): void {
		if (ownerId) {
			// Clear only completions for this owner
			for (const completionId of this._processedCompletions) {
				if (completionId.includes(ownerId)) {
					this._processedCompletions.delete(completionId);
				}
			}
			this._pendingCompletions.delete(ownerId);
		} else {
			this._processedCompletions.clear();
			this._pendingCompletions.clear();
		}
	}
}

/**
 * Helper class to integrate parent completion with WorkerSession.
 * This adapter handles injecting completion messages into a worker's conversation
 * and triggering continuation.
 */
export class WorkerSessionWakeUpAdapter {
	constructor(
		private readonly _workerSession: WorkerSession,
		private readonly _parentCompletionService: IParentCompletionService,
		private readonly _logService: ILogService,
	) { }

	/**
	 * Register this worker session to receive completions from its subtasks.
	 * Returns a disposable that unregisters the handler.
	 */
	register(): IDisposable {
		return this._parentCompletionService.registerParentHandler(
			this._workerSession.id,
			async (message) => {
				await this._handleCompletion(message);
			},
			{ injectAsUserMessage: true }
		);
	}

	private async _handleCompletion(message: IParentCompletionMessage): Promise<void> {
		this._logService.info(`[WorkerSessionWakeUpAdapter] Received completion for worker ${this._workerSession.id}: ${message.subTaskId}`);

		// Format as "as-if-user" message
		const userMessage = this._parentCompletionService.formatAsUserMessage(message);

		// Inject as clarification message (this wakes up the worker if idle)
		this._workerSession.sendClarification(userMessage);

		this._logService.debug(`[WorkerSessionWakeUpAdapter] Injected completion as clarification for ${this._workerSession.id}`);
	}
}

/**
 * Helper function to get git diff stats for a worktree.
 * Used to populate changedFilesCount, insertions, deletions in completion messages.
 */
export async function getWorktreeDiffStats(worktreePath: string): Promise<{
	changedFilesCount: number;
	insertions: number;
	deletions: number;
} | undefined> {
	try {
		const execGit = async (args: string[]): Promise<string> => {
			return await new Promise<string>((resolve, reject) => {
				const { exec } = require('child_process');
				exec(
					`git ${args.join(' ')}`,
					{ cwd: worktreePath, encoding: 'utf-8' },
					(error: Error | null, stdout: string, stderr: string) => {
						if (error) {
							reject(new Error(stderr || error.message));
						} else {
							resolve(stdout);
						}
					}
				);
			});
		};

		const getDefaultBranch = async (): Promise<string> => {
			try {
				const remoteHead = await execGit(['symbolic-ref', 'refs/remotes/origin/HEAD']);
				const match = remoteHead.match(/refs\/remotes\/origin\/(.+)/);
				if (match?.[1]) {
					return match[1];
				}
			} catch {
				// ignore
			}
			for (const branch of ['main', 'master']) {
				try {
					await execGit(['rev-parse', '--verify', branch]);
					return branch;
				} catch {
					// ignore
				}
			}
			return 'main';
		};

		const parseNumstat = (text: string): { files: number; insertions: number; deletions: number } => {
			const lines = text.split('\n').filter(l => l.trim());
			let insertions = 0;
			let deletions = 0;
			let files = 0;
			for (const line of lines) {
				// numstat format: <ins>\t<del>\t<path>
				const parts = line.split(/\s+/);
				if (parts.length < 3) {
					continue;
				}
				const ins = parts[0];
				const del = parts[1];
				if (ins === '-' || del === '-') {
					// binary changes; count file but not line deltas
					files++;
					continue;
				}
				const insN = Number(ins);
				const delN = Number(del);
				if (!Number.isNaN(insN) && !Number.isNaN(delN)) {
					insertions += insN;
					deletions += delN;
					files++;
				}
			}
			return { files, insertions, deletions };
		};

		// Combine:
		// 1) committed changes vs base branch, and
		// 2) uncommitted/staged changes vs HEAD
		const baseBranch = await getDefaultBranch();
		let committed = { files: 0, insertions: 0, deletions: 0 };
		try {
			await execGit(['fetch', 'origin']);
		} catch {
			// ignore fetch issues
		}
		try {
			const committedNumstat = await execGit(['diff', '--numstat', `${baseBranch}...HEAD`]);
			committed = parseNumstat(committedNumstat);
		} catch {
			// ignore
		}

		let uncommitted = { files: 0, insertions: 0, deletions: 0 };
		try {
			const uncommittedNumstat = await execGit(['diff', '--numstat', 'HEAD']);
			uncommitted = parseNumstat(uncommittedNumstat);
		} catch {
			// ignore
		}

		return {
			changedFilesCount: Math.max(committed.files, uncommitted.files),
			insertions: committed.insertions + uncommitted.insertions,
			deletions: committed.deletions + uncommitted.deletions,
		};
	} catch {
		return undefined;
	}
}

/**
 * Get the list of changed files in a worktree.
 * Returns an array of file paths relative to the worktree root.
 */
export async function getWorktreeChangedFiles(worktreePath: string): Promise<string[]> {
	try {
		const execGit = async (args: string[]): Promise<string> => {
			return await new Promise<string>((resolve, reject) => {
				const { exec } = require('child_process');
				exec(
					`git ${args.join(' ')}`,
					{ cwd: worktreePath, encoding: 'utf-8' },
					(error: Error | null, stdout: string, stderr: string) => {
						if (error) {
							reject(new Error(stderr || error.message));
						} else {
							resolve(stdout);
						}
					}
				);
			});
		};

		const getDefaultBranch = async (): Promise<string> => {
			try {
				const remoteHead = await execGit(['symbolic-ref', 'refs/remotes/origin/HEAD']);
				const match = remoteHead.match(/refs\/remotes\/origin\/(.+)/);
				if (match?.[1]) {
					return match[1];
				}
			} catch {
				// ignore
			}
			for (const branch of ['main', 'master']) {
				try {
					await execGit(['rev-parse', '--verify', branch]);
					return branch;
				} catch {
					// ignore
				}
			}
			return 'main';
		};

		let baseBranch = 'main';
		try {
			baseBranch = await getDefaultBranch();
		} catch {
			// ignore
		}

		try {
			await execGit(['fetch', 'origin']);
		} catch {
			// ignore
		}

		const files = new Set<string>();
		// committed changes vs base
		try {
			const committed = await execGit(['diff', '--name-only', `${baseBranch}...HEAD`]);
			for (const f of committed.split('\n').map(l => l.trim()).filter(Boolean)) {
				files.add(f);
			}
		} catch {
			// ignore
		}
		// working tree changes (staged + unstaged)
		try {
			const working = await execGit(['diff', '--name-only', 'HEAD']);
			for (const f of working.split('\n').map(l => l.trim()).filter(Boolean)) {
				files.add(f);
			}
		} catch {
			// ignore
		}
		// untracked files
		try {
			const status = await execGit(['status', '--porcelain']);
			for (const line of status.split('\n').map(l => l.trim()).filter(Boolean)) {
				// format: XY <path> OR ?? <path>
				const file = line.slice(3).trim();
				if (file) {
					files.add(file);
				}
			}
		} catch {
			// ignore
		}

		return [...files.values()];
	} catch {
		return [];
	}
}

/**
 * Open a worktree in a new VS Code window.
 * @param worktreePath Path to the worktree to open
 * @param options Additional options for opening
 */
export async function openWorktreeInNewWindow(worktreePath: string, options?: { newWindow?: boolean }): Promise<void> {
	const vscode = require('vscode');
	const uri = vscode.Uri.file(worktreePath);
	await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: options?.newWindow ?? true });
}

/**
 * Show diff for a worktree against its base branch.
 * Opens the VS Code diff editor with all changed files.
 */
export async function showWorktreeDiff(worktreePath: string): Promise<void> {
	const vscode = require('vscode');
	try {
		// Get the list of changed files
		const changedFiles = await getWorktreeChangedFiles(worktreePath);

		if (changedFiles.length === 0) {
			vscode.window.showInformationMessage('No changes in worktree');
			return;
		}

		// Open the first changed file in diff view, user can navigate from there
		const path = require('path');
		const firstFile = changedFiles[0];
		const fileUri = vscode.Uri.file(path.join(worktreePath, firstFile));

		// Use the SCM view to show changes
		await vscode.commands.executeCommand('git.openChange', fileUri);
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to show diff: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Create a quick pick action menu for worktree operations.
 * Useful for parent agents to offer actions on completed subtask worktrees.
 */
export interface IWorktreeAction {
	label: string;
	description?: string;
	action: 'open' | 'diff' | 'files' | 'merge' | 'discard';
}

export async function showWorktreeActionsMenu(
	worktreePath: string,
	branchName: string,
	diffStats?: { changedFilesCount: number; insertions: number; deletions: number }
): Promise<IWorktreeAction | undefined> {
	const vscode = require('vscode');

	const statsInfo = diffStats
		? ` (${diffStats.changedFilesCount} files, +${diffStats.insertions}/-${diffStats.deletions})`
		: '';

	const items: (IWorktreeAction & { picked?: boolean })[] = [
		{
			label: '$(folder-opened) Open Worktree',
			description: 'Open in new VS Code window',
			action: 'open',
		},
		{
			label: '$(diff) Show Diff',
			description: `View changes${statsInfo}`,
			action: 'diff',
		},
		{
			label: '$(list-unordered) List Changed Files',
			description: 'Show all modified files',
			action: 'files',
		},
		{
			label: '$(git-merge) Merge to Main',
			description: `Merge ${branchName} into main branch`,
			action: 'merge',
		},
		{
			label: '$(trash) Discard Changes',
			description: 'Remove worktree and branch',
			action: 'discard',
		},
	];

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: `Actions for worktree: ${branchName}`,
		title: 'Worktree Actions',
	});

	return selected ? { label: selected.label, description: selected.description, action: selected.action } : undefined;
}
