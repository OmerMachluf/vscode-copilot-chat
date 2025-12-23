/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IAgentRunner } from '../agentRunner';
import {
AgentBackendType,
AgentExecuteParams,
AgentExecuteResult,
AgentWorkerStatus,
IAgentExecutor,
ParsedAgentType,
} from '../agentExecutor';
import { IOrchestratorQueueService } from '../orchestratorQueue';
import { IWorkerContext } from '../workerToolsService';

interface ActiveWorkerState {
status: AgentWorkerStatus;
cancellation: vscode.CancellationTokenSource;
startTime: number;
workerContext?: IWorkerContext;
ownerHandlerDisposable?: Disposable;
pendingChildMessages: string[];
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
@IOrchestratorQueueService private readonly _queueService: IOrchestratorQueueService,
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
workerContext,
} = params;

const startTime = Date.now();

this._logService.info(`[CopilotAgentExecutor] Starting execution for task ${taskId} | hasWorkerContext=${!!workerContext}`);

// Track worker status
const cancellationSource = new vscode.CancellationTokenSource();
const workerState: ActiveWorkerState = {
status: { state: 'running', startTime },
cancellation: cancellationSource,
startTime,
workerContext,
pendingChildMessages: [],
};

// Register as owner handler to receive child updates if we have worker context
if (workerContext?.owner?.ownerId) {
this._logService.info(
`[CopilotAgentExecutor] Registering owner handler | workerId=${workerContext.workerId}, ownerId=${workerContext.owner.ownerId}, ownerType=${workerContext.owner.ownerType}`
);

const ownerHandlerDisposable = this._queueService.registerOwnerHandler(
workerContext.owner.ownerId,
async (message) => {
this._logService.info(
`[CopilotAgentExecutor] Received queued message | type=${message.type}, workerId=${message.workerId}, taskId=${message.taskId}, messageId=${message.id}`
);

// Format and queue the message
const formattedMessage = JSON.stringify({
type: message.type,
workerId: message.workerId,
taskId: message.taskId,
content: message.content,
timestamp: message.timestamp
}, null, 2);

// Store in worker state
const state = this._activeWorkers.get(taskId);
if (state) {
state.pendingChildMessages.push(formattedMessage);
this._logService.info(
`[CopilotAgentExecutor] Queued child message | taskId=${taskId}, queuedCount=${state.pendingChildMessages.length}`
);
} else {
this._logService.warn(
`[CopilotAgentExecutor] Received message for unknown worker | taskId=${taskId}, messageId=${message.id}`
);
}
}
) as Disposable;

workerState.ownerHandlerDisposable = ownerHandlerDisposable;

this._logService.info(
`[CopilotAgentExecutor] Owner handler registered successfully | ownerId=${workerContext.owner.ownerId}`
);
} else if (workerContext) {
this._logService.info(
`[CopilotAgentExecutor] No owner context provided - worker will not receive routed messages | workerId=${workerContext.workerId}`
);
}

this._activeWorkers.set(taskId, workerState);

try {

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

// Check if there are pending child messages from a previous interrupted execution
// If so, inject them into the prompt/context
let finalPrompt = prompt;
let finalAdditionalInstructions = additionalInstructions;

if (workerState.pendingChildMessages.length > 0) {
this._logService.info(
`[CopilotAgentExecutor] Injecting ${workerState.pendingChildMessages.length} pending child messages into execution | taskId=${taskId}`
);

// Format child messages as a system reminder
const childUpdatesContext = workerState.pendingChildMessages
.map((msg, idx) => `Child Update ${idx + 1}:\n${msg}`)
.join('\n\n---\n\n');

// Inject into additional instructions so the agent sees them
const childUpdateReminder =
`\n\n<system-reminder>\nYou have received updates from your spawned child tasks:\n\n${childUpdatesContext}\n\nReview these updates and continue your work accordingly.\n</system-reminder>`;

finalAdditionalInstructions = (additionalInstructions || '') + childUpdateReminder;

// Clear the pending messages now that we've injected them
this._logService.info(`[CopilotAgentExecutor] Clearing ${workerState.pendingChildMessages.length} injected messages | taskId=${taskId}`);
workerState.pendingChildMessages = [];
}

const result = await this._agentRunner.run({
prompt: finalPrompt,
model: resolvedModel,
token: token,
worktreePath,
history,
additionalInstructions: finalAdditionalInstructions,
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

// Dispose owner handler if registered
if (workerState?.ownerHandlerDisposable) {
this._logService.info(`[CopilotAgentExecutor] Disposing owner handler | taskId=${taskId}`);
workerState.ownerHandlerDisposable.dispose();
workerState.ownerHandlerDisposable = undefined;
}

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

// Dispose owner handler if registered
if (workerState.ownerHandlerDisposable) {
this._logService.info(`[CopilotAgentExecutor] Disposing owner handler (error path) | taskId=${taskId}`);
workerState.ownerHandlerDisposable.dispose();
workerState.ownerHandlerDisposable = undefined;
}
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
const workerState = this._activeWorkers.get(workerId);
if (!workerState) {
this._logService.warn(`[CopilotAgentExecutor] sendMessage called for unknown worker ${workerId}`);
return;
}

this._logService.info(`[CopilotAgentExecutor] Received message for worker ${workerId} | messagePreview=${message.substring(0, 100)}...`);

// Queue the message
workerState.pendingChildMessages.push(message);
this._logService.info(`[CopilotAgentExecutor] Message queued | workerId=${workerId}, queuedCount=${workerState.pendingChildMessages.length}`);

// Cancel the current execution to interrupt the agent
this._logService.info(`[CopilotAgentExecutor] Interrupting agent to inject child messages | workerId=${workerId}`);
workerState.cancellation.cancel();

// Note: The orchestrator will re-invoke execute() with the messages included in history/context
// The queued messages in pendingChildMessages will be consumed on the next execution
this._logService.info(`[CopilotAgentExecutor] Agent interrupted - awaiting re-execution with child messages | workerId=${workerId}`);
}

async cancel(workerId: string): Promise<void> {
const workerState = this._activeWorkers.get(workerId);
if (workerState) {
workerState.cancellation.cancel();
workerState.status = {
state: 'failed',
error: 'Cancelled by user',
};

// Dispose owner handler if registered
if (workerState.ownerHandlerDisposable) {
this._logService.info(`[CopilotAgentExecutor] Disposing owner handler (cancel) | workerId=${workerId}`);
workerState.ownerHandlerDisposable.dispose();
workerState.ownerHandlerDisposable = undefined;
}

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
