import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, chatRateLimiter } from '../middleware';
import { createApiProxy } from '../proxy/apiProxy';
import { config } from '../config';

const router = Router();

/**
 * Chat session management routes.
 * All routes require authentication and are proxied to the extension HTTP API.
 * Rate limited to 10 requests per minute per user.
 */

// Apply authentication to all chat routes
router.use(requireAuth);

// Apply chat rate limiter: 10 requests per minute per user
router.use(chatRateLimiter);

// Create API proxy for chat endpoints
const proxyLogger = (msg: string, level: string) => {
	if (config.enableLogging) {
		console.log(`[ChatProxy] ${level.toUpperCase()}: ${msg}`);
	}
};

const chatProxy = createApiProxy({
	target: config.extensionApiUrl,
	logger: proxyLogger,
});

/**
 * GET /api/chat/sessions
 *
 * List all chat sessions.
 *
 * Query parameters:
 *   - limit: number (optional) - Maximum number of sessions to return
 *   - offset: number (optional) - Offset for pagination
 *   - status: string (optional) - Filter by session status (active, paused, completed)
 */
router.get('/sessions', (req: Request, res: Response, next: NextFunction) => {
	chatProxy(req, res, next);
});

/**
 * GET /api/chat/sessions/:id
 *
 * Get a specific session with its messages.
 *
 * URL parameters:
 *   - id: string (required) - The session ID
 *
 * Query parameters:
 *   - includeMessages: boolean (optional) - Include message history (default: true)
 *   - messageLimit: number (optional) - Maximum number of messages to return
 */
router.get('/sessions/:id', (req: Request, res: Response, next: NextFunction) => {
	chatProxy(req, res, next);
});

/**
 * POST /api/chat/sessions/:id/pause
 *
 * Pause a chat session.
 *
 * URL parameters:
 *   - id: string (required) - The session ID to pause
 *
 * Request body:
 *   - reason: string (optional) - Reason for pausing the session
 */
router.post('/sessions/:id/pause', (req: Request, res: Response, next: NextFunction) => {
	chatProxy(req, res, next);
});

/**
 * POST /api/chat/sessions/:id/resume
 *
 * Resume a paused chat session.
 *
 * URL parameters:
 *   - id: string (required) - The session ID to resume
 */
router.post('/sessions/:id/resume', (req: Request, res: Response, next: NextFunction) => {
	chatProxy(req, res, next);
});

/**
 * DELETE /api/chat/sessions/:id
 *
 * Delete a chat session.
 *
 * URL parameters:
 *   - id: string (required) - The session ID to delete
 *
 * Query parameters:
 *   - force: boolean (optional) - Force delete even if session is active (default: false)
 */
router.delete('/sessions/:id', (req: Request, res: Response, next: NextFunction) => {
	chatProxy(req, res, next);
});

export const chatRouter = router;
