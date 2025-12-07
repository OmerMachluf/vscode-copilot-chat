/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable, DisposableStore } from '../../../util/vs/base/common/lifecycle';
import { IOrchestratorService } from '../orchestratorServiceV2';
import { WorkerSessionState } from '../workerSession';
import { getBaseStyles, getEventDelegationScript, getNonce } from './webviewUtils';

/**
 * Represents a git change in a worktree
 */
export interface WorktreeChange {
	readonly path: string;
	readonly status: 'staged' | 'modified' | 'untracked' | 'deleted' | 'renamed' | 'conflict';
	readonly originalPath?: string; // For renames
}

/**
 * A detachable WebviewPanel that shows a full conversation view for a worker,
 * including git changes for the worktree.
 */
export class WorkerChatPanel extends Disposable {
	public static readonly viewType = 'copilot.orchestrator.workerChat';
	private static _panels = new Map<string, WorkerChatPanel>();

	private readonly _panel: vscode.WebviewPanel;
	private readonly _disposables = this._register(new DisposableStore());
	private readonly _workerId: string;
	private _currentTab: 'chat' | 'changes' = 'chat';
	private _gitChanges: WorktreeChange[] = [];

	public static createOrShow(
		orchestrator: IOrchestratorService,
		workerId: string,
		extensionUri: vscode.Uri,
	): WorkerChatPanel {
		// Check if panel already exists for this worker
		const existing = WorkerChatPanel._panels.get(workerId);
		if (existing) {
			existing._panel.reveal();
			return existing;
		}

		const workerState = orchestrator.getWorkerState(workerId);
		const title = workerState ? `Worker: ${workerState.name}` : `Worker ${workerId}`;

		const panel = vscode.window.createWebviewPanel(
			WorkerChatPanel.viewType,
			title,
			vscode.ViewColumn.Two,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [extensionUri],
			}
		);

		const chatPanel = new WorkerChatPanel(panel, orchestrator, workerId);
		WorkerChatPanel._panels.set(workerId, chatPanel);
		return chatPanel;
	}

	private constructor(
		panel: vscode.WebviewPanel,
		private readonly _orchestrator: IOrchestratorService,
		workerId: string,
	) {
		super();
		this._panel = panel;
		this._workerId = workerId;

		// Set initial HTML
		this._panel.webview.html = this._getHtmlForWebview();

		// Handle messages from webview
		this._disposables.add(
			this._panel.webview.onDidReceiveMessage(async (data) => {
				await this._handleMessage(data);
			})
		);

		// Update when orchestrator state changes
		this._disposables.add(
			this._orchestrator.onDidChangeWorkers(() => {
				this._update();
			})
		);

		// Clean up when panel is closed
		this._disposables.add(
			this._panel.onDidDispose(() => {
				WorkerChatPanel._panels.delete(this._workerId);
				this.dispose();
			})
		);

		// Initial update
		this._update();
		this._loadGitChanges();
	}

	private async _handleMessage(data: any): Promise<void> {
		switch (data.type) {
			case 'refresh':
				this._update();
				break;
			case 'sendMessage':
				this._orchestrator.sendMessageToWorker(this._workerId, data.message);
				break;
			case 'approve':
				this._orchestrator.handleApproval(this._workerId, data.approvalId, true, data.clarification);
				break;
			case 'reject':
				this._orchestrator.handleApproval(this._workerId, data.approvalId, false, data.reason);
				break;
			case 'stop':
			case 'interrupt':
				this._orchestrator.interruptWorker(this._workerId);
				break;
			case 'pause':
				this._orchestrator.pauseWorker(this._workerId);
				break;
			case 'resume':
				this._orchestrator.resumeWorker(this._workerId);
				break;
			case 'complete':
				try {
					await this._orchestrator.completeWorker(this._workerId, { createPullRequest: false });
					this._panel.dispose();
				} catch (err: any) {
					vscode.window.showErrorMessage(`Failed to complete worker: ${err.message}`);
				}
				break;
			case 'completeWithPR':
				try {
					await this._orchestrator.completeWorker(this._workerId, { createPullRequest: true });
					this._panel.dispose();
				} catch (err: any) {
					vscode.window.showErrorMessage(`Failed to complete worker: ${err.message}`);
				}
				break;
			case 'killWorker':
				const confirmed = await vscode.window.showWarningMessage(
					`Are you sure you want to kill worker "${this._workerId}"? This will remove the worktree and reset the task.`,
					{ modal: true },
					'Yes'
				);
				if (confirmed === 'Yes') {
					try {
						await this._orchestrator.killWorker(this._workerId, { removeWorktree: true, resetTask: true });
						this._panel.dispose();
					} catch (err: any) {
						vscode.window.showErrorMessage(`Failed to kill worker: ${err.message}`);
					}
				}
				break;
			case 'switchTab':
				this._currentTab = data.tab;
				this._update();
				break;
			case 'openFile':
				await this._openFileInDiff(data.path);
				break;
			case 'refreshGitChanges':
				await this._loadGitChanges();
				break;
		}
	}

	private async _openFileInDiff(filePath: string): Promise<void> {
		const workerState = this._orchestrator.getWorkerState(this._workerId);
		if (!workerState) {
			return;
		}

		const fullPath = vscode.Uri.file(`${workerState.worktreePath}/${filePath}`);

		// Try to open as diff against HEAD
		try {
			await vscode.commands.executeCommand('vscode.diff',
				vscode.Uri.parse(`git:${fullPath.fsPath}?~`),
				fullPath,
				`${filePath} (Working Changes)`
			);
		} catch {
			// Fallback to just opening the file
			await vscode.commands.executeCommand('vscode.open', fullPath);
		}
	}

	private async _loadGitChanges(): Promise<void> {
		const workerState = this._orchestrator.getWorkerState(this._workerId);
		if (!workerState) {
			return;
		}

		try {
			// Use git status to get changes
			const worktreePath = workerState.worktreePath;
			const changes: WorktreeChange[] = [];

			// Execute git status --porcelain to get file changes
			const result = await this._executeGitCommand(worktreePath, ['status', '--porcelain']);
			if (result) {
				const lines = result.trim().split('\n').filter(l => l.length > 0);
				for (const line of lines) {
					const indexStatus = line[0];
					const workingStatus = line[1];
					const filePath = line.substring(3);

					let status: WorktreeChange['status'] = 'modified';

					// Determine status based on git status codes
					if (indexStatus === 'A' || (indexStatus === '?' && workingStatus === '?')) {
						status = workingStatus === '?' ? 'untracked' : 'staged';
					} else if (indexStatus === 'D' || workingStatus === 'D') {
						status = 'deleted';
					} else if (indexStatus === 'R') {
						status = 'renamed';
					} else if (indexStatus === 'U' || workingStatus === 'U') {
						status = 'conflict';
					} else if (indexStatus === 'M' || indexStatus === ' ' && workingStatus === 'M') {
						status = indexStatus === 'M' ? 'staged' : 'modified';
					}

					changes.push({ path: filePath, status });
				}
			}

			this._gitChanges = changes;
			this._update();
		} catch (err) {
			console.error('Failed to load git changes:', err);
		}
	}

	private async _executeGitCommand(cwd: string, args: string[]): Promise<string | undefined> {
		try {
			const { exec } = await import('child_process');
			const { promisify } = await import('util');
			const execPromise = promisify(exec);

			const { stdout } = await execPromise(`git ${args.join(' ')}`, { cwd });
			return stdout;
		} catch {
			return undefined;
		}
	}

	private _update(): void {
		const workerState = this._orchestrator.getWorkerState(this._workerId);

		this._panel.webview.postMessage({
			type: 'update',
			worker: workerState ? this._serializeWorkerState(workerState) : null,
			currentTab: this._currentTab,
			gitChanges: this._gitChanges,
		});
	}

	private _serializeWorkerState(state: WorkerSessionState): any {
		return {
			id: state.id,
			name: state.name,
			task: state.task,
			worktreePath: state.worktreePath,
			status: state.status,
			messages: state.messages.map(m => ({
				id: m.id,
				timestamp: m.timestamp,
				role: m.role,
				content: m.content,
				toolName: m.toolName,
				isApprovalRequest: m.isApprovalRequest,
				isPending: m.isPending,
			})),
			pendingApprovals: state.pendingApprovals.map(a => ({
				id: a.id,
				timestamp: a.timestamp,
				toolName: a.toolName,
				description: a.description,
				parameters: a.parameters,
			})),
			createdAt: state.createdAt,
			lastActivityAt: state.lastActivityAt,
			errorMessage: state.errorMessage,
			planId: state.planId,
			baseBranch: state.baseBranch,
		};
	}

	private _getHtmlForWebview(): string {
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<title>Worker Chat</title>
	<style>
		${getBaseStyles()}

		/* Panel layout */
		.panel-container {
			display: flex;
			flex-direction: column;
			height: 100vh;
			max-height: 100vh;
			overflow: hidden;
		}

		/* Header */
		.panel-header {
			padding: 10px;
			background: var(--vscode-sideBarSectionHeader-background);
			border-bottom: 1px solid var(--vscode-widget-border);
			flex-shrink: 0;
		}
		.header-row {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 8px;
		}
		.worker-title {
			font-size: 1.1em;
			font-weight: bold;
			margin: 0;
		}
		.worker-task {
			font-size: 0.9em;
			color: var(--vscode-descriptionForeground);
			margin-top: 4px;
		}
		.header-actions {
			display: flex;
			gap: 6px;
		}

		/* Tabs */
		.tabs {
			display: flex;
			border-bottom: 1px solid var(--vscode-widget-border);
			background: var(--vscode-sideBarSectionHeader-background);
			flex-shrink: 0;
		}
		.tab {
			padding: 8px 16px;
			cursor: pointer;
			border: none;
			background: transparent;
			color: var(--vscode-descriptionForeground);
			border-bottom: 2px solid transparent;
			transition: all 0.2s;
		}
		.tab:hover {
			background: var(--vscode-list-hoverBackground);
		}
		.tab.active {
			color: var(--vscode-foreground);
			border-bottom-color: var(--vscode-focusBorder);
		}
		.tab-badge {
			margin-left: 6px;
			padding: 1px 6px;
			border-radius: 10px;
			font-size: 0.8em;
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
		}

		/* Tab content */
		.tab-content {
			flex: 1;
			overflow: hidden;
			display: none;
		}
		.tab-content.active {
			display: flex;
			flex-direction: column;
		}

		/* Chat area */
		.chat-messages {
			flex: 1;
			overflow-y: auto;
			padding: 10px;
		}

		/* Message styles */
		.message {
			margin-bottom: 12px;
			padding: 10px 12px;
			border-radius: 8px;
			max-width: 85%;
			word-wrap: break-word;
		}
		.message.user {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			margin-left: auto;
			border-bottom-right-radius: 2px;
		}
		.message.assistant {
			background: var(--vscode-editor-inactiveSelectionBackground);
			margin-right: auto;
			border-bottom-left-radius: 2px;
		}
		.message.system {
			background: var(--vscode-textBlockQuote-background);
			font-style: italic;
			text-align: center;
			margin: 8px auto;
			color: var(--vscode-descriptionForeground);
			max-width: 100%;
			font-size: 0.9em;
		}
		.message.tool {
			background: var(--vscode-textCodeBlock-background);
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 0.9em;
			margin-right: auto;
			border-left: 3px solid var(--vscode-textLink-foreground);
		}
		.message-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 6px;
			font-size: 0.8em;
		}
		.message-role {
			font-weight: bold;
			text-transform: capitalize;
		}
		.message-time {
			color: var(--vscode-descriptionForeground);
		}
		.message-content {
			line-height: 1.5;
		}
		.message-content pre {
			margin: 8px 0;
			padding: 8px;
			background: var(--vscode-textCodeBlock-background);
			border-radius: 4px;
			overflow-x: auto;
		}
		.message-content code.inline-code {
			background: var(--vscode-textCodeBlock-background);
			padding: 2px 5px;
			border-radius: 3px;
		}

		/* Tool messages */
		.tool-name {
			color: var(--vscode-textLink-foreground);
			font-weight: 500;
			margin-bottom: 4px;
		}

		/* Approval card */
		.approval-card {
			background: var(--vscode-inputValidation-warningBackground);
			border: 1px solid var(--vscode-inputValidation-warningBorder);
			border-radius: 8px;
			padding: 12px;
			margin: 10px;
		}
		.approval-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 8px;
		}
		.approval-tool {
			font-weight: bold;
			color: var(--vscode-notificationsWarningIcon-foreground);
		}
		.approval-description {
			margin-bottom: 10px;
		}
		.approval-params {
			background: var(--vscode-input-background);
			padding: 8px;
			border-radius: 4px;
			font-family: monospace;
			font-size: 0.9em;
			margin-bottom: 10px;
			max-height: 150px;
			overflow-y: auto;
		}
		.approval-actions {
			display: flex;
			gap: 8px;
		}
		.approval-input {
			flex: 1;
		}

		/* Message input */
		.message-input-area {
			padding: 10px;
			border-top: 1px solid var(--vscode-widget-border);
			background: var(--vscode-sideBar-background);
			flex-shrink: 0;
		}
		.message-input-container {
			display: flex;
			gap: 8px;
		}
		.message-input {
			flex: 1;
			padding: 8px;
			min-height: 40px;
		}

		/* Git changes tab */
		.git-changes {
			flex: 1;
			overflow-y: auto;
			padding: 10px;
		}
		.git-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 12px;
		}
		.file-list {
			list-style: none;
			padding: 0;
			margin: 0;
		}
		.file-item {
			display: flex;
			align-items: center;
			padding: 8px;
			border-radius: 4px;
			cursor: pointer;
			transition: background 0.2s;
		}
		.file-item:hover {
			background: var(--vscode-list-hoverBackground);
		}
		.file-icon {
			margin-right: 8px;
			width: 16px;
			text-align: center;
		}
		.file-icon.staged { color: var(--vscode-gitDecoration-addedResourceForeground); }
		.file-icon.modified { color: var(--vscode-gitDecoration-modifiedResourceForeground); }
		.file-icon.untracked { color: var(--vscode-gitDecoration-untrackedResourceForeground); }
		.file-icon.deleted { color: var(--vscode-gitDecoration-deletedResourceForeground); }
		.file-icon.conflict { color: var(--vscode-gitDecoration-conflictingResourceForeground); }
		.file-path {
			flex: 1;
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 0.9em;
		}
		.file-status {
			font-size: 0.8em;
			padding: 2px 6px;
			border-radius: 3px;
			text-transform: uppercase;
		}
		.file-status.staged { background: var(--vscode-gitDecoration-addedResourceForeground); color: white; }
		.file-status.modified { background: var(--vscode-gitDecoration-modifiedResourceForeground); color: white; }
		.file-status.untracked { background: var(--vscode-gitDecoration-untrackedResourceForeground); color: white; }
		.file-status.deleted { background: var(--vscode-gitDecoration-deletedResourceForeground); color: white; }
		.file-status.conflict { background: var(--vscode-gitDecoration-conflictingResourceForeground); color: white; }

		.no-changes {
			text-align: center;
			padding: 40px;
			color: var(--vscode-descriptionForeground);
		}

		.empty-state {
			text-align: center;
			padding: 40px;
			color: var(--vscode-descriptionForeground);
		}
	</style>
</head>
<body>
	<div class="panel-container">
		<div class="panel-header">
			<div class="header-row">
				<h2 class="worker-title" id="worker-title">Loading...</h2>
				<div class="header-actions">
					<span class="badge" id="worker-status">-</span>
				</div>
			</div>
			<div class="worker-task" id="worker-task"></div>
			<div class="header-actions" style="margin-top: 8px;" id="action-buttons"></div>
		</div>

		<div class="tabs">
			<button class="tab active" data-action="switch-tab" data-tab="chat">
				💬 Chat
				<span class="tab-badge" id="message-count">0</span>
			</button>
			<button class="tab" data-action="switch-tab" data-tab="changes">
				📁 Changes
				<span class="tab-badge" id="changes-count">0</span>
			</button>
		</div>

		<div class="tab-content active" id="chat-tab">
			<div class="chat-messages" id="chat-messages">
				<div class="empty-state">No messages yet</div>
			</div>
			<div id="pending-approvals"></div>
			<div class="message-input-area">
				<div class="message-input-container">
					<textarea class="message-input" id="message-input" placeholder="Type a message..." rows="1"></textarea>
					<button data-action="send-message">Send</button>
				</div>
			</div>
		</div>

		<div class="tab-content" id="changes-tab">
			<div class="git-changes">
				<div class="git-header">
					<h3 class="m-0">Working Changes</h3>
					<button data-action="refresh-git" class="secondary">Refresh</button>
				</div>
				<ul class="file-list" id="file-list">
					<div class="no-changes">No changes detected</div>
				</ul>
			</div>
		</div>
	</div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		let currentWorker = null;
		let currentTab = 'chat';

		// Restore state if available
		const previousState = vscode.getState();
		if (previousState) {
			currentTab = previousState.currentTab || 'chat';
		}

		${getEventDelegationScript()}

		function handleAction(action, data) {
			switch (action) {
				case 'switch-tab':
					switchTab(data.target.getAttribute('data-tab'));
					vscode.postMessage({ type: 'switchTab', tab: data.target.getAttribute('data-tab') });
					break;
				case 'send-message':
					sendMessage();
					break;
				case 'approve':
					const clarification = document.getElementById('approval-clarification-' + data.approvalId)?.value || '';
					vscode.postMessage({ type: 'approve', approvalId: data.approvalId, clarification });
					break;
				case 'reject':
					const reason = document.getElementById('approval-clarification-' + data.approvalId)?.value || '';
					vscode.postMessage({ type: 'reject', approvalId: data.approvalId, reason });
					break;
				case 'stop':
				case 'interrupt':
					vscode.postMessage({ type: 'interrupt' });
					break;
				case 'pause':
					vscode.postMessage({ type: 'pause' });
					break;
				case 'resume':
					vscode.postMessage({ type: 'resume' });
					break;
				case 'complete':
					vscode.postMessage({ type: 'complete' });
					break;
				case 'complete-pr':
					vscode.postMessage({ type: 'completeWithPR' });
					break;
				case 'kill':
					vscode.postMessage({ type: 'killWorker' });
					break;
				case 'open-file':
					vscode.postMessage({ type: 'openFile', path: data.target.getAttribute('data-path') });
					break;
				case 'refresh-git':
					vscode.postMessage({ type: 'refreshGitChanges' });
					break;
			}
		}

		function switchTab(tab) {
			currentTab = tab;
			document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === tab));
			document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === tab + '-tab'));
			vscode.setState({ currentTab: tab });
		}

		function sendMessage() {
			const input = document.getElementById('message-input');
			const message = input.value.trim();
			if (message) {
				vscode.postMessage({ type: 'sendMessage', message });
				input.value = '';
			}
		}

		// Handle Enter key in message input
		document.getElementById('message-input').addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				sendMessage();
			}
		});

		// Handle messages from extension
		window.addEventListener('message', (event) => {
			const message = event.data;
			switch (message.type) {
				case 'update':
					updateUI(message.worker, message.gitChanges);
					break;
			}
		});

		function updateUI(worker, gitChanges) {
			currentWorker = worker;

			if (!worker) {
				document.getElementById('worker-title').textContent = 'Worker not found';
				document.getElementById('worker-status').textContent = '-';
				return;
			}

			// Update header
			document.getElementById('worker-title').textContent = worker.name;
			document.getElementById('worker-task').textContent = worker.task;

			const statusEl = document.getElementById('worker-status');
			statusEl.textContent = worker.status;
			statusEl.className = 'badge ' + worker.status.replace('-', '');

			// Update action buttons
			const actionsHtml = [];
			if (worker.status === 'running' || worker.status === 'waiting-approval') {
				actionsHtml.push('<button data-action="interrupt" class="warning interrupt-btn" title="Interrupt agent to provide feedback">⏹️ Interrupt</button>');
			}
			if (worker.status === 'idle') {
				actionsHtml.push('<button data-action="complete" class="success">✅ Complete</button>');
				actionsHtml.push('<button data-action="complete-pr" class="success">🔀 Complete + PR</button>');
			}
			actionsHtml.push('<button data-action="kill" class="danger">❌ Kill</button>');
			document.getElementById('action-buttons').innerHTML = actionsHtml.join('');

			// Update message count
			document.getElementById('message-count').textContent = worker.messages.length;

			// Update chat messages
			const messagesContainer = document.getElementById('chat-messages');
			if (worker.messages.length === 0) {
				messagesContainer.innerHTML = '<div class="empty-state">No messages yet</div>';
			} else {
				messagesContainer.innerHTML = worker.messages.map(renderMessage).join('');
				messagesContainer.scrollTop = messagesContainer.scrollHeight;
			}

			// Update pending approvals
			const approvalsContainer = document.getElementById('pending-approvals');
			if (worker.pendingApprovals && worker.pendingApprovals.length > 0) {
				approvalsContainer.innerHTML = worker.pendingApprovals.map(renderApproval).join('');
			} else {
				approvalsContainer.innerHTML = '';
			}

			// Update git changes
			document.getElementById('changes-count').textContent = gitChanges ? gitChanges.length : 0;
			const fileList = document.getElementById('file-list');
			if (gitChanges && gitChanges.length > 0) {
				fileList.innerHTML = gitChanges.map(renderFileChange).join('');
			} else {
				fileList.innerHTML = '<div class="no-changes">No working changes</div>';
			}
		}

		function renderMessage(msg) {
			const time = formatTime(msg.timestamp);
			const roleIcon = {
				user: '📝',
				assistant: '🤖',
				system: '⚙️',
				tool: '🔧'
			}[msg.role] || '';

			let contentHtml = renderMarkdown(msg.content);

			if (msg.role === 'tool' && msg.toolName) {
				return \`
					<div class="message tool">
						<div class="message-header">
							<span class="tool-name">🔧 \${escapeHtml(msg.toolName)}</span>
							<span class="message-time">\${time}</span>
						</div>
						<div class="message-content">\${contentHtml}</div>
					</div>
				\`;
			}

			return \`
				<div class="message \${msg.role}">
					<div class="message-header">
						<span class="message-role">\${roleIcon} \${msg.role}</span>
						<span class="message-time">\${time}</span>
					</div>
					<div class="message-content">\${contentHtml}</div>
				</div>
			\`;
		}

		function renderApproval(approval) {
			return \`
				<div class="approval-card">
					<div class="approval-header">
						<span class="approval-tool">⚠️ \${escapeHtml(approval.toolName)}</span>
					</div>
					<div class="approval-description">\${escapeHtml(approval.description)}</div>
					<div class="approval-params"><pre>\${escapeHtml(JSON.stringify(approval.parameters, null, 2))}</pre></div>
					<div class="approval-actions">
						<input type="text" id="approval-clarification-\${approval.id}" class="approval-input" placeholder="Optional clarification...">
						<button data-action="approve" data-approval-id="\${approval.id}" class="success">✅ Approve</button>
						<button data-action="reject" data-approval-id="\${approval.id}" class="danger">❌ Reject</button>
					</div>
				</div>
			\`;
		}

		function renderFileChange(change) {
			const icons = {
				staged: '+',
				modified: 'M',
				untracked: '?',
				deleted: 'D',
				renamed: 'R',
				conflict: '!'
			};
			return \`
				<li class="file-item" data-action="open-file" data-path="\${escapeHtml(change.path)}">
					<span class="file-icon \${change.status}">\${icons[change.status] || '?'}</span>
					<span class="file-path">\${escapeHtml(change.path)}</span>
					<span class="file-status \${change.status}">\${change.status}</span>
				</li>
			\`;
		}

		// Utility functions (duplicated from webviewUtils for browser context)
		function formatTime(timestamp) {
			const date = new Date(timestamp);
			return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		}

		function escapeHtml(text) {
			if (!text) return '';
			return text
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#039;');
		}

		function renderMarkdown(text) {
			if (!text) return '';
			let html = escapeHtml(text);

			// Code blocks
			html = html.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, (match, lang, code) => {
				return '<pre><code>' + code.trim() + '</code></pre>';
			});

			// Inline code
			html = html.replace(/\`([^\`]+)\`/g, '<code class="inline-code">$1</code>');

			// Bold
			html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');

			// Italic
			html = html.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');

			// Line breaks
			html = html.replace(/\\n/g, '<br>');

			return html;
		}

		// Initial tab setup
		switchTab(currentTab);
	</script>
</body>
</html>`;
	}
}
