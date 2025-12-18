/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Domain types
export {
	BusinessDomain,
	TechnologyCategory,
	DetectedTechnology,
	TechnologyPattern,
	DomainKnowledge,
	DomainPattern,
	ComplianceRequirement,
	WorkspaceProfile,
	ProjectCharacteristics,
	AgentCapability,
	AgentRecommendation,
	RecommendationContext,
	UserPreferences,
	RecommendationResult
} from './domainTypes';

// Domain knowledge base
export {
	DOMAIN_KNOWLEDGE,
	TECHNOLOGY_PATTERNS,
	AGENT_CAPABILITIES,
	getDomainKnowledge,
	getAllDomains,
	findDomainsForTechnologies,
	getTechnologyPatterns,
	getAgentCapabilities,
	findCapabilitiesForTask,
	findCapabilitiesForDomain
} from './domainKnowledgeBase';
