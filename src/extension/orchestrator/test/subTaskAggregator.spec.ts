/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SubTaskResultAggregator } from '../subTaskAggregator';
import { ISubTaskManager, ISubTaskResult } from '../subTaskManager';
import { describe, it, expect, beforeEach } from 'vitest';

function makeResult(id: string, status: 'success' | 'partial' | 'failed' | 'timeout', output: string): ISubTaskResult {
	return { taskId: id, status, output };
}

describe('SubTaskResultAggregator', () => {
	let aggregator: SubTaskResultAggregator;

	beforeEach(() => {
		aggregator = new SubTaskResultAggregator();
	});

	it('aggregates all successful results', async () => {
		aggregator.cacheResult(makeResult('a', 'success', 'Output A'));
		aggregator.cacheResult(makeResult('b', 'success', 'Output B'));
		aggregator.cacheResult(makeResult('c', 'success', 'Output C'));
		const results = await aggregator.collectResults(['a', 'b', 'c']);
		expect(results.allSucceeded).toBe(true);
		expect(results.failedCount).toBe(0);
		expect(results.timedOutCount).toBe(0);
		expect(results.results.length).toBe(3);
		const formatted = aggregator.formatForContext(results);
		expect(formatted).toContain('Sub-task results:');
	});

	it('handles mixed results (partial)', async () => {
		aggregator.cacheResult(makeResult('a', 'success', 'Output A'));
		aggregator.cacheResult(makeResult('b', 'failed', 'Error B'));
		aggregator.cacheResult(makeResult('c', 'success', 'Output C'));
		const results = await aggregator.collectResults(['a', 'b', 'c']);
		expect(results.allSucceeded).toBe(false);
		expect(results.failedCount).toBe(1);
		const formatted = aggregator.formatForContext(results);
		expect(formatted).toContain('Failed: 1');
	});

	it('handles timeout with partial results', async () => {
		aggregator.cacheResult(makeResult('a', 'success', 'Output A'));
		aggregator.cacheResult(makeResult('b', 'timeout', 'Timeout B'));
		const results = await aggregator.collectResults(['a', 'b', 'c']);
		expect(results.timedOutCount).toBe(1);
		const formatted = aggregator.formatForContext(results);
		expect(formatted).toContain('Timed out: 1');
	});

	it('summarizes large results', async () => {
		const bigOutput = 'X'.repeat(500);
		aggregator.cacheResult(makeResult('a', 'success', bigOutput));
		const results = await aggregator.collectResults(['a']);
		const formatted = aggregator.formatForContext(results);
		expect(formatted).toContain('...');
	});

	it('caches and re-queries results', () => {
		const result = makeResult('a', 'success', 'Output A');
		aggregator.cacheResult(result);
		const cached = aggregator.getCachedResult('a');
		expect(cached).toEqual(result);
	});
});
