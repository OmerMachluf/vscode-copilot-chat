/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Emitter, Event } from '../../util/vs/base/common/event';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { generateUuid } from '../../util/vs/base/common/uuid';
import { IInstantiationService, createDecorator } from '../../util/vs/platform/instantiation/common/instantiation';
import { Intent } from '../common/constants';
import { ChatParticipantRequestHandler } from '../prompt/node/chatParticipantRequestHandler';
import { SerializedWorkerState, WorkerResponseStream, WorkerSession, WorkerSessionState } from './workerSession';

export const IOrchestratorService = createDecorator<IOrchestratorService>('orchestratorService');

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
 * Task definition for a worker
 */
export interface WorkerTask {
	readonly id: string;
	/** Human-readable name used for branch naming */
	readonly name: string;
	readonly description: string;
	readonly priority: 'high' | 'normal' | 'low';
	readonly dependencies?: string[]; // IDs of tasks that must complete first
	readonly context?: WorkerTaskContext;
	/** Base branch to create the worktree from (defaults to main/master) */
	readonly baseBranch?: string;
	/** Plan ID this task belongs to (undefined = ad-hoc task) */
	readonly planId?: string;
	/** Language model ID to use for this task (uses default if not specified) */
	readonly modelId?: string;
}

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
}

/**
 * Options for creating a task
 */
export interface CreateTaskOptions {
	/** Human-readable name (used for branch naming) */
	name?: string;
	priority?: 'high' | 'normal' | 'low';
	context?: WorkerTaskContext;
	/** Base branch to create worktree from */
	baseBranch?: string;
	/** Plan to add this task to (undefined = ad-hoc) */
	planId?: string;
	/** Language model ID to use for this task */
	modelId?: string;
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

	// --- Plan Management ---

	/** Get all plans */
	getPlans(): readonly OrchestratorPlan[];

	/** Get the active plan ID */
	getActivePlanId(): string | undefined;

	/** Set the active plan */
	setActivePlan(planId: string | undefined): void;

	/** Create a new plan */
	createPlan(name: string, description: string, baseBranch?: string): OrchestratorPlan;

	/** Delete a plan and its pending tasks */
	deletePlan(planId: string): void;

	// --- Task Management ---

	/** Get all worker states */
	getWorkerStates(): WorkerSessionState[];

	/** Get a specific worker's state */
	getWorkerState(workerId: string): WorkerSessionState | undefined;

	/** Get tasks for a specific plan (undefined = ad-hoc tasks) */
	getTasks(planId?: string): readonly WorkerTask[];

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

	// --- Worker Management ---

	/** Deploy a worker for a specific task or the first pending task */
	deploy(taskId?: string): Promise<WorkerSession>;

	/** Deploy workers for all pending tasks in a plan */
	deployAll(planId?: string): Promise<WorkerSession[]>;

	/** Send a message to a worker */
	sendMessageToWorker(workerId: string, message: string): void;

	/** Handle an approval request */
	handleApproval(workerId: string, approvalId: string, approved: boolean, clarification?: string): void;

	/** Pause a worker */
	pauseWorker(workerId: string): void;

	/** Resume a worker */
	resumeWorker(workerId: string): void;

	/** Stop and remove a worker (does not push changes) */
	concludeWorker(workerId: string): void;

	/** Complete a worker: push to origin and clean up worktree */
	completeWorker(workerId: string): Promise<void>;

	// Legacy compatibility
	getWorkers(): Record<string, any>;
}

/**
 * Orchestrator service implementation
 * Manages multiple worker sessions running in parallel across multiple plans
 */
export class OrchestratorService extends Disposable implements IOrchestratorService {
	declare readonly _serviceBrand: undefined;

	private static readonly STATE_VERSION = 2;
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

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
		// Restore state on initialization
		this._restoreState();
		// Detect default branch
		this._detectDefaultBranch();
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

	public getPlan(): readonly WorkerTask[] {
		return this.getTasks(this._activePlanId);
	}

	public addTask(description: string, options: CreateTaskOptions = {}): WorkerTask {
		const {
			name = this._generateTaskName(description),
			priority = 'normal',
			context,
			baseBranch,
			planId = this._activePlanId,
			modelId,
		} = options;

		const task: WorkerTask = {
			id: `task-${this._nextTaskId++}`,
			name: this._sanitizeBranchName(name),
			description,
			priority,
			context,
			baseBranch,
			planId,
			modelId,
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

	public async deploy(taskId?: string): Promise<WorkerSession> {
		const task = taskId
			? this._tasks.find(t => t.id === taskId)
			: this._tasks.find(t => t.planId === this._activePlanId) || this._tasks[0];

		if (!task) {
			throw new Error('No tasks available');
		}

		// Remove the task from pending
		const taskIndex = this._tasks.indexOf(task);
		if (taskIndex >= 0) {
			this._tasks.splice(taskIndex, 1);
		}

		// Get the plan for base branch resolution
		const plan = task.planId ? this._plans.find(p => p.id === task.planId) : undefined;
		const baseBranch = this._getBaseBranch(task, plan);

		// Create worktree
		const worktreePath = await this._createWorktree(task.name, baseBranch);

		// Create worker session
		const worker = new WorkerSession(
			task.name,
			task.description,
			worktreePath,
			task.planId,
			baseBranch,
		);

		this._workers.set(worker.id, worker);

		this._register(worker.onDidChange(() => {
			this._onDidChangeWorkers.fire();
			this._saveState();
		}));

		this._register(worker.onDidComplete(() => {
			this._saveState();
		}));

		this._onDidChangeWorkers.fire();
		this._saveState();

		// Start the worker task asynchronously
		this._runWorkerTask(worker, task).catch(error => {
			worker.error(String(error));
		});

		return worker;
	}

	public async deployAll(planId?: string): Promise<WorkerSession[]> {
		const targetPlanId = planId ?? this._activePlanId;
		const workers: WorkerSession[] = [];
		const tasksCopy = this._tasks.filter(t => t.planId === targetPlanId);

		await Promise.all(tasksCopy.map(async (task) => {
			try {
				const worker = await this.deploy(task.id);
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

	public concludeWorker(workerId: string): void {
		const worker = this._workers.get(workerId);
		if (worker) {
			worker.dispose();
			this._workers.delete(workerId);
			this._onDidChangeWorkers.fire();
			this._saveState();
		}
	}

	public async completeWorker(workerId: string): Promise<void> {
		const worker = this._workers.get(workerId);
		if (!worker) {
			throw new Error(`Worker ${workerId} not found`);
		}

		const worktreePath = worker.worktreePath;
		const branchName = worker.name;

		// Mark worker as completed first - this will break the conversation loop
		worker.complete();

		try {
			// Commit any uncommitted changes
			await this._execGit(['add', '-A'], worktreePath);
			await this._execGit(['commit', '-m', `Complete task: ${worker.task}`, '--allow-empty'], worktreePath);

			// Push to origin
			await this._execGit(['push', '-u', 'origin', branchName], worktreePath);

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

			vscode.window.showInformationMessage(`Task "${branchName}" completed and pushed to origin/${branchName}`);
		} catch (error) {
			throw new Error(`Failed to complete worker: ${error}`);
		}
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

		const worktreesDir = path.join(workspaceFolder, '..', '.worktrees');
		if (!fs.existsSync(worktreesDir)) {
			fs.mkdirSync(worktreesDir, { recursive: true });
		}

		const worktreePath = path.join(worktreesDir, taskName);
		const branchName = taskName;

		// Check if worktree already exists
		if (fs.existsSync(worktreePath)) {
			return worktreePath;
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
					if (fs.existsSync(worktreePath)) {
						return worktreePath;
					}
					throw error;
				}
			} else {
				throw error;
			}
		}

		return worktreePath;
	}

	private async _runWorkerTask(worker: WorkerSession, task: WorkerTask): Promise<void> {
		worker.start();

		let currentPrompt = task.description;
		if (task.context?.additionalInstructions) {
			currentPrompt = `${task.context.additionalInstructions}\n\n${currentPrompt}`;
		}

		worker.addUserMessage(currentPrompt);

		// Get a real language model (once for the entire session)
		const model = await this._selectModel(task.modelId);
		if (!model) {
			worker.error('No language model available');
			return;
		}

		const tokenSource = new vscode.CancellationTokenSource();

		const pausedEmitter = new Emitter<boolean>();
		this._register(worker.onDidChange(() => {
			if (worker.status === 'paused') {
				pausedEmitter.fire(true);
			} else if (worker.status === 'running') {
				pausedEmitter.fire(false);
			}
		}));

		// Continuous conversation loop - keeps running until worker is completed
		while (worker.isActive) {
			try {
				const stream = new WorkerResponseStream(worker);

				// Create mock request with current prompt
				const mockRequest = this._createMockRequest(currentPrompt, model, task.context?.suggestedFiles);

				const requestHandler = this._instantiationService.createInstance(
					ChatParticipantRequestHandler,
					[],
					mockRequest,
					stream as unknown as vscode.ChatResponseStream,
					tokenSource.token,
					{
						agentName: 'copilot',
						agentId: 'github.copilot.default',
						intentId: Intent.Agent,
					},
					pausedEmitter.event
				);

				await requestHandler.getResult();
				stream.flush();

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
				worker.error(String(error));
				break;
			}
		}

		tokenSource.dispose();
	}

	private async _selectModel(preferredModelId?: string): Promise<vscode.LanguageModelChat | undefined> {
		// If a specific model is requested, try to find it
		if (preferredModelId) {
			const models = await vscode.lm.selectChatModels({ id: preferredModelId });
			if (models.length > 0) {
				return models[0];
			}
		}

		// Fallback to any available model (prefer copilot vendor)
		const copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
		if (copilotModels.length > 0) {
			return copilotModels[0];
		}

		// Last resort: any model
		const allModels = await vscode.lm.selectChatModels();
		return allModels[0];
	}

	private _createMockRequest(prompt: string, model: vscode.LanguageModelChat, suggestedFiles?: string[]): vscode.ChatRequest {
		const sessionId = generateUuid();
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;

		const references: vscode.ChatPromptReference[] = [];
		if (suggestedFiles && workspaceFolder) {
			for (const filePath of suggestedFiles) {
				const fileUri = path.isAbsolute(filePath)
					? vscode.Uri.file(filePath)
					: vscode.Uri.joinPath(workspaceFolder, filePath);

				references.push({
					id: 'vscode.file',
					name: path.basename(filePath),
					value: fileUri,
				});
			}
		}

		return {
			prompt,
			command: undefined,
			references,
			toolReferences: [],
			variables: {},
			id: generateUuid(),
			sessionId,
			model,
			tools: new Map(), // Empty map means all tools enabled (default behavior)
			location: vscode.ChatLocation.Panel, // ChatParticipantRequestHandler overrides location based on intent
			attempt: 0,
			enableCommandDetection: false,
			justification: undefined,
			acceptedConfirmationData: undefined,
			editedFileEvents: undefined,
		} as unknown as vscode.ChatRequest;
	}
}
