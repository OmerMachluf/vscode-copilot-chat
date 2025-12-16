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

	prepareInvocation(_options: LanguageModelToolInvocationPrepareOptions<A2ASubTaskCompleteParams>, _token: CancellationToken): ProviderResult<any> {
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
		} = options.input;

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

			// IMPORTANT: If there are uncommitted changes, fail the completion.
			// The agent is responsible for committing their work before calling this tool.
			// This ensures different repositories can follow their own commit conventions.
			if (changeSummary?.hasChanges) {
				const fileList = changeSummary.changedFiles.slice(0, 10).join(', ');
				const moreFiles = changeSummary.changedFiles.length > 10
					? ` (and ${changeSummary.changedFiles.length - 10} more)`
					: '';

				this._logService.warn(`[A2ASubTaskCompleteTool] Uncommitted changes detected: ${changeSummary.changedFiles.length} files`);

				return new LanguageModelToolResult([
					new LanguageModelTextPart(
						`ERROR: Cannot complete - you have uncommitted changes!\n\n` +
						`Uncommitted files (${changeSummary.changedFiles.length}): ${fileList}${moreFiles}\n\n` +
						`**You must commit your changes before calling a2a_subtask_complete.**\n\n` +
						`Please:\n` +
						`1. Stage your changes: git add -A\n` +
						`2. Commit with a descriptive message: git commit -m "your message"\n` +
						`3. Then call a2a_subtask_complete again\n\n` +
						`This ensures your work is properly tracked and can be integrated by your parent.`
					),
				]);
			}

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

}

// Safe to cast: A2ASubTaskCompleteTool satisfies ICopilotToolCtor requirements
// eslint-disable-next-line @typescript-eslint/no-explicit-any
ToolRegistry.registerTool(A2ASubTaskCompleteTool as any);
