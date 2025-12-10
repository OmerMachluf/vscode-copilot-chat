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
import { createDecorator } from '../../util/vs/platform/instantiation/common/instantiation';
import { IAgentHistoryEntry, IAgentRunner, IAgentRunOptions } from './agentRunner';
import { IWorkerToolsService } from './workerToolsService';

/**
 * Represents a sub-task spawned by a parent agent.
 * Sub-tasks execute within the parent's worktree context.
 */
export interface ISubTask {
	/** Unique identifier for this sub-task */
	id: string;
	/** ID of the parent worker that spawned this sub-task */
	parentWorkerId: string;
	/** ID of the parent task (for tracking hierarchy) */
	parentTaskId: string;
	/** Plan ID this sub-task belongs to */
	planId: string;
	/** Path to the worktree (inherited from parent) */
	worktreePath: string;
	/** Agent type to use (e.g., '@architect', '@reviewer') */
	agentType: string;
	/** The prompt/instruction for the sub-task */
	prompt: string;
	/** Description of what output is expected */
	expectedOutput: string;
	/** Optional model override */
	model?: string;
	/** Depth level: 0=main task, 1=sub-task, 2=sub-sub-task */
	depth: number;
	/** Current status of the sub-task */
	status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
	/** Result of the sub-task execution */
	result?: ISubTaskResult;
	/** Files this task intends to modify (for conflict detection) */
	targetFiles?: string[];
	/** Timestamp when the sub-task was created */
	createdAt: number;
	/** Timestamp when the sub-task completed */
	completedAt?: number;
}

/**
 * Result from a sub-task execution.
 */
export interface ISubTaskResult {
	/** ID of the sub-task this result belongs to */
	taskId: string;
	/** Status of the execution */
	status: 'success' | 'partial' | 'failed' | 'timeout';
	/** The output/response from the sub-task */
	output: string;
	/** Optional file containing detailed output */
	outputFile?: string;
	/** Additional metadata from the execution */
	metadata?: Record<string, unknown>;
	/** Error message if failed */
	error?: string;
}

/**
 * Options for creating a new sub-task.
 */
export interface ISubTaskCreateOptions {
	/** ID of the parent worker */
	parentWorkerId: string;
	/** ID of the parent task */
	parentTaskId: string;
	/** Plan ID */
	planId: string;
	/** Worktree path (inherited from parent) */
	worktreePath: string;
	/** Agent type to execute the sub-task */
	agentType: string;
	/** The prompt/instruction */
	prompt: string;
	/** Expected output description */
	expectedOutput: string;
	/** Optional model override */
	model?: string;
	/** Current depth (will be incremented for sub-task) */
	currentDepth: number;
	/** Files this task intends to modify */
	targetFiles?: string[];
	/** Parent's conversation history for context */
	parentHistory?: IAgentHistoryEntry[];
}

export const ISubTaskManager = createDecorator<ISubTaskManager>('subTaskManager');

/**
 * Service for managing sub-task spawning, execution, and lifecycle.
 */
export interface ISubTaskManager {
	readonly _serviceBrand: undefined;

	/**
	 * Maximum depth allowed for sub-tasks.
	 * depth 0 = main task, depth 1 = sub-task, depth 2 = sub-sub-task
	 */
	readonly maxDepth: number;

	/**
	 * Create a new sub-task.
	 * @param options Sub-task creation options
	 * @returns The created sub-task
	 * @throws Error if depth limit would be exceeded
	 */
	createSubTask(options: ISubTaskCreateOptions): ISubTask;

	/**
	 * Get a sub-task by ID.
	 */
	getSubTask(id: string): ISubTask | undefined;

	/**
	 * Get all sub-tasks for a specific worker.
	 */
	getSubTasksForWorker(workerId: string): ISubTask[];

	/**
	 * Get all sub-tasks for a specific parent task.
	 */
	getSubTasksForParentTask(parentTaskId: string): ISubTask[];

	/**
	 * Update the status of a sub-task.
	 */
	updateStatus(id: string, status: ISubTask['status'], result?: ISubTaskResult): void;

	/**
	 * Execute a sub-task.
	 * @param id Sub-task ID
	 * @param token Cancellation token
	 * @returns The result of the execution
	 */
	executeSubTask(id: string, token: CancellationToken): Promise<ISubTaskResult>;

	/**
	 * Cancel a running sub-task.
	 */
	cancelSubTask(id: string): void;

	/**
	 * Check if files have conflicts with running sub-tasks.
	 * @param targetFiles Files to check
	 * @param excludeTaskId Task ID to exclude from check (for self-check)
	 * @returns Array of conflicting task IDs
	 */
	checkFileConflicts(targetFiles: string[], excludeTaskId?: string): string[];

	/**
	 * Get the current depth for a worker.
	 * Returns 0 if the worker is a main task, or the depth of its sub-task chain.
	 */
	getTaskDepth(taskId: string): number;

	/**
	 * Event fired when a sub-task status changes.
	 */
	onDidChangeSubTask: Event<ISubTask>;

	/**
	 * Event fired when a sub-task completes.
	 */
	onDidCompleteSubTask: Event<ISubTask>;
}

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
	) {
		super();
	}

	createSubTask(options: ISubTaskCreateOptions): ISubTask {
		const newDepth = options.currentDepth + 1;

		// Enforce depth limit
		if (newDepth > this.maxDepth) {
			throw new Error(
				`Sub-task depth limit exceeded. Maximum depth is ${this.maxDepth} ` +
				`(current: ${options.currentDepth}, requested: ${newDepth}). ` +
				`Consider restructuring your task to reduce nesting.`
			);
		}

		const id = `subtask-${generateUuid().substring(0, 8)}`;

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

	getContent(): string {
		return this._content || this._parts.join('\n');
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

	textEdit(_target: vscode.Uri, _edits: any): void {
		// Not collected for sub-tasks
	}

	notebookEdit(_target: vscode.Uri, _edits: any): void {
		// Not collected for sub-tasks
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
