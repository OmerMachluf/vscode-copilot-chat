/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server as HttpServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { config } from '../config';

/**
 * Channel types that clients can subscribe to for real-time events.
 */
export type EventChannel = 'chat' | 'orchestrator' | 'workers';

/**
 * All valid channels that clients can subscribe to.
 */
export const VALID_CHANNELS: readonly EventChannel[] = ['chat', 'orchestrator', 'workers'] as const;

/**
 * Message sent from client to server to subscribe to channels.
 */
export interface ClientSubscribeMessage {
	type: 'subscribe';
	channels: EventChannel[];
}

/**
 * Message sent from client to server to unsubscribe from channels.
 */
export interface ClientUnsubscribeMessage {
	type: 'unsubscribe';
	channels: EventChannel[];
}

/**
 * Ping message for connection health checks.
 */
export interface ClientPingMessage {
	type: 'ping';
}

/**
 * Union of all client message types.
 */
export type ClientMessage = ClientSubscribeMessage | ClientUnsubscribeMessage | ClientPingMessage;

/**
 * Event sent from server to client.
 */
export interface ServerEventMessage {
	type: 'event';
	channel: EventChannel;
	data: unknown;
}

/**
 * Pong response to client ping.
 */
export interface ServerPongMessage {
	type: 'pong';
}

/**
 * Acknowledgment message sent after subscribe/unsubscribe.
 */
export interface ServerAckMessage {
	type: 'ack';
	action: 'subscribed' | 'unsubscribed';
	channels: EventChannel[];
}

/**
 * Error message sent when something goes wrong.
 */
export interface ServerErrorMessage {
	type: 'error';
	message: string;
}

/**
 * Union of all server message types.
 */
export type ServerMessage = ServerEventMessage | ServerPongMessage | ServerAckMessage | ServerErrorMessage;

/**
 * Client connection with its subscribed channels.
 */
interface ConnectedClient {
	ws: WebSocket;
	subscriptions: Set<EventChannel>;
	lastPing: number;
}

/**
 * Logger function type for hub logging.
 */
type LogFn = (message: string, level?: 'info' | 'warn' | 'error') => void;

/**
 * Options for configuring the WebSocket hub.
 */
export interface WebSocketHubOptions {
	/** Logger function for hub events */
	logger?: LogFn;
	/** Extension API URL for upstream events (optional) */
	extensionWsUrl?: string;
	/** Heartbeat interval in ms (default: 30000) */
	heartbeatIntervalMs?: number;
	/** Path for WebSocket endpoint (default: /ws) */
	path?: string;
}

/**
 * WebSocket Hub that maintains a single connection to extension events
 * and fans out to all connected browser clients.
 *
 * Architecture:
 * ```
 * [Extension] ---(events)---> [Hub] ---(fan-out)---> [Browser Client 1]
 *                                  \--(fan-out)---> [Browser Client 2]
 *                                   \-(fan-out)---> [Browser Client N]
 * ```
 */
export class WebSocketHub {
	private readonly wss: WebSocketServer;
	private readonly clients: Map<WebSocket, ConnectedClient> = new Map();
	private readonly logger: LogFn;
	private readonly heartbeatIntervalMs: number;

	private extensionWs: WebSocket | null = null;
	private extensionReconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private isShuttingDown = false;

	/**
	 * Create a new WebSocket hub.
	 * @param server HTTP server to attach WebSocket server to
	 * @param options Configuration options
	 */
	constructor(server: HttpServer, options: WebSocketHubOptions = {}) {
		this.logger = options.logger ?? ((msg, level = 'info') => {
			if (config.enableLogging) {
				console.log(`[WebSocketHub] ${level.toUpperCase()}: ${msg}`);
			}
		});

		this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30000;

		// Create WebSocket server
		this.wss = new WebSocketServer({
			server,
			path: options.path ?? '/ws',
		});

		this.setupServer();
		this.startHeartbeat();

		// Connect to extension if URL provided
		if (options.extensionWsUrl) {
			this.connectToExtension(options.extensionWsUrl);
		}

		this.logger('WebSocket hub initialized');
	}

	/**
	 * Set up WebSocket server event handlers.
	 */
	private setupServer(): void {
		this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
			this.handleClientConnection(ws, req);
		});

		this.wss.on('error', (error: Error) => {
			this.logger(`WebSocket server error: ${error.message}`, 'error');
		});
	}

	/**
	 * Handle a new client connection.
	 */
	private handleClientConnection(ws: WebSocket, req: IncomingMessage): void {
		const clientIp = req.socket.remoteAddress ?? 'unknown';
		this.logger(`Client connected from ${clientIp}`);

		// Register client with empty subscriptions
		const client: ConnectedClient = {
			ws,
			subscriptions: new Set(),
			lastPing: Date.now(),
		};
		this.clients.set(ws, client);

		// Set up client event handlers
		ws.on('message', (data: WebSocket.RawData) => {
			this.handleClientMessage(ws, data);
		});

		ws.on('close', () => {
			this.handleClientDisconnect(ws);
		});

		ws.on('error', (error: Error) => {
			this.logger(`Client error: ${error.message}`, 'error');
			this.handleClientDisconnect(ws);
		});
	}

	/**
	 * Handle a message from a connected client.
	 */
	private handleClientMessage(ws: WebSocket, data: WebSocket.RawData): void {
		const client = this.clients.get(ws);
		if (!client) {
			return;
		}

		// Update last activity
		client.lastPing = Date.now();

		try {
			const message = JSON.parse(data.toString()) as ClientMessage;

			switch (message.type) {
				case 'subscribe':
					this.handleSubscribe(client, message.channels);
					break;
				case 'unsubscribe':
					this.handleUnsubscribe(client, message.channels);
					break;
				case 'ping':
					this.sendToClient(ws, { type: 'pong' });
					break;
				default:
					this.sendToClient(ws, {
						type: 'error',
						message: `Unknown message type: ${(message as { type: string }).type}`,
					});
			}
		} catch (error) {
			this.logger(`Failed to parse client message: ${error}`, 'warn');
			this.sendToClient(ws, {
				type: 'error',
				message: 'Invalid message format. Expected JSON.',
			});
		}
	}

	/**
	 * Handle subscribe request from client.
	 */
	private handleSubscribe(client: ConnectedClient, channels: EventChannel[]): void {
		const validChannels: EventChannel[] = [];

		for (const channel of channels) {
			if (VALID_CHANNELS.includes(channel)) {
				client.subscriptions.add(channel);
				validChannels.push(channel);
			} else {
				this.logger(`Client tried to subscribe to invalid channel: ${channel}`, 'warn');
			}
		}

		if (validChannels.length > 0) {
			this.sendToClient(client.ws, {
				type: 'ack',
				action: 'subscribed',
				channels: validChannels,
			});
			this.logger(`Client subscribed to: ${validChannels.join(', ')}`);
		}
	}

	/**
	 * Handle unsubscribe request from client.
	 */
	private handleUnsubscribe(client: ConnectedClient, channels: EventChannel[]): void {
		const validChannels: EventChannel[] = [];

		for (const channel of channels) {
			if (client.subscriptions.has(channel)) {
				client.subscriptions.delete(channel);
				validChannels.push(channel);
			}
		}

		if (validChannels.length > 0) {
			this.sendToClient(client.ws, {
				type: 'ack',
				action: 'unsubscribed',
				channels: validChannels,
			});
			this.logger(`Client unsubscribed from: ${validChannels.join(', ')}`);
		}
	}

	/**
	 * Handle client disconnect.
	 */
	private handleClientDisconnect(ws: WebSocket): void {
		this.clients.delete(ws);
		this.logger('Client disconnected');

		// Ensure WebSocket is closed
		if (ws.readyState === WebSocket.OPEN) {
			ws.close();
		}
	}

	/**
	 * Send a message to a specific client.
	 */
	private sendToClient(ws: WebSocket, message: ServerMessage): void {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(message));
		}
	}

	/**
	 * Broadcast an event to all clients subscribed to a channel.
	 * @param channel Channel to broadcast on
	 * @param data Event data to send
	 */
	public broadcast(channel: EventChannel, data: unknown): void {
		const message: ServerEventMessage = {
			type: 'event',
			channel,
			data,
		};
		const messageStr = JSON.stringify(message);

		let sentCount = 0;
		for (const [ws, client] of this.clients) {
			if (client.subscriptions.has(channel) && ws.readyState === WebSocket.OPEN) {
				ws.send(messageStr);
				sentCount++;
			}
		}

		if (sentCount > 0) {
			this.logger(`Broadcast to ${sentCount} client(s) on channel: ${channel}`);
		}
	}

	/**
	 * Connect to the extension's WebSocket for upstream events.
	 */
	private connectToExtension(url: string): void {
		if (this.isShuttingDown) {
			return;
		}

		this.logger(`Connecting to extension at ${url}`);

		try {
			this.extensionWs = new WebSocket(url);

			this.extensionWs.on('open', () => {
				this.logger('Connected to extension WebSocket');

				// Subscribe to all channels from extension
				this.extensionWs?.send(JSON.stringify({
					type: 'subscribe',
					channels: [...VALID_CHANNELS],
				}));
			});

			this.extensionWs.on('message', (data: WebSocket.RawData) => {
				this.handleExtensionMessage(data);
			});

			this.extensionWs.on('close', () => {
				this.logger('Extension WebSocket closed', 'warn');
				this.extensionWs = null;
				this.scheduleExtensionReconnect(url);
			});

			this.extensionWs.on('error', (error: Error) => {
				this.logger(`Extension WebSocket error: ${error.message}`, 'error');
				// Close will be called after error, triggering reconnect
			});
		} catch (error) {
			this.logger(`Failed to connect to extension: ${error}`, 'error');
			this.scheduleExtensionReconnect(url);
		}
	}

	/**
	 * Handle message from extension WebSocket.
	 */
	private handleExtensionMessage(data: WebSocket.RawData): void {
		try {
			const message = JSON.parse(data.toString()) as ServerEventMessage;

			if (message.type === 'event' && VALID_CHANNELS.includes(message.channel)) {
				// Fan out to all subscribed clients
				this.broadcast(message.channel, message.data);
			}
		} catch (error) {
			this.logger(`Failed to parse extension message: ${error}`, 'warn');
		}
	}

	/**
	 * Schedule reconnection to extension WebSocket.
	 */
	private scheduleExtensionReconnect(url: string): void {
		if (this.isShuttingDown || this.extensionReconnectTimer) {
			return;
		}

		this.logger('Scheduling extension reconnect in 5 seconds');
		this.extensionReconnectTimer = setTimeout(() => {
			this.extensionReconnectTimer = null;
			this.connectToExtension(url);
		}, 5000);
	}

	/**
	 * Start heartbeat interval to clean up stale connections.
	 */
	private startHeartbeat(): void {
		this.heartbeatTimer = setInterval(() => {
			const now = Date.now();
			const staleThreshold = now - (this.heartbeatIntervalMs * 2);

			for (const [ws, client] of this.clients) {
				if (client.lastPing < staleThreshold) {
					this.logger('Closing stale client connection');
					ws.close();
					this.clients.delete(ws);
				} else if (ws.readyState === WebSocket.OPEN) {
					// Ping still-active clients to keep connection alive
					ws.ping();
				}
			}
		}, this.heartbeatIntervalMs);
	}

	/**
	 * Get the number of connected clients.
	 */
	public getClientCount(): number {
		return this.clients.size;
	}

	/**
	 * Get subscription counts by channel.
	 */
	public getSubscriptionStats(): Record<EventChannel, number> {
		const stats: Record<EventChannel, number> = {
			chat: 0,
			orchestrator: 0,
			workers: 0,
		};

		for (const client of this.clients.values()) {
			for (const channel of client.subscriptions) {
				stats[channel]++;
			}
		}

		return stats;
	}

	/**
	 * Check if connected to extension WebSocket.
	 */
	public isExtensionConnected(): boolean {
		return this.extensionWs !== null && this.extensionWs.readyState === WebSocket.OPEN;
	}

	/**
	 * Shut down the WebSocket hub gracefully.
	 */
	public async shutdown(): Promise<void> {
		this.isShuttingDown = true;
		this.logger('Shutting down WebSocket hub');

		// Clear timers
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
		if (this.extensionReconnectTimer) {
			clearTimeout(this.extensionReconnectTimer);
			this.extensionReconnectTimer = null;
		}

		// Close extension connection
		if (this.extensionWs) {
			this.extensionWs.close();
			this.extensionWs = null;
		}

		// Close all client connections
		for (const ws of this.clients.keys()) {
			ws.close(1000, 'Server shutting down');
		}
		this.clients.clear();

		// Close WebSocket server
		await new Promise<void>((resolve) => {
			this.wss.close(() => {
				this.logger('WebSocket server closed');
				resolve();
			});
		});
	}
}

/**
 * Singleton instance for the global hub.
 */
let hubInstance: WebSocketHub | null = null;

/**
 * Initialize the global WebSocket hub.
 * Should be called once when the HTTP server starts.
 */
export function initializeHub(server: HttpServer, options?: WebSocketHubOptions): WebSocketHub {
	if (hubInstance) {
		throw new Error('WebSocket hub already initialized');
	}
	hubInstance = new WebSocketHub(server, options);
	return hubInstance;
}

/**
 * Get the global WebSocket hub instance.
 * Throws if not initialized.
 */
export function getHub(): WebSocketHub {
	if (!hubInstance) {
		throw new Error('WebSocket hub not initialized. Call initializeHub first.');
	}
	return hubInstance;
}

/**
 * Shutdown the global WebSocket hub.
 */
export async function shutdownHub(): Promise<void> {
	if (hubInstance) {
		await hubInstance.shutdown();
		hubInstance = null;
	}
}
