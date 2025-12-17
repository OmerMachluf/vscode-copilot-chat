/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../platform/log/common/logService';
import { Emitter, Event } from '../../util/vs/base/common/event';
import { Disposable } from '../../util/vs/base/common/lifecycle';

/**
 * Health metrics for a worker
 */
export interface IWorkerHealthMetrics {
	readonly workerId: string;
	lastActivityTimestamp: number;
	consecutiveFailures: number;
	consecutiveLoops: number;
	toolCallCount: number;
	errorRate: number;
	isStuck: boolean;
	isLooping: boolean;
	isIdle: boolean;
	/**
	 * Whether the worker is currently executing (inside invoke() or run()).
	 * When true, we should NOT fire idle events even if no stream output is produced.
	 * This prevents false idle detection during "thinking" phases.
	 */
	isExecuting: boolean;
	/** Whether an idle inquiry has been sent and is awaiting response */
	idleInquiryPending: boolean;
	/** Timestamp when idle inquiry was sent (for timeout tracking) */
	idleInquirySentAt?: number;
	/** Timestamp when last progress check was sent */
	lastProgressCheckAt?: number;
	recentToolCalls: string[];
}

/**
 * Reasons why a worker might be unhealthy
 */
export type WorkerUnhealthyReason = 'stuck' | 'looping' | 'high_error_rate';

/**
 * Reasons why a worker might be idle
 */
export type WorkerIdleReason = 'no_activity' | 'waiting' | 'unknown';

/**
 * Interface for the worker health monitor service
 */
export interface IWorkerHealthMonitor {
	startMonitoring(workerId: string): void;
	stopMonitoring(workerId: string): void;
	recordActivity(workerId: string, type: 'tool_call' | 'message' | 'error' | 'success', toolName?: string): void;
	getHealth(workerId: string): IWorkerHealthMetrics | undefined;
	isStuck(workerId: string): boolean;
	isLooping(workerId: string): boolean;
	isIdle(workerId: string): boolean;
	/** Mark that an idle inquiry has been sent to this worker */
	markIdleInquirySent(workerId: string): void;
	/** Check if an idle inquiry has already been sent and is pending response */
	hasIdleInquiryPending(workerId: string): boolean;
	/** Clear idle inquiry state after response received */
	clearIdleInquiry(workerId: string): void;
	/** Mark that a progress check has been sent */
	markProgressCheckSent(workerId: string): void;
	/**
	 * Mark execution start - worker is now inside executor.execute() or agentRunner.run().
	 * While executing, idle detection is suppressed to avoid false positives during "thinking".
	 */
	markExecutionStart(workerId: string): void;
	/**
	 * Mark execution end - worker has returned from execute()/run().
	 * Idle detection resumes normally.
	 */
	markExecutionEnd(workerId: string): void;
	onWorkerUnhealthy: Event<{ workerId: string; reason: WorkerUnhealthyReason }>;
	/** Event fired when a worker goes idle (before being marked stuck) */
	onWorkerIdle: Event<{ workerId: string; reason: WorkerIdleReason }>;
	/** Event fired when periodic progress check is due for a worker */
	onProgressCheckDue: Event<{ workerId: string }>;
}

/**
 * Configuration for the health monitor
 */
interface HealthMonitorConfig {
	/** Timeout in ms before a worker is considered stuck (default: 5 minutes) */
	stuckTimeoutMs: number;
	/** Timeout in ms before a worker is considered idle (default: 30 seconds) */
	idleTimeoutMs: number;
	/** Number of consecutive same-tool calls before considering the worker looping */
	loopThreshold: number;
	/** Number of consecutive errors before firing high_error_rate event */
	errorThreshold: number;
	/** Interval for checking stuck workers (default: 30 seconds) */
	checkIntervalMs: number;
	/** Interval for progress checks (default: 5 minutes) */
	progressCheckIntervalMs: number;
}

const DEFAULT_CONFIG: HealthMonitorConfig = {
	stuckTimeoutMs: 5 * 60 * 1000, // 5 minutes
	idleTimeoutMs: 30 * 1000, // 30 seconds - shorter threshold to detect idle before stuck
	loopThreshold: 5,
	errorThreshold: 5,
	checkIntervalMs: 30 * 1000, // 30 seconds
	progressCheckIntervalMs: 5 * 60 * 1000, // 5 minutes - periodic progress report interval
};

/**
 * Worker health monitor implementation
 * Tracks worker activity and detects stuck/looping workers
 */
export class WorkerHealthMonitor extends Disposable implements IWorkerHealthMonitor {
	private readonly _metrics = new Map<string, IWorkerHealthMetrics>();
	private readonly _config: HealthMonitorConfig;
	private _checkInterval: ReturnType<typeof setInterval> | undefined;
	private readonly _logService: ILogService | undefined;

	private readonly _onWorkerUnhealthy = this._register(new Emitter<{ workerId: string; reason: WorkerUnhealthyReason }>());
	public readonly onWorkerUnhealthy: Event<{ workerId: string; reason: WorkerUnhealthyReason }> = this._onWorkerUnhealthy.event;

	private readonly _onWorkerIdle = this._register(new Emitter<{ workerId: string; reason: WorkerIdleReason }>());
	public readonly onWorkerIdle: Event<{ workerId: string; reason: WorkerIdleReason }> = this._onWorkerIdle.event;

	private readonly _onProgressCheckDue = this._register(new Emitter<{ workerId: string }>());
	public readonly onProgressCheckDue: Event<{ workerId: string }> = this._onProgressCheckDue.event;

	constructor(config: Partial<HealthMonitorConfig> = {}, logService?: ILogService) {
		super();
		this._config = { ...DEFAULT_CONFIG, ...config };
		this._logService = logService;
		this._log('Initialized WorkerHealthMonitor', { idleTimeoutMs: this._config.idleTimeoutMs, stuckTimeoutMs: this._config.stuckTimeoutMs, progressCheckIntervalMs: this._config.progressCheckIntervalMs });
	}

	private _log(message: string, data?: Record<string, unknown>): void {
		const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
		this._logService?.info(`[ORCH-DEBUG][HealthMonitor] ${message}${dataStr}`);
	}

	/**
	 * Start monitoring a worker
	 */
	public startMonitoring(workerId: string): void {
		if (this._metrics.has(workerId)) {
			this._log('Worker already being monitored', { workerId });
			return;
		}

		this._metrics.set(workerId, {
			workerId,
			lastActivityTimestamp: Date.now(),
			consecutiveFailures: 0,
			consecutiveLoops: 0,
			toolCallCount: 0,
			errorRate: 0,
			isStuck: false,
			isLooping: false,
			isIdle: false,
			isExecuting: false, // Will be set true during execute()/run()
			idleInquiryPending: false,
			idleInquirySentAt: undefined,
			lastProgressCheckAt: Date.now(), // Initialize to now so first check is after interval
			recentToolCalls: [],
		});

		this._log('Started monitoring worker', { workerId, totalMonitored: this._metrics.size });

		// Start the check interval if not already running
		if (!this._checkInterval) {
			this._checkInterval = setInterval(() => this._checkStuckWorkers(), this._config.checkIntervalMs);
			this._log('Started health check interval', { intervalMs: this._config.checkIntervalMs });
		}
	}

	/**
	 * Stop monitoring a worker
	 */
	public stopMonitoring(workerId: string): void {
		const hadWorker = this._metrics.has(workerId);
		this._metrics.delete(workerId);

		this._log('Stopped monitoring worker', { workerId, wasMonitored: hadWorker, remainingMonitored: this._metrics.size });

		// Stop check interval if no more workers
		if (this._metrics.size === 0 && this._checkInterval) {
			clearInterval(this._checkInterval);
			this._checkInterval = undefined;
			this._log('Stopped health check interval (no workers left)');
		}
	}

	/**
	 * Record worker activity
	 */
	public recordActivity(workerId: string, type: 'tool_call' | 'message' | 'error' | 'success', toolName?: string): void {
		const metrics = this._metrics.get(workerId);
		if (!metrics) {
			this._log('recordActivity called for unknown worker', { workerId, type, toolName });
			return;
		}

		const wasIdle = metrics.isIdle;
		const wasStuck = metrics.isStuck;
		const hadPendingInquiry = metrics.idleInquiryPending;

		metrics.lastActivityTimestamp = Date.now();
		metrics.isStuck = false; // Activity means not stuck
		metrics.isIdle = false; // Activity means not idle
		// Clear idle inquiry state on activity
		if (metrics.idleInquiryPending) {
			metrics.idleInquiryPending = false;
			metrics.idleInquirySentAt = undefined;
		}

		this._log('Activity recorded', {
			workerId,
			type,
			toolName: toolName ?? null,
			wasIdle,
			wasStuck,
			clearedPendingInquiry: hadPendingInquiry,
		});

		switch (type) {
			case 'tool_call':
				metrics.toolCallCount++;
				if (toolName) {
					this._recordToolCall(metrics, toolName);
				}
				break;

			case 'error':
				metrics.consecutiveFailures++;
				this._log('Error recorded', { workerId, consecutiveFailures: metrics.consecutiveFailures, threshold: this._config.errorThreshold });
				if (metrics.consecutiveFailures >= this._config.errorThreshold) {
					this._log('FIRING onWorkerUnhealthy event (high_error_rate)', { workerId });
					this._onWorkerUnhealthy.fire({ workerId, reason: 'high_error_rate' });
				}
				break;

			case 'success':
				metrics.consecutiveFailures = 0;
				break;

			case 'message':
				// Reset loop detection on new message (natural conversation)
				metrics.recentToolCalls = [];
				metrics.consecutiveLoops = 0;
				metrics.isLooping = false;
				break;
		}
	}

	/**
	 * Record a tool call and check for looping
	 */
	private _recordToolCall(metrics: IWorkerHealthMetrics, toolName: string): void {
		metrics.recentToolCalls.push(toolName);

		// Keep only recent calls for loop detection
		if (metrics.recentToolCalls.length > this._config.loopThreshold * 2) {
			metrics.recentToolCalls = metrics.recentToolCalls.slice(-this._config.loopThreshold * 2);
		}

		// Check for looping: same tool called N times in a row
		const recent = metrics.recentToolCalls.slice(-this._config.loopThreshold);
		if (recent.length >= this._config.loopThreshold && recent.every(t => t === toolName)) {
			metrics.consecutiveLoops++;
			metrics.isLooping = true;
			this._onWorkerUnhealthy.fire({ workerId: metrics.workerId, reason: 'looping' });
		}
	}

	/**
	 * Get health metrics for a worker
	 */
	public getHealth(workerId: string): IWorkerHealthMetrics | undefined {
		return this._metrics.get(workerId);
	}

	/**
	 * Check if a worker is stuck
	 */
	public isStuck(workerId: string): boolean {
		const metrics = this._metrics.get(workerId);
		if (!metrics) {
			return false;
		}
		return metrics.isStuck || (Date.now() - metrics.lastActivityTimestamp > this._config.stuckTimeoutMs);
	}

	/**
	 * Check if a worker is looping
	 */
	public isLooping(workerId: string): boolean {
		const metrics = this._metrics.get(workerId);
		return metrics?.isLooping ?? false;
	}

	/**
	 * Check if a worker is idle (shorter timeout than stuck)
	 */
	public isIdle(workerId: string): boolean {
		const metrics = this._metrics.get(workerId);
		if (!metrics) {
			return false;
		}
		return metrics.isIdle || (Date.now() - metrics.lastActivityTimestamp > this._config.idleTimeoutMs);
	}

	/**
	 * Mark that an idle inquiry has been sent to this worker.
	 * This prevents duplicate inquiries while waiting for a response.
	 */
	public markIdleInquirySent(workerId: string): void {
		const metrics = this._metrics.get(workerId);
		if (metrics) {
			metrics.idleInquiryPending = true;
			metrics.idleInquirySentAt = Date.now();
			this._log('Marked idle inquiry sent', { workerId, sentAt: metrics.idleInquirySentAt });
		}
	}

	/**
	 * Check if an idle inquiry has been sent and is pending response.
	 */
	public hasIdleInquiryPending(workerId: string): boolean {
		const metrics = this._metrics.get(workerId);
		const pending = metrics?.idleInquiryPending ?? false;
		this._log('Checking idle inquiry pending', { workerId, pending, sentAt: metrics?.idleInquirySentAt ?? null });
		return pending;
	}

	/**
	 * Clear idle inquiry state after response received.
	 */
	public clearIdleInquiry(workerId: string): void {
		const metrics = this._metrics.get(workerId);
		if (metrics) {
			const wasWaiting = metrics.idleInquiryPending;
			const waitedMs = metrics.idleInquirySentAt ? Date.now() - metrics.idleInquirySentAt : 0;
			metrics.idleInquiryPending = false;
			metrics.idleInquirySentAt = undefined;
			this._log('Cleared idle inquiry state', { workerId, wasWaiting, waitedMs });
		}
	}

	/**
	 * Mark that a progress check has been sent to this worker.
	 * This updates the timestamp to prevent duplicate checks within the interval.
	 */
	public markProgressCheckSent(workerId: string): void {
		const metrics = this._metrics.get(workerId);
		if (metrics) {
			const timeSinceLastCheck = metrics.lastProgressCheckAt ? Date.now() - metrics.lastProgressCheckAt : 0;
			metrics.lastProgressCheckAt = Date.now();
			this._log('Marked progress check sent', { workerId, timeSinceLastCheckMs: timeSinceLastCheck });
		}
	}

	/**
	 * Mark execution start - worker is now inside executor.execute() or agentRunner.run().
	 * While executing, idle detection is suppressed to avoid false positives during "thinking".
	 */
	public markExecutionStart(workerId: string): void {
		const metrics = this._metrics.get(workerId);
		if (metrics) {
			metrics.isExecuting = true;
			metrics.lastActivityTimestamp = Date.now(); // Reset activity timestamp
			this._log('Marked execution start', { workerId });
		}
	}

	/**
	 * Mark execution end - worker has returned from execute()/run().
	 * Idle detection resumes normally.
	 */
	public markExecutionEnd(workerId: string): void {
		const metrics = this._metrics.get(workerId);
		if (metrics) {
			metrics.isExecuting = false;
			metrics.lastActivityTimestamp = Date.now(); // Reset activity timestamp
			this._log('Marked execution end', { workerId });
		}
	}

	/**
	 * Periodic check for idle, stuck workers, and progress checks
	 */
	private _checkStuckWorkers(): void {
		const now = Date.now();
		this._log('Running health check', { monitoredWorkers: this._metrics.size });

		for (const [workerId, metrics] of this._metrics) {
			const timeSinceActivity = now - metrics.lastActivityTimestamp;
			const timeSinceProgressCheck = now - (metrics.lastProgressCheckAt ?? 0);

			this._log('Checking worker health', {
				workerId,
				timeSinceActivityMs: timeSinceActivity,
				idleTimeoutMs: this._config.idleTimeoutMs,
				isIdle: metrics.isIdle,
				isStuck: metrics.isStuck,
				isExecuting: metrics.isExecuting,
				idleInquiryPending: metrics.idleInquiryPending,
				timeSinceProgressCheckMs: timeSinceProgressCheck,
			});

			// Check for idle first (shorter timeout)
			// Only fire idle event if:
			// 1. Worker is not already marked idle
			// 2. Worker is not already stuck
			// 3. No idle inquiry is already pending
			// 4. Idle timeout has been exceeded
			// 5. Worker is NOT currently executing (inside invoke()/run())
			//    - During execution, the worker may be "thinking" without producing output
			//    - We don't want to interrupt that with idle inquiries
			if (!metrics.isIdle && !metrics.isStuck && !metrics.idleInquiryPending &&
				!metrics.isExecuting && timeSinceActivity > this._config.idleTimeoutMs) {
				metrics.isIdle = true;
				this._log('FIRING onWorkerIdle event', { workerId, reason: 'no_activity', timeSinceActivityMs: timeSinceActivity });
				this._onWorkerIdle.fire({ workerId, reason: 'no_activity' });
			}

			// Check for periodic progress check (every 5 minutes)
			// Only fire if:
			// 1. Worker is not stuck (still active)
			// 2. Progress check interval has passed since last check
			// 3. Worker IS executing (we want progress reports during long executions)
			if (!metrics.isStuck && metrics.isExecuting && timeSinceProgressCheck > this._config.progressCheckIntervalMs) {
				// Fire the event - the handler is responsible for calling markProgressCheckSent
				this._log('FIRING onProgressCheckDue event', { workerId, timeSinceProgressCheckMs: timeSinceProgressCheck, intervalMs: this._config.progressCheckIntervalMs });
				this._onProgressCheckDue.fire({ workerId });
			}

			// Check for stuck (longer timeout)
			// This fires even during execution - if no activity for 5+ minutes, something's wrong
			if (!metrics.isStuck && timeSinceActivity > this._config.stuckTimeoutMs) {
				metrics.isStuck = true;
				this._log('FIRING onWorkerUnhealthy event (stuck)', { workerId, timeSinceActivityMs: timeSinceActivity, stuckTimeoutMs: this._config.stuckTimeoutMs });
				this._onWorkerUnhealthy.fire({ workerId, reason: 'stuck' });
			}
		}
	}

	public override dispose(): void {
		if (this._checkInterval) {
			clearInterval(this._checkInterval);
			this._checkInterval = undefined;
		}
		this._metrics.clear();
		super.dispose();
	}
}
