/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Emitter, Event } from '../../../../util/vs/base/common/event';
import { Disposable, DisposableStore, IDisposable } from '../../../../util/vs/base/common/lifecycle';
import {
	IA2AMessage,
	IStatusUpdateContent,
	ICompletionContent,
	IErrorContent,
	isStatusUpdateContent,
	isCompletionContent,
	isErrorContent,
	IApprovalRequestContent,
	isApprovalRequestContent,
} from '../messageTypes';
import { IA2AMessageRouter } from '../messageRouter';

/**
 * Status of a Claude Code agent session.
 */
export type AgentSessionStatus =
	| 'idle'
	| 'starting'
	| 'active'
	| 'waiting_approval'
	| 'completing'
	| 'completed'
	| 'failed'
	| 'cancelled';

/**
 * Information about an agent session for display.
 */
export interface IAgentSessionInfo {
	/** Unique session identifier */
	readonly sessionId: string;
	/** Agent type (e.g., 'claude', 'copilot') */
	readonly agentType: string;
	/** Current status */
	readonly status: AgentSessionStatus;
	/** Human-readable status message */
	readonly statusMessage: string;
	/** Progress percentage (0-100) */
	readonly progress?: number;
	/** Files currently being worked on */
	readonly currentFiles?: readonly string[];
	/** Worktree path (if applicable) */
	readonly worktreePath?: string;
	/** Task ID (if part of a plan) */
	readonly taskId?: string;
	/** Start time */
	readonly startTime: number;
	/** End time (if completed) */
	readonly endTime?: number;
	/** Error message (if failed) */
	readonly error?: string;
}

/**
 * Event fired when agent status changes.
 */
export interface IAgentStatusChangeEvent {
	readonly sessionId: string;
	readonly previousStatus: AgentSessionStatus;
	readonly newStatus: AgentSessionStatus;
	readonly sessionInfo: IAgentSessionInfo;
}

/**
 * Event fired when approval is needed.
 */
export interface IApprovalNeededEvent {
	readonly sessionId: string;
	readonly approvalId: string;
	readonly action: string;
	readonly description: string;
	readonly riskLevel: 'low' | 'medium' | 'high' | 'critical';
	readonly affectedResources?: readonly string[];
}

/**
 * Service identifier for IAgentStatusDisplay.
 */
export const IAgentStatusDisplay = Symbol('IAgentStatusDisplay');

/**
 * Service for displaying agent status in the VS Code UI.
 */
export interface IAgentStatusDisplay extends IDisposable {
	/**
	 * Event fired when agent status changes.
	 */
	readonly onStatusChange: Event<IAgentStatusChangeEvent>;

	/**
	 * Event fired when approval is needed from user.
	 */
	readonly onApprovalNeeded: Event<IApprovalNeededEvent>;

	/**
	 * Register a new agent session.
	 */
	registerSession(sessionId: string, agentType: string, worktreePath?: string, taskId?: string): void;

	/**
	 * Update session status.
	 */
	updateSession(sessionId: string, updates: Partial<Omit<IAgentSessionInfo, 'sessionId' | 'agentType' | 'startTime'>>): void;

	/**
	 * Remove a session.
	 */
	removeSession(sessionId: string): void;

	/**
	 * Get info for a specific session.
	 */
	getSession(sessionId: string): IAgentSessionInfo | undefined;

	/**
	 * Get all active sessions.
	 */
	getAllSessions(): readonly IAgentSessionInfo[];

	/**
	 * Get sessions filtered by status.
	 */
	getSessionsByStatus(status: AgentSessionStatus): readonly IAgentSessionInfo[];

	/**
	 * Show the status bar item.
	 */
	show(): void;

	/**
	 * Hide the status bar item.
	 */
	hide(): void;

	/**
	 * Process an incoming A2A message and update status accordingly.
	 */
	processMessage(message: IA2AMessage): void;
}

/**
 * Status bar icons for different agent states.
 */
const STATUS_ICONS: Record<AgentSessionStatus, string> = {
	idle: '$(copilot)',
	starting: '$(loading~spin)',
	active: '$(loading~spin)',
	waiting_approval: '$(warning)',
	completing: '$(loading~spin)',
	completed: '$(check)',
	failed: '$(error)',
	cancelled: '$(circle-slash)',
};

/**
 * Status bar colors for different agent states.
 */
const STATUS_COLORS: Record<AgentSessionStatus, vscode.ThemeColor | undefined> = {
	idle: undefined,
	starting: new vscode.ThemeColor('statusBarItem.prominentBackground'),
	active: new vscode.ThemeColor('statusBarItem.prominentBackground'),
	waiting_approval: new vscode.ThemeColor('statusBarItem.warningBackground'),
	completing: new vscode.ThemeColor('statusBarItem.prominentBackground'),
	completed: undefined,
	failed: new vscode.ThemeColor('statusBarItem.errorBackground'),
	cancelled: undefined,
};

/**
 * Implementation of agent status display.
 */
export class AgentStatusDisplay extends Disposable implements IAgentStatusDisplay {
	private readonly _sessions = new Map<string, IAgentSessionInfo>();
	private readonly _statusBarItem: vscode.StatusBarItem;
	private readonly _subscriptions = this._register(new DisposableStore());

	private readonly _onStatusChange = this._register(new Emitter<IAgentStatusChangeEvent>());
	public readonly onStatusChange = this._onStatusChange.event;

	private readonly _onApprovalNeeded = this._register(new Emitter<IApprovalNeededEvent>());
	public readonly onApprovalNeeded = this._onApprovalNeeded.event;

	constructor(
		private readonly _messageRouter?: IA2AMessageRouter,
	) {
		super();

		// Create status bar item
		this._statusBarItem = this._register(
			vscode.window.createStatusBarItem(
				'copilot.agent.status',
				vscode.StatusBarAlignment.Right,
				100
			)
		);

		// Set up command for clicking status bar
		const commandId = 'copilot.agent.showStatus';
		this._register(vscode.commands.registerCommand(commandId, () => this._showStatusQuickPick()));
		this._statusBarItem.command = commandId;

		// Subscribe to message router if provided
		if (this._messageRouter) {
			this._subscribeToRouter(this._messageRouter);
		}

		// Initial update
		this._updateStatusBar();
	}

	private _subscribeToRouter(router: IA2AMessageRouter): void {
		this._subscriptions.add(router.subscribe({
			subscriber: {
				type: 'agent',
				id: 'status-display',
			},
			messageTypes: ['status_update', 'completion', 'error', 'approval_request'],
			callback: (message) => this.processMessage(message),
		}));
	}

	registerSession(sessionId: string, agentType: string, worktreePath?: string, taskId?: string): void {
		const session: IAgentSessionInfo = {
			sessionId,
			agentType,
			status: 'starting',
			statusMessage: 'Starting agent...',
			worktreePath,
			taskId,
			startTime: Date.now(),
		};

		this._sessions.set(sessionId, session);
		this._updateStatusBar();

		this._onStatusChange.fire({
			sessionId,
			previousStatus: 'idle',
			newStatus: 'starting',
			sessionInfo: session,
		});
	}

	updateSession(sessionId: string, updates: Partial<Omit<IAgentSessionInfo, 'sessionId' | 'agentType' | 'startTime'>>): void {
		const existing = this._sessions.get(sessionId);
		if (!existing) {
			return;
		}

		const previousStatus = existing.status;
		const updated: IAgentSessionInfo = {
			...existing,
			...updates,
		};

		this._sessions.set(sessionId, updated);
		this._updateStatusBar();

		if (previousStatus !== updated.status) {
			this._onStatusChange.fire({
				sessionId,
				previousStatus,
				newStatus: updated.status,
				sessionInfo: updated,
			});
		}
	}

	removeSession(sessionId: string): void {
		const session = this._sessions.get(sessionId);
		if (session) {
			this._sessions.delete(sessionId);
			this._updateStatusBar();

			this._onStatusChange.fire({
				sessionId,
				previousStatus: session.status,
				newStatus: 'idle',
				sessionInfo: session,
			});
		}
	}

	getSession(sessionId: string): IAgentSessionInfo | undefined {
		return this._sessions.get(sessionId);
	}

	getAllSessions(): readonly IAgentSessionInfo[] {
		return Array.from(this._sessions.values());
	}

	getSessionsByStatus(status: AgentSessionStatus): readonly IAgentSessionInfo[] {
		return Array.from(this._sessions.values()).filter(s => s.status === status);
	}

	show(): void {
		this._statusBarItem.show();
	}

	hide(): void {
		this._statusBarItem.hide();
	}

	processMessage(message: IA2AMessage): void {
		const sessionId = message.taskId ?? message.subTaskId ?? message.sender.id;

		// Ensure session exists
		if (!this._sessions.has(sessionId)) {
			this.registerSession(sessionId, this._inferAgentType(message.sender.id));
		}

		// Process based on message type
		if (isStatusUpdateContent(message.content)) {
			this._processStatusUpdate(sessionId, message.content);
		} else if (isCompletionContent(message.content)) {
			this._processCompletion(sessionId, message.content);
		} else if (isErrorContent(message.content)) {
			this._processError(sessionId, message.content);
		} else if (isApprovalRequestContent(message.content)) {
			this._processApprovalRequest(sessionId, message.content);
		}
	}

	private _processStatusUpdate(sessionId: string, content: IStatusUpdateContent): void {
		this.updateSession(sessionId, {
			status: 'active',
			statusMessage: content.status,
			progress: content.progress,
			currentFiles: content.currentFiles,
		});
	}

	private _processCompletion(sessionId: string, content: ICompletionContent): void {
		this.updateSession(sessionId, {
			status: content.success ? 'completed' : 'failed',
			statusMessage: content.success ? 'Completed successfully' : (content.error ?? 'Failed'),
			progress: 100,
			endTime: Date.now(),
			error: content.error,
		});
	}

	private _processError(sessionId: string, content: IErrorContent): void {
		this.updateSession(sessionId, {
			status: 'failed',
			statusMessage: content.message,
			error: content.message,
			endTime: Date.now(),
		});
	}

	private _processApprovalRequest(sessionId: string, content: IApprovalRequestContent): void {
		this.updateSession(sessionId, {
			status: 'waiting_approval',
			statusMessage: `Waiting for approval: ${content.action}`,
		});

		this._onApprovalNeeded.fire({
			sessionId,
			approvalId: content.approvalId,
			action: content.action,
			description: content.description,
			riskLevel: content.riskLevel,
			affectedResources: content.affectedResources,
		});
	}

	private _inferAgentType(agentId: string): string {
		if (agentId.includes('claude')) {
			return 'claude';
		} else if (agentId.includes('copilot')) {
			return 'copilot';
		}
		return 'agent';
	}

	private _updateStatusBar(): void {
		const activeSessions = this.getSessionsByStatus('active');
		const waitingSessions = this.getSessionsByStatus('waiting_approval');
		const failedSessions = this.getSessionsByStatus('failed');

		// Determine overall status
		let overallStatus: AgentSessionStatus = 'idle';
		if (failedSessions.length > 0) {
			overallStatus = 'failed';
		} else if (waitingSessions.length > 0) {
			overallStatus = 'waiting_approval';
		} else if (activeSessions.length > 0) {
			overallStatus = 'active';
		}

		// Update status bar
		const icon = STATUS_ICONS[overallStatus];
		const color = STATUS_COLORS[overallStatus];

		if (this._sessions.size === 0) {
			this._statusBarItem.hide();
			return;
		}

		// Build text
		let text = `${icon} Agent`;
		if (activeSessions.length > 0) {
			// Show progress for first active session if available
			const firstActive = activeSessions[0];
			if (firstActive.progress !== undefined) {
				text = `${icon} Agent (${firstActive.progress}%)`;
			} else {
				text = `${icon} Agent (running)`;
			}
		} else if (waitingSessions.length > 0) {
			text = `${icon} Agent (approval needed)`;
		} else if (failedSessions.length > 0) {
			text = `${icon} Agent (${failedSessions.length} failed)`;
		}

		this._statusBarItem.text = text;
		this._statusBarItem.backgroundColor = color;

		// Build tooltip
		const tooltipLines: string[] = ['## $(copilot) Agent Status'];
		tooltipLines.push('');

		if (activeSessions.length > 0) {
			tooltipLines.push(`**Active:** ${activeSessions.length} session(s)`);
			for (const session of activeSessions) {
				const progress = session.progress !== undefined ? ` (${session.progress}%)` : '';
				tooltipLines.push(`- ${session.agentType}: ${session.statusMessage}${progress}`);
			}
			tooltipLines.push('');
		}

		if (waitingSessions.length > 0) {
			tooltipLines.push(`**Waiting Approval:** ${waitingSessions.length} session(s)`);
			for (const session of waitingSessions) {
				tooltipLines.push(`- ${session.agentType}: ${session.statusMessage}`);
			}
			tooltipLines.push('');
		}

		if (failedSessions.length > 0) {
			tooltipLines.push(`**Failed:** ${failedSessions.length} session(s)`);
			for (const session of failedSessions) {
				tooltipLines.push(`- ${session.agentType}: ${session.error ?? 'Unknown error'}`);
			}
			tooltipLines.push('');
		}

		tooltipLines.push('$(chevron-right) Click to view details');

		const tooltip = new vscode.MarkdownString(tooltipLines.join('\n'));
		tooltip.isTrusted = true;
		tooltip.supportThemeIcons = true;
		this._statusBarItem.tooltip = tooltip;

		this._statusBarItem.show();
	}

	private async _showStatusQuickPick(): Promise<void> {
		const sessions = this.getAllSessions();

		if (sessions.length === 0) {
			vscode.window.showInformationMessage('No active agent sessions.');
			return;
		}

		const items: vscode.QuickPickItem[] = sessions.map(session => ({
			label: `${STATUS_ICONS[session.status]} ${session.agentType}`,
			description: session.statusMessage,
			detail: this._formatSessionDetail(session),
		}));

		// Add separator and actions
		items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
		items.push({
			label: '$(refresh) Refresh',
			description: 'Refresh agent status',
		});
		items.push({
			label: '$(clear-all) Clear Completed',
			description: 'Remove completed sessions from list',
		});

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: 'Agent Sessions',
			title: 'Agent Status',
		});

		if (!selected) {
			return;
		}

		if (selected.label.includes('Refresh')) {
			this._updateStatusBar();
		} else if (selected.label.includes('Clear Completed')) {
			for (const session of sessions) {
				if (session.status === 'completed' || session.status === 'cancelled') {
					this.removeSession(session.sessionId);
				}
			}
		}
	}

	private _formatSessionDetail(session: IAgentSessionInfo): string {
		const parts: string[] = [];

		if (session.taskId) {
			parts.push(`Task: ${session.taskId}`);
		}

		if (session.progress !== undefined) {
			parts.push(`Progress: ${session.progress}%`);
		}

		if (session.currentFiles && session.currentFiles.length > 0) {
			parts.push(`Files: ${session.currentFiles.slice(0, 3).join(', ')}${session.currentFiles.length > 3 ? '...' : ''}`);
		}

		const elapsed = Date.now() - session.startTime;
		parts.push(`Duration: ${this._formatDuration(elapsed)}`);

		return parts.join(' | ');
	}

	private _formatDuration(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);

		if (hours > 0) {
			return `${hours}h ${minutes % 60}m`;
		} else if (minutes > 0) {
			return `${minutes}m ${seconds % 60}s`;
		}
		return `${seconds}s`;
	}

	override dispose(): void {
		this._subscriptions.dispose();
		super.dispose();
	}
}

/**
 * Create a simple status display for testing or minimal UI.
 */
export function createSimpleStatusDisplay(): IAgentStatusDisplay {
	return new AgentStatusDisplay();
}
