/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../util/vs/base/common/event';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { generateUuid } from '../../util/vs/base/common/uuid';
import { createDecorator } from '../../util/vs/platform/instantiation/common/instantiation';

export const IAuditLogService = createDecorator<IAuditLogService>('auditLogService');

// ============================================================================
// Audit Event Types
// ============================================================================

/**
 * All audit event types for A2A operations
 */
export const enum AuditEventType {
// Plan lifecycle
PlanCreated = 'plan_created',
PlanStarted = 'plan_started',
PlanPaused = 'plan_paused',
PlanResumed = 'plan_resumed',
PlanCompleted = 'plan_completed',
PlanFailed = 'plan_failed',
PlanDeleted = 'plan_deleted',

// Task lifecycle
TaskCreated = 'task_created',
TaskQueued = 'task_queued',
TaskStarted = 'task_started',
TaskCompleted = 'task_completed',
TaskFailed = 'task_failed',
TaskBlocked = 'task_blocked',
TaskCancelled = 'task_cancelled',
TaskRetried = 'task_retried',
TaskRemoved = 'task_removed',

// Worker lifecycle
WorkerSpawned = 'worker_spawned',
WorkerStarted = 'worker_started',
WorkerPaused = 'worker_paused',
WorkerResumed = 'worker_resumed',
WorkerInterrupted = 'worker_interrupted',
WorkerCompleted = 'worker_completed',
WorkerKilled = 'worker_killed',
WorkerFailed = 'worker_failed',
WorkerIdle = 'worker_idle',

// Sub-task operations
SubtaskSpawned = 'subtask_spawned',
SubtaskCompleted = 'subtask_completed',
SubtaskFailed = 'subtask_failed',
SubtaskAggregated = 'subtask_aggregated',

// Permission/approval operations
PermissionRequested = 'permission_requested',
PermissionGranted = 'permission_granted',
PermissionDenied = 'permission_denied',
ApprovalRequested = 'approval_requested',
ApprovalGranted = 'approval_granted',
ApprovalDenied = 'approval_denied',

// Orchestrator decisions
OrchestratorDecisionMade = 'orchestrator_decision_made',
OrchestratorDecisionDeferred = 'orchestrator_decision_deferred',
OrchestratorEscalated = 'orchestrator_escalated',

// Agent/model operations
AgentSwitched = 'agent_switched',
ModelSwitched = 'model_switched',
WorkerReinitialized = 'worker_reinitialized',
WorkerRedirected = 'worker_redirected',

// Communication
MessageSent = 'message_sent',
MessageReceived = 'message_received',
QueueMessageEnqueued = 'queue_message_enqueued',
QueueMessageProcessed = 'queue_message_processed',

// Safety/limits
DepthLimitReached = 'depth_limit_reached',
RateLimitReached = 'rate_limit_reached',
CircuitBreakerTriggered = 'circuit_breaker_triggered',
EmergencyStop = 'emergency_stop',

// PR/completion
PullRequestCreated = 'pull_request_created',
BranchMerged = 'branch_merged',
WorktreeCreated = 'worktree_created',
WorktreeRemoved = 'worktree_removed',

// System
SystemError = 'system_error',
ConfigurationChanged = 'configuration_changed',
}