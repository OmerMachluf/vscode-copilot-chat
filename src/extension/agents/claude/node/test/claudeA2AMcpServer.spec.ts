/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createA2AMcpServer, IA2AMcpServerDependencies } from '../claudeA2AMcpServer';
import { ISubTaskManager } from '../../../../orchestrator/orchestratorInterfaces';
import { AgentInfo, IAgentDiscoveryService } from '../../../../orchestrator/agentDiscoveryService';
import { IOrchestratorService } from '../../../../orchestrator/orchestratorServiceV2';
import { ISafetyLimitsService } from '../../../../orchestrator/safetyLimits';
import { ITaskMonitorService } from '../../../../orchestrator/taskMonitorService';
import { IWorkerContext } from '../../../../orchestrator/workerToolsService';
import { ILanguageFeaturesService } from '../../../../../platform/languages/common/languageFeaturesService';

describe('A2A MCP Server', () => {
	let mockSubTaskManager: ISubTaskManager;
	let mockAgentDiscoveryService: IAgentDiscoveryService;
	let mockSafetyLimitsService: ISafetyLimitsService;
	let mockTaskMonitorService: ITaskMonitorService;
	let mockWorkerContext: IWorkerContext;

	beforeEach(() => {
		// Mock SubTaskManager - using type assertion for testing purposes
		mockSubTaskManager = {
			_serviceBrand: undefined,
			createSubTask: vi.fn().mockReturnValue({
				id: 'subtask-1',
				status: 'pending',
			}),
			executeSubTask: vi.fn().mockResolvedValue({
				taskId: 'subtask-1',
				status: 'success',
				output: 'Task completed successfully',
			}),
			getSubTask: vi.fn().mockReturnValue({
				id: 'subtask-1',
				status: 'completed',
				result: {
					taskId: 'subtask-1',
					status: 'success',
					output: 'Task completed',
				},
			}),
			updateStatus: vi.fn(),
			cancelSubTask: vi.fn(),
			onDidChangeSubTask: vi.fn() as any,
		} as unknown as ISubTaskManager;

		// Mock AgentDiscoveryService
		const mockAgents: AgentInfo[] = [
			{
				id: 'architect',
				name: 'Architect',
				description: 'System architecture agent',
				source: 'builtin',
				tools: ['codeSearch', 'fileEdit'],
				backend: 'copilot',
				hasArchitectureAccess: true,
			},
			{
				id: 'reviewer',
				name: 'Reviewer',
				description: 'Code review agent',
				source: 'builtin',
				tools: ['codeSearch'],
				backend: 'claude',
			},
			{
				id: 'custom-agent',
				name: 'Custom Agent',
				description: 'A custom repo agent',
				source: 'repo',
				tools: [],
			},
		];

		mockAgentDiscoveryService = {
			_serviceBrand: undefined,
			getAvailableAgents: vi.fn().mockResolvedValue(mockAgents),
			getAgent: vi.fn(),
			getBuiltinAgents: vi.fn().mockResolvedValue([]),
			getRepoAgents: vi.fn().mockResolvedValue([]),
			clearCache: vi.fn(),
		} as unknown as IAgentDiscoveryService;

		// Mock SafetyLimitsService
		mockSafetyLimitsService = {
			_serviceBrand: undefined,
			getMaxDepthForContext: vi.fn().mockReturnValue(2),
			config: {},
		} as unknown as ISafetyLimitsService;

		// Mock TaskMonitorService
		mockTaskMonitorService = {
			_serviceBrand: undefined,
		} as unknown as ITaskMonitorService;

		// Mock WorkerContext
		mockWorkerContext = {
			_serviceBrand: undefined,
			workerId: 'worker-1',
			worktreePath: '/workspace/.worktrees/feature',
			depth: 0,
			spawnContext: 'orchestrator',
			taskId: 'task-1',
			planId: 'plan-1',
		};
	});

	describe('createA2AMcpServer', () => {
		test('should create MCP server with correct name', () => {
			const deps: IA2AMcpServerDependencies = {
				subTaskManager: mockSubTaskManager,
				agentDiscoveryService: mockAgentDiscoveryService,
				safetyLimitsService: mockSafetyLimitsService,
				taskMonitorService: mockTaskMonitorService,
				workerContext: mockWorkerContext,
			};

			const server = createA2AMcpServer(deps);

			expect(server).toBeDefined();
			expect(server.name).toBe('a2a-orchestration');
			expect(server.type).toBe('sdk');
		});

		test('should work without worker context (standalone session)', () => {
			const deps: IA2AMcpServerDependencies = {
				subTaskManager: mockSubTaskManager,
				agentDiscoveryService: mockAgentDiscoveryService,
				safetyLimitsService: mockSafetyLimitsService,
				taskMonitorService: mockTaskMonitorService,
				workerContext: undefined,
			};

			const server = createA2AMcpServer(deps);
			expect(server).toBeDefined();
			expect(server.name).toBe('a2a-orchestration');
		});

		test('should include instance property', () => {
			const deps: IA2AMcpServerDependencies = {
				subTaskManager: mockSubTaskManager,
				agentDiscoveryService: mockAgentDiscoveryService,
				safetyLimitsService: mockSafetyLimitsService,
				taskMonitorService: mockTaskMonitorService,
				workerContext: mockWorkerContext,
			};

			const server = createA2AMcpServer(deps);

			// The server should have an instance property (McpServer)
			expect(server.instance).toBeDefined();
		});
	});

	describe('dependency injection', () => {
		test('should accept all required dependencies', () => {
			const deps: IA2AMcpServerDependencies = {
				subTaskManager: mockSubTaskManager,
				agentDiscoveryService: mockAgentDiscoveryService,
				safetyLimitsService: mockSafetyLimitsService,
				taskMonitorService: mockTaskMonitorService,
				workerContext: mockWorkerContext,
			};

			// Should not throw
			expect(() => createA2AMcpServer(deps)).not.toThrow();
		});

		test('should work with orchestrator spawn context', () => {
			const orchestratorContext: IWorkerContext = {
				...mockWorkerContext,
				spawnContext: 'orchestrator',
			};

			const deps: IA2AMcpServerDependencies = {
				subTaskManager: mockSubTaskManager,
				agentDiscoveryService: mockAgentDiscoveryService,
				safetyLimitsService: mockSafetyLimitsService,
				taskMonitorService: mockTaskMonitorService,
				workerContext: orchestratorContext,
			};

			const server = createA2AMcpServer(deps);
			expect(server).toBeDefined();
		});

		test('should work with agent spawn context', () => {
			const agentContext: IWorkerContext = {
				...mockWorkerContext,
				spawnContext: 'agent',
			};

			const deps: IA2AMcpServerDependencies = {
				subTaskManager: mockSubTaskManager,
				agentDiscoveryService: mockAgentDiscoveryService,
				safetyLimitsService: mockSafetyLimitsService,
				taskMonitorService: mockTaskMonitorService,
				workerContext: agentContext,
			};

			const server = createA2AMcpServer(deps);
			expect(server).toBeDefined();
		});

		test('should work with subtask spawn context', () => {
			const subtaskContext: IWorkerContext = {
				...mockWorkerContext,
				spawnContext: 'subtask',
			};

			const deps: IA2AMcpServerDependencies = {
				subTaskManager: mockSubTaskManager,
				agentDiscoveryService: mockAgentDiscoveryService,
				safetyLimitsService: mockSafetyLimitsService,
				taskMonitorService: mockTaskMonitorService,
				workerContext: subtaskContext,
			};

			const server = createA2AMcpServer(deps);
			expect(server).toBeDefined();
		});

		test('should work with different depth values', () => {
			const testDepths = [0, 1, 2];

			for (const depth of testDepths) {
				const contextWithDepth: IWorkerContext = {
					...mockWorkerContext,
					depth,
				};

				const deps: IA2AMcpServerDependencies = {
					subTaskManager: mockSubTaskManager,
					agentDiscoveryService: mockAgentDiscoveryService,
					safetyLimitsService: mockSafetyLimitsService,
					taskMonitorService: mockTaskMonitorService,
					workerContext: contextWithDepth,
				};

				const server = createA2AMcpServer(deps);
				expect(server).toBeDefined();
			}
		});
	});

	describe('worker context handling', () => {
		test('should use provided worker context', () => {
			const customContext: IWorkerContext = {
				_serviceBrand: undefined,
				workerId: 'custom-worker',
				worktreePath: '/custom/path',
				depth: 1,
				spawnContext: 'agent',
				taskId: 'custom-task',
				planId: 'custom-plan',
			};

			const deps: IA2AMcpServerDependencies = {
				subTaskManager: mockSubTaskManager,
				agentDiscoveryService: mockAgentDiscoveryService,
				safetyLimitsService: mockSafetyLimitsService,
				taskMonitorService: mockTaskMonitorService,
				workerContext: customContext,
			};

			// Server should be created with the custom context
			const server = createA2AMcpServer(deps);
			expect(server).toBeDefined();
		});

		test('should handle undefined taskId in worker context', () => {
			const contextWithoutTaskId: IWorkerContext = {
				_serviceBrand: undefined,
				workerId: 'worker-1',
				worktreePath: '/workspace/.worktrees/feature',
				depth: 0,
				spawnContext: 'agent',
				// taskId is undefined
			};

			const deps: IA2AMcpServerDependencies = {
				subTaskManager: mockSubTaskManager,
				agentDiscoveryService: mockAgentDiscoveryService,
				safetyLimitsService: mockSafetyLimitsService,
				taskMonitorService: mockTaskMonitorService,
				workerContext: contextWithoutTaskId,
			};

			const server = createA2AMcpServer(deps);
			expect(server).toBeDefined();
		});

		test('should handle undefined planId in worker context', () => {
			const contextWithoutPlanId: IWorkerContext = {
				_serviceBrand: undefined,
				workerId: 'worker-1',
				worktreePath: '/workspace/.worktrees/feature',
				depth: 0,
				spawnContext: 'agent',
				taskId: 'task-1',
				// planId is undefined
			};

			const deps: IA2AMcpServerDependencies = {
				subTaskManager: mockSubTaskManager,
				agentDiscoveryService: mockAgentDiscoveryService,
				safetyLimitsService: mockSafetyLimitsService,
				taskMonitorService: mockTaskMonitorService,
				workerContext: contextWithoutPlanId,
			};

			const server = createA2AMcpServer(deps);
			expect(server).toBeDefined();
		});
	});

	describe('optional dependencies', () => {
		let mockOrchestratorService: IOrchestratorService;
		let mockLanguageFeaturesService: ILanguageFeaturesService;

		beforeEach(() => {
			// Mock OrchestratorService
			mockOrchestratorService = {
				_serviceBrand: undefined,
				createPlan: vi.fn().mockReturnValue({
					id: 'plan-1',
					name: 'Test Plan',
					description: 'Test description',
					status: 'draft',
					createdAt: Date.now(),
				}),
				addTask: vi.fn().mockReturnValue({
					id: 'task-1',
					name: 'Test Task',
					description: 'Test task description',
					status: 'pending',
					dependencies: [],
				}),
				getPlans: vi.fn().mockReturnValue([]),
				getTasks: vi.fn().mockReturnValue([]),
				getPlan: vi.fn().mockReturnValue([]),
				getWorkerStates: vi.fn().mockReturnValue([]),
				getReadyTasks: vi.fn().mockReturnValue([]),
				getActivePlanId: vi.fn().mockReturnValue(undefined),
				cancelTask: vi.fn().mockResolvedValue(undefined),
				completeTask: vi.fn().mockResolvedValue(undefined),
				retryTask: vi.fn().mockResolvedValue({ workerId: 'worker-1' }),
				sendMessageToWorker: vi.fn(),
				onDidChangeWorkers: vi.fn() as any,
				onOrchestratorEvent: vi.fn() as any,
			} as unknown as IOrchestratorService;

			// Mock LanguageFeaturesService
			mockLanguageFeaturesService = {
				_serviceBrand: undefined,
				getDocumentSymbols: vi.fn().mockResolvedValue([]),
				getDefinitions: vi.fn().mockResolvedValue([]),
				getImplementations: vi.fn().mockResolvedValue([]),
				getReferences: vi.fn().mockResolvedValue([]),
				getWorkspaceSymbols: vi.fn().mockResolvedValue([]),
				getDiagnostics: vi.fn().mockReturnValue([]),
			} as unknown as ILanguageFeaturesService;
		});

		test('should create server with orchestrator service', () => {
			const deps: IA2AMcpServerDependencies = {
				subTaskManager: mockSubTaskManager,
				agentDiscoveryService: mockAgentDiscoveryService,
				safetyLimitsService: mockSafetyLimitsService,
				taskMonitorService: mockTaskMonitorService,
				workerContext: mockWorkerContext,
				orchestratorService: mockOrchestratorService,
			};

			const server = createA2AMcpServer(deps);
			expect(server).toBeDefined();
			expect(server.name).toBe('a2a-orchestration');
		});

		test('should create server with language features service', () => {
			const deps: IA2AMcpServerDependencies = {
				subTaskManager: mockSubTaskManager,
				agentDiscoveryService: mockAgentDiscoveryService,
				safetyLimitsService: mockSafetyLimitsService,
				taskMonitorService: mockTaskMonitorService,
				workerContext: mockWorkerContext,
				languageFeaturesService: mockLanguageFeaturesService,
			};

			const server = createA2AMcpServer(deps);
			expect(server).toBeDefined();
			expect(server.name).toBe('a2a-orchestration');
		});

		test('should create server with workspace root', () => {
			const deps: IA2AMcpServerDependencies = {
				subTaskManager: mockSubTaskManager,
				agentDiscoveryService: mockAgentDiscoveryService,
				safetyLimitsService: mockSafetyLimitsService,
				taskMonitorService: mockTaskMonitorService,
				workerContext: mockWorkerContext,
				workspaceRoot: '/workspace',
			};

			const server = createA2AMcpServer(deps);
			expect(server).toBeDefined();
			expect(server.name).toBe('a2a-orchestration');
		});

		test('should create server with all optional dependencies', () => {
			const deps: IA2AMcpServerDependencies = {
				subTaskManager: mockSubTaskManager,
				agentDiscoveryService: mockAgentDiscoveryService,
				safetyLimitsService: mockSafetyLimitsService,
				taskMonitorService: mockTaskMonitorService,
				workerContext: mockWorkerContext,
				orchestratorService: mockOrchestratorService,
				languageFeaturesService: mockLanguageFeaturesService,
				workspaceRoot: '/workspace',
			};

			const server = createA2AMcpServer(deps);
			expect(server).toBeDefined();
			expect(server.name).toBe('a2a-orchestration');
		});

		test('should work without any optional dependencies', () => {
			const deps: IA2AMcpServerDependencies = {
				subTaskManager: mockSubTaskManager,
				agentDiscoveryService: mockAgentDiscoveryService,
				safetyLimitsService: mockSafetyLimitsService,
				taskMonitorService: mockTaskMonitorService,
				workerContext: mockWorkerContext,
				// No optional dependencies
			};

			const server = createA2AMcpServer(deps);
			expect(server).toBeDefined();
			expect(server.name).toBe('a2a-orchestration');
		});
	});
});
