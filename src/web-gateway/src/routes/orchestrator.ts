/**
 * Orchestrator Routes
 *
 * REST API endpoints for orchestrator operations:
 * - Plans: CRUD operations for orchestrator plans
 * - Tasks: Task management within plans
 * - Workers: Worker session control
 * - Graph: Dependency visualization data
 *
 * These routes proxy to the extension HTTP API, which handles
 * the actual orchestration logic.
 */

import { Request, Response, Router } from 'express';
import { config } from '../config';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';
import { getHub, type EventChannel } from '../websocket';

/**
 * Broadcast an event to the WebSocket hub if initialized.
 */
function broadcastEvent(channel: EventChannel, data: unknown): void {
	try {
		const hub = getHub();
		hub.broadcast(channel, data);
	} catch {
		// Hub not initialized, skip broadcast
	}
}

/**
 * Helper function to proxy a GET request to the extension API.
 * Handles errors and returns appropriate status codes.
 */
async function proxyToExtension(
	path: string,
	res: Response,
): Promise<void> {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

		const response = await fetch(`${config.extensionApiUrl}${path}`, {
			method: 'GET',
			signal: controller.signal,
			headers: {
				'Content-Type': 'application/json',
			},
		});

		clearTimeout(timeout);

		const data = await response.json();

		if (response.ok) {
			res.json(data);
		} else {
			res.status(response.status).json(data);
		}
	} catch (error) {
		console.error(`Failed to proxy request to ${path}:`, error);

		const err = error as Error;
		if (err.name === 'AbortError') {
			res.status(504).json({
				error: 'Request to extension API timed out',
				details: 'The extension did not respond in time.',
			});
			return;
		}

		res.status(503).json({
			error: 'VS Code extension API is unavailable',
			details: config.nodeEnv === 'development' ? err.message : undefined,
		});
	}
}

/**
 * Helper function to proxy a POST request to the extension API.
 * Handles errors and returns appropriate status codes.
 */
async function proxyPostToExtension(
	path: string,
	body: unknown,
	res: Response,
): Promise<void> {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

		const response = await fetch(`${config.extensionApiUrl}${path}`, {
			method: 'POST',
			signal: controller.signal,
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		});

		clearTimeout(timeout);

		const data = await response.json();

		if (response.ok) {
			res.json(data);
		} else {
			res.status(response.status).json(data);
		}
	} catch (error) {
		console.error(`Failed to proxy POST request to ${path}:`, error);

		const err = error as Error;
		if (err.name === 'AbortError') {
			res.status(504).json({
				error: 'Request to extension API timed out',
				details: 'The extension did not respond in time.',
			});
			return;
		}

		res.status(503).json({
			error: 'VS Code extension API is unavailable',
			details: config.nodeEnv === 'development' ? err.message : undefined,
		});
	}
}

export const orchestratorRouter = Router();

// ============================================================================
// PLANS
// ============================================================================

/**
 * GET /api/orchestrator/plans
 * List all orchestrator plans
 */
orchestratorRouter.get('/plans', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
	await proxyToExtension('/api/orchestrator/plans', res);
});

/**
 * POST /api/orchestrator/plans
 * Create a new orchestrator plan
 */
orchestratorRouter.post('/plans', async (req: Request, res: Response) => {
	const { name, description, baseBranch } = req.body;

	if (!name || typeof name !== 'string') {
		res.status(400).json({ error: 'Missing required field: name' });
		return;
	}

	// Broadcast event to connected clients
	broadcastEvent('orchestrator', {
		type: 'plan.creating',
		name,
		description,
	});

	res.json({
		message: 'This endpoint proxies to the extension API',
		endpoint: 'POST /api/orchestrator/plans',
		body: { name, description, baseBranch },
		note: 'Extension API endpoint not yet implemented',
	});
});

/**
 * GET /api/orchestrator/plans/:planId
 * Get a specific plan by ID
 */
orchestratorRouter.get('/plans/:planId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
	const { planId } = req.params;
	await proxyToExtension(`/api/orchestrator/plans/${planId}`, res);
});

/**
 * DELETE /api/orchestrator/plans/:planId
 * Delete a plan
 */
orchestratorRouter.delete('/plans/:planId', async (req: Request, res: Response) => {
	const { planId } = req.params;

	broadcastEvent('orchestrator', {
		type: 'plan.deleting',
		planId,
	});

	res.json({
		message: 'This endpoint proxies to the extension API',
		endpoint: `DELETE /api/orchestrator/plans/${planId}`,
		note: 'Extension API endpoint not yet implemented',
	});
});

/**
 * POST /api/orchestrator/plans/:planId/start
 * Start executing a plan
 */
orchestratorRouter.post('/plans/:planId/start', async (req: Request, res: Response) => {
	const { planId } = req.params;

	broadcastEvent('orchestrator', {
		type: 'plan.starting',
		planId,
	});

	res.json({
		message: 'This endpoint proxies to the extension API',
		endpoint: `POST /api/orchestrator/plans/${planId}/start`,
		note: 'Extension API endpoint not yet implemented',
	});
});

/**
 * POST /api/orchestrator/plans/:planId/pause
 * Pause a running plan
 */
orchestratorRouter.post('/plans/:planId/pause', async (req: Request, res: Response) => {
	const { planId } = req.params;

	broadcastEvent('orchestrator', {
		type: 'plan.pausing',
		planId,
	});

	res.json({
		message: 'This endpoint proxies to the extension API',
		endpoint: `POST /api/orchestrator/plans/${planId}/pause`,
		note: 'Extension API endpoint not yet implemented',
	});
});

/**
 * POST /api/orchestrator/plans/:planId/deploy
 * Deploy a task from a plan. If taskId is not provided, deploys the next ready task.
 */
orchestratorRouter.post('/plans/:planId/deploy', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
	const { planId } = req.params;
	const { taskId, modelId } = req.body;

	// Validate planId format (should be like "plan-123")
	if (!planId || typeof planId !== 'string') {
		res.status(400).json({ error: 'Invalid plan ID' });
		return;
	}

	// Optional: validate taskId format if provided
	if (taskId !== undefined && typeof taskId !== 'string') {
		res.status(400).json({ error: 'taskId must be a string if provided' });
		return;
	}

	// Optional: validate modelId if provided
	if (modelId !== undefined && typeof modelId !== 'string') {
		res.status(400).json({ error: 'modelId must be a string if provided' });
		return;
	}

	broadcastEvent('orchestrator', {
		type: 'plan.deploying',
		planId,
		taskId,
		modelId,
	});

	await proxyPostToExtension(
		`/api/orchestrator/plans/${planId}/deploy`,
		{ taskId, modelId },
		res
	);
});

// ============================================================================
// TASKS
// ============================================================================

/**
 * GET /api/orchestrator/plans/:planId/tasks
 * List all tasks in a plan
 */
orchestratorRouter.get('/plans/:planId/tasks', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
	const { planId } = req.params;
	await proxyToExtension(`/api/orchestrator/plans/${planId}/tasks`, res);
});

/**
 * POST /api/orchestrator/plans/:planId/tasks
 * Add a task to a plan
 */
orchestratorRouter.post('/plans/:planId/tasks', async (req: Request, res: Response) => {
	const { planId } = req.params;
	const { name, description, dependencies, agent, targetFiles } = req.body;

	if (!description || typeof description !== 'string') {
		res.status(400).json({ error: 'Missing required field: description' });
		return;
	}

	broadcastEvent('orchestrator', {
		type: 'task.creating',
		planId,
		name,
		description,
	});

	res.json({
		message: 'This endpoint proxies to the extension API',
		endpoint: `POST /api/orchestrator/plans/${planId}/tasks`,
		body: { name, description, dependencies, agent, targetFiles },
		note: 'Extension API endpoint not yet implemented',
	});
});

/**
 * GET /api/orchestrator/tasks/:taskId
 * Get a specific task
 */
orchestratorRouter.get('/tasks/:taskId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
	const { taskId } = req.params;
	await proxyToExtension(`/api/orchestrator/tasks/${taskId}`, res);
});

/**
 * DELETE /api/orchestrator/tasks/:taskId
 * Remove a task from its plan
 */
orchestratorRouter.delete('/tasks/:taskId', async (req: Request, res: Response) => {
	const { taskId } = req.params;

	broadcastEvent('orchestrator', {
		type: 'task.removing',
		taskId,
	});

	res.json({
		message: 'This endpoint proxies to the extension API',
		endpoint: `DELETE /api/orchestrator/tasks/${taskId}`,
		note: 'Extension API endpoint not yet implemented',
	});
});

/**
 * POST /api/orchestrator/tasks/:taskId/deploy
 * Deploy a worker for a task
 */
orchestratorRouter.post('/tasks/:taskId/deploy', async (req: Request, res: Response) => {
	const { taskId } = req.params;
	const { modelId, agentId } = req.body;

	broadcastEvent('orchestrator', {
		type: 'task.deploying',
		taskId,
		modelId,
		agentId,
	});

	res.json({
		message: 'This endpoint proxies to the extension API',
		endpoint: `POST /api/orchestrator/tasks/${taskId}/deploy`,
		body: { modelId, agentId },
		note: 'Extension API endpoint not yet implemented',
	});
});

/**
 * POST /api/orchestrator/tasks/:taskId/retry
 * Retry a failed task
 */
orchestratorRouter.post('/tasks/:taskId/retry', async (req: Request, res: Response) => {
	const { taskId } = req.params;

	broadcastEvent('orchestrator', {
		type: 'task.retrying',
		taskId,
	});

	res.json({
		message: 'This endpoint proxies to the extension API',
		endpoint: `POST /api/orchestrator/tasks/${taskId}/retry`,
		note: 'Extension API endpoint not yet implemented',
	});
});

/**
 * POST /api/orchestrator/tasks/:taskId/cancel
 * Cancel a running or pending task. Optionally remove it from the plan.
 */
orchestratorRouter.post('/tasks/:taskId/cancel', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
	const { taskId } = req.params;
	const { remove } = req.body;

	// Validate taskId
	if (!taskId || typeof taskId !== 'string') {
		res.status(400).json({ error: 'Invalid task ID' });
		return;
	}

	// Validate remove flag if provided
	if (remove !== undefined && typeof remove !== 'boolean') {
		res.status(400).json({ error: 'remove must be a boolean if provided' });
		return;
	}

	broadcastEvent('orchestrator', {
		type: 'task.cancelling',
		taskId,
		remove: remove ?? false,
	});

	await proxyPostToExtension(
		`/api/orchestrator/tasks/${taskId}/cancel`,
		{ remove: remove ?? false },
		res
	);
});

/**
 * POST /api/orchestrator/tasks/:taskId/complete
 * Mark a task as completed. This should only be called by the parent agent
 * after reviewing and integrating the worker's changes.
 */
orchestratorRouter.post('/tasks/:taskId/complete', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
	const { taskId } = req.params;

	// Validate taskId
	if (!taskId || typeof taskId !== 'string') {
		res.status(400).json({ error: 'Invalid task ID' });
		return;
	}

	broadcastEvent('orchestrator', {
		type: 'task.completing',
		taskId,
	});

	await proxyPostToExtension(
		`/api/orchestrator/tasks/${taskId}/complete`,
		{},
		res
	);
});

// ============================================================================
// WORKERS
// ============================================================================

/**
 * GET /api/orchestrator/workers
 * List all active workers
 */
orchestratorRouter.get('/workers', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
	await proxyToExtension('/api/orchestrator/workers', res);
});

/**
 * GET /api/orchestrator/workers/:workerId
 * Get a specific worker's state
 */
orchestratorRouter.get('/workers/:workerId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
	const { workerId } = req.params;
	await proxyToExtension(`/api/orchestrator/workers/${workerId}`, res);
});

/**
 * GET /api/orchestrator/workers/:workerId/messages
 * Get a worker's conversation history
 */
orchestratorRouter.get('/workers/:workerId/messages', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
	const { workerId } = req.params;
	await proxyToExtension(`/api/orchestrator/workers/${workerId}/messages`, res);
});

/**
 * POST /api/orchestrator/workers/:workerId/message
 * Send a message to a worker
 */
orchestratorRouter.post('/workers/:workerId/message', async (req: Request, res: Response) => {
	const { workerId } = req.params;
	const { message } = req.body;

	if (!message || typeof message !== 'string') {
		res.status(400).json({ error: 'Missing required field: message' });
		return;
	}

	broadcastEvent('workers', {
		type: 'worker.message',
		workerId,
		message,
	});

	res.json({
		message: 'This endpoint proxies to the extension API',
		endpoint: `POST /api/orchestrator/workers/${workerId}/message`,
		body: { message },
		note: 'Extension API endpoint not yet implemented',
	});
});

/**
 * POST /api/orchestrator/workers/:workerId/pause
 * Pause a worker
 */
orchestratorRouter.post('/workers/:workerId/pause', async (req: Request, res: Response) => {
	const { workerId } = req.params;

	broadcastEvent('workers', {
		type: 'worker.pausing',
		workerId,
	});

	res.json({
		message: 'This endpoint proxies to the extension API',
		endpoint: `POST /api/orchestrator/workers/${workerId}/pause`,
		note: 'Extension API endpoint not yet implemented',
	});
});

/**
 * POST /api/orchestrator/workers/:workerId/resume
 * Resume a paused worker
 */
orchestratorRouter.post('/workers/:workerId/resume', async (req: Request, res: Response) => {
	const { workerId } = req.params;

	broadcastEvent('workers', {
		type: 'worker.resuming',
		workerId,
	});

	res.json({
		message: 'This endpoint proxies to the extension API',
		endpoint: `POST /api/orchestrator/workers/${workerId}/resume`,
		note: 'Extension API endpoint not yet implemented',
	});
});

/**
 * POST /api/orchestrator/workers/:workerId/complete
 * Complete a worker (push changes and cleanup)
 */
orchestratorRouter.post('/workers/:workerId/complete', async (req: Request, res: Response) => {
	const { workerId } = req.params;
	const { createPR, mergeToMain } = req.body;

	broadcastEvent('workers', {
		type: 'worker.completing',
		workerId,
		createPR,
		mergeToMain,
	});

	res.json({
		message: 'This endpoint proxies to the extension API',
		endpoint: `POST /api/orchestrator/workers/${workerId}/complete`,
		body: { createPR, mergeToMain },
		note: 'Extension API endpoint not yet implemented',
	});
});

/**
 * DELETE /api/orchestrator/workers/:workerId
 * Kill a worker
 */
orchestratorRouter.delete('/workers/:workerId', async (req: Request, res: Response) => {
	const { workerId } = req.params;

	broadcastEvent('workers', {
		type: 'worker.killing',
		workerId,
	});

	res.json({
		message: 'This endpoint proxies to the extension API',
		endpoint: `DELETE /api/orchestrator/workers/${workerId}`,
		note: 'Extension API endpoint not yet implemented',
	});
});

// ============================================================================
// GRAPH
// ============================================================================

/**
 * GET /api/orchestrator/plans/:planId/graph
 * Get the dependency graph for visualization
 * Returns { nodes, edges } for DAG visualization
 */
orchestratorRouter.get('/plans/:planId/graph', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
	const { planId } = req.params;
	await proxyToExtension(`/api/orchestrator/plans/${planId}/graph`, res);
});

// ============================================================================
// INBOX
// ============================================================================

/**
 * GET /api/orchestrator/inbox
 * Get pending inbox items (approvals, escalations)
 */
orchestratorRouter.get('/inbox', async (_req: Request, res: Response) => {
	res.json({
		message: 'This endpoint proxies to the extension API',
		endpoint: 'GET /api/orchestrator/inbox',
		note: 'Extension API endpoint not yet implemented',
	});
});

/**
 * POST /api/orchestrator/inbox/:itemId/process
 * Process an inbox item (approve/deny)
 */
orchestratorRouter.post('/inbox/:itemId/process', async (req: Request, res: Response) => {
	const { itemId } = req.params;
	const { action, response } = req.body;

	if (!action || !['approve', 'deny', 'respond'].includes(action)) {
		res.status(400).json({ error: 'Invalid action. Must be: approve, deny, or respond' });
		return;
	}

	broadcastEvent('orchestrator', {
		type: 'inbox.processing',
		itemId,
		action,
	});

	res.json({
		message: 'This endpoint proxies to the extension API',
		endpoint: `POST /api/orchestrator/inbox/${itemId}/process`,
		body: { action, response },
		note: 'Extension API endpoint not yet implemented',
	});
});
