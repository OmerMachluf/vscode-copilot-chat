/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Re-export common types
export * from '../common/index';

// Agent recommendation engine
export {
	AgentRecommendationEngine,
	getRecommendationEngine
} from './agentRecommendationEngine';

// Custom instruction generator
export {
	CustomInstructionGenerator,
	InstructionGeneratorConfig,
	GeneratedInstructions,
	generateDomainInstructions,
	generateBriefInstructions,
	getInstructionGenerator
} from './customInstructionGenerator';

// Service
export {
	IAgentRecommendationService,
	AgentRecommendationService,
	RecommendationOptions
} from './agentRecommendationService';
