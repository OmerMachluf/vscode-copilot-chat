/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { IAgentRunner } from '../agentRunner';
import {
AgentBackendType,
AgentExecuteParams,
AgentExecuteResult,
AgentWorkerStatus,
IAgentExecutor,
ParsedAgentType,
} from '../agentExecutor';

interface ActiveWorkerState {
status: AgentWorkerStatus;
cancellation: vscode.CancellationTokenSource;
startTime: number;
}

/**
 * CopilotAgentExecutor wraps the existing AgentRunner to provide
 * the IAgentExecutor interface for the Copilot backend.
 *
 * This is the primary executor that delegates to VS Code's Copilot
 * infrastructure for agent execution.
 */
export class CopilotAgentExecutor implements IAgentExecutor {
readonly _serviceBrand: undefined;
readonly backendType: AgentBackendType = 'copilot';

private readonly _activeWorkers = new Map<string, ActiveWorkerState>();

constructor(
@IAgentRunner private readonly _agentRunner: IAgentRunner,
@ILogService private readonly _logService: ILogService,
) {}

async execute(params: AgentExecuteParams, stream?: vscode.ChatResponseStream): Promise<AgentExecuteResult> {
const {
taskId,
prompt,
worktreePath,
model,
modelId,
token,
options,
history,
additionalInstructions,
workerToolSet,
toolInvocationToken,
onPaused,
} = params;

const startTime = Date.now();

// Track worker status
const cancellationSource = new vscode.CancellationTokenSource();
this._activeWorkers.set(taskId, {
status: { state: 'running', startTime },
cancellation: cancellationSource,
startTime,
});

try {
this._logService.info(`[CopilotAgentExecutor] Starting execution for task ${taskId}`);

// Get the model to use
let resolvedModel = model;
if (!resolvedModel && modelId) {
const models = await vscode.lm.selectChatModels({ id: modelId });
resolvedModel = models[0];
}

if (!resolvedModel) {
throw new Error('No model available for execution');
}

// Create a collector stream if no stream provided
const responseStream = stream ?? this._createCollectorStream();

const result = await this._agentRunner.run({
prompt,
model: resolvedModel,
token: token,
worktreePath,
history,
additionalInstructions,
workerToolSet,
toolInvocationToken,
maxToolCallIterations: options?.maxToolCallIterations ?? 200,
onPaused,
}, responseStream);

const endTime = Date.now();
const executionTime = endTime - startTime;

// Update status based on result
const workerState = this._activeWorkers.get(taskId);
if (workerState) {
if (result.success) {
workerState.status = {
state: 'completed',
result: {
status: 'success',
output: result.response ?? '',
metadata: {
...result.metadata,
executionTime,
},
},
};
} else {
workerState.status = {
state: 'failed',
error: result.error ?? 'Unknown error',
};
}
}

this._logService.info(`[CopilotAgentExecutor] Completed execution for task ${taskId} in ${executionTime}ms`);

return {
status: result.success ? 'success' : 'failed',
output: result.response ?? '',
error: result.error,
metadata: {
...result.metadata,
model: resolvedModel.id,
executionTime,
},
};
} catch (error) {
const workerState = this._activeWorkers.get(taskId);
if (workerState) {
workerState.status = {
state: 'failed',
error: error instanceof Error ? error.message : String(error),
};
}

const errorMessage = error instanceof Error ? error.message : String(error);
this._logService.error(`[CopilotAgentExecutor] Execution failed for task ${taskId}: ${errorMessage}`);

return {
status: 'failed',
output: '',
error: errorMessage,
};
}
}

async sendMessage(workerId: string, message: string): Promise<void> {
// For the Copilot executor, sending a message means starting a new execution
// with the message. The actual conversation continuity is handled by the
// history parameter in execute().
this._logService.info(`[CopilotAgentExecutor] Message queued for worker ${workerId}: ${message.substring(0, 100)}...`);
}

async cancel(workerId: string): Promise<void> {
const workerState = this._activeWorkers.get(workerId);
if (workerState) {
workerState.cancellation.cancel();
workerState.status = {
state: 'failed',
error: 'Cancelled by user',
};
this._logService.info(`[CopilotAgentExecutor] Cancelled execution for worker ${workerId}`);
}
}

getStatus(workerId: string): AgentWorkerStatus | undefined {
const workerState = this._activeWorkers.get(workerId);
return workerState?.status;
}

supports(parsedType: ParsedAgentType): boolean {
// The Copilot executor supports the built-in agent types
const supportedAgents = ['@agent', '@architect', '@reviewer'];
return supportedAgents.includes(parsedType.agentName) || parsedType.backend === 'copilot';
}

/**
 * Creates a simple collector stream for cases where no stream is provided.
 * This captures all output but doesn't display it anywhere.
 */
private _createCollectorStream(): vscode.ChatResponseStream {
const collected: string[] = [];
return {
markdown: (value: string | vscode.MarkdownString) => {
const text = typeof value === 'string' ? value : value.value;
collected.push(text);
},
anchor: () => {},
button: () => {},
filetree: () => {},
progress: () => {},
reference: () => {},
push: () => {},
confirmation: () => {},
warning: () => {},
textEdit: () => {},
codeblockUri: () => {},
detectedParticipant: () => {},
} as unknown as vscode.ChatResponseStream;
}
}
