/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../circuitBreaker';
import { WorkerHealthMonitor, WorkerUnhealthyReason } from '../workerHealthMonitor';

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
