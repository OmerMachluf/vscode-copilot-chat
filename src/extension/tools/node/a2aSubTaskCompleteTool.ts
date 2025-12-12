/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
		const { subTaskId, status, output, outputFile, metadata, error } = options.input;
		try {
			const result: ISubTaskResult = {
				taskId: subTaskId,
				status,
				output,
				outputFile,
				metadata,
				error,
			};
			this._subTaskManager.updateStatus(subTaskId, status === 'success' ? 'completed' : 'failed', result);

			// Determine target for completion message
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
				// Include owner context for routing - completion goes to owner, not directly to orchestrator
				owner: this._workerContext.owner,
				type: 'completion',
				priority: 'normal',
				content: result
			});
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Sub-task completion recorded and ${targetDescription} notified.`),
			]);
		} catch (e) {
			this._logService.error(`[A2ASubTaskCompleteTool] Failed to complete sub-task:`, e);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`ERROR: Failed to complete sub-task: ${e instanceof Error ? e.message : String(e)}`),
			]);
		}
	}
}

// Safe to cast: A2ASubTaskCompleteTool satisfies ICopilotToolCtor requirements
// eslint-disable-next-line @typescript-eslint/no-explicit-any
ToolRegistry.registerTool(A2ASubTaskCompleteTool as any);
