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
	recentToolCalls: string[];
}

/**
 * Reasons why a worker might be unhealthy
 */
export type WorkerUnhealthyReason = 'stuck' | 'looping' | 'high_error_rate';

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
	onWorkerUnhealthy: Event<{ workerId: string; reason: WorkerUnhealthyReason }>;
}

/**
 * Configuration for the health monitor
 */
interface HealthMonitorConfig {
	/** Timeout in ms before a worker is considered stuck (default: 5 minutes) */
	stuckTimeoutMs: number;
	/** Number of consecutive same-tool calls before considering the worker looping */
	loopThreshold: number;
	/** Number of consecutive errors before firing high_error_rate event */
	errorThreshold: number;
	/** Interval for checking stuck workers (default: 30 seconds) */
	checkIntervalMs: number;
}

const DEFAULT_CONFIG: HealthMonitorConfig = {
	stuckTimeoutMs: 5 * 60 * 1000, // 5 minutes
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
	 * Periodic check for stuck workers
	 */
	private _checkStuckWorkers(): void {
		const now = Date.now();

		for (const [workerId, metrics] of this._metrics) {
			if (!metrics.isStuck && now - metrics.lastActivityTimestamp > this._config.stuckTimeoutMs) {
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
