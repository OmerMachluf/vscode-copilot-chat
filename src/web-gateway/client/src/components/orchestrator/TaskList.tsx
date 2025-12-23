/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState } from 'react';
import type { WorkerTask, TaskStatus, TaskPriority } from '@/types/orchestrator';

interface TaskListProps {
	tasks: WorkerTask[];
	onDeploy: (taskId: string) => void;
	onComplete: (taskId: string) => void;
	onCancel: (taskId: string, remove?: boolean) => void;
	onRetry: (taskId: string) => void;
}

const statusColors: Record<TaskStatus, string> = {
	pending: 'bg-gray-500',
	queued: 'bg-purple-500',
	running: 'bg-blue-500',
	completed: 'bg-green-500',
	failed: 'bg-red-500',
	blocked: 'bg-orange-500',
};

const priorityColors: Record<TaskPriority, string> = {
	critical: 'bg-red-600',
	high: 'bg-orange-500',
	normal: 'bg-blue-500',
	low: 'bg-gray-400',
};

export function TaskList({
	tasks,
	onDeploy,
	onComplete,
	onCancel,
	onRetry,
}: TaskListProps) {
	const [filter, setFilter] = useState<TaskStatus | 'all'>('all');
	const [sortBy, setSortBy] = useState<'priority' | 'status' | 'name'>('priority');

	const priorityOrder: Record<TaskPriority, number> = {
		critical: 0,
		high: 1,
		normal: 2,
		low: 3,
	};

	const statusOrder: Record<TaskStatus, number> = {
		running: 0,
		queued: 1,
		pending: 2,
		blocked: 3,
		failed: 4,
		completed: 5,
	};

	const filteredTasks = tasks.filter(task =>
		filter === 'all' || task.status === filter
	);

	const sortedTasks = [...filteredTasks].sort((a, b) => {
		switch (sortBy) {
			case 'priority':
				return priorityOrder[a.priority] - priorityOrder[b.priority];
			case 'status':
				return statusOrder[a.status] - statusOrder[b.status];
			case 'name':
				return a.name.localeCompare(b.name);
			default:
				return 0;
		}
	});

	const canDeploy = (task: WorkerTask) =>
		task.status === 'pending' || task.status === 'queued';

	const canComplete = (task: WorkerTask) =>
		task.status === 'running';

	const canCancel = (task: WorkerTask) =>
		task.status !== 'completed' && task.status !== 'failed';

	const canRetry = (task: WorkerTask) =>
		task.status === 'failed';

	return (
		<div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
			{/* Header */}
			<div className="flex justify-between items-center p-4 border-b border-gray-200 bg-gray-50">
				<h2 className="text-lg font-semibold text-gray-900">Tasks</h2>
				<div className="flex gap-3">
					<select
						value={filter}
						onChange={e => setFilter(e.target.value as TaskStatus | 'all')}
						className="px-3 py-1 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
					>
						<option value="all">All Status</option>
						<option value="pending">Pending</option>
						<option value="queued">Queued</option>
						<option value="running">Running</option>
						<option value="completed">Completed</option>
						<option value="failed">Failed</option>
						<option value="blocked">Blocked</option>
					</select>
					<select
						value={sortBy}
						onChange={e => setSortBy(e.target.value as 'priority' | 'status' | 'name')}
						className="px-3 py-1 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
					>
						<option value="priority">Sort by Priority</option>
						<option value="status">Sort by Status</option>
						<option value="name">Sort by Name</option>
					</select>
				</div>
			</div>

			{/* Task List */}
			<div className="max-h-[500px] overflow-y-auto">
				{sortedTasks.length === 0 ? (
					<div className="p-8 text-center text-gray-500">
						No tasks found
					</div>
				) : (
					sortedTasks.map(task => (
						<div key={task.id} className="flex items-center p-3 border-b border-gray-100 last:border-b-0 gap-3">
							{/* Task Info */}
							<div className="flex-1 min-w-0">
								<div className="font-medium text-gray-900 truncate">
									{task.name}
								</div>
								<div className="text-sm text-gray-500 truncate">
									{task.description}
								</div>
							</div>

							{/* Priority Badge */}
							<span className={`px-2 py-0.5 text-xs text-white rounded whitespace-nowrap ${priorityColors[task.priority]}`}>
								{task.priority}
							</span>

							{/* Status Badge */}
							<span className={`px-2 py-0.5 text-xs text-white rounded whitespace-nowrap ${statusColors[task.status]}`}>
								{task.status}
							</span>

							{/* Actions */}
							<div className="flex gap-1">
								{canDeploy(task) && (
									<button
										onClick={() => onDeploy(task.id)}
										className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
									>
										Deploy
									</button>
								)}
								{canComplete(task) && (
									<button
										onClick={() => onComplete(task.id)}
										className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
									>
										Complete
									</button>
								)}
								{canRetry(task) && (
									<button
										onClick={() => onRetry(task.id)}
										className="px-2 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600"
									>
										Retry
									</button>
								)}
								{canCancel(task) && (
									<button
										onClick={() => onCancel(task.id)}
										className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
									>
										Cancel
									</button>
								)}
							</div>
						</div>
					))
				)}
			</div>
		</div>
	);
}
