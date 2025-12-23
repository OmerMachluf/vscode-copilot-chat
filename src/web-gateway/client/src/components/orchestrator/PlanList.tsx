/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState } from 'react';
import type { OrchestratorPlan, CreatePlanRequest } from '@/types/orchestrator';
import { PlanCard } from './PlanCard';

interface PlanListProps {
	plans: OrchestratorPlan[];
	selectedPlanId: string | null;
	onSelectPlan: (planId: string | null) => void;
	onStartPlan: (planId: string) => void;
	onPausePlan: (planId: string) => void;
	onCreatePlan: (request: CreatePlanRequest) => Promise<void>;
}

type FilterType = 'all' | 'active' | 'draft' | 'completed';

export function PlanList({
	plans,
	selectedPlanId,
	onSelectPlan,
	onStartPlan,
	onPausePlan,
	onCreatePlan,
}: PlanListProps) {
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [newPlan, setNewPlan] = useState<CreatePlanRequest>({
		name: '',
		description: '',
		baseBranch: '',
	});
	const [creating, setCreating] = useState(false);
	const [filter, setFilter] = useState<FilterType>('all');

	const handleCreatePlan = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!newPlan.name.trim()) return;

		setCreating(true);
		try {
			await onCreatePlan({
				name: newPlan.name.trim(),
				description: newPlan.description.trim(),
				baseBranch: newPlan.baseBranch?.trim() || undefined,
			});
			setNewPlan({ name: '', description: '', baseBranch: '' });
			setShowCreateForm(false);
		} catch {
			// Error is handled by the hook
		} finally {
			setCreating(false);
		}
	};

	const filteredPlans = plans.filter(plan => {
		if (filter === 'all') return true;
		if (filter === 'active') return plan.status === 'active';
		if (filter === 'draft') return plan.status === 'draft' || plan.status === 'paused';
		if (filter === 'completed') return plan.status === 'completed' || plan.status === 'failed';
		return true;
	});

	const activePlans = plans.filter(p => p.status === 'active').length;
	const draftPlans = plans.filter(p => p.status === 'draft' || p.status === 'paused').length;
	const completedPlans = plans.filter(p => p.status === 'completed').length;

	return (
		<div className="flex flex-col gap-3">
			<div className="flex justify-between items-center">
				<h3 className="font-semibold text-gray-700">Plans</h3>
				<button
					onClick={() => setShowCreateForm(!showCreateForm)}
					className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
				>
					{showCreateForm ? 'Cancel' : '+ New'}
				</button>
			</div>

			{showCreateForm && (
				<form onSubmit={handleCreatePlan} className="bg-white p-4 rounded-lg border border-gray-200">
					<input
						type="text"
						placeholder="Plan name"
						value={newPlan.name}
						onChange={e => setNewPlan({ ...newPlan, name: e.target.value })}
						className="w-full px-3 py-2 border border-gray-300 rounded mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
						required
					/>
					<textarea
						placeholder="Description"
						value={newPlan.description}
						onChange={e => setNewPlan({ ...newPlan, description: e.target.value })}
						className="w-full px-3 py-2 border border-gray-300 rounded mb-3 min-h-[80px] resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
					<input
						type="text"
						placeholder="Base branch (optional)"
						value={newPlan.baseBranch}
						onChange={e => setNewPlan({ ...newPlan, baseBranch: e.target.value })}
						className="w-full px-3 py-2 border border-gray-300 rounded mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
					<div className="flex gap-2 justify-end">
						<button
							type="button"
							onClick={() => setShowCreateForm(false)}
							className="px-4 py-2 text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={creating || !newPlan.name.trim()}
							className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{creating ? 'Creating...' : 'Create'}
						</button>
					</div>
				</form>
			)}

			{/* Stats */}
			<div className="flex gap-4 p-3 bg-gray-50 rounded-lg">
				<div className="text-center flex-1">
					<div className="text-xl font-bold text-gray-900">{activePlans}</div>
					<div className="text-xs text-gray-500 uppercase">Active</div>
				</div>
				<div className="text-center flex-1">
					<div className="text-xl font-bold text-gray-900">{draftPlans}</div>
					<div className="text-xs text-gray-500 uppercase">Draft</div>
				</div>
				<div className="text-center flex-1">
					<div className="text-xl font-bold text-gray-900">{completedPlans}</div>
					<div className="text-xs text-gray-500 uppercase">Done</div>
				</div>
			</div>

			{/* Filter */}
			<div className="flex gap-2">
				{(['all', 'active', 'draft', 'completed'] as FilterType[]).map(f => (
					<button
						key={f}
						onClick={() => setFilter(f)}
						className={`px-3 py-1 text-xs rounded-full border transition-colors ${
							filter === f
								? 'border-blue-500 bg-blue-50 text-blue-600'
								: 'border-gray-300 text-gray-600 hover:bg-gray-50'
						}`}
					>
						{f === 'all' ? `All (${plans.length})` : f.charAt(0).toUpperCase() + f.slice(1)}
					</button>
				))}
			</div>

			{/* Plan List */}
			<div className="flex flex-col gap-2 max-h-[calc(100vh-400px)] overflow-y-auto">
				{filteredPlans.length === 0 ? (
					<div className="text-center text-gray-500 py-8 bg-gray-50 rounded-lg">
						{plans.length === 0
							? 'No plans yet. Create one to get started.'
							: 'No plans match the current filter.'}
					</div>
				) : (
					filteredPlans.map(plan => (
						<PlanCard
							key={plan.id}
							plan={plan}
							isActive={plan.id === selectedPlanId}
							onStart={onStartPlan}
							onPause={onPausePlan}
							onSelect={onSelectPlan}
						/>
					))
				)}
			</div>
		</div>
	);
}
