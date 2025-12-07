/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CancellationToken, CancellationTokenSource } from '../../util/vs/base/common/cancellation';
import { Emitter, Event } from '../../util/vs/base/common/event';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { generateUuid } from '../../util/vs/base/common/uuid';

/**
 * Represents a message in a worker's conversation history
 */
export interface WorkerMessage {
	readonly id: string;
	readonly timestamp: number;
	readonly role: 'user' | 'assistant' | 'system' | 'tool';
	readonly content: string;
	readonly toolName?: string;
	readonly toolCallId?: string;
	readonly isApprovalRequest?: boolean;
	readonly isPending?: boolean;
}

/**
 * Represents a pending approval request for a tool call
 */
export interface PendingApproval {
	readonly id: string;
	readonly timestamp: number;
	readonly toolName: string;
	readonly toolCallId: string;
	readonly description: string;
	readonly parameters: Record<string, unknown>;
	resolve: (approved: boolean, clarification?: string) => void;
}

/**
 * Worker status
 * - idle: Worker has finished current task but is still active and accepting messages
 * - running: Worker is actively processing
 * - waiting-approval: Worker is waiting for user approval on a tool call
 * - paused: Worker is manually paused by user
 * - completed: Worker is fully done and will be cleaned up (user clicked Complete)
 * - error: Worker encountered an error
 */
export type WorkerStatus = 'idle' | 'running' | 'waiting-approval' | 'paused' | 'completed' | 'error';

/**
 * Serializable worker state for persistence
 */
export interface SerializedWorkerState {
	readonly id: string;
	readonly name: string;
	readonly task: string;
	readonly worktreePath: string;
	readonly status: WorkerStatus;
	readonly messages: WorkerMessage[];
	readonly createdAt: number;
	readonly lastActivityAt: number;
	readonly errorMessage?: string;
	readonly planId?: string;
	readonly baseBranch?: string;
	readonly agentId?: string;
	readonly agentInstructions?: string[];
}

/**
 * Worker session state
 */
export interface WorkerSessionState {
	readonly id: string;
	readonly name: string;
	readonly task: string;
	readonly worktreePath: string;
	readonly status: WorkerStatus;
	readonly messages: readonly WorkerMessage[];
	readonly pendingApprovals: readonly PendingApproval[];
	readonly createdAt: number;
	readonly lastActivityAt: number;
	readonly errorMessage?: string;
	readonly planId?: string;
	readonly baseBranch?: string;
}

/**
 * Manages a single worker's conversation session and state.
 * Each worker runs as an independent agent with its own conversation history.
 */
export class WorkerSession extends Disposable {
	private readonly _id: string;
	private readonly _name: string;
	private readonly _task: string;
	private readonly _worktreePath: string;
	private readonly _planId?: string;
	private readonly _baseBranch?: string;
	private _status: WorkerStatus = 'idle';
	private _messages: WorkerMessage[] = [];
	private _pendingApprovals: Map<string, PendingApproval> = new Map();
	private readonly _createdAt: number;
	private _lastActivityAt: number;
	private _errorMessage?: string;
	private _isPaused = false;
	private _pauseResolve?: () => void;
	private _clarificationResolve?: (message: string) => void;
	private _pendingClarification?: string;
	private readonly _agentId?: string;
	private readonly _agentInstructions?: string[];
	private _cancellationTokenSource: CancellationTokenSource;

	private readonly _onDidChange = this._register(new Emitter<void>());
	public readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidComplete = this._register(new Emitter<void>());
	public readonly onDidComplete: Event<void> = this._onDidComplete.event;

	private readonly _onNeedsClarification = this._register(new Emitter<string>());
	public readonly onNeedsClarification: Event<string> = this._onNeedsClarification.event;

	private readonly _onDidStop = this._register(new Emitter<void>());
	public readonly onDidStop: Event<void> = this._onDidStop.event;

	constructor(
		name: string,
		task: string,
		worktreePath: string,
		planId?: string,
		baseBranch?: string,
		agentId?: string,
		agentInstructions?: string[],
	) {
		super();
		this._id = `worker-${generateUuid().substring(0, 8)}`;
		this._name = name;
		this._task = task;
		this._worktreePath = worktreePath;
		this._planId = planId;
		this._baseBranch = baseBranch;
		this._agentId = agentId;
		this._agentInstructions = agentInstructions;
		this._createdAt = Date.now();
		this._lastActivityAt = this._createdAt;
		this._cancellationTokenSource = new CancellationTokenSource();

		// Add initial system message
		this._addMessage({
			role: 'system',
			content: `Worker initialized for task: ${task}\nWorktree: ${worktreePath}${agentId ? `\nAgent: ${agentId}` : ''}`,
		});
	}

	/**
	 * Get the cancellation token for this worker's current operation.
	 * The orchestrator should pass this to the agent runner.
	 */
	public get cancellationToken(): CancellationToken {
		return this._cancellationTokenSource.token;
	}

	/**
	 * Interrupt the current agent operation. This cancels the current LLM/tool iteration
	 * and puts the worker in idle state so the user can provide feedback or redirect.
	 * Unlike kill/stop, this keeps the worker alive and ready for new messages.
	 */
	public interrupt(): void {
		if (this._status !== 'running' && this._status !== 'waiting-approval') {
			return; // Nothing to interrupt
		}

		this._addMessage({
			role: 'system',
			content: '⏸️ Agent interrupted by user. Send a message to continue or redirect.',
		});

		// Cancel current operation
		this._cancellationTokenSource.cancel();

		// Create new token source for future operations
		this._cancellationTokenSource = new CancellationTokenSource();

		// Go to idle state - worker is still active and can receive new messages
		this._status = 'idle';
		this._onDidStop.fire();
		this._onDidChange.fire();
	}

	/**
	 * @deprecated Use interrupt() instead
	 */
	public stop(): void {
		this.interrupt();
	}

	public get id(): string {
		return this._id;
	}

	public get name(): string {
		return this._name;
	}

	public get task(): string {
		return this._task;
	}

	public get worktreePath(): string {
		return this._worktreePath;
	}

	public get planId(): string | undefined {
		return this._planId;
	}

	public get baseBranch(): string | undefined {
		return this._baseBranch;
	}

	public get agentId(): string | undefined {
		return this._agentId;
	}

	public get agentInstructions(): readonly string[] | undefined {
		return this._agentInstructions;
	}

	public get status(): WorkerStatus {
		return this._status;
	}

	public get state(): WorkerSessionState {
		return {
			id: this._id,
			name: this._name,
			task: this._task,
			worktreePath: this._worktreePath,
			status: this._status,
			messages: [...this._messages],
			pendingApprovals: Array.from(this._pendingApprovals.values()),
			createdAt: this._createdAt,
			lastActivityAt: this._lastActivityAt,
			errorMessage: this._errorMessage,
			planId: this._planId,
			baseBranch: this._baseBranch,
		};
	}

	/**
	 * Serialize the worker state for persistence
	 */
	public serialize(): SerializedWorkerState {
		return {
			id: this._id,
			name: this._name,
			task: this._task,
			worktreePath: this._worktreePath,
			status: this._status,
			messages: [...this._messages],
			createdAt: this._createdAt,
			lastActivityAt: this._lastActivityAt,
			errorMessage: this._errorMessage,
			planId: this._planId,
			baseBranch: this._baseBranch,
			agentId: this._agentId,
			agentInstructions: this._agentInstructions ? [...this._agentInstructions] : undefined,
		};
	}

	/**
	 * Create a WorkerSession from serialized state
	 */
	public static fromSerialized(state: SerializedWorkerState): WorkerSession {
		const session = new WorkerSession(
			state.name,
			state.task,
			state.worktreePath,
			state.planId,
			state.baseBranch,
			state.agentId,
			state.agentInstructions,
		);
		// Override the auto-generated id and timestamps
		(session as any)._id = state.id;
		(session as any)._status = state.status;
		(session as any)._messages = [...state.messages];
		(session as any)._createdAt = state.createdAt;
		(session as any)._lastActivityAt = state.lastActivityAt;
		(session as any)._errorMessage = state.errorMessage;
		return session;
	}

	/**
	 * Add a user message to the conversation
	 */
	public addUserMessage(content: string): string {
		return this._addMessage({ role: 'user', content });
	}

	/**
	 * Add an assistant message to the conversation
	 * @returns The message ID
	 */
	public addAssistantMessage(content: string): string {
		return this._addMessage({ role: 'assistant', content });
	}

	/**
	 * Update an existing assistant message (for streaming support)
	 */
	public updateAssistantMessage(messageId: string, content: string): void {
		const messageIndex = this._messages.findIndex(m => m.id === messageId);
		if (messageIndex >= 0) {
			const existingMessage = this._messages[messageIndex];
			this._messages[messageIndex] = {
				...existingMessage,
				content,
			};
			this._lastActivityAt = Date.now();
			this._onDidChange.fire();
		}
	}

	/**
	 * Add a tool call message
	 */
	public addToolCall(toolName: string, toolCallId: string, parameters: string): void {
		this._addMessage({
			role: 'tool',
			content: parameters,
			toolName,
			toolCallId,
		});
	}

	/**
	 * Add a tool result message
	 */
	public addToolResult(toolName: string, toolCallId: string, result: string): void {
		this._addMessage({
			role: 'tool',
			content: result,
			toolName,
			toolCallId,
		});
	}

	/**
	 * Request approval for a tool call
	 * Returns a promise that resolves when approved/rejected
	 */
	public async requestApproval(
		toolName: string,
		toolCallId: string,
		description: string,
		parameters: Record<string, unknown>
	): Promise<{ approved: boolean; clarification?: string }> {
		const approval: PendingApproval = {
			id: generateUuid(),
			timestamp: Date.now(),
			toolName,
			toolCallId,
			description,
			parameters,
			resolve: () => { }, // Will be set below
		};

		return new Promise((resolve) => {
			approval.resolve = (approved: boolean, clarification?: string) => {
				this._pendingApprovals.delete(approval.id);
				this._updateStatus();
				this._onDidChange.fire();
				resolve({ approved, clarification });
			};

			this._pendingApprovals.set(approval.id, approval);
			this._status = 'waiting-approval';
			this._addMessage({
				role: 'assistant',
				content: `Requesting approval for: ${toolName}\n${description}`,
				isApprovalRequest: true,
				isPending: true,
				toolName,
				toolCallId,
			});
		});
	}

	/**
	 * Handle an approval response from the user
	 */
	public handleApproval(approvalId: string, approved: boolean, clarification?: string): void {
		const approval = this._pendingApprovals.get(approvalId);
		if (approval) {
			approval.resolve(approved, clarification);
			this._addMessage({
				role: 'user',
				content: approved
					? `✅ Approved: ${approval.toolName}${clarification ? `\nClarification: ${clarification}` : ''}`
					: `❌ Rejected: ${approval.toolName}${clarification ? `\nReason: ${clarification}` : ''}`,
			});
		}
	}

	/**
	 * Pause the worker
	 */
	public async pause(): Promise<void> {
		if (this._status === 'running') {
			this._isPaused = true;
			this._status = 'paused';
			this._onDidChange.fire();
		}
	}

	/**
	 * Resume the worker
	 */
	public resume(): void {
		if (this._isPaused && this._pauseResolve) {
			this._isPaused = false;
			this._pauseResolve();
			this._pauseResolve = undefined;
			this._updateStatus();
			this._onDidChange.fire();
		}
	}

	/**
	 * Check if paused and wait if so
	 */
	public async checkPause(): Promise<void> {
		if (this._isPaused) {
			await new Promise<void>((resolve) => {
				this._pauseResolve = resolve;
			});
		}
	}

	/**
	 * Send a clarification message to the worker.
	 * If the worker is idle, this will wake it up for another round.
	 */
	public sendClarification(message: string): void {
		this._addMessage({ role: 'user', content: message });

		// If there's a pending resolve (worker is waiting for input), resolve it
		if (this._clarificationResolve) {
			const resolve = this._clarificationResolve;
			this._clarificationResolve = undefined;
			resolve(message);
		} else {
			// Store as pending for when worker starts waiting
			this._pendingClarification = message;
		}

		this._onNeedsClarification.fire(message);
	}

	/**
	 * Mark the worker as started
	 */
	public start(): void {
		this._status = 'running';
		this._onDidChange.fire();
	}

	/**
	 * Mark the worker as idle (task done but still accepting messages).
	 * The worker will wait for new messages before continuing.
	 */
	public idle(): void {
		this._status = 'idle';
		this._addMessage({ role: 'system', content: 'Task finished. Send a message to continue, or click Complete to finish.' });
		this._onDidChange.fire();
	}

	/**
	 * Mark the worker as fully completed (user clicked Complete).
	 * This triggers cleanup and prevents further interaction.
	 */
	public complete(): void {
		this._status = 'completed';
		this._addMessage({ role: 'system', content: 'Worker completed successfully.' });
		// Cancel any pending wait for clarification
		if (this._clarificationResolve) {
			this._clarificationResolve = undefined;
		}
		this._onDidChange.fire();
		this._onDidComplete.fire();
	}

	/**
	 * Mark the worker as errored
	 */
	public error(message: string): void {
		this._status = 'error';
		this._errorMessage = message;
		this._addMessage({ role: 'system', content: `Error: ${message}` });
		this._onDidChange.fire();
	}

	/**
	 * Wait for a clarification message from the user.
	 * Returns immediately if there's a pending message, otherwise waits.
	 * Returns undefined if the worker is completed/disposed.
	 */
	public async waitForClarification(): Promise<string | undefined> {
		// Check if there's already a pending clarification
		if (this._pendingClarification) {
			const message = this._pendingClarification;
			this._pendingClarification = undefined;
			return message;
		}

		// If already completed, don't wait
		if (this._status === 'completed' || this._status === 'error') {
			return undefined;
		}

		// Wait for a clarification
		return new Promise<string | undefined>((resolve) => {
			this._clarificationResolve = resolve;
		});
	}

	/**
	 * Check if worker should continue running (not completed/error)
	 */
	public get isActive(): boolean {
		return this._status !== 'completed' && this._status !== 'error';
	}

	private _addMessage(message: Omit<WorkerMessage, 'id' | 'timestamp'>): string {
		const fullMessage: WorkerMessage = {
			...message,
			id: generateUuid(),
			timestamp: Date.now(),
		};
		this._messages.push(fullMessage);
		this._lastActivityAt = Date.now();
		this._onDidChange.fire();
		return fullMessage.id;
	}

	private _updateStatus(): void {
		if (this._pendingApprovals.size > 0) {
			this._status = 'waiting-approval';
		} else if (this._isPaused) {
			this._status = 'paused';
		} else if (this._status === 'waiting-approval' || this._status === 'paused') {
			this._status = 'running';
		}
	}
}

/**
 * Creates a ChatResponseStream that reports back to a WorkerSession
 * Implements streaming by updating a single message rather than creating new ones per chunk
 */
export class WorkerResponseStream implements vscode.ChatResponseStream {
	private _currentContent = '';
	private _currentMessageId: string | undefined;
	private _flushDebounceTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly _session: WorkerSession,
		private readonly _debounceMs = 100,
	) { }

	markdown(value: string | vscode.MarkdownString): void {
		const content = typeof value === 'string' ? value : value.value;
		this._currentContent += content;
		this._scheduleFlush();
	}

	anchor(value: vscode.Uri | vscode.Location): void { }
	button(command: vscode.Command): void { }
	filetree(value: vscode.ChatResponseFileTree[], baseUri: vscode.Uri): void { }

	progress(value: string): void {
		// Progress messages are shown immediately as separate messages
		this._session.addAssistantMessage(`[Progress] ${value}`);
	}

	reference(value: vscode.Uri | vscode.Location): void { }

	push(part: vscode.ChatResponsePart): void {
		if ('value' in part && typeof part.value === 'string') {
			this.markdown(part.value);
		}
	}

	text(value: string): void {
		this.markdown(value);
	}

	warning(value: string | vscode.MarkdownString): void {
		const content = typeof value === 'string' ? value : value.value;
		this._session.addAssistantMessage(`⚠️ ${content}`);
	}

	error(value: string | vscode.MarkdownString): void {
		const content = typeof value === 'string' ? value : value.value;
		this._session.addAssistantMessage(`❌ ${content}`);
	}

	confirmation(title: string, message: string | vscode.MarkdownString, data: any, buttons?: string[]): void {
		const messageText = typeof message === 'string' ? message : message.value;
		const buttonsText = buttons?.length ? ` [${buttons.join(' | ')}]` : '';
		this._session.addAssistantMessage(`[Confirmation] ${title}: ${messageText}${buttonsText}`);
	}

	thinkingProgress(value: any): void { }
	textEdit(target: any, edits: any): void { }
	notebookEdit(target: any, edits: any): void { }

	externalEdit<T>(target: vscode.Uri | vscode.Uri[], callback: () => Thenable<T>): Thenable<T> {
		return callback();
	}

	markdownWithVulnerabilities(value: string | vscode.MarkdownString, vulnerabilities: any[]): void {
		this.markdown(value);
	}

	codeblockUri(value: vscode.Uri): void { }
	reference2(value: any): void { }
	codeCitation(value: any): void { }
	progress2(value: any): void { }
	fileTree(value: any, baseUri: any): void { }
	custom(value: any): void { }
	code(value: any): void { }
	command(value: any): void { }
	prepareToolInvocation(toolName: string): void { }
	clearToPreviousToolInvocation(reason: vscode.ChatResponseClearToPreviousToolInvocationReason): void { }

	/**
	 * Schedule a debounced flush of accumulated content
	 */
	private _scheduleFlush(): void {
		if (this._flushDebounceTimer) {
			clearTimeout(this._flushDebounceTimer);
		}
		this._flushDebounceTimer = setTimeout(() => {
			this._flushInternal();
		}, this._debounceMs);
	}

	/**
	 * Flush accumulated content as an assistant message (call at end of streaming)
	 */
	public flush(): void {
		if (this._flushDebounceTimer) {
			clearTimeout(this._flushDebounceTimer);
			this._flushDebounceTimer = undefined;
		}
		this._flushInternal();
	}

	private _flushInternal(): void {
		if (!this._currentContent) {
			return;
		}

		if (this._currentMessageId) {
			// Update existing message
			this._session.updateAssistantMessage(this._currentMessageId, this._currentContent);
		} else {
			// Create new message and track its ID for future updates
			this._currentMessageId = this._session.addAssistantMessage(this._currentContent);
		}
	}

	/**
	 * Start a new message (call when context changes significantly, e.g., after tool calls)
	 */
	public startNewMessage(): void {
		this.flush();
		this._currentMessageId = undefined;
		this._currentContent = '';
	}
}
