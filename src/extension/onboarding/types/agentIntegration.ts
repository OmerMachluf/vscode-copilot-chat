/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Agent Integration Type Definitions
 *
 * This module provides types for integrating repository analysis with the
 * agent system, including recommendations for which agents to use and
 * how to configure them based on analysis results.
 */

import { IRepositoryAnalysis, ITechnologyStack, IRepositoryStructure, ConfidenceLevel, PriorityLevel } from './repositoryAnalysis';

// ============================================================================
// Agent Recommendation Types
// ============================================================================

/**
 * Capability that an agent can provide.
 */
export type AgentCapability =
	| 'code-generation'      // Generate new code
	| 'code-review'          // Review existing code
	| 'refactoring'          // Refactor code
	| 'bug-fixing'           // Fix bugs
	| 'testing'              // Write/run tests
	| 'documentation'        // Write documentation
	| 'architecture'         // Architectural decisions
	| 'explanation'          // Explain code
	| 'debugging'            // Debug issues
	| 'optimization'         // Optimize performance
	| 'security'             // Security analysis
	| 'migration'            // Code/data migration
	| 'integration'          // API/service integration
	| 'deployment'           // Deployment tasks
	| 'research';            // Research and exploration

/**
 * Recommendation for using a specific agent.
 */
export interface IAgentRecommendation {
	/** Agent ID */
	readonly agentId: string;
	/** Agent name */
	readonly agentName: string;
	/** Why this agent is recommended */
	readonly reason: string;
	/** Capabilities this agent provides */
	readonly capabilities: readonly AgentCapability[];
	/** Confidence in this recommendation */
	readonly confidence: ConfidenceLevel;
	/** Priority of using this agent */
	readonly priority: PriorityLevel;
	/** Suggested tasks for this agent */
	readonly suggestedTasks: readonly string[];
	/** Configuration hints for the agent */
	readonly configurationHints?: Record<string, unknown>;
}

/**
 * Recommended workflow combining multiple agents.
 */
export interface IAgentWorkflow {
	/** Workflow name */
	readonly name: string;
	/** Workflow description */
	readonly description: string;
	/** Agents involved in this workflow */
	readonly agents: readonly IWorkflowAgent[];
	/** When to use this workflow */
	readonly useCases: readonly string[];
	/** Prerequisites for this workflow */
	readonly prerequisites?: readonly string[];
}

/**
 * Agent role within a workflow.
 */
export interface IWorkflowAgent {
	/** Agent ID */
	readonly agentId: string;
	/** Role in the workflow */
	readonly role: 'primary' | 'support' | 'reviewer';
	/** Order in the workflow */
	readonly order: number;
	/** Input expected from previous agents */
	readonly inputs?: readonly string[];
	/** Output produced for next agents */
	readonly outputs?: readonly string[];
}

// ============================================================================
// Repository Context Types
// ============================================================================

/**
 * Context information derived from repository analysis for agent use.
 */
export interface IRepositoryContext {
	/** Repository name */
	readonly name: string;
	/** Repository path */
	readonly path: string;
	/** Primary programming language */
	readonly primaryLanguage: string;
	/** Primary framework (if any) */
	readonly primaryFramework?: string;
	/** Architecture pattern */
	readonly architecturePattern: string;
	/** Key directories and their purposes */
	readonly keyDirectories: readonly IDirectoryContext[];
	/** Important files to be aware of */
	readonly importantFiles: readonly IFileContext[];
	/** Coding conventions in use */
	readonly conventions: readonly IConventionContext[];
	/** Technology constraints */
	readonly constraints: readonly string[];
	/** Project-specific terminology */
	readonly terminology: Record<string, string>;
}

/**
 * Context about a key directory.
 */
export interface IDirectoryContext {
	/** Directory path */
	readonly path: string;
	/** Purpose of this directory */
	readonly purpose: string;
	/** Types of files typically found here */
	readonly fileTypes: readonly string[];
	/** Naming conventions for files in this directory */
	readonly namingConvention?: string;
}

/**
 * Context about an important file.
 */
export interface IFileContext {
	/** File path */
	readonly path: string;
	/** Purpose of this file */
	readonly purpose: string;
	/** Whether this file should be modified carefully */
	readonly isSensitive: boolean;
	/** Related files */
	readonly relatedFiles?: readonly string[];
}

/**
 * Context about a coding convention.
 */
export interface IConventionContext {
	/** Convention name */
	readonly name: string;
	/** Description of the convention */
	readonly description: string;
	/** Examples of proper usage */
	readonly examples: readonly string[];
	/** Files/directories where this convention applies */
	readonly scope: readonly string[];
}

// ============================================================================
// Agent Instruction Types
// ============================================================================

/**
 * Instructions for an agent based on repository analysis.
 */
export interface IAgentInstructions {
	/** Repository context */
	readonly context: IRepositoryContext;
	/** Agent-specific instructions */
	readonly instructions: readonly string[];
	/** Patterns to follow */
	readonly patterns: readonly IPatternInstruction[];
	/** Things to avoid */
	readonly antiPatterns: readonly string[];
	/** File templates */
	readonly templates?: Record<string, string>;
	/** Custom rules */
	readonly rules?: readonly IAgentRule[];
}

/**
 * Pattern instruction for an agent.
 */
export interface IPatternInstruction {
	/** Pattern name */
	readonly name: string;
	/** When to use this pattern */
	readonly useCase: string;
	/** Example implementation */
	readonly example: string;
	/** Files where this pattern applies */
	readonly applicableFiles: readonly string[];
}

/**
 * Custom rule for agent behavior.
 */
export interface IAgentRule {
	/** Rule ID */
	readonly id: string;
	/** Rule description */
	readonly description: string;
	/** Condition when rule applies */
	readonly condition: string;
	/** Action to take */
	readonly action: string;
	/** Severity if violated */
	readonly severity: 'error' | 'warning' | 'info';
}

// ============================================================================
// Onboarding Session Types
// ============================================================================

/**
 * Status of an onboarding session.
 */
export type OnboardingSessionStatus =
	| 'initializing'         // Session is starting
	| 'analyzing'            // Repository analysis in progress
	| 'ready'                // Ready for agent interaction
	| 'active'               // Actively helping user
	| 'completed'            // Session completed
	| 'failed';              // Session failed

/**
 * Phase of the onboarding process.
 */
export type OnboardingPhase =
	| 'repository-analysis'  // Analyzing the repository
	| 'context-building'     // Building context for agents
	| 'agent-selection'      // Selecting appropriate agents
	| 'instruction-gen'      // Generating agent instructions
	| 'ready';               // Ready for user interaction

/**
 * Onboarding session for a repository.
 */
export interface IOnboardingSession {
	/** Session ID */
	readonly id: string;
	/** Repository path */
	readonly repositoryPath: string;
	/** Session status */
	readonly status: OnboardingSessionStatus;
	/** Current phase */
	readonly phase: OnboardingPhase;
	/** Repository analysis (when available) */
	readonly analysis?: IRepositoryAnalysis;
	/** Repository context (when available) */
	readonly context?: IRepositoryContext;
	/** Recommended agents */
	readonly recommendedAgents?: readonly IAgentRecommendation[];
	/** Recommended workflows */
	readonly recommendedWorkflows?: readonly IAgentWorkflow[];
	/** Agent instructions (when available) */
	readonly agentInstructions?: IAgentInstructions;
	/** Session start time */
	readonly startedAt: number;
	/** Session completion time */
	readonly completedAt?: number;
	/** Error message if failed */
	readonly error?: string;
	/** Progress percentage (0-100) */
	readonly progress: number;
}

/**
 * Options for creating an onboarding session.
 */
export interface IOnboardingSessionOptions {
	/** Whether to perform deep analysis */
	readonly deepAnalysis?: boolean;
	/** Specific areas to focus on */
	readonly focusAreas?: readonly ('structure' | 'technology' | 'domain' | 'patterns')[];
	/** Maximum analysis depth */
	readonly maxDepth?: number;
	/** Timeout in milliseconds */
	readonly timeout?: number;
	/** Callback for progress updates */
	readonly onProgress?: (session: IOnboardingSession) => void;
}

// ============================================================================
// Agent Recommendation Engine Types
// ============================================================================

/**
 * Input for generating agent recommendations.
 */
export interface IRecommendationInput {
	/** Repository analysis */
	readonly analysis: IRepositoryAnalysis;
	/** User's stated goals (if any) */
	readonly userGoals?: readonly string[];
	/** Previous interactions (if any) */
	readonly previousInteractions?: readonly string[];
	/** Preferred agent types */
	readonly preferredAgents?: readonly string[];
	/** Excluded agent types */
	readonly excludedAgents?: readonly string[];
}

/**
 * Output from the recommendation engine.
 */
export interface IRecommendationOutput {
	/** Recommended agents */
	readonly agents: readonly IAgentRecommendation[];
	/** Recommended workflows */
	readonly workflows: readonly IAgentWorkflow[];
	/** Quick start suggestions */
	readonly quickStart: readonly IQuickStartSuggestion[];
	/** Learning path for the repository */
	readonly learningPath?: readonly ILearningStep[];
}

/**
 * Quick start suggestion for immediate action.
 */
export interface IQuickStartSuggestion {
	/** Suggestion title */
	readonly title: string;
	/** Description */
	readonly description: string;
	/** Agent to use */
	readonly agentId: string;
	/** Prompt to start with */
	readonly prompt: string;
	/** Priority */
	readonly priority: PriorityLevel;
}

/**
 * Step in a learning path for understanding the repository.
 */
export interface ILearningStep {
	/** Step number */
	readonly order: number;
	/** Step title */
	readonly title: string;
	/** Description */
	readonly description: string;
	/** Files to explore */
	readonly files: readonly string[];
	/** Questions to answer */
	readonly questions: readonly string[];
	/** Suggested duration (minutes) */
	readonly estimatedMinutes: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a repository context from analysis results.
 */
export function createRepositoryContext(analysis: IRepositoryAnalysis): IRepositoryContext {
	const structure = analysis.structure;
	const techStack = analysis.technologyStack;

	return {
		name: analysis.repositoryPath.split(/[/\\]/).pop() || 'unknown',
		path: analysis.repositoryPath,
		primaryLanguage: techStack?.languages[0]?.name || 'unknown',
		primaryFramework: techStack?.frameworks.find(f => f.isPrimary)?.name,
		architecturePattern: techStack?.architecturePattern || 'unknown',
		keyDirectories: structure?.keyDirectories.map(dir => ({
			path: dir.path,
			purpose: dir.classification,
			fileTypes: dir.primaryExtensions,
		})) || [],
		importantFiles: structure?.configurationFiles.map(file => ({
			path: file.path,
			purpose: file.description || file.type,
			isSensitive: file.type === 'environment',
		})) || [],
		conventions: [],
		constraints: [],
		terminology: analysis.businessDomain?.glossary || {},
	};
}

/**
 * Determines recommended agents based on technology stack.
 */
export function getRecommendedAgentsForTechStack(techStack: ITechnologyStack): IAgentRecommendation[] {
	const recommendations: IAgentRecommendation[] = [];

	// Always recommend the default agent
	recommendations.push({
		agentId: 'agent',
		agentName: 'Agent',
		reason: 'General-purpose agent for code generation and modification',
		capabilities: ['code-generation', 'refactoring', 'bug-fixing'],
		confidence: 'high',
		priority: 'high',
		suggestedTasks: ['Implement new features', 'Fix bugs', 'Refactor code'],
	});

	// Recommend based on framework
	if (techStack.frameworks.some(f => f.name === 'React' || f.name === 'Vue.js' || f.name === 'Angular')) {
		recommendations.push({
			agentId: 'frontend-agent',
			agentName: 'Frontend Agent',
			reason: 'Specialized for frontend development with modern frameworks',
			capabilities: ['code-generation', 'refactoring'],
			confidence: 'medium',
			priority: 'medium',
			suggestedTasks: ['Create components', 'Implement UI features', 'Style components'],
		});
	}

	// Recommend testing agent if testing framework is present
	if (techStack.testingFrameworks.length > 0) {
		recommendations.push({
			agentId: 'tester',
			agentName: 'Tester',
			reason: `Testing framework ${techStack.testingFrameworks[0]?.name} detected`,
			capabilities: ['testing'],
			confidence: 'high',
			priority: 'medium',
			suggestedTasks: ['Write unit tests', 'Add integration tests', 'Improve test coverage'],
		});
	}

	return recommendations;
}

/**
 * Generates agent instructions based on repository analysis.
 */
export function generateAgentInstructions(analysis: IRepositoryAnalysis): IAgentInstructions {
	const context = createRepositoryContext(analysis);

	const instructions: string[] = [];

	// Add language-specific instructions
	if (analysis.technologyStack?.languages[0]) {
		instructions.push(`This is primarily a ${analysis.technologyStack.languages[0].name} project.`);
	}

	// Add framework-specific instructions
	const primaryFramework = analysis.technologyStack?.frameworks.find(f => f.isPrimary);
	if (primaryFramework) {
		instructions.push(`Follow ${primaryFramework.name} best practices and conventions.`);
	}

	// Add structure-specific instructions
	if (analysis.structure?.structureType === 'monorepo') {
		instructions.push('This is a monorepo. Be aware of package boundaries and dependencies.');
	}

	return {
		context,
		instructions,
		patterns: [],
		antiPatterns: [],
	};
}
