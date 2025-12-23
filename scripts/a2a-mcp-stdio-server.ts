#!/usr/bin/env npx tsx
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Standalone stdio MCP server for testing A2A orchestration tools.
 *
 * This is a testing bridge that mocks the VS Code extension services,
 * allowing you to test MCP tool behavior in Claude Code CLI without VS Code.
 *
 * Usage:
 *   npx tsx scripts/a2a-mcp-stdio-server.ts
 *
 * Configure in .claude/settings.local.json:
 *   {
 *     "mcpServers": {
 *       "a2a-test": {
 *         "command": "npx",
 *         "args": ["tsx", "scripts/a2a-mcp-stdio-server.ts"]
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	Tool,
} from '@modelcontextprotocol/sdk/types.js';

// ============================================================================
// Mock Types (simplified from the real implementation)
// ============================================================================

interface ISubTask {
	id: string;
	status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
	agentType: string;
	prompt: string;
	expectedOutput: string;
	targetFiles?: string[];
	createdAt: number;
	result?: ISubTaskResult;
}

interface ISubTaskResult {
	taskId: string;
	status: 'success' | 'partial' | 'failed';
	output: string;
	error?: string;
	metadata?: Record<string, unknown>;
}

interface IAgentInfo {
	id: string;
	name: string;
	description: string;
	backend?: string;
	tools?: string[];
	hasArchitectureAccess?: boolean;
	source: 'builtin' | 'repo';
}

interface IPlan {
	id: string;
	name: string;
	description: string;
	status: 'draft' | 'active' | 'completed' | 'failed';
	createdAt: number;
	baseBranch?: string;
}

interface ITask {
	id: string;
	planId: string;
	name?: string;
	description: string;
	agent?: string;
	status: 'pending' | 'running' | 'completed' | 'failed';
	dependencies: string[];
	targetFiles?: string[];
	workerId?: string;
	priority?: 'critical' | 'high' | 'normal' | 'low';
}

interface IWorkerState {
	id: string;
	task: string;
	status: 'idle' | 'running' | 'completed' | 'failed';
}

interface ITaskUpdate {
	type: 'completed' | 'failed' | 'idle' | 'progress' | 'error';
	subTaskId: string;
	parentWorkerId?: string;
	timestamp: number;
	result?: ISubTaskResult;
	error?: string;
	idleReason?: string;
	progress?: number;
	progressReport?: string;
}

// ============================================================================
// Mock Service Implementations
// ============================================================================

class MockSubTaskManager {
	private subtasks = new Map<string, ISubTask>();
	private taskIdCounter = 0;

	createSubTask(options: {
		agentType: string;
		prompt: string;
		expectedOutput: string;
		targetFiles?: string[];
	}): ISubTask {
		const id = `subtask-${++this.taskIdCounter}-${Date.now()}`;
		const subtask: ISubTask = {
			id,
			status: 'pending',
			agentType: options.agentType,
			prompt: options.prompt,
			expectedOutput: options.expectedOutput,
			targetFiles: options.targetFiles,
			createdAt: Date.now(),
		};
		this.subtasks.set(id, subtask);
		console.error(`[MockSubTaskManager] Created subtask: ${id}`);
		return subtask;
	}

	async executeSubTask(taskId: string): Promise<ISubTaskResult> {
		const subtask = this.subtasks.get(taskId);
		if (!subtask) {
			throw new Error(`Subtask ${taskId} not found`);
		}

		subtask.status = 'running';
		console.error(`[MockSubTaskManager] Executing subtask: ${taskId}`);

		// Simulate execution time
		await new Promise(resolve => setTimeout(resolve, 500));

		// Mock successful completion
		const result: ISubTaskResult = {
			taskId,
			status: 'success',
			output: `[MOCK] Completed task for agent ${subtask.agentType}:\n${subtask.expectedOutput}`,
			metadata: {
				completedAt: Date.now(),
				mockExecution: true,
			}
		};

		subtask.status = 'completed';
		subtask.result = result;
		console.error(`[MockSubTaskManager] Completed subtask: ${taskId}`);
		return result;
	}

	getSubTask(taskId: string): ISubTask | undefined {
		return this.subtasks.get(taskId);
	}

	updateStatus(taskId: string, status: ISubTask['status'], result?: ISubTaskResult): void {
		const subtask = this.subtasks.get(taskId);
		if (subtask) {
			subtask.status = status;
			if (result) {
				subtask.result = result;
			}
			console.error(`[MockSubTaskManager] Updated subtask ${taskId} status: ${status}`);
		}
	}
}

class MockAgentDiscoveryService {
	async getAvailableAgents(): Promise<IAgentInfo[]> {
		return [
			{
				id: 'agent',
				name: 'General Agent',
				description: 'General-purpose coding agent',
				backend: 'copilot',
				tools: ['*'],
				source: 'builtin',
			},
			{
				id: 'architect',
				name: 'Architect',
				description: 'Designs technical implementation plans',
				backend: 'copilot',
				tools: ['search', 'fetch', 'read_file'],
				hasArchitectureAccess: true,
				source: 'builtin',
			},
			{
				id: 'reviewer',
				name: 'Reviewer',
				description: 'Reviews code changes for quality',
				backend: 'copilot',
				tools: ['search', 'fetch', 'changes', 'problems'],
				source: 'builtin',
			},
			{
				id: 'repository-researcher',
				name: 'Repository Researcher',
				description: 'Investigates codebase architecture and patterns',
				backend: 'copilot',
				tools: ['search_workspace', 'read_file', 'semantic_search'],
				hasArchitectureAccess: true,
				source: 'builtin',
			},
		];
	}
}

class MockSafetyLimitsService {
	getMaxDepthForContext(context: string): number {
		return context === 'orchestrator' ? 2 : 1;
	}
}

class MockTaskMonitorService {
	private updates: ITaskUpdate[] = [];

	queueUpdate(update: ITaskUpdate): void {
		this.updates.push(update);
		console.error(`[MockTaskMonitorService] Queued update: ${update.type} for ${update.subTaskId}`);
	}

	consumeUpdates(workerId: string): ITaskUpdate[] {
		const workerUpdates = this.updates.filter(u => u.parentWorkerId === workerId);
		this.updates = this.updates.filter(u => u.parentWorkerId !== workerId);
		return workerUpdates;
	}
}

class MockOrchestratorService {
	private plans = new Map<string, IPlan>();
	private tasks = new Map<string, ITask>();
	private workers = new Map<string, IWorkerState>();
	private activePlanId: string | undefined;
	private planIdCounter = 0;
	private taskIdCounter = 0;

	createPlan(name: string, description: string, baseBranch?: string): IPlan {
		const id = `plan-${++this.planIdCounter}`;
		const plan: IPlan = {
			id,
			name,
			description,
			status: 'draft',
			createdAt: Date.now(),
			baseBranch,
		};
		this.plans.set(id, plan);
		this.activePlanId = id;
		console.error(`[MockOrchestratorService] Created plan: ${id}`);
		return plan;
	}

	addTask(description: string, options: {
		planId?: string;
		name?: string;
		agent?: string;
		dependencies?: string[];
		targetFiles?: string[];
		priority?: 'critical' | 'high' | 'normal' | 'low';
		parallelGroup?: string;
	}): ITask {
		const id = `task-${++this.taskIdCounter}`;
		const planId = options.planId ?? this.activePlanId ?? 'default';
		const task: ITask = {
			id,
			planId,
			name: options.name,
			description,
			agent: options.agent,
			status: 'pending',
			dependencies: options.dependencies ?? [],
			targetFiles: options.targetFiles,
			priority: options.priority,
		};
		this.tasks.set(id, task);
		console.error(`[MockOrchestratorService] Added task: ${id}`);
		return task;
	}

	getPlans(): IPlan[] {
		return Array.from(this.plans.values());
	}

	getPlan(): ITask[] {
		return Array.from(this.tasks.values());
	}

	getTasks(planId: string): ITask[] {
		return Array.from(this.tasks.values()).filter(t => t.planId === planId);
	}

	getActivePlanId(): string | undefined {
		return this.activePlanId;
	}

	getWorkerStates(): IWorkerState[] {
		return Array.from(this.workers.values());
	}

	getReadyTasks(planId?: string): ITask[] {
		const tasks = planId ? this.getTasks(planId) : this.getPlan();
		return tasks.filter(t => {
			if (t.status !== 'pending') return false;
			return t.dependencies.every(depId => {
				const dep = this.tasks.get(depId);
				return dep?.status === 'completed';
			});
		});
	}

	async cancelTask(taskId: string, remove: boolean): Promise<void> {
		if (remove) {
			this.tasks.delete(taskId);
		} else {
			const task = this.tasks.get(taskId);
			if (task) {
				task.status = 'pending';
			}
		}
		console.error(`[MockOrchestratorService] ${remove ? 'Removed' : 'Reset'} task: ${taskId}`);
	}

	async completeTask(taskId: string): Promise<void> {
		const task = this.tasks.get(taskId);
		if (task) {
			task.status = 'completed';
		}
		console.error(`[MockOrchestratorService] Completed task: ${taskId}`);
	}

	async retryTask(taskId: string): Promise<IWorkerState> {
		const task = this.tasks.get(taskId);
		if (task) {
			task.status = 'running';
		}
		const worker: IWorkerState = {
			id: `worker-${Date.now()}`,
			task: taskId,
			status: 'running',
		};
		this.workers.set(worker.id, worker);
		console.error(`[MockOrchestratorService] Retried task: ${taskId} with worker ${worker.id}`);
		return worker;
	}

	sendMessageToWorker(workerId: string, message: string): void {
		console.error(`[MockOrchestratorService] Message to ${workerId}: ${message}`);
	}
}

// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS: Tool[] = [
	// A2A Tools
	{
		name: 'a2a_list_agents',
		description: 'List available agents that can be spawned as subtasks',
		inputSchema: {
			type: 'object',
			properties: {
				filter: {
					type: 'string',
					enum: ['all', 'specialists', 'custom'],
					default: 'all',
					description: 'Filter agents',
				},
			},
		},
	},
	{
		name: 'a2a_spawn_subtask',
		description: 'Spawn a subtask to delegate work to another agent',
		inputSchema: {
			type: 'object',
			properties: {
				agentType: { type: 'string', description: 'Agent to execute' },
				prompt: { type: 'string', description: 'Task instruction' },
				expectedOutput: { type: 'string', description: 'Expected output description' },
				targetFiles: { type: 'array', items: { type: 'string' }, description: 'Files to modify' },
				blocking: { type: 'boolean', default: true, description: 'Wait for completion' },
				model: { type: 'string', description: 'Model override' },
			},
			required: ['agentType', 'prompt', 'expectedOutput'],
		},
	},
	{
		name: 'a2a_await_subtasks',
		description: 'Wait for non-blocking subtasks to complete',
		inputSchema: {
			type: 'object',
			properties: {
				taskIds: { type: 'array', items: { type: 'string' }, description: 'Task IDs to wait for' },
				timeout: { type: 'number', default: 300000, description: 'Timeout in ms' },
			},
			required: ['taskIds'],
		},
	},
	{
		name: 'a2a_subtask_complete',
		description: 'Signal subtask completion with commit message',
		inputSchema: {
			type: 'object',
			properties: {
				commitMessage: { type: 'string', description: 'Git commit message (REQUIRED)' },
				output: { type: 'string', description: 'Summary of work completed' },
				status: { type: 'string', enum: ['success', 'partial', 'failed'], default: 'success' },
			},
			required: ['commitMessage', 'output'],
		},
	},
	{
		name: 'a2a_spawn_parallel_subtasks',
		description: 'Spawn multiple subtasks in parallel',
		inputSchema: {
			type: 'object',
			properties: {
				subtasks: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							agentType: { type: 'string' },
							prompt: { type: 'string' },
							expectedOutput: { type: 'string' },
							targetFiles: { type: 'array', items: { type: 'string' } },
							model: { type: 'string' },
						},
						required: ['agentType', 'prompt', 'expectedOutput'],
					},
				},
				blocking: { type: 'boolean', default: true },
			},
			required: ['subtasks'],
		},
	},
	{
		name: 'a2a_poll_subtask_updates',
		description: 'Poll for updates from spawned subtasks',
		inputSchema: { type: 'object', properties: {} },
	},
	{
		name: 'a2a_notify_parent',
		description: 'Send status update to parent worker',
		inputSchema: {
			type: 'object',
			properties: {
				type: { type: 'string', enum: ['progress', 'idle', 'error', 'info'] },
				message: { type: 'string' },
				progress: { type: 'number', minimum: 0, maximum: 100 },
			},
			required: ['type', 'message'],
		},
	},
	{
		name: 'a2a_get_worker_status',
		description: 'Get detailed status of a specific worker',
		inputSchema: {
			type: 'object',
			properties: {
				workerId: { type: 'string' },
			},
			required: ['workerId'],
		},
	},
	// Orchestrator Tools
	{
		name: 'orchestrator_save_plan',
		description: 'Create a new orchestration plan',
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string' },
				description: { type: 'string' },
				baseBranch: { type: 'string' },
			},
			required: ['name', 'description'],
		},
	},
	{
		name: 'orchestrator_add_plan_task',
		description: 'Add a task to a plan',
		inputSchema: {
			type: 'object',
			properties: {
				description: { type: 'string' },
				planId: { type: 'string' },
				name: { type: 'string' },
				agent: { type: 'string' },
				dependencies: { type: 'array', items: { type: 'string' } },
				targetFiles: { type: 'array', items: { type: 'string' } },
				priority: { type: 'string', enum: ['critical', 'high', 'normal', 'low'] },
				parallelGroup: { type: 'string' },
			},
			required: ['description'],
		},
	},
	{
		name: 'orchestrator_list_workers',
		description: 'List all plans, tasks, and workers',
		inputSchema: {
			type: 'object',
			properties: {
				planId: { type: 'string' },
			},
		},
	},
	{
		name: 'orchestrator_cancel_task',
		description: 'Cancel a task',
		inputSchema: {
			type: 'object',
			properties: {
				taskId: { type: 'string' },
				remove: { type: 'boolean', default: false },
			},
			required: ['taskId'],
		},
	},
	{
		name: 'orchestrator_complete_task',
		description: 'Mark a task as completed',
		inputSchema: {
			type: 'object',
			properties: {
				taskId: { type: 'string' },
			},
			required: ['taskId'],
		},
	},
	{
		name: 'orchestrator_retry_task',
		description: 'Retry a failed task',
		inputSchema: {
			type: 'object',
			properties: {
				taskId: { type: 'string' },
			},
			required: ['taskId'],
		},
	},
];

// ============================================================================
// Server Setup
// ============================================================================

async function main() {
	console.error('[A2A MCP Server] Starting...');

	// Initialize mock services
	const subTaskManager = new MockSubTaskManager();
	const agentDiscoveryService = new MockAgentDiscoveryService();
	const safetyLimitsService = new MockSafetyLimitsService();
	const taskMonitorService = new MockTaskMonitorService();
	const orchestratorService = new MockOrchestratorService();

	// Mock worker context (standalone session)
	const workerContext = {
		workerId: `claude-test-${Date.now()}`,
		worktreePath: process.cwd(),
		depth: 0,
		spawnContext: 'agent' as const,
	};

	// Create server
	const server = new Server(
		{
			name: 'a2a-orchestration-test',
			version: '1.0.0',
		},
		{
			capabilities: {
				tools: {},
			},
		}
	);

	// Register tool list handler
	server.setRequestHandler(ListToolsRequestSchema, async () => {
		return { tools: TOOLS };
	});

	// Register tool call handler
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;
		console.error(`[A2A MCP Server] Tool call: ${name}`);
		console.error(`[A2A MCP Server] Args: ${JSON.stringify(args, null, 2)}`);

		try {
			let result: unknown;

			switch (name) {
				// ============ A2A Tools ============
				case 'a2a_list_agents': {
					const filter = (args?.filter as string) ?? 'all';
					const agents = await agentDiscoveryService.getAvailableAgents();
					const filtered = filter === 'all'
						? agents
						: filter === 'custom'
							? agents.filter(a => a.source === 'repo')
							: agents.filter(a => a.source === 'builtin' && a.id !== 'agent');
					result = filtered;
					break;
				}

				case 'a2a_spawn_subtask': {
					const maxDepth = safetyLimitsService.getMaxDepthForContext(workerContext.spawnContext);
					if (workerContext.depth >= maxDepth) {
						result = { error: `Maximum depth (${maxDepth}) reached` };
						break;
					}

					const subtask = subTaskManager.createSubTask({
						agentType: args?.agentType as string,
						prompt: args?.prompt as string,
						expectedOutput: args?.expectedOutput as string,
						targetFiles: args?.targetFiles as string[] | undefined,
					});

					if (args?.blocking !== false) {
						const taskResult = await subTaskManager.executeSubTask(subtask.id);
						result = {
							taskId: subtask.id,
							status: taskResult.status,
							output: taskResult.output,
							error: taskResult.error,
							metadata: taskResult.metadata,
						};
					} else {
						result = {
							taskId: subtask.id,
							status: 'spawned',
							message: 'Use a2a_await_subtasks to poll for completion.',
						};
					}
					break;
				}

				case 'a2a_await_subtasks': {
					const taskIds = args?.taskIds as string[];
					const results = [];
					for (const taskId of taskIds) {
						const subtask = subTaskManager.getSubTask(taskId);
						if (!subtask) {
							results.push({ taskId, status: 'failed', error: 'Task not found' });
						} else if (subtask.result) {
							results.push(subtask.result);
						} else {
							results.push({ taskId, status: subtask.status });
						}
					}
					result = results;
					break;
				}

				case 'a2a_subtask_complete': {
					if (!args?.commitMessage) {
						result = { error: 'commitMessage is REQUIRED' };
					} else {
						result = {
							status: 'completed',
							commitMessage: args.commitMessage,
							output: args.output,
						};
					}
					break;
				}

				case 'a2a_spawn_parallel_subtasks': {
					const subtaskDefs = args?.subtasks as Array<{
						agentType: string;
						prompt: string;
						expectedOutput: string;
						targetFiles?: string[];
					}>;

					const subtasks = subtaskDefs.map(st => subTaskManager.createSubTask(st));

					if (args?.blocking !== false) {
						const results = await Promise.all(
							subtasks.map(st => subTaskManager.executeSubTask(st.id))
						);
						result = results.map((r, i) => ({
							taskId: subtasks[i].id,
							agentType: subtaskDefs[i].agentType,
							status: r.status,
							output: r.output,
							error: r.error,
						}));
					} else {
						result = {
							taskIds: subtasks.map(st => st.id),
							status: 'spawned',
						};
					}
					break;
				}

				case 'a2a_poll_subtask_updates': {
					const updates = taskMonitorService.consumeUpdates(workerContext.workerId);
					result = updates.length > 0
						? { status: 'updates_available', count: updates.length, updates }
						: { status: 'no_updates' };
					break;
				}

				case 'a2a_notify_parent': {
					taskMonitorService.queueUpdate({
						type: args?.type === 'idle' ? 'idle' : args?.type === 'error' ? 'error' : 'progress',
						subTaskId: workerContext.workerId,
						parentWorkerId: 'mock-parent',
						timestamp: Date.now(),
						idleReason: args?.type === 'idle' ? args?.message as string : undefined,
						error: args?.type === 'error' ? args?.message as string : undefined,
						progress: args?.progress as number | undefined,
						progressReport: args?.message as string,
					});
					result = { sent: true, type: args?.type, message: args?.message };
					break;
				}

				case 'a2a_get_worker_status': {
					const subtask = subTaskManager.getSubTask(args?.workerId as string);
					result = subtask ?? { error: 'Worker not found' };
					break;
				}

				// ============ Orchestrator Tools ============
				case 'orchestrator_save_plan': {
					const plan = orchestratorService.createPlan(
						args?.name as string,
						args?.description as string,
						args?.baseBranch as string | undefined
					);
					result = plan;
					break;
				}

				case 'orchestrator_add_plan_task': {
					const task = orchestratorService.addTask(args?.description as string, {
						planId: args?.planId as string | undefined,
						name: args?.name as string | undefined,
						agent: args?.agent as string | undefined,
						dependencies: args?.dependencies as string[] | undefined,
						targetFiles: args?.targetFiles as string[] | undefined,
						priority: args?.priority as 'critical' | 'high' | 'normal' | 'low' | undefined,
						parallelGroup: args?.parallelGroup as string | undefined,
					});
					result = task;
					break;
				}

				case 'orchestrator_list_workers': {
					result = {
						activePlanId: orchestratorService.getActivePlanId(),
						plans: orchestratorService.getPlans(),
						tasks: args?.planId
							? orchestratorService.getTasks(args.planId as string)
							: orchestratorService.getPlan(),
						readyTasks: orchestratorService.getReadyTasks(args?.planId as string | undefined).map(t => t.id),
						workers: orchestratorService.getWorkerStates(),
					};
					break;
				}

				case 'orchestrator_cancel_task': {
					await orchestratorService.cancelTask(args?.taskId as string, args?.remove === true);
					result = { cancelled: true, removed: args?.remove === true };
					break;
				}

				case 'orchestrator_complete_task': {
					// Look up task to get worker ID
					const taskId = args?.taskId as string;
					const task = orchestratorService.getTaskById(taskId);
					if (!task) {
						result = { error: `Task ${taskId} not found` };
						break;
					}
					if (!task.workerId) {
						result = { error: `Task ${taskId} has no assigned worker (status: ${task.status})` };
						break;
					}

					// Pass worker IDs for authorization check
					await orchestratorService.completeTask(task.workerId, workerContext.workerId);
					const readyTasks = orchestratorService.getReadyTasks();
					result = { completed: true, workerId: task.workerId, taskId, readyTasks: readyTasks.map(t => t.id) };
					break;
				}

				case 'orchestrator_retry_task': {
					const worker = await orchestratorService.retryTask(args?.taskId as string);
					result = { taskId: args?.taskId, workerId: worker.id, status: 'redeployed' };
					break;
				}

				default:
					result = { error: `Unknown tool: ${name}` };
			}

			return {
				content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
			};
		} catch (error) {
			console.error(`[A2A MCP Server] Error: ${error}`);
			return {
				content: [{
					type: 'text',
					text: `ERROR: ${error instanceof Error ? error.message : String(error)}`
				}],
				isError: true,
			};
		}
	});

	// Connect via stdio
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error('[A2A MCP Server] Connected via stdio');
}

main().catch(error => {
	console.error('[A2A MCP Server] Fatal error:', error);
	process.exit(1);
});
