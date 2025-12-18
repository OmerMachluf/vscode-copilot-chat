/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Business domains supported by the agent recommendation system
 */
export type BusinessDomain =
	| 'fintech'
	| 'healthcare'
	| 'ecommerce'
	| 'enterprise'
	| 'gaming'
	| 'iot'
	| 'ai-ml'
	| 'general';

/**
 * Technology stack categories
 */
export type TechnologyCategory =
	| 'frontend'
	| 'backend'
	| 'database'
	| 'devops'
	| 'testing'
	| 'security'
	| 'monitoring'
	| 'documentation';

/**
 * A technology detected in the workspace
 */
export interface DetectedTechnology {
	/** Technology identifier (e.g., 'react', 'typescript', 'postgresql') */
	id: string;
	/** Human-readable name */
	name: string;
	/** Category of the technology */
	category: TechnologyCategory;
	/** Confidence score (0-1) for the detection */
	confidence: number;
	/** Version if detected */
	version?: string;
	/** Files/patterns that led to this detection */
	evidence: string[];
}

/**
 * Pattern match for detecting technologies
 */
export interface TechnologyPattern {
	/** Technology ID */
	technologyId: string;
	/** File patterns to match (glob patterns) */
	filePatterns?: string[];
	/** Package names to look for in package.json, requirements.txt, etc. */
	packageNames?: string[];
	/** Content patterns to search for (regex) */
	contentPatterns?: string[];
	/** Dependencies that indicate this technology */
	dependencies?: string[];
	/** Configuration files that indicate this technology */
	configFiles?: string[];
}

/**
 * Domain-specific knowledge entry
 */
export interface DomainKnowledge {
	/** Unique identifier */
	id: string;
	/** Domain this knowledge applies to */
	domain: BusinessDomain;
	/** Technologies typically associated with this domain */
	typicalTechnologies: string[];
	/** Common patterns and architectural considerations */
	patterns: DomainPattern[];
	/** Compliance and regulatory requirements */
	compliance: ComplianceRequirement[];
	/** Security considerations specific to the domain */
	securityConsiderations: string[];
	/** Best practices for the domain */
	bestPractices: string[];
	/** Common integration points */
	integrations: string[];
}

/**
 * Pattern commonly used in a domain
 */
export interface DomainPattern {
	/** Pattern name (e.g., 'event-sourcing', 'cqrs') */
	name: string;
	/** Description of the pattern */
	description: string;
	/** When to use this pattern */
	useCase: string;
	/** Technologies commonly used to implement this pattern */
	technologies: string[];
}

/**
 * Compliance requirement for a domain
 */
export interface ComplianceRequirement {
	/** Requirement identifier (e.g., 'HIPAA', 'PCI-DSS', 'GDPR') */
	id: string;
	/** Human-readable name */
	name: string;
	/** Description of the requirement */
	description: string;
	/** Areas affected by this requirement */
	affectedAreas: string[];
}

/**
 * Profile of a workspace based on analysis
 */
export interface WorkspaceProfile {
	/** Detected business domain */
	domain: BusinessDomain;
	/** Confidence in domain detection (0-1) */
	domainConfidence: number;
	/** Detected technologies */
	technologies: DetectedTechnology[];
	/** Inferred architectural patterns */
	patterns: string[];
	/** Detected compliance requirements */
	compliance: string[];
	/** Project characteristics */
	characteristics: ProjectCharacteristics;
	/** Timestamp of the analysis */
	analyzedAt: number;
}

/**
 * Characteristics of a project
 */
export interface ProjectCharacteristics {
	/** Project size (files/lines) */
	size: 'small' | 'medium' | 'large' | 'enterprise';
	/** Estimated complexity */
	complexity: 'low' | 'medium' | 'high' | 'very-high';
	/** Primary language */
	primaryLanguage?: string;
	/** Has test infrastructure */
	hasTests: boolean;
	/** Has CI/CD configuration */
	hasCICD: boolean;
	/** Has documentation */
	hasDocumentation: boolean;
	/** Uses monorepo structure */
	isMonorepo: boolean;
	/** Has containerization */
	hasContainerization: boolean;
}

/**
 * Agent capability mapping
 */
export interface AgentCapability {
	/** Capability identifier */
	id: string;
	/** Human-readable name */
	name: string;
	/** Description of what this capability enables */
	description: string;
	/** Technologies this capability is optimized for */
	technologies: string[];
	/** Domains this capability is particularly useful for */
	domains: BusinessDomain[];
	/** Task types this capability handles */
	taskTypes: string[];
}

/**
 * Recommendation for an agent
 */
export interface AgentRecommendation {
	/** Agent ID */
	agentId: string;
	/** Agent name */
	agentName: string;
	/** Relevance score (0-1) */
	score: number;
	/** Reasons for this recommendation */
	reasons: string[];
	/** Capabilities that match the context */
	matchedCapabilities: string[];
	/** Suggested use cases for this agent */
	suggestedUseCases: string[];
	/** Custom instructions to enhance agent performance */
	customInstructions?: string;
}

/**
 * Context for generating recommendations
 */
export interface RecommendationContext {
	/** Workspace profile */
	workspaceProfile: WorkspaceProfile;
	/** Current task or intent (if known) */
	currentTask?: string;
	/** Files currently open or focused */
	focusedFiles?: string[];
	/** User's previous agent selections */
	previousSelections?: string[];
	/** Any explicit user preferences */
	preferences?: UserPreferences;
}

/**
 * User preferences for agent recommendations
 */
export interface UserPreferences {
	/** Preferred agents (always recommend first) */
	preferredAgents?: string[];
	/** Agents to avoid */
	excludedAgents?: string[];
	/** Prefer speed over thoroughness */
	preferSpeed?: boolean;
	/** Domain override (user knows their domain better) */
	domainOverride?: BusinessDomain;
}

/**
 * Result of agent recommendations
 */
export interface RecommendationResult {
	/** Ordered list of recommendations (best first) */
	recommendations: AgentRecommendation[];
	/** Workspace profile used for recommendations */
	workspaceProfile: WorkspaceProfile;
	/** Overall confidence in recommendations */
	confidence: number;
	/** Suggestions for improving recommendations */
	suggestions?: string[];
}
