/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISubTaskManager } from './orchestratorInterfaces';
import { IAggregatedResults, SubTaskResultAggregator } from './subTaskAggregator';

export async function injectSubTaskResultsIntoContext(
	parentAgentContext: any,
	subTaskIds: string[],
	subTaskManager: ISubTaskManager,
	aggregator: SubTaskResultAggregator
): Promise<any> {
	const aggregated: IAggregatedResults = await aggregator.collectResults(subTaskIds);
	const formatted = aggregator.formatForContext(aggregated);
	// Inject into parent context (structure depends on parentAgentContext type)
	if (parentAgentContext && typeof parentAgentContext === 'object') {
		parentAgentContext.subTaskResults = {
			results: aggregated.results,
			formatted,
			allSucceeded: aggregated.allSucceeded,
			failedCount: aggregated.failedCount,
			timedOutCount: aggregated.timedOutCount,
		};
	}
	return parentAgentContext;
}
