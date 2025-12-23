/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState, useEffect, useCallback, useRef } from 'react';

export type EventChannel = 'chat' | 'orchestrator' | 'workers';

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface ServerEventMessage {
	type: 'event';
	channel: EventChannel;
	data: unknown;
}

interface ServerAckMessage {
	type: 'ack';
	action: 'subscribed' | 'unsubscribed';
	channels: EventChannel[];
}

interface ServerPongMessage {
	type: 'pong';
}

interface ServerErrorMessage {
	type: 'error';
	message: string;
}

type ServerMessage = ServerEventMessage | ServerAckMessage | ServerPongMessage | ServerErrorMessage;

export interface UseWebSocketOptions {
	/** Channels to subscribe to */
	channels?: EventChannel[];
	/** Auto-reconnect on disconnect (default: true) */
	autoReconnect?: boolean;
	/** Reconnect delay in ms (default: 3000) */
	reconnectDelay?: number;
	/** Max reconnect attempts (default: 10) */
	maxReconnectAttempts?: number;
	/** Heartbeat interval in ms (default: 25000) */
	heartbeatInterval?: number;
}

export interface UseWebSocketResult {
	/** Current connection status */
	status: WebSocketStatus;
	/** Whether the connection is open and ready */
	isConnected: boolean;
	/** Last error message if any */
	error: string | null;
	/** Subscribe to additional channels */
	subscribe: (channels: EventChannel[]) => void;
	/** Unsubscribe from channels */
	unsubscribe: (channels: EventChannel[]) => void;
	/** Currently subscribed channels */
	subscribedChannels: EventChannel[];
	/** Manually reconnect */
	reconnect: () => void;
	/** Disconnect */
	disconnect: () => void;
}

/**
 * Hook for managing WebSocket connection to the gateway.
 * Provides real-time event streaming with automatic reconnection.
 */
export function useWebSocket(
	onMessage: (channel: EventChannel, data: unknown) => void,
	options: UseWebSocketOptions = {}
): UseWebSocketResult {
	const {
		channels = [],
		autoReconnect = true,
		reconnectDelay = 3000,
		maxReconnectAttempts = 10,
		heartbeatInterval = 25000,
	} = options;

	const [status, setStatus] = useState<WebSocketStatus>('disconnected');
	const [error, setError] = useState<string | null>(null);
	const [subscribedChannels, setSubscribedChannels] = useState<EventChannel[]>([]);

	const wsRef = useRef<WebSocket | null>(null);
	const reconnectAttemptsRef = useRef(0);
	const reconnectTimeoutRef = useRef<number | null>(null);
	const heartbeatIntervalRef = useRef<number | null>(null);
	const pendingChannelsRef = useRef<EventChannel[]>(channels);
	const onMessageRef = useRef(onMessage);

	// Keep callback ref updated
	useEffect(() => {
		onMessageRef.current = onMessage;
	}, [onMessage]);

	const clearHeartbeat = useCallback(() => {
		if (heartbeatIntervalRef.current) {
			clearInterval(heartbeatIntervalRef.current);
			heartbeatIntervalRef.current = null;
		}
	}, []);

	const startHeartbeat = useCallback(() => {
		clearHeartbeat();
		heartbeatIntervalRef.current = window.setInterval(() => {
			if (wsRef.current?.readyState === WebSocket.OPEN) {
				wsRef.current.send(JSON.stringify({ type: 'ping' }));
			}
		}, heartbeatInterval);
	}, [clearHeartbeat, heartbeatInterval]);

	const handleMessage = useCallback((event: MessageEvent) => {
		try {
			const message = JSON.parse(event.data) as ServerMessage;

			switch (message.type) {
				case 'event':
					onMessageRef.current(message.channel, message.data);
					break;

				case 'ack':
					if (message.action === 'subscribed') {
						setSubscribedChannels(prev => [
							...new Set([...prev, ...message.channels])
						]);
					} else if (message.action === 'unsubscribed') {
						setSubscribedChannels(prev =>
							prev.filter(ch => !message.channels.includes(ch))
						);
					}
					break;

				case 'pong':
					// Heartbeat acknowledged
					break;

				case 'error':
					setError(message.message);
					break;
			}
		} catch (err) {
			console.error('Failed to parse WebSocket message:', err);
		}
	}, []);

	const connect = useCallback(() => {
		// Clean up existing connection
		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}

		// Clear any pending reconnect
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current);
			reconnectTimeoutRef.current = null;
		}

		setStatus('connecting');
		setError(null);

		// Build WebSocket URL
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const wsUrl = `${protocol}//${window.location.host}/ws`;

		try {
			const ws = new WebSocket(wsUrl);
			wsRef.current = ws;

			ws.onopen = () => {
				setStatus('connected');
				setError(null);
				reconnectAttemptsRef.current = 0;
				startHeartbeat();

				// Subscribe to pending channels
				if (pendingChannelsRef.current.length > 0) {
					ws.send(JSON.stringify({
						type: 'subscribe',
						channels: pendingChannelsRef.current,
					}));
				}
			};

			ws.onmessage = handleMessage;

			ws.onerror = () => {
				setError('WebSocket connection error');
				setStatus('error');
			};

			ws.onclose = () => {
				clearHeartbeat();
				setStatus('disconnected');
				setSubscribedChannels([]);

				// Auto-reconnect logic
				if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
					reconnectAttemptsRef.current++;
					const delay = Math.min(
						reconnectDelay * Math.pow(1.5, reconnectAttemptsRef.current - 1),
						30000
					);
					reconnectTimeoutRef.current = window.setTimeout(() => {
						connect();
					}, delay);
				}
			};
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to connect');
			setStatus('error');
		}
	}, [autoReconnect, maxReconnectAttempts, reconnectDelay, startHeartbeat, clearHeartbeat, handleMessage]);

	const disconnect = useCallback(() => {
		reconnectAttemptsRef.current = maxReconnectAttempts; // Prevent auto-reconnect
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current);
			reconnectTimeoutRef.current = null;
		}
		clearHeartbeat();
		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}
		setStatus('disconnected');
	}, [maxReconnectAttempts, clearHeartbeat]);

	const reconnect = useCallback(() => {
		reconnectAttemptsRef.current = 0;
		connect();
	}, [connect]);

	const subscribe = useCallback((newChannels: EventChannel[]) => {
		pendingChannelsRef.current = [...new Set([...pendingChannelsRef.current, ...newChannels])];

		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({
				type: 'subscribe',
				channels: newChannels,
			}));
		}
	}, []);

	const unsubscribe = useCallback((channelsToRemove: EventChannel[]) => {
		pendingChannelsRef.current = pendingChannelsRef.current.filter(
			ch => !channelsToRemove.includes(ch)
		);

		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({
				type: 'unsubscribe',
				channels: channelsToRemove,
			}));
		}
	}, []);

	// Connect on mount
	useEffect(() => {
		connect();

		return () => {
			disconnect();
		};
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	// Update pending channels when options change
	useEffect(() => {
		pendingChannelsRef.current = channels;
	}, [channels]);

	return {
		status,
		isConnected: status === 'connected',
		error,
		subscribe,
		unsubscribe,
		subscribedChannels,
		reconnect,
		disconnect,
	};
}
