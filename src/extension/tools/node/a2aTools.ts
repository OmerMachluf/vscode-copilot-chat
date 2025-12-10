/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, LanguageModelTextPart, LanguageModelToolInvocationOptions, LanguageModelToolInvocationPrepareOptions, LanguageModelToolResult, ProviderResult } from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { IOrchestratorQueueService } from '../../orchestrator/orchestratorQueue';
import { ISubTask, ISubTaskCreateOptions, ISubTaskManager, ISubTaskResult } from '../../orchestrator/subTaskManager';
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
	/** Optional model override (e.g., 'gpt-4o', 'claude-sonnet-4-20250514') */
	model?: string;
	/** Files this task intends to modify (for conflict detection) */
	targetFiles?: string[];
}

/**
 * Parameters for spawning multiple sub-tasks in parallel.
 */
interface SpawnParallelSubTasksParams {
	/** Array of sub-task configurations */
	subtasks: SpawnSubTaskParams[];
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
		@ILogService private readonly _logService: ILogService,
	) { }

	get enabled(): boolean {
		// Only enabled when running within a worker context
		return this._workerContext !== undefined;
	}

	prepareInvocation(_options: LanguageModelToolInvocationPrepareOptions<SpawnSubTaskParams>, _token: CancellationToken): ProviderResult<any> {
		return { presentation: 'hidden' };
	}

	async invoke(
		options: LanguageModelToolInvocationOptions<SpawnSubTaskParams>,
		token: CancellationToken
	): Promise<LanguageModelToolResult> {
		// Validate we have worker context
		if (!this._workerContext?.workerId) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					'ERROR: This tool can only be used within a worker context. ' +
					'Sub-tasks must be spawned from an agent running as part of a plan.'
				),
			]);
		}

		const { agentType, prompt, expectedOutput, model, targetFiles } = options.input;

		// Check depth limit before creating
		const currentDepth = this._workerContext.depth ?? 0;
		if (currentDepth >= this._subTaskManager.maxDepth) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`ERROR: Maximum sub-task depth (${this._subTaskManager.maxDepth}) reached. ` +
					`Current depth: ${currentDepth}. Cannot spawn additional sub-tasks. ` +
					`Consider completing this task directly instead of delegating further.`
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

		this._logService.info(`[A2ASpawnSubTaskTool] Creating sub-task for ${agentType} at depth ${currentDepth + 1}`);

		try {
			// Create sub-task options
			const createOptions: ISubTaskCreateOptions = {
				parentWorkerId: this._workerContext.workerId,
				parentTaskId: this._workerContext.taskId ?? this._workerContext.workerId,
				planId: this._workerContext.planId ?? 'standalone',
				worktreePath: this._workerContext.worktreePath,
				agentType,
				prompt,
				expectedOutput,
				model,
				currentDepth,
				targetFiles,
			};

			// Create the sub-task
			const subTask = this._subTaskManager.createSubTask(createOptions);

			// Execute the sub-task and wait for result
			const result = await this._subTaskManager.executeSubTask(subTask.id, token);

			// Return the result
			if (result.status === 'success') {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(
						`Sub-task completed successfully.\n\n` +
						`**Sub-Task ID:** ${subTask.id}\n` +
						`**Agent:** ${agentType}\n` +
						`**Status:** ${result.status}\n\n` +
						`**Output:**\n${result.output}`
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
						`**Partial Output:**\n${result.output || '(none)'}`
					),
				]);
			}
		} catch (error) {
			this._logService.error(`[A2ASpawnSubTaskTool] Failed to spawn sub-task:`, error);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`ERROR: Failed to spawn sub-task: ${error instanceof Error ? error.message : String(error)}`
				),
			]);
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
		@ILogService private readonly _logService: ILogService,
	) { }

	get enabled(): boolean {
		return this._workerContext !== undefined;
	}

	prepareInvocation(_options: LanguageModelToolInvocationPrepareOptions<SpawnParallelSubTasksParams>, _token: CancellationToken): ProviderResult<any> {
		return { presentation: 'hidden' };
	}

	async invoke(
		options: LanguageModelToolInvocationOptions<SpawnParallelSubTasksParams>,
		token: CancellationToken
	): Promise<LanguageModelToolResult> {
		if (!this._workerContext?.workerId) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					'ERROR: This tool can only be used within a worker context.'
				),
			]);
		}

		const { subtasks } = options.input;

		if (!subtasks || subtasks.length === 0) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('ERROR: No subtasks provided.'),
			]);
		}

		const currentDepth = this._workerContext.depth ?? 0;

		// Validate depth limit
		if (currentDepth >= this._subTaskManager.maxDepth) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`ERROR: Maximum sub-task depth (${this._subTaskManager.maxDepth}) reached.`
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

		try {
			// Create all sub-tasks
			const createdTasks: ISubTask[] = [];
			for (const taskConfig of subtasks) {
				const createOptions: ISubTaskCreateOptions = {
					parentWorkerId: this._workerContext.workerId,
					parentTaskId: this._workerContext.taskId ?? this._workerContext.workerId,
					planId: this._workerContext.planId ?? 'standalone',
					worktreePath: this._workerContext.worktreePath,
					agentType: taskConfig.agentType,
					prompt: taskConfig.prompt,
					expectedOutput: taskConfig.expectedOutput,
					model: taskConfig.model,
					currentDepth,
					targetFiles: taskConfig.targetFiles,
				};
				createdTasks.push(this._subTaskManager.createSubTask(createOptions));
			}

			// Execute all in parallel
			const resultPromises = createdTasks.map(task =>
				this._subTaskManager.executeSubTask(task.id, token)
			);

			const results = await Promise.all(resultPromises);

			// Format results
			const resultLines: string[] = [];
			resultLines.push(`## Parallel Sub-Tasks Results\n`);
			resultLines.push(`Total: ${results.length} | Success: ${results.filter(r => r.status === 'success').length} | Failed: ${results.filter(r => r.status !== 'success').length}\n`);

			for (let i = 0; i < results.length; i++) {
				const result = results[i];
				const task = createdTasks[i];
				const taskConfig = subtasks[i];

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
				resultLines.push('');
			}

			return new LanguageModelToolResult([
				new LanguageModelTextPart(resultLines.join('\n')),
			]);

		} catch (error) {
			this._logService.error(`[A2ASpawnParallelSubTasksTool] Failed:`, error);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`ERROR: Failed to execute parallel sub-tasks: ${error instanceof Error ? error.message : String(error)}`
				),
			]);
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

		const { subTaskIds, timeout = 5 * 60 * 1000 } = options.input; // Default 5 min timeout

		if (!subTaskIds || subTaskIds.length === 0) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('ERROR: No sub-task IDs provided.'),
			]);
		}

		this._logService.info(`[A2AAwaitSubTasksTool] Waiting for ${subTaskIds.length} sub-tasks`);

		const results: Map<string, ISubTaskResult | undefined> = new Map();
		const startTime = Date.now();

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

			resultLines.push(`### Task: ${taskId}`);
			resultLines.push(`- **Status:** ${result?.status ?? task?.status ?? 'unknown'}`);

			if (result?.status === 'success') {
				resultLines.push(`- **Output:**\n${result.output}\n`);
			} else if (result?.error) {
				resultLines.push(`- **Error:** ${result.error}`);
			} else if (!result && task?.status === 'running') {
				resultLines.push(`- **Note:** Still running (timeout exceeded)`);
			}
			resultLines.push('');
		}

		return new LanguageModelToolResult([
			new LanguageModelTextPart(resultLines.join('\n')),
		]);
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

		this._logService.info(`[A2ANotifyOrchestratorTool] Sending ${type} notification to orchestrator`);

		try {
			this._queueService.enqueueMessage({
				id: generateUuid(),
				timestamp: Date.now(),
				priority,
				planId: this._workerContext.planId ?? 'standalone',
				taskId: this._workerContext.taskId ?? this._workerContext.workerId,
				workerId: this._workerContext.workerId,
				worktreePath: this._workerContext.worktreePath,
				type,
				content: metadata ? { message: content, ...metadata } : content
			});

			return new LanguageModelToolResult([
				new LanguageModelTextPart('Notification sent to orchestrator.'),
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
