/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Onboarding Agent System
 *
 * This module provides a comprehensive system for analyzing repositories and
 * providing intelligent onboarding assistance to developers working with
 * new codebases. It includes:
 *
 * - Repository structure analysis
 * - Technology stack identification
 * - Business domain analysis
 * - Code pattern recognition
 * - Agent recommendations based on analysis
 * - Context generation for AI agents
 *
 * ## Usage
 *
 * ```typescript
 * import { IRepositoryAnalyzerService, IRepositoryAnalysis } from './onboarding';
 *
 * // Analyze a repository
 * const analysis = await repositoryAnalyzerService.analyzeRepository('/path/to/repo');
 *
 * // Get recommendations
 * const recommendations = getRecommendedAgentsForTechStack(analysis.technologyStack);
 *
 * // Generate agent instructions
 * const instructions = generateAgentInstructions(analysis);
 * ```
 */

// Types - Repository Analysis
export {
	// Core types
	ConfidenceLevel,
	PriorityLevel,
	IAnalysisFinding,

	// Repository structure
	RepositoryStructureType,
	DirectoryClassification,
	IDirectoryInfo,
	IPackageInfo,
	PackageManager,
	IRepositoryStructure,
	IEntryPoint,
	IConfigurationFile,
	ConfigurationType,

	// Technology stack
	TechnologyCategory,
	ITechnologyInfo,
	ILanguageInfo,
	IFrameworkInfo,
	FrameworkType,
	ArchitecturePattern,
	IDependencyInfo,
	IVulnerabilityInfo,
	ITechnologyStack,

	// Business domain
	BusinessDomainCategory,
	IDomainConcept,
	IDomainEntity,
	EntityType,
	IEntityProperty,
	IEntityRelationship,
	IBusinessWorkflow,
	IWorkflowStep,
	IBusinessDomainAnalysis,

	// Code patterns
	DesignPatternCategory,
	IDesignPattern,
	IPatternImplementation,
	ICodeConvention,
	CodeConventionCategory,
	IAntiPattern,
	IPatternOccurrence,
	ICodeQualityMetric,
	ICodePatternAnalysis,
	IArchitecturalDecision,

	// Analysis results
	AnalysisStatus,
	IRepositoryAnalysis,
	IKeyFinding,
	IAnalysisMetadata,
	IAnalysisConfiguration,
	DEFAULT_ANALYSIS_CONFIGURATION,
} from './types';

// Types - Agent Integration
export {
	// Agent recommendations
	AgentCapability,
	IAgentRecommendation,
	IAgentWorkflow,
	IWorkflowAgent,

	// Repository context
	IRepositoryContext,
	IDirectoryContext,
	IFileContext,
	IConventionContext,

	// Agent instructions
	IAgentInstructions,
	IPatternInstruction,
	IAgentRule,

	// Onboarding session
	OnboardingSessionStatus,
	OnboardingPhase,
	IOnboardingSession,
	IOnboardingSessionOptions,

	// Recommendation engine
	IRecommendationInput,
	IRecommendationOutput,
	IQuickStartSuggestion,
	ILearningStep,

	// Helper functions
	createRepositoryContext,
	getRecommendedAgentsForTechStack,
	generateAgentInstructions,
} from './types';

// Services
export {
	IRepositoryAnalyzerService,
	RepositoryAnalyzerService,
	IAnalyzeRepositoryOptions,
	IAnalysisProgress,
	IRepositoryQuickSummary,
} from './repository';
