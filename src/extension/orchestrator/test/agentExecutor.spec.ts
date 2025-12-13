/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vscode';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ILogService } from '../../../platform/log/common/logService';
import {
AgentBackendType,
AgentExecuteParams,
AgentExecuteResult,
AgentWorkerStatus,
IAgentExecutor,
ParsedAgentType,
parseAgentType,
} from '../agentExecutor';
import { AgentExecutorRegistry } from '../agentExecutorRegistry';

// Mock ILogService
function createMockLogService(): ILogService {
return {
trace: vi.fn(),
debug: vi.fn(),
info: vi.fn(),
warn: vi.fn(),
error: vi.fn(),
critical: vi.fn(),
flush: vi.fn(),
getLevel: vi.fn().mockReturnValue(0),
setLevel: vi.fn(),
onDidChangeLogLevel: vi.fn(),
} as unknown as ILogService;
}

// Mock implementation of IAgentExecutor for testing
class MockAgentExecutor implements IAgentExecutor {
readonly _serviceBrand: undefined;
readonly backendType: AgentBackendType;
executeCallCount = 0;
sendMessageCallCount = 0;
cancelCallCount = 0;

constructor(backend: AgentBackendType) {
this.backendType = backend;
}

async execute(params: AgentExecuteParams): Promise<AgentExecuteResult> {
this.executeCallCount++;
return {
status: 'success',
output: `Executed by ${this.backendType} executor`,
};
}

async sendMessage(workerId: string, message: string): Promise<void> {
this.sendMessageCallCount++;
}

async cancel(workerId: string): Promise<void> {
this.cancelCallCount++;
}

getStatus(workerId: string): AgentWorkerStatus | undefined {
return { state: 'idle' };
}

supports(parsedType: ParsedAgentType): boolean {
return parsedType.backend === this.backendType;
}
}

describe('AgentExecutor', () => {
describe('parseAgentType', () => {
it('should parse simple agent type', () => {
const result = parseAgentType('@agent');
expect(result.rawType).toBe('@agent');
expect(result.agentName).toBe('@agent');
expect(result.backend).toBe('copilot');
});

it('should parse architect agent type', () => {
const result = parseAgentType('@architect');
expect(result.rawType).toBe('@architect');
expect(result.agentName).toBe('@architect');
expect(result.backend).toBe('copilot');
});

it('should parse reviewer agent type', () => {
const result = parseAgentType('@reviewer');
expect(result.rawType).toBe('@reviewer');
expect(result.agentName).toBe('@reviewer');
expect(result.backend).toBe('copilot');
});

it('should parse backend-specific agent type', () => {
const result = parseAgentType('claude:sonnet');
expect(result.rawType).toBe('claude:sonnet');
expect(result.agentName).toBe('sonnet');
expect(result.backend).toBe('claude');
});

it('should parse CLI backend', () => {
const result = parseAgentType('cli:local-agent');
expect(result.rawType).toBe('cli:local-agent');
expect(result.agentName).toBe('local-agent');
expect(result.backend).toBe('cli');
});

it('should handle model override', () => {
const result = parseAgentType('@agent', 'gpt-4o');
expect(result.modelOverride).toBe('gpt-4o');
});
});

describe('AgentExecutorRegistry', () => {
let registry: AgentExecutorRegistry;
let logService: ILogService;

beforeEach(() => {
logService = createMockLogService();
registry = new AgentExecutorRegistry(logService);
});

it('should register an executor', () => {
const executor = new MockAgentExecutor('copilot');
registry.register(executor);
expect(registry.hasExecutor('copilot')).toBe(true);
});

it('should throw when registering duplicate backend', () => {
const executor1 = new MockAgentExecutor('copilot');
const executor2 = new MockAgentExecutor('copilot');
registry.register(executor1);
expect(() => registry.register(executor2)).toThrow(/already registered/);
});

it('should unregister an executor', () => {
const executor = new MockAgentExecutor('copilot');
registry.register(executor);
expect(registry.hasExecutor('copilot')).toBe(true);
registry.unregister('copilot');
expect(registry.hasExecutor('copilot')).toBe(false);
});

it('should get executor by parsed type', () => {
const executor = new MockAgentExecutor('copilot');
registry.register(executor);
const parsedType = parseAgentType('@agent');
const retrieved = registry.getExecutor(parsedType);
expect(retrieved).toBe(executor);
});

it('should throw when no executor found', () => {
const parsedType = parseAgentType('claude:sonnet');
expect(() => registry.getExecutor(parsedType)).toThrow(/No executor registered/);
});

it('should throw when executor does not support agent type', () => {
const executor = new MockAgentExecutor('copilot');
registry.register(executor);
const parsedType = parseAgentType('claude:sonnet');
// Register copilot but try to get claude
expect(() => registry.getExecutor(parsedType)).toThrow(/No executor registered/);
});

it('should list registered backends', () => {
registry.register(new MockAgentExecutor('copilot'));
registry.register(new MockAgentExecutor('claude'));
const backends = registry.getRegisteredBackends();
expect(backends).toContain('copilot');
expect(backends).toContain('claude');
expect(backends).toHaveLength(2);
});

it('should get executor by backend type directly', () => {
const executor = new MockAgentExecutor('copilot');
registry.register(executor);
const retrieved = registry.getExecutorByBackend('copilot');
expect(retrieved).toBe(executor);
});

it('should return undefined for unregistered backend', () => {
const retrieved = registry.getExecutorByBackend('copilot');
expect(retrieved).toBeUndefined();
});

it('should clear executors on dispose', () => {
registry.register(new MockAgentExecutor('copilot'));
registry.register(new MockAgentExecutor('claude'));
registry.dispose();
expect(registry.hasExecutor('copilot')).toBe(false);
expect(registry.hasExecutor('claude')).toBe(false);
});
});

describe('MockAgentExecutor', () => {
it('should execute and return result', async () => {
const executor = new MockAgentExecutor('copilot');
const mockToken = { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as CancellationToken;
const result = await executor.execute({
taskId: 'test-task',
prompt: 'Test prompt',
worktreePath: '/test/path',
agentType: parseAgentType('@agent'),
token: mockToken,
});
expect(result.status).toBe('success');
expect(result.output).toContain('copilot');
expect(executor.executeCallCount).toBe(1);
});

it('should track send message calls', async () => {
const executor = new MockAgentExecutor('copilot');
await executor.sendMessage('worker-1', 'Hello');
await executor.sendMessage('worker-1', 'World');
expect(executor.sendMessageCallCount).toBe(2);
});

it('should track cancel calls', async () => {
const executor = new MockAgentExecutor('copilot');
await executor.cancel('worker-1');
expect(executor.cancelCallCount).toBe(1);
});

it('should return idle status by default', () => {
const executor = new MockAgentExecutor('copilot');
const status = executor.getStatus('any-worker');
expect(status).toEqual({ state: 'idle' });
});

it('should support matching backend type', () => {
const executor = new MockAgentExecutor('copilot');
expect(executor.supports(parseAgentType('@agent'))).toBe(true);
expect(executor.supports(parseAgentType('claude:sonnet'))).toBe(false);
});
});
});
