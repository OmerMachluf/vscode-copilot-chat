/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Repository Investigation Engine Type Definitions
 *
 * This module provides comprehensive type definitions for analyzing repository structure,
 * technology stack, business domain, and code patterns. These types form the foundation
 * for the onboarding agent system that helps developers understand new codebases.
 */

// ============================================================================
// Core Analysis Types
// ============================================================================

/**
 * Confidence level for analysis results.
 * Indicates how certain the analysis is about a particular finding.
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Priority level for findings and recommendations.
 */
export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low';

/**
 * Base interface for all analysis findings.
 */
export interface IAnalysisFinding {
	/** Unique identifier for this finding */
	readonly id: string;
	/** Human-readable description of the finding */
	readonly description: string;
	/** Confidence level of this finding */
	readonly confidence: ConfidenceLevel;
	/** Evidence supporting this finding */
	readonly evidence: readonly string[];
	/** Timestamp when this finding was made */
	readonly timestamp: number;
}

// ============================================================================
// Repository Structure Types
// ============================================================================

/**
 * Type of repository structure pattern.
 */
export type RepositoryStructureType =
	| 'monorepo'           // Multiple packages/projects in one repo
	| 'single-package'     // Single project/package
	| 'multi-module'       // Multiple modules with shared dependencies
	| 'workspace'          // Workspace-based (npm/yarn workspaces, cargo workspace)
	| 'hybrid'             // Mix of patterns
	| 'unknown';           // Unable to determine

/**
 * Directory classification for understanding repository organization.
 */
export type DirectoryClassification =
	| 'source'             // Source code (src/, lib/)
	| 'test'               // Test files (test/, __tests__/, spec/)
	| 'docs'               // Documentation (docs/, doc/)
	| 'config'             // Configuration (.config/, config/)
	| 'build'              // Build artifacts (dist/, build/, out/)
	| 'assets'             // Static assets (assets/, public/, static/)
	| 'scripts'            // Build/automation scripts (scripts/, tools/)
	| 'vendor'             // Third-party code (vendor/, third-party/)
	| 'generated'          // Generated code
	| 'examples'           // Example code (examples/, samples/)
	| 'platform'           // Platform-specific code
	| 'common'             // Shared/common code
	| 'unknown';           // Unable to classify

/**
 * Information about a directory in the repository.
 */
export interface IDirectoryInfo {
	/** Relative path from repository root */
	readonly path: string;
	/** Directory name */
	readonly name: string;
	/** Classification of this directory */
	readonly classification: DirectoryClassification;
	/** Confidence in the classification */
	readonly confidence: ConfidenceLevel;
	/** Number of files in this directory (non-recursive) */
	readonly fileCount: number;
	/** Number of subdirectories */
	readonly subdirectoryCount: number;
	/** Total size in bytes (if available) */
	readonly totalSize?: number;
	/** Primary file extensions in this directory */
	readonly primaryExtensions: readonly string[];
	/** Child directories with their info */
	readonly children?: readonly IDirectoryInfo[];
}

/**
 * Information about a package/module in the repository.
 */
export interface IPackageInfo {
	/** Package name */
	readonly name: string;
	/** Package version */
	readonly version?: string;
	/** Path to the package within the repository */
	readonly path: string;
	/** Package manager used */
	readonly packageManager: PackageManager;
	/** Dependencies declared by this package */
	readonly dependencies: readonly IDependencyInfo[];
	/** Dev dependencies */
	readonly devDependencies: readonly IDependencyInfo[];
	/** Scripts/commands defined in this package */
	readonly scripts: Record<string, string>;
	/** Whether this is a private package */
	readonly isPrivate: boolean;
	/** Entry points for this package */
	readonly entryPoints?: readonly string[];
}

/**
 * Package manager type.
 */
export type PackageManager =
	| 'npm'
	| 'yarn'
	| 'pnpm'
	| 'bun'
	| 'cargo'
	| 'pip'
	| 'poetry'
	| 'pipenv'
	| 'maven'
	| 'gradle'
	| 'nuget'
	| 'go-modules'
	| 'bundler'
	| 'composer'
	| 'unknown';

/**
 * Complete repository structure analysis result.
 */
export interface IRepositoryStructure {
	/** Type of repository structure */
	readonly structureType: RepositoryStructureType;
	/** Confidence in structure type detection */
	readonly confidence: ConfidenceLevel;
	/** Root directory information */
	readonly rootDirectory: IDirectoryInfo;
	/** All packages/modules found in the repository */
	readonly packages: readonly IPackageInfo[];
	/** Key directories and their purposes */
	readonly keyDirectories: readonly IDirectoryInfo[];
	/** Entry point files (main files that start the application) */
	readonly entryPoints: readonly IEntryPoint[];
	/** Configuration files found */
	readonly configurationFiles: readonly IConfigurationFile[];
	/** Total file count in repository */
	readonly totalFileCount: number;
	/** Total lines of code (approximate) */
	readonly totalLinesOfCode?: number;
	/** Primary programming languages */
	readonly primaryLanguages: readonly ILanguageInfo[];
}

/**
 * Entry point for the application/library.
 */
export interface IEntryPoint {
	/** Path to the entry point file */
	readonly path: string;
	/** Type of entry point */
	readonly type: 'main' | 'library' | 'cli' | 'server' | 'worker' | 'test' | 'other';
	/** Description of what this entry point does */
	readonly description?: string;
	/** Confidence in this being an entry point */
	readonly confidence: ConfidenceLevel;
}

/**
 * Configuration file information.
 */
export interface IConfigurationFile {
	/** Path to the configuration file */
	readonly path: string;
	/** Type of configuration */
	readonly type: ConfigurationType;
	/** Tool/framework this config is for */
	readonly tool?: string;
	/** Brief description of purpose */
	readonly description?: string;
}

/**
 * Types of configuration files.
 */
export type ConfigurationType =
	| 'build'              // Build configuration (webpack, rollup, vite)
	| 'lint'               // Linting (eslint, prettier)
	| 'test'               // Testing (jest, mocha, vitest)
	| 'ci-cd'              // CI/CD (github actions, jenkins)
	| 'docker'             // Containerization
	| 'package'            // Package management (package.json, Cargo.toml)
	| 'typescript'         // TypeScript configuration
	| 'editor'             // Editor settings (.editorconfig, .vscode)
	| 'git'                // Git configuration (.gitignore, .gitattributes)
	| 'environment'        // Environment configuration (.env)
	| 'other';

// ============================================================================
// Technology Stack Types
// ============================================================================

/**
 * Technology category classification.
 */
export type TechnologyCategory =
	| 'language'           // Programming languages
	| 'framework'          // Frameworks (React, Express, Rails)
	| 'library'            // Libraries and utilities
	| 'database'           // Database systems
	| 'cache'              // Caching systems
	| 'queue'              // Message queues
	| 'search'             // Search engines
	| 'cloud'              // Cloud services
	| 'devops'             // DevOps tools
	| 'testing'            // Testing frameworks
	| 'build'              // Build tools
	| 'monitoring'         // Monitoring and logging
	| 'security'           // Security tools
	| 'ai-ml'              // AI/ML frameworks
	| 'other';

/**
 * Information about a detected technology.
 */
export interface ITechnologyInfo {
	/** Technology name */
	readonly name: string;
	/** Category of this technology */
	readonly category: TechnologyCategory;
	/** Version if detected */
	readonly version?: string;
	/** Confidence in detection */
	readonly confidence: ConfidenceLevel;
	/** Evidence for this detection (file paths, config entries) */
	readonly evidence: readonly string[];
	/** Whether this is a primary/core technology */
	readonly isPrimary: boolean;
	/** Related technologies often used together */
	readonly relatedTechnologies?: readonly string[];
	/** Usage context (e.g., "frontend", "backend", "testing") */
	readonly usageContext?: string;
}

/**
 * Programming language information.
 */
export interface ILanguageInfo {
	/** Language name */
	readonly name: string;
	/** File extensions for this language */
	readonly extensions: readonly string[];
	/** Percentage of codebase in this language */
	readonly percentage: number;
	/** Number of files in this language */
	readonly fileCount: number;
	/** Lines of code in this language */
	readonly linesOfCode?: number;
	/** Primary usage (e.g., "main application", "testing", "build scripts") */
	readonly primaryUsage?: string;
}

/**
 * Framework detection result.
 */
export interface IFrameworkInfo extends ITechnologyInfo {
	/** Framework type (web, mobile, desktop, etc.) */
	readonly frameworkType: FrameworkType;
	/** Architecture pattern used with this framework */
	readonly architecturePattern?: ArchitecturePattern;
	/** Key files/directories that indicate this framework */
	readonly indicatorFiles: readonly string[];
}

/**
 * Types of frameworks.
 */
export type FrameworkType =
	| 'web-frontend'       // React, Vue, Angular
	| 'web-backend'        // Express, Django, Rails
	| 'full-stack'         // Next.js, Remix, Rails
	| 'mobile'             // React Native, Flutter
	| 'desktop'            // Electron, Tauri
	| 'cli'                // Command-line tools
	| 'library'            // Library frameworks
	| 'testing'            // Testing frameworks
	| 'other';

/**
 * Architecture patterns.
 */
export type ArchitecturePattern =
	| 'mvc'                // Model-View-Controller
	| 'mvvm'               // Model-View-ViewModel
	| 'clean-architecture' // Clean/Hexagonal Architecture
	| 'microservices'      // Microservices
	| 'monolith'           // Monolithic
	| 'serverless'         // Serverless/FaaS
	| 'event-driven'       // Event-driven
	| 'layered'            // Layered architecture
	| 'modular'            // Modular/plugin-based
	| 'unknown';

/**
 * Dependency information.
 */
export interface IDependencyInfo {
	/** Dependency name */
	readonly name: string;
	/** Version constraint */
	readonly version: string;
	/** Resolved version (if available) */
	readonly resolvedVersion?: string;
	/** Whether this is a dev dependency */
	readonly isDev: boolean;
	/** Whether this is a peer dependency */
	readonly isPeer: boolean;
	/** Whether this is optional */
	readonly isOptional: boolean;
	/** Category of this dependency */
	readonly category?: TechnologyCategory;
	/** Whether this dependency is deprecated */
	readonly isDeprecated?: boolean;
	/** Known security vulnerabilities */
	readonly vulnerabilities?: readonly IVulnerabilityInfo[];
}

/**
 * Security vulnerability information.
 */
export interface IVulnerabilityInfo {
	/** Vulnerability ID (CVE, GHSA, etc.) */
	readonly id: string;
	/** Severity level */
	readonly severity: 'critical' | 'high' | 'medium' | 'low';
	/** Brief description */
	readonly description: string;
	/** Fixed version (if available) */
	readonly fixedVersion?: string;
}

/**
 * Complete technology stack analysis result.
 */
export interface ITechnologyStack {
	/** Primary programming languages */
	readonly languages: readonly ILanguageInfo[];
	/** Detected frameworks */
	readonly frameworks: readonly IFrameworkInfo[];
	/** All detected technologies */
	readonly technologies: readonly ITechnologyInfo[];
	/** Package managers in use */
	readonly packageManagers: readonly PackageManager[];
	/** Build tools in use */
	readonly buildTools: readonly ITechnologyInfo[];
	/** Testing frameworks */
	readonly testingFrameworks: readonly ITechnologyInfo[];
	/** CI/CD tools */
	readonly ciCdTools: readonly ITechnologyInfo[];
	/** Database technologies */
	readonly databases: readonly ITechnologyInfo[];
	/** Cloud/infrastructure technologies */
	readonly cloudInfrastructure: readonly ITechnologyInfo[];
	/** Overall architecture pattern */
	readonly architecturePattern: ArchitecturePattern;
	/** Confidence in architecture pattern detection */
	readonly architectureConfidence: ConfidenceLevel;
	/** Technology stack summary */
	readonly summary: string;
}

// ============================================================================
// Business Domain Types
// ============================================================================

/**
 * Business domain category.
 */
export type BusinessDomainCategory =
	| 'ecommerce'          // E-commerce/retail
	| 'fintech'            // Financial technology
	| 'healthcare'         // Healthcare/medical
	| 'education'          // Education/e-learning
	| 'social'             // Social media/networking
	| 'enterprise'         // Enterprise/B2B
	| 'gaming'             // Gaming
	| 'media'              // Media/entertainment
	| 'logistics'          // Logistics/supply chain
	| 'iot'                // Internet of Things
	| 'developer-tools'    // Developer tools/infrastructure
	| 'productivity'       // Productivity/collaboration
	| 'communication'      // Communication/messaging
	| 'security'           // Security/identity
	| 'analytics'          // Analytics/BI
	| 'other';

/**
 * Domain concept detected in the codebase.
 */
export interface IDomainConcept {
	/** Concept name */
	readonly name: string;
	/** Description of this concept */
	readonly description: string;
	/** Files where this concept is implemented */
	readonly relatedFiles: readonly string[];
	/** Related concepts */
	readonly relatedConcepts: readonly string[];
	/** Confidence in detection */
	readonly confidence: ConfidenceLevel;
	/** Keywords associated with this concept */
	readonly keywords: readonly string[];
}

/**
 * Domain entity detected in the codebase.
 */
export interface IDomainEntity {
	/** Entity name */
	readonly name: string;
	/** File path where defined */
	readonly definitionPath: string;
	/** Type of entity (model, service, etc.) */
	readonly entityType: EntityType;
	/** Properties/fields of this entity */
	readonly properties: readonly IEntityProperty[];
	/** Relationships to other entities */
	readonly relationships: readonly IEntityRelationship[];
	/** Business rules associated with this entity */
	readonly businessRules?: readonly string[];
}

/**
 * Types of domain entities.
 */
export type EntityType =
	| 'model'              // Data model/entity
	| 'service'            // Business service
	| 'repository'         // Data repository
	| 'controller'         // Controller/handler
	| 'value-object'       // Value object
	| 'aggregate'          // Aggregate root
	| 'event'              // Domain event
	| 'command'            // Command
	| 'query'              // Query
	| 'other';

/**
 * Entity property information.
 */
export interface IEntityProperty {
	/** Property name */
	readonly name: string;
	/** Property type */
	readonly type: string;
	/** Whether this property is required */
	readonly isRequired: boolean;
	/** Whether this is an identifier */
	readonly isIdentifier: boolean;
	/** Description if available */
	readonly description?: string;
}

/**
 * Relationship between entities.
 */
export interface IEntityRelationship {
	/** Target entity name */
	readonly targetEntity: string;
	/** Relationship type */
	readonly relationshipType: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
	/** Name of the relationship */
	readonly name?: string;
	/** Whether this relationship is optional */
	readonly isOptional: boolean;
}

/**
 * Business workflow/process detected.
 */
export interface IBusinessWorkflow {
	/** Workflow name */
	readonly name: string;
	/** Description of the workflow */
	readonly description: string;
	/** Steps in this workflow */
	readonly steps: readonly IWorkflowStep[];
	/** Entry point(s) for this workflow */
	readonly entryPoints: readonly string[];
	/** Entities involved in this workflow */
	readonly involvedEntities: readonly string[];
	/** Confidence in detection */
	readonly confidence: ConfidenceLevel;
}

/**
 * Step in a business workflow.
 */
export interface IWorkflowStep {
	/** Step name */
	readonly name: string;
	/** Step description */
	readonly description: string;
	/** Order in the workflow */
	readonly order: number;
	/** File(s) implementing this step */
	readonly implementationFiles: readonly string[];
}

/**
 * Complete business domain analysis result.
 */
export interface IBusinessDomainAnalysis {
	/** Primary business domain category */
	readonly primaryDomain: BusinessDomainCategory;
	/** Secondary domain categories */
	readonly secondaryDomains: readonly BusinessDomainCategory[];
	/** Confidence in domain detection */
	readonly confidence: ConfidenceLevel;
	/** Domain concepts found */
	readonly concepts: readonly IDomainConcept[];
	/** Domain entities found */
	readonly entities: readonly IDomainEntity[];
	/** Business workflows detected */
	readonly workflows: readonly IBusinessWorkflow[];
	/** Domain-specific terminology/glossary */
	readonly glossary: Record<string, string>;
	/** Business domain summary */
	readonly summary: string;
}

// ============================================================================
// Code Pattern Types
// ============================================================================

/**
 * Design pattern categories.
 */
export type DesignPatternCategory =
	| 'creational'         // Factory, Singleton, Builder, etc.
	| 'structural'         // Adapter, Decorator, Facade, etc.
	| 'behavioral'         // Observer, Strategy, Command, etc.
	| 'architectural'      // MVC, MVVM, Repository, etc.
	| 'concurrency'        // Thread pool, async patterns
	| 'other';

/**
 * Detected design pattern.
 */
export interface IDesignPattern {
	/** Pattern name */
	readonly name: string;
	/** Pattern category */
	readonly category: DesignPatternCategory;
	/** Description of how it's used */
	readonly description: string;
	/** Files implementing this pattern */
	readonly implementations: readonly IPatternImplementation[];
	/** Confidence in detection */
	readonly confidence: ConfidenceLevel;
	/** Whether this pattern is consistently applied */
	readonly isConsistent: boolean;
}

/**
 * Implementation of a design pattern.
 */
export interface IPatternImplementation {
	/** File path */
	readonly path: string;
	/** Line number where pattern starts */
	readonly lineNumber?: number;
	/** Key symbols (class names, function names) */
	readonly symbols: readonly string[];
	/** Notes about this implementation */
	readonly notes?: string;
}

/**
 * Code convention detected in the codebase.
 */
export interface ICodeConvention {
	/** Convention name */
	readonly name: string;
	/** Convention category */
	readonly category: CodeConventionCategory;
	/** Description of the convention */
	readonly description: string;
	/** Examples of the convention */
	readonly examples: readonly string[];
	/** How consistently it's applied (percentage) */
	readonly adherencePercentage: number;
	/** Files that deviate from this convention */
	readonly deviations?: readonly string[];
}

/**
 * Categories of code conventions.
 */
export type CodeConventionCategory =
	| 'naming'             // Naming conventions
	| 'formatting'         // Code formatting
	| 'file-organization'  // File/folder organization
	| 'commenting'         // Documentation/comments
	| 'error-handling'     // Error handling patterns
	| 'testing'            // Testing conventions
	| 'imports'            // Import organization
	| 'typing'             // Type definitions
	| 'other';

/**
 * Anti-pattern detected in the codebase.
 */
export interface IAntiPattern {
	/** Anti-pattern name */
	readonly name: string;
	/** Description of the issue */
	readonly description: string;
	/** Severity of this anti-pattern */
	readonly severity: PriorityLevel;
	/** Files where this anti-pattern occurs */
	readonly occurrences: readonly IPatternOccurrence[];
	/** Suggested remediation */
	readonly remediation: string;
	/** Confidence in detection */
	readonly confidence: ConfidenceLevel;
}

/**
 * Occurrence of a pattern/anti-pattern.
 */
export interface IPatternOccurrence {
	/** File path */
	readonly path: string;
	/** Line number */
	readonly lineNumber?: number;
	/** Code snippet */
	readonly snippet?: string;
	/** Additional context */
	readonly context?: string;
}

/**
 * Code quality metric.
 */
export interface ICodeQualityMetric {
	/** Metric name */
	readonly name: string;
	/** Metric value */
	readonly value: number;
	/** Unit of measurement */
	readonly unit: string;
	/** Whether this value is good, acceptable, or concerning */
	readonly status: 'good' | 'acceptable' | 'concerning';
	/** Benchmark/threshold for comparison */
	readonly threshold?: number;
	/** Description of what this metric measures */
	readonly description: string;
}

/**
 * Complete code pattern analysis result.
 */
export interface ICodePatternAnalysis {
	/** Design patterns detected */
	readonly designPatterns: readonly IDesignPattern[];
	/** Code conventions in use */
	readonly conventions: readonly ICodeConvention[];
	/** Anti-patterns detected */
	readonly antiPatterns: readonly IAntiPattern[];
	/** Code quality metrics */
	readonly qualityMetrics: readonly ICodeQualityMetric[];
	/** Overall code quality score (0-100) */
	readonly overallQualityScore: number;
	/** Key architectural decisions */
	readonly architecturalDecisions: readonly IArchitecturalDecision[];
	/** Code pattern summary */
	readonly summary: string;
}

/**
 * Architectural decision record.
 */
export interface IArchitecturalDecision {
	/** Decision title */
	readonly title: string;
	/** Decision description */
	readonly description: string;
	/** Rationale (if evident from code/docs) */
	readonly rationale?: string;
	/** Consequences of this decision */
	readonly consequences?: readonly string[];
	/** Related files/components */
	readonly relatedComponents: readonly string[];
	/** Status of this decision */
	readonly status: 'implemented' | 'proposed' | 'deprecated' | 'superseded';
}

// ============================================================================
// Complete Analysis Result
// ============================================================================

/**
 * Analysis status.
 */
export type AnalysisStatus =
	| 'pending'            // Not yet started
	| 'in-progress'        // Currently running
	| 'completed'          // Successfully completed
	| 'failed'             // Failed with error
	| 'partial';           // Completed with some issues

/**
 * Complete repository analysis result.
 */
export interface IRepositoryAnalysis {
	/** Unique identifier for this analysis */
	readonly id: string;
	/** Repository path that was analyzed */
	readonly repositoryPath: string;
	/** Timestamp when analysis started */
	readonly startedAt: number;
	/** Timestamp when analysis completed */
	readonly completedAt?: number;
	/** Current status of the analysis */
	readonly status: AnalysisStatus;
	/** Error message if analysis failed */
	readonly error?: string;
	/** Repository structure analysis */
	readonly structure?: IRepositoryStructure;
	/** Technology stack analysis */
	readonly technologyStack?: ITechnologyStack;
	/** Business domain analysis */
	readonly businessDomain?: IBusinessDomainAnalysis;
	/** Code pattern analysis */
	readonly codePatterns?: ICodePatternAnalysis;
	/** Overall analysis summary */
	readonly summary?: string;
	/** Key findings and recommendations */
	readonly keyFindings?: readonly IKeyFinding[];
	/** Analysis metadata */
	readonly metadata: IAnalysisMetadata;
}

/**
 * Key finding from the analysis.
 */
export interface IKeyFinding {
	/** Finding title */
	readonly title: string;
	/** Finding description */
	readonly description: string;
	/** Category of finding */
	readonly category: 'strength' | 'weakness' | 'opportunity' | 'recommendation';
	/** Priority level */
	readonly priority: PriorityLevel;
	/** Related analysis sections */
	readonly relatedSections: readonly ('structure' | 'technology' | 'domain' | 'patterns')[];
}

/**
 * Metadata about the analysis run.
 */
export interface IAnalysisMetadata {
	/** Version of the analyzer */
	readonly analyzerVersion: string;
	/** Duration of analysis in milliseconds */
	readonly durationMs?: number;
	/** Number of files analyzed */
	readonly filesAnalyzed: number;
	/** Number of files skipped (too large, binary, etc.) */
	readonly filesSkipped: number;
	/** Any warnings generated during analysis */
	readonly warnings: readonly string[];
	/** Configuration used for this analysis */
	readonly configuration?: IAnalysisConfiguration;
}

/**
 * Configuration for repository analysis.
 */
export interface IAnalysisConfiguration {
	/** Maximum file size to analyze (bytes) */
	readonly maxFileSize: number;
	/** File patterns to include */
	readonly includePatterns: readonly string[];
	/** File patterns to exclude */
	readonly excludePatterns: readonly string[];
	/** Whether to analyze dependencies */
	readonly analyzeDependencies: boolean;
	/** Whether to analyze git history */
	readonly analyzeGitHistory: boolean;
	/** Maximum depth for directory traversal */
	readonly maxDepth: number;
	/** Whether to detect business domain */
	readonly detectBusinessDomain: boolean;
	/** Whether to analyze code patterns */
	readonly analyzeCodePatterns: boolean;
}

/**
 * Default analysis configuration.
 */
export const DEFAULT_ANALYSIS_CONFIGURATION: IAnalysisConfiguration = {
	maxFileSize: 1024 * 1024, // 1 MB
	includePatterns: ['**/*'],
	excludePatterns: [
		'**/node_modules/**',
		'**/.git/**',
		'**/dist/**',
		'**/build/**',
		'**/out/**',
		'**/.next/**',
		'**/coverage/**',
		'**/*.min.js',
		'**/*.min.css',
		'**/vendor/**',
		'**/third-party/**',
	],
	analyzeDependencies: true,
	analyzeGitHistory: false,
	maxDepth: 10,
	detectBusinessDomain: true,
	analyzeCodePatterns: true,
};
