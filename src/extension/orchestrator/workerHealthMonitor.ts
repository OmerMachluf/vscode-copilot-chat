/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
	/** Whether an idle inquiry has been sent and is awaiting response */
	idleInquiryPending: boolean;
	/** Timestamp when idle inquiry was sent (for timeout tracking) */
	idleInquirySentAt?: number;
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
	onWorkerUnhealthy: Event<{ workerId: string; reason: WorkerUnhealthyReason }>;
	/** Event fired when a worker goes idle (before being marked stuck) */
	onWorkerIdle: Event<{ workerId: string; reason: WorkerIdleReason }>;
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
}

const DEFAULT_CONFIG: HealthMonitorConfig = {
	stuckTimeoutMs: 5 * 60 * 1000, // 5 minutes
	idleTimeoutMs: 30 * 1000, // 30 seconds - shorter threshold to detect idle before stuck
	loopThreshold: 5,
	errorThreshold: 5,
	checkIntervalMs: 30 * 1000, // 30 seconds
};

/**
 * Worker health monitor implementation
 * Tracks worker activity and detects stuck/looping workers
 */
export class WorkerHealthMonitor extends Disposable implements IWorkerHealthMonitor {
	private readonly _metrics = new Map<string, IWorkerHealthMetrics>();
	private readonly _config: HealthMonitorConfig;
	private _checkInterval: ReturnType<typeof setInterval> | undefined;

	private readonly _onWorkerUnhealthy = this._register(new Emitter<{ workerId: string; reason: WorkerUnhealthyReason }>());
	public readonly onWorkerUnhealthy: Event<{ workerId: string; reason: WorkerUnhealthyReason }> = this._onWorkerUnhealthy.event;

	private readonly _onWorkerIdle = this._register(new Emitter<{ workerId: string; reason: WorkerIdleReason }>());
	public readonly onWorkerIdle: Event<{ workerId: string; reason: WorkerIdleReason }> = this._onWorkerIdle.event;

	constructor(config: Partial<HealthMonitorConfig> = {}) {
		super();
		this._config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Start monitoring a worker
	 */
	public startMonitoring(workerId: string): void {
		if (this._metrics.has(workerId)) {
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
			idleInquiryPending: false,
			idleInquirySentAt: undefined,
			recentToolCalls: [],
		});

		// Start the check interval if not already running
		if (!this._checkInterval) {
			this._checkInterval = setInterval(() => this._checkStuckWorkers(), this._config.checkIntervalMs);
		}
	}

	/**
	 * Stop monitoring a worker
	 */
	public stopMonitoring(workerId: string): void {
		this._metrics.delete(workerId);

		// Stop check interval if no more workers
		if (this._metrics.size === 0 && this._checkInterval) {
			clearInterval(this._checkInterval);
			this._checkInterval = undefined;
		}
	}

	/**
	 * Record worker activity
	 */
	public recordActivity(workerId: string, type: 'tool_call' | 'message' | 'error' | 'success', toolName?: string): void {
		const metrics = this._metrics.get(workerId);
		if (!metrics) {
			return;
		}

		metrics.lastActivityTimestamp = Date.now();
		metrics.isStuck = false; // Activity means not stuck
		metrics.isIdle = false; // Activity means not idle
		// Clear idle inquiry state on activity
		if (metrics.idleInquiryPending) {
			metrics.idleInquiryPending = false;
			metrics.idleInquirySentAt = undefined;
		}

		switch (type) {
			case 'tool_call':
				metrics.toolCallCount++;
				if (toolName) {
					this._recordToolCall(metrics, toolName);
				}
				break;

			case 'error':
				metrics.consecutiveFailures++;
				if (metrics.consecutiveFailures >= this._config.errorThreshold) {
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
		}
	}

	/**
	 * Check if an idle inquiry has been sent and is pending response.
	 */
	public hasIdleInquiryPending(workerId: string): boolean {
		const metrics = this._metrics.get(workerId);
		return metrics?.idleInquiryPending ?? false;
	}

	/**
	 * Clear idle inquiry state after response received.
	 */
	public clearIdleInquiry(workerId: string): void {
		const metrics = this._metrics.get(workerId);
		if (metrics) {
			metrics.idleInquiryPending = false;
			metrics.idleInquirySentAt = undefined;
		}
	}

	/**
	 * Periodic check for idle and stuck workers
	 */
	private _checkStuckWorkers(): void {
		const now = Date.now();

		for (const [workerId, metrics] of this._metrics) {
			const timeSinceActivity = now - metrics.lastActivityTimestamp;

			// Check for idle first (shorter timeout)
			// Only fire idle event if:
			// 1. Worker is not already marked idle
			// 2. Worker is not already stuck
			// 3. No idle inquiry is already pending
			// 4. Idle timeout has been exceeded
			if (!metrics.isIdle && !metrics.isStuck && !metrics.idleInquiryPending &&
				timeSinceActivity > this._config.idleTimeoutMs) {
				metrics.isIdle = true;
				this._onWorkerIdle.fire({ workerId, reason: 'no_activity' });
			}

			// Check for stuck (longer timeout)
			if (!metrics.isStuck && timeSinceActivity > this._config.stuckTimeoutMs) {
				metrics.isStuck = true;
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
