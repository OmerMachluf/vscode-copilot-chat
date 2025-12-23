import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer, Server as HttpServer } from 'http';
import cors from 'cors';
import { config } from './config';
import { authRouter } from './routes/auth';
import { launcherRouter } from './routes/launcher';
import { chatRouter } from './routes/chat';
import { orchestratorRouter } from './routes/orchestrator';
import { sessionsRouter } from './routes/sessions';
import { createApiProxy } from './proxy/apiProxy';
import { sseDetectorMiddleware, closeAllSSEConnections, getActiveSSEConnections } from './proxy/sseHandler';
import { initializeHub, getHub, shutdownHub, type WebSocketHub } from './websocket';
import { globalRateLimiter } from './middleware';

/**
 * Request logging middleware.
 * Logs method, URL, status code, and response time.
 */
function requestLogger(req: Request, res: Response, next: NextFunction): void {
	const start = Date.now();
	const { method, url } = req;

	res.on('finish', () => {
		const duration = Date.now() - start;
		const { statusCode } = res;
		console.log(`${method} ${url} ${statusCode} - ${duration}ms`);
	});

	next();
}

/**
 * Error handling middleware.
 * Catches all errors and returns a JSON response.
 */
function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
	console.error('Error:', err.message);

	const statusCode = res.statusCode !== 200 ? res.statusCode : 500;
	res.status(statusCode).json({
		error: {
			message: config.nodeEnv === 'production' ? 'Internal server error' : err.message,
			...(config.nodeEnv !== 'production' && { stack: err.stack }),
		},
	});
}

/**
 * Create and configure the Express application.
 */
export function createApp(): Express {
	const app = express();

	// Trust proxy for rate limiting behind reverse proxies
	app.set('trust proxy', 1);

	// Request logging
	if (config.enableLogging) {
		app.use(requestLogger);
	}

	// CORS configuration
	const corsOptions: cors.CorsOptions = {
		origin: config.corsOrigins.length > 0 ? config.corsOrigins : false, // false = same-origin only
		credentials: true,
		methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization'],
	};
	app.use(cors(corsOptions));

	// Body parsing
	app.use(express.json({ limit: '10mb' }));
	app.use(express.urlencoded({ extended: true }));

	// Global rate limiting: 1000 requests per minute per IP
	// See src/middleware/rateLimit.ts for route-specific limiters (chat, launcher)
	app.use(globalRateLimiter);

	// Health check endpoint (includes WebSocket and SSE status)
	app.get('/health', (_req: Request, res: Response) => {
		let wsStatus: { clients: number; extensionConnected: boolean; subscriptions: Record<string, number> } | undefined;
		try {
			const hub = getHub();
			wsStatus = {
				clients: hub.getClientCount(),
				extensionConnected: hub.isExtensionConnected(),
				subscriptions: hub.getSubscriptionStats(),
			};
		} catch {
			// Hub not initialized yet
		}

		// Get SSE connection statistics
		const sseStatus = getActiveSSEConnections();

		res.json({
			status: 'ok',
			timestamp: new Date().toISOString(),
			environment: config.nodeEnv,
			...(wsStatus && { websocket: wsStatus }),
			sse: {
				activeConnections: sseStatus.count,
				connections: sseStatus.connections,
			},
		});
	});

	// API info endpoint
	app.get('/api', (_req: Request, res: Response) => {
		res.json({
			name: 'VS Code Copilot Web Gateway',
			version: '0.1.0',
			description: 'Web Gateway API for controlling VS Code Copilot remotely',
		});
	});

	// Authentication routes
	app.use('/api/auth', authRouter);

	// Launcher routes (open files/folders in VS Code)
	app.use('/api/launcher', launcherRouter);

	// Chat session management routes
	app.use('/api/chat', chatRouter);

	// Orchestrator routes (plan and worker management)
	app.use('/api/orchestrator', orchestratorRouter);

	// Session management routes (gateway session tracking)
	app.use('/api/sessions', sessionsRouter);

	// SSE-specific handling middleware
	// This must come before the general proxy to ensure SSE requests get proper handling
	// with zero-buffering, appropriate timeouts, and health-aware routing
	const sseLogger = (msg: string, level: 'info' | 'warn' | 'error') => {
		if (config.enableLogging) {
			console.log(`[SSE] ${level.toUpperCase()}: ${msg}`);
		}
	};
	app.use('/api', sseDetectorMiddleware({
		target: config.extensionApiUrl,
		logger: sseLogger,
		enableHealthCheck: true,
		healthCheckTimeout: 5000,
	}));

	// Proxy all other /api/* requests to extension API
	// This forwards requests like /api/status, /api/chat, etc. to the VS Code extension
	const proxyLogger = (msg: string, level: string) => {
		if (config.enableLogging) {
			console.log(`[Proxy] ${level.toUpperCase()}: ${msg}`);
		}
	};
	app.use('/api', createApiProxy({
		target: config.extensionApiUrl,
		logger: proxyLogger,
	}));

	// WebSocket endpoint is handled separately via the WebSocket hub
	// See startServer() for WebSocket initialization on /ws path

	// 404 handler
	app.use((_req: Request, res: Response) => {
		res.status(404).json({ error: { message: 'Not found' } });
	});

	// Error handler (must be last)
	app.use(errorHandler);

	return app;
}

/**
 * Server instance holder for external access.
 */
let httpServer: HttpServer | null = null;
let wsHub: WebSocketHub | null = null;

/**
 * Start the server with WebSocket support.
 */
export function startServer(): HttpServer {
	const app = createApp();

	// Create HTTP server (needed for WebSocket upgrade)
	httpServer = createServer(app);

	// Initialize WebSocket hub
	const wsLogger = (msg: string, level = 'info') => {
		if (config.enableLogging) {
			console.log(`[WebSocket] ${level.toUpperCase()}: ${msg}`);
		}
	};

	wsHub = initializeHub(httpServer, {
		logger: wsLogger,
		// Extension WebSocket URL can be configured via environment
		extensionWsUrl: process.env.EXTENSION_WS_URL,
		path: '/ws',
	});

	httpServer.listen(config.port, () => {
		console.log(`
╔════════════════════════════════════════════════════════════╗
║         VS Code Copilot Web Gateway                        ║
╠════════════════════════════════════════════════════════════╣
║  Status:      Running                                      ║
║  Port:        ${String(config.port).padEnd(43)}║
║  Environment: ${config.nodeEnv.padEnd(43)}║
║  Logging:     ${String(config.enableLogging).padEnd(43)}║
║  WebSocket:   ws://localhost:${config.port}/ws${' '.repeat(27)}║
╚════════════════════════════════════════════════════════════╝
    `);

		if (config.nodeEnv === 'development') {
			console.log('Development mode - using default JWT secret');
			console.log(`Health check: http://localhost:${config.port}/health`);
			console.log(`API info:     http://localhost:${config.port}/api`);
			console.log(`WebSocket:    ws://localhost:${config.port}/ws`);
		}
	});

	// Handle graceful shutdown
	const shutdown = async () => {
		console.log('\nShutting down gracefully...');

		// Close all active SSE connections first
		await closeAllSSEConnections();

		// Close WebSocket hub
		await shutdownHub();

		// Close HTTP server
		if (httpServer) {
			httpServer.close(() => {
				console.log('Server closed');
				process.exit(0);
			});
		}
	};

	process.on('SIGTERM', shutdown);
	process.on('SIGINT', shutdown);

	return httpServer;
}

/**
 * Get the HTTP server instance.
 */
export function getServer(): HttpServer | null {
	return httpServer;
}

/**
 * Get the WebSocket hub instance.
 */
export function getWebSocketHub(): WebSocketHub | null {
	return wsHub;
}

// Start server if this is the main module
if (require.main === module) {
	startServer();
}
