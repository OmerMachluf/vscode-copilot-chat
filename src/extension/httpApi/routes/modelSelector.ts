/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { ModelSelector } from '../node/routes/chatRoute';

/**
 * Creates a model selector function that selects appropriate language models.
 * This is defined outside the node/ directory where vscode runtime imports are allowed.
 */
export function createDefaultModelSelector(): ModelSelector {
	return async (_agentType: string): Promise<vscode.LanguageModelChat | undefined> => {
		// Try to get copilot models first (preferred)
		let models = await vscode.lm.selectChatModels({ vendor: 'copilot' });

		// Try specific model families based on agent type
		if (models.length === 0) {
			models = await vscode.lm.selectChatModels({ family: 'gpt-4' });
		}

		// Fall back to any available model
		if (models.length === 0) {
			models = await vscode.lm.selectChatModels();
		}

		return models[0];
	};
}
