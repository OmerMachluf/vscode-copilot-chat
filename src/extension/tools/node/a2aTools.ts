/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { CancellationToken, LanguageModelTextPart, LanguageModelToolInvocationOptions, LanguageModelToolInvocationPrepareOptions, LanguageModelToolResult, ProviderResult, workspace } from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { IDisposable } from '../../../util/vs/base/common/lifecycle';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { IOrchestratorQueueMessage, IOrchestratorQueueService } from '../../orchestrator/orchestratorQueue';
import { ISubTask, ISubTaskCreateOptions, ISubTaskManager, ISubTaskResult } from '../../orchestrator/subTaskManager';
import { ISubtaskProgressService, ParallelSubtaskProgressRenderer } from '../../orchestrator/subtaskProgressService';
import { IWorkerContext } from '../../orchestrator/workerToolsService';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

/**
 * Parameters for spawning a single sub-task.
 */
interface SpawnSubTaskParams {
	/** The type of agent to execute the sub-task (e.g., '@architect', '@reviewer', '@agent') */
	agentType: string;
	/** The prompt/instruction for the sub-task */
	prompt: string;
	/** Description of what output is expected */
	expectedOutput: string;
	/**
	 * Optional model override (e.g., 'gpt-4o', 'claude-sonnet-4-20250514', 'claude-opus-4.5').
	 * If not provided, uses the first available copilot model.
	 * Can be a model ID or family name.
	 */
	model?: string;
	/** Files this task intends to modify (for conflict detection) */
	targetFiles?: string[];
	/**
	 * Whether to wait for the sub-task to complete before returning (default: true).
	 * If false, returns immediately with the sub-task ID. Use copilot_a2aAwaitSubTasks to wait later.
	 * This allows the parent agent to continue working while sub-tasks execute in parallel.
	 */
	blocking?: boolean;
}

/**
 * Parameters for spawning multiple sub-tasks in parallel.
 */
interface SpawnParallelSubTasksParams {
	/** Array of sub-task configurations */
	subtasks: SpawnSubTaskParams[];
	/**
	 * Whether to wait for all sub-tasks to complete before returning (default: true).
	 * If false, spawns all tasks and returns immediately with their IDs.
	 * Use copilot_a2aAwaitSubTasks to wait for completion later.
	 */
	waitForAll?: boolean;
}

/**
 * Parameters for awaiting sub-tasks.
 */
interface AwaitSubTasksParams {
	/** Array of sub-task IDs to wait for */
	subTaskIds: string[];
	/** Timeout in milliseconds (default: 5 minutes) */
	timeout?: number;
}

/**
 * Tool for spawning a single sub-task.
 * The parent agent can spawn specialized agents to handle specific parts of a task.
 */
export class A2ASpawnSubTaskTool implements ICopilotTool<SpawnSubTaskParams> {
	static readonly toolName = ToolName.A2ASpawnSubTask;

	constructor(
		@ISubTaskManager private readonly _subTaskManager: ISubTaskManager,
		@IWorkerContext private readonly _workerContext: IWorkerContext,
		@IOrchestratorQueueService private readonly _queueService: IOrchestratorQueueService,
		@ISubtaskProgressService private readonly _progressService: ISubtaskProgressService,
		@ILogService private readonly _logService: ILogService,
	) { }

	get enabled(): boolean {
		// Always enabled to allow top-level usage
		return true;
	}

	prepareInvocation(_options: LanguageModelToolInvocationPrepareOptions<SpawnSubTaskParams>, _token: CancellationToken): ProviderResult<any> {
		return { presentation: 'hidden' };
	}

	async invoke(
		options: LanguageModelToolInvocationOptions<SpawnSubTaskParams>,
		token: CancellationToken
	): Promise<LanguageModelToolResult> {
		// Use worker context if available, otherwise default to user session
		let workerId = this._workerContext?.workerId;
		if (!workerId) {
			workerId = 'user-session-v3';
		}
		const taskId = this._workerContext?.taskId ?? 'user-task';
		const planId = this._workerContext?.planId ?? 'user-plan';
		const worktreePath = this._workerContext?.worktreePath ?? workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
		const currentDepth = this._workerContext?.depth ?? 0;

		const { agentType, prompt, expectedOutput, model, targetFiles, blocking = true } = options.input;

		// Get spawn context from worker context (inherited from parent)
		// Normalize to 'orchestrator' | 'agent' (subtask is only used internally for depth checking)
		const rawSpawnContext = this._workerContext?.spawnContext ?? 'agent';
		const spawnContext: 'orchestrator' | 'agent' = rawSpawnContext === 'orchestrator' ? 'orchestrator' : 'agent';
		const effectiveMaxDepth = this._subTaskManager.getMaxDepthForContext(spawnContext);

		// Check depth limit before creating
		if (currentDepth >= effectiveMaxDepth) {
			const contextLabel = spawnContext === 'orchestrator' ? 'orchestrator-deployed worker' : 'standalone agent';
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`ERROR: Maximum sub-task depth exceeded for ${contextLabel}.\\n\\n` +
					`**Current depth:** ${currentDepth}\\n` +
					`**Maximum allowed depth for ${spawnContext} context:** ${effectiveMaxDepth}\\n\\n` +
					`Cannot spawn additional sub-tasks. Consider completing this task directly instead of delegating further.\\n` +
					`${spawnContext === 'agent' ? 'Tip: Standalone agents have max depth 1 (agent → subtask). Orchestrator workflows allow depth 2.' : ''}`
				),
			]);
		}

		// Check for file conflicts
		if (targetFiles && targetFiles.length > 0) {
			const conflicts = this._subTaskManager.checkFileConflicts(targetFiles);
			if (conflicts.length > 0) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(
						`ERROR: File conflicts detected. The following sub-tasks are already modifying the target files: ${conflicts.join(', ')}. ` +
						`Wait for those tasks to complete or choose different target files.`
					),
				]);
			}
		}

		this._logService.info(`[A2ASpawnSubTaskTool] Creating sub-task for ${agentType} at depth ${currentDepth + 1} (blocking: ${blocking})`);

		// Create sub-task options with inherited spawn context
		const createOptions: ISubTaskCreateOptions = {
			parentWorkerId: workerId,
			parentTaskId: taskId,
			planId: planId,
			worktreePath: worktreePath,
			agentType,
			prompt,
			expectedOutput,
			model,
			currentDepth,
			targetFiles,
			spawnContext,
		};

		// Create the sub-task
		const subTask = this._subTaskManager.createSubTask(createOptions);

		// Get chat stream for progress (if available through progress service)
		const parentStream = this._progressService.getStream(workerId);

		// Non-blocking mode: return immediately with task ID
		if (!blocking) {
			// Create progress tracking for the background task
			const progressHandle = this._progressService.createProgress({
				subtaskId: subTask.id,
				agentType,
				message: `Executing in background...`,
				stream: parentStream,
			});

			// Start execution in background (don't await)
			this._subTaskManager.executeSubTask(subTask.id, token)
				.then(result => {
					progressHandle.complete(result);
				})
				.catch(error => {
					progressHandle.fail(error instanceof Error ? error.message : String(error));
					this._logService.error(`[A2ASpawnSubTaskTool] Background sub-task ${subTask.id} failed:`, error);
				});

			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`Sub-task spawned in background (non-blocking).\n\n` +
					`**Sub-Task ID:** ${subTask.id}\n` +
					`**Agent:** ${agentType}\n` +
					`**Status:** running\n\n` +
					`The sub-task is now executing independently. You can:\n` +
					`1. Continue with other work while it runs\n` +
					`2. Use \`copilot_a2aAwaitSubTasks\` to wait for completion later\n` +
					`3. Use \`copilot_a2aNotifyOrchestrator\` to check status\n\n` +
					`**Note:** Results and file changes will be available when the sub-task completes.`
				),
			]);
		}

		// Blocking mode: wait for completion with progress indicator
		const collectedMessages: IOrchestratorQueueMessage[] = [];
		let handlerDisposable: IDisposable | undefined;

		// Create progress tracking
		const progressHandle = this._progressService.createProgress({
			subtaskId: subTask.id,
			agentType,
			message: `Executing (ID: ${subTask.id.slice(-8)})...`,
			stream: parentStream,
		});

		try {
			// Register this worker as owner handler to receive messages from subtask
			handlerDisposable = this._queueService.registerOwnerHandler(workerId, async (message) => {
				this._logService.debug(`[A2ASpawnSubTaskTool] Received message from subtask: ${message.type}`);
				collectedMessages.push(message);
				const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
				progressHandle.update(`[${message.type}] ${content.slice(0, 50)}...`);
			});

			// Execute the sub-task and wait for result
			const result = await this._subTaskManager.executeSubTask(subTask.id, token);

			// Mark progress as complete
			progressHandle.complete(result);

			// Format collected messages as additional context
			const messagesSummary = collectedMessages.length > 0
				? `\n\n**Sub-Task Communications (${collectedMessages.length} messages):**\n${collectedMessages.map(m => `- [${m.type}] ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n')}`
				: '';

			// Return the result
			if (result.status === 'success') {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(
						`Sub-task completed successfully.\n\n` +
						`**Sub-Task ID:** ${subTask.id}\n` +
						`**Agent:** ${agentType}\n` +
						`**Status:** ${result.status}\n\n` +
						`**Output:**\n${result.output}${messagesSummary}`
					),
				]);
			} else {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(
						`Sub-task failed.\n\n` +
						`**Sub-Task ID:** ${subTask.id}\n` +
						`**Agent:** ${agentType}\n` +
						`**Status:** ${result.status}\n` +
						`**Error:** ${result.error ?? 'Unknown error'}\n\n` +
						`**Partial Output:**\n${result.output || '(none)'}${messagesSummary}`
					),
				]);
			}
		} catch (error) {
			progressHandle.fail(error instanceof Error ? error.message : String(error));
			this._logService.error(`[A2ASpawnSubTaskTool] Failed to spawn sub-task:`, error);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`ERROR: Failed to spawn sub-task: ${error instanceof Error ? error.message : String(error)}`
				),
			]);
		} finally {
			// Always unregister the handler when done
			handlerDisposable?.dispose();
		}
	}
}

/**
 * Tool for spawning multiple sub-tasks in parallel.
 * Validates all tasks before spawning and checks for file conflicts between them.
 */
export class A2ASpawnParallelSubTasksTool implements ICopilotTool<SpawnParallelSubTasksParams> {
	static readonly toolName = ToolName.A2ASpawnParallelSubTasks;

	constructor(
		@ISubTaskManager private readonly _subTaskManager: ISubTaskManager,
		@IWorkerContext private readonly _workerContext: IWorkerContext,
		@IOrchestratorQueueService private readonly _queueService: IOrchestratorQueueService,
		@ISubtaskProgressService private readonly _progressService: ISubtaskProgressService,
		@ILogService private readonly _logService: ILogService,
	) { }

	get enabled(): boolean {
		return true;
	}

	prepareInvocation(_options: LanguageModelToolInvocationPrepareOptions<SpawnParallelSubTasksParams>, _token: CancellationToken): ProviderResult<any> {
		return { presentation: 'hidden' };
	}

	async invoke(
		options: LanguageModelToolInvocationOptions<SpawnParallelSubTasksParams>,
		token: CancellationToken
	): Promise<LanguageModelToolResult> {
		// Use worker context if available, otherwise default to user session
		let workerId = this._workerContext?.workerId;
		if (!workerId) {
			workerId = 'user-session-v3';
		}
		const taskId = this._workerContext?.taskId ?? 'user-task';
		const planId = this._workerContext?.planId ?? 'user-plan';
		const worktreePath = this._workerContext?.worktreePath ?? workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
		const currentDepth = this._workerContext?.depth ?? 0;

		const { subtasks } = options.input;

		if (!subtasks || subtasks.length === 0) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('ERROR: No subtasks provided.'),
			]);
		}

		// Get spawn context from worker context (inherited from parent)
		// Normalize to 'orchestrator' | 'agent' (subtask is only used internally for depth checking)
		const rawSpawnContext = this._workerContext?.spawnContext ?? 'agent';
		const spawnContext: 'orchestrator' | 'agent' = rawSpawnContext === 'orchestrator' ? 'orchestrator' : 'agent';
		const effectiveMaxDepth = this._subTaskManager.getMaxDepthForContext(spawnContext);

		// Validate depth limit
		if (currentDepth >= effectiveMaxDepth) {
			const contextLabel = spawnContext === 'orchestrator' ? 'orchestrator-deployed worker' : 'standalone agent';
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`ERROR: Maximum sub-task depth exceeded for ${contextLabel}.\\n\\n` +
					`**Current depth:** ${currentDepth}\\n` +
					`**Maximum allowed depth for ${spawnContext} context:** ${effectiveMaxDepth}\\n\\n` +
					`Cannot spawn additional sub-tasks.\\n` +
					`${spawnContext === 'agent' ? 'Tip: Standalone agents have max depth 1. Orchestrator workflows allow depth 2.' : ''}`
				),
			]);
		}

		// Check for file conflicts between the requested tasks
		const allTargetFiles = new Set<string>();
		const internalConflicts: string[] = [];

		for (let i = 0; i < subtasks.length; i++) {
			const task = subtasks[i];
			if (task.targetFiles) {
				for (const file of task.targetFiles) {
					const normalized = file.toLowerCase().replace(/\\/g, '/');
					if (allTargetFiles.has(normalized)) {
						internalConflicts.push(`Subtask ${i + 1} (${task.agentType}) conflicts on file: ${file}`);
					}
					allTargetFiles.add(normalized);
				}
			}
		}

		if (internalConflicts.length > 0) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`ERROR: File conflicts detected between subtasks:\n${internalConflicts.join('\n')}\n\n` +
					`Ensure parallel subtasks don't modify the same files.`
				),
			]);
		}

		// Check for conflicts with existing running tasks
		const externalConflicts = this._subTaskManager.checkFileConflicts(Array.from(allTargetFiles));
		if (externalConflicts.length > 0) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`ERROR: File conflicts with running sub-tasks: ${externalConflicts.join(', ')}`
				),
			]);
		}

		this._logService.info(`[A2ASpawnParallelSubTasksTool] Spawning ${subtasks.length} parallel sub-tasks`);

		const waitForAll = options.input.waitForAll !== false; // Default to true (blocking)

		// Create all sub-tasks first with inherited spawn context
		const createdTasks: ISubTask[] = [];
		for (const taskConfig of subtasks) {
			const createOptions: ISubTaskCreateOptions = {
				parentWorkerId: workerId,
				parentTaskId: taskId,
				planId: planId,
				worktreePath: worktreePath,
				agentType: taskConfig.agentType,
				prompt: taskConfig.prompt,
				expectedOutput: taskConfig.expectedOutput,
				model: taskConfig.model,
				currentDepth,
				targetFiles: taskConfig.targetFiles,
				spawnContext,
			};
			const task = this._subTaskManager.createSubTask(createOptions);
			createdTasks.push(task);
		}

		// NON-BLOCKING MODE: Start all tasks in background and return immediately
		if (!waitForAll) {
			this._logService.info(`[A2ASpawnParallelSubTasksTool] Non-blocking mode: starting ${createdTasks.length} tasks in background`);

			// Get chat stream for progress (if available through progress service)
			const parentStream = this._progressService.getStream(workerId);

			// Create progress renderer for parallel tasks
			const progressRenderer = new ParallelSubtaskProgressRenderer(
				this._progressService,
				parentStream,
				this._logService
			);

			// Start all tasks in background with progress tracking
			for (let i = 0; i < createdTasks.length; i++) {
				const task = createdTasks[i];
				const config = subtasks[i];

				const handle = progressRenderer.addSubtask(task.id, config.agentType);

				this._subTaskManager.executeSubTask(task.id, token)
					.then(result => {
						handle.complete(result);
						progressRenderer.reportSummary();
					})
					.catch((error) => {
						handle.fail(error instanceof Error ? error.message : String(error));
						progressRenderer.reportSummary();
						this._logService.error(`[A2ASpawnParallelSubTasksTool] Background task ${task.id} failed:`, error);
					});
			}

			const taskIds = createdTasks.map(t => t.id);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`## Parallel Sub-Tasks Started (Non-Blocking)\n\n` +
					`Started ${createdTasks.length} sub-tasks in background:\n` +
					createdTasks.map((task, i) => `- **${subtasks[i].agentType}**: \`${task.id}\``).join('\n') +
					`\n\n**Task IDs:** ${JSON.stringify(taskIds)}\n\n` +
					`Use \`copilot_a2aAwaitSubTasks\` with these task IDs when you need to retrieve results.\n` +
					`You can continue with other work in the meantime.`
				),
			]);
		}

		// BLOCKING MODE: Wait for all tasks with progress UI
		// Get chat stream for progress (if available through progress service)
		const parentStream = this._progressService.getStream(workerId);

		// Create progress renderer for parallel tasks
		const progressRenderer = new ParallelSubtaskProgressRenderer(
			this._progressService,
			parentStream,
			this._logService
		);

		// Collect messages from all subtasks while they run
		const collectedMessages: Map<string, IOrchestratorQueueMessage[]> = new Map();
		for (const task of createdTasks) {
			collectedMessages.set(task.id, []);
		}
		let handlerDisposable: IDisposable | undefined;

		try {
			// Create progress items for each subtask
			const progressHandles = createdTasks.map((task, i) =>
				progressRenderer.addSubtask(task.id, subtasks[i].agentType)
			);

			// Register this worker as owner handler to receive messages from all subtasks
			handlerDisposable = this._queueService.registerOwnerHandler(workerId, async (message) => {
				this._logService.debug(`[A2ASpawnParallelSubTasksTool] Received message from subtask: ${message.type}`);
				// Route message to the appropriate subtask's collection
				const taskMessages = collectedMessages.get(message.subTaskId ?? message.taskId);
				if (taskMessages) {
					taskMessages.push(message);
				}
				// Update progress
				if (message.type === 'completion') {
					progressRenderer.reportSummary();
				}
			});

			// Execute all in parallel
			const resultPromises = createdTasks.map((task, i) =>
				this._subTaskManager.executeSubTask(task.id, token).then(result => {
					progressHandles[i].complete(result);
					return result;
				})
			);

			const results = await Promise.all(resultPromises);

			// Report final summary
			progressRenderer.reportSummary();

			// Format results
			const resultLines: string[] = [];
			resultLines.push(`## Parallel Sub-Tasks Results\n`);
			resultLines.push(`Total: ${results.length} | Success: ${results.filter(r => r.status === 'success').length} | Failed: ${results.filter(r => r.status !== 'success').length}\n`);

			for (let i = 0; i < results.length; i++) {
				const result = results[i];
				const task = createdTasks[i];
				const taskConfig = subtasks[i];
				const taskMessages = collectedMessages.get(task.id) ?? [];

				resultLines.push(`### Sub-Task ${i + 1}: ${taskConfig.agentType}`);
				resultLines.push(`- **ID:** ${task.id}`);
				resultLines.push(`- **Status:** ${result.status}`);

				if (result.status === 'success') {
					resultLines.push(`- **Output:**\n${result.output}\n`);
				} else {
					resultLines.push(`- **Error:** ${result.error ?? 'Unknown'}`);
					if (result.output) {
						resultLines.push(`- **Partial Output:**\n${result.output}\n`);
					}
				}

				// Include collected messages for this subtask
				if (taskMessages.length > 0) {
					resultLines.push(`- **Communications (${taskMessages.length} messages):**`);
					for (const msg of taskMessages) {
						resultLines.push(`  - [${msg.type}] ${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}`);
					}
				}
				resultLines.push('');
			}

			return new LanguageModelToolResult([
				new LanguageModelTextPart(resultLines.join('\n')),
			]);

		} catch (error) {
			progressRenderer.dispose();
			this._logService.error(`[A2ASpawnParallelSubTasksTool] Failed:`, error);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`ERROR: Failed to execute parallel sub-tasks: ${error instanceof Error ? error.message : String(error)}`
				),
			]);
		} finally {
			// Always unregister the handler when done
			handlerDisposable?.dispose();
		}
	}
}

/**
 * Tool for awaiting completion of sub-tasks.
 * This is primarily useful for async patterns where tasks were spawned without waiting.
 */
export class A2AAwaitSubTasksTool implements ICopilotTool<AwaitSubTasksParams> {
	static readonly toolName = ToolName.A2AAwaitSubTasks;

	constructor(
		@ISubTaskManager private readonly _subTaskManager: ISubTaskManager,
		@IWorkerContext private readonly _workerContext: IWorkerContext,
		@IOrchestratorQueueService private readonly _queueService: IOrchestratorQueueService,
		@ILogService private readonly _logService: ILogService,
	) { }

	get enabled(): boolean {
		return this._workerContext !== undefined;
	}

	prepareInvocation(_options: LanguageModelToolInvocationPrepareOptions<AwaitSubTasksParams>, _token: CancellationToken): ProviderResult<any> {
		return { presentation: 'hidden' };
	}

	async invoke(
		options: LanguageModelToolInvocationOptions<AwaitSubTasksParams>,
		token: CancellationToken
	): Promise<LanguageModelToolResult> {
		if (!this._workerContext?.workerId) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					'ERROR: This tool can only be used within a worker context.'
				),
			]);
		}

		const workerId = this._workerContext.workerId;
		const { subTaskIds, timeout = 5 * 60 * 1000 } = options.input; // Default 5 min timeout

		if (!subTaskIds || subTaskIds.length === 0) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('ERROR: No sub-task IDs provided.'),
			]);
		}

		this._logService.info(`[A2AAwaitSubTasksTool] Waiting for ${subTaskIds.length} sub-tasks`);

		const results: Map<string, ISubTaskResult | undefined> = new Map();
		const collectedMessages: Map<string, IOrchestratorQueueMessage[]> = new Map();
		const startTime = Date.now();

		// Initialize message collection for each task
		for (const taskId of subTaskIds) {
			collectedMessages.set(taskId, []);
		}

		// Register owner handler to collect messages while waiting
		const handlerDisposable = this._queueService.registerOwnerHandler(workerId, async (message) => {
			this._logService.debug(`[A2AAwaitSubTasksTool] Received message while waiting: ${message.type}`);
			const taskMessages = collectedMessages.get(message.subTaskId ?? message.taskId);
			if (taskMessages) {
				taskMessages.push(message);
			}
		});

		try {
			// Poll for completion
			while (Date.now() - startTime < timeout) {
				if (token.isCancellationRequested) {
					return new LanguageModelToolResult([
						new LanguageModelTextPart('Operation cancelled.'),
					]);
				}

				let allComplete = true;

				for (const taskId of subTaskIds) {
					const task = this._subTaskManager.getSubTask(taskId);
					if (!task) {
						results.set(taskId, {
							taskId,
							status: 'failed',
							output: '',
							error: 'Task not found',
						});
						continue;
					}

					if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
						results.set(taskId, task.result ?? {
							taskId,
							status: task.status === 'completed' ? 'success' : 'failed',
							output: '',
							error: task.status === 'cancelled' ? 'Task was cancelled' : undefined,
						});
					} else {
						allComplete = false;
					}
				}

				if (allComplete) {
					break;
				}

				// Wait before polling again
				await new Promise(resolve => setTimeout(resolve, 1000));
			}

			// Check for timeout
			const timedOut = Date.now() - startTime >= timeout;

			// Format results
			const resultLines: string[] = [];
			resultLines.push(`## Sub-Task Await Results\n`);

			if (timedOut) {
				resultLines.push(`**WARNING:** Timeout reached. Some tasks may still be running.\n`);
			}

			for (const taskId of subTaskIds) {
				const result = results.get(taskId);
				const task = this._subTaskManager.getSubTask(taskId);
				const taskMessages = collectedMessages.get(taskId) ?? [];

				resultLines.push(`### Task: ${taskId}`);
				resultLines.push(`- **Status:** ${result?.status ?? task?.status ?? 'unknown'}`);

				if (result?.status === 'success') {
					resultLines.push(`- **Output:**\n${result.output}\n`);
				} else if (result?.error) {
					resultLines.push(`- **Error:** ${result.error}`);
				} else if (!result && task?.status === 'running') {
					resultLines.push(`- **Note:** Still running (timeout exceeded)`);
				}

				// Include collected messages for this task
				if (taskMessages.length > 0) {
					resultLines.push(`- **Communications (${taskMessages.length} messages):**`);
					for (const msg of taskMessages) {
						resultLines.push(`  - [${msg.type}] ${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}`);
					}
				}
				resultLines.push('');
			}

			return new LanguageModelToolResult([
				new LanguageModelTextPart(resultLines.join('\n')),
			]);
		} finally {
			// Always unregister the handler when done
			handlerDisposable.dispose();
		}
	}
}

/**
 * Parameters for notifying the orchestrator.
 */
interface NotifyOrchestratorParams {
	/** The type of notification */
	type: 'status_update' | 'question' | 'completion' | 'error';
	/** The content of the notification */
	content: string;
	/** Optional metadata */
	metadata?: object;
	/** Priority of the notification */
	priority?: 'high' | 'normal' | 'low';
}

/**
 * Tool for notifying the orchestrator.
 * Allows workers to send status updates, questions, or completion signals.
 */
export class A2ANotifyOrchestratorTool implements ICopilotTool<NotifyOrchestratorParams> {
	static readonly toolName = ToolName.A2ANotifyOrchestrator;

	constructor(
		@IOrchestratorQueueService private readonly _queueService: IOrchestratorQueueService,
		@IWorkerContext private readonly _workerContext: IWorkerContext,
		@ILogService private readonly _logService: ILogService,
	) { }

	get enabled(): boolean {
		return this._workerContext !== undefined;
	}

	prepareInvocation(_options: LanguageModelToolInvocationPrepareOptions<NotifyOrchestratorParams>, _token: CancellationToken): ProviderResult<any> {
		return { presentation: 'hidden' };
	}

	async invoke(
		options: LanguageModelToolInvocationOptions<NotifyOrchestratorParams>,
		_token: CancellationToken
	): Promise<LanguageModelToolResult> {
		if (!this._workerContext?.workerId) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					'ERROR: This tool can only be used within a worker context.'
				),
			]);
		}

		const { type, content, metadata, priority = 'normal' } = options.input;

		// Determine target: if we have an owner context, route to owner; otherwise route to orchestrator
		const targetDescription = this._workerContext.owner
			? `${this._workerContext.owner.ownerType} (${this._workerContext.owner.ownerId})`
			: 'orchestrator';

		this._logService.info(`[A2ANotifyOrchestratorTool] Sending ${type} notification to ${targetDescription}`);

		try {
			this._queueService.enqueueMessage({
				id: generateUuid(),
				timestamp: Date.now(),
				priority,
				planId: this._workerContext.planId ?? 'standalone',
				taskId: this._workerContext.taskId ?? this._workerContext.workerId,
				workerId: this._workerContext.workerId,
				worktreePath: this._workerContext.worktreePath,
				depth: this._workerContext.depth,
				// Include owner context for routing - messages go to owner, not directly to orchestrator
				owner: this._workerContext.owner,
				type,
				content: metadata ? { message: content, ...metadata } : content
			});

			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Notification sent to ${targetDescription}.`),
			]);
		} catch (error) {
			this._logService.error(`[A2ANotifyOrchestratorTool] Failed to send notification:`, error);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`ERROR: Failed to send notification: ${error instanceof Error ? error.message : String(error)}`
				),
			]);
		}
	}
}

// Register the tools
ToolRegistry.registerTool(A2ASpawnSubTaskTool);
ToolRegistry.registerTool(A2ASpawnParallelSubTasksTool);
ToolRegistry.registerTool(A2AAwaitSubTasksTool);
ToolRegistry.registerTool(A2ANotifyOrchestratorTool);
