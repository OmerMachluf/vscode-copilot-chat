/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ILogService } from '../../platform/log/common/logService';
import { Emitter, Event } from '../../util/vs/base/common/event';
import { Disposable, IDisposable, toDisposable } from '../../util/vs/base/common/lifecycle';
import { generateUuid } from '../../util/vs/base/common/uuid';
import { createDecorator, IInstantiationService } from '../../util/vs/platform/instantiation/common/instantiation';
import { IClaudeWorktreeSessionManager } from '../agents/claude/node/claudeWorktreeSession';
import { IAgentExecutorRegistry, ParsedAgentType } from './agentExecutor';
import { registerBuiltInExecutors } from './agentExecutorRegistry';
import { IAgentInstructionService } from './agentInstructionService';
import { IAgentRunner } from './agentRunner';
import { AgentTypeParseError, parseAgentType } from './agentTypeParser';
import { IBackendSelectionService } from './backendSelectionService';
import { CircuitBreaker } from './circuitBreaker';
import {
	CompletionManager,
	ICompletionOptions,
	ICompletionResult,
	ICompletionSummary,
	IMergeOptions,
	IMergeResult,
	IPullRequestOptions,
	IPullRequestResult,
} from './completionManager';
import { EventDrivenOrchestratorService, IOrchestratorDecision } from './eventDrivenOrchestrator';
import { IOrchestratorPermissionService, IPermissionRequest } from './orchestratorPermissions';
import { IOrchestratorQueueMessage, IOrchestratorQueueService } from './orchestratorQueue';
import { IParentCompletionService, WorkerSessionWakeUpAdapter } from './parentCompletionService';
import { ISubTaskManager } from './subTaskManager';
import { ISubtaskProgressService } from './subtaskProgressService';
import { ITaskMonitorService, ITaskUpdate } from './taskMonitorService';
import { WorkerHealthMonitor, WorkerIdleReason } from './workerHealthMonitor';
import { SerializedWorkerState, WorkerResponseStream, WorkerSession, WorkerSessionState } from './workerSession';
import { IWorkerToolsService, WorkerToolSet } from './workerToolsService';

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

export const IOrchestratorService = createDecorator<IOrchestratorService>('orchestratorService');

// ============================================================================
// Event Types
// ============================================================================

/**
 * Events emitted by the orchestrator for task lifecycle
 */
export type OrchestratorEvent =
	| { type: 'task.queued'; planId: string | undefined; taskId: string }
	| { type: 'task.started'; planId: string | undefined; taskId: string; workerId: string; sessionUri: string }
	| { type: 'task.completed'; planId: string | undefined; taskId: string; workerId: string; sessionUri?: string }
	| { type: 'task.failed'; planId: string | undefined; taskId: string; error: string }
	| { type: 'task.blocked'; planId: string | undefined; taskId: string; reason: string }
	| { type: 'worker.needs_approval'; workerId: string; approvalId: string }
	| { type: 'worker.idle'; workerId: string }
	| { type: 'plan.started'; planId: string }
	| { type: 'plan.completed'; planId: string }
	| { type: 'plan.failed'; planId: string; error: string };

// ============================================================================
// Data Models
// ============================================================================

/**
 * Task context - files and instructions to help the worker
 */
export interface WorkerTaskContext {
	/** Suggested files to start working from */
	readonly suggestedFiles?: string[];
	/** Additional instructions specific to this task */
	readonly additionalInstructions?: string;
}

/**
 * Task status for tracking execution state
 */
export type TaskStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'blocked';

/**
 * Task definition for a worker
 */
export interface WorkerTask {
	readonly id: string;
	/** Human-readable name used for branch naming */
	readonly name: string;
	readonly description: string;
	readonly priority: 'critical' | 'high' | 'normal' | 'low';
	/** IDs of tasks that must complete first */
	readonly dependencies: string[];
	/** Tasks in same parallelGroup can potentially run together (if no file overlap) */
	readonly parallelGroup?: string;
	readonly context?: WorkerTaskContext;
	/** Base branch to create the worktree from (defaults to main/master) */
	readonly baseBranch?: string;
	/** Plan ID this task belongs to (undefined = ad-hoc task) */
	readonly planId?: string;
	/** Language model ID to use for this task (uses default if not specified) */
	readonly modelId?: string;
	/** Agent to use for this task (defaults to @agent) */
	readonly agent?: string;
	/** Target files this task will touch (for parallelization detection) */
	readonly targetFiles?: string[];
	/** Parent worker ID for subtasks - messages route to parent instead of orchestrator */
	readonly parentWorkerId?: string;
	/** Parsed agent type (set during deploy) */
	parsedAgentType?: ParsedAgentType;
	/** Current execution status */
	status: TaskStatus;
	/** Worker ID if assigned */
	workerId?: string;
	/** Session URI for the VS Code chat session (orchestrator:/<taskId>) */
	sessionUri?: string;
	/** Completion timestamp */
	completedAt?: number;
	/** Error message if failed */
	error?: string;
}

/**
 * Plan status
 */
export type PlanStatus = 'draft' | 'active' | 'paused' | 'completed' | 'failed';

/**
 * Plan definition - a collection of related tasks
 */
export interface OrchestratorPlan {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly createdAt: number;
	/** Base branch for all tasks in this plan (can be overridden per task) */
	readonly baseBranch?: string;
	/** Plan execution status */
	status: PlanStatus;
	/** Metadata from planner */
	metadata?: {
		sourceRequest?: string;
		methodology?: string;
	};
}

/**
 * Options for creating a task
 */
export interface CreateTaskOptions {
	/** Human-readable name (used for branch naming) */
	name?: string;
	priority?: 'critical' | 'high' | 'normal' | 'low';
	context?: WorkerTaskContext;
	/** Base branch to create worktree from */
	baseBranch?: string;
	/** Plan to add this task to (undefined = ad-hoc) */
	planId?: string;
	/** Language model ID to use for this task */
	modelId?: string;
	/** IDs of tasks that must complete before this one */
	dependencies?: string[];
	/** Tasks in same parallelGroup can potentially run together */
	parallelGroup?: string;
	/** Agent to assign (@agent, @architect, @reviewer, or custom) */
	agent?: string;
	/** Target files this task will touch */
	targetFiles?: string[];
	/** Parent worker ID for subtasks - messages route to parent instead of orchestrator */
	parentWorkerId?: string;
	/** Pre-parsed agent type for subtasks - preserves backend specification from spawn request */
	parsedAgentType?: ParsedAgentType;
}

/**
 * Persisted orchestrator state
 */
interface PersistedOrchestratorState {
	readonly version: number;
	readonly plans: OrchestratorPlan[];
	readonly tasks: WorkerTask[];
	readonly workers: SerializedWorkerState[];
	readonly nextTaskId: number;
	readonly nextPlanId: number;
	readonly activePlanId?: string;
}

/**
 * Orchestrator service interface
 */
export interface IOrchestratorService {
	readonly _serviceBrand: undefined;

	/** Event fired when state changes */
	readonly onDidChangeWorkers: Event<void>;

	/** Event fired for task/plan lifecycle events */
	readonly onOrchestratorEvent: Event<OrchestratorEvent>;

	// --- Plan Management ---

	/** Get all plans */
	getPlans(): readonly OrchestratorPlan[];

	/** Get a plan by ID */
	getPlanById(planId: string): OrchestratorPlan | undefined;

	/** Get the active plan ID */
	getActivePlanId(): string | undefined;

	/** Set the active plan */
	setActivePlan(planId: string | undefined): void;

	/** Create a new plan */
	createPlan(name: string, description: string, baseBranch?: string): OrchestratorPlan;

	/** Delete a plan and its pending tasks */
	deletePlan(planId: string): void;

	/** Start executing a plan (deploys tasks based on dependencies) */
	startPlan(planId: string): Promise<void>;

	/** Pause a plan (no new tasks will be deployed) */
	pausePlan(planId: string): void;

	/** Resume a paused plan */
	resumePlan(planId: string): void;

	// --- Task Management ---

	/** Get all worker states */
	getWorkerStates(): WorkerSessionState[];

	/** Get a specific worker's state */
	getWorkerState(workerId: string): WorkerSessionState | undefined;

	/** Get tasks for a specific plan (undefined = ad-hoc tasks) */
	getTasks(planId?: string): readonly WorkerTask[];

	/** Get a task by ID */
	getTaskById(taskId: string): WorkerTask | undefined;

	/** Get the current plan's tasks (backward compatible) */
	getPlan(): readonly WorkerTask[];

	/** Add a task */
	addTask(description: string, options?: CreateTaskOptions): WorkerTask;

	/** Clear tasks for a plan (undefined = ad-hoc tasks) */
	clearTasks(planId?: string): void;

	/** Clear the plan (backward compatible) */
	clearPlan(): void;

	/** Remove a task */
	removeTask(taskId: string): void;

	/** Get tasks that are ready to run (dependencies satisfied) */
	getReadyTasks(planId?: string): readonly WorkerTask[];

	// --- Worker Management ---

	/** Deploy a worker for a specific task or the first pending task */
	deploy(taskId?: string, options?: DeployOptions): Promise<WorkerSession>;

	/** Deploy workers for all pending tasks in a plan */
	deployAll(planId?: string, options?: DeployOptions): Promise<WorkerSession[]>;

	/** Send a message to a worker */
	sendMessageToWorker(workerId: string, message: string): void;

	/** Handle an approval request */
	handleApproval(workerId: string, approvalId: string, approved: boolean, clarification?: string): void;

	/** Pause a worker */
	pauseWorker(workerId: string): void;

	/** Resume a worker */
	resumeWorker(workerId: string): void;

	/** Interrupt the worker's current agent iteration to provide feedback */
	interruptWorker(workerId: string): void;

	/** @deprecated Use interruptWorker() instead */
	stopWorker(workerId: string): void;

	/** Stop and remove a worker (does not push changes) */
	concludeWorker(workerId: string): void;

	/** Complete a worker: push to origin and clean up worktree */
	completeWorker(workerId: string, options?: CompleteWorkerOptions): Promise<CompleteWorkerResult>;

	/** Kill a worker: stop process, optionally remove worktree and reset task */
	killWorker(workerId: string, options?: KillWorkerOptions): Promise<void>;

	/** Cancel a task: stop if running, reset to pending or remove */
	cancelTask(taskId: string, remove?: boolean): Promise<void>;

	/** Complete a task: mark as completed, remove worker, trigger dependent tasks */
	completeTask(taskId: string): Promise<void>;

	/** Retry a failed task: reset status and re-deploy */
	retryTask(taskId: string, options?: DeployOptions): Promise<WorkerSession>;

	/** Set the model for a worker (takes effect on next message) */
	setWorkerModel(workerId: string, modelId: string): void;

	/** Get model ID for a worker */
	getWorkerModel(workerId: string): string | undefined;

	/** Set the agent for a worker (reloads instructions, takes effect on next message) */
	setWorkerAgent(workerId: string, agentId: string): Promise<void>;

	/** Get agent ID for a worker */
	getWorkerAgent(workerId: string): string | undefined;

	// --- Session Integration ---

	/** Get the session URI for a task (orchestrator:/<taskId>) */
	getSessionUriForTask(taskId: string): string | undefined;

	/** Get a task by its session URI */
	getTaskBySessionUri(sessionUri: string): WorkerTask | undefined;

	/** Get a WorkerSession by ID (for subscribing to real-time stream events) */
	getWorkerSession(workerId: string): WorkerSession | undefined;

	// --- Inbox Management ---

	/** Get all pending inbox items that require action */
	getInboxPendingItems(): IOrchestratorInboxItem[];

	/** Get inbox items for a specific plan */
	getInboxItemsByPlan(planId: string): IOrchestratorInboxItem[];

	/** Get inbox items for a specific worker */
	getInboxItemsByWorker(workerId: string): IOrchestratorInboxItem[];

	/** Process an inbox item with a response */
	processInboxItem(itemId: string, response?: string): void;

	/** Defer an inbox item for later handling */
	deferInboxItem(itemId: string, reason: string): void;

	// --- Completion Management ---

	/** Generate a completion summary for a worker */
	generateCompletionSummary(workerId: string): Promise<ICompletionSummary>;

	/** Handle worker completion with a specific action */
	handleWorkerCompletion(workerId: string, action: ICompletionOptions, feedback?: string): Promise<ICompletionResult>;

	/** Create a pull request for a worker's changes */
	createPullRequest(options: IPullRequestOptions): Promise<IPullRequestResult>;

	/** Merge a worker's branch into the target branch */
	mergeWorkerBranch(options: IMergeOptions): Promise<IMergeResult>;

	// --- Worker Health & Recovery ---

	/** Reinitialize a worker: stop, clear history, restart with new instructions */
	reinitializeWorker(workerId: string, options?: ReinitializeWorkerOptions): Promise<ReinitializeWorkerResult>;

	/** Redirect a worker: inject a high-priority message to change direction */
	redirectWorker(workerId: string, options: RedirectWorkerOptions): Promise<RedirectWorkerResult>;

	// --- Event-Driven Orchestration ---

	/** Enable or disable LLM-based event handling */
	setLLMEventHandling(enabled: boolean): void;

	/** Check if LLM event handling is enabled */
	isLLMEventHandlingEnabled(): boolean;

	// Legacy compatibility
	getWorkers(): Record<string, any>;

	// --- Standalone Session Support ---

	/**
	 * Register a handler to receive updates for a standalone parent session.
	 * Standalone sessions (claude-standalone-*) are not in the _workers map
	 * but need to receive updates from subtasks they spawn.
	 *
	 * @param parentId The standalone session's worker ID (e.g., claude-standalone-xxx)
	 * @param handler Callback invoked with update messages to deliver to the session
	 * @returns Disposable to unregister the handler
	 */
	registerStandaloneParentHandler(parentId: string, handler: (message: string) => void): IDisposable;
}

/**
 * Options for completing a worker
 */
export interface CompleteWorkerOptions {
	/** Create a pull request after pushing (default: false) */
	createPullRequest?: boolean;
	/** PR title (defaults to task name) */
	prTitle?: string;
	/** PR description (defaults to task description) */
	prDescription?: string;
	/** Base branch for the PR (defaults to task's baseBranch or main/master) */
	prBaseBranch?: string;
}

export interface IOrchestratorInboxItem {
	id: string;
	message: IOrchestratorQueueMessage;
	status: 'pending' | 'processed' | 'deferred';
	requiresUserAction: boolean;
	createdAt: number;
	processedAt?: number;
	response?: string;
	deferReason?: string;
	/** Suggestion from LLM when escalating to user */
	llmSuggestion?: string;
}

export class OrchestratorInbox {
	private _items: IOrchestratorInboxItem[] = [];

	getPendingItems(): IOrchestratorInboxItem[] {
		return this._items.filter(i => i.status === 'pending');
	}

	getItemsByPlan(planId: string): IOrchestratorInboxItem[] {
		return this._items.filter(i => i.message.planId === planId);
	}

	getItemsByWorker(workerId: string): IOrchestratorInboxItem[] {
		return this._items.filter(i => i.message.workerId === workerId);
	}

	getItemsByTask(taskId: string): IOrchestratorInboxItem[] {
		return this._items.filter(i => i.message.taskId === taskId);
	}

	getItem(id: string): IOrchestratorInboxItem | undefined {
		return this._items.find(i => i.id === id);
	}

	markProcessed(id: string, response?: string): void {
		const item = this._items.find(i => i.id === id);
		if (item) {
			item.status = 'processed';
			item.processedAt = Date.now();
			item.response = response;
		}
	}

	deferItem(id: string, reason: string): void {
		const item = this._items.find(i => i.id === id);
		if (item) {
			item.status = 'deferred';
			item.deferReason = reason;
		}
	}

	addItem(item: IOrchestratorInboxItem): void {
		this._items.push(item);
	}

	getAllItems(): IOrchestratorInboxItem[] {
		return [...this._items];
	}

	clearProcessed(): void {
		this._items = this._items.filter(i => i.status !== 'processed');
	}
}

/**
 * Options for deploying a task
 */
export interface DeployOptions {
	/** Language model ID to use for this worker (overrides task's modelId) */
	modelId?: string;
	/** Existing worktree path to reuse (for subtasks sharing parent's worktree) */
	worktreePath?: string;
	/**
	 * Callback to build additional instructions after the worktree is created.
	 * This is called with the actual worktree path, allowing instructions to reference
	 * the correct path even when it's created dynamically during deploy.
	 */
	instructionsBuilder?: (actualWorktreePath: string) => string;
	/**
	 * Parent worker ID for the deployed task.
	 * If provided, progress updates and status changes will be sent to this parent.
	 * This allows the orchestrator agent to receive updates from its deployed workers.
	 */
	parentWorkerId?: string;
}

/**
 * Options for killing a worker
 */
export interface KillWorkerOptions {
	/** Whether to remove the worktree (default: true) */
	removeWorktree?: boolean;
	/** Whether to reset the task status to pending (default: true) */
	resetTask?: boolean;
}

/**
 * Result of completing a worker
 */
export interface CompleteWorkerResult {
	/** Branch name that was pushed */
	branchName: string;
	/** Whether a PR was created */
	prCreated: boolean;
	/** URL of the created PR (if any) */
	prUrl?: string;
	/** PR number (if created) */
	prNumber?: number;
}

/**
 * Options for reinitializing a worker
 */
export interface ReinitializeWorkerOptions {
	/** New instructions to inject (replaces agent instructions) */
	newInstructions?: string;
	/** Whether to clear the conversation history (default: true) */
	clearHistory?: boolean;
}

/**
 * Result of reinitializing a worker
 */
export interface ReinitializeWorkerResult {
	success: boolean;
	message: string;
}

/**
 * Options for redirecting a worker
 */
export interface RedirectWorkerOptions {
	/** The redirect prompt to inject as a high-priority message */
	redirectPrompt: string;
	/** Whether to preserve conversation history (default: true) */
	preserveHistory?: boolean;
}

/**
 * Result of redirecting a worker
 */
export interface RedirectWorkerResult {
	success: boolean;
	message: string;
}

/**
 * Orchestrator service implementation
 * Manages multiple worker sessions running in parallel across multiple plans
 */
export class OrchestratorService extends Disposable implements IOrchestratorService {
	declare readonly _serviceBrand: undefined;

	private static readonly STATE_VERSION = 3; // Bumped for new fields
	private static readonly STATE_FILE_NAME = '.copilot-orchestrator-state.json';

	private readonly _plans: OrchestratorPlan[] = [];
	private readonly _workers = new Map<string, WorkerSession>();
	private readonly _tasks: WorkerTask[] = [];
	private _nextTaskId = 1;
	private _nextPlanId = 1;
	private _activePlanId: string | undefined;
	private _saveDebounceTimer: ReturnType<typeof setTimeout> | undefined;
	private _defaultBaseBranch: string | undefined;

	private readonly _onDidChangeWorkers = this._register(new Emitter<void>());
	public readonly onDidChangeWorkers: Event<void> = this._onDidChangeWorkers.event;

	private readonly _onOrchestratorEvent = this._register(new Emitter<OrchestratorEvent>());
	public readonly onOrchestratorEvent: Event<OrchestratorEvent> = this._onOrchestratorEvent.event;

	// Map from worker ID to its scoped tool set
	private readonly _workerToolSets = new Map<string, WorkerToolSet>();

	// Health monitoring - initialized in constructor with logService
	private readonly _healthMonitor: WorkerHealthMonitor;
	private readonly _circuitBreakers = new Map<string, CircuitBreaker>();

	private readonly _inbox = new OrchestratorInbox();

	private readonly _completionManager: CompletionManager;

	/** Map of worker ID -> wake-up adapter disposables */
	private readonly _wakeUpAdapters = new Map<string, { dispose(): void }>();

	/** Map of worker ID -> active inquiry listener disposables (idle/progress). Cleaned up when new inquiry sent or worker interrupted. */
	private readonly _activeInquiryListeners = new Map<string, { dispose(): void }>();

	/**
	 * Map of standalone parent ID -> message handler.
	 * Used to deliver updates to standalone sessions (claude-standalone-*) that spawned subtasks.
	 * These sessions are not in _workers but need to receive updates from their children.
	 */
	private readonly _standaloneParentHandlers = new Map<string, (message: string) => void>();

	/** Event-driven orchestrator service for LLM-based decision making */
	private readonly _eventDrivenOrchestrator: EventDrivenOrchestratorService;

	/** Configuration for event-driven orchestration */
	private _enableLLMEventHandling = false;

	constructor(
		@IAgentInstructionService private readonly _agentInstructionService: IAgentInstructionService,
		@IAgentRunner private readonly _agentRunner: IAgentRunner,
		@IWorkerToolsService private readonly _workerToolsService: IWorkerToolsService,
		@IOrchestratorQueueService private readonly _queueService: IOrchestratorQueueService,
		@ISubTaskManager private readonly _subTaskManager: ISubTaskManager,
		@IOrchestratorPermissionService private readonly _permissionService: IOrchestratorPermissionService,
		@IParentCompletionService private readonly _parentCompletionService: IParentCompletionService,
		@ISubtaskProgressService private readonly _subtaskProgressService: ISubtaskProgressService,
		@IAgentExecutorRegistry private readonly _executorRegistry: IAgentExecutorRegistry,
		@IBackendSelectionService private readonly _backendSelectionService: IBackendSelectionService,
		@ITaskMonitorService private readonly _taskMonitorService: ITaskMonitorService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@IClaudeWorktreeSessionManager private readonly _claudeSessionManager: IClaudeWorktreeSessionManager,
	) {
		super();
		// Initialize health monitor with logService for debugging
		this._healthMonitor = new WorkerHealthMonitor({}, this._logService);
		// Initialize completion manager
		this._completionManager = new CompletionManager(this._permissionService, this._logService);
		// Initialize event-driven orchestrator for LLM-based decision making
		this._eventDrivenOrchestrator = this._instantiationService.createInstance(EventDrivenOrchestratorService);
		// Register built-in agent executors (Copilot, Claude Code, etc.)
		registerBuiltInExecutors(this._executorRegistry, this._instantiationService);
		// Register queue handler
		this._register(this._queueService.registerHandler(this._handleQueueMessage.bind(this)));
		// Restore state on initialization
		this._restoreState();
		// Detect default branch
		this._detectDefaultBranch();
		// Connect SubTaskManager to this orchestrator service for UI-enabled subtasks
		this._subTaskManager.setOrchestratorService(this);
		// Listen for unhealthy workers (stuck, looping, high error rate)
		this._register(this._healthMonitor.onWorkerUnhealthy(event => {
			this._orchLog('Received onWorkerUnhealthy event', { workerId: event.workerId, reason: event.reason });
			this._handleUnhealthyWorker(event.workerId, event.reason);
		}));
		// Listen for idle workers (shorter timeout than stuck) - send inquiry instead of marking complete
		// When a worker goes idle, we also check if it has pending subtask updates to inject
		this._register(this._healthMonitor.onWorkerIdle(event => {
			this._orchLog('Received onWorkerIdle event', { workerId: event.workerId, reason: event.reason });
			this._handleIdleWorker(event.workerId, event.reason).catch(err => {
				this._logService.error(`[Orchestrator] Error handling idle worker ${event.workerId}: ${err}`);
			});
		}));
		// Listen for periodic progress checks (every 5 minutes)
		// This asks active workers for a progress report and queues it for their parent
		this._register(this._healthMonitor.onProgressCheckDue(event => {
			this._orchLog('Received onProgressCheckDue event', { workerId: event.workerId });
			this._handleProgressCheck(event.workerId).catch(err => {
				this._logService.error(`[Orchestrator] Error handling progress check for ${event.workerId}: ${err}`);
			});
		}));
		// Listen for worker errors (rate limits, network issues, etc.)
		// Queue error updates immediately so parents are notified without waiting for retry exhaustion
		this._register(this._healthMonitor.onWorkerError(event => {
			this._orchLog('Received onWorkerError event', { workerId: event.workerId, error: event.error });
			this._handleWorkerError(event.workerId, event.error);
		}));
		// Note: We do NOT immediately forward on onUpdatesAvailable - updates stay queued
		// until the parent worker goes idle, then they're automatically injected

		// CRITICAL FIX: Start periodic check for idle orchestrators (every 10 minutes)
		// If all tasks in a plan are idle/completed and no task is running, wake up the orchestrator
		this._startOrchestratorIdleCheck();

		this._orchLog('OrchestratorService initialized');
	}

	/**
	 * Log orchestration debug messages with consistent format.
	 * All parent-child communication logs use [ORCH-DEBUG] prefix for easy filtering.
	 */
	private _orchLog(message: string, data?: Record<string, unknown>): void {
		const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
		this._logService.info(`[ORCH-DEBUG][Orchestrator] ${message}${dataStr}`);
	}

	/**
	 * CRITICAL FIX: Start periodic check for idle orchestrators.
	 * Every 10 minutes, check if any plan has all tasks idle/completed with no running tasks.
	 * If so, wake up the orchestrator worker to understand what's going on.
	 */
	private _startOrchestratorIdleCheck(): void {
		const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

		const intervalId = setInterval(() => {
			this._checkIdleOrchestrators();
		}, CHECK_INTERVAL_MS);

		// Register for cleanup on dispose
		this._register({
			dispose: () => {
				clearInterval(intervalId);
			}
		});

		this._orchLog('Started orchestrator idle check', { intervalMs: CHECK_INTERVAL_MS });
	}

	/**
	 * Check all plans for idle state (all tasks completed/idle, no active workers).
	 * Wake up any orchestrator workers that might be stuck waiting.
	 */
	private _checkIdleOrchestrators(): void {
		this._orchLog('Running periodic orchestrator idle check');

		for (const plan of this._plans) {
			// Only check active plans
			if (plan.status !== 'active') {
				continue;
			}

			const planTasks = this._tasks.filter(t => t.planId === plan.id);
			if (planTasks.length === 0) {
				continue;
			}

			// Check if all tasks are in terminal/idle state
			const hasRunningTask = planTasks.some(t => t.status === 'running' || t.status === 'queued');
			const allTasksSettled = planTasks.every(t =>
				t.status === 'completed' || t.status === 'failed' || t.status === 'blocked'
			);

			if (!hasRunningTask && allTasksSettled) {
				this._orchLog('DETECTED IDLE PLAN - All tasks settled but plan still active', {
					planId: plan.id,
					planName: plan.name,
					taskCount: planTasks.length,
					taskStatuses: planTasks.map(t => ({ id: t.id, status: t.status })),
				});

				// Find orchestrator worker for this plan (if any)
				const orchestratorWorker = Array.from(this._workers.values()).find(w => {
					const task = this._tasks.find(t => t.workerId === w.id);
					return task?.planId === plan.id;
				});

				if (orchestratorWorker) {
					this._orchLog('Waking up idle orchestrator worker', {
						planId: plan.id,
						workerId: orchestratorWorker.id,
					});

					// Wake up the orchestrator by sending a clarification
					const wakeUpMessage = `
## Orchestrator Wake-Up: Plan Status Check

**All tasks in your plan have reached a terminal state.** This is a periodic health check to ensure you're aware.

**Current Plan Status:**
- Plan: ${plan.name}
- Total Tasks: ${planTasks.length}
- Completed: ${planTasks.filter(t => t.status === 'completed').length}
- Failed: ${planTasks.filter(t => t.status === 'failed').length}
- Blocked: ${planTasks.filter(t => t.status === 'blocked').length}

**What to do next:**
1. Review the status of all tasks
2. If all work is complete, consider closing the plan
3. If there are remaining tasks, check why they're not executing
4. If subtasks completed but you weren't notified, check for pending updates

**This is an automatic health check that runs every 10 minutes when all tasks are idle/completed.**
`;

					orchestratorWorker.sendClarification(wakeUpMessage);

					this._orchLog('Sent wake-up clarification to orchestrator', {
						planId: plan.id,
						workerId: orchestratorWorker.id,
					});
				} else {
					this._orchLog('No orchestrator worker found for idle plan', {
						planId: plan.id,
					});
				}
			}
		}
	}

	/**
	 * Handle an unhealthy worker by notifying parent and firing orchestrator event.
	 * This enables proactive intervention when workers get stuck or enter loops.
	 */
	private _handleUnhealthyWorker(workerId: string, reason: 'stuck' | 'looping' | 'high_error_rate'): void {
		this._logService.warn(`[Orchestrator] Worker ${workerId} is unhealthy: ${reason}`);

		const worker = this._workers.get(workerId);
		if (!worker) {
			return;
		}

		// Fire orchestrator event so UI can show notification
		this._onOrchestratorEvent.fire({
			type: 'worker.unhealthy',
			workerId,
			reason,
		} as any); // Type as any since we're adding a new event type

		// Find the task for this worker
		const task = this._tasks.find(t => t.workerId === workerId);
		if (!task) {
			return;
		}

		// Get the worker's tool set to find its owner (parent)
		const toolSet = this._workerToolSets.get(workerId);
		const ownerContext = toolSet?.workerContext?.owner;

		// If this worker has a parent, notify them via the queue
		if (ownerContext && ownerContext.ownerType === 'worker') {
			const statusMessage = reason === 'stuck'
				? `⚠️ Sub-task worker ${workerId} appears to be stuck (no activity for 5+ minutes). Consider checking on it or cancelling.`
				: reason === 'looping'
					? `⚠️ Sub-task worker ${workerId} may be in a loop (calling same tool repeatedly). Consider providing guidance or cancelling.`
					: `⚠️ Sub-task worker ${workerId} has high error rate. Consider cancelling and retrying with different approach.`;

			// Get worktree path from worker or tool set
			const worktreePath = worker.worktreePath || toolSet?.worktreePath || '';

			this._queueService.enqueueMessage({
				id: `health-${workerId}-${Date.now()}`,
				type: 'error',
				workerId: ownerContext.ownerId,
				taskId: task.id,
				planId: task.planId || '',
				worktreePath,
				content: { error: statusMessage, isWarning: true },
				priority: 'high',
				timestamp: Date.now(),
			});

			this._logService.info(`[Orchestrator] Notified parent ${ownerContext.ownerId} about unhealthy worker ${workerId}`);
		}
	}

	/**
	 * Handle an idle worker. The behavior depends on whether this worker is a parent or child:
	 *
	 * 1. If worker has pending subtask updates (it's a parent waiting for children):
	 *    → Inject those updates, waking up the worker with info from its children
	 *
	 * 2. If worker is a CHILD (has a parent):
	 *    → Send "why are you idle?" inquiry to the child
	 *    → Queue notification for the parent that child went idle
	 *    → Child's response will also be queued for the parent
	 *
	 * 3. If worker is a top-level parent with no pending updates:
	 *    → It's just waiting for children, do nothing (normal state)
	 */
	private async _handleIdleWorker(workerId: string, _reason: WorkerIdleReason): Promise<void> {
		this._orchLog('Handling idle worker', { workerId, reason: _reason });

		const worker = this._workers.get(workerId);
		if (!worker) {
			this._orchLog('Worker not found for idle handling', { workerId });
			return;
		}

		// FIRST: Check if this worker has pending subtask updates (it's a parent)
		// If so, inject those updates - this wakes up the worker with useful info
		const hasPendingUpdates = this._taskMonitorService.hasPendingUpdates(workerId);
		this._orchLog('Checking pending updates for idle worker', { workerId, hasPendingUpdates });

		if (hasPendingUpdates) {
			this._orchLog('Worker has pending updates - will inject instead of sending inquiry', { workerId });
			this._injectPendingSubtaskUpdates(workerId, worker);
			return; // Don't send idle inquiry - we just gave it work to do
		}

		// Get the worker's tool set to check if it has a parent
		const toolSet = this._workerToolSets.get(workerId);
		const ownerContext = toolSet?.workerContext?.owner;
		const isChildWorker = ownerContext && ownerContext.ownerType === 'worker';
		const parentWorkerId = isChildWorker ? ownerContext.ownerId : undefined;

		this._orchLog('Checking worker parent context', {
			workerId,
			hasToolSet: !!toolSet,
			hasOwnerContext: !!ownerContext,
			ownerType: ownerContext?.ownerType ?? null,
			ownerId: ownerContext?.ownerId ?? null,
			isChildWorker,
		});

		// Send idle inquiry to ALL workers that go idle (both top-level and child workers)
		// - For child workers: response is queued for parent
		// - For top-level workers: helps them realize they need to complete or continue
		this._orchLog('Worker went idle - will send inquiry', { workerId, parentWorkerId: parentWorkerId ?? '(top-level)' });

		// Don't send inquiry if one is already pending
		const inquiryPending = this._healthMonitor.hasIdleInquiryPending(workerId);
		if (inquiryPending) {
			this._orchLog('Idle inquiry already pending, skipping', { workerId });
			return;
		}

		// Mark inquiry as sent to prevent duplicates
		this._healthMonitor.markIdleInquirySent(workerId);
		this._orchLog('Marked idle inquiry sent', { workerId });

		// Fire orchestrator event so UI can show notification
		this._onOrchestratorEvent.fire({
			type: 'worker.idle',
			workerId,
		});

		// Find the task for this worker
		const task = this._tasks.find(t => t.workerId === workerId);
		if (!task) {
			return;
		}

		// Build different inquiry messages for child vs top-level workers
		const inquiryMessage = isChildWorker
			? `
## Status Check

You appear to be idle (no recent activity). Please respond with your current status.

### If you have COMPLETED your task:
**You MUST call the \`a2a_subtask_complete\` tool** with your final results. This is required to notify your parent that you're done. Without calling this tool, your parent won't know you've finished.

### If you are BLOCKED or cannot proceed:
Tell us what's preventing you from moving forward:
- **Permissions needed?** (e.g., need approval to run a command, access a file)
- **Missing information?** (e.g., need clarification, waiting for input)
- **Technical blocker?** (e.g., error you can't resolve, dependency issue)
- **Other reason?**

We will handle blockers on your behalf - just describe what you need.

### If you are still WORKING:
Briefly describe what you're currently processing and we'll check back later.

**IMPORTANT:** Wrap your response in delimiters like this:

<update_parent_start>
Your status update here...
<update_parent_end>

**After you finish writing <update_parent_end>, continue working on your task immediately. Do not wait for further instructions.**

**Please respond now** - your parent task is waiting for your status update.
`
			: `
## Status Check

You appear to be idle (no recent activity). Please respond with your current status.

### If you have COMPLETED your task:
**You MUST:**
1. **Commit your changes** using git (if you haven't already)
2. **Call \`orchestrator_completeTask\`** with taskId="${task.id}" to signal completion

### If you are BLOCKED or cannot proceed:
Tell us what's preventing you from moving forward:
- **Permissions needed?** (e.g., need approval to run a command, access a file)
- **Missing information?** (e.g., need clarification, waiting for input)
- **Technical blocker?** (e.g., error you can't resolve, dependency issue)
- **Other reason?**

### If you are still WORKING:
Briefly describe what you're currently processing and we'll check back later.

**Please respond now.**
`;

		// Send the inquiry to the worker
		this._orchLog('Sending idle inquiry to worker', { workerId, parentWorkerId: parentWorkerId ?? '(top-level)', taskId: task.id });

		if (isChildWorker && parentWorkerId) {
			// Child worker: use shared inquiry method (handles interrupt + capture + queue to parent)
			await this._sendInquiryAndCaptureResponse(worker, workerId, task, parentWorkerId, inquiryMessage, 'idle');
		} else {
			// Top-level worker: just send the inquiry directly (no parent to notify)
			worker.sendClarification(inquiryMessage);
		}
	}

	/**
	 * Handle a worker error by queueing an error update for its parent.
	 * This enables immediate error propagation without waiting for retry exhaustion.
	 * Only queues updates for child workers (those spawned by a parent worker).
	 */
	private _handleWorkerError(workerId: string, error: string): void {
		this._orchLog('Handling worker error', { workerId, error });

		const worker = this._workers.get(workerId);
		if (!worker) {
			this._orchLog('Worker not found for error handling', { workerId });
			return;
		}

		// Find the task for this worker
		const task = this._tasks.find(t => t.workerId === workerId);
		if (!task) {
			this._orchLog('Task not found for error handling', { workerId });
			return;
		}

		// Check if this worker has a parent worker (vs orchestrator-deployed)
		const toolSet = this._workerToolSets.get(workerId);
		const ownerContext = toolSet?.workerContext?.owner;
		const isChildWorker = ownerContext && ownerContext.ownerType === 'worker';
		const parentWorkerId = isChildWorker ? ownerContext.ownerId : undefined;

		this._orchLog('Checking worker parent context for error handling', {
			workerId,
			hasToolSet: !!toolSet,
			hasOwnerContext: !!ownerContext,
			ownerType: ownerContext?.ownerType ?? null,
			ownerId: ownerContext?.ownerId ?? null,
			isChildWorker,
		});

		// Only queue error updates for child workers (those with a parent)
		// Orchestrator-deployed workers don't have a parent to notify via TaskMonitorService
		if (!isChildWorker || !parentWorkerId) {
			this._orchLog('Worker is not a child worker, skipping error update queue', { workerId });
			return;
		}

		// Queue error update for parent via TaskMonitorService
		this._orchLog('Queueing error update for parent', {
			workerId,
			parentWorkerId,
			taskId: task.id,
			error,
		});

		this._taskMonitorService.queueUpdate({
			type: 'error',
			subTaskId: task.id,
			parentWorkerId,
			error,
			timestamp: Date.now(),
		});
	}

	/**
	 * Handle periodic progress check for a worker.
	 * Every 5 minutes, asks the worker for a progress report.
	 * - For child workers (spawned by another worker): queues response for parent
	 * - For orchestrator-deployed workers: sends inquiry directly (no parent to notify)
	 */
	private async _handleProgressCheck(workerId: string): Promise<void> {
		this._orchLog('Handling progress check', { workerId });

		const worker = this._workers.get(workerId);
		if (!worker) {
			this._orchLog('Worker not found for progress check', { workerId });
			return;
		}

		// Mark that we're sending a progress check
		this._healthMonitor.markProgressCheckSent(workerId);

		// Check if this worker has a parent worker (vs orchestrator)
		const toolSet = this._workerToolSets.get(workerId);
		const ownerContext = toolSet?.workerContext?.owner;
		const isChildWorker = ownerContext && ownerContext.ownerType === 'worker';
		const parentWorkerId = isChildWorker ? ownerContext.ownerId : undefined;

		this._orchLog('Checking worker parent context for progress check', {
			workerId,
			hasToolSet: !!toolSet,
			hasOwnerContext: !!ownerContext,
			ownerType: ownerContext?.ownerType ?? null,
			ownerId: ownerContext?.ownerId ?? null,
			isChildWorker,
		});

		// Get the task for context
		const task = this._tasks.find(t => t.workerId === workerId);
		if (!task) {
			this._orchLog('Task not found for progress check', { workerId });
			return;
		}

		// Build different progress messages for child vs orchestrator-deployed workers
		const progressMessage = isChildWorker
			? `
## Progress Check (Periodic)

This is a scheduled progress check. Please provide a brief status update:

1. **What have you completed so far?** (List the main accomplishments)

2. **What are you currently working on?** (Current task or step)

3. **What remains to be done?** (Remaining tasks or next steps)

4. **Any blockers or issues?** (Anything preventing progress)

**IMPORTANT:** Wrap your response in delimiters like this:

<update_parent_start>
Your status update here...
<update_parent_end>

**After you finish writing <update_parent_end>, continue working on your task immediately. Do not wait for further instructions.**

**Reminder:** When you have fully completed your task, you MUST call \`a2a_subtask_complete\` to notify your parent.
`
			: `
## Progress Check (Periodic)

This is a scheduled progress check. Please provide a brief status update:

1. **What have you completed so far?** (List the main accomplishments)

2. **What are you currently working on?** (Current task or step)

3. **What remains to be done?** (Remaining tasks or next steps)

4. **Any blockers or issues?** (Anything preventing progress)

**Reminder:** When you have fully completed your task, you MUST:
1. **Commit your changes** using git
2. **Call \`orchestrator_completeTask\`** with taskId="${task.id}"
`;

		// Send the progress inquiry
		this._orchLog('Sending progress inquiry to worker', { workerId, parentWorkerId: parentWorkerId ?? '(orchestrator-deployed)', taskId: task.id });

		if (isChildWorker && parentWorkerId) {
			// Child worker: use shared inquiry method (handles interrupt + capture + queue to parent)
			await this._sendInquiryAndCaptureResponse(worker, workerId, task, parentWorkerId, progressMessage, 'progress');
		} else {
			// Dashboard-deployed worker (no parent): interrupt and show in UI
			await worker.interrupt();
			this._sendProgressInquiryAndShowInUI(worker, workerId, task, progressMessage);
		}
	}

	/**
	 * Unified method to send an inquiry to a child worker and capture its response.
	 * Handles both progress checks and idle inquiries with the same flow:
	 * 1. Interrupt worker and wait for old stream to end (prevents capturing dying stream)
	 * 2. Set up listeners for new response with delimiter detection
	 * 3. Send clarification message
	 * 4. Capture response between delimiters and queue update for parent
	 */
	private async _sendInquiryAndCaptureResponse(
		worker: WorkerSession,
		childWorkerId: string,
		task: WorkerTask,
		parentWorkerId: string,
		message: string,
		inquiryType: 'progress' | 'idle'
	): Promise<void> {
		this._orchLog(`Setting up ${inquiryType} inquiry response capture`, { childWorkerId, parentWorkerId, taskId: task.id });

		// CRITICAL: Interrupt and wait for old stream to end BEFORE setting up listeners.
		// Without this, listeners capture the dying stream from interrupt, not the real response.
		await worker.interrupt();
		this._orchLog(`Interrupt complete for ${inquiryType} inquiry`, { childWorkerId });

		// Clean up any existing inquiry listeners for this worker
		this._cleanupInquiryListeners(childWorkerId);

		const responseTimeout = 120000; // 2 minutes - allow time for worker to think and respond
		let responded = false;
		let responseContent = '';
		let captureStarted = false;
		const startDelimiter = '<update_parent_start>';
		const endDelimiter = '<update_parent_end>';

		const cleanup = () => {
			streamPartDisposable.dispose();
			streamEndDisposable.dispose();
			this._activeInquiryListeners.delete(childWorkerId);
		};

		const queueUpdateToParent = () => {
			// Extract content between delimiters
			const startIndex = responseContent.indexOf(startDelimiter);
			const endIndex = responseContent.indexOf(endDelimiter);

			let extractedResponse = '';
			if (startIndex !== -1 && endIndex !== -1) {
				// Extract content between delimiters, excluding the delimiters themselves
				extractedResponse = responseContent.substring(startIndex + startDelimiter.length, endIndex).trim();
			} else if (captureStarted) {
				// Delimiter started but not ended - use what we have
				extractedResponse = responseContent.substring(responseContent.indexOf(startDelimiter) + startDelimiter.length).trim();
			} else {
				// No delimiters found - use full content (fallback for old behavior)
				extractedResponse = responseContent.trim();
			}

			this._orchLog(`Child responded to ${inquiryType} inquiry`, {
				childWorkerId,
				parentWorkerId,
				taskId: task.id,
				responseLength: extractedResponse.length,
				hadDelimiters: startIndex !== -1 && endIndex !== -1,
			});

			// Queue the appropriate update type for parent
			if (inquiryType === 'progress') {
				this._taskMonitorService.queueUpdate({
					type: 'progress',
					subTaskId: task.id,
					parentWorkerId,
					progressReport: extractedResponse || 'Worker provided no progress details.',
					timestamp: Date.now(),
				});
			} else {
				this._taskMonitorService.queueUpdate({
					type: 'idle_response',
					subTaskId: task.id,
					parentWorkerId,
					idleReason: extractedResponse
						? `Child went idle and responded: ${extractedResponse}`
						: 'Child went idle. Response was empty or non-text.',
					timestamp: Date.now(),
				});
			}

			this._orchLog(`*** ${inquiryType.toUpperCase()} UPDATE QUEUED FOR PARENT ***`, {
				childWorkerId,
				parentWorkerId,
				taskId: task.id,
				responsePreview: extractedResponse?.substring(0, 100) ?? '(empty)',
			});

			// Immediately deliver the update to parent (don't wait for parent to go idle)
			this._deliverUpdatesToParent(parentWorkerId).catch(err => {
				this._logService.error(`[Orchestrator] Error delivering update to parent ${parentWorkerId}: ${err}`);
			});
		};

		// Listen for streaming parts to capture the response
		const streamPartDisposable = worker.onStreamPart((part) => {
			if (responded || part.type !== 'markdown' || !part.content) {
				return;
			}

			const content = typeof part.content === 'string' ? part.content : part.content.value;
			if (!content) {
				return;
			}

			responseContent += content;

			// Check if we've received the start delimiter
			if (!captureStarted && responseContent.includes(startDelimiter)) {
				captureStarted = true;
				this._orchLog(`Delimiter start detected for ${inquiryType} inquiry`, { childWorkerId });
			}

			// Check if we've received the end delimiter
			if (captureStarted && responseContent.includes(endDelimiter)) {
				this._orchLog(`Delimiter end detected for ${inquiryType} inquiry - capturing response`, { childWorkerId });
				responded = true;
				cleanup();
				queueUpdateToParent();
			}
		});

		// Listen for stream end as fallback (in case delimiters aren't used or worker finishes)
		const streamEndDisposable = worker.onStreamEnd(() => {
			if (responded) {
				return;
			}
			responded = true;
			cleanup();

			this._orchLog(`Stream ended for ${inquiryType} inquiry (fallback capture)`, { childWorkerId, hadStartDelimiter: captureStarted });
			queueUpdateToParent();
		});

		// Track listeners for cleanup
		this._activeInquiryListeners.set(childWorkerId, { dispose: cleanup });

		// Set up timeout
		setTimeout(() => {
			if (!responded) {
				responded = true;
				cleanup();

				this._orchLog(`Child did not respond to ${inquiryType} inquiry (timeout)`, {
					childWorkerId,
					parentWorkerId,
					taskId: task.id,
					timeoutMs: responseTimeout,
					hadPartialResponse: responseContent.length > 0,
				});

				// Queue timeout notification
				if (inquiryType === 'progress') {
					this._taskMonitorService.queueUpdate({
						type: 'progress',
						subTaskId: task.id,
						parentWorkerId,
						progressReport: `Child worker did not respond to progress check within ${responseTimeout / 1000}s.`,
						timestamp: Date.now(),
					});
				} else {
					this._taskMonitorService.queueUpdate({
						type: 'idle',
						subTaskId: task.id,
						parentWorkerId,
						idleReason: `Child went idle. Inquiry sent but no response within ${responseTimeout / 1000}s.`,
						timestamp: Date.now(),
					});
				}

				// Deliver timeout notification to parent immediately
				this._deliverUpdatesToParent(parentWorkerId).catch(err => {
					this._logService.error(`[Orchestrator] Error delivering timeout update to parent ${parentWorkerId}: ${err}`);
				});
			}
		}, responseTimeout);

		// Send the clarification message to trigger the response
		this._orchLog(`Sending ${inquiryType} clarification to child`, { childWorkerId });
		worker.sendClarification(message);
	}

	/**
	 * Send progress inquiry to an orchestrator-deployed worker and display the response in the UI.
	 * For orchestrator-deployed workers, there's no parent worker - we show the progress
	 * directly in the worker's chat stream (if the session is open) and add to the inbox.
	 */
	private _sendProgressInquiryAndShowInUI(
		worker: WorkerSession,
		workerId: string,
		task: WorkerTask,
		progressMessage: string
	): void {
		this._orchLog('Setting up progress inquiry for orchestrator-deployed worker', { workerId, taskId: task.id });

		// Set up a listener to capture the worker's response
		const responseTimeout = 60000; // 60 second timeout for response
		let responded = false;
		let responseContent = '';

		// Listen for streaming parts to capture the response
		const streamPartDisposable = worker.onStreamPart((part) => {
			if (!responded && part.type === 'markdown' && part.content) {
				const content = typeof part.content === 'string' ? part.content : part.content.value;
				if (content) {
					responseContent += content;
				}
			}
		});

		// Listen for stream end to display the progress update
		const streamEndDisposable = worker.onStreamEnd(() => {
			if (responded) {
				return;
			}
			responded = true;
			streamPartDisposable.dispose();
			streamEndDisposable.dispose();

			// Truncate response if too long
			const maxResponseLength = 2000;
			const truncatedResponse = responseContent;

			this._orchLog('Orchestrator-deployed worker responded to progress inquiry', {
				workerId,
				taskId: task.id,
				responseLength: responseContent.length,
				wasTruncated: responseContent.length > maxResponseLength,
			});

			// Try to show in the worker's chat stream (if the session is open)
			const stream = this._subtaskProgressService.getStream(workerId);
			if (stream) {
				const progressUpdate = `📊 **Progress Update** (${task.id}):\n${truncatedResponse || 'Worker provided no progress details.'}`;
				stream.progress(progressUpdate);
				this._orchLog('Displayed progress in chat stream', { workerId, taskId: task.id });
			} else {
				this._orchLog('No chat stream available for worker - progress not displayed', { workerId, taskId: task.id });
			}

			// Also add to inbox as an informational item (non-action required)
			// This ensures the progress is visible even if the chat session isn't open
			this._inbox.addItem({
				id: generateUuid(),
				message: {
					id: generateUuid(),
					timestamp: Date.now(),
					priority: 'low',
					planId: task.planId || '',
					taskId: task.id,
					workerId: workerId,
					worktreePath: worker.worktreePath,
					type: 'status_update',
					content: {
						type: 'progress_response',
						response: truncatedResponse || 'Worker provided no progress details.',
					}
				},
				status: 'processed', // Mark as processed since it's informational
				requiresUserAction: false,
				createdAt: Date.now()
			});
			this._onDidChangeWorkers.fire(); // Trigger UI refresh for inbox
		});

		// Set up timeout
		setTimeout(() => {
			if (!responded) {
				responded = true;
				streamPartDisposable.dispose();
				streamEndDisposable.dispose();

				this._orchLog('Orchestrator-deployed worker did not respond to progress inquiry (timeout)', {
					workerId,
					taskId: task.id,
					timeoutMs: responseTimeout,
				});

				// Show timeout in stream if available
				const stream = this._subtaskProgressService.getStream(workerId);
				if (stream) {
					stream.progress(`⏱️ **Progress Check Timeout** (${task.id}): Worker did not respond within ${responseTimeout / 1000}s.`);
				}
			}
		}, responseTimeout);

		// Send the clarification message to trigger the response
		this._orchLog('Sending progress inquiry to orchestrator-deployed worker', { workerId });
		worker.sendClarification(progressMessage);
	}

	/**
	 * Clean up any active inquiry listeners for a worker.
	 * Called before setting up new listeners to prevent race conditions where
	 * old listeners might capture responses meant for new inquiries.
	 */
	private _cleanupInquiryListeners(workerId: string): void {
		const existing = this._activeInquiryListeners.get(workerId);
		if (existing) {
			this._orchLog('Cleaning up existing inquiry listeners', { workerId });
			existing.dispose();
			this._activeInquiryListeners.delete(workerId);
		}
	}

	/**
	 * Deliver queued updates to a parent worker immediately.
	 * Supports both managed workers (in _workers map) and standalone sessions (claude-standalone-*).
	 * For managed workers: interrupts and injects via sendClarification.
	 * For standalone: uses registered handler callback.
	 */
	private async _deliverUpdatesToParent(parentWorkerId: string): Promise<void> {
		this._orchLog('Delivering updates to parent immediately', { parentWorkerId });

		// Check if there are actually updates to deliver
		if (!this._taskMonitorService.hasPendingUpdates(parentWorkerId)) {
			this._orchLog('No pending updates to deliver', { parentWorkerId });
			return;
		}

		// Try managed worker first
		const parentWorker = this._workers.get(parentWorkerId);
		if (parentWorker) {
			// Managed worker: interrupt and inject
			await parentWorker.interrupt();
			this._orchLog('Parent worker interrupted, delivering updates', { parentWorkerId });
			this._injectPendingSubtaskUpdates(parentWorkerId, parentWorker);
			return;
		}

		// Try standalone parent handler
		const standaloneHandler = this._standaloneParentHandlers.get(parentWorkerId);
		if (standaloneHandler) {
			this._orchLog('Delivering to standalone parent via handler', { parentWorkerId });
			// Consume updates and format as message
			const updates = this._taskMonitorService.consumeUpdates(parentWorkerId);
			if (updates.length > 0) {
				const message = this._formatUpdatesAsMessage(updates);
				this._orchLog('*** STANDALONE PARENT RECEIVING UPDATES ***', {
					parentWorkerId,
					updateCount: updates.length,
					messageLength: message.length,
				});
				standaloneHandler(message);
			}
			return;
		}

		// No handler available - updates remain queued for polling via a2a_get_subtask_updates
		this._orchLog('No handler for parent - updates queued for polling', {
			parentWorkerId,
			isStandaloneSession: parentWorkerId.startsWith('claude-standalone-'),
		});
	}

	/**
	 * Format task updates as a message string for delivery.
	 */
	private _formatUpdatesAsMessage(updates: ITaskUpdate[]): string {
		const updateMessages: string[] = [];
		for (const update of updates) {
			switch (update.type) {
				case 'completed':
					updateMessages.push(
						`✅ **Subtask Completed** (\`${update.subTaskId}\`)\n` +
						(update.result?.output ? `Output: ${update.result.output.slice(0, 500)}${update.result.output.length > 500 ? '...' : ''}` : 'No output')
					);
					break;
				case 'failed':
					updateMessages.push(
						`❌ **Subtask Failed** (\`${update.subTaskId}\`)\n` +
						`Error: ${update.error || update.result?.error || 'Unknown error'}`
					);
					break;
				case 'idle':
				case 'idle_response':
					updateMessages.push(
						`⏸️ **Subtask Idle** (\`${update.subTaskId}\`)\n` +
						`Reason: ${update.idleReason || 'No activity'}`
					);
					break;
				case 'progress':
					if (update.progressReport) {
						updateMessages.push(
							`📊 **Subtask Progress Report** (\`${update.subTaskId}\`)\n\n` +
							update.progressReport
						);
					} else if (update.progress !== undefined) {
						updateMessages.push(
							`📊 **Subtask Progress** (\`${update.subTaskId}\`): ${update.progress}%`
						);
					}
					break;
				case 'error':
					updateMessages.push(
						`⚠️ **Subtask Error** (\`${update.subTaskId}\`)\n` +
						`Error: ${update.error || 'Unknown error'}`
					);
					break;
			}
		}

		return `## Subtask Updates\n\n${updates.length} update${updates.length > 1 ? 's' : ''} from your spawned subtasks:\n\n${updateMessages.join('\n\n')}`;
	}

	/**
	 * Inject pending subtask updates into an idle worker.
	 * Called when a parent worker goes idle and has updates from its children.
	 */
	private _injectPendingSubtaskUpdates(workerId: string, worker: WorkerSession): void {
		this._orchLog('Consuming updates for parent worker', { parentWorkerId: workerId });

		const updates = this._taskMonitorService.consumeUpdates(workerId);
		if (updates.length === 0) {
			this._orchLog('No updates to inject', { parentWorkerId: workerId });
			return;
		}

		// LOG: Parent is receiving updates from children!
		this._orchLog('*** PARENT RECEIVING UPDATES FROM CHILDREN ***', {
			parentWorkerId: workerId,
			updateCount: updates.length,
			updateTypes: updates.map(u => u.type),
			subTaskIds: updates.map(u => u.subTaskId),
			progressReports: updates.filter(u => u.type === 'progress').map(u => u.progressReport?.substring(0, 50)),
		});

		// Build a summary message with all updates
		const updateMessages: string[] = [];
		for (const update of updates) {
			switch (update.type) {
				case 'completed':
					updateMessages.push(
						`✅ **Subtask Completed** (\`${update.subTaskId}\`)\n` +
						(update.result?.output ? `Output: ${update.result.output.slice(0, 500)}${update.result.output.length > 500 ? '...' : ''}` : 'No output')
					);
					break;
				case 'failed':
					updateMessages.push(
						`❌ **Subtask Failed** (\`${update.subTaskId}\`)\n` +
						`Error: ${update.error || update.result?.error || 'Unknown error'}`
					);
					break;
				case 'idle':
				case 'idle_response':
					updateMessages.push(
						`⏸️ **Subtask Idle** (\`${update.subTaskId}\`)\n` +
						`Reason: ${update.idleReason || 'No activity'}`
					);
					break;
				case 'progress':
					if (update.progressReport) {
						// Progress report from periodic check
						updateMessages.push(
							`📊 **Subtask Progress Report** (\`${update.subTaskId}\`)\n\n` +
							update.progressReport
						);
					} else if (update.progress !== undefined) {
						// Progress percentage
						updateMessages.push(
							`📊 **Subtask Progress** (\`${update.subTaskId}\`): ${update.progress}%`
						);
					}
					break;
				case 'error':
					updateMessages.push(
						`⚠️ **Subtask Error** (\`${update.subTaskId}\`)\n` +
						`Error: ${update.error || 'Unknown error'}`
					);
					break;
			}
		}

		const summaryMessage = `
## Subtask Updates Available

${updates.length} update${updates.length > 1 ? 's' : ''} from your spawned subtasks:

${updateMessages.join('\n\n')}

---
Process these updates and continue your work. If subtasks completed successfully, review their output and proceed with next steps. If subtasks failed, consider retrying or adjusting your approach.
`;

		// Inject via sendClarification - this wakes up the worker
		this._orchLog('Sending clarification with updates to parent', { parentWorkerId: workerId, messageLength: summaryMessage.length });
		worker.sendClarification(summaryMessage);
		this._orchLog('Successfully injected subtask updates into parent', { parentWorkerId: workerId, updateCount: updates.length });
	}

	// --- Queue Handling ---

	private async _handleQueueMessage(message: IOrchestratorQueueMessage): Promise<void> {
		const task = this._tasks.find(t => t.id === message.taskId);
		if (!task) {
			return;
		}

		switch (message.type) {
			case 'completion':
				task.status = 'completed';
				task.completedAt = Date.now();
				this._onOrchestratorEvent.fire({
					type: 'task.completed',
					planId: task.planId,
					taskId: task.id,
					workerId: message.workerId,
					sessionUri: (message.content as any)?.sessionUri,
				});

				// Trigger deployment of dependent tasks
				if (task.planId) {
					this._deployReadyTasks(task.planId).catch((err: Error) => {
						console.error('Failed to deploy ready tasks:', err);
					});
				}
				this._saveState();
				break;

			case 'error':
				// IMMEDIATELY notify orchestrator of failure - don't wait for other tasks
				this._notifyOrchestratorOfWorkerFailure(message, String(message.content));

				// If LLM event handling is enabled, let the LLM decide what to do
				if (this._enableLLMEventHandling) {
					try {
						const decision = await this._handleWithLLM(message);
						await this._applyLLMDecision(message, decision);
						// Only mark as failed if LLM didn't decide to retry
						if (decision.action !== 'retry') {
							task.status = 'failed';
							task.error = String(message.content);
							this._onOrchestratorEvent.fire({
								type: 'task.failed',
								planId: task.planId,
								taskId: task.id,
								error: String(message.content),
							});
							if (task.planId) {
								this._checkBlockedTasks(task.planId);
								this._checkPlanCompletion(task.planId);
							}
							this._saveState();
						}
						break;
					} catch (error) {
						this._logService.error('[Orchestrator] LLM handling failed for error, falling back:', error);
						// Fall through to default handling
					}
				}

				// Default handling: mark as failed
				task.status = 'failed';
				task.error = String(message.content);
				this._onOrchestratorEvent.fire({
					type: 'task.failed',
					planId: task.planId,
					taskId: task.id,
					error: String(message.content),
				});

				// Check for blocked tasks and plan failure
				if (task.planId) {
					this._checkBlockedTasks(task.planId);
					this._checkPlanCompletion(task.planId);
				}
				this._saveState();
				break;

			case 'status_update':
				if (message.content === 'idle') {
					this._onOrchestratorEvent.fire({ type: 'worker.idle', workerId: message.workerId });
					// NOTE: Removed old coupling that called _notifyOrchestratorOfWorkerCompletion here.
					// Idle workers are now handled by WorkerHealthMonitor.onWorkerIdle -> _handleIdleWorker
					// which either injects pending updates or sends an idle inquiry to child workers.
					// Completion is ONLY triggered via explicit a2a_subtask_complete tool call.
				}
				break;

			case 'question': {
				// If LLM event handling is enabled, use the LLM to answer the question
				if (this._enableLLMEventHandling) {
					try {
						const llmDecision = await this._handleWithLLM(message);
						await this._applyLLMDecision(message, llmDecision);
						break;
					} catch (error) {
						this._logService.error('[Orchestrator] LLM handling failed for question, falling back:', error);
						// Fall through to default handling
					}
				}

				// Default handling: check permissions and add to inbox
				const decision = this._permissionService.evaluatePermission('ask_question', message.content as any);
				if (decision === 'auto_approve') {
					this._autoRespond(message, true);
				} else if (decision === 'auto_deny') {
					this._autoRespond(message, false);
				} else {
					this._inbox.addItem({
						id: generateUuid(),
						message,
						status: 'pending',
						requiresUserAction: true,
						createdAt: Date.now()
					});
					vscode.window.showInformationMessage(`Orchestrator: New request from ${message.workerId}`);
				}
				break;
			}

			case 'permission_request': {
				if (this._isStructuredPermissionRequest(message.content)) {
					await this._handlePermissionRequest(message);
					break;
				}
				// Legacy/simple permission payload
				const action = (message.content as any).permission || 'unknown';
				const decision = this._permissionService.evaluatePermission(action, message.content as any);
				if (decision === 'auto_approve') {
					this._autoRespond(message, true);
				} else if (decision === 'auto_deny') {
					this._autoRespond(message, false);
				} else {
					this._inbox.addItem({
						id: generateUuid(),
						message,
						status: 'pending',
						requiresUserAction: true,
						createdAt: Date.now()
					});
					vscode.window.showInformationMessage(`Orchestrator: New request from ${message.workerId}`);
				}
				break;
			}

			case 'approval_request': {
				// If LLM event handling is enabled and no parent handler, use LLM
				if (this._enableLLMEventHandling && message.owner?.ownerType !== 'worker') {
					try {
						const llmDecision = await this._handleWithLLM(message);
						await this._applyLLMDecision(message, llmDecision);
						break;
					} catch (error) {
						this._logService.error('[Orchestrator] LLM handling failed for approval, falling back:', error);
						// Fall through to default handling
					}
				}

				// Default handling: route to parent or add to inbox
				await this._handleApprovalRequest(message);
				break;
			}
		}
	}

	/**
	 * Handle an approval request from a subtask/worker.
	 * Approvals bubble up through the parent chain until reaching the orchestrator or user.
	 */
	private async _handleApprovalRequest(message: IOrchestratorQueueMessage): Promise<void> {
		const content = message.content as {
			approvalId: string;
			action: string;
			description: string;
			parameters?: Record<string, unknown>;
		};

		this._logService.info(`[Orchestrator] Approval request from worker ${message.workerId}: ${content.action} - ${content.description}`);

		// If message came from a subtask with a parent owner, route to parent first
		if (message.owner?.ownerType === 'worker') {
			const parentWorkerId = message.owner.ownerId;
			const parentWorker = this._workers.get(parentWorkerId);

			if (parentWorker) {
				// Create a pending approval on the parent worker
				this._logService.info(`[Orchestrator] Routing approval request to parent worker ${parentWorkerId}`);

				// The parent worker receives the approval request
				// Add to parent's pending approvals
				const approval = await parentWorker.requestApproval(
					content.action,
					content.approvalId,
					`[Subtask ${message.workerId}] ${content.description}`,
					content.parameters || {}
				);

				// Send response back to the requesting worker
				this._queueService.enqueueMessage({
					id: generateUuid(),
					timestamp: Date.now(),
					priority: 'high',
					planId: message.planId,
					taskId: message.taskId,
					workerId: message.workerId,
					worktreePath: message.worktreePath,
					type: 'approval_response',
					content: {
						approvalId: content.approvalId,
						approved: approval.approved,
						clarification: approval.clarification,
					}
				});
				return;
			}
		}

		// No parent or parent not found - handle at orchestrator level
		// Add to inbox for user decision
		this._inbox.addItem({
			id: generateUuid(),
			message,
			status: 'pending',
			requiresUserAction: true,
			createdAt: Date.now()
		});
		vscode.window.showInformationMessage(`Orchestrator: Approval request from ${message.workerId}: ${content.action}`);
	}

	private _isStructuredPermissionRequest(content: unknown): content is IPermissionRequest {
		if (!content || typeof content !== 'object') {
			return false;
		}
		const candidate = content as Partial<IPermissionRequest>;
		return typeof candidate.action === 'string'
			&& typeof candidate.requesterId === 'string'
			&& (candidate.requesterType === 'worker' || candidate.requesterType === 'subtask');
	}

	private _autoRespond(message: IOrchestratorQueueMessage, approved: boolean): void {
		const worker = this._workers.get(message.workerId);
		if (worker) {
			if (message.type === 'permission_request') {
				const approvalId = (message.content as any).id;
				if (approvalId) {
					worker.handleApproval(approvalId, approved);
				}
			} else if (message.type === 'question') {
				// For questions, auto-response might be generic or context-aware
				// For now, just acknowledge
				worker.addAssistantMessage(`[System: Auto-response] ${approved ? 'Approved' : 'Denied'}`);
			}
		}
	}

	// --- Event-Driven Orchestration ---

	/**
	 * Enable or disable LLM-based event handling.
	 * When enabled, certain events (questions, errors, approval requests) will be
	 * handled by invoking the orchestrator LLM for intelligent decision-making.
	 */
	setLLMEventHandling(enabled: boolean): void {
		this._enableLLMEventHandling = enabled;
		this._logService.info(`[Orchestrator] LLM event handling ${enabled ? 'enabled' : 'disabled'}`);
	}

	/**
	 * Check if LLM event handling is enabled.
	 */
	isLLMEventHandlingEnabled(): boolean {
		return this._enableLLMEventHandling;
	}

	/**
	 * Handle a message using LLM-based decision making.
	 * This is called when a message requires intelligent handling and LLM event handling is enabled.
	 */
	private async _handleWithLLM(message: IOrchestratorQueueMessage): Promise<IOrchestratorDecision> {
		const invokeAgent = async (prompt: string): Promise<string> => {
			return this._invokeOrchestratorLLM(prompt);
		};

		return this._eventDrivenOrchestrator.handleWithLLM(message, invokeAgent);
	}

	/**
	 * Invoke the orchestrator LLM with a prompt and return the response.
	 * This creates a headless agent invocation without a chat UI.
	 */
	private async _invokeOrchestratorLLM(prompt: string): Promise<string> {
		// Get the default model for orchestrator
		const model = await this._getOrchestratorModel();
		if (!model) {
			throw new Error('No model available for orchestrator LLM invocation');
		}

		// Create a collector stream to capture the response
		const collectedResponse: string[] = [];
		const collectorStream = this._createCollectorStream(collectedResponse);

		// Create a cancellation token
		const tokenSource = new vscode.CancellationTokenSource();

		try {
			const result = await this._agentRunner.run(
				{
					prompt,
					model,
					token: tokenSource.token,
					maxToolCallIterations: 10, // Limited for orchestrator decisions
				},
				collectorStream
			);

			if (!result.success) {
				throw new Error(result.error || 'LLM invocation failed');
			}

			return result.response || collectedResponse.join('');
		} finally {
			tokenSource.dispose();
		}
	}

	/**
	 * Get the model for orchestrator LLM invocations.
	 * Uses the backend selection service to get the appropriate model.
	 */
	private async _getOrchestratorModel(): Promise<vscode.LanguageModelChat | undefined> {
		try {
			// Use the backend selection service to get the current model
			const models = await vscode.lm.selectChatModels({ family: 'gpt-4' });
			if (models.length > 0) {
				return models[0];
			}
			// Fallback to any available model
			const allModels = await vscode.lm.selectChatModels({});
			return allModels[0];
		} catch (error) {
			this._logService.error('[Orchestrator] Failed to get model for LLM invocation:', error);
			return undefined;
		}
	}

	/**
	 * Create a collector stream that captures output without displaying it.
	 */
	private _createCollectorStream(collected: string[]): vscode.ChatResponseStream {
		return {
			markdown: (value: string | vscode.MarkdownString) => {
				const text = typeof value === 'string' ? value : value.value;
				collected.push(text);
			},
			anchor: () => { },
			button: () => { },
			filetree: () => { },
			progress: () => { },
			reference: () => { },
			push: () => { },
			confirmation: () => { },
			warning: () => { },
			textEdit: () => { },
			codeblockUri: () => { },
			detectedParticipant: () => { },
		} as unknown as vscode.ChatResponseStream;
	}

	/**
	 * Apply the decision from LLM-based event handling.
	 */
	private async _applyLLMDecision(message: IOrchestratorQueueMessage, decision: IOrchestratorDecision): Promise<void> {
		const worker = this._workers.get(message.workerId);
		const task = this._tasks.find(t => t.id === message.taskId);

		this._logService.info(`[Orchestrator] Applying LLM decision: ${decision.action} for message from ${message.workerId}`);

		switch (decision.action) {
			case 'respond':
				// Send the response to the worker
				if (worker && decision.response) {
					worker.addAssistantMessage(`[Orchestrator Response] ${decision.response}`);
				}
				break;

			case 'retry':
				// Retry the task
				if (task) {
					this._logService.info(`[Orchestrator] Retrying task ${task.id}: ${decision.reason}`);
					task.status = 'queued';
					task.error = undefined;
					this.deploy(task.id).catch((err: unknown) => {
						this._logService.error(`[Orchestrator] Failed to retry task: ${err instanceof Error ? err.message : String(err)}`);
					});
				}
				break;

			case 'cancel':
				// Cancel the task
				if (task) {
					this._logService.info(`[Orchestrator] Cancelling task ${task.id}: ${decision.reason}`);
					task.status = 'failed';
					task.error = decision.reason || 'Cancelled by orchestrator';
					this._onOrchestratorEvent.fire({
						type: 'task.failed',
						planId: task.planId,
						taskId: task.id,
						error: task.error,
					});
				}
				if (worker) {
					worker.interrupt();
				}
				break;

			case 'escalate':
				// Add to inbox for user decision
				this._inbox.addItem({
					id: generateUuid(),
					message,
					status: 'pending',
					requiresUserAction: true,
					createdAt: Date.now(),
					llmSuggestion: decision.response,
				});
				vscode.window.showInformationMessage(
					`Orchestrator: Escalated to user - ${decision.reason || 'LLM requires user input'}`
				);
				break;

			case 'approve':
				// Approve the request
				if (worker) {
					const approvalId = (message.content as any).approvalId;
					if (approvalId) {
						worker.handleApproval(approvalId, true, decision.response);
					}
				}
				break;

			case 'deny':
				// Deny the request
				if (worker) {
					const approvalId = (message.content as any).approvalId;
					if (approvalId) {
						worker.handleApproval(approvalId, false, decision.response);
					}
				}
				break;

			case 'continue':
			default:
				// No specific action needed
				break;
		}

		this._saveState();
	}

	// NOTE: _notifyOrchestratorOfWorkerCompletion has been removed.
	// It was previously called when workers went idle, conflating "idle" with "completed".
	// With the new notification mechanism:
	// - Idle workers are handled by _handleIdleWorker (inject updates or send inquiry)
	// - Completion is ONLY triggered via explicit a2a_subtask_complete tool call
	// - The task.completed event (fired by completeTask()) already notifies listeners

	/**
	 * IMMEDIATELY notify the orchestrator agent that a worker has FAILED.
	 * This is CRITICAL for the orchestrator to take action rather than waiting for other tasks.
	 */
	private _notifyOrchestratorOfWorkerFailure(message: IOrchestratorQueueMessage, errorMessage: string): void {
		const worker = this._workers.get(message.workerId);
		const task = this._tasks.find(t => t.workerId === message.workerId);

		if (!worker || !task) {
			return;
		}

		const workerState = worker.state;
		const worktreePath = workerState.worktreePath;
		const branchName = workerState.name || task.name;

		// Build URGENT notification content
		const notificationContent = {
			type: 'worker_failure',
			urgent: true,
			workerId: message.workerId,
			taskId: task.id,
			taskName: task.name,
			planId: task.planId,
			branchName,
			worktreePath,
			status: 'failed',
			error: errorMessage,
			// Include last few messages as context
			summary: workerState.messages?.slice(-5).map((m: { content: string }) => m.content).join('\n') || 'No messages.',
			guidance: this._buildFailureGuidance(task, errorMessage),
			// Count of other tasks that may be affected
			otherRunningTasks: this._tasks.filter(t =>
				t.planId === task.planId &&
				t.id !== task.id &&
				(t.status === 'running' || t.status === 'queued')
			).length,
		};

		// Add to inbox with HIGH PRIORITY
		this._inbox.addItem({
			id: generateUuid(),
			message: {
				...message,
				type: 'error',
				priority: 'critical', // Mark as critical for immediate attention
				content: notificationContent
			},
			status: 'pending',
			requiresUserAction: true, // This requires immediate action
			createdAt: Date.now()
		});

		// Show WARNING notification (not info) to get user attention
		vscode.window.showWarningMessage(
			`⚠️ Worker FAILED on task "${task.name}": ${errorMessage.substring(0, 100)}${errorMessage.length > 100 ? '...' : ''}`,
			'View Dashboard',
			'Retry Task'
		).then(choice => {
			if (choice === 'View Dashboard') {
				vscode.commands.executeCommand('copilot.orchestrator.dashboard.focus');
			} else if (choice === 'Retry Task') {
				this.retryTask(task.id).catch(err => {
					vscode.window.showErrorMessage(`Failed to retry task: ${err.message}`);
				});
			}
		});
	}

	/**
	 * Build guidance text for handling a worker failure.
	 */
	private _buildFailureGuidance(task: WorkerTask, errorMessage: string): string {
		const lines: string[] = [];
		lines.push('🚨 **IMMEDIATE ACTION REQUIRED** - A worker has FAILED!');
		lines.push('');
		lines.push(`**Error:** ${errorMessage}`);
		lines.push('');
		lines.push('**As the Orchestrator, you MUST decide how to proceed:**');
		lines.push('');
		lines.push('**Option 1 - Retry the task:**');
		lines.push(`Use \`orchestrator_retryTask\` with taskId "${task.id}"`);
		lines.push('');
		lines.push('**Option 2 - Cancel and adjust plan:**');
		lines.push(`Use \`orchestrator_cancelTask\` with taskId "${task.id}" and reassess the plan`);
		lines.push('');
		lines.push('**Option 3 - Investigate first:**');
		lines.push('Check the worker logs and error details before deciding');
		lines.push('');
		lines.push('⚡ **DO NOT** just wait for other tasks - take action now!');

		return lines.join('\n');
	}

	/**
	 * Build additional instructions for an orchestrator-deployed worker.
	 * This provides context about the worker's environment, completion requirements,
	 * and available capabilities - similar to what subtasks get via _buildSubTaskAdditionalInstructions.
	 */
	private _buildWorkerInstructions(task: WorkerTask, worktreePath: string, plan?: OrchestratorPlan): string {
		const maxDepth = this._subTaskManager.maxDepth;
		const planContext = plan
			? `- **Plan:** "${plan.name}" (${plan.id})\n- **Plan Description:** ${plan.description}`
			: '- **Plan:** Ad-hoc task (no plan)';

		return `## WORKER CONTEXT
You are a worker deployed by the Orchestrator to complete a specific task.
- **Task ID:** ${task.id}
- **Task Name:** ${task.name}
${planContext}
- **Depth Level:** 0 (top-level worker)

## YOUR WORKTREE
You are working in your own dedicated worktree at: ${escapePathForMarkdown(worktreePath)}
This is an isolated copy of the repository on a new branch. Changes here do not affect the main workspace until merged.

## ⚠️ CRITICAL: YOU MUST COMMIT AND COMPLETE YOUR TASK
**When you finish your task, you MUST:**
1. **Commit your changes** using git (stage and commit with a descriptive message)
2. **Call \`orchestrator_completeTask\`** with your taskId to signal completion

Example completion:
\`\`\`
# First commit your changes
git add -A
git commit -m "feat: descriptive message of your changes"

# Then call the completion tool
orchestrator_completeTask with taskId="${task.id}"
\`\`\`

**⚠️ WARNING: If you don't commit your changes before completing, they may be lost!**
**⚠️ WARNING: If you don't call orchestrator_completeTask, the orchestrator won't know you're done!**

## WORKTREE RESTRICTION
**You can ONLY modify files within your worktree: ${escapePathForMarkdown(worktreePath)}**
Any attempt to read, write, or modify files outside this path should be avoided.

## SUB-TASK SPAWNING
You CAN spawn sub-tasks if needed using \`a2a_spawn_subtask\` or \`a2a_spawn_parallel_subtasks\` tools.
Use \`a2a_list_agents\` to discover available agent types.
- Maximum depth for sub-tasks: ${maxDepth}
- Good reasons to spawn sub-tasks:
  - Investigating API documentation or external resources
  - Code review by a specialist agent
  - Build/test troubleshooting while you focus on main task
  - Any independent research that would distract from your core goal

## YOUR RESPONSIBILITIES
1. Complete the specific task assigned to you
2. Make file changes directly in your worktree using standard tools
3. Commit your changes with a descriptive message
4. Call \`orchestrator_completeTask\` when done

Focus on your assigned task and provide a clear, actionable result.`;
	}

	// NOTE: _buildOrchestratorGuidance was removed along with _notifyOrchestratorOfWorkerCompletion.
	// These functions were part of the old idle→completed coupling that has been removed.

	private async _handlePermissionRequest(message: IOrchestratorQueueMessage): Promise<void> {
		const request = message.content as IPermissionRequest;

		// 1. Check if we can auto-approve at Orchestrator level
		const decision = this._permissionService.evaluatePermission(request.action, request.context);

		if (decision === 'auto_approve') {
			this._respondToPermissionRequest(request, true, 'orchestrator');
			return;
		}

		if (decision === 'auto_deny') {
			this._respondToPermissionRequest(request, false, 'orchestrator');
			return;
		}

		// 2. If not auto-decided, ask user with timeout support
		const userApproved = await this._askUserForPermissionWithTimeout(request);
		this._respondToPermissionRequest(request, userApproved, 'user');
	}

	private async _askUserForPermissionWithTimeout(request: IPermissionRequest): Promise<boolean> {
		// Create a promise for user response
		const userResponsePromise = this._askUserForPermission(request);

		// Create a timeout promise that applies default action
		const timeoutPromise = new Promise<boolean>((resolve) => {
			setTimeout(() => {
				const approved = request.defaultAction === 'approve';
				// Note: We can't cancel the user dialog, but we'll return the default action
				resolve(approved);
			}, request.timeout);
		});

		// Race between user response and timeout
		return Promise.race([userResponsePromise, timeoutPromise]);
	}

	private async _askUserForPermission(request: IPermissionRequest): Promise<boolean> {
		const selection = await vscode.window.showInformationMessage(
			`Permission Request: ${request.action} (from ${request.requesterType} ${request.requesterId})`,
			{ modal: true },
			'Approve',
			'Deny'
		);
		return selection === 'Approve';
	}

	private _respondToPermissionRequest(request: IPermissionRequest, approved: boolean, respondedBy: 'inherited' | 'parent' | 'orchestrator' | 'user'): void {
		// Send permission response back through the queue for the requester to receive.
		// The sub-task or worker can listen for this response to continue execution.

		if (request.requesterType === 'subtask') {
			// Get the sub-task and update its state based on permission decision
			const subTask = this._subTaskManager.getSubTask(request.requesterId);
			if (subTask) {
				// If permission was denied, cancel the sub-task
				if (!approved) {
					this._subTaskManager.updateStatus(request.requesterId, 'failed', {
						taskId: request.requesterId,
						status: 'failed',
						output: '',
						error: `Permission denied for action: ${request.action} (by ${respondedBy})`
					});
				}
				// If approved, the sub-task can continue (it may be waiting on a promise)
			}
		}

		// Enqueue a response message for the requester
		this._queueService.enqueueMessage({
			id: generateUuid(),
			timestamp: Date.now(),
			priority: 'high',
			planId: request.context.planId as string || '',
			taskId: request.context.taskId as string || '',
			workerId: request.context.workerId as string || '',
			worktreePath: request.context.worktreePath as string || '',
			subTaskId: request.requesterType === 'subtask' ? request.requesterId : undefined,
			type: 'status_update',
			content: {
				type: 'permission_response',
				requestId: request.id,
				approved,
				respondedBy
			}
		});
	}

	// --- State Persistence ---

	private _getStateFilePath(): string | undefined {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceFolder) {
			return undefined;
		}
		return path.join(workspaceFolder, OrchestratorService.STATE_FILE_NAME);
	}

	private _saveState(): void {
		if (this._saveDebounceTimer) {
			clearTimeout(this._saveDebounceTimer);
		}
		this._saveDebounceTimer = setTimeout(() => {
			this._saveStateImmediate();
		}, 500);
	}

	private _saveStateImmediate(): void {
		const stateFilePath = this._getStateFilePath();
		if (!stateFilePath) {
			return;
		}

		try {
			const state: PersistedOrchestratorState = {
				version: OrchestratorService.STATE_VERSION,
				plans: [...this._plans],
				tasks: [...this._tasks],
				workers: Array.from(this._workers.values()).map(w => w.serialize()),
				nextTaskId: this._nextTaskId,
				nextPlanId: this._nextPlanId,
				activePlanId: this._activePlanId,
			};
			fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
		} catch (error) {
			console.error('Failed to save orchestrator state:', error);
		}
	}

	private _restoreState(): void {
		const stateFilePath = this._getStateFilePath();
		if (!stateFilePath || !fs.existsSync(stateFilePath)) {
			return;
		}

		try {
			const content = fs.readFileSync(stateFilePath, 'utf-8');
			const state = JSON.parse(content) as PersistedOrchestratorState & { version: number };

			// Handle version migration
			if (state.version === 1) {
				// Migrate from v1: tasks without plans become ad-hoc, add name field
				const oldTasks = (state.tasks || []) as Array<Omit<WorkerTask, 'name'> & { name?: string }>;
				for (const task of oldTasks) {
					this._tasks.push({
						...task,
						name: task.name || this._generateTaskName(task.description),
					} as WorkerTask);
				}
				this._nextTaskId = state.nextTaskId || 1;
			} else if (state.version === OrchestratorService.STATE_VERSION) {
				this._plans.push(...(state.plans || []));
				this._tasks.push(...(state.tasks || []));
				this._nextTaskId = state.nextTaskId || 1;
				this._nextPlanId = state.nextPlanId || 1;
				this._activePlanId = state.activePlanId;
			} else {
				console.warn('Orchestrator state version mismatch, discarding old state');
				return;
			}

			// Restore workers
			for (const serializedWorker of (state.workers || [])) {
				const worker = WorkerSession.fromSerialized(serializedWorker);
				this._workers.set(worker.id, worker);

				this._register(worker.onDidChange(() => {
					this._onDidChangeWorkers.fire();
					this._saveState();
				}));
			}

			console.log(`Restored orchestrator state: ${this._plans.length} plans, ${this._tasks.length} tasks, ${this._workers.size} workers`);
		} catch (error) {
			console.error('Failed to restore orchestrator state:', error);
		}
	}

	public override dispose(): void {
		if (this._saveDebounceTimer) {
			clearTimeout(this._saveDebounceTimer);
		}
		this._saveStateImmediate();
		super.dispose();
	}

	// --- Default Branch Detection ---

	private async _detectDefaultBranch(): Promise<void> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceFolder) {
			return;
		}

		return new Promise((resolve) => {
			// Try to detect the default branch from remote
			cp.exec('git symbolic-ref refs/remotes/origin/HEAD', { cwd: workspaceFolder }, (err, stdout) => {
				if (!err && stdout) {
					// stdout is like "refs/remotes/origin/main"
					const match = stdout.trim().match(/refs\/remotes\/origin\/(.+)/);
					if (match) {
						this._defaultBaseBranch = match[1];
						resolve();
						return;
					}
				}
				// Fallback: check if main or master exists
				cp.exec('git rev-parse --verify main', { cwd: workspaceFolder }, (err2) => {
					this._defaultBaseBranch = err2 ? 'master' : 'main';
					resolve();
				});
			});
		});
	}

	private _getBaseBranch(task?: WorkerTask, plan?: OrchestratorPlan): string {
		return task?.baseBranch || plan?.baseBranch || this._defaultBaseBranch || 'main';
	}

	// --- Plan Management ---

	public getPlans(): readonly OrchestratorPlan[] {
		return [...this._plans];
	}

	public getActivePlanId(): string | undefined {
		return this._activePlanId;
	}

	public setActivePlan(planId: string | undefined): void {
		this._activePlanId = planId;
		this._onDidChangeWorkers.fire();
		this._saveState();
	}

	public createPlan(name: string, description: string, baseBranch?: string): OrchestratorPlan {
		const plan: OrchestratorPlan = {
			id: `plan-${this._nextPlanId++}`,
			name,
			description,
			createdAt: Date.now(),
			baseBranch,
			status: 'draft',
		};
		this._plans.push(plan);
		this._activePlanId = plan.id;
		this._onDidChangeWorkers.fire();
		this._saveState();
		return plan;
	}

	public deletePlan(planId: string): void {
		const planIndex = this._plans.findIndex(p => p.id === planId);
		if (planIndex >= 0) {
			this._plans.splice(planIndex, 1);
			// Remove all pending tasks for this plan
			for (let i = this._tasks.length - 1; i >= 0; i--) {
				if (this._tasks[i].planId === planId) {
					this._tasks.splice(i, 1);
				}
			}
			if (this._activePlanId === planId) {
				this._activePlanId = this._plans[0]?.id;
			}
			this._onDidChangeWorkers.fire();
			this._saveState();
		}
	}

	public getPlanById(planId: string): OrchestratorPlan | undefined {
		return this._plans.find(p => p.id === planId);
	}

	/**
	 * Start executing a plan - deploys tasks whose dependencies are satisfied
	 */
	public async startPlan(planId: string): Promise<void> {
		const plan = this._plans.find(p => p.id === planId);
		if (!plan) {
			throw new Error(`Plan ${planId} not found`);
		}

		plan.status = 'active';
		this._onOrchestratorEvent.fire({ type: 'plan.started', planId });
		this._onDidChangeWorkers.fire();
		this._saveState();

		// Deploy all tasks with satisfied dependencies
		await this._deployReadyTasks(planId);
	}

	/**
	 * Pause a plan - no new tasks will be auto-deployed
	 */
	public pausePlan(planId: string): void {
		const plan = this._plans.find(p => p.id === planId);
		if (plan && plan.status === 'active') {
			plan.status = 'paused';
			this._onDidChangeWorkers.fire();
			this._saveState();
		}
	}

	/**
	 * Resume a paused plan
	 */
	public resumePlan(planId: string): void {
		const plan = this._plans.find(p => p.id === planId);
		if (plan && plan.status === 'paused') {
			plan.status = 'active';
			this._onDidChangeWorkers.fire();
			this._saveState();
			// Deploy any ready tasks
			this._deployReadyTasks(planId).catch((err: Error) => {
				console.error('Failed to deploy ready tasks after resume:', err);
			});
		}
	}

	// --- Task/Worker State ---

	public getWorkerStates(): WorkerSessionState[] {
		return Array.from(this._workers.values()).map(w => w.state);
	}

	public getWorkerState(workerId: string): WorkerSessionState | undefined {
		return this._workers.get(workerId)?.state;
	}

	public getTasks(planId?: string): readonly WorkerTask[] {
		return this._tasks.filter(t => t.planId === planId);
	}

	public getTaskById(taskId: string): WorkerTask | undefined {
		return this._tasks.find(t => t.id === taskId);
	}

	public getPlan(): readonly WorkerTask[] {
		return this.getTasks(this._activePlanId);
	}

	/**
	 * Get tasks that are ready to run (pending/queued with all dependencies completed)
	 */
	public getReadyTasks(planId?: string): readonly WorkerTask[] {
		const targetPlanId = planId ?? this._activePlanId;
		const planTasks = this._tasks.filter(t => t.planId === targetPlanId);

		return planTasks.filter(task => {
			// Must be pending, or queued without an active worker (stuck from failed deployment)
			if (task.status !== 'pending') {
				if (task.status === 'queued' && !task.workerId) {
					// Queued but no worker - was stuck from a failed deployment attempt
				} else {
					return false;
				}
			}
			// All dependencies must be completed
			return task.dependencies.every(depId => {
				const depTask = this._tasks.find(t => t.id === depId);
				return depTask?.status === 'completed';
			});
		});
	}

	public addTask(description: string, options: CreateTaskOptions = {}): WorkerTask {
		const {
			name = this._generateTaskName(description),
			priority = 'normal',
			context,
			baseBranch,
			planId = this._activePlanId,
			modelId,
			dependencies = [],
			parallelGroup,
			agent = '@agent',
			targetFiles,
			parentWorkerId,
			parsedAgentType,
		} = options;

		const task: WorkerTask = {
			id: `task-${this._nextTaskId++}`,
			name: this._sanitizeBranchName(name),
			description,
			priority,
			dependencies,
			parallelGroup,
			context,
			baseBranch,
			planId,
			modelId,
			agent,
			targetFiles,
			parentWorkerId,
			parsedAgentType,
			status: 'pending',
		};
		this._tasks.push(task);
		this._onDidChangeWorkers.fire();
		this._saveState();
		return task;
	}

	public clearTasks(planId?: string): void {
		for (let i = this._tasks.length - 1; i >= 0; i--) {
			if (this._tasks[i].planId === planId) {
				this._tasks.splice(i, 1);
			}
		}
		this._onDidChangeWorkers.fire();
		this._saveState();
	}

	public clearPlan(): void {
		this.clearTasks(this._activePlanId);
	}

	public removeTask(taskId: string): void {
		const index = this._tasks.findIndex(t => t.id === taskId);
		if (index >= 0) {
			this._tasks.splice(index, 1);
			this._onDidChangeWorkers.fire();
			this._saveState();
		}
	}

	// --- Worker Deployment ---

	// ============================================================================
	// Smart Parallelization (Phase 7)
	// ============================================================================

	/**
	 * Check if two tasks can run in parallel safely (no file overlap)
	 */
	private _canRunInParallel(taskA: WorkerTask, taskB: WorkerTask): boolean {
		// If either task has no target files, we can't guarantee safety
		if (!taskA.targetFiles?.length || !taskB.targetFiles?.length) {
			return false;
		}

		// Check for file overlap
		const filesA = new Set(taskA.targetFiles.map(f => this._normalizeFilePath(f)));
		for (const file of taskB.targetFiles) {
			if (filesA.has(this._normalizeFilePath(file))) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Normalize file path for comparison
	 */
	private _normalizeFilePath(filePath: string): string {
		return filePath.toLowerCase().replace(/\\/g, '/');
	}

	/**
	 * Get tasks from ready list that can safely run in parallel with already-running tasks
	 */
	private _getParallelizableTasks(readyTasks: readonly WorkerTask[], planId: string): WorkerTask[] {
		// Get currently running tasks for this plan
		const runningTasks = this._tasks.filter(
			t => t.planId === planId && t.status === 'running'
		);

		if (runningTasks.length === 0) {
			// No running tasks, can start any ready task
			return [...readyTasks];
		}

		// Filter ready tasks to only those that can run in parallel with all running tasks
		const parallelizable: WorkerTask[] = [];

		for (const ready of readyTasks) {
			// Check if this task can run with all currently running tasks
			const canRunWithAll = runningTasks.every(running =>
				this._canRunInParallel(ready, running)
			);

			// Also check against other parallelizable tasks we've already selected
			const canRunWithSelected = parallelizable.every(selected =>
				this._canRunInParallel(ready, selected)
			);

			if (canRunWithAll && canRunWithSelected) {
				parallelizable.push(ready);
			}
		}

		return parallelizable;
	}

	/**
	 * Deploy ready tasks for a plan (internal - called when dependencies satisfied)
	 * Uses smart parallelization to only deploy tasks that won't conflict.
	 */
	private async _deployReadyTasks(planId: string): Promise<void> {
		const plan = this._plans.find(p => p.id === planId);
		if (!plan || plan.status !== 'active') {
			return;
		}

		const readyTasks = this.getReadyTasks(planId);

		// Use smart parallelization to filter to safe tasks
		const parallelizableTasks = this._getParallelizableTasks(readyTasks, planId);

		// If no tasks can be parallelized but some are ready, deploy at least one
		// This handles the case where tasks have no targetFiles specified
		const tasksToDeploy = parallelizableTasks.length > 0
			? parallelizableTasks
			: readyTasks.slice(0, 1); // Deploy just the first one to be safe

		for (const task of tasksToDeploy) {
			try {
				await this.deploy(task.id);
			} catch (error) {
				console.error(`Failed to deploy task ${task.id}:`, error);
			}
		}

		// Check if plan is complete (no pending/running tasks)
		this._checkPlanCompletion(planId);
	}

	/**
	 * Check if a plan has completed (all tasks done)
	 */
	private _checkPlanCompletion(planId: string): void {
		const plan = this._plans.find(p => p.id === planId);
		if (!plan || plan.status !== 'active') {
			return;
		}

		const planTasks = this._tasks.filter(t => t.planId === planId);
		const allCompleted = planTasks.every(t => t.status === 'completed');
		const anyFailed = planTasks.some(t => t.status === 'failed');

		if (anyFailed) {
			plan.status = 'failed';
			this._onOrchestratorEvent.fire({ type: 'plan.failed', planId, error: 'One or more tasks failed' });
			this._onDidChangeWorkers.fire();
			this._saveState();
		} else if (allCompleted && planTasks.length > 0) {
			plan.status = 'completed';
			this._onOrchestratorEvent.fire({ type: 'plan.completed', planId });
			this._onDidChangeWorkers.fire();
			this._saveState();
		}
	}

	/**
	 * Mark a task as blocked (dependencies cannot be satisfied)
	 */
	private _checkBlockedTasks(planId: string): void {
		const planTasks = this._tasks.filter(t => t.planId === planId);

		for (const task of planTasks) {
			if (task.status !== 'pending') {
				continue;
			}

			// Check if any dependency has failed
			const hasFailedDep = task.dependencies.some(depId => {
				const depTask = this._tasks.find(t => t.id === depId);
				return depTask?.status === 'failed';
			});

			if (hasFailedDep) {
				task.status = 'blocked';
				task.error = 'Blocked due to failed dependency';
				this._onOrchestratorEvent.fire({
					type: 'task.blocked',
					planId: task.planId,
					taskId: task.id,
					reason: 'Blocked due to failed dependency',
				});
			}
		}
	}

	public async deploy(taskId?: string, options?: DeployOptions): Promise<WorkerSession> {
		// === DEPLOY ENTRY POINT ===
		this._logService.info(`[Orchestrator:deploy] ========== DEPLOY CALLED ==========`);
		this._logService.info(`[Orchestrator:deploy] Input: taskId=${taskId ?? '(auto-select)'}, hasOptions=${!!options}, worktreePath=${options?.worktreePath ?? '(will create)'}, hasInstructionsBuilder=${!!options?.instructionsBuilder}`);

		// Find task - either by ID or first ready task
		let task: WorkerTask | undefined;
		if (taskId) {
			task = this._tasks.find(t => t.id === taskId);
			// When deploying specific task, also allow 'queued' tasks that may have failed previously
			if (task && task.status !== 'pending' && task.status !== 'queued') {
				throw new Error(`Task ${taskId} is not available for deployment (status: ${task.status})`);
			}
		} else {
			// Find first ready task in active plan or any ad-hoc task
			const readyTasks = this.getReadyTasks(this._activePlanId);
			task = readyTasks[0] || this._tasks.find(t => !t.planId && t.status === 'pending');
		}

		if (!task) {
			this._logService.error(`[Orchestrator:deploy] ERROR: No tasks available for deployment`);
			throw new Error('No tasks available');
		}

		this._logService.info(`[Orchestrator:deploy] Found task: id=${task.id}, name="${task.name}", agent=${task.agent ?? '@agent'}, parentWorkerId=${task.parentWorkerId ?? '(none)'}, hasContext=${!!task.context}, hasAdditionalInstructions=${!!task.context?.additionalInstructions}`);

		// Validate dependencies are satisfied
		const unsatisfiedDeps = task.dependencies.filter(depId => {
			const depTask = this._tasks.find(t => t.id === depId);
			return depTask?.status !== 'completed';
		});

		if (unsatisfiedDeps.length > 0) {
			throw new Error(`Task ${task.id} has unsatisfied dependencies: ${unsatisfiedDeps.join(', ')}`);
		}

		// Update task status
		const previousStatus = task.status;
		task.status = 'queued';
		this._onOrchestratorEvent.fire({ type: 'task.queued', planId: task.planId, taskId: task.id });

		try {
			// Get the plan for base branch resolution
			const plan = task.planId ? this._plans.find(p => p.id === task.planId) : undefined;
			const baseBranch = this._getBaseBranch(task, plan);

			// Use provided worktree path (for subtasks) or create new one
			// Note: Use || instead of ?? to treat empty string as falsy
			const worktreePath = options?.worktreePath || await this._createWorktree(task.name, baseBranch);

			// Inject additional instructions into the task's context.
			// This provides workers with critical context about their environment and responsibilities.
			//
			// Priority:
			// 1. If instructionsBuilder provided (subtasks) → use it
			// 2. If top-level worker (no parentWorkerId) → build default worker instructions
			// 3. Otherwise → use existing context.additionalInstructions (if any)
			if (options?.instructionsBuilder) {
				// Subtask case: use the provided builder
				this._logService.info(`[Orchestrator:deploy] Calling instructionsBuilder for task ${task.id} with worktreePath=${worktreePath}`);
				const builtInstructions = options.instructionsBuilder(worktreePath);
				// Mutate the task's context to include the instructions
				// This must happen BEFORE _runWorkerTask is called
				// Use type assertion to bypass readonly (we need to set this at deploy time)
				if (!task.context) {
					(task as { context?: WorkerTaskContext }).context = {};
				}
				(task.context as { additionalInstructions?: string }).additionalInstructions = builtInstructions;
				this._logService.info(`[Orchestrator:deploy] Injected additionalInstructions for task ${task.id}: ${builtInstructions.length} chars, preview="${builtInstructions.slice(0, 200).replace(/\n/g, '\\n')}..."`);
			} else if (!task.parentWorkerId && !task.context?.additionalInstructions) {
				// Top-level orchestrator-deployed worker: build default instructions
				this._logService.info(`[Orchestrator:deploy] Building default worker instructions for top-level task ${task.id}`);
				const builtInstructions = this._buildWorkerInstructions(task, worktreePath, plan);
				if (!task.context) {
					(task as { context?: WorkerTaskContext }).context = {};
				}
				(task.context as { additionalInstructions?: string }).additionalInstructions = builtInstructions;
				this._logService.info(`[Orchestrator:deploy] Injected default worker instructions for task ${task.id}: ${builtInstructions.length} chars`);
			} else {
				this._logService.info(`[Orchestrator:deploy] Using existing additionalInstructions for task ${task.id}: ${task.context?.additionalInstructions ? `${task.context.additionalInstructions.length} chars` : '(none)'}`);
			}

			// Parse and validate agent type using the centralized parser
			// IMPORTANT: Use pre-parsed agent type if available (from subtask creation)
			// This ensures subtasks preserve their intended backend (e.g., claude:agent stays claude)
			const rawAgentType = task.agent || '@agent';
			let parsedAgentType: ParsedAgentType;

			if (task.parsedAgentType) {
				// Subtask already has a parsed agent type - use it directly
				// This preserves the backend specification from the parent's spawn request
				parsedAgentType = task.parsedAgentType;
				this._logService.info(`[OrchestratorService] Using pre-parsed agent type for task ${task.id}: backend=${parsedAgentType.backend}, agentName=${parsedAgentType.agentName}${parsedAgentType.slashCommand ? `, slashCommand=${parsedAgentType.slashCommand}` : ''}`);
			} else {
				// No pre-parsed type - use BackendSelectionService to determine backend with 3-level precedence:
				// 1. User Request (highest) - explicit hints in prompt
				// 2. Repo Config - .github/agents/config.yaml
				// 3. Extension Defaults - VS Code settings
				const backendSelection = await this._backendSelectionService.selectBackend(
					task.description,
					rawAgentType.replace(/^@/, '').toLowerCase()
				);
				this._logService.info(`[OrchestratorService] Backend selection for task ${task.id}: backend=${backendSelection.backend}, source=${backendSelection.source}${backendSelection.model ? `, model=${backendSelection.model}` : ''}`);

				try {
					// Incorporate selected backend into the parsed agent type
					// If the selection came from user request or repo config, override the default
					const effectiveModelId = backendSelection.model ?? task.modelId;
					parsedAgentType = parseAgentType(rawAgentType, effectiveModelId);

					// Override backend if selection came from user prompt or repo config
					if (backendSelection.source !== 'extension-default' || parsedAgentType.backend === 'copilot') {
						parsedAgentType = {
							...parsedAgentType,
							backend: backendSelection.backend,
							modelOverride: backendSelection.model ?? parsedAgentType.modelOverride,
						};
					}
				} catch (error) {
					if (error instanceof AgentTypeParseError) {
						throw new Error(`Invalid agent type '${rawAgentType}' for task ${task.id}: ${error.message}`);
					}
					throw error;
				}
			}

			// Validate that we have an executor for this backend type
			if (!this._executorRegistry.hasExecutor(parsedAgentType.backend)) {
				const availableBackends = this._executorRegistry.getRegisteredBackends();
				throw new Error(
					`No executor registered for backend '${parsedAgentType.backend}' for task ${task.id}.\n` +
					`Agent type: ${rawAgentType}\n\n` +
					`Available backends: ${availableBackends.join(', ') || 'none'}\n\n` +
					`Please ensure the backend is properly registered.`
				);
			}

			// Store the parsed agent type in the task for use during execution
			task.parsedAgentType = parsedAgentType;

			// Load agent instructions using the normalized agent name
			const agentId = parsedAgentType.agentName;
			const composedInstructions = await this._agentInstructionService.loadInstructions(agentId);

			// Determine model ID: deploy options override > task's model > undefined
			// Select the actual model now so we can log it accurately
			const preferredModelId = options?.modelId ?? task.modelId;
			const selectedModel = await this._selectModel(preferredModelId);
			const actualModelId = selectedModel?.id || '(no model available)';
			this._logService.info(`[OrchestratorService] Deploy task ${task.id}: model=${actualModelId}, worktreePath=${worktreePath}`);

			// Store the model override for the worker
			// Use the selected model's ID so we don't re-select in _runWorkerLoop
			const effectiveModelId = selectedModel?.id ?? preferredModelId;

			// Create worker session with agent instructions and model
			this._logService.info(`[Orchestrator:deploy] Creating WorkerSession: taskId=${task.id}, worktreePath=${worktreePath}, agentId=${agentId}, modelId=${effectiveModelId}, backend=${parsedAgentType.backend}`);
			const worker = new WorkerSession(
				task.name,
				task.description,
				worktreePath,
				task.planId,
				baseBranch,
				agentId,
				composedInstructions.instructions,
				effectiveModelId,
			);
			this._logService.info(`[Orchestrator:deploy] WorkerSession created: workerId=${worker.id}, taskId=${task.id}`);

			// Create scoped tool set for this worker
			// This ensures tools operate within the worker's worktree
			// For subtasks (parentWorkerId set): owner = parent worker, so messages route back
			// For regular tasks: owner = orchestrator
			// IMPORTANT: options.parentWorkerId takes precedence over task.parentWorkerId
			// This allows the orchestrator agent to set itself as parent when deploying tasks
			const effectiveParentWorkerId = options?.parentWorkerId ?? task.parentWorkerId;
			const ownerContext = effectiveParentWorkerId
				? { ownerType: 'worker' as const, ownerId: effectiveParentWorkerId }
				: { ownerType: 'orchestrator' as const, ownerId: 'orchestrator' };

			// LOG: Verify parent worker ID is being set correctly
			this._logService.info(`[Orchestrator:deploy] PARENT WORKER SETUP: taskId=${task.id}, options.parentWorkerId=${options?.parentWorkerId ?? '(none)'}, task.parentWorkerId=${task.parentWorkerId ?? '(none)'}, effectiveParentWorkerId=${effectiveParentWorkerId ?? '(none)'}, ownerContext=${JSON.stringify(ownerContext)}`);

			const workerToolSet = this._workerToolsService.createWorkerToolSet(
				worker.id,
				worktreePath,
				task.planId,
				task.id,
				effectiveParentWorkerId ? 1 : 0, // depth = 1 for subtasks, 0 for orchestrator-deployed workers
				ownerContext,
				'orchestrator' // spawnContext = orchestrator allows depth up to 2
			);
			this._workerToolSets.set(worker.id, workerToolSet);

			// Also store in override map for runtime changes (kept for backward compat)
			if (effectiveModelId) {
				this._workerModelOverrides.set(worker.id, effectiveModelId);
			}

			// Link task to worker and create session URI
			task.status = 'running';
			task.workerId = worker.id;
			task.sessionUri = this._createSessionUri(task.id);
			this._workers.set(worker.id, worker);

			// CRITICAL: Forge a toolInvocationToken for this worker.
			// VS Code's tool UI requires a token with sessionId and sessionResource.
			// Without this, tool invocation bubbles won't appear in the chat UI.
			//
			// The token format (from debugging a working session) is:
			// {
			//   "sessionId": "orchestrator:/worker-{id}",
			//   "sessionResource": { "$mid": 1, "external": "orchestrator:/worker-{id}", "path": "/worker-{id}", "scheme": "orchestrator" }
			// }
			const workerSessionUri = `orchestrator:/${worker.id}`;
			const forgedToken = {
				sessionId: workerSessionUri,
				sessionResource: vscode.Uri.from({
					scheme: 'orchestrator',
					path: `/${worker.id}`,
				}),
			} as vscode.ChatParticipantToolToken;
			worker.setToolInvocationToken(forgedToken);
			this._logService.debug(`[OrchestratorService] Forged toolInvocationToken for worker ${worker.id}: sessionId=${workerSessionUri}`);

			// Register wake-up adapter for parent completion notifications
			// This ensures workers receive completion messages from their subtasks
			const wakeUpAdapter = new WorkerSessionWakeUpAdapter(
				worker,
				this._parentCompletionService,
				this._logService
			);
			const adapterDisposable = wakeUpAdapter.register();
			this._wakeUpAdapters.set(worker.id, adapterDisposable);
			this._register(adapterDisposable);

			// Register a proxy stream for subtask progress reporting
			// This creates a WorkerResponseStream that proxies progress updates.
			// When a real VS Code stream is attached later (via orchestratorChatSessionParticipant),
			// progress will flow through to the UI. Until then, progress is still tracked internally.
			const workerStream = new WorkerResponseStream(worker);
			const streamDisposable = this._subtaskProgressService.registerStream(worker.id, workerStream);
			this._register(streamDisposable);

			this._onOrchestratorEvent.fire({
				type: 'task.started',
				planId: task.planId,
				taskId: task.id,
				workerId: worker.id,
				sessionUri: task.sessionUri,
			});

			// Track previous status to detect transitions (not just current state)
			// This prevents duplicate status_update messages when onDidChange fires
			// multiple times while already in idle state (e.g., from _addMessage calls)
			let previousStatus = worker.status;
			this._register(worker.onDidChange(() => {
				this._onDidChangeWorkers.fire();
				this._saveState();

				// Check for transition TO idle state (not already idle)
				const currentStatus = worker.status;
				if (currentStatus === 'idle' && previousStatus !== 'idle') {
					this._queueService.enqueueMessage({
						id: generateUuid(),
						timestamp: Date.now(),
						priority: 'low',
						planId: task.planId || '',
						taskId: task.id,
						workerId: worker.id,
						worktreePath: worker.worktreePath,
						type: 'status_update',
						content: 'idle'
					});
				}
				previousStatus = currentStatus;
			}));

			this._register(worker.onDidComplete(() => {
				this._queueService.enqueueMessage({
					id: generateUuid(),
					timestamp: Date.now(),
					priority: 'normal',
					planId: task.planId || '',
					taskId: task.id,
					workerId: worker.id,
					worktreePath: worker.worktreePath,
					type: 'completion',
					content: { sessionUri: task.sessionUri }
				});
			}));

			this._onDidChangeWorkers.fire();
			this._saveState();

			// Start the worker task asynchronously
			this._logService.info(`[Orchestrator:deploy] Starting _runWorkerTask for workerId=${worker.id}, taskId=${task.id}, backend=${parsedAgentType.backend}, hasAdditionalInstructions=${!!task.context?.additionalInstructions}`);
			this._runWorkerTask(worker, task).catch(error => {
				this._logService.error(`[Orchestrator:deploy] _runWorkerTask FAILED for workerId=${worker.id}: ${error instanceof Error ? error.message : String(error)}`);
				this._queueService.enqueueMessage({
					id: generateUuid(),
					timestamp: Date.now(),
					priority: 'high',
					planId: task.planId || '',
					taskId: task.id,
					workerId: worker.id,
					worktreePath: worker.worktreePath,
					type: 'error',
					content: String(error)
				});

				worker.error(String(error));
			});

			this._logService.info(`[Orchestrator:deploy] Deploy COMPLETE - returning workerId=${worker.id}, taskId=${task.id}, worktreePath=${worktreePath}`);
			return worker;
		} catch (error) {
			// Reset task status on deployment failure so it can be retried
			task.status = previousStatus;
			this._saveState();
			throw error;
		}
	}

	public async deployAll(planId?: string, options?: DeployOptions): Promise<WorkerSession[]> {
		const targetPlanId = planId ?? this._activePlanId;
		const workers: WorkerSession[] = [];
		const readyTasks = this.getReadyTasks(targetPlanId);

		await Promise.all(readyTasks.map(async (task) => {
			try {
				const worker = await this.deploy(task.id, options);
				workers.push(worker);
			} catch (error) {
				console.error(`Failed to deploy worker for task ${task.id}:`, error);
			}
		}));

		return workers;
	}

	// --- Worker Control ---

	public sendMessageToWorker(workerId: string, message: string): void {
		const worker = this._workers.get(workerId);
		if (worker) {
			worker.sendClarification(message);
		}
	}

	public handleApproval(workerId: string, approvalId: string, approved: boolean, clarification?: string): void {
		const worker = this._workers.get(workerId);
		if (worker) {
			worker.handleApproval(approvalId, approved, clarification);
		}
	}

	public pauseWorker(workerId: string): void {
		const worker = this._workers.get(workerId);
		if (worker) {
			worker.pause();
		}
	}

	public resumeWorker(workerId: string): void {
		const worker = this._workers.get(workerId);
		if (worker) {
			worker.resume();
		}
	}

	/**
	 * Interrupt the worker's current agent iteration.
	 * This stops the current LLM/tool loop but keeps the worker active
	 * so the user can send feedback or redirect.
	 */
	public interruptWorker(workerId: string): void {
		const worker = this._workers.get(workerId);
		if (worker) {
			worker.interrupt();
			this._onDidChangeWorkers.fire();
		}
	}

	/**
	 * @deprecated Use interruptWorker() instead
	 */
	public stopWorker(workerId: string): void {
		this.interruptWorker(workerId);
	}

	public concludeWorker(workerId: string): void {
		const worker = this._workers.get(workerId);
		if (worker) {
			this._healthMonitor.stopMonitoring(workerId);
			this._circuitBreakers.delete(workerId);
			worker.dispose();
			this._workers.delete(workerId);
			this._onDidChangeWorkers.fire();
			this._saveState();
		}
	}

	public async completeWorker(workerId: string, options: CompleteWorkerOptions = {}): Promise<CompleteWorkerResult> {
		const worker = this._workers.get(workerId);
		if (!worker) {
			throw new Error(`Worker ${workerId} not found`);
		}

		const worktreePath = worker.worktreePath;
		const branchName = worker.name;

		// Mark worker as completed first - this will break the conversation loop
		worker.complete();

		const result: CompleteWorkerResult = {
			branchName,
			prCreated: false,
		};

		try {
			// Commit any uncommitted changes
			await this._execGit(['add', '-A'], worktreePath);
			await this._execGit(['commit', '-m', `Complete task: ${worker.task}`, '--allow-empty'], worktreePath);

			// Push to origin
			await this._execGit(['push', '-u', 'origin', branchName], worktreePath);

			// Create PR if requested
			if (options.createPullRequest) {
				const prResult = await this._createPullRequest(
					branchName,
					options.prBaseBranch || worker.baseBranch || this._defaultBaseBranch || 'main',
					options.prTitle || `[Orchestrator] ${worker.task}`,
					options.prDescription || `Task completed by Copilot Orchestrator.\n\n**Task:** ${worker.task}`,
					worktreePath
				);

				if (prResult) {
					result.prCreated = true;
					result.prUrl = prResult.url;
					result.prNumber = prResult.number;
				}
			}

			// Dispose Claude Code session for this worktree (stops the Claude process)
			if (worktreePath) {
				const removed = this._claudeSessionManager.removeSession(worktreePath);
				if (removed) {
					this._logService.info(`[OrchestratorService] Disposed Claude session for worktree: ${worktreePath}`);
				}
			}

			// Remove the worktree
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (workspaceFolder) {
				await this._execGit(['worktree', 'remove', worktreePath, '--force'], workspaceFolder);
			}

			// Remove from workers map
			worker.dispose();
			this._workers.delete(workerId);
			this._onDidChangeWorkers.fire();
			this._saveState();

			// Show appropriate message
			if (result.prCreated && result.prUrl) {
				const openPR = await vscode.window.showInformationMessage(
					`Task "${branchName}" completed. PR #${result.prNumber} created.`,
					'Open PR'
				);
				if (openPR === 'Open PR') {
					vscode.env.openExternal(vscode.Uri.parse(result.prUrl));
				}
			} else {
				vscode.window.showInformationMessage(`Task "${branchName}" completed and pushed to origin/${branchName}`);
			}

			return result;
		} catch (error) {
			throw new Error(`Failed to complete worker: ${error}`);
		}
	}

	// --- Completion Management Methods ---

	/**
	 * Generate a completion summary for a worker
	 */
	public async generateCompletionSummary(workerId: string): Promise<ICompletionSummary> {
		const worker = this._workers.get(workerId);
		if (!worker) {
			throw new Error(`Worker ${workerId} not found`);
		}
		return this._completionManager.generateCompletionSummary(worker);
	}

	/**
	 * Handle worker completion with a specific action
	 */
	public async handleWorkerCompletion(
		workerId: string,
		action: ICompletionOptions,
		feedback?: string
	): Promise<ICompletionResult> {
		const worker = this._workers.get(workerId);
		if (!worker) {
			throw new Error(`Worker ${workerId} not found`);
		}

		const result = await this._completionManager.handleCompletion(worker, action, feedback);

		// If the action was successful and it was approve_and_merge, clean up the worker
		if (result.success && action === 'approve_and_merge' && result.merged) {
			worker.dispose();
			this._workers.delete(workerId);
			this._onDidChangeWorkers.fire();
			this._saveState();
		}

		return result;
	}

	/**
	 * Create a pull request for a worker's changes
	 */
	public async createPullRequest(options: IPullRequestOptions): Promise<IPullRequestResult> {
		return this._completionManager.createPullRequest(options);
	}

	/**
	 * Merge a worker's branch into the target branch
	 */
	public async mergeWorkerBranch(options: IMergeOptions): Promise<IMergeResult> {
		return this._completionManager.mergeWorkerBranch(options);
	}

	/**
	 * Kill a worker: stop process, optionally remove worktree and reset task
	 */
	public async killWorker(workerId: string, options: KillWorkerOptions = {}): Promise<void> {
		const { removeWorktree = true, resetTask = true } = options;

		const worker = this._workers.get(workerId);
		if (!worker) {
			throw new Error(`Worker ${workerId} not found`);
		}

		const worktreePath = worker.worktreePath;
		const linkedTask = this._tasks.find(t => t.workerId === workerId);

		// Stop monitoring
		this._healthMonitor.stopMonitoring(workerId);
		this._circuitBreakers.delete(workerId);

		// Dispose wake-up adapter
		const wakeUpAdapter = this._wakeUpAdapters.get(workerId);
		if (wakeUpAdapter) {
			wakeUpAdapter.dispose();
			this._wakeUpAdapters.delete(workerId);
		}

		// Dispose the worker first (stops the conversation loop)
		worker.dispose();
		this._workers.delete(workerId);

		// Dispose worker tool set
		if (this._workerToolSets.has(workerId)) {
			this._workerToolsService.disposeWorkerToolSet(workerId);
			this._workerToolSets.delete(workerId);
		}

		// Dispose Claude Code session for this worktree (stops the Claude process)
		if (worktreePath) {
			const removed = this._claudeSessionManager.removeSession(worktreePath);
			if (removed) {
				this._logService.info(`[OrchestratorService] Disposed Claude session for worktree: ${worktreePath}`);
			}
		}

		// Reset task if requested
		if (resetTask && linkedTask) {
			linkedTask.status = 'pending';
			linkedTask.workerId = undefined;
			linkedTask.error = undefined;
		}

		// Remove worktree if requested
		if (removeWorktree) {
			try {
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
				if (workspaceFolder) {
					await this._execGit(['worktree', 'remove', worktreePath, '--force'], workspaceFolder);
					// Also delete the branch
					const branchName = worker.name;
					await this._execGit(['branch', '-D', branchName], workspaceFolder).catch(() => {
						// Branch might not exist, ignore error
					});
				}
			} catch (error) {
				console.error('Failed to remove worktree:', error);
				// Continue anyway - worktree removal failure shouldn't block kill
			}
		}

		this._onDidChangeWorkers.fire();
		this._saveState();
		vscode.window.showInformationMessage(`Worker "${worker.name}" killed.`);
	}

	/**
	 * Cancel a task: stop if running, reset to pending or remove
	 */
	public async cancelTask(taskId: string, remove: boolean = false): Promise<void> {
		const task = this._tasks.find(t => t.id === taskId);
		if (!task) {
			throw new Error(`Task ${taskId} not found`);
		}

		// If task has a worker, kill it
		if (task.workerId) {
			const worker = this._workers.get(task.workerId);
			if (worker) {
				await this.killWorker(task.workerId, { removeWorktree: true, resetTask: false });
			}
		}

		if (remove) {
			// Remove the task entirely
			this.removeTask(taskId);
		} else {
			// Reset to pending
			task.status = 'pending';
			task.workerId = undefined;
			task.error = undefined;
			this._onDidChangeWorkers.fire();
			this._saveState();
		}
	}

	/**
	 * Retry a failed task: reset status and re-deploy
	 */
	public async retryTask(taskId: string, options?: DeployOptions): Promise<WorkerSession> {
		const task = this._tasks.find(t => t.id === taskId);
		if (!task) {
			throw new Error(`Task ${taskId} not found`);
		}

		// If task has a worker, kill it first
		if (task.workerId) {
			const worker = this._workers.get(task.workerId);
			if (worker) {
				await this.killWorker(task.workerId, { removeWorktree: true, resetTask: false });
			}
		}

		// Reset task status
		task.status = 'pending';
		task.workerId = undefined;
		task.error = undefined;
		this._saveState();

		// Re-deploy with optional model override
		return this.deploy(taskId, options);
	}

	/**
	 * Complete a task: mark as completed, remove worker, trigger dependent tasks
	 */
	public async completeTask(taskId: string): Promise<void> {
		const task = this._tasks.find(t => t.id === taskId);
		if (!task) {
			throw new Error(`Task ${taskId} not found`);
		}

		// If task has a worker, remove it
		if (task.workerId) {
			const worker = this._workers.get(task.workerId);
			if (worker) {
				// Conclude the worker (stop gracefully without push since we already merged)
				this.concludeWorker(task.workerId);
			}
		}

		// Mark task as completed
		task.status = 'completed';
		task.completedAt = Date.now();
		task.workerId = undefined;

		// Fire completion event
		this._onOrchestratorEvent.fire({
			type: 'task.completed',
			planId: task.planId,
			taskId: task.id,
			workerId: task.workerId ?? '',
			sessionUri: task.sessionUri,
		});

		this._onDidChangeWorkers.fire();
		this._saveState();

		// Trigger deployment of dependent tasks
		if (task.planId) {
			await this._deployReadyTasks(task.planId);
			this._checkPlanCompletion(task.planId);
		}
	}

	/**
	 * Model override storage per worker
	 */
	private readonly _workerModelOverrides = new Map<string, string>();

	/**
	 * Set the model for a worker (takes effect on next message)
	 */
	public setWorkerModel(workerId: string, modelId: string): void {
		const worker = this._workers.get(workerId);
		if (!worker) {
			throw new Error(`Worker ${workerId} not found`);
		}

		this._workerModelOverrides.set(workerId, modelId);
		worker.setModel(modelId);
		worker.addUserMessage(`[System: Model changed to ${modelId}. Takes effect on next message.]`);
		this._onDidChangeWorkers.fire();
	}

	/**
	 * Get model ID for a worker
	 */
	public getWorkerModel(workerId: string): string | undefined {
		// Check worker session first, then fallback to override map
		const worker = this._workers.get(workerId);
		return worker?.modelId ?? this._workerModelOverrides.get(workerId);
	}

	/**
	 * Set the agent for a worker (reloads instructions, takes effect on next message)
	 */
	public async setWorkerAgent(workerId: string, agentId: string): Promise<void> {
		const worker = this._workers.get(workerId);
		if (!worker) {
			throw new Error(`Worker ${workerId} not found`);
		}

		// Normalize agent ID: strip @ prefix and lowercase
		const normalizedAgentId = agentId.replace(/^@/, '').toLowerCase();

		// Load new agent instructions
		const composedInstructions = await this._agentInstructionService.loadInstructions(normalizedAgentId);

		// Update worker with new agent
		worker.setAgent(normalizedAgentId, composedInstructions.instructions);
		worker.addUserMessage(`[System: Agent changed to @${normalizedAgentId}. Takes effect on next message.]`);
		this._onDidChangeWorkers.fire();
	}

	/**
	 * Get agent ID for a worker
	 */
	public getWorkerAgent(workerId: string): string | undefined {
		const worker = this._workers.get(workerId);
		return worker?.agentId;
	}

	// --- Worker Health & Recovery ---

	/**
	 * Reinitialize a worker: stop current execution, optionally clear history, restart
	 */
	public async reinitializeWorker(workerId: string, options: ReinitializeWorkerOptions = {}): Promise<ReinitializeWorkerResult> {
		const { newInstructions, clearHistory = true } = options;

		const worker = this._workers.get(workerId);
		if (!worker) {
			return { success: false, message: `Worker ${workerId} not found` };
		}

		try {
			// Interrupt current execution
			worker.interrupt();

			// Reset health monitoring for this worker
			this._healthMonitor.stopMonitoring(workerId);
			this._healthMonitor.startMonitoring(workerId);

			// Reset circuit breaker
			const circuitBreaker = this._circuitBreakers.get(workerId);
			if (circuitBreaker) {
				circuitBreaker.reset();
			}

			// Clear history if requested
			if (clearHistory) {
				worker.clearHistory();
			}

			// Update instructions if provided
			if (newInstructions) {
				worker.setInstructions([newInstructions]);
			}

			// Add system message indicating reinitialization
			worker.addAssistantMessage('[System: Worker has been reinitialized. Starting fresh with current state.]');

			// Resume the worker
			worker.start();

			this._onDidChangeWorkers.fire();
			this._saveState();

			return { success: true, message: `Worker ${workerId} reinitialized successfully` };
		} catch (error) {
			return { success: false, message: `Failed to reinitialize worker: ${error}` };
		}
	}

	/**
	 * Redirect a worker: inject a high-priority message without stopping execution
	 */
	public async redirectWorker(workerId: string, options: RedirectWorkerOptions): Promise<RedirectWorkerResult> {
		const { redirectPrompt, preserveHistory = true } = options;

		const worker = this._workers.get(workerId);
		if (!worker) {
			return { success: false, message: `Worker ${workerId} not found` };
		}

		try {
			// Interrupt to get attention
			worker.interrupt();

			// Clear history if requested
			if (!preserveHistory) {
				worker.clearHistory();
			}

			// Reset loop detection since we're changing direction
			const health = this._healthMonitor.getHealth(workerId);
			if (health) {
				health.recentToolCalls = [];
				health.consecutiveLoops = 0;
				health.isLooping = false;
			}

			// Inject the redirect prompt as a user message
			worker.addUserMessage(`[System Redirect] ${redirectPrompt}`);

			// Resume the worker with the new direction
			worker.start();

			this._onDidChangeWorkers.fire();
			this._saveState();

			return { success: true, message: `Worker ${workerId} redirected successfully` };
		} catch (error) {
			return { success: false, message: `Failed to redirect worker: ${error}` };
		}
	}

	// --- Inbox Management ---

	/**
	 * Get all pending inbox items that require action
	 */
	public getInboxPendingItems(): IOrchestratorInboxItem[] {
		return this._inbox.getPendingItems();
	}

	/**
	 * Get inbox items for a specific plan
	 */
	public getInboxItemsByPlan(planId: string): IOrchestratorInboxItem[] {
		return this._inbox.getItemsByPlan(planId);
	}

	/**
	 * Get inbox items for a specific worker
	 */
	public getInboxItemsByWorker(workerId: string): IOrchestratorInboxItem[] {
		return this._inbox.getItemsByWorker(workerId);
	}

	/**
	 * Process an inbox item with a response
	 */
	public processInboxItem(itemId: string, response?: string): void {
		const item = this._inbox.getItem(itemId);
		if (!item) {
			return;
		}

		this._inbox.markProcessed(itemId, response);

		// If there was a worker waiting, send the response
		const worker = this._workers.get(item.message.workerId);
		if (worker && response) {
			worker.addAssistantMessage(`[Orchestrator Response] ${response}`);
		}

		this._onDidChangeWorkers.fire();
	}

	/**
	 * Defer an inbox item for later handling
	 */
	public deferInboxItem(itemId: string, reason: string): void {
		this._inbox.deferItem(itemId, reason);
		this._onDidChangeWorkers.fire();
	}

	/**
	 * Create a pull request using GitHub CLI
	 */
	private async _createPullRequest(
		headBranch: string,
		baseBranch: string,
		title: string,
		body: string,
		cwd: string
	): Promise<{ url: string; number: number } | undefined> {
		try {
			// Use GitHub CLI to create PR
			const result = await this._execCommand(
				'gh',
				['pr', 'create', '--base', baseBranch, '--head', headBranch, '--title', title, '--body', body, '--json', 'url,number'],
				cwd
			);

			if (result) {
				const prInfo = JSON.parse(result);
				return { url: prInfo.url, number: prInfo.number };
			}
		} catch (error) {
			console.error('Failed to create PR via gh CLI:', error);
			// Fall back to showing manual instructions
			vscode.window.showWarningMessage(
				`Could not auto-create PR. Please create manually: gh pr create --base ${baseBranch} --head ${headBranch}`
			);
		}
		return undefined;
	}

	/**
	 * Execute a command and return stdout
	 */
	private _execCommand(command: string, args: string[], cwd: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const proc = cp.spawn(command, args, { cwd, shell: true });
			let stdout = '';
			let stderr = '';

			proc.stdout.on('data', (data) => { stdout += data.toString(); });
			proc.stderr.on('data', (data) => { stderr += data.toString(); });

			proc.on('close', (code) => {
				if (code === 0) {
					resolve(stdout.trim());
				} else {
					reject(new Error(`Command failed (${code}): ${stderr}`));
				}
			});

			proc.on('error', reject);
		});
	}

	// Legacy compatibility
	public getWorkers(): Record<string, any> {
		const result: Record<string, any> = {};
		for (const [id, worker] of this._workers) {
			result[id] = {
				id: worker.id,
				status: worker.status,
				events: worker.state.messages.map(m => ({
					type: m.role === 'assistant' ? 'thought' : 'message',
					content: m.content,
					timestamp: m.timestamp,
				})),
			};
		}
		return result;
	}

	// --- Standalone Session Support ---

	/**
	 * Register a handler to receive updates for a standalone parent session.
	 * Called when a standalone session (claude-standalone-*) spawns a subtask.
	 */
	public registerStandaloneParentHandler(parentId: string, handler: (message: string) => void): IDisposable {
		this._orchLog('Registering standalone parent handler', { parentId });
		this._standaloneParentHandlers.set(parentId, handler);
		return toDisposable(() => {
			this._orchLog('Unregistering standalone parent handler', { parentId });
			this._standaloneParentHandlers.delete(parentId);
		});
	}

	public addPlanTask(task: string): void {
		this.addTask(task);
	}

	// --- Private Helpers ---

	private _generateTaskName(description: string): string {
		// Generate a meaningful name from description
		const words = description
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, '')
			.split(/\s+/)
			.filter(w => w.length > 2)
			.slice(0, 4);

		if (words.length === 0) {
			return `task-${this._nextTaskId}`;
		}

		return words.join('-');
	}

	private _sanitizeBranchName(name: string): string {
		return name
			.toLowerCase()
			.replace(/[^a-z0-9-]/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '')
			.substring(0, 50);
	}

	private async _execGit(args: string[], cwd: string): Promise<string> {
		return new Promise((resolve, reject) => {
			cp.exec(`git ${args.map(a => `"${a}"`).join(' ')}`, { cwd }, (err, stdout, stderr) => {
				if (err) {
					reject(new Error(stderr || err.message));
				} else {
					resolve(stdout.trim());
				}
			});
		});
	}

	private async _createWorktree(taskName: string, baseBranch: string): Promise<string> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceFolder) {
			throw new Error('No workspace folder open');
		}

		// Check for dirty workspace (fail-fast policy)
		// Prevents accidental loss of uncommitted work and merge confusion
		const hasUncommittedChanges = await this._checkForDirtyWorkspace(workspaceFolder);
		if (hasUncommittedChanges) {
			throw new Error(
				'Cannot create worktree: the main workspace has uncommitted changes. ' +
				'Please commit, stash, or discard your changes before spawning workers.'
			);
		}

		// Use path.dirname() to reliably get the parent directory on all platforms
		const worktreesDir = path.join(path.dirname(workspaceFolder), '.worktrees');
		if (!fs.existsSync(worktreesDir)) {
			fs.mkdirSync(worktreesDir, { recursive: true });
		}

		const worktreePath = path.join(worktreesDir, taskName);
		const branchName = taskName;

		// Check if worktree already exists and is valid (has .git file)
		// A valid git worktree has a .git file (not directory) pointing to the main repo
		const gitPath = path.join(worktreePath, '.git');
		if (fs.existsSync(worktreePath)) {
			if (fs.existsSync(gitPath)) {
				// Valid worktree exists - ensure .claude folder is copied
				await this._copyClaudeFolderToWorktree(workspaceFolder, worktreePath);
				return worktreePath;
			}
			// Directory exists but is not a valid worktree - clean it up
			fs.rmSync(worktreePath, { recursive: true, force: true });
		}

		try {
			// Create worktree from the specified base branch
			await this._execGit(['worktree', 'add', '-b', branchName, worktreePath, baseBranch], workspaceFolder);
		} catch (error) {
			// Branch might exist, try without -b
			if (String(error).includes('already exists')) {
				try {
					await this._execGit(['worktree', 'add', worktreePath, branchName], workspaceFolder);
				} catch {
					if (fs.existsSync(worktreePath) && fs.existsSync(gitPath)) {
						// Worktree exists - still ensure .claude is copied
						await this._copyClaudeFolderToWorktree(workspaceFolder, worktreePath);
						return worktreePath;
					}
					throw error;
				}
			} else {
				throw error;
			}
		}

		// Copy .claude folder to worktree (contains agents, commands, skills)
		// This folder is in .gitignore so it's not copied automatically
		await this._copyClaudeFolderToWorktree(workspaceFolder, worktreePath);

		return worktreePath;
	}

	/**
	 * Check if the workspace has uncommitted changes (staged or unstaged).
	 * Used to enforce the "fail-fast" dirty workspace policy.
	 */
	private async _checkForDirtyWorkspace(workspaceFolder: string): Promise<boolean> {
		try {
			const statusOutput = await this._execGit(['status', '--porcelain'], workspaceFolder);
			return statusOutput.trim().length > 0;
		} catch {
			// If git command fails, assume clean to allow worktree creation
			return false;
		}
	}

	/**
	 * Copy the .claude folder from workspace to worktree.
	 * The .claude folder contains agents, commands, and skills that are needed
	 * for Claude to work properly but is typically in .gitignore.
	 */
	private async _copyClaudeFolderToWorktree(workspaceFolder: string, worktreePath: string): Promise<void> {
		const sourceClaudeDir = path.join(workspaceFolder, '.claude');
		const targetClaudeDir = path.join(worktreePath, '.claude');

		// Only copy if source exists and target doesn't
		if (!fs.existsSync(sourceClaudeDir)) {
			return; // No .claude folder in main repo
		}

		if (fs.existsSync(targetClaudeDir)) {
			return; // Already copied
		}

		try {
			// Recursively copy the .claude folder
			this._copyDirRecursive(sourceClaudeDir, targetClaudeDir);
			this._logService.info(`[Orchestrator] Copied .claude folder to worktree: ${worktreePath}`);
		} catch (error) {
			// Log but don't fail - the worker might still work without custom agents
			this._logService.warn(`[Orchestrator] Failed to copy .claude folder to worktree: ${error}`);
		}
	}

	/**
	 * Recursively copy a directory
	 */
	private _copyDirRecursive(source: string, target: string): void {
		if (!fs.existsSync(target)) {
			fs.mkdirSync(target, { recursive: true });
		}

		const entries = fs.readdirSync(source, { withFileTypes: true });
		for (const entry of entries) {
			const sourcePath = path.join(source, entry.name);
			const targetPath = path.join(target, entry.name);

			if (entry.isDirectory()) {
				this._copyDirRecursive(sourcePath, targetPath);
			} else {
				fs.copyFileSync(sourcePath, targetPath);
			}
		}
	}

	// --- Session URI Management ---

	/**
	 * Create a session URI for a task in the orchestrator:/ scheme
	 */
	private _createSessionUri(taskId: string): string {
		return `orchestrator:/${taskId}`;
	}

	/**
	 * Parse a task ID from a session URI
	 */
	private _parseSessionUri(sessionUri: string): string | undefined {
		if (!sessionUri.startsWith('orchestrator:/')) {
			return undefined;
		}
		return sessionUri.slice('orchestrator:/'.length);
	}

	/**
	 * Get the session URI for a task
	 */
	public getSessionUriForTask(taskId: string): string | undefined {
		const task = this._tasks.find(t => t.id === taskId);
		return task?.sessionUri;
	}

	/**
	 * Get a task by its session URI
	 */
	public getTaskBySessionUri(sessionUri: string): WorkerTask | undefined {
		const taskId = this._parseSessionUri(sessionUri);
		if (!taskId) {
			return undefined;
		}
		return this._tasks.find(t => t.id === taskId);
	}

	/**
	 * Get a WorkerSession by ID (for subscribing to real-time stream events)
	 */
	public getWorkerSession(workerId: string): WorkerSession | undefined {
		return this._workers.get(workerId);
	}

	private async _runWorkerTask(worker: WorkerSession, task: WorkerTask): Promise<void> {
		this._logService.info(`[Orchestrator:_runWorkerTask] ========== WORKER TASK STARTING ==========`);
		this._logService.info(`[Orchestrator:_runWorkerTask] workerId=${worker.id}, taskId=${task.id}, worktreePath=${worker.worktreePath}`);
		this._logService.info(`[Orchestrator:_runWorkerTask] task.agent=${task.agent}, task.parsedAgentType.backend=${task.parsedAgentType?.backend}, task.parsedAgentType.agentName=${task.parsedAgentType?.agentName}`);
		this._logService.info(`[Orchestrator:_runWorkerTask] task.context.additionalInstructions=${task.context?.additionalInstructions ? `${task.context.additionalInstructions.length} chars` : '(none)'}`);

		worker.start();

		// Start health monitoring
		this._healthMonitor.startMonitoring(worker.id);
		this._logService.info(`[Orchestrator:_runWorkerTask] Health monitoring started for workerId=${worker.id}`);

		// Initialize circuit breaker if not exists
		if (!this._circuitBreakers.has(worker.id)) {
			this._circuitBreakers.set(worker.id, new CircuitBreaker());
		}
		const circuitBreaker = this._circuitBreakers.get(worker.id)!;

		// Get the parsed agent type - dispatch to appropriate executor based on backend
		const parsedAgentType = task.parsedAgentType;
		if (!parsedAgentType) {
			// This shouldn't happen since we set it during deploy, but handle gracefully
			this._logService.error(`[Orchestrator:_runWorkerTask] ERROR: Task ${task.id} is missing parsedAgentType!`);
			worker.error('Task is missing parsed agent type');
			this._healthMonitor.stopMonitoring(worker.id);
			return;
		}

		// For non-Copilot backends, use the executor registry directly
		// The executor handles its own conversation management
		if (parsedAgentType.backend !== 'copilot') {
			this._logService.info(`[Orchestrator:_runWorkerTask] Backend is '${parsedAgentType.backend}' (not copilot) - dispatching to _runExecutorBasedTask`);
			await this._runExecutorBasedTask(worker, task, parsedAgentType, circuitBreaker);
			this._logService.info(`[Orchestrator:_runWorkerTask] _runExecutorBasedTask completed for workerId=${worker.id}`);
			return;
		}

		this._logService.info(`[Orchestrator:_runWorkerTask] Backend is 'copilot' - using conversation loop`);

		// For Copilot backend, use the existing sophisticated conversation loop
		let currentPrompt = task.description;
		if (task.context?.additionalInstructions) {
			currentPrompt = `${task.context.additionalInstructions}\n\n${currentPrompt}`;
			this._logService.info(`[Orchestrator:_runWorkerTask] Prepended additionalInstructions to prompt, total length=${currentPrompt.length}`);
		}

		worker.addUserMessage(currentPrompt);

		// Get initial model - check for deploy-time override first, then task's model, then default
		const modelOverride = this._workerModelOverrides.get(worker.id);
		let model = await this._selectModel(modelOverride ?? task.modelId);
		if (!model) {
			worker.error('No language model available');
			this._healthMonitor.stopMonitoring(worker.id);
			return;
		}

		const sessionId = generateUuid();

		const pausedEmitter = new Emitter<boolean>();
		this._register(worker.onDidChange(() => {
			if (worker.status === 'paused') {
				pausedEmitter.fire(true);
			} else if (worker.status === 'running') {
				pausedEmitter.fire(false);
			}
		}));

		// CRITICAL: Track stream activity for health monitoring
		// During long-running agent executions, recordActivity() only gets called at iteration
		// start/end. This listener ensures activity is recorded whenever the worker produces
		// output, preventing false idle/stuck detection.
		let lastActivityRecordedAt = 0;
		const ACTIVITY_THROTTLE_MS = 5000; // Record activity at most every 5 seconds
		const streamActivityDisposable = worker.onStreamPart(() => {
			const now = Date.now();
			if (now - lastActivityRecordedAt > ACTIVITY_THROTTLE_MS) {
				lastActivityRecordedAt = now;
				this._healthMonitor.recordActivity(worker.id, 'message');
			}
		});

		// Note: toolInvocationToken is set during deploy() with a synthetic token.
		// This enables tool UI bubbles without waiting for user interaction.

		// Continuous conversation loop - keeps running until worker is completed
		const MAX_RETRIES = 10; // Increased from 3 to handle rate limits better
		let consecutiveFailures = 0;

		while (worker.isActive) {
			// CRITICAL: Check if worker was interrupted before each iteration
			// interrupt() sets status to 'idle' - we should wait for user input before continuing
			if (worker.status === 'idle') {
				const nextMessage = await worker.waitForClarification();
				if (!nextMessage) {
					// Worker was completed/disposed while waiting - exit loop
					break;
				}
				currentPrompt = nextMessage;
				worker.start();
			}

			// Capture the token for THIS iteration - if it gets cancelled, we'll detect it
			const iterationToken = worker.cancellationToken;

			try {
				// Check circuit breaker
				if (!circuitBreaker.canExecute()) {
					const waitTime = Math.ceil((30000 - (Date.now() - (circuitBreaker.lastFailureTime || 0))) / 1000);
					if (waitTime > 0) {
						worker.addAssistantMessage(`[System: Circuit breaker open. Waiting ${waitTime}s before retrying...]`);
						await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
						// Check again after wait
						if (!circuitBreaker.canExecute()) {
							continue;
						}
					}
				}

				// Check for model override before each iteration
				const modelOverride = this._workerModelOverrides.get(worker.id);
				if (modelOverride) {
					const newModel = await this._selectModel(modelOverride);
					if (newModel) {
						model = newModel;
					}
				}

				const stream = new WorkerResponseStream(worker);

				// Build combined instructions from agent file + task context
				const agentInstructions = worker.agentInstructions?.join('\n\n') || '';
				const taskInstructions = task.context?.additionalInstructions || '';
				const combinedInstructions = [agentInstructions, taskInstructions].filter(Boolean).join('\n\n');

				// Get the worker's scoped tool set for proper worktree isolation
				const workerToolSet = this._workerToolSets.get(worker.id);

				// Build conversation history from worker's messages (excluding current prompt)
				// This gives the agent context of previous exchanges in this session
				const history = this._buildConversationHistory(worker, currentPrompt);

				// Record activity start and mark execution in progress
				this._healthMonitor.recordActivity(worker.id, 'message');
				this._healthMonitor.markExecutionStart(worker.id);

				// Run the agent using the proper IAgentRunner service
				// Use the captured iterationToken so interrupt() can stop it
				// Pass the toolInvocationToken if available for inline confirmations
				let result;
				try {
					result = await this._agentRunner.run(
						{
							prompt: currentPrompt,
							sessionId,
							model,
							suggestedFiles: task.context?.suggestedFiles,
							additionalInstructions: combinedInstructions || undefined,
							token: iterationToken,
							onPaused: pausedEmitter.event,
							maxToolCallIterations: 200,
							workerToolSet,
							worktreePath: worker.worktreePath, // Kept for prompt context
							history, // Pass conversation history for context
							toolInvocationToken: worker.toolInvocationToken, // For inline tool confirmations
						},
						stream as unknown as vscode.ChatResponseStream
					);
				} finally {
					// Mark execution complete regardless of success/failure
					this._healthMonitor.markExecutionEnd(worker.id);
				}

				stream.flush();

				// CRITICAL: Check if this iteration was interrupted BEFORE processing results
				// interrupt() cancels the token - if it's cancelled, don't process as normal
				if (iterationToken.isCancellationRequested) {
					this._logService.info(`[OrchestratorService] Worker ${worker.id} iteration was interrupted - stopping loop`);
					// Worker is already in 'idle' state from interrupt(), loop will wait at top
					continue;
				}

				if (!result.success && result.error) {
					// Record failure with error message for immediate parent notification
					this._healthMonitor.recordActivity(worker.id, 'error', result.error);
					circuitBreaker.recordFailure();

					// Check if this was a cancellation from interrupt
					const isCancellation = result.error.includes('Canceled') ||
						result.error.includes('cancelled') ||
						result.error.includes('aborted') ||
						worker.status === 'idle'; // interrupt() sets status to idle

					if (isCancellation) {
						// Don't treat cancellation as an error - wait for user input
						const nextMessage = await worker.waitForClarification();
						if (!nextMessage) {
							break;
						}
						currentPrompt = nextMessage;
						worker.start();
						continue;
					}

					consecutiveFailures++;

					// Check if error is retryable (empty response, timeout, rate limit)
					const errorLower = result.error.toLowerCase();
					const isRateLimit = errorLower.includes('rate limit') ||
						errorLower.includes('rate_limit') ||
						errorLower.includes('too many requests') ||
						errorLower.includes('429') ||
						errorLower.includes('quota') ||
						errorLower.includes('exceeded');
					const isRetryable = isRateLimit ||
						errorLower.includes('no response') ||
						errorLower.includes('timeout') ||
						errorLower.includes('empty') ||
						errorLower.includes('econnreset') ||
						errorLower.includes('network');

					if (isRetryable && consecutiveFailures < MAX_RETRIES) {
						// Use longer delay for rate limits (30s base), shorter for other errors (2s base)
						const baseDelay = isRateLimit ? 30000 : 2000;
						const delay = baseDelay * consecutiveFailures;
						this._logService.warn(`[OrchestratorService] RETRYABLE ERROR for worker ${worker.id}: ${result.error} (attempt ${consecutiveFailures}/${MAX_RETRIES}, waiting ${delay}ms)`);
						worker.addAssistantMessage(`[System: ${isRateLimit ? 'Rate limited' : 'Error'}: ${result.error}. Retrying in ${Math.ceil(delay / 1000)}s (attempt ${consecutiveFailures}/${MAX_RETRIES})]`);

						// Immediately notify parent of the error (before waiting for retry)
						if (task.parentWorkerId) {
							this._taskMonitorService.queueUpdate({
								type: 'error',
								subTaskId: task.id,
								parentWorkerId: task.parentWorkerId,
								error: result.error,
								retryInfo: {
									attempt: consecutiveFailures,
									maxAttempts: MAX_RETRIES,
									nextRetryInMs: delay,
									willRetry: true,
								},
								timestamp: Date.now(),
							});
						}

						await new Promise(resolve => setTimeout(resolve, delay));
						continue;
					}

					this._logService.error(`[OrchestratorService] FATAL ERROR for worker ${worker.id}: ${result.error} (exhausted ${MAX_RETRIES} retries)`);
					worker.error(result.error);
					break;
				}

				// Record success
				this._healthMonitor.recordActivity(worker.id, 'success');
				circuitBreaker.recordSuccess();

				// Reset failure counter on success
				consecutiveFailures = 0;

				// Mark as idle and wait for next message
				worker.idle();

				// Wait for user clarification or completion
				const nextMessage = await worker.waitForClarification();
				if (!nextMessage) {
					// Worker was completed or disposed
					break;
				}

				// Continue with the new message
				currentPrompt = nextMessage;
				worker.start();

			} catch (error) {
				const errorMessage = String(error);
				// Record failure with error message for immediate parent notification
				this._healthMonitor.recordActivity(worker.id, 'error', errorMessage);
				circuitBreaker.recordFailure();

				// Check if this was an interrupt (user clicked interrupt button)
				// We check worker status because interrupt() sets it to 'idle' and creates a fresh token
				const isCancellation = errorMessage.includes('Canceled') ||
					errorMessage.includes('cancelled') ||
					errorMessage.includes('aborted') ||
					worker.status === 'idle'; // interrupt() sets status to idle

				if (isCancellation) {
					// Worker.interrupt() already set status to idle
					// Wait for user to send a new message before continuing
					const nextMessage = await worker.waitForClarification();
					if (!nextMessage) {
						// Worker was completed or disposed
						break;
					}
					// User sent a message - continue the loop with their input
					currentPrompt = nextMessage;
					worker.start();
					continue;
				}

				consecutiveFailures++;

				// Check if error is retryable - network errors and rate limits
				const isRateLimitError = errorMessage.toLowerCase().includes('rate limit') ||
					errorMessage.toLowerCase().includes('rate_limit') ||
					errorMessage.toLowerCase().includes('too many requests') ||
					errorMessage.includes('429') ||
					errorMessage.toLowerCase().includes('quota') ||
					errorMessage.toLowerCase().includes('exceeded');

				const isNetworkError = errorMessage.includes('ECONNRESET') ||
					errorMessage.includes('ETIMEDOUT') ||
					errorMessage.includes('network') ||
					errorMessage.includes('abort');

				const isRetryable = isRateLimitError || isNetworkError;

				if (isRetryable && consecutiveFailures < MAX_RETRIES) {
					// Use longer delay for rate limits (30s base), shorter for network errors (2s base)
					const baseDelay = isRateLimitError ? 30000 : 2000;
					const delay = baseDelay * consecutiveFailures;
					this._logService.warn(`[Orchestrator] Worker ${worker.id}: ${isRateLimitError ? 'Rate limit' : 'Network'} error, retry ${consecutiveFailures}/${MAX_RETRIES} after ${delay / 1000}s`);
					worker.addAssistantMessage(`[System: ${isRateLimitError ? 'Rate limited' : 'Network error'}, retrying in ${delay / 1000}s (attempt ${consecutiveFailures}/${MAX_RETRIES})]`);

					// Immediately notify parent of the error (before waiting for retry)
					if (task.parentWorkerId) {
						this._taskMonitorService.queueUpdate({
							type: 'error',
							subTaskId: task.id,
							parentWorkerId: task.parentWorkerId,
							error: errorMessage,
							retryInfo: {
								attempt: consecutiveFailures,
								maxAttempts: MAX_RETRIES,
								nextRetryInMs: delay,
								willRetry: consecutiveFailures < MAX_RETRIES,
							},
							timestamp: Date.now(),
						});
					}

					await new Promise(resolve => setTimeout(resolve, delay));
					continue;
				}

				this._logService.error(`[Orchestrator] Worker ${worker.id} failed after ${consecutiveFailures} attempts: ${errorMessage}`);
				worker.error(errorMessage);
				break;
			}
		}

		// Cleanup: dispose stream activity listener and stop health monitoring
		streamActivityDisposable.dispose();
		this._healthMonitor.stopMonitoring(worker.id);
	}

	/**
	 * Run a task using an executor from the registry (for non-Copilot backends like Claude).
	 * The executor handles its own conversation management and tools.
	 */
	private async _runExecutorBasedTask(
		worker: WorkerSession,
		task: WorkerTask,
		parsedAgentType: ParsedAgentType,
		circuitBreaker: CircuitBreaker
	): Promise<void> {
		this._logService.info(`[Orchestrator:_runExecutorBasedTask] ========== EXECUTOR-BASED TASK STARTING ==========`);
		this._logService.info(`[Orchestrator:_runExecutorBasedTask] workerId=${worker.id}, taskId=${task.id}, backend=${parsedAgentType.backend}, agent=${parsedAgentType.agentName}`);
		this._logService.info(`[Orchestrator:_runExecutorBasedTask] worktreePath=${worker.worktreePath}`);
		this._logService.info(`[Orchestrator:_runExecutorBasedTask] task.description length=${task.description.length}, task.context.additionalInstructions=${task.context?.additionalInstructions ? `${task.context.additionalInstructions.length} chars` : '(none)'}`);

		const MAX_RETRIES = 10;
		let consecutiveFailures = 0;

		let currentPrompt = task.description;
		if (task.context?.additionalInstructions) {
			currentPrompt = `${task.context.additionalInstructions}\n\n${currentPrompt}`;
			this._logService.info(`[Orchestrator:_runExecutorBasedTask] Prepended additionalInstructions, final prompt length=${currentPrompt.length}`);
		} else {
			this._logService.info(`[Orchestrator:_runExecutorBasedTask] No additionalInstructions to prepend`);
		}

		// Get the executor for this backend
		const executor = this._executorRegistry.getExecutor(parsedAgentType);
		this._logService.info(`[Orchestrator:_runExecutorBasedTask] Got executor: ${executor ? executor.backendType : '(null!)'}`);

		// Get the worker's scoped tool set
		const workerToolSet = this._workerToolSets.get(worker.id);
		this._logService.info(`[Orchestrator:_runExecutorBasedTask] WorkerToolSet: ${workerToolSet ? 'present' : '(null!)'}, workerContext=${workerToolSet?.workerContext ? 'present' : '(null)'}`);

		// Get initial model
		const modelOverride = this._workerModelOverrides.get(worker.id);
		const model = await this._selectModel(modelOverride ?? task.modelId);
		this._logService.info(`[Orchestrator:_runExecutorBasedTask] Model: ${model?.id ?? '(null!)'}`);

		// Build conversation history
		const history = this._buildConversationHistory(worker, currentPrompt);

		// Paused event emitter for the executor
		const pausedEmitter = new Emitter<boolean>();
		this._register(worker.onDidChange(() => {
			if (worker.status === 'paused') {
				pausedEmitter.fire(true);
			} else if (worker.status === 'running') {
				pausedEmitter.fire(false);
			}
		}));

		// CRITICAL: Track stream activity for health monitoring
		// During long-running Claude executions, recordActivity() only gets called at iteration
		// start/end. This listener ensures activity is recorded whenever the worker produces
		// output, preventing false idle/stuck detection.
		let lastActivityRecordedAt = 0;
		const ACTIVITY_THROTTLE_MS = 5000; // Record activity at most every 5 seconds
		const streamActivityDisposable = worker.onStreamPart(() => {
			const now = Date.now();
			if (now - lastActivityRecordedAt > ACTIVITY_THROTTLE_MS) {
				lastActivityRecordedAt = now;
				this._healthMonitor.recordActivity(worker.id, 'message');
			}
		});

		this._logService.info(`[Orchestrator:_runExecutorBasedTask] ========== STARTING ${parsedAgentType.backend.toUpperCase()} EXECUTOR LOOP ==========`);
		this._logService.info(`[Orchestrator:_runExecutorBasedTask] worker.isActive=${worker.isActive}, worker.status=${worker.status}`);

		// Conversation loop for executor-based tasks
		while (worker.isActive) {
			// CRITICAL: Check if worker was interrupted before each iteration
			if (worker.status === 'idle') {
				const nextMessage = await worker.waitForClarification();
				if (!nextMessage) {
					break;
				}
				currentPrompt = nextMessage;
				worker.start();
			}

			// Capture the token for THIS iteration
			const iterationToken = worker.cancellationToken;

			try {
				// Check circuit breaker
				if (!circuitBreaker.canExecute()) {
					const waitTime = Math.ceil((30000 - (Date.now() - (circuitBreaker.lastFailureTime || 0))) / 1000);
					if (waitTime > 0) {
						worker.addAssistantMessage(`[System: Circuit breaker open. Waiting ${waitTime}s before retrying...]`);
						await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
						if (!circuitBreaker.canExecute()) {
							continue;
						}
					}
				}

				worker.addUserMessage(currentPrompt);

				// Record activity start and mark execution in progress
				this._healthMonitor.recordActivity(worker.id, 'message');
				this._healthMonitor.markExecutionStart(worker.id);

				// Create response stream for the executor
				const stream = new WorkerResponseStream(worker);

				// Execute using the executor
				let result;
				try {
					result = await executor.execute(
						{
							taskId: task.id,
							prompt: currentPrompt,
							worktreePath: worker.worktreePath,
							agentType: parsedAgentType,
							parentWorkerId: task.parentWorkerId,
							model,
							modelId: modelOverride ?? task.modelId,
							options: {
								maxToolCallIterations: 200,
							},
							history,
							additionalInstructions: task.context?.additionalInstructions,
							workerToolSet,
							workerContext: workerToolSet?.workerContext,
							toolInvocationToken: worker.toolInvocationToken,
							token: iterationToken,
							onPaused: pausedEmitter.event,
						},
						stream as unknown as vscode.ChatResponseStream
					);
				} finally {
					// Mark execution complete regardless of success/failure
					this._healthMonitor.markExecutionEnd(worker.id);
				}

				stream.flush();

				// Check if this iteration was interrupted
				if (iterationToken.isCancellationRequested) {
					this._logService.info(`[OrchestratorService] Worker ${worker.id} (executor) iteration was interrupted`);
					continue; // Loop will wait at top for user input
				}

				if (result.status === 'failed' && result.error) {
					// Record failure with error message for immediate parent notification
					this._healthMonitor.recordActivity(worker.id, 'error', result.error);
					circuitBreaker.recordFailure();

					// Check if this was a cancellation
					const isCancellation = result.error.includes('Canceled') ||
						result.error.includes('cancelled') ||
						result.error.includes('aborted') ||
						worker.status === 'idle';

					if (isCancellation) {
						const nextMessage = await worker.waitForClarification();
						if (!nextMessage) {
							break;
						}
						currentPrompt = nextMessage;
						worker.start();
						continue;
					}

					consecutiveFailures++;

					// Check if error is retryable
					const errorLower = result.error.toLowerCase();
					const isRateLimit = errorLower.includes('rate limit') ||
						errorLower.includes('rate_limit') ||
						errorLower.includes('429') ||
						errorLower.includes('quota');
					const isRetryable = isRateLimit ||
						errorLower.includes('timeout') ||
						errorLower.includes('network');

					if (isRetryable && consecutiveFailures < MAX_RETRIES) {
						const baseDelay = isRateLimit ? 30000 : 2000;
						const delay = baseDelay * consecutiveFailures;
						this._logService.warn(`[OrchestratorService] Executor error for worker ${worker.id}: ${result.error} (retry ${consecutiveFailures}/${MAX_RETRIES})`);
						worker.addAssistantMessage(`[System: ${isRateLimit ? 'Rate limited' : 'Error'}. Retrying in ${Math.ceil(delay / 1000)}s]`);

						// Immediately notify parent of the error (before waiting for retry)
						if (task.parentWorkerId) {
							this._taskMonitorService.queueUpdate({
								type: 'error',
								subTaskId: task.id,
								parentWorkerId: task.parentWorkerId,
								error: result.error,
								retryInfo: {
									attempt: consecutiveFailures,
									maxAttempts: MAX_RETRIES,
									nextRetryInMs: delay,
									willRetry: consecutiveFailures < MAX_RETRIES,
								},
								timestamp: Date.now(),
							});
						}

						await new Promise(resolve => setTimeout(resolve, delay));
						continue;
					}

					this._logService.error(`[OrchestratorService] Executor failed for worker ${worker.id}: ${result.error}`);
					worker.error(result.error);
					break;
				}

				// Record success
				this._healthMonitor.recordActivity(worker.id, 'success');
				circuitBreaker.recordSuccess();
				consecutiveFailures = 0;

				// Mark as idle and wait for next message
				worker.idle();

				const nextMessage = await worker.waitForClarification();
				if (!nextMessage) {
					break;
				}

				currentPrompt = nextMessage;
				worker.start();

			} catch (error) {
				const errorMessage = String(error);
				// Record failure with error message for immediate parent notification
				this._healthMonitor.recordActivity(worker.id, 'error', errorMessage);
				circuitBreaker.recordFailure();

				const isCancellation = errorMessage.includes('Canceled') ||
					errorMessage.includes('cancelled') ||
					worker.status === 'idle';

				if (isCancellation) {
					const nextMessage = await worker.waitForClarification();
					if (!nextMessage) {
						break;
					}
					currentPrompt = nextMessage;
					worker.start();
					continue;
				}

				consecutiveFailures++;
				if (consecutiveFailures < MAX_RETRIES) {
					const delay = 2000 * consecutiveFailures;
					this._logService.warn(`[OrchestratorService] Executor exception for worker ${worker.id}: ${errorMessage} (retry ${consecutiveFailures}/${MAX_RETRIES})`);

					// Immediately notify parent of the error (before waiting for retry)
					if (task.parentWorkerId) {
						this._taskMonitorService.queueUpdate({
							type: 'error',
							subTaskId: task.id,
							parentWorkerId: task.parentWorkerId,
							error: errorMessage,
							retryInfo: {
								attempt: consecutiveFailures,
								maxAttempts: MAX_RETRIES,
								nextRetryInMs: delay,
								willRetry: consecutiveFailures < MAX_RETRIES,
							},
							timestamp: Date.now(),
						});
					}

					await new Promise(resolve => setTimeout(resolve, delay));
					continue;
				}

				this._logService.error(`[OrchestratorService] Executor failed for worker ${worker.id}: ${errorMessage}`);
				worker.error(errorMessage);
				break;
			}
		}

		// Cleanup: dispose stream activity listener and stop health monitoring
		streamActivityDisposable.dispose();
		this._healthMonitor.stopMonitoring(worker.id);
	}

	/**
	 * Build conversation history from the worker's messages for passing to the agent.
	 * Excludes the current prompt since that will be added as the new request.
	 * Only includes user/assistant message pairs, excluding system and tool messages.
	 */
	private _buildConversationHistory(worker: WorkerSession, currentPrompt: string): Array<{ role: 'user' | 'assistant'; content: string }> {
		const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
		const messages = worker.state.messages;

		for (const msg of messages) {
			// Skip system messages and tool messages - they're not part of conversational history
			if (msg.role === 'system' || msg.role === 'tool') {
				continue;
			}

			// Skip the current prompt (it will be added as the new request)
			if (msg.role === 'user' && msg.content === currentPrompt) {
				continue;
			}

			if (msg.role === 'user' || msg.role === 'assistant') {
				history.push({
					role: msg.role,
					content: msg.content,
				});
			}
		}

		return history;
	}

	private async _selectModel(preferredModelId?: string): Promise<vscode.LanguageModelChat | undefined> {
		// Premium models preferred for workers (in priority order based on capability)
		// These patterns match model families/IDs available in Copilot subscription
		const PREFERRED_MODEL_PATTERNS = [
			// Claude models (best for complex reasoning)
			'claude-opus',          // Claude Opus (any version)
			'claude-3.7-sonnet',    // Claude 3.7 Sonnet
			'claude-3.5-sonnet',    // Claude 3.5 Sonnet
			'claude-sonnet',        // Any Claude Sonnet
			// Gemini models (good balance)
			'gemini-2.5-pro',       // Gemini 2.5 Pro
			'gemini-2.0-pro',       // Gemini 2.0 Pro
			'gemini-pro',           // Any Gemini Pro
			// GPT models (reliable)
			'gpt-4.1',              // GPT 4.1
			'gpt-4o',               // GPT-4o
			'o3',                   // O3 models
			'o1',                   // O1 models
		];

		this._logService.info(`[OrchestratorService] _selectModel called, preferredModelId=${preferredModelId || 'none'}`);

		// If a specific model is requested, try to find it
		if (preferredModelId) {
			const models = await vscode.lm.selectChatModels({ id: preferredModelId });
			if (models.length > 0) {
				this._logService.info(`[OrchestratorService] Found model by ID: ${models[0].id} (vendor: ${models[0].vendor}, family: ${models[0].family})`);
				return models[0];
			}
			// Also try by family
			const byFamily = await vscode.lm.selectChatModels({ vendor: 'copilot', family: preferredModelId });
			if (byFamily.length > 0) {
				this._logService.info(`[OrchestratorService] Found model by family: ${byFamily[0].id} (vendor: ${byFamily[0].vendor}, family: ${byFamily[0].family})`);
				return byFamily[0];
			}
			this._logService.warn(`[OrchestratorService] Requested model '${preferredModelId}' not found, trying preferred models...`);
		}

		// Get all copilot models and try to find a preferred one
		const copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
		this._logService.info(`[OrchestratorService] Available copilot models: ${copilotModels.map(m => `${m.id} (${m.family})`).join(', ')}`);

		// Try each preferred model pattern in order
		for (const preferredPattern of PREFERRED_MODEL_PATTERNS) {
			const match = copilotModels.find(m =>
				m.family?.toLowerCase().includes(preferredPattern.toLowerCase()) ||
				m.id?.toLowerCase().includes(preferredPattern.toLowerCase())
			);
			if (match) {
				this._logService.info(`[OrchestratorService] Selected preferred model: ${match.id} (vendor: ${match.vendor}, family: ${match.family})`);
				return match;
			}
		}

		// If no preferred model found, use any copilot model
		if (copilotModels.length > 0) {
			this._logService.warn(`[OrchestratorService] No preferred model found, falling back to: ${copilotModels[0].id} (vendor: ${copilotModels[0].vendor}, family: ${copilotModels[0].family})`);
			return copilotModels[0];
		}

		// Last resort: any model (may cause rate limiting!)
		const allModels = await vscode.lm.selectChatModels();
		if (allModels.length > 0) {
			this._logService.warn(`[OrchestratorService] FALLBACK to non-copilot model: ${allModels[0].id} (vendor: ${allModels[0].vendor}) - this may cause rate limiting!`);
			return allModels[0];
		}

		this._logService.error(`[OrchestratorService] No models available at all!`);
		return undefined;
	}
}
