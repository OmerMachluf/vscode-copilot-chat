/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createSdkMcpServer, McpSdkServerConfigWithInstance, tool } from '@anthropic-ai/claude-agent-sdk';
import * as vscode from 'vscode';
import { z } from 'zod';
import { ILanguageFeaturesService, isLocationLink } from '../../../../platform/languages/common/languageFeaturesService';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { getCurrentBranch } from '../../../conversation/a2a/gitOperations';
import { IAgentDiscoveryService } from '../../../orchestrator/agentDiscoveryService';
import { ISubTaskCreateOptions, ISubTaskManager, ISubTaskResult } from '../../../orchestrator/orchestratorInterfaces';
import { CreateTaskOptions, IOrchestratorService } from '../../../orchestrator/orchestratorServiceV2';
import { ISafetyLimitsService, SpawnContext } from '../../../orchestrator/safetyLimits';
import { ITaskMonitorService, ITaskUpdate, ErrorType } from '../../../orchestrator/taskMonitorService';
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
	/**
	 * Callback for receiving updates from child subtasks.
	 * Used by standalone sessions to receive pushed updates from orchestrator.
	 */
	onChildUpdate?: (message: string) => void;
}

/**
 * Default worker context for standalone sessions (not spawned as subtasks).
 * Used when no workerContext is provided.
 *
 * CRITICAL: We use workspaceRoot from dependencies instead of process.cwd()
 * because in VS Code's extension host, process.cwd() often returns the
 * VS Code installation directory (e.g., C:\Program Files\Microsoft VS Code),
 * not the actual workspace. This was causing tasks to fail immediately.
 *
 * @param workspaceRoot The workspace root directory
 */
function getDefaultWorkerContext(workspaceRoot: string | undefined): IWorkerContext {
	// CRITICAL: If no workspaceRoot is available, we should NOT use process.cwd()
	// as it returns VS Code's installation directory in the extension host.
	// Instead, leave it undefined and let the caller handle the validation.
	const effectiveWorktreePath = workspaceRoot || undefined;

	return {
		_serviceBrand: undefined,
		workerId: `claude-standalone-${Date.now()}`,
		worktreePath: effectiveWorktreePath!,  // May be undefined, but typed as string
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
	// Pass workspaceRoot to default context to avoid using process.cwd() which returns VS Code installation dir
	// CRITICAL: Evaluate once and reuse - don't regenerate on every call or parent ID will change!
	const workerContext = deps.workerContext ?? getDefaultWorkerContext(workspaceRoot);

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

	// Helper to get suggested action based on error type
	const getErrorSuggestedAction = (errorType: ErrorType | undefined): string => {
		switch (errorType) {
			case 'rate_limit':
				return 'Worker is waiting. Consider switching to claude:agent backend or wait.';
			case 'network':
				return 'Network issue detected. Worker will retry automatically.';
			case 'auth':
				return 'Authentication failed. Check credentials.';
			case 'fatal':
				return 'Unrecoverable error. Consider cancelling task.';
			case 'unknown':
			default:
				return 'An error occurred. Check the error details.';
		}
	};

	// Helper to format error update message with type and retry info
	const formatErrorMessage = (update: ITaskUpdate): string => {
		const emoji = update.errorType === 'rate_limit' ? '⏳' :
			update.errorType === 'network' ? '🔌' :
				update.errorType === 'auth' ? '🔐' :
					update.errorType === 'fatal' ? '💀' : '⚠️';

		const errorLabel = update.errorType === 'rate_limit' ? 'Rate Limited' :
			update.errorType === 'network' ? 'Network Error' :
				update.errorType === 'auth' ? 'Auth Failed' :
					update.errorType === 'fatal' ? 'Fatal Error' : 'Error';

		let message = `${emoji} ${errorLabel}`;

		if (update.retryInfo) {
			message += ` (attempt ${update.retryInfo.attempt}/${update.retryInfo.maxAttempts})`;
			if (update.retryInfo.nextRetryInMs !== undefined) {
				const retrySeconds = Math.ceil(update.retryInfo.nextRetryInMs / 1000);
				message += `: Waiting ${retrySeconds}s before retry`;
			}
		}

		if (update.error) {
			message += ` - ${update.error}`;
		}

		return message;
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
					agentType: z.string().describe('Agent to execute. Formats: Copilot agents "@agent", "@architect", "@reviewer"; Claude agents "claude:agent", "claude:architect"; or custom agent ID'),
					prompt: z.string().describe('Task instruction for the agent - be specific about what you need'),
					expectedOutput: z.string().describe('Description of what output you expect from this subtask'),
					targetFiles: z.array(z.string()).optional().describe('Files this task will modify (for conflict detection)'),
					blocking: z.boolean().default(true).describe('If true, wait for completion. If false, return task ID for later polling with a2a_await_subtasks'),
					model: z.string().optional().describe('Model override for this subtask'),
				},
				async (args) => {

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

						// Detect parent's current branch to ensure child worktrees are created from the correct branch
						let parentBranch: string | undefined;
						try {
							if (workerContext.worktreePath) {
								parentBranch = await getCurrentBranch(workerContext.worktreePath);
							}
						} catch (error) {
							// Branch detection is best-effort, fallback to default if it fails
						}

						const options: ISubTaskCreateOptions = {
							parentWorkerId: workerContext.workerId,
							parentTaskId: workerContext.taskId ?? workerContext.workerId,
							planId: workerContext.planId ?? 'claude-session',
							worktreePath: workerContext.worktreePath,
							baseBranch: parentBranch,
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
							// Non-blocking: start execution in background, return task ID for later polling
							// IMPORTANT: We must call executeSubTask to actually run the task!
							// Without this, the subtask is created but never executed.

							// Register standalone parent handler for pushed updates if callback available
							if (deps.onChildUpdate && orchestratorService) {
								orchestratorService.registerStandaloneParentHandler(
									workerContext.workerId,
									deps.onChildUpdate
								);
								console.log(`[a2a_spawn_subtask] Registered standalone parent handler for ${workerContext.workerId}`);
							}

							// Start monitoring this subtask so updates will be queued for parent
							deps.taskMonitorService.startMonitoring(subtask.id, workerContext.workerId);
							console.log(`[a2a_spawn_subtask] Started monitoring subtask ${subtask.id} for parent ${workerContext.workerId}`);

							void subTaskManager.executeSubTask(subtask.id, CancellationToken.None).catch(error => {
								console.error(`[a2a_spawn_subtask] Background subtask ${subtask.id} failed: ${error instanceof Error ? error.message : String(error)}`);
							});
							return {
								content: [{
									type: 'text',
									text: JSON.stringify({
										taskId: subtask.id,
										status: 'spawned',
										message: 'Subtask spawned and executing in background. Use a2a_await_subtasks with this taskId to poll for completion.'
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
			// a2a_reportCompletion - Report task completion to parent
			// ================================================================
			tool(
				'a2a_reportCompletion',
				'Report task completion to your parent agent. IMPORTANT: You MUST provide a commitMessage to save your changes - without it, your work will be LOST! Note: This does NOT automatically mark the task as complete in the plan - your parent must review and integrate your work.',
				{
					commitMessage: z.string().describe('REQUIRED: Git commit message describing your changes. Without this, changes are LOST!'),
					output: z.string().describe('Summary of the work you completed'),
					status: z.enum(['success', 'partial', 'failed']).default('success')
						.describe('Completion status: "success" = fully done, "partial" = some work done, "failed" = could not complete'),
				},
				async (args) => {

					// Validate commit message
					if (!args.commitMessage || args.commitMessage.trim().length === 0) {
						return {
							content: [{
								type: 'text',
								text: 'ERROR: commitMessage is REQUIRED and cannot be empty.\n' +
									'Your changes will be LOST without a commit message!\n' +
									'Please call a2a_reportCompletion again with a valid commitMessage.'
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
						agentType: z.string().describe('Agent to execute. Formats: "@agent", "@architect", "claude:agent", "claude:architect"'),
						prompt: z.string().describe('Task instruction for the agent'),
						expectedOutput: z.string().describe('Description of expected output'),
						targetFiles: z.array(z.string()).optional().describe('Files this task will modify'),
						model: z.string().optional().describe('Model override for this subtask'),
					})).describe('Array of subtask definitions to spawn in parallel'),
					blocking: z.boolean().default(true).describe('If true, wait for all to complete. If false, return task IDs for later polling'),
				},
				async (args) => {

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

						// Detect parent's current branch to ensure child worktrees are created from the correct branch
						let parentBranch: string | undefined;
						try {
							if (workerContext.worktreePath) {
								parentBranch = await getCurrentBranch(workerContext.worktreePath);
							}
						} catch (error) {
							// Branch detection is best-effort, fallback to default if it fails
						}

						// Create all subtasks
						const subtasks = args.subtasks.map(st => {
							const options: ISubTaskCreateOptions = {
								parentWorkerId: workerContext.workerId,
								parentTaskId: workerContext.taskId ?? workerContext.workerId,
								planId: workerContext.planId ?? 'claude-session',
								worktreePath: workerContext.worktreePath,
								baseBranch: parentBranch,
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
							// Non-blocking: start execution in background, return task IDs for later polling

							// Register standalone parent handler for pushed updates if callback available
							if (deps.onChildUpdate && orchestratorService) {
								orchestratorService.registerStandaloneParentHandler(
									workerContext.workerId,
									deps.onChildUpdate
								);
								console.log(`[a2a_spawn_parallel_subtasks] Registered standalone parent handler for ${workerContext.workerId}`);
							}

							// Start monitoring and executing all subtasks
							for (const subtask of subtasks) {
								deps.taskMonitorService.startMonitoring(subtask.id, workerContext.workerId);
								void subTaskManager.executeSubTask(subtask.id, CancellationToken.None).catch(error => {
									console.error(`[a2a_spawn_parallel_subtasks] Background subtask ${subtask.id} failed: ${error instanceof Error ? error.message : String(error)}`);
								});
							}
							console.log(`[a2a_spawn_parallel_subtasks] Started monitoring ${subtasks.length} subtasks for parent ${workerContext.workerId}`);

							return {
								content: [{
									type: 'text',
									text: JSON.stringify({
										taskIds: subtasks.map(st => st.id),
										status: 'spawned',
										message: 'Subtasks spawned in parallel and executing in background. Use a2a_await_subtasks to poll for completion.'
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
					agent: z.string().optional().describe('Agent to assign (@agent, @architect, claude:agent, claude:architect, or custom)'),
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
							// NOTE: Do NOT set sessionId for orchestrator plan tasks
							// Plan tasks are background orchestrator workers, not chat sessions
							// Only ClaudeCodeSession workers should use sessionId (which they get from their chat window)
							// Routing works via task.workerId (stable) + parentWorkerId, not sessionId
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

			// orchestrator_complete_task - Mark a task as completed (PARENT AGENTS ONLY)
			tool(
				'orchestrator_complete_task',
				'Mark a child task as completed after reviewing and merging their work. IMPORTANT: You can only complete tasks where YOU are the parent. Workers should use a2a_reportCompletion to notify their parent instead.',
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
						// Look up the task to get the worker ID
						const task = orchestratorService.getTaskById(args.taskId);
						if (!task) {
							return {
								content: [{
									type: 'text',
									text: `ERROR: Task ${args.taskId} not found`
								}]
							};
						}

						if (!task.workerId) {
							return {
								content: [{
									type: 'text',
									text: `ERROR: Task ${args.taskId} has no assigned worker (status: ${task.status})`
								}]
							};
						}

						// Pass the worker ID and caller's worker ID for authorization check
							await orchestratorService.completeTask(task.workerId, workerContext.workerId);
						const readyTasks = orchestratorService.getReadyTasks();
						return {
							content: [{
								type: 'text',
								text: `Worker ${task.workerId} completed (task: ${args.taskId}).\n` +
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

			// orchestrator_deploy_task - Deploy a task from a plan
			tool(
				'orchestrator_deploy_task',
				'Deploy a task from a plan. This starts a worker for the task, marks it as running, and links it to the plan. Use orchestrator_list_workers to see ready tasks.',
				{
					taskId: z.string().optional().describe('ID of the task to deploy. If not provided, deploys the next ready task.'),
					modelId: z.string().optional().describe('Optional model override for this task'),
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
						// CRITICAL: Pass the orchestrator's worker ID as parent
						// This ensures deployed workers send progress updates back to the orchestrator
						const orchestratorWorkerId = workerContext.workerId;
						console.log(`[MCP:orchestrator_deploy_task] Deploying task=${args.taskId ?? '(auto)'} with parentWorkerId=${orchestratorWorkerId}`);
						const options = {
							...(args.modelId ? { modelId: args.modelId } : {}),
							parentWorkerId: orchestratorWorkerId,
						};
						const worker = await orchestratorService.deploy(args.taskId, options);
						console.log(`[MCP:orchestrator_deploy_task] Deployed worker=${worker.id} for task, parent=${orchestratorWorkerId}`);

						// Get the task info to show task name
						const tasks = orchestratorService.getTasks();
						const task = tasks.find(t => t.workerId === worker.id);

						// CRITICAL: Start monitoring so TaskMonitorService tracks this task
						// Without this, parent never gets notified of completion!
						if (task?.id) {
							deps.taskMonitorService.startMonitoring(task.id, orchestratorWorkerId);
							console.log(`[orchestrator_deploy_task] Started monitoring task ${task.id} for parent ${orchestratorWorkerId}`);
						}

						if (deps.onChildUpdate && orchestratorService) {
							orchestratorService.registerStandaloneParentHandler(
								orchestratorWorkerId,
								deps.onChildUpdate
							);
							console.log(`[a2a_spawn_parallel_subtasks] Registered standalone parent handler for ${orchestratorWorkerId}`);
						}


						return {
							content: [{
								type: 'text',
								text: JSON.stringify({
									taskId: task?.id ?? args.taskId,
									taskName: task?.name ?? worker.name,
									workerId: worker.id,
									workerName: worker.name,
									worktreePath: worker.worktreePath,
									parentWorkerId: orchestratorWorkerId,
									status: 'deployed',
									message: `Task "${task?.name ?? worker.name}" is now running. Progress updates will be sent to orchestrator.`
								}, null, 2)
							}]
						};
					} catch (error) {
						return {
							content: [{
								type: 'text',
								text: `ERROR: Failed to deploy task: ${error instanceof Error ? error.message : String(error)}`
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
						// CRITICAL: Pass the orchestrator's worker ID as parent
						// This ensures retried workers send progress updates back to the orchestrator
						const orchestratorWorkerId = workerContext.workerId;
						const options = {
							parentWorkerId: orchestratorWorkerId,
						};
						const worker = await orchestratorService.retryTask(args.taskId, options);

						// CRITICAL: Start monitoring so TaskMonitorService tracks this task
						// Without this, parent never gets notified of completion!
						deps.taskMonitorService.startMonitoring(args.taskId, orchestratorWorkerId);
						console.log(`[orchestrator_retry_task] Started monitoring task ${args.taskId} for parent ${orchestratorWorkerId}`);

						return {
							content: [{
								type: 'text',
								text: JSON.stringify({
									taskId: args.taskId,
									workerId: worker.id,
									parentWorkerId: orchestratorWorkerId,
									status: 'redeployed',
									message: 'Task has been reset and a new worker deployed. Progress updates will be sent to orchestrator.'
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
						const formattedUpdates = updates.map(update => {
							const isErrorUpdate = update.type === 'error' || update.type === 'failed';
							const hasErrorInfo = update.errorType || update.retryInfo;

							return {
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
								// Include errorType and retryInfo for error updates
								...(update.errorType && { errorType: update.errorType }),
								...(update.retryInfo && {
									retryInfo: {
										attempt: update.retryInfo.attempt,
										maxAttempts: update.retryInfo.maxAttempts,
										willRetry: update.retryInfo.willRetry,
										...(update.retryInfo.nextRetryInMs !== undefined && {
											nextRetryInMs: update.retryInfo.nextRetryInMs
										})
									}
								}),
								// Include formatted message and suggested action for error updates
								...(isErrorUpdate && hasErrorInfo && {
									formattedMessage: formatErrorMessage(update),
									suggestedAction: getErrorSuggestedAction(update.errorType),
								}),
								...(update.idleReason && { idleReason: update.idleReason }),
								...(update.progress !== undefined && { progress: update.progress }),
								...(update.progressReport && { progressReport: update.progressReport }),
							};
						});

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
