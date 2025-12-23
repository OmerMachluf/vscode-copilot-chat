/**
 * SSE (Server-Sent Events) Handler for Web Gateway
 *
 * Provides specialized handling for SSE streams with:
 * - Zero-buffering passthrough for real-time streaming
 * - Route-specific timeout configuration (2 min for chat, 30s for others)
 * - Health-aware routing with automatic failover
 * - Proper connection lifecycle management
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import http from 'http';
import { checkExtensionAvailability } from './apiProxy';

/**
 * Configuration for SSE handler
 */
export interface SSEHandlerConfig {
	/** Target URL for the extension API (default: http://127.0.0.1:19847) */
	target: string;
	/** Custom logger function */
	logger?: (message: string, level: 'info' | 'warn' | 'error') => void;
	/** Enable health checks before establishing SSE connections (default: true) */
	enableHealthCheck?: boolean;
	/** Health check timeout in ms (default: 5000) */
	healthCheckTimeout?: number;
}

/**
 * Timeout configuration for different SSE route types
 */
export interface SSETimeoutConfig {
	/** Timeout for chat-related SSE streams in ms (default: 120000 = 2 minutes) */
	chatTimeout: number;
	/** Timeout for other SSE streams in ms (default: 30000 = 30 seconds) */
	defaultTimeout: number;
}

/**
 * Default timeout configuration
 */
export const DEFAULT_SSE_TIMEOUTS: SSETimeoutConfig = {
	chatTimeout: 120000, // 2 minutes for chat operations (LLM responses can be slow)
	defaultTimeout: 30000, // 30 seconds for other SSE streams
};

/**
 * SSE route patterns that should use extended timeouts
 */
const CHAT_ROUTE_PATTERNS = [
	/\/api\/sessions\/[^/]+\/chat/,
	/\/api\/chat/,
	/\/api\/orchestrator\/.*\/stream/,
	/\/api\/agents\/.*\/stream/,
];

/**
 * Default logger implementation
 */
const defaultLogger = (message: string, level: 'info' | 'warn' | 'error'): void => {
	const timestamp = new Date().toISOString();
	const prefix = `[SSEHandler][${timestamp}]`;
	switch (level) {
		case 'error':
			console.error(`${prefix} ERROR: ${message}`);
			break;
		case 'warn':
			console.warn(`${prefix} WARN: ${message}`);
			break;
		default:
			console.log(`${prefix} INFO: ${message}`);
	}
};

/**
 * Determines if a request URL is a chat-related route that needs extended timeout
 */
export function isChatRoute(url: string): boolean {
	return CHAT_ROUTE_PATTERNS.some(pattern => pattern.test(url));
}

/**
 * Gets the appropriate timeout for a given SSE request
 */
export function getSSETimeout(url: string, config: SSETimeoutConfig = DEFAULT_SSE_TIMEOUTS): number {
	return isChatRoute(url) ? config.chatTimeout : config.defaultTimeout;
}

/**
 * Parses target URL into host and port
 */
function parseTarget(target: string): { host: string; port: number; protocol: string } {
	const url = new URL(target);
	return {
		host: url.hostname,
		port: parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : 80),
		protocol: url.protocol,
	};
}

/**
 * SSE connection state for tracking active streams
 */
interface SSEConnection {
	id: string;
	startTime: number;
	url: string;
	clientRes: Response;
	proxyReq?: http.ClientRequest;
}

/**
 * Active SSE connections tracker
 */
const activeConnections = new Map<string, SSEConnection>();

/**
 * Generates a unique connection ID
 */
function generateConnectionId(): string {
	return `sse-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Gets statistics about active SSE connections
 */
export function getActiveSSEConnections(): {
	count: number;
	connections: Array<{ id: string; url: string; duration: number }>;
} {
	const now = Date.now();
	const connections = Array.from(activeConnections.values()).map(conn => ({
		id: conn.id,
		url: conn.url,
		duration: now - conn.startTime,
	}));
	return { count: connections.length, connections };
}

/**
 * Creates an SSE handler middleware for a specific route pattern
 *
 * This handler provides:
 * - Direct passthrough without buffering for real-time streaming
 * - Proper SSE headers (Content-Type, Cache-Control, Connection)
 * - Health-aware routing with 503 response if backend unavailable
 * - Route-specific timeouts (2 min for chat, 30s for others)
 * - Connection tracking and cleanup
 *
 * @param handlerConfig - Configuration for the SSE handler
 * @param timeoutConfig - Optional timeout configuration
 * @returns Express middleware for handling SSE requests
 */
export function createSSEHandler(
	handlerConfig: SSEHandlerConfig,
	timeoutConfig: SSETimeoutConfig = DEFAULT_SSE_TIMEOUTS,
): RequestHandler {
	const {
		target,
		logger = defaultLogger,
		enableHealthCheck = true,
		healthCheckTimeout = 5000,
	} = handlerConfig;

	const { host, port, protocol } = parseTarget(target);
	const useHttps = protocol === 'https:';

	return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		// Check if this request accepts SSE
		const acceptHeader = req.headers.accept || '';
		if (!acceptHeader.includes('text/event-stream')) {
			// Not an SSE request, pass to next handler
			next();
			return;
		}

		const connectionId = generateConnectionId();
		const url = req.originalUrl || req.url;
		const timeout = getSSETimeout(url, timeoutConfig);

		logger(`SSE request started: ${url} (timeout: ${timeout}ms)`, 'info');

		// Health check before establishing connection
		if (enableHealthCheck) {
			const health = await checkExtensionAvailability(target);
			if (!health.available) {
				logger(`SSE connection rejected - backend unavailable: ${health.error}`, 'warn');
				res.status(503).json({
					error: 'VS Code extension API is unavailable',
					details: health.error,
					statusCode: 503,
				});
				return;
			}
		}

		// Set SSE response headers immediately to prevent buffering
		res.setHeader('Content-Type', 'text/event-stream');
		res.setHeader('Cache-Control', 'no-cache, no-transform');
		res.setHeader('Connection', 'keep-alive');
		res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
		res.setHeader('X-SSE-Connection-Id', connectionId);

		// Disable compression for SSE (can cause buffering)
		res.setHeader('Content-Encoding', 'identity');

		// Flush headers immediately
		res.flushHeaders();

		// Track this connection
		const connection: SSEConnection = {
			id: connectionId,
			startTime: Date.now(),
			url,
			clientRes: res,
		};
		activeConnections.set(connectionId, connection);

		// Build proxy request options
		// Build headers, excluding those that shouldn't be forwarded
		const forwardHeaders: http.OutgoingHttpHeaders = {
			...req.headers,
			host: `${host}:${port}`,
			'accept': 'text/event-stream',
			'x-gateway-proxy': 'web-gateway',
			'x-sse-connection-id': connectionId,
		};
		// Remove headers that shouldn't be forwarded
		delete forwardHeaders['connection'];
		delete forwardHeaders['content-length'];

		const proxyOptions: http.RequestOptions = {
			hostname: host,
			port,
			path: url,
			method: req.method,
			headers: forwardHeaders,
			timeout,
		};

		// Create the proxy request
		const httpModule = useHttps ? require('https') : http;
		const proxyReq = httpModule.request(proxyOptions, (proxyRes: http.IncomingMessage) => {
			logger(`SSE proxy response: ${proxyRes.statusCode} for ${url}`, 'info');

			// If backend returns non-200, forward the error
			if (proxyRes.statusCode !== 200) {
				let body = '';
				proxyRes.on('data', (chunk: Buffer) => {
					body += chunk.toString();
				});
				proxyRes.on('end', () => {
					cleanup('backend-error');
					try {
						const error = JSON.parse(body);
						res.status(proxyRes.statusCode || 500).json(error);
					} catch {
						res.status(proxyRes.statusCode || 500).json({
							error: 'Backend error',
							details: body || 'Unknown error',
						});
					}
				});
				return;
			}

			// Stream SSE data directly to client without buffering
			proxyRes.on('data', (chunk: Buffer) => {
				if (!res.writableEnded) {
					res.write(chunk);
					// Force flush to prevent Node.js buffering
					if (typeof (res as any).flush === 'function') {
						(res as any).flush();
					}
				}
			});

			proxyRes.on('end', () => {
				logger(`SSE stream ended: ${url}`, 'info');
				cleanup('complete');
				if (!res.writableEnded) {
					res.end();
				}
			});

			proxyRes.on('error', (err: Error) => {
				logger(`SSE proxy response error: ${err.message}`, 'error');
				cleanup('response-error');
				if (!res.writableEnded) {
					// Send SSE error event before closing
					res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
					res.end();
				}
			});
		});

		connection.proxyReq = proxyReq;

		// Cleanup function
		const cleanup = (reason: string): void => {
			logger(`SSE connection cleanup: ${connectionId} (${reason})`, 'info');
			activeConnections.delete(connectionId);
			if (proxyReq && !proxyReq.destroyed) {
				proxyReq.destroy();
			}
		};

		// Handle client disconnect
		req.on('close', () => {
			logger(`Client disconnected: ${connectionId}`, 'info');
			cleanup('client-disconnect');
		});

		res.on('close', () => {
			cleanup('response-close');
		});

		// Handle proxy request errors
		proxyReq.on('error', (err: NodeJS.ErrnoException) => {
			logger(`SSE proxy request error: ${err.message}`, 'error');
			cleanup('request-error');

			if (res.headersSent) {
				// Headers already sent, send SSE error event
				if (!res.writableEnded) {
					res.write(`event: error\ndata: ${JSON.stringify({
						error: 'Connection error',
						code: err.code,
						details: err.message,
					})}\n\n`);
					res.end();
				}
			} else {
				// Can still send HTTP error response
				let statusCode = 502;
				let errorMessage = 'Proxy error occurred';

				if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
					statusCode = 503;
					errorMessage = 'VS Code extension API is unavailable';
				} else if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
					statusCode = 504;
					errorMessage = 'Request to extension API timed out';
				}

				res.status(statusCode).json({
					error: errorMessage,
					code: err.code,
					statusCode,
				});
			}
		});

		// Handle timeout
		proxyReq.on('timeout', () => {
			logger(`SSE proxy timeout: ${connectionId} (${timeout}ms)`, 'warn');
			cleanup('timeout');
			proxyReq.destroy(new Error('SSE connection timeout'));

			if (!res.headersSent) {
				res.status(504).json({
					error: 'SSE connection timeout',
					timeout,
					statusCode: 504,
				});
			} else if (!res.writableEnded) {
				res.write(`event: error\ndata: ${JSON.stringify({ error: 'Connection timeout', timeout })}\n\n`);
				res.end();
			}
		});

		// Forward request body if present
		// CRITICAL: setHeader() must be called BEFORE write() - calling it after
		// will crash with "Cannot set headers after they are sent"
		if (req.body && Object.keys(req.body).length > 0) {
			const bodyData = JSON.stringify(req.body);
			// Set headers first, before writing any body data
			proxyReq.setHeader('Content-Type', 'application/json');
			proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
			// Now safe to write the body
			proxyReq.write(bodyData);
		}

		proxyReq.end();
	};
}

/**
 * Creates a health-aware SSE router that checks backend availability
 * before establishing connections
 *
 * @param config - SSE handler configuration
 * @returns Express middleware
 */
export function createHealthAwareSSEHandler(
	config: SSEHandlerConfig,
): RequestHandler {
	return createSSEHandler({
		...config,
		enableHealthCheck: true,
	});
}

/**
 * Middleware that detects SSE requests and routes them to the SSE handler
 *
 * Use this as a catch-all SSE detector that can be placed before the regular
 * proxy middleware to ensure SSE requests get proper handling.
 *
 * @param config - SSE handler configuration
 * @returns Express middleware
 */
export function sseDetectorMiddleware(
	config: SSEHandlerConfig,
): RequestHandler {
	const sseHandler = createSSEHandler(config);

	return (req: Request, res: Response, next: NextFunction): void => {
		const acceptHeader = req.headers.accept || '';
		if (acceptHeader.includes('text/event-stream')) {
			// This is an SSE request, handle it specially
			sseHandler(req, res, next);
		} else {
			// Not SSE, continue to next middleware
			next();
		}
	};
}

/**
 * Gracefully closes all active SSE connections
 * Call this during server shutdown
 */
export async function closeAllSSEConnections(): Promise<void> {
	const connections = Array.from(activeConnections.values());
	const logger = defaultLogger;

	logger(`Closing ${connections.length} active SSE connections`, 'info');

	for (const conn of connections) {
		try {
			if (conn.proxyReq && !conn.proxyReq.destroyed) {
				conn.proxyReq.destroy();
			}
			if (!conn.clientRes.writableEnded) {
				// Send a close event before ending
				conn.clientRes.write('event: close\ndata: Server shutting down\n\n');
				conn.clientRes.end();
			}
		} catch (err) {
			logger(`Error closing connection ${conn.id}: ${(err as Error).message}`, 'error');
		}
	}

	activeConnections.clear();
}
