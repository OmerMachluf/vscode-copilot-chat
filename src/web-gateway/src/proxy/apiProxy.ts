/**
 * API Proxy for Web Gateway
 *
 * Proxies /api/* requests to the VS Code extension HTTP API server.
 * Handles SSE streaming, WebSocket upgrades, and error scenarios.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { createProxyMiddleware, fixRequestBody, Options } from 'http-proxy-middleware';
import type { IncomingMessage, ServerResponse, ClientRequest } from 'http';
import type { Socket } from 'net';

// Extension API configuration
const EXTENSION_API_HOST = '127.0.0.1';
const EXTENSION_API_PORT = 19847;
const EXTENSION_API_TARGET = `http://${EXTENSION_API_HOST}:${EXTENSION_API_PORT}`;

/**
 * Configuration options for the API proxy
 */
export interface ApiProxyConfig {
	/** Target URL for the extension API (default: http://127.0.0.1:19847) */
	target?: string;
	/** Whether to enable WebSocket proxying (default: true) */
	ws?: boolean;
	/** Custom logger function */
	logger?: (message: string, level: 'info' | 'warn' | 'error') => void;
}

/**
 * Default logger implementation
 */
const defaultLogger = (message: string, level: 'info' | 'warn' | 'error'): void => {
	const timestamp = new Date().toISOString();
	const prefix = `[ApiProxy][${timestamp}]`;
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
 * Creates the API proxy middleware that forwards requests to the extension API.
 *
 * Features:
 * - Proxies all /api/* routes to extension API on localhost:19847
 * - Handles SSE streaming with buffering disabled
 * - Supports WebSocket upgrade for real-time connections
 * - Returns 503 when extension API is unavailable
 * - Preserves headers and handles body parsing
 *
 * @param config - Optional configuration for the proxy
 * @returns Express middleware for proxying API requests
 */
export function createApiProxy(config: ApiProxyConfig = {}): ReturnType<typeof createProxyMiddleware> {
	const {
		target = EXTENSION_API_TARGET,
		ws = true,
		logger = defaultLogger,
	} = config;

	const proxyOptions: Options = {
		target,
		changeOrigin: true,

		// Enable WebSocket proxying for real-time features
		ws,

		// SSE/Streaming: Critical settings for proper SSE passthrough
		// - selfHandleResponse: false - let http-proxy handle piping the response
		// - Do NOT set headers in onProxyReq callback - for SSE, the target may
		//   start responding before the callback completes, causing crashes
		selfHandleResponse: false,

		/**
		 * Handle outgoing proxy request (http-proxy-middleware v2.x API)
		 *
		 * CRITICAL: fixRequestBody() internally calls proxyReq.setHeader('Content-Length', ...)
		 * which CRASHES for SSE requests because:
		 * 1. SSE endpoints respond immediately with streaming headers
		 * 2. The response can start flowing before onProxyReq completes
		 * 3. Calling setHeader() after headers are sent throws ERR_HTTP_HEADERS_SENT
		 *
		 * Solution: Skip fixRequestBody for SSE requests. SSE requests are typically
		 * GET requests without bodies, so there's nothing to fix anyway.
		 */
		onProxyReq: (proxyReq: ClientRequest, req: IncomingMessage, _res: ServerResponse) => {
			const acceptHeader = req.headers.accept || '';
			const isSSE = acceptHeader.includes('text/event-stream');

			// Only fix request body for non-SSE requests
			// fixRequestBody internally calls setHeader() which crashes SSE streams
			if (!isSSE) {
				fixRequestBody(proxyReq, req as Request);
			}

			logger(`Proxying ${req.method} ${req.url} -> ${target}${req.url}${isSSE ? ' (SSE)' : ''}`, 'info');
		},

		/**
		 * Handle incoming proxy response
		 * - Log SSE streams for debugging
		 *
		 * IMPORTANT: Do NOT call res.setHeader() here for SSE!
		 * With selfHandleResponse: false, http-proxy pipes the response directly.
		 * The SSE headers (Cache-Control, Connection, etc.) should be set by the
		 * upstream extension API server. Attempting to modify them here can race
		 * with the automatic piping and cause crashes.
		 */
		onProxyRes: (proxyRes: IncomingMessage, req: IncomingMessage, _res: ServerResponse) => {
			const contentType = proxyRes.headers['content-type'] || '';

			// Log SSE stream establishment for debugging
			if (contentType.includes('text/event-stream')) {
				logger(`SSE stream established for ${req.url}`, 'info');
			}

			logger(`Response ${proxyRes.statusCode} for ${req.method} ${req.url}`, 'info');
		},

		/**
		 * Handle proxy errors
		 * - Connection refused -> 503 Service Unavailable
		 * - Timeout -> 504 Gateway Timeout
		 * - Other errors -> 502 Bad Gateway
		 */
		onError: (err: Error, req: IncomingMessage, res: ServerResponse | Socket) => {
			const nodeErr = err as NodeJS.ErrnoException;

			logger(`Proxy error for ${req.method} ${req.url}: ${err.message}`, 'error');

			// Check if res is a Socket (WebSocket) or ServerResponse
			if (!('writeHead' in res)) {
				// It's a socket, just destroy it
				(res as Socket).destroy();
				return;
			}

			const serverRes = res as ServerResponse;

			// Check if response has already been sent
			if (serverRes.headersSent) {
				logger('Headers already sent, cannot send error response', 'warn');
				return;
			}

			// Determine appropriate status code based on error
			let statusCode = 502; // Bad Gateway
			let errorMessage = 'Proxy error occurred';
			let errorDetails = err.message;

			if (nodeErr.code === 'ECONNREFUSED' || nodeErr.code === 'ENOTFOUND') {
				// Extension API is not running
				statusCode = 503; // Service Unavailable
				errorMessage = 'VS Code extension API is unavailable';
				errorDetails = 'Make sure VS Code is running with the Copilot extension and the HTTP API server is enabled.';
			} else if (nodeErr.code === 'ETIMEDOUT' || nodeErr.code === 'ESOCKETTIMEDOUT') {
				// Request timed out
				statusCode = 504; // Gateway Timeout
				errorMessage = 'Request to extension API timed out';
				errorDetails = 'The extension API did not respond in time.';
			} else if (nodeErr.code === 'ECONNRESET') {
				// Connection was reset
				statusCode = 502;
				errorMessage = 'Connection to extension API was reset';
				errorDetails = 'The extension API closed the connection unexpectedly.';
			}

			serverRes.writeHead(statusCode, {
				'Content-Type': 'application/json',
			});

			serverRes.end(JSON.stringify({
				error: errorMessage,
				details: errorDetails,
				code: nodeErr.code,
				statusCode,
			}));
		},

		// Timeout configuration
		proxyTimeout: 120000, // 2 minutes for long-running operations
		timeout: 30000, // 30 seconds for initial connection

		// Headers configuration
		// IMPORTANT: Set custom headers here, NOT in onProxyReq callback!
		// For SSE streams, the target may start responding before onProxyReq
		// completes, causing setHeader() to crash.
		headers: {
			// Ensure host header matches target
			host: `${EXTENSION_API_HOST}:${EXTENSION_API_PORT}`,
			// Gateway identification header
			'X-Gateway-Proxy': 'web-gateway',
		},

		// Logging
		logLevel: 'warn',
		logProvider: () => ({
			log: (msg: string) => logger(msg, 'info'),
			debug: (msg: string) => logger(msg, 'info'),
			info: (msg: string) => logger(msg, 'info'),
			warn: (msg: string) => logger(msg, 'warn'),
			error: (msg: string) => logger(msg, 'error'),
		}),
	};

	return createProxyMiddleware(proxyOptions);
}

/**
 * Creates an Express router with the API proxy and auth middleware applied.
 *
 * @param authMiddleware - Authentication middleware to apply before proxying
 * @param config - Optional configuration for the proxy
 * @returns Express router with auth and proxy middleware
 */
export function createApiProxyRouter(
	authMiddleware: (req: Request, res: Response, next: NextFunction) => void,
	config: ApiProxyConfig = {},
): Router {
	const router = Router();
	const apiProxy = createApiProxy(config);

	// Apply auth middleware to all routes
	router.use(authMiddleware);

	// Apply proxy middleware
	router.use(apiProxy);

	return router;
}

/**
 * Middleware to check if the extension API is available.
 * Can be used for health checks without proxying the full request.
 */
export async function checkExtensionAvailability(
	target: string = EXTENSION_API_TARGET,
): Promise<{ available: boolean; error?: string }> {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 5000);

		const response = await fetch(`${target}/api/health`, {
			method: 'GET',
			signal: controller.signal,
		});

		clearTimeout(timeout);

		if (response.ok) {
			return { available: true };
		} else {
			return {
				available: false,
				error: `Extension API returned status ${response.status}`,
			};
		}
	} catch (error) {
		const err = error as Error;
		return {
			available: false,
			error: err.message || 'Failed to connect to extension API',
		};
	}
}

/**
 * Express middleware for checking extension availability.
 * Returns 503 if extension is not available.
 */
export function extensionHealthCheck(
	config: ApiProxyConfig = {},
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
	const target = config.target || EXTENSION_API_TARGET;
	const logger = config.logger || defaultLogger;

	return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		// Skip health check for the health endpoint itself to avoid recursion
		if (req.path === '/health' || req.path === '/api/health') {
			next();
			return;
		}

		const result = await checkExtensionAvailability(target);

		if (!result.available) {
			logger(`Extension unavailable: ${result.error}`, 'warn');
			res.status(503).json({
				error: 'VS Code extension API is unavailable',
				details: result.error,
				statusCode: 503,
			});
			return;
		}

		next();
	};
}

// Export constants for external use
export const API_PROXY_CONFIG = {
	host: EXTENSION_API_HOST,
	port: EXTENSION_API_PORT,
	target: EXTENSION_API_TARGET,
} as const;
