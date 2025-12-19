/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as vscode from 'vscode';
import { ILogService } from '../../platform/log/common/logService';
import { CancellationToken, CancellationTokenSource } from '../../util/vs/base/common/cancellation';
import { Emitter, Event } from '../../util/vs/base/common/event';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { generateUuid } from '../../util/vs/base/common/uuid';
import { parseAgentType, ParsedAgentType } from './agentTypeParser';
import { IAgentRunner, ISubTask, ISubTaskCreateOptions, ISubTaskManager, ISubTaskResult } from './orchestratorInterfaces';
import {
	hashPrompt,
	IEmergencyStopOptions,
	IEmergencyStopResult,
	ISafetyLimitsConfig,
	ISafetyLimitsService,
	ISubTaskAncestry,
	ISubTaskCost,
	ITokenUsage,
	SpawnContext,
} from './safetyLimits';
import { createTaskStateMachine, TaskState, TaskStateMachine } from './taskStateMachine';
import { IWorkerToolsService } from './workerToolsService';

// Lazy import to avoid circular dependency - IOrchestratorService is imported dynamically
type IOrchestratorService = import('./orchestratorServiceV2').IOrchestratorService;
export { ISubTask, ISubTaskCreateOptions, ISubTaskManager, ISubTaskResult };

/**
 * Escape a file path for safe display in markdown.
 * On Windows, backslashes need to be doubled to prevent markdown escape sequences
 * like `\.` being interpreted as just `.`.
 */
function escapePathForMarkdown(filePath: string | undefined): string {
	if (!filePath) {
		return '';
	}
	// Double backslashes so they display correctly in markdown
	return filePath.replace(/\\/g, '\\\\');
}

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

	/**
	 * State machines for tracking subtask status with strict transition validation.
	 * This ensures status changes follow valid state machine rules.
	 */
	private readonly _stateMachines = new Map<string, TaskStateMachine>();

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
		void this._agentRunner; // Reserved for future direct agent execution

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

		// Parse the agent type to extract backend routing information
		let parsedAgentType: ParsedAgentType | undefined;
		try {
			parsedAgentType = parseAgentType(options.agentType, options.model);
			this._logService.debug(`[SubTaskManager] Parsed agent type '${options.agentType}' → backend=${parsedAgentType.backend}, agentName=${parsedAgentType.agentName}, slashCommand=${parsedAgentType.slashCommand}`);
		} catch (parseError) {
			// Log warning but don't fail - fall back to treating as copilot agent
			this._logService.warn(`[SubTaskManager] Failed to parse agent type '${options.agentType}': ${parseError instanceof Error ? parseError.message : String(parseError)}`);
		}

		const subTask: ISubTask = {
			id,
			parentWorkerId: options.parentWorkerId,
			parentTaskId: options.parentTaskId,
			planId: options.planId,
			worktreePath: options.worktreePath,
			baseBranch: options.baseBranch,
			agentType: options.agentType,
			parsedAgentType,
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

		// Create state machine for this subtask to enforce valid transitions
		const stateMachine = createTaskStateMachine(id, {
			info: (msg) => this._logService.debug(msg),
			warn: (msg) => this._logService.warn(msg),
		});
		this._stateMachines.set(id, stateMachine);

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

		// Validate transition using state machine (if available)
		// This ensures we follow valid state transition rules
		const stateMachine = this._stateMachines.get(id);
		if (stateMachine) {
			// Map ISubTask status to TaskState (they're compatible)
			const taskState = status as TaskState;
			const isValidTransition = stateMachine.transition(taskState, result?.error);

			if (!isValidTransition) {
				// Log warning but don't block - for backwards compatibility
				// The state machine already logged the invalid transition
				this._logService.warn(
					`[SubTaskManager] State machine rejected transition for ${id}: ` +
					`${stateMachine.state} -> ${status}. Proceeding anyway for compatibility.`
				);
			}
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

			// Clean up state machine when subtask completes
			if (stateMachine) {
				stateMachine.dispose();
				this._stateMachines.delete(id);
			}
		}
	}

	async executeSubTask(id: string, token: CancellationToken): Promise<ISubTaskResult> {
		this._logService.debug(`[SubTaskManager] executeSubTask STARTED for ${id}`);

		const subTask = this._subTasks.get(id);
		if (!subTask) {
			const result: ISubTaskResult = {
				taskId: id,
				status: 'failed',
				output: '',
				error: `Sub-task ${id} not found`,
			};
			this._logService.error(`[SubTaskManager] Sub-task ${id} NOT FOUND in _subTasks map`);
			return result;
		}

		this._logService.debug(`[SubTaskManager] Found subtask: agentType=${subTask.agentType}, parentWorkerId=${subTask.parentWorkerId}, status=${subTask.status}`);

		// Check for conflicts before starting
		const conflicts = this.checkFileConflicts(subTask.targetFiles ?? [], id);
		if (conflicts.length > 0) {
			this._logService.error(`[SubTaskManager] File conflicts detected: ${conflicts.join(', ')}`);
			const result: ISubTaskResult = {
				taskId: id,
				status: 'failed',
				output: '',
				error: `File conflicts detected with running sub-tasks: ${conflicts.join(', ')}`,
			};
			this.updateStatus(id, 'failed', result);
			return result;
		}
		this._logService.debug(`[SubTaskManager] No file conflicts detected`);

		// Create cancellation source for this sub-task
		const cts = new CancellationTokenSource(token);
		this._cancellationSources.set(id, cts);

		this.updateStatus(id, 'running');
		this._logService.debug(`[SubTaskManager] Status updated to 'running'`);

		let result: ISubTaskResult;

		try {
			// Use the orchestrator infrastructure for full chat UI support if available
			// This creates a real WorkerSession that appears in the sessions panel
			// with thinking bubbles, tool confirmations, etc.
			this._logService.debug(`[SubTaskManager] Orchestrator service AVAILABLE - using _executeSubTaskWithOrchestratorUI`);
			result = await this._executeSubTaskWithOrchestratorUI(subTask, cts.token);
			this._logService.debug(`[SubTaskManager] _executeSubTaskWithOrchestratorUI RETURNED: status=${result.status}, error=${result.error || 'none'}`);

			// Ensure status is updated (may have already been updated by orchestrator events)
			const currentSubTask = this._subTasks.get(id);
			this._logService.debug(`[SubTaskManager] Current subtask status after execution: ${currentSubTask?.status}`);
			if (currentSubTask && !['completed', 'failed', 'cancelled'].includes(currentSubTask.status)) {
				this._logService.debug(`[SubTaskManager] Updating status to ${result.status === 'success' ? 'completed' : 'failed'}`);
				this.updateStatus(id, result.status === 'success' ? 'completed' : 'failed', result);
			} else {
				this._logService.debug(`[SubTaskManager] Status already in terminal state, not updating`);
			}

			this._logService.debug(`[SubTaskManager] executeSubTask COMPLETED for ${id}`);
			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this._logService.warn(`[SubTaskManager] Orchestrator UI execution FAILED with error: ${errorMessage}`);

			// Check if this is an infrastructure error that should fail immediately
			// (worktree creation, git errors, etc.) rather than falling back to headless
			const isInfrastructureError =
				errorMessage.includes('uncommitted changes') ||
				errorMessage.includes('Cannot create worktree') ||
				errorMessage.includes('worktree') ||
				errorMessage.includes('No workspace folder') ||
				errorMessage.includes('git') ||
				errorMessage.includes('branch');

			if (isInfrastructureError) {
				this._logService.error(`[SubTaskManager] Infrastructure error detected - failing immediately without fallback: ${errorMessage}`);
				result = {
					taskId: id,
					status: 'failed',
					output: '',
					error: `Infrastructure error: ${errorMessage}. Please resolve this issue before spawning sub-tasks.`,
				};
				this.updateStatus(id, 'failed', result);
				return result;
			}

			// Queue the error for the parent by updating status
			// This ensures ParentCompletionService receives the completion event
			const unknownErrorResult: ISubTaskResult = {
				taskId: id,
				status: 'failed',
				output: '',
				error: `Task execution failed: ${errorMessage}`,
			};
			this.updateStatus(id, 'failed', unknownErrorResult);
			return unknownErrorResult;
		} finally {
			this._logService.debug(`[SubTaskManager] Cleanup: removing cancellation source and running subtask entry for ${id}`);
			this._cancellationSources.delete(id);
			this._runningSubTasks.delete(id);

			// FALLBACK COMPLETION: Ensure parent is notified even if the subagent never called
			// a2a_subtask_complete. This handles crashes, timeouts, and cancellations.
			// The updateStatus call above (or in catch blocks) will have fired onDidCompleteSubTask
			// which ParentCompletionService listens to. This comment documents the guarantee.
			const finalSubTask = this._subTasks.get(id);
			this._logService.debug(`[SubTaskManager] Final subtask status check: ${finalSubTask?.status}`);
			if (finalSubTask && finalSubTask.status === 'running') {
				// If we got here and status is still 'running', something went very wrong
				this._logService.error(`[SubTaskManager] CRITICAL: Sub-task ${id} finished execution but status is still 'running' - forcing completion`);
				const fallbackResult: ISubTaskResult = {
					taskId: id,
					status: 'failed',
					output: '',
					error: 'Execution completed unexpectedly without status update',
				};
				this.updateStatus(id, 'failed', fallbackResult);
			}
			this._logService.debug(`[SubTaskManager] executeSubTask FINALLY block done for ${id}`);
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
		this._logService.debug(`[SubTaskManager] _executeSubTaskWithOrchestratorUI STARTED for ${subTask.id}`);
		const orchestratorService = this._orchestratorService!;

		// Get parent's tool set to inherit spawn context (same logic as _executeSubTaskInternal)
		const parentToolSet = this._workerToolsService.getWorkerToolSet(subTask.parentWorkerId);
		const inheritedSpawnContext = parentToolSet?.workerContext?.spawnContext ?? 'orchestrator';

		// Build the FULL prompt with sub-task context (NOT just the raw prompt!)
		// This ensures the agent sees all the critical instructions about committing, worktree, etc.
		const taskDescription = this._buildSubTaskPrompt(subTask);

		// Build additional instructions (same as _executeSubTaskInternal uses)
		// This provides the full context about being a sub-agent, commit requirements, etc.
		const additionalInstructions = this._buildSubTaskAdditionalInstructions(subTask, inheritedSpawnContext);

		// Create an orchestrator task for this subtask with full context
		const taskName = `[SubTask] ${subTask.agentType} (${subTask.id.slice(-6)})`;

		this._logService.debug(`[SubTaskManager] Creating orchestrator task: name="${taskName}", parentWorkerId=${subTask.parentWorkerId}, spawnContext=${inheritedSpawnContext}, agentType=${subTask.agentType}, parsedAgentType.backend=${subTask.parsedAgentType?.backend}, baseBranch=${subTask.baseBranch || '(undefined - will use default)'}`);
		const orchestratorTask = orchestratorService.addTask(taskDescription, {
			name: taskName,
			planId: subTask.planId,
			modelId: subTask.model,
			// CRITICAL: Pass the agent type so the worker gets the correct role/instructions
			agent: subTask.agentType,
			// CRITICAL: Pass the pre-parsed agent type to preserve backend specification
			// This ensures subtasks like 'claude:agent' stay on the claude backend
			parsedAgentType: subTask.parsedAgentType,
			// Use parent's branch to ensure child worktrees are created from the correct branch
			// This is critical for nested spawning (sub-agent → sub-sub-agent on feature branches)
			baseBranch: subTask.baseBranch,
			targetFiles: subTask.targetFiles,
			// CRITICAL: Set parentWorkerId so messages from this subtask route to parent
			// This enables the parent worker to receive notifications via registerOwnerHandler
			parentWorkerId: subTask.parentWorkerId,
			// CRITICAL: Pass the additional instructions via context
			// This ensures the worker sees all the guidance about committing, worktree restrictions, etc.
			context: {
				additionalInstructions,
			},
		});

		// Map subtask ID to orchestrator task ID
		this._subtaskToOrchestratorTask.set(subTask.id, orchestratorTask.id);

		this._logService.debug(`[SubTaskManager] Created orchestrator task ${orchestratorTask.id} for subtask ${subTask.id}`);

		try {
			// Deploy the task - this creates a WorkerSession with full UI
			// If subTask.worktreePath is undefined (orchestrator-spawned), deploy() will create a worktree
			// We pass an instructionsBuilder callback that gets called AFTER the worktree is created,
			// ensuring the instructions contain the correct worktree path.
			this._logService.debug(`[SubTaskManager] Deploying task ${orchestratorTask.id} with worktreePath=${subTask.worktreePath || '(undefined - will create new worktree)'}`);
			const workerSession = await orchestratorService.deploy(orchestratorTask.id, {
				modelId: subTask.model,
				worktreePath: subTask.worktreePath,
				// Build instructions with the actual worktree path (known after worktree creation)
				instructionsBuilder: (actualWorktreePath: string) => {
					// Update subTask.worktreePath so the instructions builder uses the correct path
					if (!subTask.worktreePath) {
						(subTask as { worktreePath?: string }).worktreePath = actualWorktreePath;
					}
					return this._buildSubTaskAdditionalInstructions(subTask, inheritedSpawnContext);
				},
			});
			this._logService.debug(`[SubTaskManager] Deploy returned workerSession.id=${workerSession.id}, actual worktreePath=${workerSession.worktreePath}`);

			// Ensure subTask.worktreePath is updated (may have been set in instructionsBuilder, but double-check)
			if (!subTask.worktreePath && workerSession.worktreePath) {
				(subTask as { worktreePath?: string }).worktreePath = workerSession.worktreePath;
				this._logService.debug(`[SubTaskManager] Updated subTask.worktreePath to ${workerSession.worktreePath}`);
			}

			// Wait for the task to complete
			this._logService.debug(`[SubTaskManager] Now calling _waitForOrchestratorTaskCompletion for task ${orchestratorTask.id}, worker ${workerSession.id}`);
			const result = await this._waitForOrchestratorTaskCompletion(orchestratorTask.id, workerSession.id, token);
			this._logService.debug(`[SubTaskManager] _waitForOrchestratorTaskCompletion RETURNED: status=${result.status}, error=${result.error || 'none'}`);

			// Get subtask's worktree info for parent to review (NO auto-merge!)
			// Parent is responsible for reviewing changes and deciding when to pull/merge.
			const subtaskWorktree = workerSession.worktreePath;
			const parentWorktree = subTask.worktreePath;
			this._logService.debug(`[SubTaskManager] Subtask worktree: ${subtaskWorktree}, Parent worktree: ${parentWorktree}`)

			// Get list of changed files in subtask worktree (for parent to review)
			let changedFiles: string[] = [];
			if (subtaskWorktree && subtaskWorktree !== parentWorktree) {
				try {
					const statusOutput = await this._execGitInWorktree(['status', '--porcelain'], subtaskWorktree);
					for (const line of statusOutput.split(/\r?\n/).filter(Boolean)) {
						const file = line.slice(3).trim();
						if (file) {
							changedFiles.push(file);
						}
					}
				} catch (e) {
					this._logService.debug(`[SubTaskManager] Could not get changed files: ${e}`);
				}
			}

			// Enhance result with worktree info (parent uses this to decide what to do)
			const enhancedResult: ISubTaskResult = {
				...result,
				metadata: {
					...result.metadata,
					subtaskWorktree,
					parentWorktree,
					changedFiles,
					workerId: workerSession.id,
				},
			};

			this._logService.debug(`[SubTaskManager] _executeSubTaskWithOrchestratorUI COMPLETED for ${subTask.id}`);
			return enhancedResult;
		} catch (error) {
			this._logService.error(`[SubTaskManager] _executeSubTaskWithOrchestratorUI FAILED: ${error instanceof Error ? error.message : String(error)}`);
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
	 * Listens for task.completed, task.failed events.
	 *
	 * NOTE: No hard timeout is enforced. Agents are expected to call a2a_subtask_complete
	 * when done. Progress checks every 5 minutes keep parents informed, and idle inquiries
	 * remind agents to complete or report blockers.
	 *
	 * @precondition this._orchestratorService is defined
	 */
	private async _waitForOrchestratorTaskCompletion(
		taskId: string,
		workerId: string,
		token: CancellationToken
	): Promise<ISubTaskResult> {
		this._logService.debug(`[SubTaskManager] Waiting for taskId=${taskId}, workerId=${workerId} (no hard timeout)`);
		const orchestratorService = this._orchestratorService!;

		return new Promise<ISubTaskResult>((resolve) => {
			const disposables: vscode.Disposable[] = [];
			let resolved = false;

			const cleanup = () => {
				if (!resolved) {
					resolved = true;
					disposables.forEach(d => d.dispose());
				}
			};

			const resolveOnce = (result: ISubTaskResult, reason: string) => {
				if (!resolved) {
					this._logService.debug(`[SubTaskManager] RESOLVING via: ${reason}`);
					this._logService.debug(`[SubTaskManager] Result: status=${result.status}, error=${result.error || 'none'}`);
					cleanup();
					resolve(result);
				} else {
					this._logService.debug(`[SubTaskManager] IGNORING duplicate resolution via: ${reason} (already resolved)`);
				}
			};

			// NOTE: No hard timeout - agents complete via a2a_subtask_complete.
			// Progress checks and idle inquiries keep parents informed and remind agents to complete.

			// Listen for task/worker events
			this._logService.debug(`[SubTaskManager] Registering orchestrator event listener`);
			disposables.push(orchestratorService.onOrchestratorEvent(event => {
				this._logService.debug(`[SubTaskManager] Received orchestrator event: type=${event.type}, taskId=${'taskId' in event ? event.taskId : 'N/A'}, workerId=${'workerId' in event ? event.workerId : 'N/A'}`);

				// Handle task-specific events
				if ('taskId' in event && event.taskId === taskId) {
					if (event.type === 'task.completed') {
						this._logService.debug(`[SubTaskManager] EVENT: task.completed for our task ${taskId}`);
						const workerState = orchestratorService.getWorkerState(workerId);
						resolveOnce({
							taskId,
							status: 'success',
							output: workerState?.messages?.map(m => m.content).join('\n') || 'Task completed successfully',
						}, 'task.completed event');
					} else if (event.type === 'task.failed') {
						this._logService.error(`[SubTaskManager] EVENT: task.failed for task ${taskId}, error=${(event as any).error}`);
						resolveOnce({
							taskId,
							status: 'failed',
							output: '',
							error: (event as any).error || 'Task failed',
						}, 'task.failed event');
					}
				}

				// Handle worker.idle - NOTE: idle no longer means completion
				// With the new notification mechanism, workers can go idle while waiting for subtasks.
				// Only explicit completion (via a2a_subtask_complete or task.completed event) should resolve.
				// The idle inquiry mechanism will ask idle workers why they're idle and queue updates for parents.
				if (event.type === 'worker.idle' && 'workerId' in event && event.workerId === workerId) {
					this._logService.debug(`[SubTaskManager] EVENT: worker.idle for our worker ${workerId} - NOT treating as completion (use a2a_subtask_complete)`);
					// Check if task was already marked with an error
					const task = orchestratorService.getTaskById(taskId);
					if (task?.error) {
						this._logService.error(`[SubTaskManager] Worker ${workerId} idle with task error: ${task.error}`);
						const workerState = orchestratorService.getWorkerState(workerId);
						resolveOnce({
							taskId,
							status: 'failed',
							output: workerState?.messages?.map(m => m.content).join('\n') || '',
							error: task.error,
						}, 'worker.idle event (with task error)');
					}
					// If no error, do NOT resolve - let the agent explicitly complete via a2a_subtask_complete
				}
			}));

			// Listen for worker session completion directly
			const workerSession = orchestratorService.getWorkerSession(workerId);
			this._logService.debug(`[SubTaskManager] Got worker session: ${workerSession ? 'YES' : 'NO'}`);
			if (workerSession) {
				this._logService.debug(`[SubTaskManager] Registering worker session event listeners`);

				disposables.push(workerSession.onDidComplete(() => {
					this._logService.debug(`[SubTaskManager] EVENT: workerSession.onDidComplete for ${workerId}`);
					const workerState = orchestratorService.getWorkerState(workerId);
					resolveOnce({
						taskId,
						status: 'success',
						output: workerState?.messages?.map(m => m.content).join('\n') || 'Task completed',
					}, 'workerSession.onDidComplete');
				}));

				// Also listen for stop (error/cancellation)
				disposables.push(workerSession.onDidStop(() => {
					this._logService.debug(`[SubTaskManager] EVENT: workerSession.onDidStop for ${workerId}`);
					const workerState = orchestratorService.getWorkerState(workerId);
					this._logService.debug(`[SubTaskManager] Worker state at stop: status=${workerState?.status}, errorMessage=${workerState?.errorMessage}`);
					resolveOnce({
						taskId,
						status: 'failed',
						output: workerState?.messages?.map(m => m.content).join('\n') || '',
						error: workerState?.errorMessage || 'Worker stopped unexpectedly',
					}, 'workerSession.onDidStop');
				}));

				// Listen for any state change and check for terminal states (error, completed)
				// NOTE: idle is NO LONGER a terminal state - workers can be idle while waiting for subtasks
				// Only explicit completion (via a2a_subtask_complete) or error should resolve
				disposables.push(workerSession.onDidChange(() => {
					const workerState = orchestratorService.getWorkerState(workerId);
					if (!workerState) {
						return;
					}
					this._logService.debug(`[SubTaskManager] EVENT: workerSession.onDidChange - status=${workerState.status}`);

					// Terminal states: completed, error (NOT idle - idle means waiting, not finished)
					if (workerState.status === 'completed') {
						this._logService.debug(`[SubTaskManager] Worker status is 'completed' - resolving success`);
						resolveOnce({
							taskId,
							status: 'success',
							output: workerState.messages?.map(m => m.content).join('\n') || 'Task completed',
						}, 'workerSession.onDidChange (status=completed)');
					} else if (workerState.status === 'error') {
						this._logService.error(`[SubTaskManager] Worker ${workerId} status is 'error': ${workerState.errorMessage}`);
						resolveOnce({
							taskId,
							status: 'failed',
							output: workerState.messages?.map(m => m.content).join('\n') || '',
							error: workerState.errorMessage || 'Worker error',
						}, 'workerSession.onDidChange (status=error)');
					} else if (workerState.status === 'idle') {
						// Worker went idle - this is NOT automatic completion anymore
						// The idle inquiry mechanism will handle asking workers why they're idle
						// Only resolve if there's an explicit error on the task
						this._logService.debug(`[SubTaskManager] Worker status is 'idle' - NOT treating as completion (use a2a_subtask_complete)`);
						const task = orchestratorService.getTaskById(taskId);
						if (task?.error) {
							this._logService.error(`[SubTaskManager] Worker ${workerId} idle but task has error: ${task.error}`);
							resolveOnce({
								taskId,
								status: 'failed',
								output: workerState.messages?.map(m => m.content).join('\n') || '',
								error: task.error,
							}, 'workerSession.onDidChange (status=idle, task has error)');
						}
						// If no error, do NOT resolve - let agent explicitly complete via a2a_subtask_complete
					}
				}));
			} else {
				this._logService.warn(`[SubTaskManager] NO WORKER SESSION FOUND for ${workerId} - cannot register session event listeners!`);
			}

			// Handle cancellation
			token.onCancellationRequested(() => {
				this._logService.info(`[SubTaskManager] CANCELLATION REQUESTED - interrupting worker`);
				orchestratorService.interruptWorker(workerId);
				resolveOnce({
					taskId,
					status: 'failed',
					output: '',
					error: 'Task was cancelled',
				}, 'cancellation requested');
			});

			this._logService.info(`[SubTaskManager] All event listeners registered, now waiting for completion...`);
		});
	}

	/**
	 * Build the additional instructions for a subtask.
	 * This is used by both _executeSubTaskInternal and _executeSubTaskWithOrchestratorUI
	 * to ensure consistent guidance for subtask agents.
	 */
	private _buildSubTaskAdditionalInstructions(subTask: ISubTask, spawnContext: SpawnContext): string {
		// Determine effective max depth based on spawn context
		// For 'subtask' context, treat as 'agent' for depth limit purposes
		const effectiveContext = spawnContext === 'subtask' ? 'agent' : spawnContext;
		const effectiveMaxDepth = this._safetyLimitsService.getMaxDepthForContext(effectiveContext);
		// Determine if this subtask can spawn more subtasks based on depth
		const canSpawnSubTasks = subTask.depth < effectiveMaxDepth;
		const subTaskGuidance = canSpawnSubTasks
			? `You CAN spawn sub-tasks if needed using a2a_spawn_subtask or a2a_spawn_parallel_subtasks tools. Use orchestrator_listAgents to discover available agent types.`
			: `You are at maximum depth (${subTask.depth}/${effectiveMaxDepth}) for ${spawnContext} context and CANNOT spawn additional sub-tasks. Complete this task directly.`;

		return `## SUB-TASK CONTEXT
You are a sub-agent spawned by a PARENT AGENT (not the user).
- **Your Parent:** Worker ID '${subTask.parentWorkerId}'
- **Your Task ID:** ${subTask.id}
- **Depth Level:** ${subTask.depth} of ${this.maxDepth}
${subTask.targetFiles?.length ? `- **Target Files:** ${subTask.targetFiles.join(', ')}` : ''}

## YOUR WORKTREE
You are working in your own dedicated worktree at: ${escapePathForMarkdown(subTask.worktreePath)}
This is separate from your parent's worktree. Your parent will merge your branch when you're done.

## ⚠️ CRITICAL: YOU MUST COMMIT YOUR CHANGES WHEN COMPLETING
**When you finish your task, you MUST call \`a2a_subtask_complete\` with a \`commitMessage\` parameter.**

Example completion:
\`\`\`json
{
  "subTaskId": "${subTask.id}",
  "status": "success",
  "output": "Summary of what was accomplished",
  "commitMessage": "feat: descriptive message of your changes"
}
\`\`\`

**⚠️ WARNING: If you call a2a_subtask_complete WITHOUT a commitMessage, your changes will NOT be committed and will be LOST!**
**⚠️ WARNING: If you simply stop without calling a2a_subtask_complete with commitMessage, your work will be LOST!**

## WORKTREE RESTRICTION
**You can ONLY modify files within your worktree: ${escapePathForMarkdown(subTask.worktreePath)}**
Any attempt to read, write, or modify files outside this path is forbidden and will fail.

## COMMUNICATION WITH PARENT
- Use \`a2a_notify_orchestrator\` to send status updates, questions, or progress reports to your parent.
- **For approval requests**: Use \`a2a_notify_orchestrator\` with type \`approval_request\` to request approval from your parent for sensitive operations.
  - Include metadata: \`{ "approvalId": "<unique-id>", "action": "<what-you-want-to-do>", "description": "<why>" }\`
  - Your parent will approve or deny, and the response will be routed back to you.
- **DO NOT** try to communicate with the user directly - route everything through your parent.

## YOUR RESPONSIBILITIES
1. Complete the specific task assigned to you.
2. Make file changes directly in your worktree using standard tools (create_file, replace_string_in_file, etc.).
3. **When done, call a2a_subtask_complete with status, output, AND commitMessage.**

## SUB-TASK SPAWNING
${subTaskGuidance}

Good reasons to spawn sub-tasks:
- Investigating API documentation or external resources
- Code review by a specialist agent
- Build/test troubleshooting while you focus on main task
- Any independent research that would distract from your core goal

## EXPECTED OUTPUT
${subTask.expectedOutput}

Focus on your assigned task and provide a clear, actionable result.`;
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
		parts.push(`| Worktree | ${escapePathForMarkdown(subTask.worktreePath)} |`);
		parts.push('');

		// Add the actual prompt
		parts.push(`## Your Task`);
		parts.push(subTask.prompt);
		parts.push('');

		// Add expected output guidance
		parts.push(`## Expected Deliverable`);
		parts.push(subTask.expectedOutput);
		parts.push('');

		// Add CRITICAL completion requirement
		parts.push(`## ⚠️ CRITICAL: You MUST Commit Your Changes When Done`);
		parts.push('');
		parts.push(`**When you have finished your work, you MUST call the \`a2a_subtask_complete\` tool with a \`commitMessage\` parameter.**`);
		parts.push('');
		parts.push(`This is REQUIRED - your changes will NOT be merged to the parent unless you commit them.`);
		parts.push('');
		parts.push(`Example completion call:`);
		parts.push('```json');
		parts.push(`{`);
		parts.push(`  "subTaskId": "${subTask.id}",`);
		parts.push(`  "status": "success",`);
		parts.push(`  "output": "Summary of what was accomplished",`);
		parts.push(`  "commitMessage": "feat: descriptive message of your changes"`);
		parts.push(`}`);
		parts.push('```');
		parts.push('');
		parts.push(`**DO NOT just stop working or call a2a_subtask_complete without a commitMessage - your work will be lost!**`);

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

	// ========================================================================
	// Worktree Merge
	// ========================================================================

	/**
	 * Execute a git command in a worktree.
	 */
	private async _execGitInWorktree(args: string[], cwd: string): Promise<string> {
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

	override dispose(): void {
		// Cancel all running sub-tasks
		for (const [id] of this._cancellationSources) {
			this.cancelSubTask(id);
		}
		super.dispose();
	}
}

