/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as vscode from 'vscode';
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

// ============================================================================
// Audit Entry Interface
// ============================================================================

/**
 * Severity levels for audit entries
 */
export type AuditSeverity = 'info' | 'warning' | 'error' | 'critical';

/**
 * Category for grouping audit entries
 */
export type AuditCategory = 'plan' | 'task' | 'worker' | 'subtask' | 'permission' | 'orchestrator' | 'communication' | 'safety' | 'completion' | 'system';

/**
 * A single audit log entry
 */
export interface IAuditLogEntry {
	/** Unique identifier for this entry */
	readonly id: string;
	/** Timestamp when the event occurred */
	readonly timestamp: number;
	/** Type of event */
	readonly eventType: AuditEventType;
	/** Category for grouping */
	readonly category: AuditCategory;
	/** Severity level */
	readonly severity: AuditSeverity;
	/** Actor that caused the event (workerId, 'orchestrator', 'user', 'system') */
	readonly actor: string;
	/** Target entity affected (optional) */
	readonly target?: string;
	/** Human-readable description */
	readonly description: string;
	/** Associated plan ID (if applicable) */
	readonly planId?: string;
	/** Associated task ID (if applicable) */
	readonly taskId?: string;
	/** Associated worker ID (if applicable) */
	readonly workerId?: string;
	/** Additional structured details */
	readonly details?: Record<string, unknown>;
}

// ============================================================================
// Filter Interface
// ============================================================================

/**
 * Filter options for querying audit logs
 */
export interface IAuditLogFilter {
	/** Filter by specific event types */
	eventTypes?: AuditEventType[];
	/** Filter by single event type (convenience) */
	eventType?: string;
	/** Filter by categories */
	categories?: AuditCategory[];
	/** Filter by severity levels */
	severities?: AuditSeverity[];
	/** Filter by actor */
	actor?: string;
	/** Filter by plan ID */
	planId?: string;
	/** Filter by task ID */
	taskId?: string;
	/** Filter by worker ID */
	workerId?: string;
	/** Filter entries since this timestamp */
	since?: number;
	/** Filter entries until this timestamp */
	until?: number;
	/** Text search in description or details */
	search?: string;
	/** Maximum number of entries to return */
	limit?: number;
	/** Number of entries to skip (for pagination) */
	offset?: number;
}

/**
 * Statistics about the audit log
 */
export interface IAuditLogStats {
	/** Total number of entries */
	totalEntries: number;
	/** Entries by category */
	byCategory: Record<AuditCategory, number>;
	/** Entries by severity */
	bySeverity: Record<AuditSeverity, number>;
	/** Oldest entry timestamp */
	oldestEntry?: number;
	/** Newest entry timestamp */
	newestEntry?: number;
	/** Current retention period in days */
	retentionDays: number;
}

// ============================================================================
// Service Interface
// ============================================================================

/**
 * Options for logging an audit entry
 */
export interface IAuditLogOptions {
	/** Associated plan ID */
	planId?: string;
	/** Associated task ID */
	taskId?: string;
	/** Associated worker ID */
	workerId?: string;
	/** Additional structured details */
	details?: Record<string, unknown>;
}

/**
 * Service for managing audit logs of A2A operations
 */
export interface IAuditLogService {
	/**
	 * Event fired when a new entry is logged
	 */
	readonly onDidLogEntry: Event<IAuditLogEntry>;

	/**
	 * Log an audit entry
	 * @param eventType The type of event
	 * @param actor The actor that caused the event
	 * @param description Human-readable description
	 * @param options Additional options (planId, taskId, workerId, details)
	 */
	log(eventType: AuditEventType, actor: string, description: string, options?: IAuditLogOptions): IAuditLogEntry;

	/**
	 * Get entries matching the filter
	 */
	getEntries(filter?: IAuditLogFilter): IAuditLogEntry[];

	/**
	 * Get statistics about the audit log
	 */
	getStats(): IAuditLogStats;

	/**
	 * Export audit log to a specified format
	 */
	export(format: 'json' | 'csv' | 'markdown'): string;

	/**
	 * Set the retention period in days
	 */
	setRetentionDays(days: number): void;

	/**
	 * Get current retention period in days
	 */
	getRetentionDays(): number;

	/**
	 * Clear all audit log entries
	 */
	clear(): void;

	/**
	 * Dispose and clean up resources
	 */
	dispose(): void;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Map event types to categories
 */
function getCategory(eventType: AuditEventType): AuditCategory {
	if (eventType.startsWith('plan_')) {
		return 'plan';
	}
	if (eventType.startsWith('task_')) {
		return 'task';
	}
	if (eventType.startsWith('worker_')) {
		return 'worker';
	}
	if (eventType.startsWith('subtask_')) {
		return 'subtask';
	}
	if (eventType.startsWith('permission_') || eventType.startsWith('approval_')) {
		return 'permission';
	}
	if (eventType.startsWith('orchestrator_')) {
		return 'orchestrator';
	}
	if (eventType.startsWith('message_') || eventType.startsWith('queue_')) {
		return 'communication';
	}
	if (eventType.includes('limit') || eventType.includes('circuit') || eventType === AuditEventType.EmergencyStop) {
		return 'safety';
	}
	if (eventType.startsWith('pull_request') || eventType.startsWith('branch_') || eventType.startsWith('worktree_')) {
		return 'completion';
	}
	return 'system';
}

/**
 * Map event types to default severity
 */
function getSeverity(eventType: AuditEventType): AuditSeverity {
	switch (eventType) {
		// Critical events
		case AuditEventType.EmergencyStop:
		case AuditEventType.SystemError:
		case AuditEventType.CircuitBreakerTriggered:
			return 'critical';

		// Error events
		case AuditEventType.PlanFailed:
		case AuditEventType.TaskFailed:
		case AuditEventType.WorkerFailed:
		case AuditEventType.SubtaskFailed:
		case AuditEventType.PermissionDenied:
		case AuditEventType.ApprovalDenied:
			return 'error';

		// Warning events
		case AuditEventType.DepthLimitReached:
		case AuditEventType.RateLimitReached:
		case AuditEventType.TaskBlocked:
		case AuditEventType.WorkerInterrupted:
		case AuditEventType.WorkerKilled:
		case AuditEventType.OrchestratorDecisionDeferred:
		case AuditEventType.OrchestratorEscalated:
			return 'warning';

		// Info events (default)
		default:
			return 'info';
	}
}

const DEFAULT_RETENTION_DAYS = 30;
const STATE_FILE_NAME = '.copilot-audit-log.json';

/**
 * Implementation of the audit log service
 */
export class AuditLogService extends Disposable implements IAuditLogService {
	private readonly _entries: IAuditLogEntry[] = [];
	private _retentionDays: number = DEFAULT_RETENTION_DAYS;
	private readonly _stateFilePath: string | undefined;

	private readonly _onDidLogEntry = this._register(new Emitter<IAuditLogEntry>());
	readonly onDidLogEntry: Event<IAuditLogEntry> = this._onDidLogEntry.event;

	constructor() {
		super();

		// Determine state file path
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (workspaceFolder) {
			this._stateFilePath = vscode.Uri.joinPath(workspaceFolder.uri, STATE_FILE_NAME).fsPath;
			this._loadState();
		}

		// Set up periodic cleanup
		const cleanupInterval = setInterval(() => this._cleanupOldEntries(), 60 * 60 * 1000); // Every hour
		this._register({ dispose: () => clearInterval(cleanupInterval) });
	}

	log(eventType: AuditEventType, actor: string, description: string, options?: IAuditLogOptions): IAuditLogEntry {
		const entry: IAuditLogEntry = {
			id: generateUuid(),
			timestamp: Date.now(),
			eventType,
			category: getCategory(eventType),
			severity: getSeverity(eventType),
			actor,
			description,
			target: options?.workerId || options?.taskId || options?.planId,
			planId: options?.planId,
			taskId: options?.taskId,
			workerId: options?.workerId,
			details: options?.details,
		};

		this._entries.push(entry);
		this._onDidLogEntry.fire(entry);

		// Save state asynchronously
		this._saveState();

		return entry;
	}

	getEntries(filter?: IAuditLogFilter): IAuditLogEntry[] {
		let entries = [...this._entries];

		if (filter) {
			// Filter by event types
			if (filter.eventTypes && filter.eventTypes.length > 0) {
				const types = new Set(filter.eventTypes);
				entries = entries.filter(e => types.has(e.eventType));
			}

			// Filter by single event type (string match for webview compatibility)
			if (filter.eventType) {
				entries = entries.filter(e => e.eventType === filter.eventType);
			}

			// Filter by categories
			if (filter.categories && filter.categories.length > 0) {
				const cats = new Set(filter.categories);
				entries = entries.filter(e => cats.has(e.category));
			}

			// Filter by severities
			if (filter.severities && filter.severities.length > 0) {
				const sevs = new Set(filter.severities);
				entries = entries.filter(e => sevs.has(e.severity));
			}

			// Filter by actor
			if (filter.actor) {
				const actorLower = filter.actor.toLowerCase();
				entries = entries.filter(e => e.actor.toLowerCase().includes(actorLower));
			}

			// Filter by planId
			if (filter.planId) {
				entries = entries.filter(e => e.planId === filter.planId);
			}

			// Filter by taskId
			if (filter.taskId) {
				entries = entries.filter(e => e.taskId === filter.taskId);
			}

			// Filter by workerId
			if (filter.workerId) {
				entries = entries.filter(e => e.workerId === filter.workerId);
			}

			// Filter by time range
			if (filter.since !== undefined) {
				entries = entries.filter(e => e.timestamp >= filter.since!);
			}
			if (filter.until !== undefined) {
				entries = entries.filter(e => e.timestamp <= filter.until!);
			}

			// Text search
			if (filter.search) {
				const searchLower = filter.search.toLowerCase();
				entries = entries.filter(e =>
					e.description.toLowerCase().includes(searchLower) ||
					(e.details && JSON.stringify(e.details).toLowerCase().includes(searchLower)) ||
					e.actor.toLowerCase().includes(searchLower)
				);
			}
		}

		// Sort by timestamp descending (newest first)
		entries.sort((a, b) => b.timestamp - a.timestamp);

		// Apply pagination
		if (filter?.offset !== undefined) {
			entries = entries.slice(filter.offset);
		}
		if (filter?.limit !== undefined) {
			entries = entries.slice(0, filter.limit);
		}

		return entries;
	}

	getStats(): IAuditLogStats {
		const byCategory: Record<AuditCategory, number> = {
			plan: 0,
			task: 0,
			worker: 0,
			subtask: 0,
			permission: 0,
			orchestrator: 0,
			communication: 0,
			safety: 0,
			completion: 0,
			system: 0,
		};

		const bySeverity: Record<AuditSeverity, number> = {
			info: 0,
			warning: 0,
			error: 0,
			critical: 0,
		};

		let oldestEntry: number | undefined;
		let newestEntry: number | undefined;

		for (const entry of this._entries) {
			byCategory[entry.category]++;
			bySeverity[entry.severity]++;

			if (oldestEntry === undefined || entry.timestamp < oldestEntry) {
				oldestEntry = entry.timestamp;
			}
			if (newestEntry === undefined || entry.timestamp > newestEntry) {
				newestEntry = entry.timestamp;
			}
		}

		return {
			totalEntries: this._entries.length,
			byCategory,
			bySeverity,
			oldestEntry,
			newestEntry,
			retentionDays: this._retentionDays,
		};
	}

	export(format: 'json' | 'csv' | 'markdown'): string {
		const entries = this.getEntries();

		switch (format) {
			case 'json':
				return JSON.stringify(entries, null, 2);

			case 'csv': {
				const headers = ['id', 'timestamp', 'eventType', 'category', 'severity', 'actor', 'target', 'description', 'planId', 'taskId', 'workerId', 'details'];
				const rows = entries.map(e => [
					e.id,
					new Date(e.timestamp).toISOString(),
					e.eventType,
					e.category,
					e.severity,
					e.actor,
					e.target || '',
					`"${e.description.replace(/"/g, '""')}"`,
					e.planId || '',
					e.taskId || '',
					e.workerId || '',
					e.details ? `"${JSON.stringify(e.details).replace(/"/g, '""')}"` : '',
				].join(','));
				return [headers.join(','), ...rows].join('\n');
			}

			case 'markdown': {
				const lines: string[] = [
					'# Audit Log Export',
					'',
					`**Exported:** ${new Date().toISOString()}`,
					`**Total Entries:** ${entries.length}`,
					`**Retention Period:** ${this._retentionDays} days`,
					'',
					'---',
					'',
				];

				for (const entry of entries) {
					lines.push(`## ${entry.eventType}`);
					lines.push('');
					lines.push(`- **Time:** ${new Date(entry.timestamp).toLocaleString()}`);
					lines.push(`- **Category:** ${entry.category}`);
					lines.push(`- **Severity:** ${entry.severity}`);
					lines.push(`- **Actor:** ${entry.actor}`);
					if (entry.target) {
						lines.push(`- **Target:** ${entry.target}`);
					}
					lines.push(`- **Description:** ${entry.description}`);
					if (entry.planId) {
						lines.push(`- **Plan ID:** ${entry.planId}`);
					}
					if (entry.taskId) {
						lines.push(`- **Task ID:** ${entry.taskId}`);
					}
					if (entry.workerId) {
						lines.push(`- **Worker ID:** ${entry.workerId}`);
					}
					if (entry.details) {
						lines.push('- **Details:**');
						lines.push('```json');
						lines.push(JSON.stringify(entry.details, null, 2));
						lines.push('```');
					}
					lines.push('');
					lines.push('---');
					lines.push('');
				}

				return lines.join('\n');
			}

			default:
				throw new Error(`Unsupported export format: ${format}`);
		}
	}

	setRetentionDays(days: number): void {
		if (days < 1) {
			throw new Error('Retention days must be at least 1');
		}
		this._retentionDays = days;
		this._cleanupOldEntries();
		this._saveState();
	}

	getRetentionDays(): number {
		return this._retentionDays;
	}

	clear(): void {
		this._entries.length = 0;
		this._saveState();
	}

	private _cleanupOldEntries(): void {
		const cutoff = Date.now() - (this._retentionDays * 24 * 60 * 60 * 1000);
		const originalLength = this._entries.length;

		// Remove entries older than retention period
		for (let i = this._entries.length - 1; i >= 0; i--) {
			if (this._entries[i].timestamp < cutoff) {
				this._entries.splice(i, 1);
			}
		}

		if (this._entries.length !== originalLength) {
			this._saveState();
		}
	}

	private _loadState(): void {
		if (!this._stateFilePath) {
			return;
		}

		try {
			if (fs.existsSync(this._stateFilePath)) {
				const content = fs.readFileSync(this._stateFilePath, 'utf-8');
				const state = JSON.parse(content);

				if (state.retentionDays) {
					this._retentionDays = state.retentionDays;
				}
				if (Array.isArray(state.entries)) {
					this._entries.push(...state.entries);
				}

				// Clean up old entries after loading
				this._cleanupOldEntries();
			}
		} catch (error) {
			console.error('[AuditLogService] Failed to load state:', error);
		}
	}

	private _saveState(): void {
		if (!this._stateFilePath) {
			return;
		}

		try {
			const state = {
				retentionDays: this._retentionDays,
				entries: this._entries,
			};
			fs.writeFileSync(this._stateFilePath, JSON.stringify(state, null, 2));
		} catch (error) {
			console.error('[AuditLogService] Failed to save state:', error);
		}
	}
}
