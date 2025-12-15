/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CancellationToken } from '../../util/vs/base/common/cancellation';
import { Event } from '../../util/vs/base/common/event';
import { createDecorator } from '../../util/vs/platform/instantiation/common/instantiation';
import { IAgentHistoryEntry } from './orchestratorInterfaces';
import { IOrchestratorPermissions } from './orchestratorPermissions';
import { WorkerToolSet } from './workerToolsService';
import {
	AgentBackendType,
	ParsedAgentType,
	parseAgentType,
	isCopilotAgentType,
	isClaudeAgentType,
	normalizeAgentName,
	getBackendType,
	AgentTypeParseError,
} from './agentTypeParser';

// Re-export from agentTypeParser for backwards compatibility
export {
	AgentBackendType,
	ParsedAgentType,
	parseAgentType,
	isCopilotAgentType,
	isClaudeAgentType,
	normalizeAgentName,
	getBackendType,
	AgentTypeParseError,
};

// ============================================================================
// Worker Status
// ============================================================================

export type AgentWorkerStatus =
| { readonly state: 'idle' }
| { readonly state: 'running'; readonly startTime: number }
| { readonly state: 'waiting-approval'; readonly approvalId: string }
| { readonly state: 'paused' }
| { readonly state: 'completed'; readonly result: AgentExecuteResult }
| { readonly state: 'failed'; readonly error: string };

// ============================================================================
// Execution Parameters
// ============================================================================

export interface AgentExecuteOptions {
readonly timeout?: number;
readonly maxTokens?: number;
readonly temperature?: number;
readonly maxToolCallIterations?: number;
}

export interface AgentExecuteParams {
readonly taskId: string;
readonly prompt: string;
readonly worktreePath: string;
readonly agentType: ParsedAgentType;
readonly parentWorkerId?: string;
readonly expectedOutput?: string;
readonly targetFiles?: string[];
readonly model?: vscode.LanguageModelChat;
readonly modelId?: string;
readonly options?: AgentExecuteOptions;
readonly history?: IAgentHistoryEntry[];
readonly additionalInstructions?: string;
readonly workerToolSet?: WorkerToolSet;
readonly inheritedPermissions?: IOrchestratorPermissions;
readonly toolInvocationToken?: vscode.ChatParticipantToolToken;
readonly token: CancellationToken;
readonly onPaused?: Event<boolean>;
}

export interface AgentExecuteResult {
readonly status: 'success' | 'partial' | 'failed';
readonly output: string;
readonly filesChanged?: string[];
readonly error?: string;
readonly metadata?: Record<string, unknown>;
}

// ============================================================================
// Agent Executor Interface
// ============================================================================

export const IAgentExecutor = createDecorator<IAgentExecutor>('agentExecutor');

export interface IAgentExecutor {
readonly _serviceBrand: undefined;
readonly backendType: AgentBackendType;
execute(params: AgentExecuteParams, stream?: vscode.ChatResponseStream): Promise<AgentExecuteResult>;
sendMessage(workerId: string, message: string): Promise<void>;
cancel(workerId: string): Promise<void>;
getStatus(workerId: string): AgentWorkerStatus | undefined;
supports(parsedType: ParsedAgentType): boolean;
}

// ============================================================================
// Agent Executor Registry Interface
// ============================================================================

export const IAgentExecutorRegistry = createDecorator<IAgentExecutorRegistry>('agentExecutorRegistry');

export interface IAgentExecutorRegistry {
readonly _serviceBrand: undefined;
register(executor: IAgentExecutor): void;
unregister(backendType: AgentBackendType): void;
getExecutor(parsedType: ParsedAgentType): IAgentExecutor;
getExecutorByBackend(backendType: AgentBackendType): IAgentExecutor | undefined;
hasExecutor(backendType: AgentBackendType): boolean;
getRegisteredBackends(): AgentBackendType[];
}
