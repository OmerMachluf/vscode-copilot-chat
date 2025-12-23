/**
 * Session Management Routes
 *
 * REST API endpoints for managing gateway sessions.
 * Sessions track connections between browser clients and VS Code extension instances.
 *
 * Routes:
 * - GET /api/sessions - List all active sessions
 * - POST /api/sessions - Create a new session
 * - DELETE /api/sessions/:id - Terminate a session
 * - GET /api/sessions/:id/health - Check session health
 */

import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { getHub } from '../websocket';

/**
 * Session status types.
 */
export type SessionStatus = 'active' | 'idle' | 'disconnected' | 'error';

/**
 * Represents a gateway session connecting a browser client to a VS Code extension.
 */
export interface GatewaySession {
	/** Unique session identifier */
	id: string;
	/** User identifier who owns this session */
	userId: string;
	/** Session creation timestamp */
	createdAt: Date;
	/** Last activity timestamp */
	lastActivityAt: Date;
	/** Current session status */
	status: SessionStatus;
	/** Client metadata */
	client: {
		/** Client IP address */
		ip: string;
		/** User agent string */
		userAgent: string;
		/** WebSocket connection ID (if connected) */
		wsConnectionId?: string;
	};
	/** Extension connection info */
	extension: {
		/** Whether extension is reachable */
		connected: boolean;
		/** Last health check timestamp */
		lastHealthCheck?: Date;
		/** Extension API URL being used */
		apiUrl?: string;
	};
	/** Optional session metadata */
	metadata?: Record<string, unknown>;
}

/**
 * In-memory session store.
 * In production, this would be replaced with Redis or a database.
 */
const sessions = new Map<string, GatewaySession>();

/**
 * Generate a unique session ID.
 */
function generateSessionId(): string {
	const timestamp = Date.now().toString(36);
	const randomPart = Math.random().toString(36).substring(2, 10);
	return `sess_${timestamp}_${randomPart}`;
}

/**
 * Get the client IP address from the request.
 */
function getClientIp(req: Request): string {
	const forwarded = req.headers['x-forwarded-for'];
	if (forwarded) {
		const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
		return ips.trim();
	}
	return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/**
 * Check if the extension API is reachable.
 */
async function checkExtensionHealth(): Promise<boolean> {
	try {
		const hub = getHub();
		return hub.isExtensionConnected();
	} catch {
		return false;
	}
}

/**
 * Update session activity timestamp.
 */
function touchSession(sessionId: string): void {
	const session = sessions.get(sessionId);
	if (session) {
		session.lastActivityAt = new Date();
	}
}

/**
 * Calculate session health metrics.
 */
interface SessionHealth {
	status: 'healthy' | 'degraded' | 'unhealthy';
	uptime: number;
	lastActivity: number;
	extensionConnected: boolean;
	wsConnected: boolean;
	details: {
		sessionAge: string;
		idleTime: string;
		healthChecks: {
			extension: boolean;
			websocket: boolean;
		};
	};
}

async function calculateSessionHealth(session: GatewaySession): Promise<SessionHealth> {
	const now = Date.now();
	const createdAt = session.createdAt.getTime();
	const lastActivityAt = session.lastActivityAt.getTime();

	const uptime = now - createdAt;
	const idleTime = now - lastActivityAt;

	// Check WebSocket connectivity
	let wsConnected = false;
	try {
		const hub = getHub();
		wsConnected = hub.getClientCount() > 0;
	} catch {
		// Hub not available
	}

	// Check extension connectivity
	const extensionConnected = await checkExtensionHealth();

	// Determine health status
	let status: 'healthy' | 'degraded' | 'unhealthy';
	if (extensionConnected && session.status === 'active') {
		status = 'healthy';
	} else if (session.status === 'idle' || !extensionConnected) {
		status = 'degraded';
	} else {
		status = 'unhealthy';
	}

	// Format durations
	const formatDuration = (ms: number): string => {
		const seconds = Math.floor(ms / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);

		if (hours > 0) {
			return `${hours}h ${minutes % 60}m`;
		} else if (minutes > 0) {
			return `${minutes}m ${seconds % 60}s`;
		} else {
			return `${seconds}s`;
		}
	};

	return {
		status,
		uptime,
		lastActivity: idleTime,
		extensionConnected,
		wsConnected,
		details: {
			sessionAge: formatDuration(uptime),
			idleTime: formatDuration(idleTime),
			healthChecks: {
				extension: extensionConnected,
				websocket: wsConnected,
			},
		},
	};
}

export const sessionsRouter = Router();

// All session routes require authentication
sessionsRouter.use(requireAuth);

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * GET /api/sessions
 * List all active sessions for the authenticated user.
 *
 * Query parameters:
 *   - status: Filter by session status (active, idle, disconnected, error)
 *   - limit: Maximum number of sessions to return (default: 50)
 *   - offset: Pagination offset (default: 0)
 *
 * Response:
 *   {
 *     sessions: GatewaySession[],
 *     total: number,
 *     limit: number,
 *     offset: number
 *   }
 */
sessionsRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
	const userId = req.user?.sub;

	if (!userId) {
		res.status(401).json({ error: { message: 'User not authenticated' } });
		return;
	}

	// Parse query parameters
	const statusFilter = req.query.status as SessionStatus | undefined;
	const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
	const offset = parseInt(req.query.offset as string, 10) || 0;

	// Get all sessions for this user
	let userSessions = Array.from(sessions.values())
		.filter(s => s.userId === userId);

	// Apply status filter if provided
	if (statusFilter && ['active', 'idle', 'disconnected', 'error'].includes(statusFilter)) {
		userSessions = userSessions.filter(s => s.status === statusFilter);
	}

	// Sort by creation date (newest first)
	userSessions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

	// Apply pagination
	const total = userSessions.length;
	const paginatedSessions = userSessions.slice(offset, offset + limit);

	res.json({
		sessions: paginatedSessions,
		total,
		limit,
		offset,
	});
});

/**
 * POST /api/sessions
 * Create a new gateway session.
 *
 * Request body:
 *   - metadata: Optional metadata to attach to the session
 *
 * Response:
 *   {
 *     session: GatewaySession,
 *     message: string
 *   }
 */
sessionsRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
	const userId = req.user?.sub;

	if (!userId) {
		res.status(401).json({ error: { message: 'User not authenticated' } });
		return;
	}

	const { metadata } = req.body;

	// Check extension connectivity
	const extensionConnected = await checkExtensionHealth();

	// Create new session
	const sessionId = generateSessionId();
	const now = new Date();

	const session: GatewaySession = {
		id: sessionId,
		userId,
		createdAt: now,
		lastActivityAt: now,
		status: 'active',
		client: {
			ip: getClientIp(req),
			userAgent: req.headers['user-agent'] ?? 'unknown',
		},
		extension: {
			connected: extensionConnected,
			lastHealthCheck: now,
		},
		...(metadata && { metadata }),
	};

	// Store session
	sessions.set(sessionId, session);

	res.status(201).json({
		session,
		message: 'Session created successfully',
	});
});

/**
 * GET /api/sessions/:id
 * Get a specific session by ID.
 *
 * URL parameters:
 *   - id: Session ID
 *
 * Response:
 *   { session: GatewaySession }
 */
sessionsRouter.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
	const userId = req.user?.sub;
	const { id } = req.params;

	if (!userId) {
		res.status(401).json({ error: { message: 'User not authenticated' } });
		return;
	}

	const session = sessions.get(id);

	if (!session) {
		res.status(404).json({ error: { message: 'Session not found' } });
		return;
	}

	// Verify ownership
	if (session.userId !== userId) {
		res.status(403).json({ error: { message: 'Access denied' } });
		return;
	}

	// Update activity timestamp
	touchSession(id);

	res.json({ session });
});

/**
 * DELETE /api/sessions/:id
 * Terminate a session.
 *
 * URL parameters:
 *   - id: Session ID to terminate
 *
 * Query parameters:
 *   - force: Force terminate even if session is active (default: false)
 *
 * Response:
 *   {
 *     success: boolean,
 *     message: string
 *   }
 */
sessionsRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
	const userId = req.user?.sub;
	const { id } = req.params;
	const force = req.query.force === 'true';

	if (!userId) {
		res.status(401).json({ error: { message: 'User not authenticated' } });
		return;
	}

	const session = sessions.get(id);

	if (!session) {
		res.status(404).json({ error: { message: 'Session not found' } });
		return;
	}

	// Verify ownership
	if (session.userId !== userId) {
		res.status(403).json({ error: { message: 'Access denied' } });
		return;
	}

	// Check if session is active and force is not set
	if (session.status === 'active' && !force) {
		res.status(409).json({
			error: {
				message: 'Cannot terminate active session without force flag',
				code: 'SESSION_ACTIVE',
			},
		});
		return;
	}

	// Remove session
	sessions.delete(id);

	res.json({
		success: true,
		message: 'Session terminated successfully',
	});
});

/**
 * GET /api/sessions/:id/health
 * Check the health status of a specific session.
 *
 * URL parameters:
 *   - id: Session ID to check
 *
 * Response:
 *   {
 *     sessionId: string,
 *     health: SessionHealth
 *   }
 */
sessionsRouter.get('/:id/health', async (req: AuthenticatedRequest, res: Response) => {
	const userId = req.user?.sub;
	const { id } = req.params;

	if (!userId) {
		res.status(401).json({ error: { message: 'User not authenticated' } });
		return;
	}

	const session = sessions.get(id);

	if (!session) {
		res.status(404).json({ error: { message: 'Session not found' } });
		return;
	}

	// Verify ownership
	if (session.userId !== userId) {
		res.status(403).json({ error: { message: 'Access denied' } });
		return;
	}

	// Update the extension health status
	const extensionConnected = await checkExtensionHealth();
	session.extension.connected = extensionConnected;
	session.extension.lastHealthCheck = new Date();

	// Update session status based on health
	if (!extensionConnected && session.status === 'active') {
		session.status = 'disconnected';
	} else if (extensionConnected && session.status === 'disconnected') {
		session.status = 'active';
	}

	// Calculate health metrics
	const health = await calculateSessionHealth(session);

	// Update activity timestamp
	touchSession(id);

	res.json({
		sessionId: id,
		health,
	});
});

/**
 * PATCH /api/sessions/:id
 * Update session metadata or status.
 *
 * URL parameters:
 *   - id: Session ID to update
 *
 * Request body:
 *   - status: New session status (optional)
 *   - metadata: Updated metadata (optional)
 *
 * Response:
 *   { session: GatewaySession }
 */
sessionsRouter.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
	const userId = req.user?.sub;
	const { id } = req.params;
	const { status, metadata } = req.body;

	if (!userId) {
		res.status(401).json({ error: { message: 'User not authenticated' } });
		return;
	}

	const session = sessions.get(id);

	if (!session) {
		res.status(404).json({ error: { message: 'Session not found' } });
		return;
	}

	// Verify ownership
	if (session.userId !== userId) {
		res.status(403).json({ error: { message: 'Access denied' } });
		return;
	}

	// Update status if provided and valid
	if (status && ['active', 'idle', 'disconnected', 'error'].includes(status)) {
		session.status = status as SessionStatus;
	}

	// Update metadata if provided
	if (metadata && typeof metadata === 'object') {
		session.metadata = {
			...session.metadata,
			...metadata,
		};
	}

	// Update activity timestamp
	session.lastActivityAt = new Date();

	res.json({ session });
});

// ============================================================================
// ADMIN / CLEANUP UTILITIES
// ============================================================================

/**
 * Clean up stale sessions (for internal use or scheduled jobs).
 * Removes sessions that have been idle for more than the specified duration.
 *
 * @param maxIdleMs Maximum idle time in milliseconds before session is considered stale
 * @returns Number of sessions cleaned up
 */
export function cleanupStaleSessions(maxIdleMs: number = 30 * 60 * 1000): number {
	const now = Date.now();
	let cleanedCount = 0;

	for (const [id, session] of sessions.entries()) {
		const idleTime = now - session.lastActivityAt.getTime();
		if (idleTime > maxIdleMs && session.status !== 'active') {
			sessions.delete(id);
			cleanedCount++;
		}
	}

	return cleanedCount;
}

/**
 * Get session statistics (for health endpoints or monitoring).
 */
export function getSessionStats(): {
	total: number;
	byStatus: Record<SessionStatus, number>;
	activeUsers: number;
} {
	const byStatus: Record<SessionStatus, number> = {
		active: 0,
		idle: 0,
		disconnected: 0,
		error: 0,
	};

	const activeUsers = new Set<string>();

	for (const session of sessions.values()) {
		byStatus[session.status]++;
		if (session.status === 'active') {
			activeUsers.add(session.userId);
		}
	}

	return {
		total: sessions.size,
		byStatus,
		activeUsers: activeUsers.size,
	};
}
