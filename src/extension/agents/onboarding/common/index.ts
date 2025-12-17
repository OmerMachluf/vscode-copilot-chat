/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Onboarding Agent Module
 *
 * This module provides comprehensive repository onboarding capabilities including:
 * - Repository structure and technology analysis
 * - Architecture documentation generation
 * - Agent configuration recommendations
 * - Custom workflow suggestions
 *
 * Phase 1 Implementation:
 * - Repository Investigation Engine
 * - Core type definitions
 * - A2A orchestration integration
 */

// Core types and interfaces
export * from './common/onboardingTypes';

// Repository analysis services
export { RepositoryAnalyzerService } from './node/repositoryAnalyzer';
export { RepositoryInvestigationEngine } from './node/repositoryInvestigationEngine';

// Architecture and documentation services
export { ArchitectureDocumentBuilderService } from './node/architectureDocumentBuilder';

// Agent recommendation services
export { AgentRecommendationEngineService } from './node/agentRecommendationEngine';

// Main orchestration service
export { OnboardingAgentService } from './node/onboardingAgentService';

// Service identifiers for dependency injection
export {
	IOnboardingAgentService,
	IRepositoryAnalyzerService,
	IArchitectureDocumentBuilderService,
	IAgentRecommendationEngineService
} from './common/onboardingTypes';