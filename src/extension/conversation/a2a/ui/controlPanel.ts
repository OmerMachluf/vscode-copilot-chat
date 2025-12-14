/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Emitter, Event } from '../../../../util/vs/base/common/event';
import { Disposable, DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import type { IA2AMessage, IStatusUpdateContent } from '../messageTypes';
import type { IA2AMessageRouter } from '../messageRouter';
import { PermissionLevel } from '../permissions';

export interface IPendingApproval {
readonly id: string;
readonly sessionId: string;
readonly operation: string;
readonly description: string;
readonly requiredLevel: PermissionLevel;
readonly timestamp: number;
}

export interface IApprovalDecisionEvent {
readonly approvalId: string;
readonly approved: boolean;
readonly reason?: string;
}

export const CONTROL_PANEL_COMMANDS = {
showSessions: 'copilot.a2a.showSessions',
stopSession: 'copilot.a2a.stopSession',
stopAllSessions: 'copilot.a2a.stopAllSessions',
approveOperation: 'copilot.a2a.approveOperation',
rejectOperation: 'copilot.a2a.rejectOperation',
showPendingApprovals: 'copilot.a2a.showPendingApprovals',
configurePermissions: 'copilot.a2a.configurePermissions',
} as const;

export interface IAgentControlPanel extends vscode.Disposable {
readonly onApprovalDecision: Event<IApprovalDecisionEvent>;
addPendingApproval(approval: IPendingApproval): void;
removePendingApproval(approvalId: string): void;
getPendingApprovals(): readonly IPendingApproval[];
showApprovalDialog(approvalId: string): Promise<boolean>;
showSessionsList(): Promise<void>;
showPendingApprovalsList(): Promise<void>;
registerCommands(): vscode.Disposable;
}

interface ISessionInfo {
readonly id: string;
readonly status: 'running' | 'idle' | 'waiting_approval' | 'completed' | 'failed';
readonly taskDescription?: string;
readonly startTime: number;
readonly worktreePath?: string;
}

export class AgentControlPanel extends Disposable implements IAgentControlPanel {
private readonly _pendingApprovals = new Map<string, IPendingApproval>();
private readonly _sessions = new Map<string, ISessionInfo>();
private readonly _disposables = this._register(new DisposableStore());

private readonly _onApprovalDecision = this._register(new Emitter<IApprovalDecisionEvent>());
public readonly onApprovalDecision = this._onApprovalDecision.event;

constructor(private readonly _messageRouter?: IA2AMessageRouter) {
super();
if (_messageRouter) {
this._disposables.add(
_messageRouter.onMessage((message) => this._handleMessage(message))
);
}
}

private _handleMessage(message: IA2AMessage): void {
if (message.type === 'status_update') {
const content = message.content as IStatusUpdateContent;
this._updateSession(message.sourceId, {
id: message.sourceId,
status: this._mapStatus(content.status),
taskDescription: content.currentTask,
startTime: Date.now(),
worktreePath: content.worktreePath,
});
} else if (message.type === 'completion') {
const session = this._sessions.get(message.sourceId);
if (session) {
this._updateSession(message.sourceId, { ...session, status: 'completed' });
}
} else if (message.type === 'error') {
const session = this._sessions.get(message.sourceId);
if (session) {
this._updateSession(message.sourceId, { ...session, status: 'failed' });
}
}
}

private _mapStatus(status: string): ISessionInfo['status'] {
switch (status) {
case 'running':
case 'in_progress':
return 'running';
case 'waiting':
case 'blocked':
return 'waiting_approval';
case 'completed':
case 'done':
return 'completed';
case 'failed':
case 'error':
return 'failed';
default:
return 'idle';
}
}

private _updateSession(sessionId: string, info: ISessionInfo): void {
this._sessions.set(sessionId, info);
}

public addPendingApproval(approval: IPendingApproval): void {
this._pendingApprovals.set(approval.id, approval);
void this._showApprovalNotification(approval);
}

private async _showApprovalNotification(approval: IPendingApproval): Promise<void> {
const result = await vscode.window.showInformationMessage(
'Agent requires approval: ' + approval.description,
{ modal: false },
'Approve',
'Deny',
'View Details'
);

if (result === 'Approve') {
this._handleApproval(approval.id, true);
} else if (result === 'Deny') {
this._handleApproval(approval.id, false);
} else if (result === 'View Details') {
await this.showApprovalDialog(approval.id);
}
}

public removePendingApproval(approvalId: string): void {
this._pendingApprovals.delete(approvalId);
}

public getPendingApprovals(): readonly IPendingApproval[] {
return Array.from(this._pendingApprovals.values());
}

public async showApprovalDialog(approvalId: string): Promise<boolean> {
const approval = this._pendingApprovals.get(approvalId);
if (!approval) {
vscode.window.showErrorMessage('Approval request not found.');
return false;
}

const items: vscode.QuickPickItem[] = [
{ label: 'Approve', description: 'Allow this operation to proceed' },
{ label: 'Deny', description: 'Reject this operation' },
{ label: 'Approve All Similar', description: 'Approve this and future similar operations' },
];

const selected = await vscode.window.showQuickPick(items, {
title: 'Approval Required: ' + approval.operation,
placeHolder: approval.description,
});

if (!selected) {
return false;
}

const approved = selected.label.includes('Approve');
const autoApprove = selected.label.includes('All Similar');
this._handleApproval(approvalId, approved, autoApprove);
return approved;
}

private _handleApproval(approvalId: string, approved: boolean, autoApprove = false): void {
this._onApprovalDecision.fire({
approvalId,
approved,
reason: autoApprove ? 'auto_approve_similar' : undefined,
});
this.removePendingApproval(approvalId);
}

public async showSessionsList(): Promise<void> {
const sessions = Array.from(this._sessions.values());
if (sessions.length === 0) {
vscode.window.showInformationMessage('No active agent sessions.');
return;
}

const items: (vscode.QuickPickItem & { sessionId: string })[] = sessions.map((session) => ({
label: session.id,
description: session.taskDescription ?? 'No task description',
detail: 'Status: ' + session.status + ' | Duration: ' + this._formatDuration(session.startTime),
sessionId: session.id,
}));

const selected = await vscode.window.showQuickPick(items, {
title: 'Active Agent Sessions',
placeHolder: 'Select a session to manage',
});

if (selected) {
await this._showSessionActions(selected.sessionId);
}
}

private _formatDuration(startTime: number): string {
const seconds = Math.floor((Date.now() - startTime) / 1000);
if (seconds < 60) {
return seconds + 's';
}
const minutes = Math.floor(seconds / 60);
return minutes + 'm ' + (seconds % 60) + 's';
}

private async _showSessionActions(sessionId: string): Promise<void> {
const session = this._sessions.get(sessionId);
if (!session) {
return;
}

const items: vscode.QuickPickItem[] = [
{ label: 'Stop Session', description: 'Stop this agent session' },
{ label: 'Open Worktree', description: 'Open the worktree folder' },
{ label: 'View Logs', description: 'View session output logs' },
];

const selected = await vscode.window.showQuickPick(items, {
title: 'Session: ' + sessionId,
placeHolder: 'Select an action',
});

if (!selected) {
return;
}

if (selected.label.includes('Stop')) {
vscode.window.showInformationMessage('Stopping session: ' + sessionId);
} else if (selected.label.includes('Worktree') && session.worktreePath) {
await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(session.worktreePath), { forceNewWindow: true });
} else if (selected.label.includes('Logs')) {
vscode.window.showInformationMessage('Viewing logs for session: ' + sessionId);
}
}

public async showPendingApprovalsList(): Promise<void> {
const approvals = this.getPendingApprovals();
if (approvals.length === 0) {
vscode.window.showInformationMessage('No pending approvals.');
return;
}

const items: (vscode.QuickPickItem & { approvalId: string })[] = approvals.map((approval) => ({
label: approval.operation,
description: approval.description,
detail: 'Session: ' + approval.sessionId + ' | Level: ' + PermissionLevel[approval.requiredLevel],
approvalId: approval.id,
}));

const selected = await vscode.window.showQuickPick(items, {
title: 'Pending Approvals',
placeHolder: 'Select an approval to review',
});

if (selected) {
await this.showApprovalDialog(selected.approvalId);
}
}

public registerCommands(): vscode.Disposable {
const disposables = new DisposableStore();

disposables.add(
vscode.commands.registerCommand(CONTROL_PANEL_COMMANDS.showSessions, () => this.showSessionsList())
);
disposables.add(
vscode.commands.registerCommand(CONTROL_PANEL_COMMANDS.showPendingApprovals, () => this.showPendingApprovalsList())
);
disposables.add(
vscode.commands.registerCommand(CONTROL_PANEL_COMMANDS.stopAllSessions, () => {
vscode.window.showInformationMessage('Stopping all agent sessions...');
})
);
disposables.add(
vscode.commands.registerCommand(CONTROL_PANEL_COMMANDS.configurePermissions, () => {
vscode.commands.executeCommand('workbench.action.openSettings', 'github.copilot.chat.agentPermissions');
})
);

return disposables;
}
}

let _controlPanel: AgentControlPanel | undefined;

export function getAgentControlPanel(messageRouter?: IA2AMessageRouter): IAgentControlPanel {
if (!_controlPanel) {
_controlPanel = new AgentControlPanel(messageRouter);
}
return _controlPanel;
}
