/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { IDisposable } from '../../../util/vs/base/common/lifecycle';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IOrchestratorQueueMessage, IOrchestratorQueueService } from '../../orchestrator/orchestratorQueue';
import { IOrchestratorService } from '../../orchestrator/orchestratorServiceV2';
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
	 * Optional model override. Recommended Copilot models (in priority order):
	 * - 'claude-3.7-sonnet' or 'claude-3.5-sonnet' - Anthropic Claude (best for complex reasoning)
	 * - 'gemini-2.5-pro' - Google Gemini Pro (good balance of speed/quality)
	 * - 'gpt-4.1' or 'gpt-4o' - OpenAI GPT models
	 *
	 * If not provided, defaults to the best available premium copilot model.
	 * Models must have vendor 'copilot' to use your Copilot subscription.
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
		@IWorkspaceService private readonly _workspaceService: IWorkspaceService,
	) { }

	get enabled(): boolean {
		// Always enabled to allow top-level usage
		return true;
	}

	prepareInvocation(_options: vscode.LanguageModelToolInvocationPrepareOptions<SpawnSubTaskParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return { presentation: 'hidden' };
	}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<SpawnSubTaskParams>,
		token: CancellationToken
	): Promise<LanguageModelToolResult> {
		this._logService.info(`[A2ASpawnSubTaskTool] invoke`);

		// Use worker context if available, otherwise default to user session
		let workerId = this._workerContext?.workerId;
		if (!workerId) {
			workerId = 'user-session-v3';
			this._logService.debug(`[A2ASpawnSubTaskTool] No worker context, using default workerId: ${workerId}`);
		} else {
			this._logService.debug(`[A2ASpawnSubTaskTool] Using worker context workerId: ${workerId}`);
		}

		const taskId = this._workerContext?.taskId ?? 'user-task';
		const planId = this._workerContext?.planId ?? 'user-plan';
		// Get worktree path: from worker context, or from workspace folder, or empty (orchestrator will create one)
		const workspaceFolders = this._workspaceService.getWorkspaceFolders();
		const worktreePath = this._workerContext?.worktreePath || workspaceFolders?.[0]?.fsPath || '';
		const currentDepth = this._workerContext?.depth ?? 0;

		const { agentType, prompt, expectedOutput, model, targetFiles, blocking = true } = options.input;

		this._logService.debug(`[A2ASpawnSubTaskTool] Input params: agentType=${agentType}, blocking=${blocking}, model=${model || 'default'}, currentDepth=${currentDepth}`);
		this._logService.debug(`[A2ASpawnSubTaskTool] Context: taskId=${taskId}, planId=${planId}`);
		this._logService.debug(`[A2ASpawnSubTaskTool] Worktree resolved: ${worktreePath || '(empty - orchestrator will create)'}`);
		this._logService.debug(`[A2ASpawnSubTaskTool] Prompt preview: ${prompt.slice(0, 100)}...`);

		// Get spawn context from worker context (inherited from parent)
		// Normalize to 'orchestrator' | 'agent' (subtask is only used internally for depth checking)
		const rawSpawnContext = this._workerContext?.spawnContext ?? 'agent';
		const spawnContext: 'orchestrator' | 'agent' = rawSpawnContext === 'orchestrator' ? 'orchestrator' : 'agent';
		const effectiveMaxDepth = this._subTaskManager.getMaxDepthForContext(spawnContext);

		this._logService.debug(`[A2ASpawnSubTaskTool] Spawn context: ${spawnContext}, effectiveMaxDepth=${effectiveMaxDepth}`);

		// Check depth limit before creating
		if (currentDepth >= effectiveMaxDepth) {
			this._logService.warn(`[A2ASpawnSubTaskTool] DEPTH LIMIT EXCEEDED: currentDepth=${currentDepth} >= maxDepth=${effectiveMaxDepth}`);
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
			this._logService.info(`[A2ASpawnSubTaskTool] Checking file conflicts for: ${targetFiles.join(', ')}`);
			const conflicts = this._subTaskManager.checkFileConflicts(targetFiles);
			if (conflicts.length > 0) {
				this._logService.warn(`[A2ASpawnSubTaskTool] FILE CONFLICTS DETECTED: ${conflicts.join(', ')}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(
						`ERROR: File conflicts detected. The following sub-tasks are already modifying the target files: ${conflicts.join(', ')}. ` +
						`Wait for those tasks to complete or choose different target files.`
					),
				]);
			}
		}

		this._logService.info(`[A2ASpawnSubTaskTool] Spawning subtask: agentType=${agentType}, blocking=${blocking}, depth=${currentDepth + 1}`);

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
		this._logService.info(`[A2ASpawnSubTaskTool] SubTask created: id=${subTask.id}`);

		// Get chat stream for progress (if available through progress service)
		const parentStream = this._progressService.getStream(workerId);
		this._logService.debug(`[A2ASpawnSubTaskTool] Parent stream for workerId '${workerId}': ${parentStream ? 'FOUND' : 'NOT FOUND'}`);

		// Non-blocking mode: return immediately with task ID
		if (!blocking) {
			this._logService.debug(`[A2ASpawnSubTaskTool] Non-blocking mode: returning immediately`);
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
					this._logService.error(`[A2ASpawnSubTaskTool] Background sub-task ${subTask.id} failed: ${error instanceof Error ? error.message : String(error)}`);
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
		this._logService.debug(`[A2ASpawnSubTaskTool] Blocking mode: waiting for ${subTask.id}`);
		const collectedMessages: IOrchestratorQueueMessage[] = [];
		let handlerDisposable: IDisposable | undefined;

		// Create progress tracking
		this._logService.info(`[A2ASpawnSubTaskTool] Creating progress handle for subtask ${subTask.id}`);
		const progressHandle = this._progressService.createProgress({
			subtaskId: subTask.id,
			agentType,
			message: `Executing (ID: ${subTask.id.slice(-8)})...`,
			stream: parentStream,
		});

		// Get the parent's worker ID for registering handlers
		const parentWorkerId = this._workerContext?.workerId;

		try {
			// Register this worker as owner handler to receive messages from subtask
			if (parentWorkerId) {
				this._logService.debug(`[A2ASpawnSubTaskTool] Registering owner handler for parentWorkerId '${parentWorkerId}'`);
				handlerDisposable = this._queueService.registerOwnerHandler(parentWorkerId, async (message) => {
					this._logService.info(`[A2ASpawnSubTaskTool] RECEIVED MESSAGE from subtask: type=${message.type}, taskId=${message.taskId}`);
					collectedMessages.push(message);
					const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
					progressHandle.update(`[${message.type}] ${content.slice(0, 50)}...`);
				});
			}

			// Execute the sub-task and wait for result
			this._logService.debug(`[A2ASpawnSubTaskTool] Calling executeSubTask for ${subTask.id}`);
			const result = await this._subTaskManager.executeSubTask(subTask.id, token);
			this._logService.info(`[A2ASpawnSubTaskTool] Subtask completed: id=${subTask.id}, status=${result.status}`);
			this._logService.debug(`[A2ASpawnSubTaskTool] Result output preview: ${(result.output || '').slice(0, 200)}...`);

			// Mark progress as complete
			progressHandle.complete(result);
			this._logService.info(`[A2ASpawnSubTaskTool] Progress marked complete`);

			// Format collected messages as additional context
			const messagesSummary = collectedMessages.length > 0
				? `\n\n**Sub-Task Communications (${collectedMessages.length} messages):**\n${collectedMessages.map(m => `- [${m.type}] ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n')}`
				: '';
			this._logService.info(`[A2ASpawnSubTaskTool] Collected ${collectedMessages.length} messages from subtask`);

			// Extract merge info from result metadata (if subtask used separate worktree)
			const mergeResult = result.metadata?.mergeResult as { success: boolean; mergedFiles: string[]; error?: string } | undefined;
			const mergedFilesSummary = mergeResult?.mergedFiles?.length
				? `\n\n**Files merged to your worktree (${mergeResult.mergedFiles.length}):**\n${mergeResult.mergedFiles.map(f => `- ${f}`).join('\n')}`
				: '';
			const mergeError = mergeResult && !mergeResult.success
				? `\n\n⚠️ **Merge warning:** ${mergeResult.error}`
				: '';

			// Extract worktree info for parent to review and pull
			const subtaskWorktree = result.metadata?.subtaskWorktree as string | undefined;
			const changedFiles = result.metadata?.changedFiles as string[] | undefined;
			const subtaskWorkerId = result.metadata?.workerId as string | undefined;
			const worktreeInfo = subtaskWorktree && changedFiles?.length
				? `\n\n**⚠️ Subtask made changes in its worktree:**\n` +
				`- **Worktree:** ${subtaskWorktree}\n` +
				`- **Worker ID:** ${subtaskWorkerId}\n` +
				`- **Changed files (${changedFiles.length}):**\n${changedFiles.map(f => `  - ${f}`).join('\n')}\n\n` +
				`**Next steps:**\n` +
				`1. Review if the work is satisfactory\n` +
				`2. If YES: Use \`a2a_pull_subtask_changes\` to pull changes to your worktree, then \`a2a_complete_subtask\` to cleanup\n` +
				`3. If NO: Use \`a2a_send_message_to_worker\` to send feedback and continue the work`
				: '';

			// Return the result
			if (result.status === 'success') {
				this._logService.info(`[A2ASpawnSubTaskTool] ========== INVOKE COMPLETED (SUCCESS) ==========`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(
						`Sub-task completed successfully.\n\n` +
						`**Sub-Task ID:** ${subTask.id}\n` +
						`**Agent:** ${agentType}\n` +
						`**Status:** ${result.status}\n\n` +
						`**Output:**\n${result.output}${worktreeInfo}${mergedFilesSummary}${mergeError}${messagesSummary}`
					),
				]);
			} else {
				this._logService.info(`[A2ASpawnSubTaskTool] ========== INVOKE COMPLETED (FAILED) ==========`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(
						`Sub-task failed.\n\n` +
						`**Sub-Task ID:** ${subTask.id}\n` +
						`**Agent:** ${agentType}\n` +
						`**Status:** ${result.status}\n` +
						`**Error:** ${result.error ?? 'Unknown error'}\n\n` +
						`**Partial Output:**\n${result.output || '(none)'}${worktreeInfo}${mergedFilesSummary}${mergeError}${messagesSummary}`
					),
				]);
			}
		} catch (error) {
			this._logService.error(`[A2ASpawnSubTaskTool] EXCEPTION in invoke: ${error instanceof Error ? error.message : String(error)}`);
			progressHandle.fail(error instanceof Error ? error.message : String(error));
			this._logService.error(`[A2ASpawnSubTaskTool] Failed to spawn sub-task: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`ERROR: Failed to spawn sub-task: ${error instanceof Error ? error.message : String(error)}`
				),
			]);
		} finally {
			// Always unregister the handler when done
			this._logService.info(`[A2ASpawnSubTaskTool] Cleaning up: disposing handler`);
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
		@IWorkspaceService private readonly _workspaceService: IWorkspaceService,
	) { }

	get enabled(): boolean {
		return true;
	}

	prepareInvocation(_options: vscode.LanguageModelToolInvocationPrepareOptions<SpawnParallelSubTasksParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return { presentation: 'hidden' };
	}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<SpawnParallelSubTasksParams>,
		token: CancellationToken
	): Promise<LanguageModelToolResult> {
		// Use worker context if available, otherwise default to user session
		let workerId = this._workerContext?.workerId;
		if (!workerId) {
			workerId = 'user-session-v3';
		}
		const taskId = this._workerContext?.taskId ?? 'user-task';
		const planId = this._workerContext?.planId ?? 'user-plan';
		const worktreePath = this._workerContext?.worktreePath ?? this._workspaceService.getWorkspaceFolders()?.[0]?.fsPath ?? '';
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
						this._logService.error(`[A2ASpawnParallelSubTasksTool] Background task ${task.id} failed: ${error instanceof Error ? error.message : String(error)}`);
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

				// Extract worktree info from result metadata
				const subtaskWorktree = result.metadata?.subtaskWorktree as string | undefined;
				const changedFiles = result.metadata?.changedFiles as string[] | undefined;
				const workerId = result.metadata?.workerId as string | undefined;

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

				// Include worktree info for parent to review
				if (subtaskWorktree && changedFiles?.length) {
					resultLines.push(`- **⚠️ Changes in separate worktree:**`);
					resultLines.push(`  - Worktree: ${subtaskWorktree}`);
					resultLines.push(`  - Worker ID: ${workerId}`);
					resultLines.push(`  - Changed files (${changedFiles.length}):`);
					for (const file of changedFiles) {
						resultLines.push(`    - ${file}`);
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

			// Add parent guidance if any subtasks have changes to review
			const hasChangesToReview = results.some(r => {
				const changedFiles = r.metadata?.changedFiles as string[] | undefined;
				return changedFiles && changedFiles.length > 0;
			});

			if (hasChangesToReview) {
				resultLines.push('---');
				resultLines.push('### Next Steps for Each Subtask with Changes:');
				resultLines.push('1. **Review** the changes in each subtask\'s worktree');
				resultLines.push('2. If satisfied with a subtask: Use `a2a_pull_subtask_changes` with the worker ID to merge changes');
				resultLines.push('3. If not satisfied: Use `a2a_send_message_to_worker` to send feedback to continue work');
				resultLines.push('');
			}

			return new LanguageModelToolResult([
				new LanguageModelTextPart(resultLines.join('\n')),
			]);

		} catch (error) {
			progressRenderer.dispose();
			this._logService.error(`[A2ASpawnParallelSubTasksTool] Failed: ${error instanceof Error ? error.message : String(error)}`);
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

	prepareInvocation(_options: vscode.LanguageModelToolInvocationPrepareOptions<AwaitSubTasksParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return { presentation: 'hidden' };
	}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<AwaitSubTasksParams>,
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

	prepareInvocation(_options: vscode.LanguageModelToolInvocationPrepareOptions<NotifyOrchestratorParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return { presentation: 'hidden' };
	}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<NotifyOrchestratorParams>,
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
			this._logService.error(`[A2ANotifyOrchestratorTool] Failed to send notification: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`ERROR: Failed to send notification: ${error instanceof Error ? error.message : String(error)}`
				),
			]);
		}
	}
}

// ============================================================================
// Parent-side tools for managing subtask results
// ============================================================================

interface PullSubTaskChangesParams {
	/** The subtask's worktree path (from the spawn result metadata) */
	subtaskWorktree: string;
	/** Whether to also cleanup/remove the subtask worktree after pulling (default: false) */
	cleanup?: boolean;
}

/**
 * Tool for parent agents to pull changes from a completed subtask's worktree.
 * After reviewing subtask output, parent can use this to merge changes to their worktree.
 */
export class A2APullSubTaskChangesTool implements ICopilotTool<PullSubTaskChangesParams> {
	static readonly toolName = ToolName.A2APullSubTaskChanges;

	constructor(
		@IWorkerContext private readonly _workerContext: IWorkerContext,
		@ILogService private readonly _logService: ILogService,
		@IWorkspaceService private readonly _workspaceService: IWorkspaceService,
	) { }

	get enabled(): boolean {
		return true;
	}

	prepareInvocation(_options: vscode.LanguageModelToolInvocationPrepareOptions<PullSubTaskChangesParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return { invocationMessage: 'Pulling changes from subtask worktree...' };
	}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<PullSubTaskChangesParams>,
		_token: CancellationToken
	): Promise<LanguageModelToolResult> {
		const { subtaskWorktree, cleanup = false } = options.input;

		// Determine parent's worktree
		const parentWorktree = this._workerContext?.worktreePath ||
			this._workspaceService.getWorkspaceFolders()?.[0]?.fsPath;

		if (!parentWorktree) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('ERROR: Could not determine your worktree path.'),
			]);
		}

		if (!subtaskWorktree) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('ERROR: subtaskWorktree parameter is required.'),
			]);
		}

		if (subtaskWorktree === parentWorktree) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('Subtask used the same worktree - no pull needed. Changes are already in your worktree.'),
			]);
		}

		this._logService.info(`[A2APullSubTaskChangesTool] Pulling changes from ${subtaskWorktree} to ${parentWorktree}`);

		// Verify paths exist
		const fs = await import('fs');

		if (!fs.existsSync(subtaskWorktree)) {
			this._logService.error(`[A2APullSubTaskChangesTool] Subtask worktree does not exist: ${subtaskWorktree}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`ERROR: Subtask worktree path does not exist: ${subtaskWorktree}`),
			]);
		}

		try {
			// Step 1: Get the subtask's branch name
			const subtaskBranch = (await this._execGit(['rev-parse', '--abbrev-ref', 'HEAD'], subtaskWorktree)).trim();
			this._logService.info(`[A2APullSubTaskChangesTool] Subtask branch: ${subtaskBranch}`);

			// Step 2: Check if subtask has uncommitted changes - if so, commit them first
			const statusOutput = await this._execGit(['status', '--porcelain'], subtaskWorktree);
			if (statusOutput.trim()) {
				this._logService.info(`[A2APullSubTaskChangesTool] Subtask has uncommitted changes, committing them first`);
				await this._execGit(['add', '-A'], subtaskWorktree);
				await this._execGit(['commit', '-m', 'Subtask work - auto-committed for merge'], subtaskWorktree);
			}

			// Step 3: Get parent's current branch
			const parentBranch = (await this._execGit(['rev-parse', '--abbrev-ref', 'HEAD'], parentWorktree)).trim();
			this._logService.info(`[A2APullSubTaskChangesTool] Parent branch: ${parentBranch}`);

			// Step 4: Fetch the subtask branch in parent worktree (they share the same repo)
			// Since worktrees share the git directory, branches are already visible
			// Just need to merge

			// Step 5: Get list of files that will change (for reporting)
			let changedFiles: string[] = [];
			try {
				const diffFiles = await this._execGit(['diff', '--name-only', `${parentBranch}...${subtaskBranch}`], parentWorktree);
				changedFiles = diffFiles.split(/\r?\n/).filter(Boolean);
			} catch {
				// If that fails, try simpler diff
				try {
					const diffFiles = await this._execGit(['diff', '--name-only', subtaskBranch], parentWorktree);
					changedFiles = diffFiles.split(/\r?\n/).filter(Boolean);
				} catch { /* ignore */ }
			}

			this._logService.info(`[A2APullSubTaskChangesTool] Files to merge: ${changedFiles.length}`);

			// Step 6: Merge the subtask branch into parent
			let mergeResult: { success: boolean; message: string; hasConflicts: boolean; conflictFiles?: string[] } = {
				success: false,
				message: '',
				hasConflicts: false
			};

			try {
				// Try merge with --no-commit first so parent can review
				const mergeOutput = await this._execGit(
					['merge', subtaskBranch, '--no-commit', '--no-ff', '-m', `Merge subtask branch ${subtaskBranch}`],
					parentWorktree
				);
				mergeResult = { success: true, message: mergeOutput, hasConflicts: false };
				this._logService.info(`[A2APullSubTaskChangesTool] Merge successful (staged, not committed)`);
			} catch (mergeError) {
				const errorStr = String(mergeError);
				// Check if it's a conflict
				if (errorStr.includes('CONFLICT') || errorStr.includes('Automatic merge failed')) {
					// Get list of conflicted files
					const conflictStatus = await this._execGit(['diff', '--name-only', '--diff-filter=U'], parentWorktree);
					const conflictFiles = conflictStatus.split(/\r?\n/).filter(Boolean);
					mergeResult = {
						success: false,
						message: errorStr,
						hasConflicts: true,
						conflictFiles
					};
					this._logService.info(`[A2APullSubTaskChangesTool] Merge has conflicts in ${conflictFiles.length} files`);
				} else {
					throw mergeError;
				}
			}

			// Cleanup worktree if requested AND merge was clean
			let cleanupMessage = '';
			if (cleanup && mergeResult.success && !mergeResult.hasConflicts) {
				try {
					const workspaceRoot = this._workspaceService.getWorkspaceFolders()?.[0]?.fsPath;
					if (workspaceRoot) {
						await this._execGit(['worktree', 'remove', subtaskWorktree, '--force'], workspaceRoot);
						cleanupMessage = '\n\nSubtask worktree has been cleaned up.';
					}
				} catch (cleanupError) {
					cleanupMessage = `\n\n⚠️ Could not cleanup worktree: ${cleanupError}`;
				}
			}

			// Build response
			if (mergeResult.hasConflicts) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(
						`⚠️ **Merge has conflicts that need resolution**\n\n` +
						`The subtask branch \`${subtaskBranch}\` was merged but has conflicts.\n\n` +
						`**Conflicted files:**\n${mergeResult.conflictFiles?.map(f => `- ${f}`).join('\n') || 'Unknown'}\n\n` +
						`**To resolve:**\n` +
						`1. Edit the conflicted files to resolve conflicts\n` +
						`2. Run \`git add <file>\` for each resolved file\n` +
						`3. Run \`git commit\` to complete the merge\n\n` +
						`Or to abort: \`git merge --abort\``
					),
				]);
			}

			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`✅ Successfully merged subtask branch \`${subtaskBranch}\` into \`${parentBranch}\`.\n\n` +
					`**Merged files (${changedFiles.length}):**\n${changedFiles.map(f => `- ${f}`).join('\n') || '(no files listed)'}\n\n` +
					`Changes are staged but **not committed**. Review and commit when ready.${cleanupMessage}`
				),
			]);

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this._logService.error(`[A2APullSubTaskChangesTool] Failed: ${errorMessage}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`ERROR: Failed to pull changes: ${errorMessage}`),
			]);
		}
	}

	private async _execGit(args: string[], cwd: string): Promise<string> {
		const cp = await import('child_process');
		return new Promise((resolve, reject) => {
			cp.exec(`git ${args.map(a => `"${a}"`).join(' ')}`, {
				cwd,
				maxBuffer: 10 * 1024 * 1024
			}, (err, stdout, stderr) => {
				if (err) {
					reject(new Error(stderr || err.message));
				} else {
					resolve(stdout.trim());
				}
			});
		});
	}
}

interface SendMessageToWorkerParams {
	/** The worker ID to send the message to */
	workerId: string;
	/** The message content */
	message: string;
}

/**
 * Tool for parent agents to send messages back to their subtask workers.
 * Use this when subtask output is not satisfactory and worker should continue.
 */
export class A2ASendMessageToWorkerTool implements ICopilotTool<SendMessageToWorkerParams> {
	static readonly toolName = ToolName.A2ASendMessageToWorker;

	constructor(
		@IOrchestratorService private readonly _orchestratorService: IOrchestratorService,
		@ILogService private readonly _logService: ILogService,
	) { }

	get enabled(): boolean {
		return true;
	}

	prepareInvocation(_options: vscode.LanguageModelToolInvocationPrepareOptions<SendMessageToWorkerParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return { invocationMessage: 'Sending message to worker...' };
	}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<SendMessageToWorkerParams>,
		_token: CancellationToken
	): Promise<LanguageModelToolResult> {
		const { workerId, message } = options.input;

		if (!workerId) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('ERROR: workerId is required.'),
			]);
		}

		this._logService.info(`[A2ASendMessageToWorkerTool] Sending message to worker ${workerId}`);

		try {
			// Send message to worker via orchestrator service
			// The worker's status will change to 'running' which updates the session status
			// in the VS Code chat sessions panel (shows as "In Progress")
			this._orchestratorService.sendMessageToWorker(workerId, message);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`Message sent to worker ${workerId}.\n\n` +
					'The worker will wake up and continue working based on your feedback. ' +
					'Look for the worker session in the chat sessions panel - it will show as "In Progress" while working. ' +
					'Click on the session to see real-time progress and results.'
				),
			]);

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this._logService.error(`[A2ASendMessageToWorkerTool] Failed: ${errorMessage}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`ERROR: Failed to send message: ${errorMessage}`),
			]);
		}
	}
}

// Register the tools
ToolRegistry.registerTool(A2ASpawnSubTaskTool);
ToolRegistry.registerTool(A2ASpawnParallelSubTasksTool);
ToolRegistry.registerTool(A2AAwaitSubTasksTool);
ToolRegistry.registerTool(A2ANotifyOrchestratorTool);
ToolRegistry.registerTool(A2APullSubTaskChangesTool);
ToolRegistry.registerTool(A2ASendMessageToWorkerTool);
