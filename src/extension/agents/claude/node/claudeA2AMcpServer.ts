/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createSdkMcpServer, tool, McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import * as vscode from 'vscode';
import { z } from 'zod';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { ILanguageFeaturesService, isLocationLink } from '../../../../platform/languages/common/languageFeaturesService';
import { IAgentDiscoveryService } from '../../../orchestrator/agentDiscoveryService';
import { ISubTaskCreateOptions, ISubTaskManager, ISubTaskResult } from '../../../orchestrator/orchestratorInterfaces';
import { IOrchestratorService, CreateTaskOptions } from '../../../orchestrator/orchestratorServiceV2';
import { ISafetyLimitsService, SpawnContext } from '../../../orchestrator/safetyLimits';
import { ITaskMonitorService } from '../../../orchestrator/taskMonitorService';
import { IWorkerContext } from '../../../orchestrator/workerToolsService';

/**
 * Dependencies required to create the A2A MCP server.
 * These are injected from the ClaudeCodeSession.
 */
export interface IA2AMcpServerDependencies {
	subTaskManager: ISubTaskManager;
	agentDiscoveryService: IAgentDiscoveryService;
	safetyLimitsService: ISafetyLimitsService;
	taskMonitorService: ITaskMonitorService;
	workerContext: IWorkerContext | undefined;
	/** Optional orchestrator service for plan/task management tools */
	orchestratorService?: IOrchestratorService;
	/** Optional language features service for symbolic search tools */
	languageFeaturesService?: ILanguageFeaturesService;
	/** Optional workspace root for resolving file paths */
	workspaceRoot?: string;
}

/**
 * Default worker context for standalone sessions (not spawned as subtasks).
 * Used when no workerContext is provided.
 */
function getDefaultWorkerContext(): IWorkerContext {
	return {
		_serviceBrand: undefined,
		workerId: `claude-standalone-${Date.now()}`,
		worktreePath: process.cwd(),
		depth: 0,
		spawnContext: 'agent' as SpawnContext,
	};
}

/**
 * Creates an in-process MCP server with A2A orchestration tools.
 *
 * These tools allow Claude to:
 * - List available agents that can be spawned as subtasks
 * - Spawn subtasks to delegate work to other agents
 * - Wait for non-blocking subtasks to complete
 * - Signal completion of subtask work
 *
 * The tools run in the same Node.js process as the VS Code extension,
 * giving them direct access to all extension services via closure.
 */
export function createA2AMcpServer(deps: IA2AMcpServerDependencies): McpSdkServerConfigWithInstance {
	const {
		subTaskManager,
		agentDiscoveryService,
		safetyLimitsService,
		orchestratorService,
		languageFeaturesService,
		workspaceRoot,
	} = deps;

	// Use provided context or default for standalone sessions
	const getWorkerContext = () => deps.workerContext ?? getDefaultWorkerContext();

	// Helper to resolve file paths
	const resolveFilePath = (filePath: string): string => {
		if (filePath.startsWith('/') || filePath.match(/^[a-zA-Z]:/)) {
			return filePath; // Already absolute
		}
		return workspaceRoot ? `${workspaceRoot}/${filePath}` : filePath;
	};

	// Helper to format location for output
	const formatLocation = (loc: vscode.Location | vscode.LocationLink): {
		file: string;
		startLine: number;
		startColumn: number;
		endLine: number;
		endColumn: number;
		preview?: string;
	} => {
		if (isLocationLink(loc)) {
			return {
				file: loc.targetUri.fsPath,
				startLine: loc.targetRange.start.line + 1,
				startColumn: loc.targetRange.start.character + 1,
				endLine: loc.targetRange.end.line + 1,
				endColumn: loc.targetRange.end.character + 1,
			};
		} else {
			return {
				file: loc.uri.fsPath,
				startLine: loc.range.start.line + 1,
				startColumn: loc.range.start.character + 1,
				endLine: loc.range.end.line + 1,
				endColumn: loc.range.end.character + 1,
			};
		}
	};

	return createSdkMcpServer({
		name: 'a2a-orchestration',
		tools: [
			// ================================================================
			// a2a_list_agents - List available agents for subtask spawning
			// ================================================================
			tool(
				'a2a_list_agents',
				'List available agents that can be spawned as subtasks. Use this to discover what specialists are available for delegation.',
				{
					filter: z.enum(['all', 'specialists', 'custom']).default('all')
						.describe('Filter agents: "all" = everything, "specialists" = builtin non-default agents, "custom" = repo-defined agents'),
				},
				async (args) => {
					try {
						const agents = await agentDiscoveryService.getAvailableAgents();

						const filtered = args.filter === 'all'
							? agents
							: args.filter === 'custom'
								? agents.filter(a => a.source === 'repo')
								: agents.filter(a => a.source === 'builtin' && a.id !== 'agent');

						const formatted = filtered.map(a => ({
							id: a.id,
							name: a.name,
							description: a.description,
							backend: a.backend ?? 'copilot',
							tools: a.tools,
							hasArchitectureAccess: a.hasArchitectureAccess ?? false,
						}));

						return {
							content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }]
						};
					} catch (error) {
						return {
							content: [{ type: 'text', text: `ERROR: Failed to list agents: ${error instanceof Error ? error.message : String(error)}` }]
						};
					}
				}
			),

			// ================================================================
			// a2a_spawn_subtask - Spawn a subtask to another agent
			// ================================================================
			tool(
				'a2a_spawn_subtask',
				'Spawn a subtask to delegate work to another agent. The subtask runs in an isolated worktree context. Use a2a_list_agents first to see available agents.',
				{
					agentType: z.string().describe('Agent to execute (e.g., "@architect", "@reviewer", or custom agent ID)'),
					prompt: z.string().describe('Task instruction for the agent - be specific about what you need'),
					expectedOutput: z.string().describe('Description of what output you expect from this subtask'),
					targetFiles: z.array(z.string()).optional().describe('Files this task will modify (for conflict detection)'),
					blocking: z.boolean().default(true).describe('If true, wait for completion. If false, return task ID for later polling with a2a_await_subtasks'),
					model: z.string().optional().describe('Model override for this subtask'),
				},
				async (args) => {
					const workerContext = getWorkerContext();

					try {
						// Check depth limit
						const maxDepth = safetyLimitsService.getMaxDepthForContext(workerContext.spawnContext);
						if (workerContext.depth >= maxDepth) {
							return {
								content: [{
									type: 'text',
									text: `ERROR: Maximum subtask depth (${maxDepth}) reached. Cannot spawn subtask.\n` +
										`Current depth: ${workerContext.depth}, Context: ${workerContext.spawnContext}\n` +
										(workerContext.spawnContext === 'agent'
											? 'Tip: Standalone agents can only spawn 1 level of subtasks. Orchestrator workflows allow 2 levels.'
											: 'You are at the deepest allowed nesting level.')
								}]
							};
						}

						// Create subtask options
						// Map spawnContext: 'subtask' inherits as 'agent' for depth limits
						const effectiveSpawnContext = workerContext.spawnContext === 'subtask'
							? 'agent' as const
							: workerContext.spawnContext as 'orchestrator' | 'agent';

						const options: ISubTaskCreateOptions = {
							parentWorkerId: workerContext.workerId,
							parentTaskId: workerContext.taskId ?? workerContext.workerId,
							planId: workerContext.planId ?? 'claude-session',
							worktreePath: workerContext.worktreePath,
							agentType: args.agentType,
							prompt: args.prompt,
							expectedOutput: args.expectedOutput,
							targetFiles: args.targetFiles,
							model: args.model,
							currentDepth: workerContext.depth,
							spawnContext: effectiveSpawnContext,
						};

						// Create the subtask
						const subtask = subTaskManager.createSubTask(options);

						if (args.blocking) {
							// Wait for completion
							const result = await subTaskManager.executeSubTask(subtask.id, CancellationToken.None);
							return {
								content: [{
									type: 'text',
									text: JSON.stringify({
										taskId: subtask.id,
										status: result.status,
										output: result.output,
										error: result.error,
										metadata: result.metadata,
									}, null, 2)
								}]
							};
						} else {
							// Non-blocking: return task ID for later polling
							return {
								content: [{
									type: 'text',
									text: JSON.stringify({
										taskId: subtask.id,
										status: 'spawned',
										message: 'Subtask spawned. Use a2a_await_subtasks with this taskId to poll for completion.'
									}, null, 2)
								}]
							};
						}
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to spawn subtask: ${error instanceof Error ? error.message : String(error)}`
							}]
						};
					}
				}
			),

			// ================================================================
			// a2a_await_subtasks - Wait for non-blocking subtasks to complete
			// ================================================================
			tool(
				'a2a_await_subtasks',
				'Wait for previously spawned non-blocking subtasks to complete. Use this after spawning subtasks with blocking=false.',
				{
					taskIds: z.array(z.string()).describe('Task IDs returned from a2a_spawn_subtask with blocking=false'),
					timeout: z.number().default(300000).describe('Maximum time to wait in milliseconds (default: 5 minutes)'),
				},
				async (args) => {
					const results: Array<ISubTaskResult | { taskId: string; status: string; error?: string }> = [];

					for (const taskId of args.taskIds) {
						try {
							const subtask = subTaskManager.getSubTask(taskId);
							if (!subtask) {
								results.push({
									taskId,
									status: 'failed',
									output: '',
									error: 'Task not found - it may have been cleaned up or never existed'
								});
								continue;
							}

							// Poll until complete or timeout
							const startTime = Date.now();
							while (subtask.status === 'pending' || subtask.status === 'running') {
								if (Date.now() - startTime > args.timeout) {
									results.push({
										taskId,
										status: 'timeout',
										output: '',
										error: `Timed out after ${args.timeout}ms`
									});
									break;
								}
								// Wait 1 second between polls
								await new Promise(resolve => setTimeout(resolve, 1000));
							}

							// Check if we timed out (already added to results)
							if (results.some(r => r.taskId === taskId)) {
								continue;
							}

							// Get the result
							if (subtask.result) {
								results.push(subtask.result);
							} else {
								results.push({
									taskId,
									status: subtask.status,
									output: '',
									error: subtask.status === 'cancelled' ? 'Task was cancelled' : undefined
								});
							}
						} catch (error) {
							results.push({
								taskId,
								status: 'failed',
								error: `Error polling task: ${error instanceof Error ? error.message : String(error)}`
							});
						}
					}

					return {
						content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
					};
				}
			),

			// ================================================================
			// a2a_subtask_complete - Signal subtask completion
			// ================================================================
			tool(
				'a2a_subtask_complete',
				'Signal that your subtask work is complete. IMPORTANT: You MUST provide a commitMessage to save your changes - without it, your work will be LOST!',
				{
					commitMessage: z.string().describe('REQUIRED: Git commit message describing your changes. Without this, changes are LOST!'),
					output: z.string().describe('Summary of the work you completed'),
					status: z.enum(['success', 'partial', 'failed']).default('success')
						.describe('Completion status: "success" = fully done, "partial" = some work done, "failed" = could not complete'),
				},
				async (args) => {
					const workerContext = getWorkerContext();

					// Validate commit message
					if (!args.commitMessage || args.commitMessage.trim().length === 0) {
						return {
							content: [{
								type: 'text',
								text: 'ERROR: commitMessage is REQUIRED and cannot be empty.\n' +
									'Your changes will be LOST without a commit message!\n' +
									'Please call a2a_subtask_complete again with a valid commitMessage.'
							}]
						};
					}

					// Only update if we're actually a subtask (have a taskId)
					if (!workerContext.taskId) {
						return {
							content: [{
								type: 'text',
								text: 'WARNING: Not running as a subtask (no taskId). Completion signal ignored.\n' +
									`Output: ${args.output}\n` +
									`Status: ${args.status}`
							}]
						};
					}

					try {
						// Map status to subtask status
						const subtaskStatus = args.status === 'success' ? 'completed' : 'failed';

						// Update subtask status with result
						subTaskManager.updateStatus(workerContext.taskId, subtaskStatus, {
							taskId: workerContext.taskId,
							status: args.status,
							output: args.output,
							metadata: {
								commitMessage: args.commitMessage,
								completedAt: Date.now(),
							}
						});

						return {
							content: [{
								type: 'text',
								text: `Subtask completed successfully.\n` +
									`Status: ${args.status}\n` +
									`Commit message: ${args.commitMessage}`
							}]
						};
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to complete subtask: ${error instanceof Error ? error.message : String(error)}`
							}]
						};
					}
				}
			),

			// ================================================================
			// a2a_spawn_parallel_subtasks - Spawn multiple subtasks in parallel
			// ================================================================
			tool(
				'a2a_spawn_parallel_subtasks',
				'Spawn multiple subtasks in parallel for concurrent execution. Use this when you have independent tasks that can run simultaneously.',
				{
					subtasks: z.array(z.object({
						agentType: z.string().describe('Agent to execute (e.g., "@architect", "@reviewer")'),
						prompt: z.string().describe('Task instruction for the agent'),
						expectedOutput: z.string().describe('Description of expected output'),
						targetFiles: z.array(z.string()).optional().describe('Files this task will modify'),
						model: z.string().optional().describe('Model override for this subtask'),
					})).describe('Array of subtask definitions to spawn in parallel'),
					blocking: z.boolean().default(true).describe('If true, wait for all to complete. If false, return task IDs for later polling'),
				},
				async (args) => {
					const workerContext = getWorkerContext();

					try {
						// Check depth limit
						const maxDepth = safetyLimitsService.getMaxDepthForContext(workerContext.spawnContext);
						if (workerContext.depth >= maxDepth) {
							return {
								content: [{
									type: 'text',
									text: `ERROR: Maximum subtask depth (${maxDepth}) reached. Cannot spawn subtasks.`
								}]
							};
						}

						const effectiveSpawnContext = workerContext.spawnContext === 'subtask'
							? 'agent' as const
							: workerContext.spawnContext as 'orchestrator' | 'agent';

						// Create all subtasks
						const subtasks = args.subtasks.map(st => {
							const options: ISubTaskCreateOptions = {
								parentWorkerId: workerContext.workerId,
								parentTaskId: workerContext.taskId ?? workerContext.workerId,
								planId: workerContext.planId ?? 'claude-session',
								worktreePath: workerContext.worktreePath,
								agentType: st.agentType,
								prompt: st.prompt,
								expectedOutput: st.expectedOutput,
								targetFiles: st.targetFiles,
								model: st.model,
								currentDepth: workerContext.depth,
								spawnContext: effectiveSpawnContext,
							};
							return subTaskManager.createSubTask(options);
						});

						if (args.blocking) {
							// Execute all in parallel and wait
							const results = await Promise.all(
								subtasks.map(st => subTaskManager.executeSubTask(st.id, CancellationToken.None))
							);

							return {
								content: [{
									type: 'text',
									text: JSON.stringify(results.map((result, idx) => ({
										taskId: subtasks[idx].id,
										agentType: args.subtasks[idx].agentType,
										status: result.status,
										output: result.output,
										error: result.error,
									})), null, 2)
								}]
							};
						} else {
							// Return task IDs for later polling
							return {
								content: [{
									type: 'text',
									text: JSON.stringify({
										taskIds: subtasks.map(st => st.id),
										status: 'spawned',
										message: 'Subtasks spawned in parallel. Use a2a_await_subtasks to poll for completion.'
									}, null, 2)
								}]
							};
						}
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to spawn parallel subtasks: ${error instanceof Error ? error.message : String(error)}`
							}]
						};
					}
				}
			),

			// ================================================================
			// a2a_send_message_to_worker - Send a message to a running worker
			// ================================================================
			tool(
				'a2a_send_message_to_worker',
				'Send a message to a running worker to provide guidance or additional context.',
				{
					workerId: z.string().describe('The worker ID to send the message to'),
					message: z.string().describe('The message to send to the worker'),
				},
				async (args) => {
					if (!orchestratorService) {
						return {
							content: [{
								type: 'text',
								text: 'ERROR: Orchestrator service not available. This tool requires orchestrator context.'
							}]
						};
					}

					try {
						orchestratorService.sendMessageToWorker(args.workerId, args.message);
						return {
							content: [{
								type: 'text',
								text: `Message sent to worker ${args.workerId} successfully.`
							}]
						};
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to send message: ${error instanceof Error ? error.message : String(error)}`
							}]
						};
					}
				}
			),

			// ================================================================
			// ORCHESTRATOR TOOLS - Plan and task management
			// ================================================================

			// orchestrator_save_plan - Create a new plan
			tool(
				'orchestrator_save_plan',
				'Create a new orchestration plan. A plan is a collection of related tasks with dependencies.',
				{
					name: z.string().describe('Human-readable name for the plan'),
					description: z.string().describe('Description of what the plan accomplishes'),
					baseBranch: z.string().optional().describe('Base branch for all tasks in this plan (defaults to main/master)'),
				},
				async (args) => {
					if (!orchestratorService) {
						return {
							content: [{
								type: 'text',
								text: 'ERROR: Orchestrator service not available. This tool requires orchestrator context.'
							}]
						};
					}

					try {
						const plan = orchestratorService.createPlan(args.name, args.description, args.baseBranch);
						return {
							content: [{
								type: 'text',
								text: JSON.stringify({
									planId: plan.id,
									name: plan.name,
									description: plan.description,
									status: plan.status,
									createdAt: plan.createdAt,
								}, null, 2)
							}]
						};
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to create plan: ${error instanceof Error ? error.message : String(error)}`
							}]
						};
					}
				}
			),

			// orchestrator_add_plan_task - Add a task to a plan
			tool(
				'orchestrator_add_plan_task',
				'Add a task to an orchestration plan. Tasks can have dependencies on other tasks.',
				{
					description: z.string().describe('Task description/prompt'),
					planId: z.string().optional().describe('Plan to add task to (uses active plan if not specified)'),
					name: z.string().optional().describe('Human-readable task name (used for branch naming)'),
					agent: z.string().optional().describe('Agent to assign (@agent, @architect, @reviewer, or custom)'),
					dependencies: z.array(z.string()).optional().describe('IDs of tasks that must complete before this one'),
					targetFiles: z.array(z.string()).optional().describe('Files this task will modify'),
					priority: z.enum(['critical', 'high', 'normal', 'low']).optional().describe('Task priority'),
					parallelGroup: z.string().optional().describe('Tasks in same parallelGroup can potentially run together'),
				},
				async (args) => {
					if (!orchestratorService) {
						return {
							content: [{
								type: 'text',
								text: 'ERROR: Orchestrator service not available. This tool requires orchestrator context.'
							}]
						};
					}

					try {
						const options: CreateTaskOptions = {
							planId: args.planId ?? orchestratorService.getActivePlanId(),
							name: args.name,
							agent: args.agent,
							dependencies: args.dependencies,
							targetFiles: args.targetFiles,
							priority: args.priority,
							parallelGroup: args.parallelGroup,
						};

						const task = orchestratorService.addTask(args.description, options);
						return {
							content: [{
								type: 'text',
								text: JSON.stringify({
									taskId: task.id,
									name: task.name,
									description: task.description,
									agent: task.agent,
									status: task.status,
									dependencies: task.dependencies,
									planId: task.planId,
								}, null, 2)
							}]
						};
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to add task: ${error instanceof Error ? error.message : String(error)}`
							}]
						};
					}
				}
			),

			// orchestrator_list_workers - List all workers and their status
			tool(
				'orchestrator_list_workers',
				'List all plans, tasks, and workers with their current status. Use this to see what is running and what is ready to deploy.',
				{
					planId: z.string().optional().describe('Filter by specific plan ID'),
				},
				async (args) => {
					if (!orchestratorService) {
						return {
							content: [{
								type: 'text',
								text: 'ERROR: Orchestrator service not available. This tool requires orchestrator context.'
							}]
						};
					}

					try {
						const plans = orchestratorService.getPlans();
						const workers = orchestratorService.getWorkerStates();

						const tasksForPlan = args.planId
							? orchestratorService.getTasks(args.planId)
							: orchestratorService.getPlan();

						const readyTasks = orchestratorService.getReadyTasks(args.planId);

						return {
							content: [{
								type: 'text',
								text: JSON.stringify({
									activePlanId: orchestratorService.getActivePlanId(),
									plans: plans.map(p => ({
										id: p.id,
										name: p.name,
										status: p.status,
									})),
									tasks: tasksForPlan.map(t => ({
										id: t.id,
										name: t.name,
										status: t.status,
										agent: t.agent,
										dependencies: t.dependencies,
										workerId: t.workerId,
									})),
									readyTasks: readyTasks.map(t => t.id),
									workers: workers.map(w => ({
										workerId: w.id,
										task: w.task,
										status: w.status,
									})),
								}, null, 2)
							}]
						};
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to list workers: ${error instanceof Error ? error.message : String(error)}`
							}]
						};
					}
				}
			),

			// orchestrator_cancel_task - Cancel a task
			tool(
				'orchestrator_cancel_task',
				'Cancel a task. If running, it will be stopped. Use remove=true to delete completely, or remove=false to reset to pending.',
				{
					taskId: z.string().describe('ID of the task to cancel'),
					remove: z.boolean().default(false).describe('If true, remove task entirely. If false, reset to pending status.'),
				},
				async (args) => {
					if (!orchestratorService) {
						return {
							content: [{
								type: 'text',
								text: 'ERROR: Orchestrator service not available. This tool requires orchestrator context.'
							}]
						};
					}

					try {
						await orchestratorService.cancelTask(args.taskId, args.remove);
						return {
							content: [{
								type: 'text',
								text: args.remove
									? `Task ${args.taskId} has been removed.`
									: `Task ${args.taskId} has been reset to pending status.`
							}]
						};
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to cancel task: ${error instanceof Error ? error.message : String(error)}`
							}]
						};
					}
				}
			),

			// orchestrator_complete_task - Mark a task as completed
			tool(
				'orchestrator_complete_task',
				'Mark a task as completed. This updates the plan state and makes dependent tasks ready for deployment.',
				{
					taskId: z.string().describe('ID of the task to mark as completed'),
				},
				async (args) => {
					if (!orchestratorService) {
						return {
							content: [{
								type: 'text',
								text: 'ERROR: Orchestrator service not available. This tool requires orchestrator context.'
							}]
						};
					}

					try {
						await orchestratorService.completeTask(args.taskId);
						const readyTasks = orchestratorService.getReadyTasks();
						return {
							content: [{
								type: 'text',
								text: `Task ${args.taskId} marked as completed.\n` +
									`Ready tasks: ${readyTasks.map(t => t.id).join(', ') || 'none'}`
							}]
						};
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to complete task: ${error instanceof Error ? error.message : String(error)}`
							}]
						};
					}
				}
			),

			// orchestrator_retry_task - Retry a failed task
			tool(
				'orchestrator_retry_task',
				'Reset a failed task and re-deploy it. This clears the error state and starts a new worker.',
				{
					taskId: z.string().describe('ID of the task to retry'),
				},
				async (args) => {
					if (!orchestratorService) {
						return {
							content: [{
								type: 'text',
								text: 'ERROR: Orchestrator service not available. This tool requires orchestrator context.'
							}]
						};
					}

					try {
						const worker = await orchestratorService.retryTask(args.taskId);
						return {
							content: [{
								type: 'text',
								text: JSON.stringify({
									taskId: args.taskId,
									workerId: worker.id,
									status: 'redeployed',
									message: 'Task has been reset and a new worker deployed.'
								}, null, 2)
							}]
						};
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to retry task: ${error instanceof Error ? error.message : String(error)}`
							}]
						};
					}
				}
			),

			// ================================================================
			// SYMBOLIC SEARCH TOOLS - Code navigation
			// ================================================================

			// document_symbols - Get symbols in a document
			tool(
				'document_symbols',
				'Get all symbols (functions, classes, variables, etc.) defined in a document. Useful for understanding file structure.',
				{
					filePath: z.string().describe('Path to the file to analyze'),
				},
				async (args) => {
					if (!languageFeaturesService) {
						return {
							content: [{
								type: 'text',
								text: 'ERROR: Language features service not available.'
							}]
						};
					}

					try {
						const resolvedPath = resolveFilePath(args.filePath);
						const uri = vscode.Uri.file(resolvedPath);
						const symbols = await languageFeaturesService.getDocumentSymbols(uri);

						const formatSymbol = (symbol: vscode.DocumentSymbol, depth: number = 0): object => ({
							name: symbol.name,
							kind: vscode.SymbolKind[symbol.kind],
							range: {
								startLine: symbol.range.start.line + 1,
								endLine: symbol.range.end.line + 1,
							},
							children: symbol.children?.map(c => formatSymbol(c, depth + 1)) ?? [],
						});

						return {
							content: [{
								type: 'text',
								text: JSON.stringify(symbols.map(s => formatSymbol(s)), null, 2)
							}]
						};
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to get document symbols: ${error instanceof Error ? error.message : String(error)}`
							}]
						};
					}
				}
			),

			// get_definitions - Find symbol definitions
			tool(
				'get_definitions',
				'Find the definition(s) of a symbol at a specific position in a file. Use this to navigate to where something is defined.',
				{
					filePath: z.string().describe('Path to the file containing the symbol'),
					line: z.number().describe('Line number (1-based)'),
					column: z.number().describe('Column number (1-based)'),
				},
				async (args) => {
					if (!languageFeaturesService) {
						return {
							content: [{
								type: 'text',
								text: 'ERROR: Language features service not available.'
							}]
						};
					}

					try {
						const resolvedPath = resolveFilePath(args.filePath);
						const uri = vscode.Uri.file(resolvedPath);
						const position = new vscode.Position(args.line - 1, args.column - 1);
						const definitions = await languageFeaturesService.getDefinitions(uri, position);

						if (definitions.length === 0) {
							return {
								content: [{
									type: 'text',
									text: 'No definitions found at the specified position.'
								}]
							};
						}

						return {
							content: [{
								type: 'text',
								text: JSON.stringify(definitions.map(formatLocation), null, 2)
							}]
						};
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to get definitions: ${error instanceof Error ? error.message : String(error)}`
							}]
						};
					}
				}
			),

			// find_implementations - Find implementations of an interface/abstract class
			tool(
				'find_implementations',
				'Find all implementations of an interface, abstract class, or method. Use this to see how something is implemented.',
				{
					filePath: z.string().describe('Path to the file containing the interface/abstract'),
					line: z.number().describe('Line number (1-based)'),
					column: z.number().describe('Column number (1-based)'),
				},
				async (args) => {
					if (!languageFeaturesService) {
						return {
							content: [{
								type: 'text',
								text: 'ERROR: Language features service not available.'
							}]
						};
					}

					try {
						const resolvedPath = resolveFilePath(args.filePath);
						const uri = vscode.Uri.file(resolvedPath);
						const position = new vscode.Position(args.line - 1, args.column - 1);
						const implementations = await languageFeaturesService.getImplementations(uri, position);

						if (implementations.length === 0) {
							return {
								content: [{
									type: 'text',
									text: 'No implementations found at the specified position.'
								}]
							};
						}

						return {
							content: [{
								type: 'text',
								text: JSON.stringify(implementations.map(formatLocation), null, 2)
							}]
						};
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to find implementations: ${error instanceof Error ? error.message : String(error)}`
							}]
						};
					}
				}
			),

			// find_references - Find all references to a symbol
			tool(
				'find_references',
				'Find all references to a symbol in the codebase. Use this to see where something is used.',
				{
					filePath: z.string().describe('Path to the file containing the symbol'),
					line: z.number().describe('Line number (1-based)'),
					column: z.number().describe('Column number (1-based)'),
				},
				async (args) => {
					if (!languageFeaturesService) {
						return {
							content: [{
								type: 'text',
								text: 'ERROR: Language features service not available.'
							}]
						};
					}

					try {
						const resolvedPath = resolveFilePath(args.filePath);
						const uri = vscode.Uri.file(resolvedPath);
						const position = new vscode.Position(args.line - 1, args.column - 1);
						const references = await languageFeaturesService.getReferences(uri, position);

						if (references.length === 0) {
							return {
								content: [{
									type: 'text',
									text: 'No references found at the specified position.'
								}]
							};
						}

						return {
							content: [{
								type: 'text',
								text: JSON.stringify(references.map(formatLocation), null, 2)
							}]
						};
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to find references: ${error instanceof Error ? error.message : String(error)}`
							}]
						};
					}
				}
			),

			// workspace_symbols - Search for symbols across workspace
			tool(
				'workspace_symbols',
				'Search for symbols across the entire workspace by name. Use this to find functions, classes, or variables by name.',
				{
					query: z.string().describe('Symbol name or pattern to search for'),
				},
				async (args) => {
					if (!languageFeaturesService) {
						return {
							content: [{
								type: 'text',
								text: 'ERROR: Language features service not available.'
							}]
						};
					}

					try {
						const symbols = await languageFeaturesService.getWorkspaceSymbols(args.query);

						if (symbols.length === 0) {
							return {
								content: [{
									type: 'text',
									text: `No symbols found matching "${args.query}".`
								}]
							};
						}

						return {
							content: [{
								type: 'text',
								text: JSON.stringify(symbols.slice(0, 50).map(s => ({
									name: s.name,
									kind: vscode.SymbolKind[s.kind],
									containerName: s.containerName,
									file: s.location.uri.fsPath,
									line: s.location.range.start.line + 1,
								})), null, 2)
							}]
						};
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to search workspace symbols: ${error instanceof Error ? error.message : String(error)}`
							}]
						};
					}
				}
			),

			// ================================================================
			// WORKER COMMUNICATION TOOLS - Parent/child status and messaging
			// ================================================================

			// a2a_poll_subtask_updates - Poll for updates from spawned subtasks
			tool(
				'a2a_poll_subtask_updates',
				'Poll for updates from your spawned subtasks. Call this periodically when you have running subtasks to check their status, receive completion notifications, or see if any are idle and need guidance.',
				{},
				async () => {
					const workerContext = getWorkerContext();

					try {
						// Check if we have any pending updates
						const updates = deps.taskMonitorService.consumeUpdates(workerContext.workerId);

						if (updates.length === 0) {
							return {
								content: [{
									type: 'text',
									text: JSON.stringify({
										status: 'no_updates',
										message: 'No pending updates from subtasks.',
									}, null, 2)
								}]
							};
						}

						// Format updates for the agent
						const formattedUpdates = updates.map(update => ({
							type: update.type,
							subTaskId: update.subTaskId,
							timestamp: new Date(update.timestamp).toISOString(),
							...(update.result && {
								result: {
									status: update.result.status,
									output: update.result.output?.substring(0, 500), // Truncate long output
									error: update.result.error,
								}
							}),
							...(update.error && { error: update.error }),
							...(update.idleReason && { idleReason: update.idleReason }),
							...(update.progress !== undefined && { progress: update.progress }),
							...(update.progressReport && { progressReport: update.progressReport }),
						}));

						return {
							content: [{
								type: 'text',
								text: JSON.stringify({
									status: 'updates_available',
									count: updates.length,
									updates: formattedUpdates,
								}, null, 2)
							}]
						};
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to poll subtask updates: ${error instanceof Error ? error.message : String(error)}`
							}]
						};
					}
				}
			),

			// a2a_notify_parent - Send a status update to parent worker
			tool(
				'a2a_notify_parent',
				'Send a status update or message to your parent worker. Use this to report progress, ask for guidance when stuck, or notify about important events.',
				{
					type: z.enum(['progress', 'idle', 'error', 'info']).describe('Type of notification'),
					message: z.string().describe('Message to send to parent'),
					progress: z.number().min(0).max(100).optional().describe('Progress percentage (0-100) for progress updates'),
				},
				async (args) => {
					const workerContext = getWorkerContext();

					// Check if we have a parent to notify
					const parentWorkerId = workerContext.taskId; // Parent's task ID is our parent

					if (!parentWorkerId || parentWorkerId === workerContext.workerId) {
						return {
							content: [{
								type: 'text',
								text: 'No parent worker to notify - you are the top-level worker.'
							}]
						};
					}

					try {
						// Queue an update for the parent via TaskMonitorService
						deps.taskMonitorService.queueUpdate({
							type: args.type === 'idle' ? 'idle' : args.type === 'error' ? 'error' : 'progress',
							subTaskId: workerContext.workerId,
							parentWorkerId: parentWorkerId,
							idleReason: args.type === 'idle' ? args.message : undefined,
							error: args.type === 'error' ? args.message : undefined,
							progress: args.progress,
							progressReport: args.message,
							timestamp: Date.now(),
						});

						return {
							content: [{
								type: 'text',
								text: `Notification sent to parent worker.\nType: ${args.type}\nMessage: ${args.message}`
							}]
						};
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to notify parent: ${error instanceof Error ? error.message : String(error)}`
							}]
						};
					}
				}
			),

			// a2a_get_worker_status - Get detailed status of a specific worker
			tool(
				'a2a_get_worker_status',
				'Get detailed status of a specific worker by ID. Use this to check on the health and progress of subtasks you have spawned.',
				{
					workerId: z.string().describe('The worker/subtask ID to check'),
				},
				async (args) => {
					try {
						// Get subtask status from SubTaskManager
						const subtask = subTaskManager.getSubTask(args.workerId);

						if (!subtask) {
							return {
								content: [{
									type: 'text',
									text: `Worker ${args.workerId} not found.`
								}]
							};
						}

						return {
							content: [{
								type: 'text',
								text: JSON.stringify({
									taskId: subtask.id,
									status: subtask.status,
									agentType: subtask.agentType,
									prompt: subtask.prompt.substring(0, 200) + (subtask.prompt.length > 200 ? '...' : ''),
									createdAt: subtask.createdAt ? new Date(subtask.createdAt).toISOString() : undefined,
									result: subtask.result ? {
										status: subtask.result.status,
										output: subtask.result.output?.substring(0, 500),
										error: subtask.result.error,
									} : undefined,
								}, null, 2)
							}]
						};
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to get worker status: ${error instanceof Error ? error.message : String(error)}`
							}]
						};
					}
				}
			),
		]
	});
}
