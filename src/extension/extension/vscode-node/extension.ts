/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionContext } from 'vscode';
import { resolve } from '../../../util/vs/base/common/path';
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
	}

	return activationResult;
}
