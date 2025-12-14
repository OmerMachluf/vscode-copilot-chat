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
 * Serialized MarkdownString that preserves all VS Code MarkdownString properties
 */
export interface SerializedMarkdownString {
	readonly value: string;
	readonly isTrusted?: boolean | { readonly enabledCommands: readonly string[] };
	readonly supportThemeIcons?: boolean;
	readonly supportHtml?: boolean;
	readonly baseUri?: string;
}

/**
 * Serialized range for locations
 */
export interface SerializedRange {
	readonly startLine: number;
	readonly startChar: number;
	readonly endLine: number;
	readonly endChar: number;
}

/**
 * Serialized location (URI + optional range)
 */
export interface SerializedLocation {
	readonly uri: string;
	readonly range?: SerializedRange;
}

/**
 * Icon path for references
 */
export interface SerializedIconPath {
	readonly themeIcon?: string;
	readonly light?: string;
	readonly dark?: string;
}

/**
 * Tool invocation presentation options
 */
export type ToolInvocationPresentation = 'default' | 'hidden' | 'hiddenAfterComplete';

/**
 * Tool-specific data variants matching VS Code's internal types
 */
export interface TerminalToolData {
	readonly kind: 'terminal';
	readonly command?: string;
	readonly commandLine?: string;
	readonly language: string;
}

export interface InputToolData {
	readonly kind: 'input';
	readonly placeholder?: string;
}

export interface ExtensionsToolData {
	readonly kind: 'extensions';
	readonly extensions: readonly string[];
}

export interface PullRequestToolData {
	readonly kind: 'pullRequest';
	readonly author?: string;
	readonly title?: string;
	readonly description?: string;
	readonly uri?: string;
}

export interface TodoListToolData {
	readonly kind: 'todoList';
	readonly items: readonly { id: number; title: string; status: string }[];
}

export type SerializedToolSpecificData =
	| TerminalToolData
	| InputToolData
	| ExtensionsToolData
	| PullRequestToolData
	| TodoListToolData
	| { readonly kind: string; [key: string]: unknown };

/**
 * All supported chat part types matching VS Code's ExtendedChatResponsePart
 */
export type SerializedChatPartType =
	| 'markdown'
	| 'markdownWithVulnerabilities'
	| 'anchor'
	| 'reference'
	| 'progress'
	| 'thinkingProgress'
	| 'filetree'
	| 'toolInvocation'
	| 'prepareToolInvocation'
	| 'confirmation'
	| 'warning'
	| 'error'
	| 'textEdit'
	| 'notebookEdit'
	| 'codeblockUri'
	| 'codeCitation'
	| 'command'
	| 'move'
	| 'multiDiff'
	| 'pullRequest'
	| 'extensions'
	| 'unknown';

/**
 * Serializable representation of a ChatResponsePart for persistence.
 * This interface supports ALL VS Code chat part types for 100% UI fidelity.
 * Parts can be reconstructed into actual ChatResponsePart objects.
 */
export interface SerializedChatPart {
	readonly type: SerializedChatPartType;

	// === Common fields ===
	/** Plain string content (legacy) or serialized MarkdownString */
	readonly content?: string | SerializedMarkdownString;

	// === Location/Reference fields ===
	readonly uri?: string;
	readonly range?: SerializedRange;
	readonly location?: SerializedLocation;
	/** For references with custom icons */
	readonly iconPath?: SerializedIconPath;
	/** Reference display options */
	readonly referenceOptions?: { readonly status?: { readonly description: string; readonly kind: string } };

	// === Tool invocation fields (ChatToolInvocationPart) ===
	readonly toolName?: string;
	readonly toolCallId?: string;
	readonly isComplete?: boolean;
	readonly isConfirmed?: boolean;
	readonly isError?: boolean;
	readonly invocationMessage?: string | SerializedMarkdownString;
	readonly pastTenseMessage?: string | SerializedMarkdownString;
	/** Origin message showing where the tool was invoked from */
	readonly originMessage?: string | SerializedMarkdownString;
	/** Whether this tool call came from a sub-agent */
	readonly fromSubAgent?: boolean;
	/** Presentation mode: hidden, hiddenAfterComplete, or default */
	readonly presentation?: ToolInvocationPresentation;
	/** Tool-specific rendering data (terminal commands, extensions, etc.) */
	readonly toolSpecificData?: SerializedToolSpecificData;

	// === Progress fields ===
	readonly progressMessage?: string;

	// === Thinking progress fields ===
	readonly thinkingId?: string;
	readonly thinkingMetadata?: unknown;

	// === Confirmation fields ===
	readonly title?: string;
	readonly message?: string | SerializedMarkdownString;
	readonly buttons?: readonly string[];
	readonly data?: unknown;

	// === File tree fields ===
	readonly treeItems?: readonly SerializedFileTreeItem[];
	readonly baseUri?: string;

	// === Text edit fields ===
	readonly edits?: readonly SerializedTextEdit[];
	readonly isDone?: boolean;

	// === Notebook edit fields ===
	readonly notebookEdits?: readonly SerializedNotebookEdit[];

	// === Codeblock URI fields ===
	readonly codeblockUri?: string;
	readonly isEdit?: boolean;
	readonly undoStopId?: string;

	// === Code citation fields ===
	readonly license?: string;
	readonly snippet?: string;
	readonly citationValue?: string;

	// === Command button fields ===
	readonly command?: SerializedCommand;

	// === Move part fields ===
	readonly moveUri?: string;
	readonly moveRange?: SerializedRange;

	// === Multi-diff fields ===
	readonly multiDiffTitle?: string;
	readonly multiDiffResources?: readonly SerializedMultiDiffResource[];
	readonly multiDiffReadOnly?: boolean;

	// === Pull request fields ===
	readonly prAuthor?: string;
	readonly prTitle?: string;
	readonly prDescription?: string;
	readonly prUri?: string;
	readonly prLinkTag?: string;

	// === Extensions fields ===
	readonly extensions?: readonly string[];

	// === Markdown with vulnerabilities fields ===
	readonly vulnerabilities?: readonly { readonly title: string; readonly description: string }[];
}

/**
 * Serialized file tree item for filetree parts
 */
export interface SerializedFileTreeItem {
	readonly name: string;
	readonly children?: readonly SerializedFileTreeItem[];
}

/**
 * Serialized text edit
 */
export interface SerializedTextEdit {
	readonly range: SerializedRange;
	readonly newText: string;
}

/**
 * Serialized notebook edit
 */
export interface SerializedNotebookEdit {
	readonly editType: 'replace' | 'metadata' | 'documentMetadata';
	readonly index?: number;
	readonly count?: number;
	readonly cells?: readonly SerializedNotebookCell[];
	readonly metadata?: Record<string, unknown>;
}

/**
 * Serialized notebook cell
 */
export interface SerializedNotebookCell {
	readonly kind: 'code' | 'markup';
	readonly value: string;
	readonly languageId: string;
	readonly metadata?: Record<string, unknown>;
}

/**
 * Serialized command for command button parts
 */
export interface SerializedCommand {
	readonly title: string;
	readonly command: string;
	readonly tooltip?: string;
	readonly arguments?: readonly unknown[];
}

/**
 * Serialized multi-diff resource entry
 */
export interface SerializedMultiDiffResource {
	readonly originalUri?: string;
	readonly modifiedUri?: string;
	readonly goToFileUri?: string;
	readonly added?: number;
	readonly removed?: number;
}

/**
 * Represents a message in a worker's conversation history
 */
export interface WorkerMessage {
	readonly id: string;
	readonly timestamp: number;
	readonly role: 'user' | 'assistant' | 'system' | 'tool';
	readonly content: string;
	/** Rich response parts for assistant messages - provides the full chat experience */
	readonly parts?: readonly SerializedChatPart[];
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
 * Represents a conversation thread between orchestrator and worker
 */
export interface ConversationThread {
	readonly id: string;
	readonly startedAt: number;
	readonly topic: string;
	readonly messages: ConversationMessage[];
	status: 'active' | 'resolved' | 'deferred';
}

/**
 * A message in a conversation thread
 */
export interface ConversationMessage {
	readonly id: string;
	readonly timestamp: number;
	readonly sender: 'worker' | 'orchestrator' | 'user';
	readonly content: string;
	readonly metadata?: Record<string, unknown>;
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
	readonly modelId?: string;
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
	readonly agentId?: string;
	readonly modelId?: string;
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
	private _conversationThreads: Map<string, ConversationThread> = new Map();
	private readonly _createdAt: number;
	private _lastActivityAt: number;
	private _errorMessage?: string;
	private _isPaused = false;
	private _pauseResolve?: () => void;
	private _clarificationResolve?: (message: string) => void;
	private _pendingClarification?: string;
	private _agentId?: string;
	private _agentInstructions?: string[];
	private _modelId?: string;
	private _cancellationTokenSource: CancellationTokenSource;

	/**
	 * Tool invocation token from a real VS Code ChatRequest.
	 * When attached, tool confirmations show inline in the chat UI
	 * instead of as modal dialogs.
	 */
	private _toolInvocationToken?: vscode.ChatParticipantToolToken;

	/**
	 * Attached real VS Code ChatResponseStream.
	 * When set, the WorkerResponseStream will write to this real stream
	 * in addition to storing parts, providing the true VS Code UI experience.
	 */
	private _attachedStream: vscode.ChatResponseStream | undefined;

	/**
	 * Buffer for stream parts that were written before a real stream was attached.
	 * These will be replayed when attachStream is called.
	 */
	private readonly _pendingStreamParts: SerializedChatPart[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	public readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidComplete = this._register(new Emitter<void>());
	public readonly onDidComplete: Event<void> = this._onDidComplete.event;

	private readonly _onNeedsClarification = this._register(new Emitter<string>());
	public readonly onNeedsClarification: Event<string> = this._onNeedsClarification.event;

	private readonly _onDidStop = this._register(new Emitter<void>());
	public readonly onDidStop: Event<void> = this._onDidStop.event;

	/** Real-time stream event - fires when new parts are streamed */
	private readonly _onStreamPart = this._register(new Emitter<SerializedChatPart>());
	public readonly onStreamPart: Event<SerializedChatPart> = this._onStreamPart.event;

	/** Real-time stream event - fires when streaming starts for a new response */
	private readonly _onStreamStart = this._register(new Emitter<void>());
	public readonly onStreamStart: Event<void> = this._onStreamStart.event;

	/** Real-time stream event - fires when streaming ends */
	private readonly _onStreamEnd = this._register(new Emitter<void>());
	public readonly onStreamEnd: Event<void> = this._onStreamEnd.event;

	constructor(
		name: string,
		task: string,
		worktreePath: string,
		planId?: string,
		baseBranch?: string,
		agentId?: string,
		agentInstructions?: string[],
		modelId?: string,
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
		this._modelId = modelId;
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

	/**
	 * Attach a real VS Code ChatResponseStream to this worker.
	 * When attached, all stream writes will go to the REAL VS Code stream,
	 * providing the exact same UI experience as local agent sessions.
	 *
	 * Also replays any buffered parts that were written before the stream was attached,
	 * ensuring that progress and other messages are visible to the user.
	 *
	 * Returns a disposable that detaches the stream when disposed.
	 */
	public attachStream(stream: vscode.ChatResponseStream): vscode.Disposable {
		this._attachedStream = stream;

		// Replay any buffered parts that were written before the stream was attached
		this._replayPendingParts(stream);

		return {
			dispose: () => {
				if (this._attachedStream === stream) {
					this._attachedStream = undefined;
				}
			}
		};
	}

	/**
	 * Replay buffered stream parts to a real stream.
	 * Called when attachStream is invoked to ensure all previous content is visible.
	 */
	private _replayPendingParts(stream: vscode.ChatResponseStream): void {
		for (const part of this._pendingStreamParts) {
			this._replayPart(stream, part);
		}
		// Clear the buffer after replaying
		this._pendingStreamParts.length = 0;
	}

	/**
	 * Replay a single serialized part to a real stream.
	 */
	private _replayPart(stream: vscode.ChatResponseStream, part: SerializedChatPart): void {
		switch (part.type) {
			case 'markdown':
				if (part.content) {
					stream.markdown(this._deserializeMarkdownContent(part.content));
				}
				break;
			case 'progress':
				if (part.progressMessage) {
					stream.progress(part.progressMessage);
				}
				break;
			case 'anchor':
			case 'reference':
				if (part.uri) {
					const uri = vscode.Uri.parse(part.uri);
					if (part.range) {
						const location = new vscode.Location(uri, new vscode.Range(
							part.range.startLine, part.range.startChar,
							part.range.endLine, part.range.endChar
						));
						if (part.type === 'anchor') {
							stream.anchor(location);
						} else {
							stream.reference(location);
						}
					} else {
						if (part.type === 'anchor') {
							stream.anchor(uri);
						} else {
							stream.reference(uri);
						}
					}
				}
				break;
			// Other part types are less critical for replay
		}
	}

	/**
	 * Deserialize markdown content from string or SerializedMarkdownString to MarkdownString
	 */
	private _deserializeMarkdownContent(content: string | SerializedMarkdownString): vscode.MarkdownString {
		if (typeof content === 'string') {
			return new vscode.MarkdownString(content);
		}
		const md = new vscode.MarkdownString(content.value);
		if (content.isTrusted !== undefined) {
			md.isTrusted = content.isTrusted;
		}
		if (content.supportThemeIcons !== undefined) {
			md.supportThemeIcons = content.supportThemeIcons;
		}
		if (content.supportHtml !== undefined) {
			md.supportHtml = content.supportHtml;
		}
		if (content.baseUri) {
			md.baseUri = vscode.Uri.parse(content.baseUri);
		}
		return md;
	}

	/**
	 * Buffer a stream part for later replay when a real stream attaches.
	 * Called by WorkerResponseStream when writing without an attached stream.
	 */
	public bufferStreamPart(part: SerializedChatPart): void {
		this._pendingStreamParts.push(part);
	}

	/**
	 * Get the current tool invocation token.
	 * When available, tool confirmations show inline in the chat UI.
	 */
	public get toolInvocationToken(): vscode.ChatParticipantToolToken | undefined {
		return this._toolInvocationToken;
	}

	/**
	 * Set the tool invocation token from a real VS Code ChatRequest.
	 * This enables inline tool confirmations instead of modal dialogs.
	 */
	public setToolInvocationToken(token: vscode.ChatParticipantToolToken | undefined): void {
		this._toolInvocationToken = token;
	}

	/**
	 * Get the currently attached real stream, if any.
	 */
	public get attachedStream(): vscode.ChatResponseStream | undefined {
		return this._attachedStream;
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

	/**
	 * Update the agent for this worker session.
	 * The new instructions take effect on the next agent iteration.
	 */
	public setAgent(agentId: string, instructions: string[]): void {
		this._agentId = agentId;
		this._agentInstructions = instructions;
	}

	/**
	 * Update the instructions for this worker session.
	 * The new instructions take effect on the next agent iteration.
	 */
	public setInstructions(instructions: string[]): void {
		this._agentInstructions = instructions;
	}

	/**
	 * Clear the conversation history, keeping only the initial system message.
	 */
	public clearHistory(): void {
		const taskMessage = this._messages.find(m => m.role === 'system' && m.content.includes('Worker initialized'));
		this._messages = taskMessage ? [taskMessage] : [];
		this._pendingApprovals.clear();
		this._conversationThreads.clear();
		this._onDidChange.fire();
	}

	public get modelId(): string | undefined {
		return this._modelId;
	}

	/**
	 * Update the model for this worker session.
	 * The new model takes effect on the next agent iteration.
	 */
	public setModel(modelId: string): void {
		this._modelId = modelId;
	}

	/**
	 * Hot-swap the agent for this worker session while preserving context.
	 * This is used when the orchestrator wants to change the agent type mid-task.
	 * @param agentId The new agent ID (e.g., '@reviewer', '@architect')
	 * @param instructions The new agent instructions
	 * @param preserveContext Whether to preserve the conversation context
	 */
	public hotSwapAgent(agentId: string, instructions: string[], preserveContext: boolean = true): void {
		const previousAgentId = this._agentId;

		// Update the agent
		this._agentId = agentId;
		this._agentInstructions = instructions;

		// Add a system message to mark the transition
		if (preserveContext) {
			this._addMessage({
				role: 'system',
				content: `🔄 Agent changed from ${previousAgentId ?? 'default'} to ${agentId}. Previous context preserved.`,
			});
		} else {
			// Clear conversation history except for the task context
			const taskMessage = this._messages.find(m => m.role === 'system' && m.content.includes('Worker initialized'));
			this._messages = taskMessage ? [taskMessage] : [];
			this._addMessage({
				role: 'system',
				content: `🔄 Agent changed to ${agentId}. Starting fresh context.`,
			});
		}

		this._lastActivityAt = Date.now();
		this._onDidChange.fire();
	}

	/**
	 * Hot-swap the model for this worker session while preserving context.
	 * This is used when the orchestrator wants to change the AI model mid-task.
	 * @param modelId The new model ID (e.g., 'gpt-4o', 'claude-sonnet-4-20250514')
	 * @param preserveContext Whether to preserve the conversation context
	 */
	public hotSwapModel(modelId: string, preserveContext: boolean = true): void {
		const previousModelId = this._modelId;

		// Update the model
		this._modelId = modelId;

		// Add a system message to mark the transition
		if (preserveContext) {
			this._addMessage({
				role: 'system',
				content: `🔄 Model changed from ${previousModelId ?? 'default'} to ${modelId}. Previous context preserved.`,
			});
		} else {
			// Clear conversation history except for the task context
			const taskMessage = this._messages.find(m => m.role === 'system' && m.content.includes('Worker initialized'));
			this._messages = taskMessage ? [taskMessage] : [];
			this._addMessage({
				role: 'system',
				content: `🔄 Model changed to ${modelId}. Starting fresh context.`,
			});
		}

		this._lastActivityAt = Date.now();
		this._onDidChange.fire();
	}

	/**
	 * Get a summary of the current context for a new agent.
	 * This is useful when switching agents and need to provide the new agent
	 * with a condensed view of what has happened so far.
	 */
	public getContextForNewAgent(): string {
		const lines: string[] = [];

		// Task context
		lines.push(`## Task: ${this._task}`);
		lines.push('');

		// Previous agent info
		if (this._agentId) {
			lines.push(`Previous agent: ${this._agentId}`);
		}

		// Summary of key messages
		const keyMessages = this._messages.filter(m =>
			m.role === 'user' ||
			(m.role === 'assistant' && !m.content.startsWith('[')) ||
			(m.role === 'system' && m.content.includes('Error'))
		);

		if (keyMessages.length > 0) {
			lines.push('');
			lines.push('## Conversation Summary');
			for (const msg of keyMessages.slice(-10)) { // Last 10 key messages
				const rolePrefix = msg.role === 'user' ? '👤' :
					msg.role === 'assistant' ? '🤖' : '⚙️';
				// Truncate long messages
				const content = msg.content.length > 200
					? msg.content.substring(0, 200) + '...'
					: msg.content;
				lines.push(`${rolePrefix} ${content}`);
			}
		}

		// Pending approvals
		if (this._pendingApprovals.size > 0) {
			lines.push('');
			lines.push('## Pending Approvals');
			for (const approval of this._pendingApprovals.values()) {
				lines.push(`- ${approval.toolName}: ${approval.description}`);
			}
		}

		// Error state
		if (this._errorMessage) {
			lines.push('');
			lines.push(`## Last Error: ${this._errorMessage}`);
		}

		return lines.join('\n');
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
			agentId: this._agentId,
			modelId: this._modelId,
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
			modelId: this._modelId,
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
			state.modelId,
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
	public addAssistantMessage(content: string, parts?: readonly SerializedChatPart[]): string {
		return this._addMessage({ role: 'assistant', content, parts });
	}

	/**
	 * Update an existing assistant message (for streaming support)
	 */
	public updateAssistantMessage(messageId: string, content: string, parts?: readonly SerializedChatPart[]): void {
		const messageIndex = this._messages.findIndex(m => m.id === messageId);
		if (messageIndex >= 0) {
			const existingMessage = this._messages[messageIndex];
			this._messages[messageIndex] = {
				...existingMessage,
				content,
				parts: parts ?? existingMessage.parts,
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

	// #region Conversation Threading

	/**
	 * Start a new conversation thread with the orchestrator
	 */
	public startConversationThread(topic: string): ConversationThread {
		const thread: ConversationThread = {
			id: generateUuid(),
			startedAt: Date.now(),
			topic,
			messages: [],
			status: 'active',
		};
		this._conversationThreads.set(thread.id, thread);
		this._onDidChange.fire();
		return thread;
	}

	/**
	 * Add a message to a conversation thread
	 */
	public addThreadMessage(
		threadId: string,
		sender: 'worker' | 'orchestrator' | 'user',
		content: string,
		metadata?: Record<string, unknown>
	): ConversationMessage | undefined {
		const thread = this._conversationThreads.get(threadId);
		if (!thread || thread.status !== 'active') {
			return undefined;
		}

		const message: ConversationMessage = {
			id: generateUuid(),
			timestamp: Date.now(),
			sender,
			content,
			metadata,
		};
		thread.messages.push(message);
		this._lastActivityAt = Date.now();
		this._onDidChange.fire();
		return message;
	}

	/**
	 * Get a conversation thread by ID
	 */
	public getConversationThread(threadId: string): ConversationThread | undefined {
		return this._conversationThreads.get(threadId);
	}

	/**
	 * Get all conversation threads
	 */
	public getConversationThreads(): readonly ConversationThread[] {
		return Array.from(this._conversationThreads.values());
	}

	/**
	 * Get active conversation threads
	 */
	public getActiveConversationThreads(): readonly ConversationThread[] {
		return Array.from(this._conversationThreads.values()).filter(t => t.status === 'active');
	}

	/**
	 * Resolve a conversation thread
	 */
	public resolveConversationThread(threadId: string): void {
		const thread = this._conversationThreads.get(threadId);
		if (thread) {
			thread.status = 'resolved';
			this._onDidChange.fire();
		}
	}

	/**
	 * Defer a conversation thread
	 */
	public deferConversationThread(threadId: string): void {
		const thread = this._conversationThreads.get(threadId);
		if (thread) {
			thread.status = 'deferred';
			this._onDidChange.fire();
		}
	}

	// #endregion

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
		// Cancel any pending wait for clarification
		if (this._clarificationResolve) {
			this._clarificationResolve = undefined;
		}
		this._onDidChange.fire();
		// Fire completion event so listeners know the worker has terminated
		this._onDidComplete.fire();
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

	// #region Chat Session Integration

	/**
	 * Convert worker messages to VS Code chat history format for session UI
	 */
	public toChatHistory(): Array<{ role: 'user' | 'assistant'; content: string; name?: string }> {
		const history: Array<{ role: 'user' | 'assistant'; content: string; name?: string }> = [];

		for (const msg of this._messages) {
			switch (msg.role) {
				case 'user':
					history.push({
						role: 'user',
						content: msg.content,
					});
					break;
				case 'assistant':
					history.push({
						role: 'assistant',
						content: msg.content,
					});
					break;
				case 'system':
					// System messages shown as assistant with [System] prefix
					history.push({
						role: 'assistant',
						content: `*[System]* ${msg.content}`,
					});
					break;
				case 'tool':
					// Tool messages shown as assistant with tool context
					if (msg.toolName) {
						history.push({
							role: 'assistant',
							content: `\`${msg.toolName}\`: ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}`,
							name: msg.toolName,
						});
					}
					break;
			}
		}

		return history;
	}

	/**
	 * Get the chat session status mapped from worker status
	 */
	public getChatSessionStatus(): 'busy' | 'idle' | 'waiting' | undefined {
		switch (this._status) {
			case 'running':
				return 'busy';
			case 'idle':
			case 'completed':
				return 'idle';
			case 'waiting-approval':
			case 'paused':
				return 'waiting';
			case 'error':
				return undefined;
			default:
				return undefined;
		}
	}

	/**
	 * Get a label for the session in the chat sessions UI
	 */
	public getSessionLabel(): string {
		// Use task name, truncated if needed
		const maxLength = 50;
		if (this._task.length > maxLength) {
			return this._task.substring(0, maxLength - 3) + '...';
		}
		return this._task;
	}

	/**
	 * Get a description for the session in the chat sessions UI
	 */
	public getSessionDescription(): string {
		const statusEmoji = this._getStatusEmoji();
		const branch = this._baseBranch ? ` (${this._baseBranch})` : '';
		return `${statusEmoji} ${this._name}${branch}`;
	}

	private _getStatusEmoji(): string {
		switch (this._status) {
			case 'running':
				return '🔄';
			case 'idle':
				return '⏸️';
			case 'waiting-approval':
				return '⏳';
			case 'paused':
				return '⏸️';
			case 'completed':
				return '✅';
			case 'error':
				return '❌';
			default:
				return '❔';
		}
	}

	// #endregion

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
 * Creates a ChatResponseStream that reports back to a WorkerSession.
 *
 * KEY ARCHITECTURE:
 * - When a real VS Code ChatResponseStream is attached to the WorkerSession,
 *   all writes go DIRECTLY to the real stream (providing the true VS Code UI)
 * - Parts are also stored for history/replay purposes
 * - Emits real-time stream events for any additional subscribers
 * - When NO real stream is attached, parts are buffered on the WorkerSession
 *   for later replay when a stream IS attached (ensures progress is visible)
 */
export class WorkerResponseStream implements vscode.ChatResponseStream {
	private _currentContent = '';
	private _currentParts: SerializedChatPart[] = [];
	private _currentMessageId: string | undefined;
	private _flushDebounceTimer: ReturnType<typeof setTimeout> | undefined;
	private _isStreaming = false;

	constructor(
		private readonly _session: WorkerSession,
		private readonly _debounceMs = 50,  // Faster debounce for better UX
	) { }

	/**
	 * Get the attached real stream (if any) for direct writes
	 */
	private get _realStream(): vscode.ChatResponseStream | undefined {
		return this._session.attachedStream;
	}

	/**
	 * Emit a part - writes to REAL stream if attached, emits events, and stores for history.
	 * If NO real stream is attached, also buffers the part for later replay.
	 */
	private _emitPart(part: SerializedChatPart): void {
		// Start streaming if not already
		if (!this._isStreaming) {
			this._isStreaming = true;
			(this._session as any)._onStreamStart?.fire();
		}
		// Emit for real-time subscribers (e.g., content provider fallback)
		(this._session as any)._onStreamPart?.fire(part);
		// Accumulate for message storage/history
		this._currentParts.push(part);

		// Buffer for replay if no real stream is attached yet
		// This ensures progress and other messages are visible when user opens the chat
		if (!this._realStream) {
			this._session.bufferStreamPart(part);
		}

		this._scheduleFlush();
	}

	markdown(value: string | vscode.MarkdownString): void {
		const content = typeof value === 'string' ? value : value.value;
		this._currentContent += content;
		// Write to REAL stream if attached
		this._realStream?.markdown(value);
		// Serialize with full MarkdownString properties for fidelity
		if (typeof value === 'string') {
			this._emitPart({ type: 'markdown', content });
		} else {
			this._emitPart({
				type: 'markdown',
				content: {
					value: value.value,
					isTrusted: value.isTrusted,
					supportThemeIcons: value.supportThemeIcons,
					supportHtml: value.supportHtml,
					baseUri: value.baseUri?.toString(),
				},
			});
		}
	}

	anchor(value: vscode.Uri | vscode.Location): void {
		// Write to REAL stream if attached
		this._realStream?.anchor(value);
		const uri = value instanceof vscode.Uri ? value : value.uri;
		const range = !(value instanceof vscode.Uri) ? value.range : undefined;
		this._emitPart({
			type: 'anchor',
			uri: uri.toString(),
			range: range ? {
				startLine: range.start.line,
				startChar: range.start.character,
				endLine: range.end.line,
				endChar: range.end.character,
			} : undefined,
		});
	}

	button(command: vscode.Command): void {
		// Write to REAL stream if attached
		this._realStream?.button(command);
		this._emitPart({
			type: 'command',
			command: {
				title: command.title,
				command: command.command,
				tooltip: command.tooltip,
				arguments: command.arguments,
			},
		});
	}

	filetree(value: vscode.ChatResponseFileTree[], baseUri: vscode.Uri): void {
		// Write to REAL stream if attached
		this._realStream?.filetree(value, baseUri);
		// Properly serialize file tree items
		const serializeItem = (item: vscode.ChatResponseFileTree): { name: string; children?: { name: string; children?: any }[] } => ({
			name: item.name,
			children: item.children?.map(serializeItem),
		});
		this._emitPart({
			type: 'filetree',
			baseUri: baseUri.toString(),
			treeItems: value.map(serializeItem),
		});
	}

	progress(value: string): void {
		// Write to REAL stream if attached
		this._realStream?.progress(value);
		this._emitPart({
			type: 'progress',
			progressMessage: value,
		});
	}

	reference(value: vscode.Uri | vscode.Location): void {
		// Write to REAL stream if attached
		this._realStream?.reference(value);
		const uri = value instanceof vscode.Uri ? value : value.uri;
		const range = !(value instanceof vscode.Uri) ? value.range : undefined;
		this._emitPart({
			type: 'reference',
			uri: uri.toString(),
			range: range ? {
				startLine: range.start.line,
				startChar: range.start.character,
				endLine: range.end.line,
				endChar: range.end.character,
			} : undefined,
		});
	}

	reference2(value: vscode.Uri | vscode.Location | { variableName: string; value?: vscode.Uri | vscode.Location }, iconPath?: vscode.Uri | vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri }, options?: { status?: { kind: number; description: string } }): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.reference2?.(value, iconPath, options);
		let uri: string | undefined;
		let variableName: string | undefined;
		let rangeData: SerializedChatPart['range'] | undefined;

		if (value instanceof vscode.Uri) {
			uri = value.toString();
		} else if ('uri' in value) {
			uri = value.uri.toString();
			if ('range' in value && value.range) {
				rangeData = {
					startLine: value.range.start.line,
					startChar: value.range.start.character,
					endLine: value.range.end.line,
					endChar: value.range.end.character,
				};
			}
		} else if ('variableName' in value) {
			variableName = value.variableName;
			if (value.value instanceof vscode.Uri) {
				uri = value.value.toString();
			} else if (value.value && 'uri' in value.value) {
				uri = value.value.uri.toString();
			}
		}

		this._emitPart({
			type: 'reference',
			uri,
			content: variableName,
			range: rangeData,
			data: options,
		});
	}

	push(part: vscode.ChatResponsePart): void {
		// Write to REAL stream if attached - pass through directly
		this._realStream?.push(part);
		// Handle various ChatResponsePart types for storage
		if ('value' in part) {
			if (typeof part.value === 'string') {
				// Don't call this.markdown as it would double-write to real stream
				this._currentContent += part.value;
				this._emitPart({ type: 'markdown', content: part.value });
			} else if (part.value && typeof part.value === 'object' && 'value' in part.value) {
				// MarkdownString
				const content = (part.value as vscode.MarkdownString).value;
				this._currentContent += content;
				this._emitPart({ type: 'markdown', content });
			}
		}
		// Note: Other part types are handled by their specific methods
	}

	text(value: string): void {
		this.markdown(value);
	}

	warning(value: string | vscode.MarkdownString): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.warning?.(value);
		const content = typeof value === 'string' ? value : value.value;
		this._currentContent += `⚠️ ${content}`;
		// Serialize with full MarkdownString properties for fidelity
		if (typeof value === 'string') {
			this._emitPart({ type: 'warning', content });
		} else {
			this._emitPart({
				type: 'warning',
				content: {
					value: value.value,
					isTrusted: value.isTrusted,
					supportThemeIcons: value.supportThemeIcons,
					supportHtml: value.supportHtml,
					baseUri: value.baseUri?.toString(),
				},
			});
		}
	}

	error(value: string | vscode.MarkdownString): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.error?.(value);
		const content = typeof value === 'string' ? value : value.value;
		this._currentContent += `❌ ${content}`;
		// Serialize with full MarkdownString properties for fidelity
		if (typeof value === 'string') {
			this._emitPart({ type: 'error', content });
		} else {
			this._emitPart({
				type: 'error',
				content: {
					value: value.value,
					isTrusted: value.isTrusted,
					supportThemeIcons: value.supportThemeIcons,
					supportHtml: value.supportHtml,
					baseUri: value.baseUri?.toString(),
				},
			});
		}
	}

	confirmation(title: string, message: string | vscode.MarkdownString, data: any, buttons?: string[]): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.confirmation?.(title, message, data, buttons);
		const messageText = typeof message === 'string' ? message : message.value;
		this._currentContent += `[Confirmation] ${title}: ${messageText}`;
		// Serialize with full MarkdownString properties for fidelity
		if (typeof message === 'string') {
			this._emitPart({
				type: 'confirmation',
				title,
				message: message,
				buttons,
				data,
			});
		} else {
			this._emitPart({
				type: 'confirmation',
				title,
				message: {
					value: message.value,
					isTrusted: message.isTrusted,
					supportThemeIcons: message.supportThemeIcons,
					supportHtml: message.supportHtml,
					baseUri: message.baseUri?.toString(),
				},
				buttons,
				data,
			});
		}
	}

	thinkingProgress(value: any): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.thinkingProgress?.(value);
		// Extract thinking progress properties
		if (typeof value === 'string') {
			this._emitPart({
				type: 'thinkingProgress',
				content: value,
			});
		} else {
			this._emitPart({
				type: 'thinkingProgress',
				content: value?.value ?? '',
				thinkingId: value?.id,
				thinkingMetadata: value?.metadata,
			});
		}
	}

	textEdit(target: vscode.Uri, edits: vscode.TextEdit | vscode.TextEdit[]): void;
	textEdit(target: vscode.Uri, isDone: true): void;
	textEdit(target: vscode.Uri, editsOrIsDone: vscode.TextEdit | vscode.TextEdit[] | true): void {
		// Write to REAL stream if attached - this is the key for proper rendering!
		(this._realStream as any)?.textEdit?.(target, editsOrIsDone);

		// Handle the "isDone" overload
		if (editsOrIsDone === true) {
			this._emitPart({
				type: 'textEdit',
				uri: target.toString(),
				edits: [],
				isDone: true,
			});
			return;
		}

		// Properly serialize text edits for full fidelity
		const editArray = Array.isArray(editsOrIsDone) ? editsOrIsDone : [editsOrIsDone];
		this._emitPart({
			type: 'textEdit',
			uri: target.toString(),
			edits: editArray.map(e => ({
				range: {
					startLine: e.range.start.line,
					startChar: e.range.start.character,
					endLine: e.range.end.line,
					endChar: e.range.end.character,
				},
				newText: e.newText,
			})),
			isDone: false,
		});
	}

	notebookEdit(target: vscode.Uri, edits: vscode.NotebookEdit | vscode.NotebookEdit[]): void;
	notebookEdit(target: vscode.Uri, isDone: true): void;
	notebookEdit(target: vscode.Uri, editsOrIsDone: vscode.NotebookEdit | vscode.NotebookEdit[] | true): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.notebookEdit?.(target, editsOrIsDone);

		// Handle the "isDone" overload
		if (editsOrIsDone === true) {
			this._emitPart({
				type: 'notebookEdit',
				uri: target.toString(),
				notebookEdits: [],
				isDone: true,
			});
			return;
		}

		// Serialize notebook edits for fidelity
		const editArray = Array.isArray(editsOrIsDone) ? editsOrIsDone : [editsOrIsDone];
		this._emitPart({
			type: 'notebookEdit',
			uri: target.toString(),
			notebookEdits: editArray.map(e => {
				// Determine edit type and serialize appropriately
				if (e.newCellMetadata) {
					return {
						editType: 'metadata' as const,
						index: e.range.start,
						metadata: e.newCellMetadata,
					};
				} else if (e.newNotebookMetadata) {
					return {
						editType: 'documentMetadata' as const,
						metadata: e.newNotebookMetadata,
					};
				} else {
					return {
						editType: 'replace' as const,
						index: e.range.start,
						count: e.range.end - e.range.start,
						cells: e.newCells.map(c => ({
							kind: c.kind === vscode.NotebookCellKind.Code ? 'code' as const : 'markup' as const,
							value: c.value,
							languageId: c.languageId,
							metadata: c.metadata,
						})),
					};
				}
			}),
			isDone: false,
		});
	}

	externalEdit(target: vscode.Uri | vscode.Uri[], callback: () => Thenable<void>): Thenable<string> {
		// Write to REAL stream if attached
		if ((this._realStream as any)?.externalEdit) {
			return (this._realStream as any).externalEdit(target, callback);
		}
		const uris = Array.isArray(target) ? target : [target];
		this._emitPart({
			type: 'unknown',
			content: `[External edit: ${uris.map(u => u.fsPath).join(', ')}]`,
		});
		return Promise.resolve(callback()).then(() => '');
	}

	markdownWithVulnerabilities(value: string | vscode.MarkdownString, vulnerabilities: { title: string; description: string }[]): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.markdownWithVulnerabilities?.(value, vulnerabilities);
		const content = typeof value === 'string' ? value : value.value;
		this._currentContent += content;
		// Serialize with full properties for fidelity
		if (typeof value === 'string') {
			this._emitPart({
				type: 'markdownWithVulnerabilities',
				content,
				vulnerabilities,
			});
		} else {
			this._emitPart({
				type: 'markdownWithVulnerabilities',
				content: {
					value: value.value,
					isTrusted: value.isTrusted,
					supportThemeIcons: value.supportThemeIcons,
					supportHtml: value.supportHtml,
					baseUri: value.baseUri?.toString(),
				},
				vulnerabilities,
			});
		}
	}

	codeblockUri(value: vscode.Uri, isEdit?: boolean, undoStopId?: string): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.codeblockUri?.(value, isEdit, undoStopId);
		this._emitPart({
			type: 'codeblockUri',
			codeblockUri: value.toString(),
			isEdit,
			undoStopId,
		});
	}

	codeCitation(value: vscode.Uri, license: string, snippet: string): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.codeCitation?.(value, license, snippet);
		this._emitPart({
			type: 'codeCitation',
			citationValue: value.toString(),
			license,
			snippet,
		});
	}

	progress2(value: { message: string } | string): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.progress2?.(value);
		const msg = typeof value === 'string' ? value : value.message;
		// Don't call this.progress as it would double-write
		this._emitPart({
			type: 'progress',
			progressMessage: msg,
		});
	}

	fileTree(value: any, baseUri: any): void {
		this.filetree(value, baseUri);
	}

	custom(value: any): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.custom?.(value);
		this._emitPart({
			type: 'unknown',
			content: '[Custom content]',
			data: value,
		});
	}

	code(value: any): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.code?.(value);
		if (value && typeof value.value === 'string') {
			const codeContent = '```\n' + value.value + '\n```';
			this._currentContent += codeContent;
			this._emitPart({
				type: 'markdown',
				content: codeContent,
				data: { language: value.language },
			});
		}
	}

	command(value: vscode.Command): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.command?.(value);
		this._emitPart({
			type: 'command',
			command: {
				title: value.title,
				command: value.command,
				tooltip: value.tooltip,
				arguments: value.arguments,
			},
		});
	}

	/**
	 * Record a move part indicating content should be moved to a location
	 */
	move(uri: vscode.Uri, range: vscode.Range): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.move?.(uri, range);
		this._emitPart({
			type: 'move',
			moveUri: uri.toString(),
			moveRange: {
				startLine: range.start.line,
				startChar: range.start.character,
				endLine: range.end.line,
				endChar: range.end.character,
			},
		});
	}

	/**
	 * Record a multi-diff view showing multiple file changes
	 */
	multiDiff(resources: { originalUri?: vscode.Uri; modifiedUri?: vscode.Uri; goToFileUri?: vscode.Uri; added?: number; removed?: number }[], title?: string, readOnly?: boolean): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.multiDiff?.(resources, title, readOnly);
		this._emitPart({
			type: 'multiDiff',
			multiDiffTitle: title,
			multiDiffResources: resources.map(r => ({
				originalUri: r.originalUri?.toString(),
				modifiedUri: r.modifiedUri?.toString(),
				goToFileUri: r.goToFileUri?.toString(),
				added: r.added,
				removed: r.removed,
			})),
			multiDiffReadOnly: readOnly,
		});
	}

	/**
	 * Record a pull request reference
	 */
	pullRequest(options: { author?: string; title?: string; description?: string; uri?: vscode.Uri; linkTag?: string }): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.pullRequest?.(options);
		this._emitPart({
			type: 'pullRequest',
			prAuthor: options.author,
			prTitle: options.title,
			prDescription: options.description,
			prUri: options.uri?.toString(),
			prLinkTag: options.linkTag,
		});
	}

	/**
	 * Record recommended extensions
	 */
	extensions(extensionIds: string[]): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.extensions?.(extensionIds);
		this._emitPart({
			type: 'extensions',
			extensions: extensionIds,
		});
	}

	prepareToolInvocation(toolName: string): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.prepareToolInvocation?.(toolName);
		this._emitPart({
			type: 'prepareToolInvocation',
			toolName,
		});
	}

	/**
	 * Record a complete tool invocation with full details
	 */
	toolInvocation(toolName: string, toolCallId: string, options?: {
		isComplete?: boolean;
		isConfirmed?: boolean;
		isError?: boolean;
		invocationMessage?: string | vscode.MarkdownString;
		pastTenseMessage?: string | vscode.MarkdownString;
		originMessage?: string | vscode.MarkdownString;
		fromSubAgent?: boolean;
		presentation?: 'default' | 'hidden' | 'hiddenAfterComplete';
		toolSpecificData?: unknown;
	}): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.toolInvocation?.(toolName, toolCallId, options);

		// Helper to serialize MarkdownString
		const serializeMarkdown = (value: string | vscode.MarkdownString | undefined) => {
			if (!value) {
				return undefined;
			}
			if (typeof value === 'string') {
				return value;
			}
			return {
				value: value.value,
				isTrusted: value.isTrusted,
				supportThemeIcons: value.supportThemeIcons,
				supportHtml: value.supportHtml,
				baseUri: value.baseUri?.toString(),
			};
		};

		this._emitPart({
			type: 'toolInvocation',
			toolName,
			toolCallId,
			isComplete: options?.isComplete ?? true,
			isConfirmed: options?.isConfirmed ?? true,
			isError: options?.isError ?? false,
			invocationMessage: serializeMarkdown(options?.invocationMessage),
			pastTenseMessage: serializeMarkdown(options?.pastTenseMessage),
			originMessage: serializeMarkdown(options?.originMessage),
			fromSubAgent: options?.fromSubAgent,
			presentation: options?.presentation,
			toolSpecificData: options?.toolSpecificData as SerializedToolSpecificData | undefined,
		});
	}

	clearToPreviousToolInvocation(reason: vscode.ChatResponseClearToPreviousToolInvocationReason): void {
		// Write to REAL stream if attached
		(this._realStream as any)?.clearToPreviousToolInvocation?.(reason);
		// Signal to clear - emit but don't accumulate
		(this._session as any)._onStreamPart?.fire({
			type: 'unknown',
			content: '[Clear to previous tool invocation]',
			data: { reason },
		});
	}

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
		// Signal stream end
		if (this._isStreaming) {
			this._isStreaming = false;
			(this._session as any)._onStreamEnd?.fire();
		}
	}

	private _flushInternal(): void {
		if (!this._currentContent && this._currentParts.length === 0) {
			return;
		}

		if (this._currentMessageId) {
			// Update existing message with content and parts
			this._session.updateAssistantMessage(this._currentMessageId, this._currentContent, [...this._currentParts]);
		} else {
			// Create new message with parts and track its ID for future updates
			this._currentMessageId = this._session.addAssistantMessage(this._currentContent, [...this._currentParts]);
		}
	}

	/**
	 * Start a new message (call when context changes significantly, e.g., after tool calls)
	 */
	public startNewMessage(): void {
		this.flush();
		this._currentMessageId = undefined;
		this._currentContent = '';
		this._currentParts = [];
	}

	/**
	 * Get the accumulated parts (for inspection)
	 */
	public get parts(): readonly SerializedChatPart[] {
		return this._currentParts;
	}

	/**
	 * Check if currently streaming
	 */
	public get isStreaming(): boolean {
		return this._isStreaming;
	}
}
