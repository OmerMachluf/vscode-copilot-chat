/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Onboarding Types Module
 *
 * Exports all type definitions for the onboarding agent system including
 * repository analysis types and agent integration types.
 */

// Repository Analysis Types
export {
	// Confidence and priority
	ConfidenceLevel,
	PriorityLevel,

	// Base types
	IAnalysisFinding,

	// Repository structure types
	RepositoryStructureType,
	DirectoryClassification,
	IDirectoryInfo,
	IPackageInfo,
	PackageManager,
	IRepositoryStructure,
	IEntryPoint,
	IConfigurationFile,
	ConfigurationType,

	// Technology stack types
	TechnologyCategory,
	ITechnologyInfo,
	ILanguageInfo,
	IFrameworkInfo,
	FrameworkType,
	ArchitecturePattern,
	IDependencyInfo,
	IVulnerabilityInfo,
	ITechnologyStack,

	// Business domain types
	BusinessDomainCategory,
	IDomainConcept,
	IDomainEntity,
	EntityType,
	IEntityProperty,
	IEntityRelationship,
	IBusinessWorkflow,
	IWorkflowStep,
	IBusinessDomainAnalysis,

	// Code pattern types
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

	// Complete analysis types
	AnalysisStatus,
	IRepositoryAnalysis,
	IKeyFinding,
	IAnalysisMetadata,
	IAnalysisConfiguration,
	DEFAULT_ANALYSIS_CONFIGURATION,
} from './repositoryAnalysis';

// Agent Integration Types
export {
	// Agent recommendation types
	AgentCapability,
	IAgentRecommendation,
	IAgentWorkflow,
	IWorkflowAgent,

	// Repository context types
	IRepositoryContext,
	IDirectoryContext,
	IFileContext,
	IConventionContext,

	// Agent instruction types
	IAgentInstructions,
	IPatternInstruction,
	IAgentRule,

	// Onboarding session types
	OnboardingSessionStatus,
	OnboardingPhase,
	IOnboardingSession,
	IOnboardingSessionOptions,

	// Recommendation engine types
	IRecommendationInput,
	IRecommendationOutput,
	IQuickStartSuggestion,
	ILearningStep,

	// Helper functions
	createRepositoryContext,
	getRecommendedAgentsForTechStack,
	generateAgentInstructions,
} from './agentIntegration';
