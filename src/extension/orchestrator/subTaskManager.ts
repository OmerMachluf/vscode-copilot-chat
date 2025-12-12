/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../platform/log/common/logService';
import { CancellationToken, CancellationTokenSource } from '../../util/vs/base/common/cancellation';
import { Emitter, Event } from '../../util/vs/base/common/event';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { generateUuid } from '../../util/vs/base/common/uuid';
import { IAgentRunner, IAgentRunOptions, ISubTask, ISubTaskCreateOptions, ISubTaskManager, ISubTaskResult } from './orchestratorInterfaces';
import {
	hashPrompt,
	IEmergencyStopOptions,
	IEmergencyStopResult,
	ISafetyLimitsConfig,
	ISafetyLimitsService,
	ISubTaskAncestry,
	ISubTaskCost,
	ITokenUsage,
} from './safetyLimits';
import { IWorkerToolsService } from './workerToolsService';

// Lazy import to avoid circular dependency - IOrchestratorService is imported dynamically
type IOrchestratorService = import('./orchestratorServiceV2').IOrchestratorService;
export { ISubTask, ISubTaskCreateOptions, ISubTaskManager, ISubTaskResult };

/**
 * Represents a sub-task spawned by a parent agent.
 * Sub-tasks execute within the parent's worktree context.
 */

/**
 * Result from a sub-task execution.
 */

/**
 * Options for creating a new sub-task.
 */



/**
 * Service for managing sub-task spawning, execution, and lifecycle.
 */


/**
 * Implementation of the sub-task manager service.
 */
export class SubTaskManager extends Disposable implements ISubTaskManager {
	readonly _serviceBrand: undefined;

	private readonly _subTasks = new Map<string, ISubTask>();
	private readonly _cancellationSources = new Map<string, CancellationTokenSource>();
	private readonly _runningSubTasks = new Map<string, Promise<ISubTaskResult>>();

	private readonly _onDidChangeSubTask = this._register(new Emitter<ISubTask>());
	readonly onDidChangeSubTask = this._onDidChangeSubTask.event;

	private readonly _onDidCompleteSubTask = this._register(new Emitter<ISubTask>());
	readonly onDidCompleteSubTask = this._onDidCompleteSubTask.event;

	/** Map of subtask ID to orchestrator task ID for UI-enabled subtasks */
	private readonly _subtaskToOrchestratorTask = new Map<string, string>();

	/** Orchestrator service for UI-enabled subtasks (optional, set via setOrchestratorService) */
	private _orchestratorService: IOrchestratorService | undefined;

	constructor(
		@IAgentRunner private readonly _agentRunner: IAgentRunner,
		@IWorkerToolsService private readonly _workerToolsService: IWorkerToolsService,
		@ILogService private readonly _logService: ILogService,
		@ISafetyLimitsService private readonly _safetyLimitsService: ISafetyLimitsService,
	) {
		super();

		// Listen to emergency stop events
		this._register(this._safetyLimitsService.onEmergencyStop(options => {
			this._handleEmergencyStop(options);
		}));
	}

	/**
	 * Set the orchestrator service for UI-enabled subtask execution.
	 * This is set lazily to avoid circular dependency at import time.
	 */
	setOrchestratorService(orchestratorService: IOrchestratorService): void {
		if (this._orchestratorService) {
			return; // Already set
		}
		this._orchestratorService = orchestratorService;

		// Listen for orchestrator task completion to update subtask status
		this._register(this._orchestratorService.onOrchestratorEvent(event => {
			if (event.type === 'task.completed' || event.type === 'task.failed') {
				// Find the subtask that maps to this orchestrator task
				for (const [subtaskId, taskId] of this._subtaskToOrchestratorTask) {
					if (taskId === event.taskId) {
						const status = event.type === 'task.completed' ? 'completed' : 'failed';
						const error = event.type === 'task.failed' ? (event as any).error : undefined;
						this.updateStatus(subtaskId, status, {
							taskId: subtaskId,
							status: status === 'completed' ? 'success' : 'failed',
							output: '',
							error,
						});
						break;
					}
				}
			}
		}));
	}

	/**
	 * Get maximum depth for orchestrator-spawned chains.
	 * This is the default used when spawnContext is 'orchestrator'.
	 */
	get maxDepth(): number {
		return this._safetyLimitsService.getMaxDepthForContext('orchestrator');
	}

	/**
	 * Get effective max depth for a specific spawn context.
	 * @param context The spawn context ('orchestrator' or 'agent')
	 */
	getMaxDepthForContext(context: 'orchestrator' | 'agent'): number {
		return this._safetyLimitsService.getMaxDepthForContext(context);
	}

	get safetyLimits(): ISafetyLimitsConfig {
		return this._safetyLimitsService.config;
	}

	get onEmergencyStop(): Event<IEmergencyStopOptions> {
		return this._safetyLimitsService.onEmergencyStop;
	}

	checkPermission(subTaskId: string, action: string): boolean {
		const subTask = this._subTasks.get(subTaskId);
		if (!subTask || !subTask.inheritedPermissions) {
			return false;
		}

		// Check inherited permissions
		if (subTask.inheritedPermissions.auto_approve.includes(action)) {
			return true;
		}

		return false;
	}

	createSubTask(options: ISubTaskCreateOptions): ISubTask {
		const newDepth = options.currentDepth + 1;
		const workerId = options.parentWorkerId;
		// Derive spawn context from options or default to 'agent'
		const spawnContext = options.spawnContext ?? 'agent';

		// 1. Enforce depth limit using spawn context for correct limits
		const effectiveMaxDepth = this._safetyLimitsService.getMaxDepthForContext(spawnContext);
		if (options.currentDepth >= effectiveMaxDepth) {
			const contextLabel = spawnContext === 'orchestrator' ? 'orchestrator-deployed worker' : 'standalone agent';
			throw new Error(
				`Sub-task depth limit exceeded for ${contextLabel}.\n\n` +
				`**Current depth:** ${options.currentDepth}\n` +
				`**Maximum allowed depth for ${spawnContext} context:** ${effectiveMaxDepth}\n\n` +
				`Cannot spawn deeper sub-tasks. Consider completing this task directly instead of delegating further.\n` +
				`${spawnContext === 'agent' ? 'Tip: Standalone agents have max depth 1 (agent → subtask). Orchestrator workflows allow depth 2.' : ''}`
			);
		}

		// 2. Check rate limit
		if (!this._safetyLimitsService.checkRateLimit(workerId)) {
			throw new Error(
				`Rate limit exceeded for worker ${workerId}. ` +
				`Maximum ${this._safetyLimitsService.config.subTaskSpawnRateLimit} spawns per minute. ` +
				`Please wait before spawning more sub-tasks.`
			);
		}

		// 3. Check total sub-task limit
		const totalCount = this.getTotalSubTasksCount(workerId);
		if (!this._safetyLimitsService.checkTotalLimit(workerId, totalCount)) {
			throw new Error(
				`Total sub-task limit exceeded for worker ${workerId}. ` +
				`Maximum ${this._safetyLimitsService.config.maxSubTasksPerWorker} sub-tasks per worker. ` +
				`Consider completing existing sub-tasks first.`
			);
		}

		// 4. Check parallel sub-task limit
		const runningCount = this.getRunningSubTasksCount(workerId);
		if (!this._safetyLimitsService.checkParallelLimit(workerId, runningCount)) {
			throw new Error(
				`Parallel sub-task limit exceeded for worker ${workerId}. ` +
				`Maximum ${this._safetyLimitsService.config.maxParallelSubTasks} parallel sub-tasks. ` +
				`Wait for some sub-tasks to complete before spawning more.`
			);
		}

		// Generate the ID first for ancestry registration
		const id = `subtask-${generateUuid().substring(0, 8)}`;

		// 5. Build ancestry and check for cycles
		const ancestry: ISubTaskAncestry = {
			subTaskId: id,
			parentSubTaskId: options.parentSubTaskId,
			workerId: options.parentWorkerId,
			planId: options.planId,
			agentType: options.agentType,
			promptHash: hashPrompt(options.prompt),
		};

		// Get existing ancestry chain and add new entry
		const ancestryChain = options.parentSubTaskId
			? [...this._safetyLimitsService.getAncestryChain(options.parentSubTaskId), ancestry]
			: [ancestry];

		if (this._safetyLimitsService.detectCycle(id, ancestryChain)) {
			throw new Error(
				`Cycle detected in sub-task chain. ` +
				`Cannot spawn sub-task that would create a loop. ` +
				`Agent type: ${options.agentType}, similar task already exists in chain.`
			);
		}

		// Register ancestry for future cycle detection
		this._safetyLimitsService.registerAncestry(ancestry);

		// Record the spawn for rate limiting
		this._safetyLimitsService.recordSpawn(workerId);

		const subTask: ISubTask = {
			id,
			parentWorkerId: options.parentWorkerId,
			parentTaskId: options.parentTaskId,
			planId: options.planId,
			worktreePath: options.worktreePath,
			agentType: options.agentType,
			prompt: options.prompt,
			expectedOutput: options.expectedOutput,
			model: options.model,
			depth: newDepth,
			status: 'pending',
			targetFiles: options.targetFiles,
			createdAt: Date.now(),
			inheritedPermissions: options.inheritedPermissions,
		};

		this._subTasks.set(id, subTask);
		this._logService.debug(`[SubTaskManager] Created sub-task ${id} at depth ${newDepth} for parent ${options.parentTaskId}`);
		this._onDidChangeSubTask.fire(subTask);

		return subTask;
	}

	getSubTask(id: string): ISubTask | undefined {
		return this._subTasks.get(id);
	}

	getSubTasksForWorker(workerId: string): ISubTask[] {
		return Array.from(this._subTasks.values())
			.filter(st => st.parentWorkerId === workerId);
	}

	getSubTasksForParentTask(parentTaskId: string): ISubTask[] {
		return Array.from(this._subTasks.values())
			.filter(st => st.parentTaskId === parentTaskId);
	}

	getRunningSubTasksCount(workerId: string): number {
		return Array.from(this._subTasks.values())
			.filter(st => st.parentWorkerId === workerId && st.status === 'running')
			.length;
	}

	getTotalSubTasksCount(workerId: string): number {
		return Array.from(this._subTasks.values())
			.filter(st => st.parentWorkerId === workerId)
			.length;
	}

	updateStatus(id: string, status: ISubTask['status'], result?: ISubTaskResult): void {
		const subTask = this._subTasks.get(id);
		if (!subTask) {
			this._logService.warn(`[SubTaskManager] Attempted to update non-existent sub-task: ${id}`);
			return;
		}

		const updatedTask: ISubTask = {
			...subTask,
			status,
			result,
			completedAt: ['completed', 'failed', 'cancelled'].includes(status) ? Date.now() : undefined,
		};

		this._subTasks.set(id, updatedTask);
		this._logService.debug(`[SubTaskManager] Updated sub-task ${id} status to ${status}`);
		this._onDidChangeSubTask.fire(updatedTask);

		if (['completed', 'failed', 'cancelled'].includes(status)) {
			this._onDidCompleteSubTask.fire(updatedTask);

			// Clear ancestry when sub-task completes
			this._safetyLimitsService.clearAncestry(id);
		}
	}

	async executeSubTask(id: string, token: CancellationToken): Promise<ISubTaskResult> {
		const subTask = this._subTasks.get(id);
		if (!subTask) {
			const result: ISubTaskResult = {
				taskId: id,
				status: 'failed',
				output: '',
				error: `Sub-task ${id} not found`,
			};
			// Fire completion event even for not-found case
			this._logService.warn(`[SubTaskManager] Sub-task ${id} not found during execution`);
			return result;
		}

		// Check for conflicts before starting
		const conflicts = this.checkFileConflicts(subTask.targetFiles ?? [], id);
		if (conflicts.length > 0) {
			const result: ISubTaskResult = {
				taskId: id,
				status: 'failed',
				output: '',
				error: `File conflicts detected with running sub-tasks: ${conflicts.join(', ')}`,
			};
			this.updateStatus(id, 'failed', result);
			return result;
		}

		// Create cancellation source for this sub-task
		const cts = new CancellationTokenSource(token);
		this._cancellationSources.set(id, cts);

		this.updateStatus(id, 'running');

		let result: ISubTaskResult;

		try {
			// Use the orchestrator infrastructure for full chat UI support if available
			// This creates a real WorkerSession that appears in the sessions panel
			// with thinking bubbles, tool confirmations, etc.
			if (this._orchestratorService) {
				result = await this._executeSubTaskWithOrchestratorUI(subTask, cts.token);
			} else {
				// Orchestrator not available, use headless execution
				result = await this._executeSubTaskHeadless(subTask, cts.token);
			}

			// Ensure status is updated (may have already been updated by orchestrator events)
			const currentSubTask = this._subTasks.get(id);
			if (currentSubTask && !['completed', 'failed', 'cancelled'].includes(currentSubTask.status)) {
				this.updateStatus(id, result.status === 'success' ? 'completed' : 'failed', result);
			}

			return result;
		} catch (error) {
			// Fallback to headless execution if orchestrator fails
			this._logService.warn(`[SubTaskManager] Orchestrator UI execution failed, falling back to headless: ${error}`);
			try {
				result = await this._executeSubTaskHeadless(subTask, cts.token);
				this.updateStatus(id, result.status === 'success' ? 'completed' : 'failed', result);
				return result;
			} catch (fallbackError) {
				result = {
					taskId: id,
					status: 'failed',
					output: '',
					error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
				};
				this.updateStatus(id, 'failed', result);
				return result;
			}
		} finally {
			this._cancellationSources.delete(id);
			this._runningSubTasks.delete(id);

			// FALLBACK COMPLETION: Ensure parent is notified even if the subagent never called
			// a2a_subtask_complete. This handles crashes, timeouts, and cancellations.
			// The updateStatus call above (or in catch blocks) will have fired onDidCompleteSubTask
			// which ParentCompletionService listens to. This comment documents the guarantee.
			const finalSubTask = this._subTasks.get(id);
			if (finalSubTask && finalSubTask.status === 'running') {
				// If we got here and status is still 'running', something went very wrong
				this._logService.error(`[SubTaskManager] Sub-task ${id} finished execution but status is still 'running' - forcing completion`);
				const fallbackResult: ISubTaskResult = {
					taskId: id,
					status: 'failed',
					output: '',
					error: 'Execution completed unexpectedly without status update',
				};
				this.updateStatus(id, 'failed', fallbackResult);
			}
		}
	}

	/**
	 * Execute a subtask using the orchestrator's WorkerSession infrastructure.
	 * This provides full chat UI support with thinking bubbles, tool confirmations,
	 * and the subtask appearing in the sessions panel.
	 *
	 * @precondition this._orchestratorService is defined
	 */
	private async _executeSubTaskWithOrchestratorUI(subTask: ISubTask, token: CancellationToken): Promise<ISubTaskResult> {
		const orchestratorService = this._orchestratorService!;

		// Create an orchestrator task for this subtask
		const taskName = `[SubTask] ${subTask.agentType} (${subTask.id.slice(-6)})`;
		const taskDescription = `${subTask.prompt}\n\n---\n**Expected Output:** ${subTask.expectedOutput}`;

		const orchestratorTask = orchestratorService.addTask(taskDescription, {
			name: taskName,
			planId: subTask.planId,
			modelId: subTask.model,
			// Don't create a new worktree - reuse parent's worktree
			baseBranch: undefined,
			targetFiles: subTask.targetFiles,
		});

		// Map subtask ID to orchestrator task ID
		this._subtaskToOrchestratorTask.set(subTask.id, orchestratorTask.id);

		this._logService.info(`[SubTaskManager] Created orchestrator task ${orchestratorTask.id} for subtask ${subTask.id}`);

		try {
			// Deploy the task - this creates a WorkerSession with full UI
			const workerSession = await orchestratorService.deploy(orchestratorTask.id, {
				modelId: subTask.model,
			});

			// Wait for the task to complete
			return await this._waitForOrchestratorTaskCompletion(orchestratorTask.id, workerSession.id, token);
		} catch (error) {
			// Clean up the orchestrator task on failure
			try {
				orchestratorService.removeTask(orchestratorTask.id);
			} catch {
				// Ignore cleanup errors
			}
			throw error;
		}
	}

	/**
	 * Wait for an orchestrator task to complete and return the result.
	 *
	 * @precondition this._orchestratorService is defined
	 */
	private async _waitForOrchestratorTaskCompletion(
		taskId: string,
		workerId: string,
		token: CancellationToken
	): Promise<ISubTaskResult> {
		const orchestratorService = this._orchestratorService!;

		return new Promise<ISubTaskResult>((resolve) => {
			const disposables: vscode.Disposable[] = [];

			const cleanup = () => {
				disposables.forEach(d => d.dispose());
			};

			// Listen for task completion
			disposables.push(orchestratorService.onOrchestratorEvent(event => {
				if (!('taskId' in event) || event.taskId !== taskId) {
					return;
				}

				if (event.type === 'task.completed') {
					cleanup();
					const workerState = orchestratorService.getWorkerState(workerId);
					resolve({
						taskId,
						status: 'success',
						output: workerState?.messages?.map(m => m.content).join('\n') || 'Task completed successfully',
					});
				} else if (event.type === 'task.failed') {
					cleanup();
					resolve({
						taskId,
						status: 'failed',
						output: '',
						error: event.error || 'Task failed',
					});
				}
			}));

			// Handle cancellation
			token.onCancellationRequested(() => {
				cleanup();
				orchestratorService.interruptWorker(workerId);
				resolve({
					taskId,
					status: 'failed',
					output: '',
					error: 'Task was cancelled',
				});
			});
		});
	}

	/**
	 * Execute a subtask without UI (headless mode).
	 * This is the fallback when orchestrator UI is not available.
	 */
	private async _executeSubTaskHeadless(subTask: ISubTask, token: CancellationToken): Promise<ISubTaskResult> {
		return await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Executing Sub-Task: ${subTask.agentType}`,
			cancellable: true
		}, async (progress, _token) => {
			const cts = new CancellationTokenSource(token);
			_token.onCancellationRequested(() => cts.cancel());

			const streamCollector = new SubTaskStreamCollector((message) => {
				progress.report({ message });
			});

			return await this._executeSubTaskInternal(subTask, cts.token, streamCollector);
		});
	}

	private async _executeSubTaskInternal(subTask: ISubTask, token: CancellationToken, streamCollector?: SubTaskStreamCollector): Promise<ISubTaskResult> {
		// Get parent's tool set to inherit spawn context
		const parentToolSet = this._workerToolsService.getWorkerToolSet(subTask.parentWorkerId);
		// Inherit spawn context from parent - if parent was from orchestrator, children are too
		const inheritedSpawnContext = parentToolSet?.workerContext?.spawnContext ?? 'agent';

		// Get or create worker tool set for this subtask
		let toolSet = this._workerToolsService.getWorkerToolSet(`${subTask.parentWorkerId}-subtask-${subTask.id}`);
		if (!toolSet) {
			// Create a new tool set scoped to the worktree
			// Owner is the parent worker that spawned this subtask
			toolSet = this._workerToolsService.createWorkerToolSet(
				`${subTask.parentWorkerId}-subtask-${subTask.id}`,
				subTask.worktreePath,
				subTask.planId,
				subTask.parentTaskId,
				subTask.depth,
				{ ownerType: 'worker', ownerId: subTask.parentWorkerId },
				inheritedSpawnContext // Inherit spawn context from parent
			);
		}

		// Select the model - try specific model first, then fallback
		let model: vscode.LanguageModelChat | undefined;

		if (subTask.model) {
			// Try by ID first (e.g., 'claude-sonnet-4-20250514')
			const byId = await vscode.lm.selectChatModels({ id: subTask.model });
			if (byId.length > 0) {
				model = byId[0];
			} else {
				// Try by family (e.g., 'claude-opus-4.5')
				const byFamily = await vscode.lm.selectChatModels({ vendor: 'copilot', family: subTask.model });
				if (byFamily.length > 0) {
					model = byFamily[0];
				}
			}
		}

		// Fallback to any copilot model if specific model not found
		if (!model) {
			const copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
			if (copilotModels.length > 0) {
				model = copilotModels[0];
			}
		}

		// Last resort: any available model
		if (!model) {
			const allModels = await vscode.lm.selectChatModels();
			model = allModels[0];
		}

		if (!model) {
			return {
				taskId: subTask.id,
				status: 'failed',
				output: '',
				error: 'No suitable model available',
			};
		}

		// Build the prompt with sub-task context
		const contextPrompt = this._buildSubTaskPrompt(subTask);

		// Create a simple stream collector if not provided
		if (!streamCollector) {
			streamCollector = new SubTaskStreamCollector();
		}

		// Determine effective max depth based on inherited spawn context
		const effectiveMaxDepth = this._safetyLimitsService.getMaxDepthForContext(inheritedSpawnContext);
		// Determine if this subtask can spawn more subtasks based on depth
		const canSpawnSubTasks = subTask.depth < effectiveMaxDepth;
		const subTaskGuidance = canSpawnSubTasks
			? `You CAN spawn sub-tasks if needed using a2a_spawn_subtask or a2a_spawn_parallel_subtasks tools. Use orchestrator_listAgents to discover available agent types.`
			: `You are at maximum depth (${subTask.depth}/${effectiveMaxDepth}) for ${inheritedSpawnContext} context and CANNOT spawn additional sub-tasks. Complete this task directly.`;

		// Build agent run options
		const runOptions: IAgentRunOptions = {
			prompt: contextPrompt,
			model,
			workerToolSet: toolSet,
			worktreePath: subTask.worktreePath,
			token,
			maxToolCallIterations: 50, // Lower limit for sub-tasks
			additionalInstructions: `## SUB-TASK CONTEXT
You are a sub-agent spawned by a PARENT AGENT (not the user).
- **Your Parent:** Worker ID '${subTask.parentWorkerId}'
- **Your Task ID:** ${subTask.id}
- **Depth Level:** ${subTask.depth} of ${this.maxDepth}
${subTask.targetFiles?.length ? `- **Target Files:** ${subTask.targetFiles.join(', ')}` : ''}

## COMMUNICATION WITH PARENT
- Use \`a2a_notify_orchestrator\` to send status updates, questions, or progress reports to your parent.
- Use \`a2a_subtask_complete\` when you finish to report your results back to the parent.
- Your parent is WAITING for your completion - they will receive and process your result.
- **DO NOT** try to communicate with the user directly - route everything through your parent.

## YOUR RESPONSIBILITIES
1. Complete the specific task assigned to you.
2. Report completion (success OR failure) using \`a2a_subtask_complete\`.
3. Any file changes you make in the worktree will be visible to your parent.
4. Your parent is responsible for merging/integrating your changes.

## SUB-TASK SPAWNING
${subTaskGuidance}

Good reasons to spawn sub-tasks:
- Investigating API documentation or external resources
- Code review by a specialist agent
- Build/test troubleshooting while you focus on main task
- Any independent research that would distract from your core goal

## EXPECTED OUTPUT
${subTask.expectedOutput}

Focus on your assigned task and provide a clear, actionable result.`,
		};

		// Execute the agent
		const result = await this._agentRunner.run(runOptions, streamCollector);

		// Apply any buffered edits
		await streamCollector.applyBufferedEdits();

		return {
			taskId: subTask.id,
			status: result.success ? 'success' : 'failed',
			output: result.response ?? streamCollector.getContent(),
			error: result.error,
			metadata: result.metadata,
		};
	}

	private _buildSubTaskPrompt(subTask: ISubTask): string {
		const parts: string[] = [];

		// Add context about being a sub-task with clear parent relationship
		parts.push(`## Sub-Task Assignment`);
		parts.push(`You have been delegated this task by your parent agent.`);
		parts.push('');
		parts.push(`| Property | Value |`);
		parts.push(`|----------|-------|`);
		parts.push(`| Agent Type | ${subTask.agentType} |`);
		parts.push(`| Task ID | ${subTask.id} |`);
		parts.push(`| Parent Worker | ${subTask.parentWorkerId} |`);
		parts.push(`| Depth Level | ${subTask.depth} |`);
		parts.push(`| Worktree | ${subTask.worktreePath} |`);
		parts.push('');

		// Add the actual prompt
		parts.push(`## Your Task`);
		parts.push(subTask.prompt);
		parts.push('');

		// Add expected output guidance
		parts.push(`## Expected Deliverable`);
		parts.push(subTask.expectedOutput);
		parts.push('');
		parts.push(`When complete, use \`a2a_subtask_complete\` to report your results to your parent.`);

		return parts.join('\n');
	}

	cancelSubTask(id: string): void {
		const subTask = this._subTasks.get(id);
		if (!subTask) {
			return;
		}

		// Cancel the execution
		const cts = this._cancellationSources.get(id);
		if (cts) {
			cts.cancel();
		}

		this.updateStatus(id, 'cancelled', {
			taskId: id,
			status: 'failed',
			output: '',
			error: 'Task was cancelled',
		});

		this._logService.debug(`[SubTaskManager] Cancelled sub-task ${id}`);
	}

	checkFileConflicts(targetFiles: string[], excludeTaskId?: string): string[] {
		if (!targetFiles || targetFiles.length === 0) {
			return [];
		}

		const normalizedTargets = new Set(
			targetFiles.map(f => f.toLowerCase().replace(/\\/g, '/'))
		);

		const conflicts: string[] = [];

		for (const [taskId, subTask] of this._subTasks) {
			if (taskId === excludeTaskId) {
				continue;
			}

			if (subTask.status !== 'running') {
				continue;
			}

			if (!subTask.targetFiles || subTask.targetFiles.length === 0) {
				continue;
			}

			for (const file of subTask.targetFiles) {
				const normalized = file.toLowerCase().replace(/\\/g, '/');
				if (normalizedTargets.has(normalized)) {
					conflicts.push(taskId);
					break;
				}
			}
		}

		return conflicts;
	}

	getTaskDepth(taskId: string): number {
		const subTask = this._subTasks.get(taskId);
		if (subTask) {
			return subTask.depth;
		}
		// If not a sub-task, it's a main task at depth 0
		return 0;
	}

	// ========================================================================
	// Cost Tracking (delegated to SafetyLimitsService)
	// ========================================================================

	trackSubTaskCost(subTaskId: string, usage: ITokenUsage, model: string): void {
		this._safetyLimitsService.trackSubTaskCost(subTaskId, usage, model);
	}

	getTotalCostForWorker(workerId: string): number {
		return this._safetyLimitsService.getTotalCostForWorker(workerId);
	}

	getSubTaskCost(subTaskId: string): ISubTaskCost | undefined {
		return this._safetyLimitsService.getSubTaskCost(subTaskId);
	}

	// ========================================================================
	// Emergency Stop
	// ========================================================================

	async emergencyStop(options: IEmergencyStopOptions): Promise<IEmergencyStopResult> {
		return this._safetyLimitsService.emergencyStop(options);
	}

	private _handleEmergencyStop(options: IEmergencyStopOptions): void {
		this._logService.warn(`[SubTaskManager] Handling emergency stop: ${options.scope} - ${options.reason}`);

		const subTasksToCancel: string[] = [];

		switch (options.scope) {
			case 'subtask': {
				if (options.targetId) {
					subTasksToCancel.push(options.targetId);
				}
				break;
			}

			case 'worker': {
				if (options.targetId) {
					for (const [id, subTask] of this._subTasks) {
						if (subTask.parentWorkerId === options.targetId) {
							subTasksToCancel.push(id);
						}
					}
				}
				break;
			}

			case 'plan': {
				if (options.targetId) {
					for (const [id, subTask] of this._subTasks) {
						if (subTask.planId === options.targetId) {
							subTasksToCancel.push(id);
						}
					}
				}
				break;
			}

			case 'global': {
				for (const id of this._subTasks.keys()) {
					subTasksToCancel.push(id);
				}
				break;
			}
		}

		// Cancel all identified sub-tasks
		for (const id of subTasksToCancel) {
			this.cancelSubTask(id);
		}

		this._logService.warn(`[SubTaskManager] Emergency stop: cancelled ${subTasksToCancel.length} sub-tasks`);
	}

	// ========================================================================
	// Configuration & Cleanup
	// ========================================================================

	updateSafetyLimits(config: Partial<ISafetyLimitsConfig>): void {
		this._safetyLimitsService.updateConfig(config);
	}

	resetWorkerTracking(workerId: string): void {
		this._safetyLimitsService.resetWorkerTracking(workerId);

		// Also clean up any sub-tasks for this worker
		for (const [id, subTask] of this._subTasks) {
			if (subTask.parentWorkerId === workerId) {
				this._subTasks.delete(id);
				this._cancellationSources.delete(id);
				this._runningSubTasks.delete(id);
			}
		}
	}

	override dispose(): void {
		// Cancel all running sub-tasks
		for (const [id] of this._cancellationSources) {
			this.cancelSubTask(id);
		}
		super.dispose();
	}
}

/**
 * Simple stream collector for sub-task execution.
 * Collects markdown content from the agent's response.
 * Implements ChatResponseStream to capture agent output.
 */
class SubTaskStreamCollector implements vscode.ChatResponseStream {
	private _content = '';
	private _parts: string[] = [];
	private _bufferedEdits = new Map<string, vscode.TextEdit[]>();
	private _bufferedNotebookEdits = new Map<string, vscode.NotebookEdit[]>();

	constructor(private readonly _onProgress?: (message: string) => void) { }

	getContent(): string {
		return this._content || this._parts.join('\n');
	}

	async applyBufferedEdits(): Promise<void> {
		if (this._bufferedEdits.size === 0 && this._bufferedNotebookEdits.size === 0) {
			return;
		}

		const workspaceEdit = new vscode.WorkspaceEdit();

		for (const [uriStr, edits] of this._bufferedEdits) {
			const uri = vscode.Uri.parse(uriStr);
			// Ensure file exists
			workspaceEdit.createFile(uri, { ignoreIfExists: true });
			workspaceEdit.set(uri, edits);
		}

		for (const [uriStr, edits] of this._bufferedNotebookEdits) {
			const uri = vscode.Uri.parse(uriStr);
			workspaceEdit.set(uri, edits);
		}

		try {
			const success = await vscode.workspace.applyEdit(workspaceEdit);
			if (!success) {
				console.error('[SubTaskStreamCollector] Failed to apply buffered edits');
			}
		} catch (err) {
			console.error('[SubTaskStreamCollector] Error applying buffered edits:', err);
		}
	}

	markdown(value: string | vscode.MarkdownString): void {
		const content = typeof value === 'string' ? value : value.value;
		this._content += content;
	}

	anchor(_value: vscode.Uri | vscode.Location, _title?: string): void {
		// Not collected for sub-tasks
	}

	button(_command: vscode.Command): void {
		// Not collected for sub-tasks
	}

	filetree(_value: vscode.ChatResponseFileTree[], _baseUri: vscode.Uri): void {
		// Not collected for sub-tasks
	}

	progress(value: string, _task?: any): void {
		this._parts.push(`[Progress] ${value}`);
		this._onProgress?.(value);
	}

	reference(_value: vscode.Uri | vscode.Location | { variableName: string; value?: vscode.Uri | vscode.Location }, _iconPath?: any): void {
		// Not collected for sub-tasks
	}

	reference2(_value: any, _iconPath?: any, _options?: any): void {
		// Not collected for sub-tasks
	}

	push(part: vscode.ChatResponsePart): void {
		if ('value' in part) {
			if (typeof part.value === 'string') {
				this._content += part.value;
			} else if (part.value && typeof part.value === 'object' && 'value' in part.value) {
				this._content += (part.value as vscode.MarkdownString).value;
			}
		}
	}

	// Additional methods required by ChatResponseStream
	thinkingProgress(_thinkingDelta: any): void {
		// Not collected for sub-tasks
	}

	textEdit(target: vscode.Uri, editsOrIsDone: vscode.TextEdit | vscode.TextEdit[] | true): void {
		if (editsOrIsDone === true) {
			// Signal that editing is done for this target - no-op for collector
			return;
		}
		const uriStr = target.toString();
		let existing = this._bufferedEdits.get(uriStr) || [];
		if (Array.isArray(editsOrIsDone)) {
			existing.push(...editsOrIsDone);
		} else {
			existing.push(editsOrIsDone);
		}
		this._bufferedEdits.set(uriStr, existing);
	}

	notebookEdit(target: vscode.Uri, editsOrIsDone: vscode.NotebookEdit | vscode.NotebookEdit[] | true): void {
		if (editsOrIsDone === true) {
			// Signal that editing is done for this target - no-op for collector
			return;
		}
		const uriStr = target.toString();
		let existing = this._bufferedNotebookEdits.get(uriStr) || [];
		if (Array.isArray(editsOrIsDone)) {
			existing.push(...editsOrIsDone);
		} else {
			existing.push(editsOrIsDone);
		}
		this._bufferedNotebookEdits.set(uriStr, existing);
	}

	externalEdit(_target: vscode.Uri | vscode.Uri[], callback: () => Thenable<void>): Thenable<string> {
		// Execute callback but don't track changes - return empty string as edit id
		return callback().then(() => '');
	}

	markdownWithVulnerabilities(value: string | vscode.MarkdownString, _vulnerabilities: any[]): void {
		const content = typeof value === 'string' ? value : value.value;
		this._content += content;
	}

	codeblockUri(_uri: vscode.Uri, _isEdit?: boolean): void {
		// Not collected for sub-tasks
	}

	codeCitation(_value: vscode.Uri, _license: string, _snippet: string): void {
		// Not collected for sub-tasks
	}

	confirmation(_title: string, _message: string | vscode.MarkdownString, _data: any, _buttons?: string[]): void {
		// Not supported in sub-tasks
	}

	warning(message: string | vscode.MarkdownString): void {
		const content = typeof message === 'string' ? message : message.value;
		this._parts.push(`[Warning] ${content}`);
	}

	prepareToolInvocation(_toolName: string): void {
		// Not collected for sub-tasks
	}

	clearToPreviousToolInvocation(_reason: any): void {
		// Not supported in sub-tasks
	}
}
