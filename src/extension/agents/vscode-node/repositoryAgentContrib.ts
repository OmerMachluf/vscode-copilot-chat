/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IExtensionContribution } from '../../common/contributions';
import { RepositoryAgentProvider } from './repositoryAgentProvider';

/**
 * Registers the RepositoryAgentProvider with VS Code's custom agents system.
 * This allows agents from .github/agents/ to appear in the UI without package.json declarations.
 */
export class RepositoryAgentContribution extends Disposable implements IExtensionContribution {
	readonly id = 'RepositoryAgents';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@ILogService logService: ILogService,
	) {
		super();

		// Check if VS Code supports custom agents provider API
		if ('registerCustomAgentsProvider' in vscode.chat) {
			logService.info('[RepositoryAgentContribution] Registering RepositoryAgentProvider...');
			const provider = instantiationService.createInstance(RepositoryAgentProvider);
			this._register(vscode.chat.registerCustomAgentsProvider(provider));
			logService.info('[RepositoryAgentContribution] ✅ RepositoryAgentProvider registered successfully');
		} else {
			logService.warn('[RepositoryAgentContribution] VS Code does not support registerCustomAgentsProvider API');
		}
	}
}
