/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AuditEventType, IAuditLogFilter, IAuditLogService } from '../auditLog';
import { IOrchestratorService } from '../orchestratorServiceV2';
import { WorkerChatPanel } from './WorkerChatPanel';

/**
 * Enhanced Worker Dashboard that provides full conversation view,
 * approval workflow, and worker management with multi-plan support.
 */
export class WorkerDashboardProviderV2 implements vscode.WebviewViewProvider {
	public static readonly viewType = 'copilot.orchestrator.dashboard';
	private _view?: vscode.WebviewView;
	private _auditLogFilter: IAuditLogFilter = {};

	constructor(
		private readonly _orchestrator: IOrchestratorService,
		private readonly _extensionUri: vscode.Uri,
		private readonly _auditLog?: IAuditLogService,
	) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: []
		};

		webviewView.webview.html = this._getHtmlForWebview();

		webviewView.webview.onDidReceiveMessage(async data => {
			console.log('[Orchestrator Dashboard] Received message:', data.type, data);
			switch (data.type) {
				case 'refresh':
					this._update();
					break;
				case 'getModels':
					await this._sendAvailableModels();
					break;
				case 'confirmAction': {
					// Show VS Code native confirmation dialog
					const result = await vscode.window.showWarningMessage(
						data.message,
						{ modal: true },
						'Yes'
					);
					if (result === 'Yes') {
						// Re-dispatch the confirmed action
						switch (data.action) {
							case 'complete':
								this._orchestrator.completeWorker(data.workerId, { createPullRequest: false }).catch(err => {
									vscode.window.showErrorMessage(`Failed to complete worker: ${err.message}`);
								});
								break;
							case 'completeWithPR':
								this._orchestrator.completeWorker(data.workerId, { createPullRequest: true }).catch(err => {
									vscode.window.showErrorMessage(`Failed to complete worker: ${err.message}`);
								});
								break;
							case 'killWorker':
								this._orchestrator.killWorker(data.workerId, { removeWorktree: true, resetTask: true }).catch(err => {
									vscode.window.showErrorMessage(`Failed to kill worker: ${err.message}`);
								});
								break;
							case 'cancelTask':
								this._orchestrator.cancelTask(data.taskId, false).catch(err => {
									vscode.window.showErrorMessage(`Failed to cancel task: ${err.message}`);
								});
								break;
							case 'retryTask':
								this._orchestrator.retryTask(data.taskId, data.modelId ? { modelId: data.modelId } : undefined).catch(err => {
									vscode.window.showErrorMessage(`Failed to retry task: ${err.message}`);
								});
								break;
						}
					}
					break;
				}
				case 'addTask':
					this._orchestrator.addTask(data.description, {
						name: data.name,
						priority: data.priority,
						baseBranch: data.baseBranch,
						modelId: data.modelId,
						dependencies: data.dependencies,
						agent: data.agent,
					});
					break;
				case 'removeTask':
					this._orchestrator.removeTask(data.taskId);
					break;
				case 'clearPlan':
					this._orchestrator.clearPlan();
					break;
				case 'deploy':
					this._orchestrator.deploy(data.taskId, data.modelId ? { modelId: data.modelId } : undefined);
					break;
				case 'deployAll':
					this._orchestrator.deployAll(undefined, data.modelId ? { modelId: data.modelId } : undefined);
					break;
				case 'sendMessage':
					this._orchestrator.sendMessageToWorker(data.workerId, data.message);
					break;
				case 'approve':
					this._orchestrator.handleApproval(data.workerId, data.approvalId, true, data.clarification);
					break;
				case 'reject':
					this._orchestrator.handleApproval(data.workerId, data.approvalId, false, data.reason);
					break;
				case 'stop':
				case 'interrupt':
					this._orchestrator.interruptWorker(data.workerId);
					break;
				case 'pause':
					this._orchestrator.pauseWorker(data.workerId);
					break;
				case 'resume':
					this._orchestrator.resumeWorker(data.workerId);
					break;
				case 'conclude':
					this._orchestrator.concludeWorker(data.workerId);
					break;
				case 'complete':
					this._orchestrator.completeWorker(data.workerId, {
						createPullRequest: data.createPR ?? false,
					}).catch(err => {
						vscode.window.showErrorMessage(`Failed to complete worker: ${err.message}`);
					});
					break;
				case 'completeWithPR':
					this._orchestrator.completeWorker(data.workerId, {
						createPullRequest: true,
					}).catch(err => {
						vscode.window.showErrorMessage(`Failed to complete worker: ${err.message}`);
					});
					break;
				case 'killWorker':
					this._orchestrator.killWorker(data.workerId, {
						removeWorktree: data.removeWorktree ?? true,
						resetTask: data.resetTask ?? true,
					}).catch(err => {
						vscode.window.showErrorMessage(`Failed to kill worker: ${err.message}`);
					});
					break;
				case 'cancelTask':
					this._orchestrator.cancelTask(data.taskId, data.remove ?? false).catch(err => {
						vscode.window.showErrorMessage(`Failed to cancel task: ${err.message}`);
					});
					break;
				case 'retryTask':
					this._orchestrator.retryTask(data.taskId).catch(err => {
						vscode.window.showErrorMessage(`Failed to retry task: ${err.message}`);
					});
					break;
				case 'setWorkerModel':
					try {
						this._orchestrator.setWorkerModel(data.workerId, data.modelId);
					} catch (err: any) {
						vscode.window.showErrorMessage(`Failed to set model: ${err.message}`);
					}
					break;
				case 'openChat':
					WorkerChatPanel.createOrShow(this._orchestrator, data.workerId, this._extensionUri);
					break;
				case 'createPlan':
					this._orchestrator.createPlan(data.name, data.description, data.baseBranch);
					break;
				case 'deletePlan':
					// Show VS Code confirmation dialog before deleting
					const confirmDelete = await vscode.window.showWarningMessage(
						'Delete this plan and all its pending tasks?',
						{ modal: true },
						'Yes'
					);
					if (confirmDelete === 'Yes') {
						this._orchestrator.deletePlan(data.planId);
					}
					break;
				case 'setActivePlan':
					this._orchestrator.setActivePlan(data.planId);
					break;
				case 'startPlan':
					this._orchestrator.startPlan(data.planId);
					break;
				case 'pausePlan':
					this._orchestrator.pausePlan(data.planId);
					break;
				case 'resumePlan':
					this._orchestrator.resumePlan(data.planId);
					break;
				// Phase 12: Inbox and Audit Log handlers
				case 'getInboxItems':
					this._sendInboxItems();
					break;
				case 'inboxAction':
					this._handleInboxAction(data.itemId, data.action, data.reason);
					break;
				case 'getAuditLogs':
					this._sendAuditLogs(data.filter);
					break;
				case 'exportAuditLogs':
					await this._exportAuditLogs(data.format || 'json');
					break;
				case 'setAuditRetention':
					this._auditLog?.setRetentionDays(data.days);
					break;
				case 'clearAuditLogs':
					this._auditLog?.clear();
					this._sendAuditLogs();
					break;
			}
		});

		// Subscribe to updates
		this._orchestrator.onDidChangeWorkers(() => this._update());

		// Initial update
		this._update();
	}

	private async _sendAvailableModels(): Promise<void> {
		if (!this._view) {
			return;
		}

		try {
			const models = await vscode.lm.selectChatModels();
			const modelList = models.map(m => ({
				id: m.id,
				name: m.name,
				vendor: m.vendor,
				family: m.family,
			}));

			this._view.webview.postMessage({
				type: 'models',
				models: modelList,
			});
		} catch (error) {
			console.error('Failed to fetch available models:', error);
		}
	}

	private _sendInboxItems(): void {
		if (!this._view) {
			return;
		}

		// Collect inbox items from workers' pending approvals
		const workers = this._orchestrator.getWorkerStates();
		const items: any[] = [];

		for (const worker of workers) {
			for (const approval of (worker.pendingApprovals || [])) {
				items.push({
					id: `${worker.id}:${approval.id}`,
					workerId: worker.id,
					workerName: worker.name,
					approvalId: approval.id,
					type: 'approval',
					priority: this._inferPriority(approval),
					title: `${approval.toolName} - ${worker.name}`,
					description: approval.description,
					details: approval.parameters,
					planId: worker.planId,
					taskDescription: worker.task,
					createdAt: approval.timestamp || Date.now(),
				});
			}
		}

		// Sort by priority (critical first), then by time
		const priorityOrder: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
		items.sort((a, b) => {
			const priorityDiff = (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
			if (priorityDiff !== 0) {
				return priorityDiff;
			}
			return (a.createdAt || 0) - (b.createdAt || 0);
		});

		this._view.webview.postMessage({
			type: 'inboxItems',
			items,
			total: items.length,
		});
	}

	private _inferPriority(approval: any): string {
		// Infer priority based on tool type
		const criticalTools = ['deleteFile', 'rm', 'drop', 'truncate'];
		const highTools = ['createFile', 'runCommand', 'execute'];

		const toolName = (approval.toolName || '').toLowerCase();

		if (criticalTools.some(t => toolName.includes(t))) {
			return 'critical';
		}
		if (highTools.some(t => toolName.includes(t))) {
			return 'high';
		}
		return 'normal';
	}

	private _handleInboxAction(itemId: string, action: 'approve' | 'deny' | 'defer', reason?: string): void {
		const [workerId, approvalId] = itemId.split(':');
		if (!workerId || !approvalId) {
			return;
		}

		switch (action) {
			case 'approve':
				this._orchestrator.handleApproval(workerId, approvalId, true, reason);
				break;
			case 'deny':
				this._orchestrator.handleApproval(workerId, approvalId, false, reason);
				break;
			case 'defer':
				// Defer doesn't take action, just logs it
				this._auditLog?.log(
					AuditEventType.OrchestratorDecisionDeferred,
					'orchestrator',
					`Decision deferred for approval ${approvalId}`,
					{
						workerId,
						details: { action: 'deferred', approvalId },
					}
				);
				break;
		}

		// Refresh inbox
		this._sendInboxItems();
	}

	private _sendAuditLogs(filter?: IAuditLogFilter): void {
		if (!this._view || !this._auditLog) {
			return;
		}

		this._auditLogFilter = filter || {};
		const entries = this._auditLog.getEntries(this._auditLogFilter);
		const stats = this._auditLog.getStats();

		this._view.webview.postMessage({
			type: 'auditLogs',
			entries: entries.slice(0, 100), // Limit to 100 for performance
			stats,
			filter: this._auditLogFilter,
		});
	}

	private async _exportAuditLogs(format: 'json' | 'markdown'): Promise<void> {
		if (!this._auditLog) {
			return;
		}

		const content = this._auditLog.export(format);

		// Open in new untitled document
		const doc = await vscode.workspace.openTextDocument({
			content,
			language: format === 'json' ? 'json' : 'markdown',
		});
		await vscode.window.showTextDocument(doc);
	}

	private _update() {
		if (this._view) {
			const workers = this._orchestrator.getWorkerStates();
			const plan = this._orchestrator.getPlan();
			const plans = this._orchestrator.getPlans();
			const activePlanId = this._orchestrator.getActivePlanId();
			const readyTasks = this._orchestrator.getReadyTasks();
			const allTasks = this._orchestrator.getTasks(activePlanId);

			// Count pending approvals for badge
			let pendingApprovals = 0;
			for (const worker of workers) {
				pendingApprovals += worker.pendingApprovals?.length || 0;
			}

			// Set badge to show pending approvals
			if (pendingApprovals > 0) {
				this._view.badge = {
					value: pendingApprovals,
					tooltip: `${pendingApprovals} pending approval${pendingApprovals > 1 ? 's' : ''}`
				};
			} else {
				this._view.badge = undefined;
			}

			this._view.webview.postMessage({
				type: 'update',
				workers,
				plan,
				plans,
				activePlanId,
				readyTasks,
				allTasks,
				pendingApprovals,
			});

			// Also send inbox and audit data on update
			this._sendInboxItems();
			this._sendAuditLogs(this._auditLogFilter);
		}
	}

	private _getHtmlForWebview(): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Copilot Orchestrator</title>
	<style>
		* { box-sizing: border-box; }
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
			padding: 0;
			margin: 0;
		}
		.container { padding: 10px; }

		/* Tabs */
		.tabs {
			display: flex;
			border-bottom: 1px solid var(--vscode-widget-border);
			margin-bottom: 10px;
		}
		.tab {
			padding: 8px 16px;
			cursor: pointer;
			border: none;
			background: none;
			color: var(--vscode-foreground);
			opacity: 0.7;
		}
		.tab:hover { opacity: 1; }
		.tab.active {
			opacity: 1;
			border-bottom: 2px solid var(--vscode-focusBorder);
		}
		.tab-content { display: none; }
		.tab-content.active { display: block; }

		/* Plan Selector */
		.plan-selector {
			display: flex;
			gap: 8px;
			align-items: center;
			margin-bottom: 10px;
			padding: 8px;
			background: var(--vscode-sideBarSectionHeader-background);
			border-radius: 4px;
		}
		.plan-selector select {
			flex: 1;
			padding: 6px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 3px;
		}
		.plan-status {
			font-size: 0.85em;
			padding: 2px 8px;
			border-radius: 10px;
		}
		.plan-status.draft { background: var(--vscode-descriptionForeground); color: white; }
		.plan-status.active { background: var(--vscode-notificationsInfoIcon-foreground); color: white; }
		.plan-status.paused { background: var(--vscode-notificationsWarningIcon-foreground); color: black; }
		.plan-status.completed { background: var(--vscode-testing-iconPassed); color: white; }
		.plan-status.failed { background: var(--vscode-errorForeground); color: white; }

		/* Create Plan Form */
		.create-plan-form {
			display: none;
			flex-direction: column;
			gap: 8px;
			margin-bottom: 10px;
			padding: 10px;
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-widget-border);
			border-radius: 4px;
		}
		.create-plan-form.visible { display: flex; }
		.create-plan-form input, .create-plan-form textarea {
			padding: 6px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 3px;
		}
		.create-plan-form textarea { resize: vertical; min-height: 60px; }
		.form-row {
			display: flex;
			gap: 8px;
		}
		.form-row > * { flex: 1; }

		/* Task status badges */
		.task-status {
			font-size: 0.75em;
			padding: 2px 6px;
			border-radius: 3px;
			margin-left: 8px;
		}
		.task-status.pending { background: var(--vscode-descriptionForeground); color: white; }
		.task-status.queued { background: var(--vscode-notificationsInfoIcon-foreground); color: white; }
		.task-status.running { background: var(--vscode-charts-blue); color: white; }
		.task-status.completed { background: var(--vscode-testing-iconPassed); color: white; }
		.task-status.failed { background: var(--vscode-errorForeground); color: white; }
		.task-status.blocked { background: var(--vscode-notificationsWarningIcon-foreground); color: black; }

		/* Task dependencies */
		.task-deps {
			font-size: 0.8em;
			color: var(--vscode-descriptionForeground);
			margin-top: 4px;
		}
		.task-deps .dep {
			display: inline-block;
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			padding: 1px 5px;
			border-radius: 3px;
			margin-right: 4px;
		}
		.task-deps .dep.satisfied {
			background: var(--vscode-testing-iconPassed);
			color: white;
		}
		.task-error {
			color: var(--vscode-errorForeground);
			font-size: 0.85em;
			margin-top: 4px;
			padding: 4px 8px;
			background: var(--vscode-inputValidation-errorBackground);
			border-radius: 3px;
		}

		/* Plan Section */
		.plan-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 10px;
		}
		.deploy-controls {
			display: flex;
			gap: 6px;
			align-items: center;
		}
		.deploy-controls select {
			padding: 4px 8px;
			border-radius: 4px;
			border: 1px solid var(--vscode-widget-border);
			background: var(--vscode-dropdown-background);
			color: var(--vscode-dropdown-foreground);
			font-size: 12px;
			max-width: 180px;
		}
		.task-item {
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-widget-border);
			border-radius: 4px;
			padding: 8px;
			margin-bottom: 8px;
		}
		.task-item.blocked {
			opacity: 0.7;
			border-color: var(--vscode-notificationsWarningIcon-foreground);
		}
		.task-item.completed {
			opacity: 0.7;
			border-color: var(--vscode-testing-iconPassed);
		}
		.task-item.critical-path {
			border-left: 3px solid var(--vscode-charts-orange, #e5a00d);
		}
		.critical-badge {
			font-size: 0.9em;
			margin-left: 4px;
			color: var(--vscode-charts-orange, #e5a00d);
		}
		.task-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 4px;
		}
		.task-name {
			font-weight: bold;
			font-family: monospace;
			color: var(--vscode-textLink-foreground);
		}
		.task-description {
			color: var(--vscode-descriptionForeground);
			font-size: 0.9em;
			margin-bottom: 4px;
		}
		.task-meta {
			display: flex;
			gap: 8px;
			align-items: center;
			flex-wrap: wrap;
		}
		.task-priority {
			font-size: 0.8em;
			padding: 2px 6px;
			border-radius: 3px;
		}
		.task-priority.critical { background: var(--vscode-errorForeground); color: white; }
		.task-priority.high { background: var(--vscode-notificationsWarningIcon-foreground); color: black; }
		.task-priority.normal { background: var(--vscode-notificationsInfoIcon-foreground); color: white; }
		.task-priority.low { background: var(--vscode-descriptionForeground); color: white; }
		.task-branch {
			font-size: 0.8em;
			font-family: monospace;
			color: var(--vscode-descriptionForeground);
		}
		.task-agent {
			font-size: 0.8em;
			color: var(--vscode-textLink-foreground);
		}

		/* Dependency Graph View */
		.dependency-graph {
			width: 100%;
			min-height: 200px;
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-widget-border);
			border-radius: 4px;
			margin-top: 10px;
		}
		.dependency-graph .node {
			cursor: pointer;
		}
		.dependency-graph .node rect {
			fill: var(--vscode-editor-background);
			stroke: var(--vscode-widget-border);
			stroke-width: 2;
			rx: 4;
		}
		.dependency-graph .node.pending rect { stroke: var(--vscode-descriptionForeground); }
		.dependency-graph .node.running rect { stroke: var(--vscode-charts-blue); stroke-width: 3; }
		.dependency-graph .node.completed rect { stroke: var(--vscode-testing-iconPassed); }
		.dependency-graph .node.failed rect { stroke: var(--vscode-errorForeground); }
		.dependency-graph .node.critical rect { stroke: var(--vscode-charts-orange, #e5a00d); stroke-width: 3; }
		.dependency-graph .node text {
			fill: var(--vscode-foreground);
			font-size: 11px;
			font-family: var(--vscode-font-family);
		}
		.dependency-graph .edge {
			stroke: var(--vscode-widget-border);
			stroke-width: 2;
			fill: none;
			marker-end: url(#arrowhead);
		}
		.dependency-graph .edge.satisfied { stroke: var(--vscode-testing-iconPassed); }
		.dependency-graph .edge.critical { stroke: var(--vscode-charts-orange, #e5a00d); stroke-width: 3; }
		.view-toggle {
			display: flex;
			gap: 8px;
			margin-bottom: 10px;
		}
		.view-toggle button {
			padding: 4px 12px;
			font-size: 0.85em;
		}
		.view-toggle button.active {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}

		/* Add Task Form */
		.add-task-form {
			display: flex;
			flex-direction: column;
			gap: 8px;
			margin-bottom: 10px;
			padding: 10px;
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-widget-border);
			border-radius: 4px;
		}
		.add-task-form input[type="text"], .add-task-form textarea {
			padding: 6px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 3px;
		}
		.add-task-form textarea {
			resize: vertical;
			min-height: 60px;
		}
		.add-task-form select {
			padding: 6px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 3px;
		}

		/* Workers Section */
		.worker-card {
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-widget-border);
			border-radius: 4px;
			margin-bottom: 10px;
			overflow: hidden;
		}
		.worker-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 10px;
			background: var(--vscode-sideBarSectionHeader-background);
			cursor: pointer;
		}
		.worker-header:hover {
			background: var(--vscode-list-hoverBackground);
		}
		.worker-info { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
		.worker-name {
			font-weight: bold;
			font-family: monospace;
			color: var(--vscode-textLink-foreground);
		}
		.worker-status {
			font-size: 0.85em;
			padding: 2px 8px;
			border-radius: 10px;
		}
		.worker-status.running { background: var(--vscode-notificationsInfoIcon-foreground); color: white; }
		.worker-status.idle { background: var(--vscode-descriptionForeground); color: white; }
		.worker-status.waiting-approval { background: var(--vscode-notificationsWarningIcon-foreground); color: black; }
		.worker-status.paused { background: var(--vscode-notificationsWarningIcon-foreground); color: black; }
		.worker-status.completed { background: var(--vscode-testing-iconPassed); color: white; }
		.worker-status.error { background: var(--vscode-errorForeground); color: white; }
		.worker-branch {
			font-size: 0.85em;
			font-family: monospace;
			color: var(--vscode-descriptionForeground);
		}

		.worker-actions { display: flex; gap: 5px; }

		.worker-body {
			display: none;
			padding: 10px;
			border-top: 1px solid var(--vscode-widget-border);
		}
		.worker-card.expanded .worker-body { display: block; }

		/* Conversation */
		.conversation {
			max-height: 300px;
			overflow-y: auto;
			margin-bottom: 10px;
			padding: 5px;
			background: var(--vscode-input-background);
			border-radius: 4px;
		}
		.message {
			margin-bottom: 8px;
			padding: 8px;
			border-radius: 4px;
		}
		.message.user {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			margin-left: 20%;
		}
		.message.assistant {
			background: var(--vscode-editor-inactiveSelectionBackground);
			margin-right: 20%;
		}
		.message.system {
			background: var(--vscode-textBlockQuote-background);
			font-style: italic;
			text-align: center;
			color: var(--vscode-descriptionForeground);
		}
		.message.tool {
			background: var(--vscode-debugConsole-sourceForeground);
			font-family: monospace;
			font-size: 0.9em;
		}
		.message-time {
			font-size: 0.75em;
			color: var(--vscode-descriptionForeground);
			margin-bottom: 4px;
		}
		.message-content { white-space: pre-wrap; word-wrap: break-word; }

		/* Pending Approvals */
		.approval-card {
			background: var(--vscode-inputValidation-warningBackground);
			border: 1px solid var(--vscode-inputValidation-warningBorder);
			border-radius: 4px;
			padding: 10px;
			margin-bottom: 10px;
		}
		.approval-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 8px;
		}
		.approval-tool { font-weight: bold; }
		.approval-description { margin-bottom: 10px; }
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
			padding: 6px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 3px;
		}

		/* Message Input */
		.message-input-container {
			display: flex;
			gap: 8px;
		}
		.message-input {
			flex: 1;
			padding: 6px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 3px;
		}

		/* Buttons */
		button {
			padding: 4px 10px;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			border-radius: 3px;
			cursor: pointer;
		}
		button:hover { background: var(--vscode-button-hoverBackground); }
		button.secondary {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}
		button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
		button.success {
			background: var(--vscode-testing-iconPassed);
			color: white;
		}
		button.danger {
			background: var(--vscode-errorForeground);
			color: white;
		}
		button:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}

		.empty-state {
			text-align: center;
			padding: 20px;
			color: var(--vscode-descriptionForeground);
		}

		h3 { margin: 0 0 10px 0; font-size: 1.1em; }
		h4 { margin: 10px 0 5px 0; font-size: 1em; }
		label { font-size: 0.9em; color: var(--vscode-descriptionForeground); }

		/* Tab badges */
		.tab-badge {
			display: inline-block;
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			font-size: 0.75em;
			padding: 1px 6px;
			border-radius: 10px;
			margin-left: 4px;
		}
		.count-badge {
			font-size: 0.85em;
			color: var(--vscode-descriptionForeground);
		}

		/* Tab header */
		.tab-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 10px;
		}

		/* Inbox items */
		.inbox-item {
			padding: 12px;
			margin-bottom: 8px;
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-widget-border);
			border-radius: 4px;
		}
		.inbox-item.critical { border-left: 3px solid var(--vscode-errorForeground); }
		.inbox-item.high { border-left: 3px solid var(--vscode-notificationsWarningIcon-foreground); }
		.inbox-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 8px;
		}
		.inbox-title { font-weight: bold; }
		.inbox-priority {
			font-size: 0.75em;
			padding: 2px 6px;
			border-radius: 3px;
		}
		.inbox-priority.critical { background: var(--vscode-errorForeground); color: white; }
		.inbox-priority.high { background: var(--vscode-notificationsWarningIcon-foreground); color: black; }
		.inbox-priority.normal { background: var(--vscode-descriptionForeground); color: white; }
		.inbox-priority.low { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
		.inbox-description { color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
		.inbox-meta {
			font-size: 0.85em;
			color: var(--vscode-descriptionForeground);
			margin-bottom: 8px;
		}
		.inbox-actions {
			display: flex;
			gap: 8px;
			align-items: center;
		}
		.inbox-actions input {
			flex: 1;
			padding: 4px 8px;
		}

		/* Audit log */
		.audit-actions {
			display: flex;
			gap: 8px;
		}
		.audit-filter-bar {
			display: flex;
			gap: 8px;
			margin-bottom: 12px;
			flex-wrap: wrap;
		}
		.audit-filter-bar select, .audit-filter-bar input {
			padding: 4px 8px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 3px;
		}
		.audit-filter-bar input { flex: 1; min-width: 100px; }
		.audit-stats {
			display: flex;
			gap: 16px;
			margin-bottom: 12px;
			font-size: 0.9em;
			color: var(--vscode-descriptionForeground);
		}
		.audit-entry {
			padding: 10px;
			margin-bottom: 6px;
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-widget-border);
			border-radius: 4px;
			border-left: 3px solid var(--vscode-descriptionForeground);
			cursor: pointer;
		}
		.audit-entry:hover { background: var(--vscode-list-hoverBackground); }
		.audit-entry.plan { border-left-color: var(--vscode-charts-blue); }
		.audit-entry.task { border-left-color: var(--vscode-charts-green); }
		.audit-entry.worker { border-left-color: var(--vscode-charts-purple); }
		.audit-entry.error { border-left-color: var(--vscode-errorForeground); }
		.audit-entry-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 4px;
		}
		.audit-event-type {
			font-weight: bold;
			font-family: monospace;
		}
		.audit-timestamp {
			font-size: 0.8em;
			color: var(--vscode-descriptionForeground);
		}
		.audit-entry-body {
			display: flex;
			gap: 16px;
			font-size: 0.9em;
		}
		.audit-actor, .audit-target {
			color: var(--vscode-textLink-foreground);
		}
		.audit-details {
			margin-top: 6px;
			padding: 6px;
			background: var(--vscode-input-background);
			border-radius: 3px;
			font-family: monospace;
			font-size: 0.85em;
			display: none;
			white-space: pre-wrap;
		}
		.audit-entry.expanded .audit-details { display: block; }
	</style>
</head>
<body>
	<div class="container">
		<div class="tabs">
			<button class="tab active" data-tab="workers">Workers</button>
			<button class="tab" data-tab="plan">Plan</button>
			<button class="tab" data-tab="inbox">Inbox <span id="inbox-badge" class="tab-badge" style="display:none"></span></button>
			<button class="tab" data-tab="audit">Audit</button>
		</div>

		<div id="workers-tab" class="tab-content active">
			<div id="workers-container"></div>
		</div>

		<div id="plan-tab" class="tab-content">
			<!-- Plan Selector -->
			<div class="plan-selector">
				<label>Plan:</label>
				<select id="plan-select">
					<option value="">Ad-hoc Tasks</option>
				</select>
				<span id="plan-status-badge" class="plan-status" style="display:none"></span>
				<button data-action="show-create-plan-form" title="New Plan">+ New</button>
				<button data-action="delete-plan" class="danger" id="delete-plan-btn" title="Delete Plan" disabled>🗑</button>
			</div>

			<!-- Plan Control Buttons -->
			<div id="plan-controls" style="display:none; margin-bottom: 10px;">
				<button id="start-plan-btn" data-action="start-plan" class="success">▶ Start Plan</button>
				<button id="pause-plan-btn" data-action="pause-plan" class="secondary" style="display:none">⏸ Pause</button>
				<button id="resume-plan-btn" data-action="resume-plan" style="display:none">▶ Resume</button>
			</div>

			<!-- Create Plan Form (hidden by default) -->
			<div id="create-plan-form" class="create-plan-form">
				<h4>Create New Plan</h4>
				<input type="text" id="plan-name" placeholder="Plan name (e.g., refactor-auth)" />
				<textarea id="plan-description" placeholder="Plan description..."></textarea>
				<div class="form-row">
					<div>
						<label>Base Branch:</label>
						<input type="text" id="plan-base-branch" placeholder="main" />
					</div>
				</div>
				<div class="form-row">
					<button data-action="create-plan">Create Plan</button>
					<button data-action="hide-create-plan-form" class="secondary">Cancel</button>
				</div>
			</div>

			<div class="plan-header">
				<h3>Tasks</h3>
				<div class="deploy-controls">
					<select id="deploy-model-select" title="Select model for deployment">
						<option value="">Default Model</option>
					</select>
					<button data-action="deploy-all" id="deploy-all-btn">Deploy Ready</button>
					<button data-action="clear-plan" class="secondary">Clear</button>
				</div>
			</div>

			<!-- View Toggle -->
			<div class="view-toggle">
				<button id="list-view-btn" class="active" data-action="set-view-list">📋 List</button>
				<button id="graph-view-btn" data-action="set-view-graph">🔗 Graph</button>
			</div>

			<!-- Add Task Form -->
			<div class="add-task-form">
				<div class="form-row">
					<div style="flex: 2">
						<label>Name (branch):</label>
						<input type="text" id="new-task-name" placeholder="feature-name (optional)" />
					</div>
					<div>
						<label>Priority:</label>
						<select id="task-priority">
							<option value="normal">Normal</option>
							<option value="critical">Critical</option>
							<option value="high">High</option>
							<option value="low">Low</option>
						</select>
					</div>
				</div>
				<div>
					<label>Description:</label>
					<textarea id="new-task-input" placeholder="What should this task accomplish?"></textarea>
				</div>
				<div class="form-row">
					<div>
						<label>Agent:</label>
						<select id="task-agent">
							<option value="@agent">@agent (default)</option>
							<option value="@architect">@architect</option>
							<option value="@reviewer">@reviewer</option>
						</select>
					</div>
					<div>
						<label>Dependencies (task IDs, comma-separated):</label>
						<input type="text" id="task-deps" placeholder="e.g., task-1, task-2" />
					</div>
				</div>
				<div class="form-row">
					<div>
						<label>Model:</label>
						<select id="task-model">
							<option value="">Default</option>
						</select>
					</div>
					<div>
						<label>Base Branch (override):</label>
						<input type="text" id="task-base-branch" placeholder="Uses plan default if empty" />
					</div>
					<button data-action="add-task" style="align-self: flex-end">Add Task</button>
				</div>
			</div>

			<div id="plan-container"></div>
			<svg id="dependency-graph" class="dependency-graph" style="display: none;"></svg>
		</div>

		<!-- Inbox Tab -->
		<div id="inbox-tab" class="tab-content">
			<div class="tab-header">
				<h3>Orchestrator Inbox</h3>
				<span id="inbox-count" class="count-badge"></span>
			</div>
			<div id="inbox-container"></div>
		</div>

		<!-- Audit Tab -->
		<div id="audit-tab" class="tab-content">
			<div class="tab-header">
				<h3>Audit Log</h3>
				<div class="audit-actions">
					<button data-action="export-audit-json" class="secondary">📥 JSON</button>
					<button data-action="export-audit-md" class="secondary">📥 Markdown</button>
					<button data-action="clear-audit" class="danger">🗑 Clear</button>
				</div>
			</div>
			<div class="audit-filter-bar">
				<select id="audit-filter-type">
					<option value="">All Event Types</option>
				</select>
				<input type="text" id="audit-filter-actor" placeholder="Filter by actor..." />
				<input type="text" id="audit-filter-plan" placeholder="Filter by plan ID..." />
				<input type="text" id="audit-filter-search" placeholder="Search..." />
				<button data-action="apply-audit-filter">🔍 Filter</button>
			</div>
			<div id="audit-stats" class="audit-stats"></div>
			<div id="audit-container"></div>
		</div>
	</div>

	<script>
		const vscode = acquireVsCodeApi();
		let expandedWorkers = new Set();
		let expandedAuditEntries = new Set();
		let currentPlans = [];
		let currentActivePlanId = null;
		let currentPlan = null;
		let allTasks = [];
		let currentWorkers = [];
		let currentInboxItems = [];
		let currentAuditLogs = [];
		let currentAuditStats = {};

		// Tab switching
		document.querySelectorAll('.tab').forEach(tab => {
			tab.addEventListener('click', () => {
				document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
				document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
				tab.classList.add('active');
				document.getElementById(tab.dataset.tab + '-tab').classList.add('active');
			});
		});

		// Global click handler using event delegation (CSP-safe)
		document.addEventListener('click', function(event) {
			const target = event.target.closest('[data-action]');
			if (!target) return;

			const action = target.dataset.action;
			const workerId = target.dataset.workerId;
			const taskId = target.dataset.taskId;
			const approvalId = target.dataset.approvalId;

			console.log('[Orchestrator] Action clicked:', action, { workerId, taskId, approvalId });

			switch (action) {
				case 'toggle-worker':
					toggleWorker(workerId);
					break;
				case 'open-chat':
					vscode.postMessage({ type: 'openChat', workerId });
					break;
				case 'stop-worker':
				case 'interrupt-worker':
					vscode.postMessage({ type: 'interrupt', workerId });
					break;
				case 'pause-worker':
					vscode.postMessage({ type: 'pause', workerId });
					break;
				case 'resume-worker':
					vscode.postMessage({ type: 'resume', workerId });
					break;
				case 'complete-worker':
					// Send to extension for VS Code confirmation dialog
					vscode.postMessage({ type: 'confirmAction', action: 'complete', workerId, message: 'Complete this worker? This will commit, push to origin, and remove the worktree.' });
					break;
				case 'complete-worker-pr':
					vscode.postMessage({ type: 'confirmAction', action: 'completeWithPR', workerId, message: 'Complete this worker and create a Pull Request?' });
					break;
				case 'kill-worker':
					vscode.postMessage({ type: 'confirmAction', action: 'killWorker', workerId, message: 'Kill this worker? This will stop the process, remove the worktree, and reset the task to pending.' });
					break;
				case 'send-message':
					sendMessage(workerId);
					break;
				case 'approve':
					const clarification = document.getElementById('clarification-' + approvalId)?.value || '';
					vscode.postMessage({ type: 'approve', workerId, approvalId, clarification });
					break;
				case 'reject':
					const reason = document.getElementById('clarification-' + approvalId)?.value || '';
					vscode.postMessage({ type: 'reject', workerId, approvalId, reason });
					break;
				case 'deploy-task': {
					const deployModelSelect = document.getElementById('deploy-model-select');
					const deployModelId = deployModelSelect?.value || undefined;
					vscode.postMessage({ type: 'deploy', taskId, modelId: deployModelId });
					break;
				}
				case 'deploy-all': {
					const deployModelSelect = document.getElementById('deploy-model-select');
					const deployModelId = deployModelSelect?.value || undefined;
					vscode.postMessage({ type: 'deployAll', modelId: deployModelId });
					break;
				}
				case 'remove-task':
					vscode.postMessage({ type: 'removeTask', taskId });
					break;
				case 'cancel-task':
					vscode.postMessage({ type: 'confirmAction', action: 'cancelTask', taskId, message: 'Cancel this task? The worker will be stopped and the task reset to pending.' });
					break;
				case 'retry-task': {
					const deployModelSelect = document.getElementById('deploy-model-select');
					const deployModelId = deployModelSelect?.value || undefined;
					vscode.postMessage({ type: 'confirmAction', action: 'retryTask', taskId, modelId: deployModelId, message: 'Retry this task? A new worker will be deployed.' });
					break;
				}
				case 'add-task':
					addTask();
					break;
				case 'clear-plan':
					clearPlan();
					break;
				case 'create-plan':
					createPlan();
					break;
				case 'delete-plan':
					deletePlan();
					break;
				case 'start-plan':
					startPlan();
					break;
				case 'pause-plan':
					pausePlan();
					break;
				case 'resume-plan':
					resumePlan();
					break;
				case 'show-create-plan-form':
					showCreatePlanForm();
					break;
				case 'hide-create-plan-form':
					hideCreatePlanForm();
					break;
				case 'set-view-list':
					setView('list');
					break;
				case 'set-view-graph':
					setView('graph');
					break;
				// Inbox actions
				case 'inbox-approve': {
					const inboxClarification = document.getElementById('inbox-input-' + target.dataset.itemId)?.value || '';
					vscode.postMessage({ type: 'inboxApprove', itemId: target.dataset.itemId, clarification: inboxClarification });
					break;
				}
				case 'inbox-deny': {
					const inboxReason = document.getElementById('inbox-input-' + target.dataset.itemId)?.value || '';
					vscode.postMessage({ type: 'inboxDeny', itemId: target.dataset.itemId, reason: inboxReason });
					break;
				}
				case 'inbox-defer':
					vscode.postMessage({ type: 'inboxDefer', itemId: target.dataset.itemId });
					break;
				// Audit actions
				case 'export-audit-json':
					vscode.postMessage({ type: 'exportAuditLogs', format: 'json' });
					break;
				case 'export-audit-md':
					vscode.postMessage({ type: 'exportAuditLogs', format: 'markdown' });
					break;
				case 'clear-audit':
					if (confirm('Clear all audit logs?')) {
						vscode.postMessage({ type: 'clearAuditLogs' });
					}
					break;
				case 'apply-audit-filter':
					applyAuditFilter();
					break;
				case 'toggle-audit-entry':
					toggleAuditEntry(target.dataset.entryId);
					break;
			}
		});

		// Handle keydown for input fields
		document.addEventListener('keydown', function(event) {
			if (event.key === 'Enter') {
				const target = event.target;
				if (target.classList.contains('message-input')) {
					const workerId = target.dataset.workerId;
					if (workerId) {
						sendMessage(workerId);
					}
				}
			}
		});

		// Handle change events for selects
		document.addEventListener('change', function(event) {
			const target = event.target;
			if (target.dataset.action === 'set-worker-model') {
				const workerId = target.dataset.workerId;
				const modelId = target.value;
				if (modelId) {
					vscode.postMessage({ type: 'setWorkerModel', workerId, modelId });
				}
			} else if (target.id === 'plan-select') {
				setActivePlan(target.value);
			}
		});

		window.addEventListener('message', event => {
			const message = event.data;
			if (message.type === 'update') {
				currentPlans = message.plans || [];
				currentActivePlanId = message.activePlanId;
				currentPlan = currentPlans.find(p => p.id === currentActivePlanId);
				allTasks = message.allTasks || [];
				currentWorkers = message.workers || [];
				renderPlansDropdown(message.plans, message.activePlanId);
				renderPlanControls(currentPlan);
				renderWorkers(message.workers);
				renderPlan(message.allTasks || message.plan, message.readyTasks);
				// Re-populate worker model selectors with current models and worker data
				if (currentModels.length > 0) {
					populateWorkerModelSelectors(currentModels, currentWorkers);
				}
			} else if (message.type === 'models') {
				currentModels = message.models || [];
				renderModelsDropdown(currentModels);
				// Note: workers data is available from last update message
				populateWorkerModelSelectors(currentModels, currentWorkers);
			} else if (message.type === 'inboxItems') {
				currentInboxItems = message.items || [];
				renderInbox(currentInboxItems);
			} else if (message.type === 'auditLogs') {
				currentAuditLogs = message.entries || [];
				currentAuditStats = message.stats || {};
				renderAuditLogs(currentAuditLogs, currentAuditStats);
			}
		});

		// Store models globally for worker card rendering
		let currentModels = [];

		function renderModelsDropdown(models) {
			// Populate task model selector
			const taskModelSelect = document.getElementById('task-model');
			taskModelSelect.innerHTML = '<option value="">Default</option>';
			(models || []).forEach(model => {
				const option = document.createElement('option');
				option.value = model.id;
				option.textContent = model.name + ' (' + model.vendor + ')';
				taskModelSelect.appendChild(option);
			});

			// Populate deploy model selector
			const deployModelSelect = document.getElementById('deploy-model-select');
			deployModelSelect.innerHTML = '<option value="">Default Model</option>';
			(models || []).forEach(model => {
				const option = document.createElement('option');
				option.value = model.id;
				option.textContent = model.name + ' (' + model.vendor + ')';
				deployModelSelect.appendChild(option);
			});
		}

		function renderPlansDropdown(plans, activePlanId) {
			const select = document.getElementById('plan-select');
			const deleteBtn = document.getElementById('delete-plan-btn');
			const statusBadge = document.getElementById('plan-status-badge');

			select.innerHTML = '<option value="">Ad-hoc Tasks</option>';
			(plans || []).forEach(plan => {
				const option = document.createElement('option');
				option.value = plan.id;
				option.textContent = plan.name + (plan.baseBranch ? ' [' + plan.baseBranch + ']' : '');
				if (plan.id === activePlanId) {
					option.selected = true;
				}
				select.appendChild(option);
			});

			deleteBtn.disabled = !activePlanId;

			// Show plan status
			const activePlan = plans.find(p => p.id === activePlanId);
			if (activePlan && activePlan.status) {
				statusBadge.textContent = activePlan.status;
				statusBadge.className = 'plan-status ' + activePlan.status;
				statusBadge.style.display = 'inline-block';
			} else {
				statusBadge.style.display = 'none';
			}
		}

		function renderPlanControls(plan) {
			const controls = document.getElementById('plan-controls');
			const startBtn = document.getElementById('start-plan-btn');
			const pauseBtn = document.getElementById('pause-plan-btn');
			const resumeBtn = document.getElementById('resume-plan-btn');

			if (!plan) {
				controls.style.display = 'none';
				return;
			}

			controls.style.display = 'block';
			startBtn.style.display = plan.status === 'draft' ? 'inline-block' : 'none';
			pauseBtn.style.display = plan.status === 'active' ? 'inline-block' : 'none';
			resumeBtn.style.display = plan.status === 'paused' ? 'inline-block' : 'none';
		}

		function renderWorkers(workers) {
			const container = document.getElementById('workers-container');

			if (!workers || workers.length === 0) {
				container.innerHTML = '<div class="empty-state"><p>No active workers.</p><p>Add tasks to the Plan and click Deploy.</p></div>';
				return;
			}

			container.innerHTML = workers.map(worker => renderWorkerCard(worker)).join('');
		}

		function renderWorkerCard(worker) {
			const isExpanded = expandedWorkers.has(worker.id);
			const statusClass = worker.status.replace('-', '');
			const canComplete = worker.status === 'idle' || worker.status === 'completed';
			const isRunning = worker.status === 'running' || worker.status === 'waiting-approval';

			const messagesHtml = worker.messages.map(msg => {
				const time = new Date(msg.timestamp).toLocaleTimeString();
				return \`
					<div class="message \${msg.role}">
						<div class="message-time">\${time} - \${msg.role}</div>
						<div class="message-content">\${escapeHtml(msg.content)}</div>
					</div>
				\`;
			}).join('');

			const approvalsHtml = worker.pendingApprovals.map(approval => \`
				<div class="approval-card">
					<div class="approval-header">
						<span class="approval-tool">🔧 \${approval.toolName}</span>
					</div>
					<div class="approval-description">\${escapeHtml(approval.description)}</div>
					<div class="approval-params">\${escapeHtml(JSON.stringify(approval.parameters, null, 2))}</div>
					<div class="approval-actions">
						<input type="text" class="approval-input" id="clarification-\${approval.id}" placeholder="Clarification (optional)..." />
						<button data-action="approve" data-worker-id="\${worker.id}" data-approval-id="\${approval.id}">✓ Approve</button>
						<button data-action="reject" data-worker-id="\${worker.id}" data-approval-id="\${approval.id}" class="danger">✗ Reject</button>
					</div>
				</div>
			\`).join('');

			const interruptBtn = isRunning
				? \`<button data-action="interrupt-worker" data-worker-id="\${worker.id}" class="warning interrupt-btn" title="Interrupt to provide feedback">⏹️</button>\`
				: '';

			const completeBtn = canComplete
				? \`<button data-action="complete-worker" data-worker-id="\${worker.id}" class="success" title="Push to origin and clean up">✓ Complete</button>\`
				: '';

			const completeWithPRBtn = canComplete
				? \`<button data-action="complete-worker-pr" data-worker-id="\${worker.id}" class="success" title="Push and create PR">✓ Complete + PR</button>\`
				: '';

			// Model selector for changing model mid-session
			const modelSelectorHtml = \`
				<div class="worker-model-selector" style="margin-top: 8px;">
					<label style="font-size: 0.85em;">Model:</label>
					<select id="model-\${worker.id}" data-action="set-worker-model" data-worker-id="\${worker.id}" style="padding: 4px; font-size: 0.85em;">
						<option value="">Default</option>
					</select>
				</div>
			\`;

			return \`
				<div class="worker-card \${isExpanded ? 'expanded' : ''}" data-worker-id="\${worker.id}">
					<div class="worker-header" data-action="toggle-worker" data-worker-id="\${worker.id}">
						<div class="worker-info">
							<span class="worker-name">\${worker.name}</span>
							<span class="worker-status \${statusClass}">\${worker.status}</span>
							\${worker.baseBranch ? '<span class="worker-branch">from ' + worker.baseBranch + '</span>' : ''}
						</div>
						<div class="worker-actions">
							<button data-action="open-chat" data-worker-id="\${worker.id}" class="secondary" title="Open full chat panel">💬</button>
							\${interruptBtn}
							\${completeWithPRBtn}
							\${completeBtn}
							<button data-action="kill-worker" data-worker-id="\${worker.id}" class="danger" title="Kill worker, remove worktree, reset task">✕ Kill</button>
						</div>
					</div>
					<div class="worker-body">
						<div><strong>Task:</strong> \${escapeHtml(worker.task)}</div>
						<div><strong>Worktree:</strong> <code>\${worker.worktreePath}</code></div>
						\${modelSelectorHtml}

						\${approvalsHtml ? '<h4>Pending Approvals</h4>' + approvalsHtml : ''}

						<h4>Conversation</h4>
						<div class="conversation">\${messagesHtml}</div>

						<div class="message-input-container">
							<input type="text" class="message-input" id="msg-\${worker.id}" data-worker-id="\${worker.id}"
								placeholder="Send a message or clarification..." />
							<button data-action="send-message" data-worker-id="\${worker.id}">Send</button>
						</div>
					</div>
				</div>
			\`;
		}

		function renderPlan(tasks, readyTasks) {
			const container = document.getElementById('plan-container');
			const deployBtn = document.getElementById('deploy-all-btn');
			const readyIds = new Set((readyTasks || []).map(t => t.id));

			if (!tasks || tasks.length === 0) {
				container.innerHTML = '<div class="empty-state">No tasks in plan.</div>';
				deployBtn.disabled = true;
				return;
			}

			// Calculate critical path (longest chain of dependencies)
			const criticalPathIds = calculateCriticalPath(tasks);

			deployBtn.disabled = readyIds.size === 0;
			container.innerHTML = tasks.map(task => {
				const isReady = readyIds.has(task.id);
				const isOnCriticalPath = criticalPathIds.has(task.id);
				const isFailed = task.status === 'failed';
				const isRunning = task.status === 'running' || task.status === 'queued';
				const isPending = task.status === 'pending';
				const isBlocked = task.status === 'blocked';

				const depsHtml = (task.dependencies || []).map(depId => {
					const depTask = tasks.find(t => t.id === depId);
					const isSatisfied = depTask?.status === 'completed';
					return \`<span class="dep \${isSatisfied ? 'satisfied' : ''}">\${depId}</span>\`;
				}).join('');

				// Build action buttons based on task status
				let actionButtons = '';
				if (isReady) {
					actionButtons += \`<button data-action="deploy-task" data-task-id="\${task.id}" title="Deploy this task">▶</button>\`;
				}
				if (isPending || isBlocked) {
					actionButtons += \`<button data-action="remove-task" data-task-id="\${task.id}" class="danger" title="Remove task">✕</button>\`;
				}
				if (isRunning) {
					actionButtons += \`<button data-action="cancel-task" data-task-id="\${task.id}" class="danger" title="Cancel running task">⏹</button>\`;
				}
				if (isFailed || isBlocked) {
					actionButtons += \`<button data-action="retry-task" data-task-id="\${task.id}" title="Retry failed task">🔄</button>\`;
				}

				return \`
					<div class="task-item \${task.status}\${isOnCriticalPath ? ' critical-path' : ''}">
						<div class="task-header">
							<div>
								<span class="task-name">\${escapeHtml(task.name)}</span>
								<span class="task-status \${task.status}">\${task.status}</span>
								\${isOnCriticalPath ? '<span class="critical-badge" title="This task is on the critical path">⚡</span>' : ''}
							</div>
							<div>\${actionButtons}</div>
						</div>
						<div class="task-description">\${escapeHtml(task.description)}</div>
						\${task.error ? '<div class="task-error">Error: ' + escapeHtml(task.error) + '</div>' : ''}
						<div class="task-meta">
							<span class="task-priority \${task.priority}">\${task.priority}</span>
							\${task.agent ? '<span class="task-agent">' + task.agent + '</span>' : ''}
							\${task.baseBranch ? '<span class="task-branch">from ' + task.baseBranch + '</span>' : ''}
						</div>
						\${depsHtml ? '<div class="task-deps">Depends on: ' + depsHtml + '</div>' : ''}
					</div>
				\`;
			}).join('');
		}

		// Calculate the critical path (longest chain of dependencies)
		function calculateCriticalPath(tasks) {
			const taskMap = new Map(tasks.map(t => [t.id, t]));
			const depths = new Map();

			// Calculate depth for each task (longest path to reach it)
			function getDepth(taskId) {
				if (depths.has(taskId)) return depths.get(taskId);

				const task = taskMap.get(taskId);
				if (!task || !task.dependencies || task.dependencies.length === 0) {
					depths.set(taskId, 0);
					return 0;
				}

				const maxDepDep = Math.max(...task.dependencies.map(depId => getDepth(depId)));
				const depth = maxDepDep + 1;
				depths.set(taskId, depth);
				return depth;
			}

			// Calculate depth for all tasks
			tasks.forEach(t => getDepth(t.id));

			if (depths.size === 0) return new Set();

			// Find the maximum depth
			const maxDepth = Math.max(...depths.values());

			// Find all tasks at max depth (could be multiple critical paths)
			const endTasks = tasks.filter(t => depths.get(t.id) === maxDepth);

			// Trace back the critical path(s)
			const criticalPathIds = new Set();

			function traceBack(taskId) {
				criticalPathIds.add(taskId);
				const task = taskMap.get(taskId);
				if (!task || !task.dependencies || task.dependencies.length === 0) return;

				// Find the dependency with the highest depth (on critical path)
				let maxDepDep = -1;
				let criticalDep = null;
				for (const depId of task.dependencies) {
					const depDepth = depths.get(depId) || 0;
					if (depDepth > maxDepDep) {
						maxDepDep = depDepth;
						criticalDep = depId;
					}
				}
				if (criticalDep) {
					traceBack(criticalDep);
				}
			}

			endTasks.forEach(t => traceBack(t.id));

			return criticalPathIds;
		}

		// View switching
		let currentView = 'list';

		function setView(view) {
			currentView = view;
			document.getElementById('list-view-btn').classList.toggle('active', view === 'list');
			document.getElementById('graph-view-btn').classList.toggle('active', view === 'graph');
			document.getElementById('plan-container').style.display = view === 'list' ? 'block' : 'none';
			document.getElementById('dependency-graph').style.display = view === 'graph' ? 'block' : 'none';

			if (view === 'graph' && allTasks.length > 0) {
				renderDependencyGraph(allTasks);
			}
		}

		// Render dependency graph as SVG
		function renderDependencyGraph(tasks) {
			const svg = document.getElementById('dependency-graph');
			if (!tasks || tasks.length === 0) {
				svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="var(--vscode-descriptionForeground)">No tasks to visualize</text>';
				return;
			}

			const criticalPathIds = calculateCriticalPath(tasks);

			// Calculate positions using a simple layered layout
			const taskMap = new Map(tasks.map(t => [t.id, t]));
			const depths = new Map();

			// Calculate depth (layer) for each task
			function getDepth(taskId) {
				if (depths.has(taskId)) return depths.get(taskId);
				const task = taskMap.get(taskId);
				if (!task || !task.dependencies || task.dependencies.length === 0) {
					depths.set(taskId, 0);
					return 0;
				}
				const maxDepDep = Math.max(...task.dependencies.map(depId => getDepth(depId)));
				depths.set(taskId, maxDepDep + 1);
				return maxDepDep + 1;
			}

			tasks.forEach(t => getDepth(t.id));

			// Group tasks by depth
			const layers = new Map();
			tasks.forEach(task => {
				const depth = depths.get(task.id) || 0;
				if (!layers.has(depth)) layers.set(depth, []);
				layers.get(depth).push(task);
			});

			// Layout parameters
			const nodeWidth = 140;
			const nodeHeight = 50;
			const layerGap = 100;
			const nodeGap = 20;
			const padding = 30;

			// Calculate positions
			const positions = new Map();
			const maxLayer = Math.max(...layers.keys());
			let maxWidth = 0;

			for (let layer = 0; layer <= maxLayer; layer++) {
				const nodesInLayer = layers.get(layer) || [];
				const layerWidth = nodesInLayer.length * nodeWidth + (nodesInLayer.length - 1) * nodeGap;
				maxWidth = Math.max(maxWidth, layerWidth);

				nodesInLayer.forEach((task, idx) => {
					const x = padding + idx * (nodeWidth + nodeGap) + nodeWidth / 2;
					const y = padding + layer * (nodeHeight + layerGap) + nodeHeight / 2;
					positions.set(task.id, { x, y });
				});
			}

			// Center layers horizontally
			for (let layer = 0; layer <= maxLayer; layer++) {
				const nodesInLayer = layers.get(layer) || [];
				const layerWidth = nodesInLayer.length * nodeWidth + (nodesInLayer.length - 1) * nodeGap;
				const offset = (maxWidth - layerWidth) / 2;

				nodesInLayer.forEach(task => {
					const pos = positions.get(task.id);
					pos.x += offset;
				});
			}

			const svgWidth = maxWidth + 2 * padding;
			const svgHeight = (maxLayer + 1) * (nodeHeight + layerGap) + padding;

			// Build SVG
			let svgContent = \`
				<defs>
					<marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
						<polygon points="0 0, 10 3.5, 0 7" fill="var(--vscode-widget-border)" />
					</marker>
					<marker id="arrowhead-satisfied" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
						<polygon points="0 0, 10 3.5, 0 7" fill="var(--vscode-testing-iconPassed)" />
					</marker>
					<marker id="arrowhead-critical" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
						<polygon points="0 0, 10 3.5, 0 7" fill="var(--vscode-charts-orange, #e5a00d)" />
					</marker>
				</defs>
			\`;

			// Draw edges (dependencies)
			tasks.forEach(task => {
				if (!task.dependencies) return;
				const toPos = positions.get(task.id);
				if (!toPos) return;

				task.dependencies.forEach(depId => {
					const fromPos = positions.get(depId);
					if (!fromPos) return;

					const depTask = taskMap.get(depId);
					const isSatisfied = depTask?.status === 'completed';
					const isCritical = criticalPathIds.has(task.id) && criticalPathIds.has(depId);

					const edgeClass = isCritical ? 'edge critical' : (isSatisfied ? 'edge satisfied' : 'edge');
					const markerEnd = isCritical ? 'url(#arrowhead-critical)' : (isSatisfied ? 'url(#arrowhead-satisfied)' : 'url(#arrowhead)');

					// Draw curved line from dependency to task
					const midY = (fromPos.y + nodeHeight/2 + toPos.y - nodeHeight/2) / 2;
					svgContent += \`<path class="\${edgeClass}"
						d="M \${fromPos.x} \${fromPos.y + nodeHeight/2}
						   Q \${fromPos.x} \${midY}, \${(fromPos.x + toPos.x)/2} \${midY}
						   T \${toPos.x} \${toPos.y - nodeHeight/2}"
						marker-end="\${markerEnd}" />\`;
				});
			});

			// Draw nodes
			tasks.forEach(task => {
				const pos = positions.get(task.id);
				if (!pos) return;

				const isCritical = criticalPathIds.has(task.id);
				const nodeClass = \`node \${task.status}\${isCritical ? ' critical' : ''}\`;

				svgContent += \`
					<g class="\${nodeClass}" onclick="deployTask('\${task.id}')" data-task-id="\${task.id}">
						<rect x="\${pos.x - nodeWidth/2}" y="\${pos.y - nodeHeight/2}" width="\${nodeWidth}" height="\${nodeHeight}" />
						<text x="\${pos.x}" y="\${pos.y - 5}" text-anchor="middle" font-weight="bold">\${escapeHtml(task.name.substring(0, 18))}</text>
						<text x="\${pos.x}" y="\${pos.y + 12}" text-anchor="middle" font-size="10px" fill="var(--vscode-descriptionForeground)">\${task.status}\${task.agent ? ' · ' + task.agent : ''}</text>
					</g>
				\`;
			});

			svg.setAttribute('width', svgWidth);
			svg.setAttribute('height', svgHeight);
			svg.innerHTML = svgContent;
		}

		function toggleWorker(workerId) {
			if (expandedWorkers.has(workerId)) {
				expandedWorkers.delete(workerId);
			} else {
				expandedWorkers.add(workerId);
			}
			vscode.postMessage({ type: 'refresh' });
		}

		function showCreatePlanForm() {
			document.getElementById('create-plan-form').classList.add('visible');
		}

		function hideCreatePlanForm() {
			document.getElementById('create-plan-form').classList.remove('visible');
			document.getElementById('plan-name').value = '';
			document.getElementById('plan-description').value = '';
			document.getElementById('plan-base-branch').value = '';
		}

		function createPlan() {
			const name = document.getElementById('plan-name').value.trim();
			const description = document.getElementById('plan-description').value.trim();
			const baseBranch = document.getElementById('plan-base-branch').value.trim() || undefined;

			if (!name) {
				alert('Plan name is required');
				return;
			}

			vscode.postMessage({ type: 'createPlan', name, description, baseBranch });
			hideCreatePlanForm();
		}

		function deletePlan() {
			if (currentActivePlanId) {
				// Send message to extension to show VS Code confirmation dialog
				vscode.postMessage({ type: 'deletePlan', planId: currentActivePlanId });
			}
		}

		function setActivePlan(planId) {
			vscode.postMessage({ type: 'setActivePlan', planId: planId || undefined });
		}

		function startPlan() {
			if (currentActivePlanId) {
				vscode.postMessage({ type: 'startPlan', planId: currentActivePlanId });
			}
		}

		function pausePlan() {
			if (currentActivePlanId) {
				vscode.postMessage({ type: 'pausePlan', planId: currentActivePlanId });
			}
		}

		function resumePlan() {
			if (currentActivePlanId) {
				vscode.postMessage({ type: 'resumePlan', planId: currentActivePlanId });
			}
		}

		function addTask() {
			const nameInput = document.getElementById('new-task-name');
			const descInput = document.getElementById('new-task-input');
			const priority = document.getElementById('task-priority').value;
			const baseBranch = document.getElementById('task-base-branch').value.trim() || undefined;
			const modelId = document.getElementById('task-model').value || undefined;
			const agent = document.getElementById('task-agent').value || undefined;
			const depsInput = document.getElementById('task-deps').value.trim();
			const dependencies = depsInput ? depsInput.split(',').map(s => s.trim()).filter(Boolean) : [];

			const description = descInput.value.trim();
			if (!description) {
				alert('Task description is required');
				return;
			}

			const name = nameInput.value.trim() || undefined;
			vscode.postMessage({ type: 'addTask', name, description, priority, baseBranch, modelId, agent, dependencies });

			nameInput.value = '';
			descInput.value = '';
			document.getElementById('task-base-branch').value = '';
			document.getElementById('task-model').value = '';
			document.getElementById('task-deps').value = '';
		}

		function removeTask(taskId) {
			vscode.postMessage({ type: 'removeTask', taskId });
		}

		function clearPlan() {
			vscode.postMessage({ type: 'clearPlan' });
		}

		function sendMessage(workerId) {
			const input = document.getElementById('msg-' + workerId);
			if (input && input.value.trim()) {
				vscode.postMessage({ type: 'sendMessage', workerId, message: input.value.trim() });
				input.value = '';
			}
		}

		// Populate model selectors after workers render
		function populateWorkerModelSelectors(models, workers) {
			// Build a map of worker ID to their current modelId
			const workerModelMap = new Map();
			if (workers) {
				workers.forEach(worker => {
					if (worker.modelId) {
						workerModelMap.set(worker.id, worker.modelId);
					}
				});
			}

			document.querySelectorAll('[id^="model-"]').forEach(select => {
				if (!select.dataset.action) return; // Skip if not a model selector
				const workerId = select.dataset.workerId;
				// Get the worker's current model from the map, not from the select's current value
				const workerModelId = workerModelMap.get(workerId);
				select.innerHTML = '<option value="">Default</option>';
				(models || []).forEach(model => {
					const option = document.createElement('option');
					option.value = model.id;
					option.textContent = model.name + ' (' + model.vendor + ')';
					select.appendChild(option);
				});
				// Set the select to the worker's actual model
				if (workerModelId) {
					select.value = workerModelId;
				}
			});
		}

		// ===== Inbox Functions =====
		function renderInbox(items) {
			const container = document.getElementById('inbox-container');
			const badge = document.getElementById('inbox-badge');
			const countDisplay = document.getElementById('inbox-count');

			if (items.length > 0) {
				badge.textContent = items.length;
				badge.style.display = 'inline-block';
			} else {
				badge.style.display = 'none';
			}

			countDisplay.textContent = items.length + ' pending item' + (items.length !== 1 ? 's' : '');

			if (!items || items.length === 0) {
				container.innerHTML = '<div class="empty-state">No pending items requiring attention.</div>';
				return;
			}

			container.innerHTML = items.map(item => \`
				<div class="inbox-item \${item.priority}">
					<div class="inbox-header">
						<span class="inbox-title">\${escapeHtml(item.title)}</span>
						<span class="inbox-priority \${item.priority}">\${item.priority}</span>
					</div>
					<div class="inbox-description">\${escapeHtml(item.description)}</div>
					<div class="inbox-meta">
						\${item.planId ? 'Plan: ' + escapeHtml(item.planId) + ' • ' : ''}
						Worker: \${escapeHtml(item.workerName)} •
						\${new Date(item.createdAt).toLocaleTimeString()}
					</div>
					<div class="inbox-actions">
						<input type="text" id="inbox-input-\${item.id}" placeholder="Clarification / reason (optional)..." />
						<button data-action="inbox-approve" data-item-id="\${item.id}" class="success">✓ Approve</button>
						<button data-action="inbox-deny" data-item-id="\${item.id}" class="danger">✕ Deny</button>
						<button data-action="inbox-defer" data-item-id="\${item.id}" class="secondary">⏸ Defer</button>
					</div>
				</div>
			\`).join('');
		}

		// ===== Audit Log Functions =====
		function renderAuditLogs(entries, stats) {
			const statsContainer = document.getElementById('audit-stats');
			const container = document.getElementById('audit-container');
			const typeSelect = document.getElementById('audit-filter-type');

			// Populate event type dropdown if not done
			if (typeSelect.options.length <= 1) {
				const eventTypes = new Set(entries.map(e => e.eventType));
				eventTypes.forEach(type => {
					const option = document.createElement('option');
					option.value = type;
					option.textContent = type;
					typeSelect.appendChild(option);
				});
			}

			statsContainer.innerHTML = \`
				<span>Total: \${stats.totalEntries || entries.length}</span>
				<span>Showing: \${entries.length}</span>
				<span>Retention: \${stats.retentionDays || 30} days</span>
			\`;

			if (!entries || entries.length === 0) {
				container.innerHTML = '<div class="empty-state">No audit log entries.</div>';
				return;
			}

			container.innerHTML = entries.map(entry => {
				const isExpanded = expandedAuditEntries.has(entry.id);
				const category = getAuditCategory(entry.eventType);

				return \`
					<div class="audit-entry \${category}\${isExpanded ? ' expanded' : ''}" data-action="toggle-audit-entry" data-entry-id="\${entry.id}">
						<div class="audit-entry-header">
							<span class="audit-event-type">\${escapeHtml(entry.eventType)}</span>
							<span class="audit-timestamp">\${new Date(entry.timestamp).toLocaleString()}</span>
						</div>
						<div class="audit-entry-body">
							<span>Actor: <span class="audit-actor">\${escapeHtml(entry.actor)}</span></span>
							<span>Target: <span class="audit-target">\${escapeHtml(entry.target || '-')}</span></span>
							\${entry.planId ? '<span>Plan: ' + escapeHtml(entry.planId) + '</span>' : ''}
							\${entry.taskId ? '<span>Task: ' + escapeHtml(entry.taskId) + '</span>' : ''}
						</div>
						<div class="audit-details">\${entry.details ? escapeHtml(JSON.stringify(entry.details, null, 2)) : 'No details'}</div>
					</div>
				\`;
			}).join('');
		}

		function getAuditCategory(eventType) {
			if (eventType.startsWith('plan_')) return 'plan';
			if (eventType.startsWith('task_')) return 'task';
			if (eventType.startsWith('worker_')) return 'worker';
			if (eventType.includes('error') || eventType.includes('failed')) return 'error';
			return '';
		}

		function toggleAuditEntry(entryId) {
			if (expandedAuditEntries.has(entryId)) {
				expandedAuditEntries.delete(entryId);
			} else {
				expandedAuditEntries.add(entryId);
			}
			renderAuditLogs(currentAuditLogs, currentAuditStats);
		}

		function applyAuditFilter() {
			const eventType = document.getElementById('audit-filter-type').value;
			const actor = document.getElementById('audit-filter-actor').value.trim();
			const planId = document.getElementById('audit-filter-plan').value.trim();
			const search = document.getElementById('audit-filter-search').value.trim();

			const filter = {};
			if (eventType) filter.eventType = eventType;
			if (actor) filter.actor = actor;
			if (planId) filter.planId = planId;
			if (search) filter.search = search;

			vscode.postMessage({ type: 'getAuditLogs', filter });
		}

		function escapeHtml(text) {
			const div = document.createElement('div');
			div.textContent = text || '';
			return div.innerHTML;
		}

		// Initial load
		vscode.postMessage({ type: 'refresh' });
		vscode.postMessage({ type: 'getModels' });
		vscode.postMessage({ type: 'getInboxItems' });
		vscode.postMessage({ type: 'getAuditLogs' });
	</script>
</body>
</html>`;
	}
}
