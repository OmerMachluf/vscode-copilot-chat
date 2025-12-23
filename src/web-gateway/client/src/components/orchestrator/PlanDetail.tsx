/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMemo, useState } from 'react';
import type {
	OrchestratorPlan,
	WorkerTask,
	WorkerSessionState,
	TaskStatus,
	CreateTaskRequest,
} from '@/types/orchestrator';

interface PlanDetailProps {
	plan: OrchestratorPlan;
	tasks: WorkerTask[];
	workers: WorkerSessionState[];
	onDeployTask: (taskId: string) => void;
	onCompleteTask: (taskId: string) => void;
	onCancelTask: (taskId: string, remove?: boolean) => void;
	onRetryTask: (taskId: string) => void;
	onCreateTask: (request: CreateTaskRequest) => Promise<void>;
}

interface TaskNode {
	task: WorkerTask;
	x: number;
	y: number;
}

const statusColors: Record<TaskStatus, string> = {
	pending: 'bg-gray-500',
	queued: 'bg-purple-500',
	running: 'bg-blue-500',
	completed: 'bg-green-500',
	failed: 'bg-red-500',
	blocked: 'bg-orange-500',
};

const statusBorderColors: Record<TaskStatus, string> = {
	pending: 'border-gray-400',
	queued: 'border-purple-400',
	running: 'border-blue-400',
	completed: 'border-green-400',
	failed: 'border-red-400',
	blocked: 'border-orange-400',
};

const statusLabels: Record<TaskStatus, string> = {
	pending: 'Pending',
	queued: 'Queued',
	running: 'Running',
	completed: 'Completed',
	failed: 'Failed',
	blocked: 'Blocked',
};

export function PlanDetail({
	plan,
	tasks,
	workers,
	onDeployTask,
	onCompleteTask,
	onCancelTask,
	onRetryTask,
	onCreateTask,
}: PlanDetailProps) {
	const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph');
	const [showAddTask, setShowAddTask] = useState(false);
	const [newTask, setNewTask] = useState<CreateTaskRequest>({
		description: '',
		name: '',
		priority: 'normal',
		planId: plan.id,
	});
	const [creating, setCreating] = useState(false);

	// Build task graph for visualization
	const { nodes, graphWidth, graphHeight } = useMemo(() => {
		const nodeWidth = 200;
		const nodeHeight = 80;
		const horizontalGap = 80;
		const verticalGap = 40;
		const startX = 40;
		const startY = 40;

		// Group tasks by their dependency depth (column)
		const getDepth = (taskId: string, visited = new Set<string>()): number => {
			if (visited.has(taskId)) return 0;
			visited.add(taskId);

			const task = tasks.find(t => t.id === taskId);
			if (!task || task.dependencies.length === 0) return 0;

			return 1 + Math.max(...task.dependencies.map(depId => getDepth(depId, visited)));
		};

		const depthGroups = new Map<number, WorkerTask[]>();
		tasks.forEach(task => {
			const depth = getDepth(task.id);
			if (!depthGroups.has(depth)) {
				depthGroups.set(depth, []);
			}
			depthGroups.get(depth)!.push(task);
		});

		const nodeList: TaskNode[] = [];
		depthGroups.forEach((groupTasks, depth) => {
			groupTasks.forEach((task, index) => {
				nodeList.push({
					task,
					x: startX + depth * (nodeWidth + horizontalGap),
					y: startY + index * (nodeHeight + verticalGap),
				});
			});
		});

		const width = Math.max(600, nodeList.length > 0 ? Math.max(...nodeList.map(n => n.x)) + 280 : 600);
		const height = Math.max(400, nodeList.length > 0 ? Math.max(...nodeList.map(n => n.y)) + 120 : 400);

		return { nodes: nodeList, graphWidth: width, graphHeight: height };
	}, [tasks]);

	const canDeploy = (task: WorkerTask) =>
		task.status === 'pending' || task.status === 'queued';

	const canComplete = (task: WorkerTask) =>
		task.status === 'running';

	const canCancel = (task: WorkerTask) =>
		task.status !== 'completed' && task.status !== 'failed';

	const canRetry = (task: WorkerTask) =>
		task.status === 'failed';

	const getWorkerForTask = (taskId: string) =>
		workers.find(w => w.taskId === taskId);

	const handleCreateTask = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!newTask.description.trim()) return;

		setCreating(true);
		try {
			await onCreateTask({
				...newTask,
				description: newTask.description.trim(),
				name: newTask.name?.trim() || undefined,
				planId: plan.id,
			});
			setNewTask({
				description: '',
				name: '',
				priority: 'normal',
				planId: plan.id,
			});
			setShowAddTask(false);
		} catch {
			// Error handled by hook
		} finally {
			setCreating(false);
		}
	};

	const pendingCount = tasks.filter(t => t.status === 'pending' || t.status === 'queued').length;
	const runningCount = tasks.filter(t => t.status === 'running').length;
	const completedCount = tasks.filter(t => t.status === 'completed').length;
	const failedCount = tasks.filter(t => t.status === 'failed').length;

	const planStatusColor = plan.status === 'active' ? 'bg-green-500'
		: plan.status === 'completed' ? 'bg-blue-500'
			: plan.status === 'failed' ? 'bg-red-500'
				: plan.status === 'paused' ? 'bg-yellow-500'
					: 'bg-gray-500';

	return (
		<div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
			{/* Header */}
			<div className="p-4 border-b border-gray-200 bg-gray-50">
				<div className="flex justify-between items-start mb-3">
					<div className="flex-1">
						<h2 className="text-xl font-semibold text-gray-900 mb-1">{plan.name}</h2>
						<p className="text-sm text-gray-600">{plan.description}</p>
					</div>
					<div className="flex items-center gap-3">
						<span className={`px-3 py-1 text-xs font-medium text-white rounded-full ${planStatusColor}`}>
							{plan.status}
						</span>
						<div className="flex border border-gray-300 rounded overflow-hidden">
							<button
								onClick={() => setViewMode('graph')}
								className={`px-3 py-1 text-xs font-medium transition-colors ${
									viewMode === 'graph' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
								}`}
							>
								Graph
							</button>
							<button
								onClick={() => setViewMode('list')}
								className={`px-3 py-1 text-xs font-medium transition-colors ${
									viewMode === 'list' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
								}`}
							>
								List
							</button>
						</div>
						<button
							onClick={() => setShowAddTask(!showAddTask)}
							className="px-3 py-1 text-xs font-medium bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
						>
							{showAddTask ? 'Cancel' : '+ Add Task'}
						</button>
					</div>
				</div>

				{/* Stats */}
				<div className="flex gap-4 text-sm">
					<span className="text-gray-600"><span className="font-medium text-gray-900">{pendingCount}</span> pending</span>
					<span className="text-gray-600"><span className="font-medium text-blue-600">{runningCount}</span> running</span>
					<span className="text-gray-600"><span className="font-medium text-green-600">{completedCount}</span> completed</span>
					{failedCount > 0 && (
						<span className="text-gray-600"><span className="font-medium text-red-600">{failedCount}</span> failed</span>
					)}
				</div>
			</div>

			{/* Content */}
			<div className="p-4 min-h-[400px]">
				{/* Add Task Form */}
				{showAddTask && (
					<form onSubmit={handleCreateTask} className="bg-gray-50 p-4 rounded-lg mb-4">
						<input
							type="text"
							placeholder="Task name (optional)"
							value={newTask.name}
							onChange={e => setNewTask({ ...newTask, name: e.target.value })}
							className="w-full px-3 py-2 border border-gray-300 rounded mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
						/>
						<textarea
							placeholder="Task description (required)"
							value={newTask.description}
							onChange={e => setNewTask({ ...newTask, description: e.target.value })}
							className="w-full px-3 py-2 border border-gray-300 rounded mb-3 min-h-[80px] resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
							required
						/>
						<div className="flex gap-3 mb-3">
							<select
								value={newTask.priority}
								onChange={e => setNewTask({ ...newTask, priority: e.target.value as 'critical' | 'high' | 'normal' | 'low' })}
								className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
							>
								<option value="critical">Critical</option>
								<option value="high">High</option>
								<option value="normal">Normal</option>
								<option value="low">Low</option>
							</select>
							<input
								type="text"
								placeholder="Agent (optional)"
								value={newTask.agent || ''}
								onChange={e => setNewTask({ ...newTask, agent: e.target.value })}
								className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
							/>
						</div>
						<div className="flex gap-2 justify-end">
							<button
								type="button"
								onClick={() => setShowAddTask(false)}
								className="px-4 py-2 text-gray-600 bg-gray-200 rounded hover:bg-gray-300"
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={creating || !newTask.description.trim()}
								className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
							>
								{creating ? 'Creating...' : 'Create Task'}
							</button>
						</div>
					</form>
				)}

				{tasks.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-[300px] text-gray-500">
						<div className="text-5xl mb-4">📋</div>
						<div className="text-lg font-medium mb-2">No tasks yet</div>
						<div className="text-sm">Add tasks to this plan to get started</div>
					</div>
				) : viewMode === 'graph' ? (
					/* Graph View */
					<div className="relative bg-gray-50 rounded-lg overflow-auto" style={{ minHeight: graphHeight }}>
						<svg
							width={graphWidth}
							height={graphHeight}
							className="absolute top-0 left-0 pointer-events-none"
						>
							{/* Draw edges */}
							{nodes.map(node =>
								node.task.dependencies.map(depId => {
									const fromNode = nodes.find(n => n.task.id === depId);
									if (!fromNode) return null;

									const x1 = fromNode.x + 200;
									const y1 = fromNode.y + 40;
									const x2 = node.x;
									const y2 = node.y + 40;
									const midX = (x1 + x2) / 2;

									return (
										<g key={`${depId}-${node.task.id}`}>
											<path
												d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
												fill="none"
												stroke="#d1d5db"
												strokeWidth="2"
											/>
											<polygon
												points={`${x2},${y2} ${x2 - 8},${y2 - 4} ${x2 - 8},${y2 + 4}`}
												fill="#d1d5db"
											/>
										</g>
									);
								})
							)}
						</svg>

						{/* Draw nodes */}
						{nodes.map(node => {
							const worker = getWorkerForTask(node.task.id);
							return (
								<div
									key={node.task.id}
									className={`absolute w-[200px] p-3 bg-white rounded-lg border-2 shadow-sm cursor-pointer transition-all hover:shadow-md ${statusBorderColors[node.task.status]}`}
									style={{ left: node.x, top: node.y }}
								>
									<div className="font-medium text-gray-900 text-sm truncate mb-2">
										{node.task.name}
									</div>
									<div className="flex justify-between items-center">
										<span className={`px-2 py-0.5 text-xs text-white rounded ${statusColors[node.task.status]}`}>
											{statusLabels[node.task.status]}
										</span>
										{worker && (
											<span className="text-xs text-gray-400">
												{worker.id.slice(0, 6)}
											</span>
										)}
									</div>
									<div className="flex gap-1 mt-2">
										{canDeploy(node.task) && (
											<button
												onClick={() => onDeployTask(node.task.id)}
												className="px-2 py-0.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
											>
												Deploy
											</button>
										)}
										{canRetry(node.task) && (
											<button
												onClick={() => onRetryTask(node.task.id)}
												className="px-2 py-0.5 text-xs bg-orange-500 text-white rounded hover:bg-orange-600"
											>
												Retry
											</button>
										)}
									</div>
								</div>
							);
						})}
					</div>
				) : (
					/* List View */
					<div className="flex flex-col gap-2">
						{tasks.map(task => {
							const worker = getWorkerForTask(task.id);
							return (
								<div key={task.id} className="flex items-center p-3 bg-white rounded-lg border border-gray-200 gap-3">
									<div className="flex-1 min-w-0">
										<div className="font-medium text-gray-900 truncate">{task.name}</div>
										<div className="text-sm text-gray-500 truncate">
											{task.description}
											{worker && ` • Worker: ${worker.id.slice(0, 8)}`}
											{task.dependencies.length > 0 && ` • Deps: ${task.dependencies.length}`}
										</div>
									</div>
									<span className={`px-2 py-0.5 text-xs text-white rounded whitespace-nowrap ${statusColors[task.status]}`}>
										{statusLabels[task.status]}
									</span>
									<div className="flex gap-1">
										{canDeploy(task) && (
											<button
												onClick={() => onDeployTask(task.id)}
												className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
											>
												Deploy
											</button>
										)}
										{canComplete(task) && (
											<button
												onClick={() => onCompleteTask(task.id)}
												className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
											>
												Complete
											</button>
										)}
										{canRetry(task) && (
											<button
												onClick={() => onRetryTask(task.id)}
												className="px-2 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600"
											>
												Retry
											</button>
										)}
										{canCancel(task) && (
											<button
												onClick={() => onCancelTask(task.id)}
												className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
											>
												Cancel
											</button>
										)}
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
