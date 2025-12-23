/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { memo, useState, useCallback } from 'react';
import type { WebSocketStatus } from '@/hooks';
import type { ConnectionStatus } from '@/api';

export interface ConnectionIndicatorProps {
	/** HTTP connection status */
	httpStatus: ConnectionStatus | null;
	/** WebSocket connection status */
	wsStatus?: WebSocketStatus;
	/** Whether the WebSocket is connected */
	wsConnected?: boolean;
	/** Callback to reconnect WebSocket */
	onReconnect?: () => void;
	/** Callback to refresh HTTP status */
	onRefresh?: () => void;
	/** Show compact version */
	compact?: boolean;
}

interface StatusDotProps {
	status: 'connected' | 'connecting' | 'disconnected' | 'error';
	pulse?: boolean;
}

const StatusDot = memo(function StatusDot({ status, pulse = false }: StatusDotProps) {
	const colors = {
		connected: 'bg-green-500',
		connecting: 'bg-yellow-500',
		disconnected: 'bg-gray-400',
		error: 'bg-red-500',
	};

	return (
		<span
			className={`w-2 h-2 rounded-full ${colors[status]} ${pulse ? 'animate-pulse' : ''}`}
		/>
	);
});

export const ConnectionIndicator = memo(function ConnectionIndicator({
	httpStatus,
	wsStatus = 'disconnected',
	wsConnected = false,
	onReconnect,
	onRefresh,
	compact = false,
}: ConnectionIndicatorProps) {
	const [isExpanded, setIsExpanded] = useState(false);

	const getOverallStatus = useCallback((): 'connected' | 'connecting' | 'disconnected' | 'error' => {
		if (wsStatus === 'error' || httpStatus === null) {
			return 'error';
		}
		if (wsStatus === 'connecting') {
			return 'connecting';
		}
		if (wsConnected && httpStatus?.connected) {
			return 'connected';
		}
		return 'disconnected';
	}, [wsStatus, wsConnected, httpStatus]);

	const overallStatus = getOverallStatus();

	const statusLabels = {
		connected: 'Connected',
		connecting: 'Connecting...',
		disconnected: 'Disconnected',
		error: 'Connection Error',
	};

	if (compact) {
		return (
			<button
				onClick={() => setIsExpanded(!isExpanded)}
				className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
				title={statusLabels[overallStatus]}
			>
				<StatusDot status={overallStatus} pulse={overallStatus === 'connecting'} />
				<span className="text-sm text-gray-600">{statusLabels[overallStatus]}</span>
			</button>
		);
	}

	return (
		<div className="relative">
			<button
				onClick={() => setIsExpanded(!isExpanded)}
				className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200"
			>
				<StatusDot status={overallStatus} pulse={overallStatus === 'connecting'} />
				<span className="text-sm font-medium text-gray-700">
					{statusLabels[overallStatus]}
				</span>
				<svg
					className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
				</svg>
			</button>

			{isExpanded && (
				<div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
					<div className="p-4">
						<h3 className="text-sm font-semibold text-gray-900 mb-3">Connection Status</h3>

						<div className="space-y-3">
							{/* HTTP Status */}
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
									</svg>
									<span className="text-sm text-gray-600">Gateway API</span>
								</div>
								<div className="flex items-center gap-2">
									<StatusDot status={httpStatus?.connected ? 'connected' : 'disconnected'} />
									<span className="text-xs text-gray-500">
										{httpStatus?.connected ? 'Online' : 'Offline'}
									</span>
								</div>
							</div>

							{/* WebSocket Status */}
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
									</svg>
									<span className="text-sm text-gray-600">WebSocket</span>
								</div>
								<div className="flex items-center gap-2">
									<StatusDot
										status={wsStatus === 'connected' ? 'connected' : wsStatus === 'connecting' ? 'connecting' : wsStatus === 'error' ? 'error' : 'disconnected'}
										pulse={wsStatus === 'connecting'}
									/>
									<span className="text-xs text-gray-500 capitalize">{wsStatus}</span>
								</div>
							</div>

							{/* VS Code Extension */}
							{httpStatus && (
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2">
										<svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
										</svg>
										<span className="text-sm text-gray-600">VS Code</span>
									</div>
									<span className="text-xs text-gray-500">
										{httpStatus.vscodeVersion || 'Unknown'}
									</span>
								</div>
							)}

							{httpStatus?.extensionVersion && (
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2">
										<svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
										</svg>
										<span className="text-sm text-gray-600">Extension</span>
									</div>
									<span className="text-xs text-gray-500">
										v{httpStatus.extensionVersion}
									</span>
								</div>
							)}
						</div>

						{/* Actions */}
						<div className="mt-4 pt-3 border-t border-gray-100 flex gap-2">
							{onRefresh && (
								<button
									onClick={onRefresh}
									className="flex-1 px-3 py-1.5 text-sm text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
								>
									Refresh
								</button>
							)}
							{onReconnect && wsStatus !== 'connected' && (
								<button
									onClick={onReconnect}
									className="flex-1 px-3 py-1.5 text-sm text-white bg-primary-600 rounded hover:bg-primary-700 transition-colors"
								>
									Reconnect
								</button>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
});
