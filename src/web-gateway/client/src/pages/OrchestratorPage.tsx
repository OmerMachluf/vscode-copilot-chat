/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState, useEffect } from 'react';
import { useOrchestrator } from '@/hooks';
import { PlanList, PlanDetail, WorkerStatus } from '@/components/orchestrator';
import { TaskList } from '@/components/orchestrator/TaskList';

export function OrchestratorPage() {
	const {
		state,
		loading,
		error,
		connected,
		createPlan,
		startPlan,
		pausePlan,
		createTask,
		deployTask,
		completeTask,
		cancelTask,
		retryTask,
		refresh,
	} = useOrchestrator();

	const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
	const [pollingInterval, setPollingInterval] = useState<number>(5000);
	const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

	// Update last refresh time when connected status changes or on manual refresh
	useEffect(() => {
		if (!connected) {
			const interval = setInterval(() => {
				refresh();
				setLastRefresh(new Date());
			}, pollingInterval);
			return () => clearInterval(interval);
		}
	}, [connected, pollingInterval, refresh]);

	const selectedPlan = selectedPlanId
		? state.plans.find(p => p.id === selectedPlanId)
		: null;

	const filteredTasks = selectedPlanId
		? state.tasks.filter(t => t.planId === selectedPlanId)
		: state.tasks;

	const filteredWorkers = selectedPlanId
		? state.workers.filter(w => w.planId === selectedPlanId)
		: state.workers;

	if (loading && state.plans.length === 0) {
		return (
			<div className="flex items-center justify-center h-screen bg-gray-100">
				<div className="flex flex-col items-center gap-4">
					<div className="w-10 h-10 border-3 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
					<div className="text-gray-600">Loading orchestrator state...</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-gray-100 p-6">
			{/* Header */}
			<div className="flex justify-between items-center mb-6">
				<div className="flex items-center gap-4">
					<h1 className="text-2xl font-bold text-gray-900">Orchestrator Dashboard</h1>
					<div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
						connected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
					}`}>
						<span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
						{connected ? 'Live' : 'Polling'}
					</div>
				</div>
				<div className="flex items-center gap-3">
					<span className="text-xs text-gray-500">
						Last updated: {lastRefresh.toLocaleTimeString()}
					</span>
					<select
						value={pollingInterval}
						onChange={e => setPollingInterval(Number(e.target.value))}
						disabled={connected}
						className="px-3 py-2 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
					>
						<option value={2000}>2s</option>
						<option value={5000}>5s</option>
						<option value={10000}>10s</option>
						<option value={30000}>30s</option>
					</select>
					<button
						onClick={() => { refresh(); setLastRefresh(new Date()); }}
						className="px-4 py-2 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
					>
						Refresh
					</button>
				</div>
			</div>

			{/* Error Banner */}
			{error && (
				<div className="flex justify-between items-center mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
					<span>{error}</span>
					<button
						onClick={refresh}
						className="px-3 py-1 text-xs bg-red-100 rounded hover:bg-red-200"
					>
						Retry
					</button>
				</div>
			)}

			{/* Main Grid */}
			<div className="grid grid-cols-[380px_1fr] gap-6">
				{/* Sidebar */}
				<div className="flex flex-col gap-4">
					<PlanList
						plans={state.plans}
						selectedPlanId={selectedPlanId}
						onSelectPlan={setSelectedPlanId}
						onStartPlan={startPlan}
						onPausePlan={pausePlan}
						onCreatePlan={createPlan}
					/>

					<WorkerStatus
						workers={filteredWorkers}
						connected={connected}
					/>
				</div>

				{/* Main Content */}
				<div className="flex flex-col gap-6">
					{selectedPlan ? (
						<PlanDetail
							plan={selectedPlan}
							tasks={filteredTasks}
							workers={filteredWorkers}
							onDeployTask={deployTask}
							onCompleteTask={completeTask}
							onCancelTask={cancelTask}
							onRetryTask={retryTask}
							onCreateTask={createTask}
						/>
					) : (
						<TaskList
							tasks={filteredTasks}
							onDeploy={deployTask}
							onComplete={completeTask}
							onCancel={cancelTask}
							onRetry={retryTask}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
