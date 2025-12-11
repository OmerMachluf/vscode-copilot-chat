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

	/** Maximum depth for sub-tasks (0=main, 1=sub, 2=sub-sub) */
	readonly maxDepth = 2;

	private readonly _subTasks = new Map<string, ISubTask>();
	private readonly _cancellationSources = new Map<string, CancellationTokenSource>();
	private readonly _runningSubTasks = new Map<string, Promise<ISubTaskResult>>();

	private readonly _onDidChangeSubTask = this._register(new Emitter<ISubTask>());
	readonly onDidChangeSubTask = this._onDidChangeSubTask.event;

	private readonly _onDidCompleteSubTask = this._register(new Emitter<ISubTask>());
	readonly onDidCompleteSubTask = this._onDidCompleteSubTask.event;

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

		// 1. Enforce depth limit
		this._safetyLimitsService.enforceDepthLimit(options.currentDepth);

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
			return {
				taskId: id,
				status: 'failed',
				output: '',
				error: `Sub-task ${id} not found`,
			};
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

		try {
			const result = await this._executeSubTaskInternal(subTask, cts.token);
			this.updateStatus(id, result.status === 'success' ? 'completed' : 'failed', result);
			return result;
		} catch (error) {
			const result: ISubTaskResult = {
				taskId: id,
				status: 'failed',
				output: '',
				error: error instanceof Error ? error.message : String(error),
			};
			this.updateStatus(id, 'failed', result);
			return result;
		} finally {
			this._cancellationSources.delete(id);
			this._runningSubTasks.delete(id);
		}
	}

	private async _executeSubTaskInternal(subTask: ISubTask, token: CancellationToken): Promise<ISubTaskResult> {
		// Get or create worker tool set for the parent worker
		let toolSet = this._workerToolsService.getWorkerToolSet(subTask.parentWorkerId);
		if (!toolSet) {
			// Create a new tool set scoped to the worktree
			toolSet = this._workerToolsService.createWorkerToolSet(
				`${subTask.parentWorkerId}-subtask-${subTask.id}`,
				subTask.worktreePath
			);
		}

		// Select the model
		const models = await vscode.lm.selectChatModels({
			vendor: 'copilot',
			family: subTask.model ?? 'gpt-4o',
		});

		if (models.length === 0) {
			return {
				taskId: subTask.id,
				status: 'failed',
				output: '',
				error: 'No suitable model available',
			};
		}

		const model = models[0];

		// Build the prompt with sub-task context
		const contextPrompt = this._buildSubTaskPrompt(subTask);

		// Create a simple stream collector
		const streamCollector = new SubTaskStreamCollector();

		// Build agent run options
		const runOptions: IAgentRunOptions = {
			prompt: contextPrompt,
			model,
			workerToolSet: toolSet,
			worktreePath: subTask.worktreePath,
			token,
			maxToolCallIterations: 50, // Lower limit for sub-tasks
			additionalInstructions: `You are executing a sub-task spawned by a parent agent.
Expected output: ${subTask.expectedOutput}
Depth level: ${subTask.depth} (max: ${this.maxDepth})
${subTask.targetFiles?.length ? `Target files: ${subTask.targetFiles.join(', ')}` : ''}

Focus on completing this specific task and return a clear result.
Do not spawn additional sub-tasks unless absolutely necessary.`,
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

		// Add context about being a sub-task
		parts.push(`## Sub-Task Execution`);
		parts.push(`Agent Type: ${subTask.agentType}`);
		parts.push(`Task ID: ${subTask.id}`);
		parts.push(`Depth: ${subTask.depth}`);
		parts.push('');

		// Add the actual prompt
		parts.push(`## Task`);
		parts.push(subTask.prompt);
		parts.push('');

		// Add expected output guidance
		parts.push(`## Expected Output`);
		parts.push(subTask.expectedOutput);

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

	textEdit(target: vscode.Uri, edits: vscode.TextEdit | vscode.TextEdit[]): void {
		const uriStr = target.toString();
		let existing = this._bufferedEdits.get(uriStr) || [];
		if (Array.isArray(edits)) {
			existing.push(...edits);
		} else {
			existing.push(edits);
		}
		this._bufferedEdits.set(uriStr, existing);
	}

	notebookEdit(target: vscode.Uri, edits: vscode.NotebookEdit | vscode.NotebookEdit[]): void {
		const uriStr = target.toString();
		let existing = this._bufferedNotebookEdits.get(uriStr) || [];
		if (Array.isArray(edits)) {
			existing.push(...edits);
		} else {
			existing.push(edits);
		}
		this._bufferedNotebookEdits.set(uriStr, existing);
	}

	externalEdit<T>(_target: vscode.Uri | vscode.Uri[], callback: () => Thenable<T>): Thenable<T> {
		// Execute callback but don't track changes
		return callback();
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
