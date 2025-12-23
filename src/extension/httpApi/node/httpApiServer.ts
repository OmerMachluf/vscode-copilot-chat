/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import express, { Express, Request, Response, NextFunction } from 'express';
import * as http from 'node:http';
import { ILogService } from '../../../platform/log/common/logService';
import { createServiceIdentifier } from '../../../util/common/services';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IAgentRunner } from '../../orchestrator/orchestratorInterfaces';
import { IOrchestratorService } from '../../orchestrator/orchestratorServiceV2';
import { handleChatRequest } from './routes/chatRoute';
import { OrchestratorRoute } from '../routes/orchestratorRoute';
import { WorkspacesRouteService } from '../routes/workspacesRoute';

const HTTP_API_PORT = 19847;

export interface IHttpApiServerConfig {
	readonly port: number;
	readonly host: string;
}

export const IHttpApiServer = createServiceIdentifier<IHttpApiServer>('IHttpApiServer');

export interface IHttpApiServer {
	readonly _serviceBrand: undefined;

	/**
	 * Start the HTTP API server
	 */
	start(): Promise<void>;

	/**
	 * Stop the HTTP API server
	 */
	stop(): Promise<void>;

	/**
	 * Get the current server configuration
	 */
	getConfig(): IHttpApiServerConfig;

	/**
	 * Check if the server is running
	 */
	isRunning(): boolean;
}

export class HttpApiServer extends Disposable implements IHttpApiServer {
	declare _serviceBrand: undefined;

	private readonly app: Express;
	private server: http.Server | undefined;
	private _isRunning = false;
	private readonly config: IHttpApiServerConfig;
	private readonly orchestratorRoute: OrchestratorRoute;
	private readonly workspacesService: WorkspacesRouteService;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IAgentRunner private readonly agentRunner: IAgentRunner,
		@IOrchestratorService private readonly orchestratorService: IOrchestratorService,
	) {
		super();
		this.config = {
			port: HTTP_API_PORT,
			host: '0.0.0.0' // Bind to all interfaces to allow WSL/Docker access
		};
		this.app = express();

		// Initialize route handlers
		this.orchestratorRoute = this._register(new OrchestratorRoute(orchestratorService, logService));
		this.workspacesService = new WorkspacesRouteService();

		this.setupMiddleware();
		this.setupRoutes();
	}

	private setupMiddleware(): void {
		// Parse JSON bodies
		this.app.use(express.json());

		// Enforce localhost-only access
		this.app.use(this.localhostOnlyMiddleware.bind(this));

		// Request logging
		this.app.use((req: Request, _res: Response, next: NextFunction) => {
			this.logService.trace(`[HttpApiServer] ${req.method} ${req.path}`);
			next();
		});
	}

	private localhostOnlyMiddleware(req: Request, res: Response, next: NextFunction): void {
		const remoteAddress = req.socket.remoteAddress;

		// Allow localhost connections (IPv4 and IPv6)
		const isLocalhost = remoteAddress === '127.0.0.1' ||
			remoteAddress === '::1' ||
			remoteAddress === '::ffff:127.0.0.1';

		// Allow private network connections (WSL, Docker, local network)
		// This allows: 10.x.x.x, 172.16-31.x.x, 192.168.x.x
		const isPrivateNetwork = remoteAddress && (
			remoteAddress.startsWith('10.') ||
			remoteAddress.startsWith('192.168.') ||
			/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(remoteAddress) ||
			remoteAddress.startsWith('::ffff:10.') ||
			remoteAddress.startsWith('::ffff:192.168.') ||
			/^::ffff:172\.(1[6-9]|2[0-9]|3[0-1])\./.test(remoteAddress)
		);

		if (!isLocalhost && !isPrivateNetwork) {
			this.logService.warn(`[HttpApiServer] Rejected non-local connection from ${remoteAddress}`);
			res.status(403).json({ error: 'Access denied: local connections only' });
			return;
		}

		next();
	}

	private setupRoutes(): void {
		// Health check endpoint
		this.app.get('/api/health', (_req: Request, res: Response) => {
			res.json({
				status: 'ok',
				timestamp: new Date().toISOString(),
				version: '1.0.0'
			});
		});

		// Status/connection endpoint for web gateway frontend
		this.app.get('/api/status', (_req: Request, res: Response) => {
			res.json({
				connected: true,
				extensionVersion: '1.0.0',
				timestamp: new Date().toISOString(),
				capabilities: {
					chat: true,
					orchestrator: true,
					workspaces: true,
					fileOperations: false
				}
			});
		});

		// Chat endpoint with SSE streaming
		this.app.post('/api/chat', (req: Request, res: Response) => {
			// Convert Express req/res to Node.js IncomingMessage/ServerResponse for the handler
			handleChatRequest(req, res, this.agentRunner, this.logService).catch(error => {
				this.logService.error(`[HttpApiServer] Chat request error: ${error.message}`);
				if (!res.headersSent) {
					res.status(500).json({ error: 'Internal server error' });
				}
			});
		});

		// Orchestrator routes - delegate to OrchestratorRoute handler
		this.app.all('/api/orchestrator/*', (req: Request, res: Response) => {
			this.orchestratorRoute.handleRequest(req, res).catch(error => {
				this.logService.error(`[HttpApiServer] Orchestrator request error: ${error.message}`);
				if (!res.headersSent) {
					res.status(500).json({ error: 'Internal server error' });
				}
			});
		});

		// Workspace routes
		this.app.get('/api/workspaces', (_req: Request, res: Response) => {
			try {
				const state = this.workspacesService.getWorkspaces();
				res.json({ success: true, data: state });
			} catch (error) {
				this.logService.error(`[HttpApiServer] Workspaces error: ${error}`);
				res.status(500).json({ success: false, error: 'Failed to get workspaces' });
			}
		});

		this.app.get('/api/workspaces/recent', async (_req: Request, res: Response) => {
			try {
				const recent = await this.workspacesService.getRecentWorkspaces();
				res.json({ success: true, data: recent });
			} catch (error) {
				this.logService.error(`[HttpApiServer] Recent workspaces error: ${error}`);
				res.status(500).json({ success: false, error: 'Failed to get recent workspaces' });
			}
		});

		this.app.post('/api/workspaces', async (req: Request, res: Response) => {
			try {
				const result = await this.workspacesService.openWorkspace(req.body);
				res.json({ success: true, data: result });
			} catch (error) {
				this.logService.error(`[HttpApiServer] Open workspace error: ${error}`);
				res.status(500).json({ success: false, error: 'Failed to open workspace' });
			}
		});
	}

	public async start(): Promise<void> {
		if (this._isRunning) {
			this.logService.warn('[HttpApiServer] Server is already running');
			return;
		}

		return new Promise((resolve, reject) => {
			try {
				this.server = this.app.listen(this.config.port, this.config.host, () => {
					this._isRunning = true;
					this.logService.info(`[HttpApiServer] Started on http://${this.config.host}:${this.config.port}`);
					resolve();
				});

				this.server.on('error', (error: NodeJS.ErrnoException) => {
					this._isRunning = false;
					if (error.code === 'EADDRINUSE') {
						this.logService.error(`[HttpApiServer] Port ${this.config.port} is already in use`);
					} else {
						this.logService.error(`[HttpApiServer] Failed to start: ${error.message}`);
					}
					reject(error);
				});
			} catch (error) {
				this._isRunning = false;
				reject(error);
			}
		});
	}

	public async stop(): Promise<void> {
		if (!this._isRunning || !this.server) {
			return;
		}

		return new Promise((resolve, reject) => {
			this.server!.close((error) => {
				this._isRunning = false;
				this.server = undefined;

				if (error) {
					this.logService.error(`[HttpApiServer] Error stopping server: ${error.message}`);
					reject(error);
				} else {
					this.logService.info('[HttpApiServer] Server stopped');
					resolve();
				}
			});
		});
	}

	public getConfig(): IHttpApiServerConfig {
		return { ...this.config };
	}

	public isRunning(): boolean {
		return this._isRunning;
	}

	public override dispose(): void {
		this.stop().catch(error => {
			this.logService.error(`[HttpApiServer] Error during disposal: ${error.message}`);
		});
		super.dispose();
	}
}
