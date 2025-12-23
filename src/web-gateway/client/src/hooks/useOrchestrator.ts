/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
	OrchestratorState,
	OrchestratorEvent,
	CreatePlanRequest,
	CreateTaskRequest,
	DeployOptions,
} from '@/types/orchestrator';
import { orchestratorApi } from '@/api';

interface UseOrchestratorResult {
	state: OrchestratorState;
	loading: boolean;
	error: string | null;
	connected: boolean;
	createPlan: (request: CreatePlanRequest) => Promise<void>;
	startPlan: (planId: string) => Promise<void>;
	pausePlan: (planId: string) => Promise<void>;
	createTask: (request: CreateTaskRequest) => Promise<void>;
	deployTask: (taskId: string, options?: DeployOptions) => Promise<void>;
	completeTask: (taskId: string) => Promise<void>;
	cancelTask: (taskId: string, remove?: boolean) => Promise<void>;
	retryTask: (taskId: string) => Promise<void>;
	refresh: () => Promise<void>;
}

const initialState: OrchestratorState = {
	plans: [],
	tasks: [],
	workers: [],
};

export function useOrchestrator(pollingIntervalMs = 5000): UseOrchestratorResult {
	const [state, setState] = useState<OrchestratorState>(initialState);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [connected, setConnected] = useState(false);
	const abortControllerRef = useRef<AbortController | null>(null);
	const pollingTimeoutRef = useRef<number | null>(null);

	const fetchState = useCallback(async () => {
		try {
			setLoading(true);
			setError(null);
			const newState = await orchestratorApi.getState();
			setState(newState);
		} catch (err) {
			const message = err instanceof Error ? err.message :
				(err && typeof err === 'object' && 'error' in err) ? String((err as { error: string }).error) : 'Failed to fetch state';
			setError(message);
		} finally {
			setLoading(false);
		}
	}, []);

	const handleEvent = useCallback((event: OrchestratorEvent) => {
		setState(prev => {
			switch (event.type) {
				case 'task.queued':
				case 'task.started':
				case 'task.completed':
				case 'task.failed':
				case 'task.blocked': {
					return {
						...prev,
						tasks: prev.tasks.map(task =>
							task.id === event.taskId
								? {
									...task,
									status: event.type === 'task.queued' ? 'queued'
										: event.type === 'task.started' ? 'running'
											: event.type === 'task.completed' ? 'completed'
												: event.type === 'task.failed' ? 'failed'
													: 'blocked',
									workerId: 'workerId' in event ? event.workerId : task.workerId,
									error: 'error' in event ? event.error : task.error,
								}
								: task
						),
					};
				}
				case 'worker.needs_approval':
				case 'worker.idle': {
					return {
						...prev,
						workers: prev.workers.map(worker =>
							worker.id === event.workerId
								? {
									...worker,
									status: event.type === 'worker.idle' ? 'idle' : 'waiting_approval',
									pendingApprovalId: 'approvalId' in event ? event.approvalId : undefined,
								}
								: worker
						),
					};
				}
				case 'plan.started':
				case 'plan.completed':
				case 'plan.failed': {
					return {
						...prev,
						plans: prev.plans.map(plan =>
							plan.id === event.planId
								? {
									...plan,
									status: event.type === 'plan.started' ? 'active'
										: event.type === 'plan.completed' ? 'completed'
											: 'failed',
								}
								: plan
						),
					};
				}
				default:
					return prev;
			}
		});
	}, []);

	const connectSSE = useCallback(async () => {
		// Clean up existing connection
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}

		try {
			const controller = await orchestratorApi.subscribeToEvents(
				(event) => {
					handleEvent(event);
					setConnected(true);
					setError(null);
				},
				(err) => {
					setConnected(false);
					console.error('SSE error:', err);
					// Reconnect after 5 seconds
					setTimeout(() => connectSSE(), 5000);
				}
			);
			abortControllerRef.current = controller;
			setConnected(true);
		} catch (err) {
			setConnected(false);
			// Fall back to polling
			startPolling();
		}
	}, [handleEvent]);

	const startPolling = useCallback(() => {
		if (pollingTimeoutRef.current) {
			clearTimeout(pollingTimeoutRef.current);
		}

		const poll = async () => {
			await fetchState();
			pollingTimeoutRef.current = window.setTimeout(poll, pollingIntervalMs);
		};

		poll();
	}, [fetchState, pollingIntervalMs]);

	useEffect(() => {
		fetchState();
		connectSSE();

		return () => {
			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
			}
			if (pollingTimeoutRef.current) {
				clearTimeout(pollingTimeoutRef.current);
			}
		};
	}, [fetchState, connectSSE]);

	const createPlan = useCallback(async (request: CreatePlanRequest) => {
		try {
			const plan = await orchestratorApi.createPlan(request);
			setState(prev => ({ ...prev, plans: [...prev.plans, plan] }));
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to create plan';
			setError(message);
			throw err;
		}
	}, []);

	const startPlan = useCallback(async (planId: string) => {
		try {
			await orchestratorApi.startPlan(planId);
			setState(prev => ({
				...prev,
				plans: prev.plans.map(p => p.id === planId ? { ...p, status: 'active' as const } : p),
				activePlanId: planId,
			}));
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to start plan';
			setError(message);
			throw err;
		}
	}, []);

	const pausePlan = useCallback(async (planId: string) => {
		try {
			await orchestratorApi.pausePlan(planId);
			setState(prev => ({
				...prev,
				plans: prev.plans.map(p => p.id === planId ? { ...p, status: 'paused' as const } : p),
			}));
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to pause plan';
			setError(message);
			throw err;
		}
	}, []);

	const createTask = useCallback(async (request: CreateTaskRequest) => {
		try {
			const task = await orchestratorApi.createTask(request);
			setState(prev => ({ ...prev, tasks: [...prev.tasks, task] }));
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to create task';
			setError(message);
			throw err;
		}
	}, []);

	const deployTask = useCallback(async (taskId: string, options?: DeployOptions) => {
		try {
			await orchestratorApi.deployTask(taskId, options);
			// State will be updated via SSE events
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to deploy task';
			setError(message);
			throw err;
		}
	}, []);

	const completeTask = useCallback(async (taskId: string) => {
		try {
			await orchestratorApi.completeTask(taskId);
			// State will be updated via SSE events
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to complete task';
			setError(message);
			throw err;
		}
	}, []);

	const cancelTask = useCallback(async (taskId: string, remove?: boolean) => {
		try {
			await orchestratorApi.cancelTask(taskId, remove);
			if (remove) {
				setState(prev => ({
					...prev,
					tasks: prev.tasks.filter(t => t.id !== taskId),
				}));
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to cancel task';
			setError(message);
			throw err;
		}
	}, []);

	const retryTask = useCallback(async (taskId: string) => {
		try {
			await orchestratorApi.retryTask(taskId);
			// State will be updated via SSE events
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to retry task';
			setError(message);
			throw err;
		}
	}, []);

	return {
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
		refresh: fetchState,
	};
}
