/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { api } from './client';
import type {
	OrchestratorState,
	OrchestratorPlan,
	WorkerTask,
	CreatePlanRequest,
	CreateTaskRequest,
	DeployOptions,
	OrchestratorEvent,
} from '@/types/orchestrator';

const API_BASE = '/api/orchestrator';

export async function getState(): Promise<OrchestratorState> {
	return api.get<OrchestratorState>(`${API_BASE}/state`);
}

export async function getPlans(): Promise<OrchestratorPlan[]> {
	return api.get<OrchestratorPlan[]>(`${API_BASE}/plans`);
}

export async function createPlan(request: CreatePlanRequest): Promise<OrchestratorPlan> {
	return api.post<OrchestratorPlan>(`${API_BASE}/plans`, request);
}

export async function startPlan(planId: string): Promise<void> {
	return api.post<void>(`${API_BASE}/plans/${planId}/start`);
}

export async function pausePlan(planId: string): Promise<void> {
	return api.post<void>(`${API_BASE}/plans/${planId}/pause`);
}

export async function getTasks(planId?: string): Promise<WorkerTask[]> {
	const url = planId ? `${API_BASE}/tasks?planId=${planId}` : `${API_BASE}/tasks`;
	return api.get<WorkerTask[]>(url);
}

export async function createTask(request: CreateTaskRequest): Promise<WorkerTask> {
	return api.post<WorkerTask>(`${API_BASE}/tasks`, request);
}

export async function deployTask(taskId: string, options?: DeployOptions): Promise<void> {
	return api.post<void>(`${API_BASE}/tasks/${taskId}/deploy`, options || {});
}

export async function completeTask(taskId: string): Promise<void> {
	return api.post<void>(`${API_BASE}/tasks/${taskId}/complete`);
}

export async function cancelTask(taskId: string, remove?: boolean): Promise<void> {
	return api.post<void>(`${API_BASE}/tasks/${taskId}/cancel`, { remove });
}

export async function retryTask(taskId: string): Promise<void> {
	return api.post<void>(`${API_BASE}/tasks/${taskId}/retry`);
}

export function subscribeToEvents(
	onMessage: (event: OrchestratorEvent) => void,
	onError?: (error: Error) => void
): Promise<AbortController> {
	return api.streamSSE(
		`${API_BASE}/events`,
		(data) => onMessage(data as OrchestratorEvent),
		onError
	);
}
