/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, LanguageModelTextPart, LanguageModelToolInvocationOptions, LanguageModelToolInvocationPrepareOptions, LanguageModelToolResult, ProviderResult } from 'vscode';
import { IOrchestratorService } from '../../orchestrator/orchestratorServiceV2';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

interface IAddPlanTaskParams {
	description: string;
}

class AddPlanTaskTool implements ICopilotTool<IAddPlanTaskParams> {
	public static readonly toolName = ToolName.OrchestratorAddPlanTask;

	constructor(
		@IOrchestratorService private readonly _orchestratorService: IOrchestratorService
	) { }

	prepareInvocation(_options: LanguageModelToolInvocationPrepareOptions<IAddPlanTaskParams>, _token: CancellationToken): ProviderResult<any> {
		return { presentation: 'hidden' };
	}

	async invoke(options: LanguageModelToolInvocationOptions<IAddPlanTaskParams>, _token: CancellationToken): Promise<LanguageModelToolResult> {
		const task = this._orchestratorService.addTask(options.input.description);
		return new LanguageModelToolResult([new LanguageModelTextPart(`Task added to plan: ${task.id} - ${options.input.description}`)]);
	}
}

class DeployTool implements ICopilotTool<void> {
	public static readonly toolName = ToolName.OrchestratorDeploy;

	constructor(
		@IOrchestratorService private readonly _orchestratorService: IOrchestratorService
	) { }

	prepareInvocation(_options: LanguageModelToolInvocationPrepareOptions<void>, _token: CancellationToken): ProviderResult<any> {
		return { presentation: 'hidden' };
	}

	async invoke(_options: LanguageModelToolInvocationOptions<void>, _token: CancellationToken): Promise<LanguageModelToolResult> {
		try {
			const worker = await this._orchestratorService.deploy();
			return new LanguageModelToolResult([new LanguageModelTextPart(`Deployed worker: ${worker.id} for task: ${worker.task}`)]);
		} catch (e: any) {
			return new LanguageModelToolResult([new LanguageModelTextPart(`Error deploying worker: ${e.message}`)]);
		}
	}
}

class ListWorkersTool implements ICopilotTool<void> {
	public static readonly toolName = ToolName.OrchestratorListWorkers;

	constructor(
		@IOrchestratorService private readonly _orchestratorService: IOrchestratorService
	) { }

	prepareInvocation(_options: LanguageModelToolInvocationPrepareOptions<void>, _token: CancellationToken): ProviderResult<any> {
		return { presentation: 'hidden' };
	}

	async invoke(_options: LanguageModelToolInvocationOptions<void>, _token: CancellationToken): Promise<LanguageModelToolResult> {
		const workers = this._orchestratorService.getWorkerStates();
		if (workers.length === 0) {
			return new LanguageModelToolResult([new LanguageModelTextPart('No active workers.')]);
		}
		const list = workers.map(w => `- ${w.id} (${w.name}): ${w.status} - ${w.task}`).join('\n');
		return new LanguageModelToolResult([new LanguageModelTextPart(`Active workers:\n${list}`)]);
	}
}

interface ISendMessageParams {
	workerId: string;
	message: string;
}

class SendMessageTool implements ICopilotTool<ISendMessageParams> {
	public static readonly toolName = ToolName.OrchestratorSendMessage;

	constructor(
		@IOrchestratorService private readonly _orchestratorService: IOrchestratorService
	) { }

	prepareInvocation(_options: LanguageModelToolInvocationPrepareOptions<ISendMessageParams>, _token: CancellationToken): ProviderResult<any> {
		return { presentation: 'hidden' };
	}

	async invoke(options: LanguageModelToolInvocationOptions<ISendMessageParams>, _token: CancellationToken): Promise<LanguageModelToolResult> {
		this._orchestratorService.sendMessageToWorker(options.input.workerId, options.input.message);
		return new LanguageModelToolResult([new LanguageModelTextPart(`Message sent to ${options.input.workerId}`)]);
	}
}

ToolRegistry.registerTool(AddPlanTaskTool);
ToolRegistry.registerTool(DeployTool);
ToolRegistry.registerTool(ListWorkersTool);
ToolRegistry.registerTool(SendMessageTool);
