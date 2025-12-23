/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CancellationToken } from '../../util/vs/base/common/cancellation';
import { Event } from '../../util/vs/base/common/event';
import { createDecorator } from '../../util/vs/platform/instantiation/common/instantiation';
import { ParsedAgentType } from './agentTypeParser';
import { IOrchestratorPermissions } from './orchestratorPermissions';
import { IEmergencyStopOptions, IEmergencyStopResult, ISafetyLimitsConfig, ISubTaskCost, ITokenUsage } from './safetyLimits';
import { WorkerToolSet } from './workerToolsService';

// --- From agentRunner.ts ---

export const IAgentRunner = createDecorator<IAgentRunner>('agentRunner');

export interface IAgentHistoryEntry {
	/** The role of this message */
	role: 'user' | 'assistant';
	/** The message content */
	content: string;
}

/**
 * Options for running an agent task programmatically
 */
export interface IAgentRunOptions {
	/** The prompt/instruction for the agent */
	prompt: string;

	/** Optional session ID for conversation continuity */
	sessionId?: string;

	/** The language model to use */
	model: vscode.LanguageModelChat;

	/** Suggested files to include as context */
	suggestedFiles?: string[];

	/** Additional context instructions */
	additionalInstructions?: string;

	/** Cancellation token */
	token: CancellationToken;

	/**
	 * Tool invocation token from a real VS Code ChatRequest.
	 * When provided, tool confirmations will show inline in the chat UI
	 * instead of as modal dialogs.
	 */
	toolInvocationToken?: vscode.ChatParticipantToolToken;

	/** Event fired when the agent should pause/resume */
	onPaused?: Event<boolean>;

	/** Maximum tool call iterations (defaults to 200 for agent mode) */
	maxToolCallIterations?: number;

	/**
	 * Worker tool set for scoped tool access.
	 * When provided, uses the worker's scoped instantiation service and tools.
	 * This ensures tools operate within the worker's worktree.
	 */
	workerToolSet?: WorkerToolSet;

	/**
	 * @deprecated Use workerToolSet instead for proper tool scoping.
	 * Worktree path for file operations (if different from main workspace).
	 * Only used for prompt context when workerToolSet is not provided.
	 */
	worktreePath?: string;

	/** Callback invoked when a message is added to the conversation */
	onMessageAdded?: (message: { role: 'user' | 'assistant' | 'tool'; content: string }) => void;

	/**
	 * Previous conversation history to provide context.
	 * These are prior user/assistant exchanges that help the agent understand
	 * the full conversation context.
	 */
	history?: IAgentHistoryEntry[];
}

/**
 * Result from running an agent task
 */
export interface IAgentRunResult {
	/** Whether the task completed successfully */
	success: boolean;

	/** Error message if failed */
	error?: string;

	/** The response text from the agent */
	response?: string;

	/** Metadata from the chat result */
	metadata?: Record<string, unknown>;
}

/**
 * Service for running agent tasks programmatically without requiring a ChatRequest.
 * This abstracts away the VS Code chat UI concerns and provides a clean API for
 * executing agent tasks with full tool capabilities.
 */
export interface IAgentRunner {
	readonly _serviceBrand: undefined;

	/**
	 * Run an agent task with the given options.
	 * Returns the result of the agent execution.
	 */
	run(options: IAgentRunOptions, stream: vscode.ChatResponseStream): Promise<IAgentRunResult>;

	/**
	 * Summarize conversation context for a model switch.
	 * This is useful when switching to a model with a smaller context window.
	 * @param currentHistory The current conversation history
	 * @param targetModel The model being switched to
	 * @param currentModel The current model to use for summarization
	 * @returns A condensed summary of the conversation context
	 */
	summarizeContextForModelSwitch(
		currentHistory: IAgentHistoryEntry[],
		targetModel: string,
		currentModel: vscode.LanguageModelChat
	): Promise<string>;
}

// --- From subTaskManager.ts ---

export const ISubTaskManager = createDecorator<ISubTaskManager>('subTaskManager');

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
	/** Base branch (inherited from parent's current branch) */
	baseBranch?: string;
	/** Agent type to use (e.g., '@architect', '@reviewer') */
	agentType: string;
	/** Parsed agent type with backend routing information */
	parsedAgentType?: ParsedAgentType;
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
	/** Inherited permissions from parent */
	inheritedPermissions?: IOrchestratorPermissions;
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
	/** ID of the parent sub-task (if this is a nested sub-task) */
	parentSubTaskId?: string;
	/** Plan ID */
	planId: string;
	/** Worktree path (inherited from parent) */
	worktreePath: string;
	/** Base branch (inherited from parent's current branch) */
	baseBranch?: string;
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
	/** Inherited permissions from parent */
	inheritedPermissions?: IOrchestratorPermissions;
	/**
	 * Spawn context inherited from parent - determines depth limits.
	 * 'orchestrator' = spawned from orchestrator-deployed worker (max depth 2)
	 * 'agent' = spawned from standalone agent (max depth 1)
	 */
	spawnContext?: 'orchestrator' | 'agent';
}

/**
 * Service for managing sub-task spawning, execution, and lifecycle.
 */
export interface ISubTaskManager {
	readonly _serviceBrand: undefined;

	/**
	 * Maximum depth allowed for sub-tasks (defaults to orchestrator context).
	 * depth 0 = main task, depth 1 = sub-task, depth 2 = sub-sub-task
	 */
	readonly maxDepth: number;

	/**
	 * Get effective max depth for a specific spawn context.
	 * @param context The spawn context ('orchestrator' or 'agent')
	 * @returns Maximum depth allowed for that context
	 */
	getMaxDepthForContext(context: 'orchestrator' | 'agent'): number;

	/**
	 * Get current safety limits configuration.
	 */
	readonly safetyLimits: ISafetyLimitsConfig;

	/**
	 * Create a new sub-task.
	 * @param options Sub-task creation options
	 * @returns The created sub-task
	 * @throws Error if depth limit would be exceeded
	 * @throws Error if rate limit exceeded
	 * @throws Error if total sub-task limit exceeded
	 * @throws Error if parallel sub-task limit exceeded
	 * @throws Error if cycle detected
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
	 * Get running sub-tasks count for a worker.
	 */
	getRunningSubTasksCount(workerId: string): number;

	/**
	 * Get total sub-tasks count for a worker.
	 */
	getTotalSubTasksCount(workerId: string): number;

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
	 * Track cost for a sub-task execution.
	 */
	trackSubTaskCost(subTaskId: string, usage: ITokenUsage, model: string): void;

	/**
	 * Get total cost for all sub-tasks of a worker.
	 */
	getTotalCostForWorker(workerId: string): number;

	/**
	 * Get cost details for a specific sub-task.
	 */
	getSubTaskCost(subTaskId: string): ISubTaskCost | undefined;

	/**
	 * Emergency stop to kill all sub-tasks in scope.
	 */
	emergencyStop(options: IEmergencyStopOptions): Promise<IEmergencyStopResult>;

	/**
	 * Update safety limits configuration.
	 */
	updateSafetyLimits(config: Partial<ISafetyLimitsConfig>): void;

	/**
	 * Reset all tracking for a worker (on worker completion/disposal).
	 */
	resetWorkerTracking(workerId: string): void;

	/**
	 * Event fired when a sub-task status changes.
	 */
	onDidChangeSubTask: Event<ISubTask>;

	/**
	 * Event fired when a sub-task completes.
	 */
	onDidCompleteSubTask: Event<ISubTask>;

	/**
	 * Event fired on emergency stop.
	 */
	onEmergencyStop: Event<IEmergencyStopOptions>;

	/**
	 * Check if a sub-task has permission for an action based on inherited permissions.
	 * @param subTaskId Sub-task ID
	 * @param action Action to check
	 * @returns true if auto-approved by inherited permissions
	 */
	checkPermission(subTaskId: string, action: string): boolean;

	/**
	 * Set the orchestrator service for UI-enabled subtask execution.
	 * This is called lazily by OrchestratorService to avoid circular dependency.
	 * @param orchestratorService The orchestrator service instance
	 */
	setOrchestratorService(orchestratorService: unknown): void;
}
