/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { OrchestratorPlan, PlanStatus } from '@/types/orchestrator';

interface PlanCardProps {
	plan: OrchestratorPlan;
	isActive: boolean;
	onStart: (planId: string) => void;
	onPause: (planId: string) => void;
	onSelect: (planId: string) => void;
}

const statusColors: Record<PlanStatus, string> = {
	draft: 'bg-gray-500',
	active: 'bg-green-500',
	paused: 'bg-yellow-500',
	completed: 'bg-blue-500',
	failed: 'bg-red-500',
};

const statusLabels: Record<PlanStatus, string> = {
	draft: 'Draft',
	active: 'Active',
	paused: 'Paused',
	completed: 'Completed',
	failed: 'Failed',
};

export function PlanCard({
	plan,
	isActive,
	onStart,
	onPause,
	onSelect,
}: PlanCardProps) {
	const handleStart = (e: React.MouseEvent) => {
		e.stopPropagation();
		onStart(plan.id);
	};

	const handlePause = (e: React.MouseEvent) => {
		e.stopPropagation();
		onPause(plan.id);
	};

	const formatDate = (timestamp: number) => {
		return new Date(timestamp).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	};

	const canStart = plan.status === 'draft' || plan.status === 'paused';
	const canPause = plan.status === 'active';

	return (
		<div
			className={`p-4 rounded-lg cursor-pointer transition-all duration-200 ${
				isActive
					? 'border-2 border-blue-500 bg-blue-50'
					: 'border border-gray-200 bg-white hover:border-gray-300'
			}`}
			onClick={() => onSelect(plan.id)}
		>
			<div className="flex justify-between items-start mb-2">
				<h3 className="font-semibold text-gray-900 truncate flex-1 mr-2">
					{plan.name}
				</h3>
				<span className={`px-2 py-1 text-xs font-medium text-white rounded-full ${statusColors[plan.status]}`}>
					{statusLabels[plan.status]}
				</span>
			</div>
			<p className="text-sm text-gray-600 line-clamp-2 mb-3">
				{plan.description}
			</p>
			<div className="flex justify-between items-center text-xs text-gray-500">
				<span>Created: {formatDate(plan.createdAt)}</span>
				<div className="flex gap-2">
					{canStart && (
						<button
							onClick={handleStart}
							className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
						>
							Start
						</button>
					)}
					{canPause && (
						<button
							onClick={handlePause}
							className="px-3 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-600 transition-colors"
						>
							Pause
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
