/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { Intent } from '../../common/constants';
import { IDefaultIntentRequestHandlerOptions } from '../../prompt/node/defaultIntentRequestHandler';
import { ICodeMapperService } from '../../prompts/node/codeMapper/codeMapperService';
import { AgentIntentInvocation } from './agentIntent';
import { EditCodeIntent } from './editCodeIntent';

/**
 * Orchestrator Intent - Coordinates multi-agent workflows and parallel task execution
 */
export class OrchestratorIntent extends EditCodeIntent {

	static override readonly ID = Intent.Orchestrator;

	override readonly id = OrchestratorIntent.ID;

	override readonly description = l10n.t('Coordinate multi-agent workflows and parallel task execution');

	override readonly locations = [ChatLocation.Panel];

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IEndpointProvider endpointProvider: IEndpointProvider,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService,
		@ICodeMapperService codeMapperService: ICodeMapperService,
		@IWorkspaceService workspaceService: IWorkspaceService,
	) {
		super(instantiationService, endpointProvider, configurationService, expService, codeMapperService, workspaceService, { intentInvocation: AgentIntentInvocation, processCodeblocks: false });
	}

	protected override getIntentHandlerOptions(_request: vscode.ChatRequest): IDefaultIntentRequestHandlerOptions | undefined {
		return {
			maxToolCallIterations: 50,
			temperature: 0,
			overrideRequestLocation: ChatLocation.Agent,
			hideRateLimitTimeEstimate: true
		};
	}
}

/**
 * Planner Intent - Creates high-level workflow plans for complex tasks
 */
export class PlannerIntent extends EditCodeIntent {

	static override readonly ID = Intent.Planner;

	override readonly id = PlannerIntent.ID;

	override readonly description = l10n.t('Create high-level workflow plans for complex development tasks');

	override readonly locations = [ChatLocation.Panel];

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IEndpointProvider endpointProvider: IEndpointProvider,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService,
		@ICodeMapperService codeMapperService: ICodeMapperService,
		@IWorkspaceService workspaceService: IWorkspaceService,
	) {
		super(instantiationService, endpointProvider, configurationService, expService, codeMapperService, workspaceService, { intentInvocation: AgentIntentInvocation, processCodeblocks: false });
	}

	protected override getIntentHandlerOptions(_request: vscode.ChatRequest): IDefaultIntentRequestHandlerOptions | undefined {
		return {
			maxToolCallIterations: 30,
			temperature: 0.2, // Slightly creative for planning
			overrideRequestLocation: ChatLocation.Agent,
			hideRateLimitTimeEstimate: true
		};
	}
}

/**
 * Architect Intent - Designs technical implementations with file-level specificity
 */
export class ArchitectIntent extends EditCodeIntent {

	static override readonly ID = Intent.Architect;

	override readonly id = ArchitectIntent.ID;

	override readonly description = l10n.t('Design technical implementations with file-level specificity');

	override readonly locations = [ChatLocation.Panel];

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IEndpointProvider endpointProvider: IEndpointProvider,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService,
		@ICodeMapperService codeMapperService: ICodeMapperService,
		@IWorkspaceService workspaceService: IWorkspaceService,
	) {
		super(instantiationService, endpointProvider, configurationService, expService, codeMapperService, workspaceService, { intentInvocation: AgentIntentInvocation, processCodeblocks: false });
	}

	protected override getIntentHandlerOptions(_request: vscode.ChatRequest): IDefaultIntentRequestHandlerOptions | undefined {
		return {
			maxToolCallIterations: 30,
			temperature: 0.1, // Low temperature for precise technical design
			overrideRequestLocation: ChatLocation.Agent,
			hideRateLimitTimeEstimate: true
		};
	}
}

/**
 * Reviewer Intent - Reviews code changes for quality and correctness
 */
export class ReviewerIntent extends EditCodeIntent {

	static override readonly ID = Intent.Reviewer;

	override readonly id = ReviewerIntent.ID;

	override readonly description = l10n.t('Review code changes for quality, correctness, and best practices');

	override readonly locations = [ChatLocation.Panel];

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IEndpointProvider endpointProvider: IEndpointProvider,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService,
		@ICodeMapperService codeMapperService: ICodeMapperService,
		@IWorkspaceService workspaceService: IWorkspaceService,
	) {
		super(instantiationService, endpointProvider, configurationService, expService, codeMapperService, workspaceService, { intentInvocation: AgentIntentInvocation, processCodeblocks: false });
	}

	protected override getIntentHandlerOptions(_request: vscode.ChatRequest): IDefaultIntentRequestHandlerOptions | undefined {
		return {
			maxToolCallIterations: 20,
			temperature: 0, // Zero temperature for consistent reviews
			overrideRequestLocation: ChatLocation.Agent,
			hideRateLimitTimeEstimate: true
		};
	}
}
