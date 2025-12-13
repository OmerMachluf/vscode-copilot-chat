/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../platform/log/common/logService';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../util/vs/platform/instantiation/common/instantiation';
import {
	AgentBackendType,
	IAgentExecutor,
	IAgentExecutorRegistry,
	ParsedAgentType,
} from './agentExecutor';
import { ClaudeCodeAgentExecutor } from './executors/claudeCodeAgentExecutor';
import { CopilotAgentExecutor } from './executors/copilotAgentExecutor';

// Re-export executor classes for external usage
export { ClaudeCodeAgentExecutor } from './executors/claudeCodeAgentExecutor';
export { CopilotAgentExecutor } from './executors/copilotAgentExecutor';

export class AgentExecutorRegistry extends Disposable implements IAgentExecutorRegistry {
readonly _serviceBrand: undefined;

private readonly _executors = new Map<AgentBackendType, IAgentExecutor>();

constructor(
@ILogService private readonly _logService: ILogService,
) {
super();
}

register(executor: IAgentExecutor): void {
const backendType = executor.backendType;
if (this._executors.has(backendType)) {
throw new Error(`Executor already registered for backend type: ${backendType}`);
}
this._executors.set(backendType, executor);
this._logService.info(`[AgentExecutorRegistry] Registered executor for backend: ${backendType}`);
}

unregister(backendType: AgentBackendType): void {
if (this._executors.delete(backendType)) {
this._logService.info(`[AgentExecutorRegistry] Unregistered executor for backend: ${backendType}`);
}
}

getExecutor(parsedType: ParsedAgentType): IAgentExecutor {
const executor = this._executors.get(parsedType.backend);
if (!executor) {
const available = Array.from(this._executors.keys()).join(', ') || 'none';
throw new Error(
`No executor registered for backend type '${parsedType.backend}'. ` +
`Agent type: ${parsedType.rawType}. Available backends: ${available}`
);
}
if (!executor.supports(parsedType)) {
throw new Error(
`Executor for '${parsedType.backend}' does not support agent type '${parsedType.rawType}'. ` +
`Agent name: ${parsedType.agentName}`
);
}
return executor;
}

getExecutorByBackend(backendType: AgentBackendType): IAgentExecutor | undefined {
return this._executors.get(backendType);
}

hasExecutor(backendType: AgentBackendType): boolean {
return this._executors.has(backendType);
}

getRegisteredBackends(): AgentBackendType[] {
return Array.from(this._executors.keys());
}

override dispose(): void {
this._executors.clear();
super.dispose();
}
}
/**
 * Registers all built-in agent executors with the registry.
 *
 * This function should be called during service initialization to ensure
 * that all supported backend types are available for task execution.
 *
 * @param registry - The executor registry to register executors with
 * @param instantiationService - The instantiation service for creating executor instances
 */
export function registerBuiltInExecutors(
	registry: IAgentExecutorRegistry,
	instantiationService: IInstantiationService
): void {
	// Register Copilot executor (default)
	const copilotExecutor = instantiationService.createInstance(CopilotAgentExecutor);
	registry.register(copilotExecutor);

	// Register Claude Code executor
	const claudeExecutor = instantiationService.createInstance(ClaudeCodeAgentExecutor);
	registry.register(claudeExecutor);
}