/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISubTaskResult } from './subTaskManager';

export interface IAggregatedResults {
	allSucceeded: boolean;
	results: ISubTaskResult[];
	summary: string;
	failedCount: number;
	timedOutCount: number;
}

export class SubTaskResultAggregator {
	private _resultsCache = new Map<string, ISubTaskResult>();

	cacheResult(result: ISubTaskResult): void {
		this._resultsCache.set(result.taskId, result);
	}

	getCachedResult(subTaskId: string): ISubTaskResult | undefined {
		return this._resultsCache.get(subTaskId);
	}

	async collectResults(subTaskIds: string[]): Promise<IAggregatedResults> {
		const results: ISubTaskResult[] = [];
		let failedCount = 0;
		let timedOutCount = 0;

		for (const id of subTaskIds) {
			const result = this._resultsCache.get(id);
			if (result) {
				results.push(result);
				if (result.status === 'failed') {
					failedCount++;
				} else if (result.status === 'timeout') {
					timedOutCount++;
				}
			} else {
				// If result is missing, treat as pending or unknown, but for aggregation purposes we might mark as failed or missing
				// For now, let's assume missing means failed/timeout if we are collecting final results
				failedCount++;
				results.push({ taskId: id, status: 'failed', output: 'Result not found' });
			}
		}

		const allSucceeded = failedCount === 0 && timedOutCount === 0;
		const summary = this.formatForContext({ allSucceeded, results, summary: '', failedCount, timedOutCount });

		return {
			allSucceeded,
			results,
			summary,
			failedCount,
			timedOutCount
		};
	}

	formatForContext(results: IAggregatedResults): string {
		let summary = `Sub-task results: ${results.allSucceeded ? 'All Succeeded' : 'Mixed Results'}\n`;
		summary += `Total: ${results.results.length}, Failed: ${results.failedCount}, Timed out: ${results.timedOutCount}\n\n`;

		for (const result of results.results) {
			summary += `Task ${result.taskId} (${result.status}):\n`;
			let output = result.output || '';
			if (output.length > 200) {
				output = output.substring(0, 200) + '...';
			}
			summary += `${output}\n---\n`;
		}
		return summary;
	}
}
