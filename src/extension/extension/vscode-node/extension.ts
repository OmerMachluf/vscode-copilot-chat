/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionContext, workspace } from 'vscode';
import { resolve } from '../../../util/vs/base/common/path';
import { URI } from '../../../util/vs/base/common/uri';
import { IClaudeMigrationService } from '../../orchestrator/claudeMigrationService';
import { activateWorker } from '../../orchestrator/workerMain';
import { baseActivate } from '../vscode/extension';
import { vscodeNodeContributions } from './contributions';
import { registerServices } from './services';

// ###############################################################################################
// ###                                                                                         ###
// ###                 Node extension that runs ONLY in node.js extension host.                ###
// ###                                                                                         ###
// ### !!! Prefer to add code in ../vscode/extension.ts to support all extension runtimes !!!  ###
// ###                                                                                         ###
// ###############################################################################################

//#region TODO@bpasero this needs cleanup
import '../../intents/node/allIntents';

function configureDevPackages() {
	try {
		const sourceMapSupport = require('source-map-support');
		sourceMapSupport.install();
		const dotenv = require('dotenv');
		dotenv.config({ path: [resolve(__dirname, '../.env')] });
	} catch (err) {
		console.error(err);
	}
}
//#endregion

export async function activate(context: ExtensionContext, forceActivation?: boolean) {
	try { require('fs').writeFileSync(require('path').join(require('os').tmpdir(), 'copilot_worker_debug.log'), `Activation! WorkerMode: ${process.env.COPILOT_WORKER_MODE}\n`); } catch (e) { }
	const activationResult = await baseActivate({
		context,
		registerServices,
		contributions: vscodeNodeContributions,
		configureDevPackages,
		forceActivation
	});

	if (process.env.COPILOT_WORKER_MODE) {
		// @ts-ignore
		const instantiationService = activationResult.instantiationService;
		await activateWorker(context, instantiationService);
	} else {
		// @ts-ignore - activationResult has instantiationService in non-test mode
		const instantiationService = activationResult.instantiationService;
		if (instantiationService) {
			// Run Claude migration asynchronously (don't block activation)
			runClaudeMigration(context, instantiationService).catch(() => { /* ignore errors */ });
		}
	}

	return activationResult;
}

/**
 * Runs Claude configuration migration and sets up file watchers for auto-sync.
 * This syncs from .github/agents/ and .github/instructions/ to .claude/ format.
 */
async function runClaudeMigration(context: ExtensionContext, instantiationService: any): Promise<void> {
	try {
		const migrationService = instantiationService.invokeFunction((accessor: any) => accessor.get(IClaudeMigrationService));

		// Set extension URI to enable loading built-in agents from assets/agents/
		// Use URI.parse() to convert vscode.Uri to our internal URI type
		const extensionUri = URI.parse(context.extensionUri.toString());
		migrationService.setExtensionUri(extensionUri);
		console.log('[Claude Migration] Extension URI set to:', extensionUri.toString());

		// Run initial migration if needed
		const shouldMigrate = await migrationService.shouldMigrate();
		console.log('[Claude Migration] shouldMigrate:', shouldMigrate);
		if (shouldMigrate) {
			const result = await migrationService.migrate();
			console.log('[Claude Migration] Migration result:', result.status, 'files:', result.generatedFiles.length);
		}

		// Set up file watcher to re-sync when .github/ files change
		const watchPattern = '**/.github/{agents,instructions}/**/*.md';
		const watcher = workspace.createFileSystemWatcher(watchPattern);

		const triggerMigration = async () => {
			try {
				await migrationService.regenerate();
			} catch {
				// Silently ignore migration errors
			}
		};

		watcher.onDidCreate(triggerMigration);
		watcher.onDidChange(triggerMigration);
		watcher.onDidDelete(triggerMigration);

		context.subscriptions.push(watcher);
	} catch {
		// Silently ignore migration errors - it's a convenience feature
	}
}
