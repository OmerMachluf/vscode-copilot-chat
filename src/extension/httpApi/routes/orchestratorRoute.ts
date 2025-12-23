/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import {
	CreateTaskOptions,
	IOrchestratorService,
	OrchestratorEvent
} from '../../orchestrator/orchestratorServiceV2';

/**
 * Request body for creating a plan
 */
interface CreatePlanRequest {
	name: string;
	description: string;
	baseBranch?: string;
}

/**
 * Request body for creating a task
 */
interface CreateTaskRequest {
	description: string;
	name?: string;
	priority?: 'critical' | 'high' | 'normal' | 'low';
	planId?: string;
	dependencies?: string[];
	parallelGroup?: string;
	agent?: string;
	modelId?: string;
	targetFiles?: string[];
	baseBranch?: string;
}

/**
 * Request body for deploying a task
 */
interface DeployTaskRequest {
	modelId?: string;
}

/**
 * API response wrapper
 */
interface ApiResponse<T> {
	success: boolean;
	data?: T;
	error?: string;
}

/**
 * Route handler for orchestrator API endpoints.
 * Provides HTTP API access to the orchestrator service for managing plans, tasks, and workers.
 */
export class OrchestratorRoute extends Disposable {
	private readonly sseClients: Set<http.ServerResponse> = new Set();

	constructor(
		private readonly orchestratorService: IOrchestratorService,
		private readonly logService: ILogService,
	) {
		super();

		// Subscribe to orchestrator events for SSE
		this._register(this.orchestratorService.onOrchestratorEvent((event) => {
			this.broadcastSSE(event);
		}));

		// Also broadcast worker state changes
		this._register(this.orchestratorService.onDidChangeWorkers(() => {
			this.broadcastSSE({ type: 'workers.changed' as any });
		}));
	}

	/**
	 * Handle an HTTP request. Returns true if the request was handled.
	 */
	public async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const path = url.pathname;
		const method = req.method || 'GET';

		this.logService.trace(`[OrchestratorRoute] ${method} ${path}`);

		// Plans routes
		if (path === '/api/orchestrator/plans') {
			if (method === 'GET') {
				return this.handleGetPlans(res);
			} else if (method === 'POST') {
				return this.handleCreatePlan(req, res);
			}
		}

		// Plan by ID routes
		const planMatch = path.match(/^\/api\/orchestrator\/plans\/([^/]+)$/);
		if (planMatch) {
			const planId = planMatch[1];
			if (method === 'GET') {
				return this.handleGetPlan(planId, res);
			}
		}

		// Plan actions
		const planStartMatch = path.match(/^\/api\/orchestrator\/plans\/([^/]+)\/start$/);
		if (planStartMatch && method === 'POST') {
			return this.handleStartPlan(planStartMatch[1], res);
		}

		const planPauseMatch = path.match(/^\/api\/orchestrator\/plans\/([^/]+)\/pause$/);
		if (planPauseMatch && method === 'POST') {
			return this.handlePausePlan(planPauseMatch[1], res);
		}

		const planResumeMatch = path.match(/^\/api\/orchestrator\/plans\/([^/]+)\/resume$/);
		if (planResumeMatch && method === 'POST') {
			return this.handleResumePlan(planResumeMatch[1], res);
		}

		// Tasks routes
		if (path === '/api/orchestrator/tasks') {
			if (method === 'GET') {
				const planId = url.searchParams.get('planId') || undefined;
				return this.handleGetTasks(planId, res);
			} else if (method === 'POST') {
				return this.handleCreateTask(req, res);
			}
		}

		// Task by ID routes
		const taskMatch = path.match(/^\/api\/orchestrator\/tasks\/([^/]+)$/);
		if (taskMatch && method === 'GET') {
			return this.handleGetTask(taskMatch[1], res);
		}

		// Task deploy
		const taskDeployMatch = path.match(/^\/api\/orchestrator\/tasks\/([^/]+)\/deploy$/);
		if (taskDeployMatch && method === 'POST') {
			return this.handleDeployTask(taskDeployMatch[1], req, res);
		}

		// Task cancel
		const taskCancelMatch = path.match(/^\/api\/orchestrator\/tasks\/([^/]+)\/cancel$/);
		if (taskCancelMatch && method === 'POST') {
			return this.handleCancelTask(taskCancelMatch[1], res);
		}

		// Workers routes
		if (path === '/api/orchestrator/workers' && method === 'GET') {
			return this.handleGetWorkers(res);
		}

		// Worker by ID
		const workerMatch = path.match(/^\/api\/orchestrator\/workers\/([^/]+)$/);
		if (workerMatch && method === 'GET') {
			return this.handleGetWorker(workerMatch[1], res);
		}

		// Inbox routes
		if (path === '/api/orchestrator/inbox' && method === 'GET') {
			return this.handleGetInbox(res);
		}

		const inboxProcessMatch = path.match(/^\/api\/orchestrator\/inbox\/([^/]+)\/process$/);
		if (inboxProcessMatch && method === 'POST') {
			return this.handleProcessInboxItem(inboxProcessMatch[1], req, res);
		}

		// SSE events stream
		if (path === '/api/orchestrator/events' && method === 'GET') {
			return this.handleSSE(req, res);
		}

		return false;
	}

	// ============================================================================
	// Plan Handlers
	// ============================================================================

	private handleGetPlans(res: http.ServerResponse): boolean {
		try {
			const plans = this.orchestratorService.getPlans();
			this.sendJson(res, 200, { success: true, data: plans });
		} catch (error) {
			this.sendError(res, 500, error);
		}
		return true;
	}

	private async handleCreatePlan(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
		try {
			const body = await this.readRequestBody(req);
			const request: CreatePlanRequest = JSON.parse(body);

			if (!request.name || !request.description) {
				this.sendJson(res, 400, {
					success: false,
					error: 'Missing required fields: name, description'
				});
				return true;
			}

			const plan = this.orchestratorService.createPlan(
				request.name,
				request.description,
				request.baseBranch
			);

			this.sendJson(res, 201, { success: true, data: plan });
		} catch (error) {
			this.sendError(res, 500, error);
		}
		return true;
	}

	private handleGetPlan(planId: string, res: http.ServerResponse): boolean {
		try {
			const plan = this.orchestratorService.getPlanById(planId);
			if (!plan) {
				this.sendJson(res, 404, { success: false, error: `Plan not found: ${planId}` });
				return true;
			}

			// Include tasks for this plan
			const tasks = this.orchestratorService.getTasks(planId);
			const workers = this.orchestratorService.getWorkerStates().filter(w => w.planId === planId);

			this.sendJson(res, 200, {
				success: true,
				data: {
					...plan,
					tasks,
					workers,
				}
			});
		} catch (error) {
			this.sendError(res, 500, error);
		}
		return true;
	}

	private async handleStartPlan(planId: string, res: http.ServerResponse): Promise<boolean> {
		try {
			const plan = this.orchestratorService.getPlanById(planId);
			if (!plan) {
				this.sendJson(res, 404, { success: false, error: `Plan not found: ${planId}` });
				return true;
			}

			await this.orchestratorService.startPlan(planId);
			this.sendJson(res, 200, { success: true, data: { message: 'Plan started' } });
		} catch (error) {
			this.sendError(res, 500, error);
		}
		return true;
	}

	private handlePausePlan(planId: string, res: http.ServerResponse): boolean {
		try {
			const plan = this.orchestratorService.getPlanById(planId);
			if (!plan) {
				this.sendJson(res, 404, { success: false, error: `Plan not found: ${planId}` });
				return true;
			}

			this.orchestratorService.pausePlan(planId);
			this.sendJson(res, 200, { success: true, data: { message: 'Plan paused' } });
		} catch (error) {
			this.sendError(res, 500, error);
		}
		return true;
	}

	private handleResumePlan(planId: string, res: http.ServerResponse): boolean {
		try {
			const plan = this.orchestratorService.getPlanById(planId);
			if (!plan) {
				this.sendJson(res, 404, { success: false, error: `Plan not found: ${planId}` });
				return true;
			}

			this.orchestratorService.resumePlan(planId);
			this.sendJson(res, 200, { success: true, data: { message: 'Plan resumed' } });
		} catch (error) {
			this.sendError(res, 500, error);
		}
		return true;
	}

	// ============================================================================
	// Task Handlers
	// ============================================================================

	private handleGetTasks(planId: string | undefined, res: http.ServerResponse): boolean {
		try {
			const tasks = this.orchestratorService.getTasks(planId);
			this.sendJson(res, 200, { success: true, data: tasks });
		} catch (error) {
			this.sendError(res, 500, error);
		}
		return true;
	}

	private handleGetTask(taskId: string, res: http.ServerResponse): boolean {
		try {
			const task = this.orchestratorService.getTaskById(taskId);
			if (!task) {
				this.sendJson(res, 404, { success: false, error: `Task not found: ${taskId}` });
				return true;
			}

			// Include worker state if task is running
			let worker = undefined;
			if (task.workerId) {
				worker = this.orchestratorService.getWorkerState(task.workerId);
			}

			this.sendJson(res, 200, {
				success: true,
				data: { ...task, worker }
			});
		} catch (error) {
			this.sendError(res, 500, error);
		}
		return true;
	}

	private async handleCreateTask(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
		try {
			const body = await this.readRequestBody(req);
			const request: CreateTaskRequest = JSON.parse(body);

			if (!request.description) {
				this.sendJson(res, 400, {
					success: false,
					error: 'Missing required field: description'
				});
				return true;
			}

			const options: CreateTaskOptions = {
				name: request.name,
				priority: request.priority,
				planId: request.planId,
				dependencies: request.dependencies,
				parallelGroup: request.parallelGroup,
				agent: request.agent,
				modelId: request.modelId,
				targetFiles: request.targetFiles,
				baseBranch: request.baseBranch,
			};

			const task = this.orchestratorService.addTask(request.description, options);
			this.sendJson(res, 201, { success: true, data: task });
		} catch (error) {
			this.sendError(res, 500, error);
		}
		return true;
	}

	private async handleDeployTask(taskId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
		try {
			const task = this.orchestratorService.getTaskById(taskId);
			if (!task) {
				this.sendJson(res, 404, { success: false, error: `Task not found: ${taskId}` });
				return true;
			}

			let deployOptions = {};
			try {
				const body = await this.readRequestBody(req);
				if (body) {
					const request: DeployTaskRequest = JSON.parse(body);
					if (request.modelId) {
						deployOptions = { modelId: request.modelId };
					}
				}
			} catch {
				// Ignore body parse errors - deploy options are optional
			}

			const worker = await this.orchestratorService.deploy(taskId, deployOptions);
			this.sendJson(res, 200, {
				success: true,
				data: {
					workerId: worker.id,
					sessionUri: task.sessionUri,
					message: 'Task deployed to worker'
				}
			});
		} catch (error) {
			this.sendError(res, 500, error);
		}
		return true;
	}

	private async handleCancelTask(taskId: string, res: http.ServerResponse): Promise<boolean> {
		try {
			const task = this.orchestratorService.getTaskById(taskId);
			if (!task) {
				this.sendJson(res, 404, { success: false, error: `Task not found: ${taskId}` });
				return true;
			}

			await this.orchestratorService.cancelTask(taskId);
			this.sendJson(res, 200, { success: true, data: { message: 'Task cancelled' } });
		} catch (error) {
			this.sendError(res, 500, error);
		}
		return true;
	}

	// ============================================================================
	// Worker Handlers
	// ============================================================================

	private handleGetWorkers(res: http.ServerResponse): boolean {
		try {
			const workers = this.orchestratorService.getWorkerStates();
			this.sendJson(res, 200, { success: true, data: workers });
		} catch (error) {
			this.sendError(res, 500, error);
		}
		return true;
	}

	private handleGetWorker(workerId: string, res: http.ServerResponse): boolean {
		try {
			const worker = this.orchestratorService.getWorkerState(workerId);
			if (!worker) {
				this.sendJson(res, 404, { success: false, error: `Worker not found: ${workerId}` });
				return true;
			}

			this.sendJson(res, 200, { success: true, data: worker });
		} catch (error) {
			this.sendError(res, 500, error);
		}
		return true;
	}


	// Inbox Handlers ============================================================================

	private handleGetInbox(res: http.ServerResponse): boolean {
		try {
			const items = this.orchestratorService.getInboxPendingItems();
			this.sendJson(res, 200, { success: true, data: items });
		} catch (error) {
			this.sendError(res, 500, error);
		}
		return true;
	}

	private async handleProcessInboxItem(itemId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
		try {
			const body = await this.readRequestBody(req);
			const { action, response } = JSON.parse(body);

			if (!action || !['approve', 'deny', 'respond'].includes(action)) {
				this.sendJson(res, 400, {
					success: false,
					error: 'Invalid action. Must be: approve, deny, or respond'
				});
				return true;
			}

			// Find the item to check its type
			const items = this.orchestratorService.getInboxPendingItems();
			const item = items.find(i => i.id === itemId);

			if (!item) {
				this.sendJson(res, 404, { success: false, error: `Inbox item not found: ${itemId}` });
				return true;
			}

			// Handle approval requests specially
			if (item.message.type === 'approval_request' && (action === 'approve' || action === 'deny')) {
				const content = item.message.content as any;
				if (content && content.approvalId) {
					this.orchestratorService.handleApproval(
						item.message.workerId,
						content.approvalId,
						action === 'approve',
						response
					);
				}
			}

			// Mark as processed (this also sends response for non-approval items)
			this.orchestratorService.processInboxItem(itemId, response);

			this.sendJson(res, 200, { success: true, data: { message: 'Item processed' } });
		} catch (error) {
			this.sendError(res, 500, error);
		}
		return true;
	}

	// ============================================================================
	//

	// ============================================================================
	// SSE (Server-Sent Events)
	// ============================================================================

	private handleSSE(req: http.IncomingMessage, res: http.ServerResponse): boolean {
		// Set SSE headers
		res.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'Access-Control-Allow-Origin': '*',
		});

		// Send initial connection event
		res.write(`event: connected\ndata: ${JSON.stringify({ message: 'Connected to orchestrator events' })}\n\n`);

		// Add to clients
		this.sseClients.add(res);
		this.logService.trace(`[OrchestratorRoute] SSE client connected. Total clients: ${this.sseClients.size}`);

		// Handle client disconnect
		req.on('close', () => {
			this.sseClients.delete(res);
			this.logService.trace(`[OrchestratorRoute] SSE client disconnected. Total clients: ${this.sseClients.size}`);
		});

		// Keep connection alive with heartbeat
		const heartbeat = setInterval(() => {
			if (!res.writableEnded) {
				res.write(`:heartbeat\n\n`);
			}
		}, 30000);

		req.on('close', () => {
			clearInterval(heartbeat);
		});

		return true;
	}

	private broadcastSSE(event: OrchestratorEvent | { type: 'workers.changed' }): void {
		const data = JSON.stringify(event);
		const message = `event: ${event.type}\ndata: ${data}\n\n`;

		for (const client of this.sseClients) {
			if (!client.writableEnded) {
				try {
					client.write(message);
				} catch (error) {
					this.logService.trace(`[OrchestratorRoute] Failed to send SSE to client: ${error}`);
					this.sseClients.delete(client);
				}
			} else {
				this.sseClients.delete(client);
			}
		}
	}

	// ============================================================================
	// Utilities
	// ============================================================================

	private async readRequestBody(req: http.IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			let body = '';
			req.on('data', (chunk: Buffer) => {
				body += chunk.toString();
			});
			req.on('end', () => {
				resolve(body);
			});
			req.on('error', reject);
		});
	}

	private sendJson<T>(res: http.ServerResponse, statusCode: number, data: ApiResponse<T>): void {
		res.writeHead(statusCode, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(data));
	}

	private sendError(res: http.ServerResponse, statusCode: number, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.logService.error(`[OrchestratorRoute] Error: ${message}`);
		this.sendJson(res, statusCode, { success: false, error: message });
	}

	public override dispose(): void {
		// Close all SSE connections
		for (const client of this.sseClients) {
			if (!client.writableEnded) {
				client.end();
			}
		}
		this.sseClients.clear();
		super.dispose();
	}
}
