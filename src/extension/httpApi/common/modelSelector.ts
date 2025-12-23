/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';

/**
 * Service identifier for the model selector.
 */
export const IModelSelector = createServiceIdentifier<IModelSelector>('IModelSelector');

/**
 * Interface for selecting language models.
 * This abstraction allows the node-based route to remain independent of direct vscode imports.
 */
export interface IModelSelector {
	readonly _serviceBrand: undefined;

	/**
	 * Select an appropriate language model for the agent.
	 * @param agentType The type of agent requesting the model
	 * @param requestedModelId Optional specific model ID to use
	 * @returns The selected language model, or undefined if none available
	 */
	selectModel(agentType: string, requestedModelId?: string): Promise<vscode.LanguageModelChat | undefined>;
}
