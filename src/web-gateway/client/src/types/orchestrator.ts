/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Orchestrator types for the web gateway.
 * These mirror the types from orchestratorServiceV2.ts
 */

export type TaskStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'blocked';

export type PlanStatus = 'draft' | 'active' | 'paused' | 'completed' | 'failed';

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

export interface WorkerTaskContext {
	readonly suggestedFiles?: string[];
	readonly additionalInstructions?: string;
}

export interface WorkerTask {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly priority: TaskPriority;
	readonly dependencies: string[];
	readonly parallelGroup?: string;
	readonly context?: WorkerTaskContext;
	readonly baseBranch?: string;
	readonly planId?: string;
	readonly modelId?: string;
	readonly agent?: string;
	readonly targetFiles?: string[];
	readonly parentWorkerId?: string;
	status: TaskStatus;
	workerId?: string;
	sessionUri?: string;
	completedAt?: number;
	error?: string;
}

export interface OrchestratorPlan {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly createdAt: number;
	readonly baseBranch?: string;
	status: PlanStatus;
	metadata?: {
		sourceRequest?: string;
		methodology?: string;
	};
}

export interface WorkerSessionState {
	id: string;
	taskId: string;
	planId?: string;
	status: 'running' | 'paused' | 'idle' | 'completed' | 'failed' | 'waiting_approval';
	worktreePath?: string;
	branchName?: string;
	modelId?: string;
	agentId?: string;
	lastActivity?: number;
	pendingApprovalId?: string;
	error?: string;
}

export interface CreatePlanRequest {
	name: string;
	description: string;
	baseBranch?: string;
}

export interface CreateTaskRequest {
	description: string;
	name?: string;
	priority?: TaskPriority;
	planId?: string;
	dependencies?: string[];
	parallelGroup?: string;
	agent?: string;
	modelId?: string;
	targetFiles?: string[];
	baseBranch?: string;
	context?: WorkerTaskContext;
}

export interface DeployOptions {
	modelId?: string;
}

export type OrchestratorEvent =
	| { type: 'task.queued'; planId: string | undefined; taskId: string }
	| { type: 'task.started'; planId: string | undefined; taskId: string; workerId: string; sessionUri: string }
	| { type: 'task.completed'; planId: string | undefined; taskId: string; workerId: string; sessionUri?: string }
	| { type: 'task.failed'; planId: string | undefined; taskId: string; error: string }
	| { type: 'task.blocked'; planId: string | undefined; taskId: string; reason: string }
	| { type: 'worker.needs_approval'; workerId: string; approvalId: string }
	| { type: 'worker.idle'; workerId: string }
	| { type: 'plan.started'; planId: string }
	| { type: 'plan.completed'; planId: string }
	| { type: 'plan.failed'; planId: string; error: string };

export interface OrchestratorState {
	plans: OrchestratorPlan[];
	tasks: WorkerTask[];
	workers: WorkerSessionState[];
	activePlanId?: string;
}
