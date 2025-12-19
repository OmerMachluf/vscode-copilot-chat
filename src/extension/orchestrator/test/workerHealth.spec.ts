/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from '../circuitBreaker';
import { WorkerHealthMonitor, WorkerIdleReason, WorkerUnhealthyReason } from '../workerHealthMonitor';

describe('WorkerHealthMonitor', () => {
	let monitor: WorkerHealthMonitor;

	beforeEach(() => {
		monitor = new WorkerHealthMonitor();
	});

	afterEach(() => {
		monitor.dispose();
	});

	it('tracks activity correctly', () => {
		const workerId = 'worker-1';
		monitor.startMonitoring(workerId);

		monitor.recordActivity(workerId, 'tool_call', 'read_file');
		let health = monitor.getHealth(workerId);
		expect(health?.toolCallCount).toBe(1);

		monitor.recordActivity(workerId, 'error');
		health = monitor.getHealth(workerId);
		expect(health?.consecutiveFailures).toBe(1);

		monitor.recordActivity(workerId, 'success');
		health = monitor.getHealth(workerId);
		expect(health?.consecutiveFailures).toBe(0);
	});

	it('detects loops', () => {
		const workerId = 'worker-loop';
		monitor.startMonitoring(workerId);

		let unhealthyEvent: { workerId: string; reason: WorkerUnhealthyReason } | undefined;
		monitor.onWorkerUnhealthy((e: { workerId: string; reason: WorkerUnhealthyReason }) => { unhealthyEvent = e; });

		// Call same tool 5 times
		for (let i = 0; i < 5; i++) {
			monitor.recordActivity(workerId, 'tool_call', 'same_tool');
		}

		expect(monitor.isLooping(workerId)).toBe(true);
		expect(unhealthyEvent).toEqual({ workerId, reason: 'looping' });
	});

	it('detects high error rate (consecutive failures)', () => {
		const workerId = 'worker-error';
		monitor.startMonitoring(workerId);

		let unhealthyEvent: { workerId: string; reason: WorkerUnhealthyReason } | undefined;
		monitor.onWorkerUnhealthy((e: { workerId: string; reason: WorkerUnhealthyReason }) => { unhealthyEvent = e; });

		// 5 consecutive errors
		for (let i = 0; i < 5; i++) {
			monitor.recordActivity(workerId, 'error');
		}

		expect(unhealthyEvent).toEqual({ workerId, reason: 'high_error_rate' });
	});

	describe('Error Event Notification', () => {
		it('fires onWorkerUnhealthy event immediately upon reaching error threshold', () => {
			const workerId = 'worker-error-immediate';
			monitor.startMonitoring(workerId);

			const events: { workerId: string; reason: WorkerUnhealthyReason }[] = [];
			monitor.onWorkerUnhealthy(e => events.push(e));

			// Record 4 errors (below threshold)
			for (let i = 0; i < 4; i++) {
				monitor.recordActivity(workerId, 'error');
			}
			expect(events).toHaveLength(0);

			// 5th error should trigger the event immediately
			monitor.recordActivity(workerId, 'error');
			expect(events).toHaveLength(1);
			expect(events[0].reason).toBe('high_error_rate');
		});

		it('tracks consecutive failures correctly after errors', () => {
			const workerId = 'worker-failure-tracking';
			monitor.startMonitoring(workerId);

			monitor.recordActivity(workerId, 'error');
			monitor.recordActivity(workerId, 'error');
			monitor.recordActivity(workerId, 'error');

			let health = monitor.getHealth(workerId);
			expect(health?.consecutiveFailures).toBe(3);

			// Success resets the counter
			monitor.recordActivity(workerId, 'success');
			health = monitor.getHealth(workerId);
			expect(health?.consecutiveFailures).toBe(0);

			// Start counting again
			monitor.recordActivity(workerId, 'error');
			monitor.recordActivity(workerId, 'error');
			health = monitor.getHealth(workerId);
			expect(health?.consecutiveFailures).toBe(2);
		});

		it('fires multiple unhealthy events for continued errors after threshold', () => {
			// Create monitor with lower threshold for testing
			const customMonitor = new WorkerHealthMonitor({ errorThreshold: 3 });

			const workerId = 'worker-multiple-errors';
			customMonitor.startMonitoring(workerId);

			const events: { workerId: string; reason: WorkerUnhealthyReason }[] = [];
			customMonitor.onWorkerUnhealthy(e => events.push(e));

			// 3 errors to trigger first event
			for (let i = 0; i < 3; i++) {
				customMonitor.recordActivity(workerId, 'error');
			}
			expect(events).toHaveLength(1);

			// Success resets counter
			customMonitor.recordActivity(workerId, 'success');

			// 3 more errors should trigger another event
			for (let i = 0; i < 3; i++) {
				customMonitor.recordActivity(workerId, 'error');
			}
			expect(events).toHaveLength(2);

			customMonitor.dispose();
		});

		it('does not fire error events for unknown workers', () => {
			const events: { workerId: string; reason: WorkerUnhealthyReason }[] = [];
			monitor.onWorkerUnhealthy(e => events.push(e));

			// Try to record errors for a worker that was never started
			for (let i = 0; i < 10; i++) {
				monitor.recordActivity('unknown-worker', 'error');
			}

			expect(events).toHaveLength(0);
		});

		it('correctly identifies different error types through consecutive failures', () => {
			const workerId = 'worker-error-types';
			monitor.startMonitoring(workerId);

			const events: { workerId: string; reason: WorkerUnhealthyReason }[] = [];
			monitor.onWorkerUnhealthy(e => events.push(e));

			// Mix of activities
			monitor.recordActivity(workerId, 'tool_call', 'read_file');
			monitor.recordActivity(workerId, 'error'); // 1
			monitor.recordActivity(workerId, 'tool_call', 'write_file');
			monitor.recordActivity(workerId, 'error'); // 2 (consecutive from last error)
			monitor.recordActivity(workerId, 'error'); // 3
			monitor.recordActivity(workerId, 'error'); // 4
			monitor.recordActivity(workerId, 'error'); // 5 - triggers

			expect(events).toHaveLength(1);
			expect(events[0].reason).toBe('high_error_rate');
		});
	});

	describe('Error threshold configuration', () => {
		it('respects custom error threshold', () => {
			const customMonitor = new WorkerHealthMonitor({ errorThreshold: 2 });
			const workerId = 'worker-custom-threshold';
			customMonitor.startMonitoring(workerId);

			const events: { workerId: string; reason: WorkerUnhealthyReason }[] = [];
			customMonitor.onWorkerUnhealthy(e => events.push(e));

			// 1 error
			customMonitor.recordActivity(workerId, 'error');
			expect(events).toHaveLength(0);

			// 2nd error should trigger with threshold of 2
			customMonitor.recordActivity(workerId, 'error');
			expect(events).toHaveLength(1);

			customMonitor.dispose();
		});
	});

	describe('Idle detection with errors', () => {
		it('clears idle state when error is recorded', () => {
			const workerId = 'worker-idle-error';
			monitor.startMonitoring(workerId);

			// Manually set idle state
			const health = monitor.getHealth(workerId);
			if (health) {
				health.isIdle = true;
			}

			// Recording any activity (including error) should clear idle state
			monitor.recordActivity(workerId, 'error');

			expect(monitor.getHealth(workerId)?.isIdle).toBe(false);
		});

		it('clears pending idle inquiry when error is recorded', () => {
			const workerId = 'worker-idle-inquiry-error';
			monitor.startMonitoring(workerId);

			// Mark idle inquiry as sent
			monitor.markIdleInquirySent(workerId);
			expect(monitor.hasIdleInquiryPending(workerId)).toBe(true);

			// Recording error should clear the inquiry
			monitor.recordActivity(workerId, 'error');
			expect(monitor.hasIdleInquiryPending(workerId)).toBe(false);
		});
	});

	describe('onWorkerIdle event', () => {
		it('fires onWorkerIdle when worker is idle (no activity) and not executing', async () => {
			// Create monitor with short timeout for testing
			const customMonitor = new WorkerHealthMonitor({
				idleTimeoutMs: 50,
				checkIntervalMs: 25,
			});

			const workerId = 'worker-idle-test';
			customMonitor.startMonitoring(workerId);

			const idleEvents: { workerId: string; reason: WorkerIdleReason }[] = [];
			customMonitor.onWorkerIdle(e => idleEvents.push(e));

			// Wait for idle timeout
			await new Promise(resolve => setTimeout(resolve, 100));

			expect(idleEvents.length).toBeGreaterThanOrEqual(1);
			expect(idleEvents[0].workerId).toBe(workerId);
			expect(idleEvents[0].reason).toBe('no_activity');

			customMonitor.dispose();
		});

		it('does not fire onWorkerIdle when worker is executing', async () => {
			const customMonitor = new WorkerHealthMonitor({
				idleTimeoutMs: 50,
				checkIntervalMs: 25,
			});

			const workerId = 'worker-executing-test';
			customMonitor.startMonitoring(workerId);

			const idleEvents: { workerId: string; reason: WorkerIdleReason }[] = [];
			customMonitor.onWorkerIdle(e => idleEvents.push(e));

			// Mark as executing
			customMonitor.markExecutionStart(workerId);

			// Wait past idle timeout
			await new Promise(resolve => setTimeout(resolve, 100));

			// Should not have fired idle event while executing
			expect(idleEvents).toHaveLength(0);

			customMonitor.dispose();
		});
	});
});

describe('CircuitBreaker', () => {
	let breaker: CircuitBreaker;

	beforeEach(() => {
		breaker = new CircuitBreaker();
	});

	it('starts closed', () => {
		expect(breaker.state).toBe('closed');
		expect(breaker.canExecute()).toBe(true);
	});

	it('opens after threshold failures', () => {
		// Threshold is 3
		breaker.recordFailure();
		expect(breaker.state).toBe('closed');

		breaker.recordFailure();
		expect(breaker.state).toBe('closed');

		breaker.recordFailure();
		expect(breaker.state).toBe('open');
		expect(breaker.canExecute()).toBe(false);
	});

	it('resets on success', () => {
		breaker.recordFailure();
		breaker.recordFailure();
		expect(breaker.failureCount).toBe(2);

		breaker.recordSuccess();
		expect(breaker.failureCount).toBe(0);
		expect(breaker.state).toBe('closed');
	});

	it('transitions to half-open after timeout', async () => {
		// Mock Date.now
		const originalNow = Date.now;
		let now = 1000;
		Date.now = () => now;

		try {
			// Trip the breaker
			breaker.recordFailure();
			breaker.recordFailure();
			breaker.recordFailure();
			expect(breaker.state).toBe('open');

			// Advance time past 30s timeout
			now += 31000;
			expect(breaker.state).toBe('half-open');

			// Success should close it
			breaker.recordSuccess();
			expect(breaker.state).toBe('closed');
		} finally {
			Date.now = originalNow;
		}
	});
});
