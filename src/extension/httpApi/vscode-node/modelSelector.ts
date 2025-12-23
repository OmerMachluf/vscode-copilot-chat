/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { IModelSelector } from '../common/modelSelector';

/**
 * Default implementation of IModelSelector that uses VS Code's language model API.
 */
export class VsCodeModelSelector implements IModelSelector {
	declare _serviceBrand: undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
	) { }

	/**
	 * Select an appropriate language model for the agent.
	 * Tries to match the requested modelId, then copilot models, then any available model.
	 */
	async selectModel(
		_agentType: string,
		requestedModelId?: string
	): Promise<vscode.LanguageModelChat | undefined> {
		try {
			// If a specific model is requested, try to find it
			if (requestedModelId) {
				const requestedModels = await vscode.lm.selectChatModels({ id: requestedModelId });
				if (requestedModels.length > 0) {
					this.logService.trace(`[HttpApi] Using requested model: ${requestedModelId}`);
					return requestedModels[0];
				}
				// Try matching by family if id didn't work
				const familyModels = await vscode.lm.selectChatModels({ family: requestedModelId });
				if (familyModels.length > 0) {
					this.logService.trace(`[HttpApi] Using model from family: ${requestedModelId}`);
					return familyModels[0];
				}
				this.logService.warn(`[HttpApi] Requested model '${requestedModelId}' not found, falling back to default`);
			}

			// Try to get copilot models first (preferred)
			let models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
			if (models.length > 0) {
				this.logService.trace(`[HttpApi] Using Copilot model: ${models[0].id}`);
				return models[0];
			}

			// Try specific model families
			models = await vscode.lm.selectChatModels({ family: 'gpt-4' });
			if (models.length > 0) {
				this.logService.trace(`[HttpApi] Using GPT-4 family model: ${models[0].id}`);
				return models[0];
			}

			// Fall back to any available model
			models = await vscode.lm.selectChatModels();
			if (models.length > 0) {
				this.logService.trace(`[HttpApi] Using fallback model: ${models[0].id}`);
				return models[0];
			}

			this.logService.warn('[HttpApi] No language models available');
			return undefined;
		} catch (error) {
			this.logService.error(error instanceof Error ? error : new Error(String(error)), '[HttpApi] Error selecting model');
			return undefined;
		}
	}
}
