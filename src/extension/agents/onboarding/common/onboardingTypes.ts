/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Core interfaces and types for the onboarding agent system.
 * These types define the structure for repository analysis and agent recommendations.
 */

// ================================================================
// Repository Analysis Types
// ================================================================

export interface IRepositoryAnalyzer {
	analyzeStructure(): Promise<RepositoryStructure>;
	identifyTechnologies(): Promise<TechnologyStack>;
	analyzeDomain(): Promise<BusinessDomain>;
	findPatterns(): Promise<CodePatterns>;
}

export interface RepositoryStructure {
	directories: DirectoryInfo[];
	fileTypes: FileTypeAnalysis;
	dependencies: DependencyAnalysis;
	testStructure: TestStructure;
	buildSystem: BuildSystemInfo;
}

export interface DirectoryInfo {
	name: string;
	path: string;
	type: 'source' | 'test' | 'config' | 'build' | 'docs' | 'assets' | 'other';
	fileCount: number;
	subdirectories: string[];
	purposes: string[]; // e.g., "models", "controllers", "services"
}

export interface FileTypeAnalysis {
	languages: LanguageInfo[];
	configFiles: ConfigFileInfo[];
	documentationFiles: string[];
	totalFiles: number;
}

export interface LanguageInfo {
	language: string;
	fileCount: number;
	percentage: number;
	extensions: string[];
	primaryFrameworks: string[];
}

export interface ConfigFileInfo {
	file: string;
	type: 'package' | 'build' | 'ci' | 'deployment' | 'linting' | 'testing' | 'other';
	framework?: string;
}

export interface DependencyAnalysis {
	packageManager: 'npm' | 'yarn' | 'pnpm' | 'maven' | 'gradle' | 'pip' | 'cargo' | 'unknown';
	dependencies: DependencyInfo[];
	devDependencies: DependencyInfo[];
	totalDependencies: number;
}

export interface DependencyInfo {
	name: string;
	version: string;
	category: 'framework' | 'library' | 'tool' | 'testing' | 'build' | 'other';
	description?: string;
}

export interface TestStructure {
	hasTests: boolean;
	testFrameworks: string[];
	testDirectories: string[];
	testFilePattern: string[];
	coverageConfigured: boolean;
	testTypes: ('unit' | 'integration' | 'e2e')[];
}

export interface BuildSystemInfo {
	buildTool: string | null;
	buildFiles: string[];
	scripts: BuildScript[];
	hasCI: boolean;
	ciFiles: string[];
}

export interface BuildScript {
	name: string;
	command: string;
	type: 'build' | 'test' | 'lint' | 'deploy' | 'start' | 'other';
}

export interface TechnologyStack {
	primaryLanguages: string[];
	frameworks: Framework[];
	databases: string[];
	deployment: DeploymentInfo;
	cicd: CICDInfo;
}

export interface Framework {
	name: string;
	version?: string;
	category: 'web' | 'mobile' | 'desktop' | 'api' | 'testing' | 'build' | 'other';
	confidence: number; // 0-1
}

export interface DeploymentInfo {
	platforms: string[]; // 'aws', 'azure', 'gcp', 'vercel', 'netlify', etc.
	containerized: boolean;
	serverless: boolean;
	deploymentFiles: string[];
}

export interface CICDInfo {
	providers: string[]; // 'github-actions', 'gitlab-ci', 'jenkins', etc.
	configFiles: string[];
	stages: string[]; // 'build', 'test', 'deploy', etc.
}

export interface BusinessDomain {
	domain: string; // e.g., "fintech", "e-commerce", "healthcare", "saas", "enterprise"
	keywords: string[];
	compliance: ComplianceRequirements;
	scale: "startup" | "enterprise" | "medium";
	confidence: number; // 0-1, confidence in domain classification
}

export interface ComplianceRequirements {
	regulations: string[]; // 'GDPR', 'HIPAA', 'SOX', 'PCI-DSS', etc.
	securityRequirements: string[];
	dataPrivacy: boolean;
	auditTrails: boolean;
}

export interface CodePatterns {
	architecturalPatterns: ArchitecturalPattern[];
	designPatterns: DesignPattern[];
	namingConventions: NamingConvention[];
	codeStyle: CodeStyleInfo;
}

export interface ArchitecturalPattern {
	pattern: 'MVC' | 'MVP' | 'MVVM' | 'microservices' | 'monolith' | 'layered' | 'clean' | 'hexagonal' | 'other';
	confidence: number;
	evidence: string[];
}

export interface DesignPattern {
	pattern: string;
	occurrences: number;
	files: string[];
}

export interface NamingConvention {
	type: 'file' | 'class' | 'function' | 'variable' | 'constant';
	convention: 'camelCase' | 'PascalCase' | 'snake_case' | 'kebab-case' | 'SCREAMING_SNAKE_CASE';
	consistency: number; // 0-1
}

export interface CodeStyleInfo {
	indentation: 'tabs' | 'spaces' | 'mixed';
	indentSize?: number;
	lineEndings: 'lf' | 'crlf' | 'mixed';
	quoteStyle: 'single' | 'double' | 'mixed';
	semicolons: boolean | 'mixed';
}

// ================================================================
// Repository Investigation Types
// ================================================================

export interface RepositoryAnalysis {
	structure: RepositoryStructure;
	technologies: TechnologyStack;
	domain: BusinessDomain;
	patterns: CodePatterns;
	metadata: AnalysisMetadata;
}

export interface AnalysisMetadata {
	timestamp: number;
	version: string;
	analysisTimeMs: number;
	confidence: number; // Overall confidence in analysis
	sources: AnalysisSource[];
}

export interface AnalysisSource {
	type: 'readme' | 'package-json' | 'code-analysis' | 'config-files' | 'directory-structure';
	confidence: number;
	details: string;
}

// ================================================================
// Architecture Documentation Types
// ================================================================

export interface IArchitectureDocumentBuilder {
	generateArchitectureDoc(analysis: RepositoryAnalysis): Promise<string>;
	generateSystemOverview(structure: RepositoryStructure): string;
	generateComponentDiagrams(components: Component[]): string;
	generateDataFlowDiagrams(flows: DataFlow[]): string;
}

export interface Component {
	name: string;
	type: 'service' | 'controller' | 'model' | 'view' | 'utility' | 'middleware' | 'other';
	responsibilities: string[];
	dependencies: string[];
	interfaces: ComponentInterface[];
}

export interface ComponentInterface {
	name: string;
	type: 'api' | 'event' | 'database' | 'file' | 'other';
	description: string;
}

export interface DataFlow {
	from: string;
	to: string;
	data: string;
	protocol?: string;
	description?: string;
}

// ================================================================
// Agent Recommendation Types
// ================================================================

export interface IAgentRecommendationEngine {
	recommendAgents(analysis: RepositoryAnalysis): Promise<AgentRecommendation[]>;
	generateCustomInstructions(domain: BusinessDomain, stack: TechnologyStack): Promise<CustomInstructions>;
	suggestWorkflows(patterns: CodePatterns): Promise<WorkflowSuggestion[]>;
}

export interface AgentRecommendation {
	agentType: string;
	purpose: string;
	configuration: AgentConfig;
	customInstructions: string[];
	suggestedSkills: string[];
	priority: 'high' | 'medium' | 'low';
	reasoning: string;
}

export interface AgentConfig {
	name: string;
	description: string;
	tools: string[];
	model?: string;
	temperature?: number;
	maxTokens?: number;
	systemPrompt?: string;
}

export interface CustomInstructions {
	general: string[];
	domainSpecific: string[];
	technologySpecific: string[];
	bestPractices: string[];
	codeStyle: string[];
}

export interface WorkflowSuggestion {
	name: string;
	description: string;
	commands: WorkflowCommand[];
	triggerEvents: string[];
	automationLevel: 'manual' | 'semi-automated' | 'fully-automated';
}

export interface WorkflowCommand {
	name: string;
	description: string;
	command: string;
	args?: WorkflowArg[];
}

export interface WorkflowArg {
	name: string;
	description: string;
	type: 'string' | 'number' | 'boolean' | 'array' | 'object';
	required: boolean;
	defaultValue?: any;
}

// ================================================================
// Onboarding Agent Types
// ================================================================

export interface OnboardingOptions {
	analysisDepth: 'basic' | 'standard' | 'comprehensive';
	focusAreas?: ('security' | 'performance' | 'testing' | 'documentation' | 'deployment')[];
	generateDocs: boolean;
	setupAgents: boolean;
	createCommands: boolean;
	interactiveMode: boolean;
}

export interface OnboardingResult {
	architectureDocument: string;
	agentRecommendations: AgentRecommendation[];
	customConfigurations: GeneratedConfig[];
	setupInstructions: SetupInstruction[];
	analysis: RepositoryAnalysis;
	metadata: OnboardingMetadata;
}

export interface GeneratedConfig {
	type: 'agent' | 'command' | 'instruction' | 'workflow';
	filename: string;
	content: string;
	path: string;
}

export interface SetupInstruction {
	step: number;
	title: string;
	description: string;
	commands?: string[];
	files?: string[];
	optional: boolean;
}

export interface OnboardingMetadata {
	timestamp: number;
	version: string;
	duration: number;
	options: OnboardingOptions;
	generatedFiles: string[];
	recommendations: number;
}

// ================================================================
// Service Interfaces (VS Code Integration)
// ================================================================

import { createServiceIdentifier } from '../../../util/common/services';

export interface IOnboardingAgentService {
	readonly _serviceBrand: undefined;

	/**
	 * Perform comprehensive repository onboarding
	 */
	onboardRepository(options: OnboardingOptions): Promise<OnboardingResult>;

	/**
	 * Analyze repository structure and patterns
	 */
	analyzeRepository(): Promise<RepositoryAnalysis>;

	/**
	 * Generate architecture documentation
	 */
	generateArchitectureDoc(analysis: RepositoryAnalysis): Promise<string>;

	/**
	 * Get agent recommendations based on analysis
	 */
	getAgentRecommendations(analysis: RepositoryAnalysis): Promise<AgentRecommendation[]>;

	/**
	 * Generate custom configurations and commands
	 */
	generateConfigurations(recommendations: AgentRecommendation[]): Promise<GeneratedConfig[]>;
}

export const IOnboardingAgentService = createServiceIdentifier<IOnboardingAgentService>('onboardingAgentService');

export interface IRepositoryAnalyzerService extends IRepositoryAnalyzer {
	readonly _serviceBrand: undefined;
}

export const IRepositoryAnalyzerService = createServiceIdentifier<IRepositoryAnalyzerService>('repositoryAnalyzerService');

export interface IArchitectureDocumentBuilderService extends IArchitectureDocumentBuilder {
	readonly _serviceBrand: undefined;
}

export const IArchitectureDocumentBuilderService = createServiceIdentifier<IArchitectureDocumentBuilderService>('architectureDocumentBuilderService');

export interface IAgentRecommendationEngineService extends IAgentRecommendationEngine {
	readonly _serviceBrand: undefined;
}

export const IAgentRecommendationEngineService = createServiceIdentifier<IAgentRecommendationEngineService>('agentRecommendationEngineService');