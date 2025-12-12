/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IOrchestratorService } from '../../orchestrator/orchestratorServiceV2';
import {
	formatTimestamp,
	getStatusIcon,
	OrchestratorSessionId,
	workerStatusToChatSessionStatus,
} from './orchestratorChatSessionHelpers';

/**
 * Provides chat session items for orchestrator workers.
 * Each active worker in the orchestrator system appears as a session item.
 */
export class OrchestratorChatSessionItemProvider extends Disposable implements vscode.ChatSessionItemProvider {
	public static readonly orchestratorSessionType = 'orchestrator';

	private readonly _onDidChangeChatSessionItems = this._register(new Emitter<void>());
	public readonly onDidChangeChatSessionItems: Event<void> = this._onDidChangeChatSessionItems.event;

	private readonly _onDidCommitChatSessionItem = this._register(new Emitter<{ original: vscode.ChatSessionItem; modified: vscode.ChatSessionItem }>());
	public readonly onDidCommitChatSessionItem: Event<{ original: vscode.ChatSessionItem; modified: vscode.ChatSessionItem }> = this._onDidCommitChatSessionItem.event;

	constructor(
		private readonly orchestratorService: IOrchestratorService,
	) {
		super();

		// Listen for orchestrator state changes
		this._register(this.orchestratorService.onDidChangeWorkers(() => {
			this.refresh();
		}));

		// Listen for orchestrator events
		this._register(this.orchestratorService.onOrchestratorEvent((event) => {
			if (event.type.startsWith('task.') || event.type.startsWith('worker.')) {
				this.refresh();
			}
		}));
	}

	/**
	 * Refresh the session list
	 */
	public refresh(): void {
		this._onDidChangeChatSessionItems.fire();
	}

	/**
	 * Swap an untitled session for a newly created one
	 */
	public swap(original: vscode.ChatSessionItem, modified: vscode.ChatSessionItem): void {
		this._onDidCommitChatSessionItem.fire({ original, modified });
	}

	/**
	 * Provide the list of orchestrator sessions
	 */
	public async provideChatSessionItems(token: vscode.CancellationToken): Promise<vscode.ChatSessionItem[]> {
		const workers = this.orchestratorService.getWorkerStates();
		const tasks = this.orchestratorService.getTasks();
		const plans = this.orchestratorService.getPlans();

		const items: vscode.ChatSessionItem[] = [];

		for (const worker of workers) {
			// Find the associated task
			const task = tasks.find(t => t.workerId === worker.id);
			const plan = task?.planId ? plans.find(p => p.id === task.planId) : undefined;

			// Get worktree info
			const worktreePath = worker.worktreePath;
			const worktreeRelativePath = worktreePath ? this._getRelativePath(worktreePath) : undefined;

			// Build description
			let description: vscode.MarkdownString | undefined;
			if (worktreeRelativePath) {
				description = new vscode.MarkdownString(`$(list-tree) ${worktreeRelativePath}`);
				description.supportThemeIcons = true;
			}

			// Build tooltip
			const tooltipLines: string[] = [
				`**Task:** ${worker.task}`,
				`**Status:** ${getStatusIcon(worker.status)} ${worker.status}`,
			];

			if (plan) {
				tooltipLines.push(`**Plan:** ${plan.name}`);
			}

			if (worktreePath) {
				tooltipLines.push(`**Worktree:** ${worktreeRelativePath || worktreePath}`);
			}

			tooltipLines.push(`**Started:** ${formatTimestamp(worker.createdAt)}`);

			if (worker.errorMessage) {
				tooltipLines.push(`**Error:** ${worker.errorMessage}`);
			}

			const tooltip = new vscode.MarkdownString(tooltipLines.join('\n\n'));
			tooltip.supportThemeIcons = true;

			// Build label
			const label = task?.name || worker.name || `Worker ${worker.id.slice(-6)}`;

			const item: vscode.ChatSessionItem = {
				resource: OrchestratorSessionId.getResource(task?.id || worker.id),
				label,
				description,
				tooltip,
				status: workerStatusToChatSessionStatus(worker.status),
				timing: {
					startTime: worker.createdAt,
				},
			};

			items.push(item);
		}

		// Sort by creation time, newest first
		items.sort((a, b) => (b.timing?.startTime || 0) - (a.timing?.startTime || 0));

		return items;
	}

	private _getRelativePath(fullPath: string): string {
		const parts = fullPath.split(/[/\\]/);
		return parts[parts.length - 1] || fullPath;
	}
}
