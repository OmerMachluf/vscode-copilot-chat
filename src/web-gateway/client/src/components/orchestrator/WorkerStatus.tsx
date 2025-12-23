/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WorkerSessionState } from '@/types/orchestrator';

interface WorkerStatusProps {
	workers: WorkerSessionState[];
	connected: boolean;
}

type WorkerStatusType = WorkerSessionState['status'];

const statusColors: Record<WorkerStatusType, string> = {
	running: 'bg-green-500',
	paused: 'bg-yellow-500',
	idle: 'bg-gray-400',
	completed: 'bg-blue-500',
	failed: 'bg-red-500',
	waiting_approval: 'bg-orange-500',
};

const statusIcons: Record<WorkerStatusType, string> = {
	running: '▶',
	paused: '⏸',
	idle: '○',
	completed: '✓',
	failed: '✕',
	waiting_approval: '!',
};

export function WorkerStatus({ workers, connected }: WorkerStatusProps) {
	const formatLastActivity = (timestamp?: number) => {
		if (!timestamp) return 'Never';
		const diff = Date.now() - timestamp;
		if (diff < 60000) return 'Just now';
		if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
		return `${Math.floor(diff / 3600000)}h ago`;
	};

	const activeWorkers = workers.filter(w => w.status === 'running');
	const idleWorkers = workers.filter(w => w.status === 'idle');
	const waitingWorkers = workers.filter(w => w.status === 'waiting_approval');

	return (
		<div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
			{/* Header */}
			<div className="flex justify-between items-center p-4 border-b border-gray-200 bg-gray-50">
				<h2 className="text-lg font-semibold text-gray-900">
					Workers
					<span className="text-sm font-normal text-gray-500 ml-2">
						({activeWorkers.length} active{idleWorkers.length > 0 && `, ${idleWorkers.length} idle`}
						{waitingWorkers.length > 0 && `, ${waitingWorkers.length} waiting`})
					</span>
				</h2>
				<div className="flex items-center gap-2">
					<span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
					<span className={`text-xs ${connected ? 'text-green-600' : 'text-red-600'}`}>
						{connected ? 'Connected' : 'Disconnected'}
					</span>
				</div>
			</div>

			{/* Worker List */}
			<div className="max-h-[300px] overflow-y-auto">
				{workers.length === 0 ? (
					<div className="p-8 text-center text-gray-500">
						No active workers
					</div>
				) : (
					workers.map(worker => (
						<div key={worker.id} className="flex items-center p-3 border-b border-gray-100 last:border-b-0 gap-3">
							{/* Status Icon */}
							<div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-bold ${statusColors[worker.status]}`}>
								{statusIcons[worker.status]}
							</div>

							{/* Worker Info */}
							<div className="flex-1 min-w-0">
								<div className="font-mono text-sm text-gray-900">
									{worker.id.slice(0, 8)}
								</div>
								<div className="text-xs text-gray-500 truncate">
									Task: {worker.taskId.slice(0, 8)}
									{worker.branchName && ` • Branch: ${worker.branchName}`}
									{worker.modelId && ` • Model: ${worker.modelId}`}
								</div>
							</div>

							{/* Status Badge */}
							<span className={`px-2 py-0.5 text-xs text-white rounded whitespace-nowrap ${statusColors[worker.status]}`}>
								{worker.status.replace('_', ' ')}
							</span>

							{/* Last Activity */}
							<span className="text-xs text-gray-400 whitespace-nowrap">
								{formatLastActivity(worker.lastActivity)}
							</span>
						</div>
					))
				)}
			</div>
		</div>
	);
}
