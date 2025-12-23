/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Router, Request, Response } from 'express';
import { IOrchestratorService } from '../../orchestrator/orchestratorServiceV2';
import { WorkerSessionState, WorkerStatus } from '../../orchestrator/workerSession';

/**
 * Simplified serialized worker state for API responses.
 * Contains essential fields for monitoring worker status.
 */
export interface SerializedWorkerStateForApi {
	readonly id: string;
	readonly status: WorkerStatus;
	readonly taskId?: string;
	readonly branch?: string;
	readonly messageCount: number;
	readonly lastActivity: number;
}

/**
 * Convert WorkerSessionState to the simplified API format
 */
function toSerializedWorkerState(state: WorkerSessionState): SerializedWorkerStateForApi {
	return {
		id: state.id,
		status: state.status,
		taskId: state.planId, // planId is used as taskId in some contexts
		branch: state.baseBranch,
		messageCount: state.messages.length,
		lastActivity: state.lastActivityAt,
	};
}

/**
 * Create the worker management router.
 *
 * Endpoints:
 * - GET /api/workers - List all workers with SerializedWorkerState
 * - GET /api/workers/:id - Get worker state
 * - POST /api/workers/:id/message - Send message to worker
 * - POST /api/workers/:id/approve - Handle approval { approvalId, approved }
 * - POST /api/workers/:id/complete - Complete worker
 * - GET /api/workers/:id/stream - SSE stream of worker updates
 *
 * @param orchestratorService The orchestrator service instance
 * @returns Express Router
 */
export function createWorkerRouter(
	orchestratorService: IOrchestratorService,
): Router {
	const router = Router();

	/**
	 * GET /api/workers
	 * List all workers with their current state
	 */
	router.get('/', (_req: Request, res: Response) => {
		try {
			const workers = orchestratorService.getWorkerStates();
			const serialized = workers.map(toSerializedWorkerState);
			res.json({ workers: serialized });
		} catch (error) {
			res.status(500).json({ error: String(error) });
		}
	});

	/**
	 * GET /api/workers/:id
	 * Get a specific worker's full state
	 */
	router.get('/:id', (req: Request, res: Response) => {
		try {
			const worker = orchestratorService.getWorkerState(req.params.id);
			if (!worker) {
				return res.status(404).json({ error: 'Worker not found' });
			}
			res.json({ worker });
		} catch (error) {
			res.status(500).json({ error: String(error) });
		}
	});

	/**
	 * POST /api/workers/:id/message
	 * Send a message to a worker
	 * Body: { message: string }
	 */
	router.post('/:id/message', (req: Request, res: Response) => {
		const { message } = req.body;

		if (!message || typeof message !== 'string') {
			return res.status(400).json({ error: 'Message is required and must be a string' });
		}

		try {
			const worker = orchestratorService.getWorkerState(req.params.id);
			if (!worker) {
				return res.status(404).json({ error: 'Worker not found' });
			}

			orchestratorService.sendMessageToWorker(req.params.id, message);
			res.json({ success: true });
		} catch (error) {
			res.status(400).json({ error: String(error) });
		}
	});

	/**
	 * POST /api/workers/:id/approve
	 * Handle an approval request for a worker
	 * Body: { approvalId: string, approved: boolean, clarification?: string }
	 */
	router.post('/:id/approve', (req: Request, res: Response) => {
		const { approvalId, approved, clarification } = req.body;

		if (!approvalId || typeof approvalId !== 'string') {
			return res.status(400).json({ error: 'approvalId is required and must be a string' });
		}

		if (typeof approved !== 'boolean') {
			return res.status(400).json({ error: 'approved is required and must be a boolean' });
		}

		try {
			const worker = orchestratorService.getWorkerState(req.params.id);
			if (!worker) {
				return res.status(404).json({ error: 'Worker not found' });
			}

			orchestratorService.handleApproval(req.params.id, approvalId, approved, clarification);
			res.json({ success: true });
		} catch (error) {
			res.status(400).json({ error: String(error) });
		}
	});

	/**
	 * POST /api/workers/:id/complete
	 * Complete a worker (push changes and clean up worktree)
	 * Body: { createPullRequest?: boolean, prTitle?: string, prDescription?: string, prBaseBranch?: string }
	 */
	router.post('/:id/complete', async (req: Request, res: Response) => {
		const { createPullRequest, prTitle, prDescription, prBaseBranch } = req.body;

		try {
			const worker = orchestratorService.getWorkerState(req.params.id);
			if (!worker) {
				return res.status(404).json({ error: 'Worker not found' });
			}

			const result = await orchestratorService.completeWorker(req.params.id, {
				createPullRequest,
				prTitle,
				prDescription,
				prBaseBranch,
			});
			res.json({ result });
		} catch (error) {
			res.status(400).json({ error: String(error) });
		}
	});

	/**
	 * GET /api/workers/:id/stream
	 * SSE stream of worker updates
	 * Sends real-time updates for a specific worker
	 */
	router.get('/:id/stream', (req: Request, res: Response) => {
		const workerId = req.params.id;

		// Get initial worker state
		const worker = orchestratorService.getWorkerState(workerId);
		if (!worker) {
			return res.status(404).json({ error: 'Worker not found' });
		}

		// Set up SSE headers
		res.setHeader('Content-Type', 'text/event-stream');
		res.setHeader('Cache-Control', 'no-cache');
		res.setHeader('Connection', 'keep-alive');
		res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

		// Send initial state
		res.write(`data: ${JSON.stringify({ type: 'state', worker: toSerializedWorkerState(worker) })}\n\n`);

		// Subscribe to worker changes
		const listener = orchestratorService.onDidChangeWorkers(() => {
			const updated = orchestratorService.getWorkerState(workerId);
			if (updated) {
				res.write(`data: ${JSON.stringify({ type: 'update', worker: toSerializedWorkerState(updated) })}\n\n`);
			} else {
				// Worker was removed
				res.write(`data: ${JSON.stringify({ type: 'removed', workerId })}\n\n`);
				res.end();
			}
		});

		// Also subscribe to stream events from the WorkerSession for real-time streaming
		const workerSession = orchestratorService.getWorkerSession(workerId);
		let streamPartListener: { dispose(): void } | undefined;
		let streamStartListener: { dispose(): void } | undefined;
		let streamEndListener: { dispose(): void } | undefined;

		if (workerSession) {
			streamStartListener = workerSession.onStreamStart(() => {
				res.write(`data: ${JSON.stringify({ type: 'stream_start' })}\n\n`);
			});

			streamPartListener = workerSession.onStreamPart((part) => {
				res.write(`data: ${JSON.stringify({ type: 'stream_part', part })}\n\n`);
			});

			streamEndListener = workerSession.onStreamEnd(() => {
				res.write(`data: ${JSON.stringify({ type: 'stream_end' })}\n\n`);
			});
		}

		// Send heartbeat every 30 seconds to keep connection alive
		const heartbeat = setInterval(() => {
			res.write(`:heartbeat\n\n`);
		}, 30000);

		// Clean up on close
		req.on('close', () => {
			clearInterval(heartbeat);
			listener.dispose();
			streamPartListener?.dispose();
			streamStartListener?.dispose();
			streamEndListener?.dispose();
		});
	});

	return router;
}
