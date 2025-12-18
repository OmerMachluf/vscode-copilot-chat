/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Types and interfaces for the Architecture Documentation Generator.
 *
 * This module defines the data structures used to represent repository architecture,
 * components, relationships, and documentation output.
 */

// ============================================================================
// Component Types
// ============================================================================

/**
 * Types of components that can be identified in a codebase.
 */
export type ComponentType =
	| 'service'        // Backend services, APIs
	| 'controller'     // Request handlers, routers
	| 'model'          // Data models, entities
	| 'view'           // UI components, templates
	| 'utility'        // Helper functions, utilities
	| 'config'         // Configuration files
	| 'middleware'     // Middleware, interceptors
	| 'repository'     // Data access layer
	| 'factory'        // Factory classes
	| 'adapter'        // Adapters, wrappers
	| 'handler'        // Event handlers, command handlers
	| 'provider'       // Dependency providers
	| 'module'         // Feature modules
	| 'test'           // Test files
	| 'documentation'  // Documentation files
	| 'script'         // Build/deploy scripts
	| 'unknown';       // Unclassified

/**
 * Visibility/access level of a component.
 */
export type ComponentVisibility = 'public' | 'internal' | 'private';

/**
 * Complexity levels for code analysis.
 */
export type ComplexityLevel = 'low' | 'medium' | 'high' | 'very-high';

// ============================================================================
// File and Directory Analysis
// ============================================================================

/**
 * Information about a file in the repository.
 */
export interface IFileInfo {
	/** Relative path from repository root */
	readonly path: string;
	/** File name without path */
	readonly name: string;
	/** File extension (e.g., '.ts', '.py') */
	readonly extension: string;
	/** File size in bytes */
	readonly size: number;
	/** Number of lines in the file */
	readonly lineCount?: number;
	/** Last modified timestamp */
	readonly lastModified?: number;
	/** Programming language detected */
	readonly language?: string;
}

/**
 * Information about a directory in the repository.
 */
export interface IDirectoryInfo {
	/** Relative path from repository root */
	readonly path: string;
	/** Directory name */
	readonly name: string;
	/** Number of files in directory (non-recursive) */
	readonly fileCount: number;
	/** Number of subdirectories */
	readonly subdirectoryCount: number;
	/** Total size of all files in bytes */
	readonly totalSize: number;
	/** Primary purpose/category of this directory */
	readonly purpose?: string;
}

/**
 * Statistics about the repository structure.
 */
export interface IRepositoryStats {
	/** Total number of files */
	readonly totalFiles: number;
	/** Total number of directories */
	readonly totalDirectories: number;
	/** Total size of repository in bytes */
	readonly totalSize: number;
	/** Total lines of code (excluding blanks and comments) */
	readonly totalLinesOfCode: number;
	/** Files grouped by extension */
	readonly filesByExtension: Record<string, number>;
	/** Files grouped by language */
	readonly filesByLanguage: Record<string, number>;
	/** Lines of code by language */
	readonly locByLanguage: Record<string, number>;
}

// ============================================================================
// Symbol and Code Analysis
// ============================================================================

/**
 * Types of symbols that can be extracted from code.
 */
export type SymbolType =
	| 'class'
	| 'interface'
	| 'function'
	| 'method'
	| 'property'
	| 'variable'
	| 'constant'
	| 'enum'
	| 'type'
	| 'namespace'
	| 'module';

/**
 * A symbol extracted from source code.
 */
export interface ICodeSymbol {
	/** Symbol name */
	readonly name: string;
	/** Type of symbol */
	readonly type: SymbolType;
	/** File path where symbol is defined */
	readonly filePath: string;
	/** Line number of definition */
	readonly line: number;
	/** Column number of definition */
	readonly column: number;
	/** End line (for multi-line symbols) */
	readonly endLine?: number;
	/** Visibility modifier */
	readonly visibility?: ComponentVisibility;
	/** JSDoc or docstring comment */
	readonly documentation?: string;
	/** Parent symbol (e.g., class for a method) */
	readonly parent?: string;
	/** Exported from module */
	readonly isExported?: boolean;
	/** Default export */
	readonly isDefault?: boolean;
}

/**
 * A dependency between code elements.
 */
export interface ICodeDependency {
	/** Source file/module path */
	readonly source: string;
	/** Target file/module path */
	readonly target: string;
	/** Type of dependency */
	readonly type: 'import' | 'export' | 'extends' | 'implements' | 'uses' | 'calls';
	/** Whether dependency is direct or transitive */
	readonly isDirect: boolean;
	/** Specific symbols imported/used */
	readonly symbols?: string[];
}

// ============================================================================
// Component Definitions
// ============================================================================

/**
 * A logical component in the architecture.
 */
export interface IArchitectureComponent {
	/** Unique identifier for the component */
	readonly id: string;
	/** Human-readable name */
	readonly name: string;
	/** Type of component */
	readonly type: ComponentType;
	/** Brief description of the component's purpose */
	readonly description: string;
	/** Path to the component's main file or directory */
	readonly path: string;
	/** Files that belong to this component */
	readonly files: string[];
	/** Key symbols defined in this component */
	readonly symbols: ICodeSymbol[];
	/** Dependencies on other components */
	readonly dependencies: string[];
	/** Components that depend on this one */
	readonly dependents: string[];
	/** Visibility/access level */
	readonly visibility: ComponentVisibility;
	/** Complexity assessment */
	readonly complexity?: ComplexityLevel;
	/** Key responsibilities of this component */
	readonly responsibilities?: string[];
	/** Design patterns used */
	readonly patterns?: string[];
	/** Additional metadata */
	readonly metadata?: Record<string, unknown>;
}

/**
 * A layer in a layered architecture.
 */
export interface IArchitectureLayer {
	/** Layer identifier */
	readonly id: string;
	/** Layer name (e.g., 'Presentation', 'Business Logic', 'Data Access') */
	readonly name: string;
	/** Layer order (0 = topmost) */
	readonly order: number;
	/** Description of the layer's purpose */
	readonly description: string;
	/** Components in this layer */
	readonly components: string[];
	/** Layers this layer can depend on */
	readonly allowedDependencies: string[];
	/** Color for visualization */
	readonly color?: string;
}

/**
 * A module/package in the architecture.
 */
export interface IArchitectureModule {
	/** Module identifier */
	readonly id: string;
	/** Module name */
	readonly name: string;
	/** Module path */
	readonly path: string;
	/** Description */
	readonly description: string;
	/** Components in this module */
	readonly components: string[];
	/** Sub-modules */
	readonly subModules: string[];
	/** Parent module (if any) */
	readonly parentModule?: string;
	/** Entry point files */
	readonly entryPoints: string[];
	/** Exported APIs */
	readonly exports: ICodeSymbol[];
}

// ============================================================================
// Architecture Patterns and Insights
// ============================================================================

/**
 * A recognized architecture pattern in the codebase.
 */
export interface IArchitecturePattern {
	/** Pattern name (e.g., 'MVC', 'Repository Pattern', 'Dependency Injection') */
	readonly name: string;
	/** Pattern category */
	readonly category: 'structural' | 'behavioral' | 'creational' | 'architectural';
	/** Description of how the pattern is implemented */
	readonly description: string;
	/** Confidence level in pattern detection (0-1) */
	readonly confidence: number;
	/** Components that implement this pattern */
	readonly components: string[];
	/** Files where pattern is evident */
	readonly files: string[];
	/** Evidence for pattern detection */
	readonly evidence: string[];
}

/**
 * An architectural insight or recommendation.
 */
export interface IArchitectureInsight {
	/** Unique identifier */
	readonly id: string;
	/** Type of insight */
	readonly type: 'strength' | 'concern' | 'recommendation' | 'observation';
	/** Severity for concerns */
	readonly severity?: 'low' | 'medium' | 'high' | 'critical';
	/** Title of the insight */
	readonly title: string;
	/** Detailed description */
	readonly description: string;
	/** Affected components */
	readonly affectedComponents?: string[];
	/** Affected files */
	readonly affectedFiles?: string[];
	/** Suggested actions */
	readonly suggestions?: string[];
	/** Related patterns */
	readonly relatedPatterns?: string[];
}

// ============================================================================
// Technology Stack
// ============================================================================

/**
 * A technology/framework detected in the repository.
 */
export interface ITechnology {
	/** Technology name */
	readonly name: string;
	/** Category of technology */
	readonly category: 'language' | 'framework' | 'library' | 'tool' | 'platform' | 'database' | 'infrastructure';
	/** Detected version (if available) */
	readonly version?: string;
	/** Confidence in detection (0-1) */
	readonly confidence: number;
	/** Files where technology is used */
	readonly usageFiles: string[];
	/** Configuration files for this technology */
	readonly configFiles?: string[];
	/** Official website or documentation URL */
	readonly url?: string;
}

/**
 * Complete technology stack of the repository.
 */
export interface ITechnologyStack {
	/** Primary programming languages */
	readonly languages: ITechnology[];
	/** Frameworks used */
	readonly frameworks: ITechnology[];
	/** Libraries and dependencies */
	readonly libraries: ITechnology[];
	/** Build and development tools */
	readonly tools: ITechnology[];
	/** Platforms (cloud, OS, etc.) */
	readonly platforms: ITechnology[];
	/** Databases */
	readonly databases: ITechnology[];
	/** Infrastructure (Docker, K8s, etc.) */
	readonly infrastructure: ITechnology[];
}

// ============================================================================
// Development Guidelines
// ============================================================================

/**
 * A coding convention or guideline detected or recommended.
 */
export interface ICodingConvention {
	/** Convention category */
	readonly category: 'naming' | 'formatting' | 'structure' | 'documentation' | 'testing' | 'error-handling' | 'security';
	/** Convention name/title */
	readonly name: string;
	/** Description of the convention */
	readonly description: string;
	/** Examples of correct usage */
	readonly examples?: string[];
	/** Files where convention is followed */
	readonly evidenceFiles?: string[];
	/** Whether this is detected or recommended */
	readonly source: 'detected' | 'recommended';
}

/**
 * Development workflow guidelines.
 */
export interface IDevelopmentWorkflow {
	/** Branching strategy detected */
	readonly branchingStrategy?: string;
	/** Commit message conventions */
	readonly commitConventions?: string[];
	/** Pull request guidelines */
	readonly prGuidelines?: string[];
	/** CI/CD pipelines detected */
	readonly cicdPipelines?: string[];
	/** Testing requirements */
	readonly testingRequirements?: string[];
	/** Code review process */
	readonly codeReviewProcess?: string[];
}

// ============================================================================
// Complete Architecture Model
// ============================================================================

/**
 * Complete architecture model of a repository.
 */
export interface IArchitectureModel {
	/** Repository name */
	readonly name: string;
	/** Repository description */
	readonly description: string;
	/** Repository root path */
	readonly rootPath: string;
	/** When the analysis was performed */
	readonly analyzedAt: number;
	/** Analysis version for compatibility */
	readonly version: string;

	/** Repository statistics */
	readonly stats: IRepositoryStats;
	/** Technology stack */
	readonly techStack: ITechnologyStack;

	/** Architectural components */
	readonly components: IArchitectureComponent[];
	/** Architectural layers (if applicable) */
	readonly layers: IArchitectureLayer[];
	/** Modules/packages */
	readonly modules: IArchitectureModule[];

	/** Detected patterns */
	readonly patterns: IArchitecturePattern[];
	/** Insights and recommendations */
	readonly insights: IArchitectureInsight[];

	/** Coding conventions */
	readonly conventions: ICodingConvention[];
	/** Development workflow */
	readonly workflow: IDevelopmentWorkflow;

	/** Key entry points for understanding the codebase */
	readonly entryPoints: string[];
	/** Recommended files to read first */
	readonly recommendedReadingOrder: string[];

	/** Additional metadata */
	readonly metadata?: Record<string, unknown>;
}

// ============================================================================
// Documentation Templates
// ============================================================================

/**
 * A section in the generated documentation.
 */
export interface IDocumentSection {
	/** Section identifier */
	readonly id: string;
	/** Section title */
	readonly title: string;
	/** Section level (1-6 for h1-h6) */
	readonly level: number;
	/** Section content (markdown) */
	readonly content: string;
	/** Subsections */
	readonly subsections?: IDocumentSection[];
	/** Whether section is collapsible */
	readonly collapsible?: boolean;
	/** Order in parent (lower = earlier) */
	readonly order: number;
}

/**
 * Template for generating architecture documentation.
 */
export interface IDocumentTemplate {
	/** Template identifier */
	readonly id: string;
	/** Template name */
	readonly name: string;
	/** Template description */
	readonly description: string;
	/** Sections in this template */
	readonly sections: IDocumentSection[];
	/** Required data fields for this template */
	readonly requiredFields: string[];
	/** Optional data fields */
	readonly optionalFields: string[];
	/** Target output format */
	readonly outputFormat: 'markdown' | 'html' | 'pdf';
	/** Template version */
	readonly version: string;
}

/**
 * Options for document generation.
 */
export interface IDocumentGenerationOptions {
	/** Template to use */
	readonly templateId: string;
	/** Output file path */
	readonly outputPath: string;
	/** Sections to include (all if not specified) */
	readonly includeSections?: string[];
	/** Sections to exclude */
	readonly excludeSections?: string[];
	/** Include table of contents */
	readonly includeToc?: boolean;
	/** Include mermaid diagrams */
	readonly includeDiagrams?: boolean;
	/** Maximum depth for component trees */
	readonly maxDepth?: number;
	/** Include code examples */
	readonly includeExamples?: boolean;
	/** Detail level */
	readonly detailLevel: 'minimal' | 'standard' | 'detailed' | 'comprehensive';
}

/**
 * Result of document generation.
 */
export interface IDocumentGenerationResult {
	/** Whether generation was successful */
	readonly success: boolean;
	/** Generated document content */
	readonly content?: string;
	/** Output file path */
	readonly outputPath?: string;
	/** Sections that were generated */
	readonly generatedSections: string[];
	/** Sections that were skipped */
	readonly skippedSections: string[];
	/** Warnings during generation */
	readonly warnings: string[];
	/** Error message if failed */
	readonly error?: string;
	/** Generation time in milliseconds */
	readonly generationTime: number;
}

// ============================================================================
// Diagram Generation
// ============================================================================

/**
 * Types of diagrams that can be generated.
 */
export type DiagramType =
	| 'component'      // Component diagram
	| 'dependency'     // Dependency graph
	| 'class'          // Class diagram
	| 'sequence'       // Sequence diagram
	| 'flowchart'      // Flowchart
	| 'architecture'   // High-level architecture diagram
	| 'module'         // Module structure
	| 'layer';         // Layer diagram

/**
 * Options for diagram generation.
 */
export interface IDiagramOptions {
	/** Type of diagram */
	readonly type: DiagramType;
	/** Diagram title */
	readonly title?: string;
	/** Components/elements to include */
	readonly include?: string[];
	/** Components/elements to exclude */
	readonly exclude?: string[];
	/** Direction (for flowcharts/dependency graphs) */
	readonly direction?: 'TB' | 'BT' | 'LR' | 'RL';
	/** Maximum nodes to show */
	readonly maxNodes?: number;
	/** Show detailed labels */
	readonly showDetails?: boolean;
	/** Group by layer/module */
	readonly groupBy?: 'layer' | 'module' | 'type' | 'none';
}

/**
 * Generated diagram.
 */
export interface IGeneratedDiagram {
	/** Diagram type */
	readonly type: DiagramType;
	/** Mermaid or other diagram code */
	readonly code: string;
	/** Diagram format */
	readonly format: 'mermaid' | 'plantuml' | 'graphviz';
	/** Title */
	readonly title?: string;
	/** Description */
	readonly description?: string;
}

// ============================================================================
// Service Interfaces
// ============================================================================

/**
 * Service for analyzing repository architecture.
 */
export interface IArchitectureAnalyzer {
	/**
	 * Analyze a repository and generate an architecture model.
	 * @param rootPath Path to the repository root
	 * @param options Analysis options
	 */
	analyzeRepository(rootPath: string, options?: IAnalysisOptions): Promise<IArchitectureModel>;

	/**
	 * Get repository statistics.
	 * @param rootPath Path to the repository root
	 */
	getRepositoryStats(rootPath: string): Promise<IRepositoryStats>;

	/**
	 * Detect technology stack.
	 * @param rootPath Path to the repository root
	 */
	detectTechnologyStack(rootPath: string): Promise<ITechnologyStack>;

	/**
	 * Extract symbols from a file.
	 * @param filePath Path to the file
	 */
	extractSymbols(filePath: string): Promise<ICodeSymbol[]>;

	/**
	 * Detect architecture patterns.
	 * @param model Architecture model
	 */
	detectPatterns(model: IArchitectureModel): Promise<IArchitecturePattern[]>;
}

/**
 * Options for repository analysis.
 */
export interface IAnalysisOptions {
	/** File patterns to include (globs) */
	readonly includePatterns?: string[];
	/** File patterns to exclude (globs) */
	readonly excludePatterns?: string[];
	/** Maximum file size to analyze (in bytes) */
	readonly maxFileSize?: number;
	/** Maximum files to analyze */
	readonly maxFiles?: number;
	/** Whether to extract symbols */
	readonly extractSymbols?: boolean;
	/** Whether to analyze dependencies */
	readonly analyzeDependencies?: boolean;
	/** Whether to detect patterns */
	readonly detectPatterns?: boolean;
	/** Whether to generate insights */
	readonly generateInsights?: boolean;
}

/**
 * Service for generating architecture documentation.
 */
export interface IDocumentBuilder {
	/**
	 * Generate documentation from an architecture model.
	 * @param model Architecture model
	 * @param options Generation options
	 */
	generateDocument(model: IArchitectureModel, options: IDocumentGenerationOptions): Promise<IDocumentGenerationResult>;

	/**
	 * Get available templates.
	 */
	getTemplates(): IDocumentTemplate[];

	/**
	 * Get a specific template by ID.
	 * @param templateId Template identifier
	 */
	getTemplate(templateId: string): IDocumentTemplate | undefined;

	/**
	 * Register a custom template.
	 * @param template Template to register
	 */
	registerTemplate(template: IDocumentTemplate): void;

	/**
	 * Generate a specific section.
	 * @param model Architecture model
	 * @param sectionId Section identifier
	 */
	generateSection(model: IArchitectureModel, sectionId: string): Promise<string>;
}

/**
 * Service for generating diagrams.
 */
export interface IDiagramGenerator {
	/**
	 * Generate a diagram from an architecture model.
	 * @param model Architecture model
	 * @param options Diagram options
	 */
	generateDiagram(model: IArchitectureModel, options: IDiagramOptions): IGeneratedDiagram;

	/**
	 * Generate all relevant diagrams for a model.
	 * @param model Architecture model
	 */
	generateAllDiagrams(model: IArchitectureModel): IGeneratedDiagram[];

	/**
	 * Check if a diagram type is supported.
	 * @param type Diagram type
	 */
	isSupported(type: DiagramType): boolean;
}

/**
 * Service for generating markdown content.
 */
export interface IMarkdownGenerator {
	/**
	 * Generate a markdown table.
	 * @param headers Table headers
	 * @param rows Table rows
	 * @param alignment Column alignments
	 */
	generateTable(headers: string[], rows: string[][], alignment?: ('left' | 'center' | 'right')[]): string;

	/**
	 * Generate a markdown list.
	 * @param items List items
	 * @param ordered Whether list is ordered
	 */
	generateList(items: string[], ordered?: boolean): string;

	/**
	 * Generate a markdown code block.
	 * @param code Code content
	 * @param language Language for syntax highlighting
	 */
	generateCodeBlock(code: string, language?: string): string;

	/**
	 * Generate a mermaid diagram block.
	 * @param diagram Mermaid diagram code
	 */
	generateMermaidBlock(diagram: string): string;

	/**
	 * Generate a collapsible details section.
	 * @param summary Summary text
	 * @param content Content when expanded
	 */
	generateDetails(summary: string, content: string): string;

	/**
	 * Generate a markdown link.
	 * @param text Link text
	 * @param url Link URL
	 * @param title Optional title
	 */
	generateLink(text: string, url: string, title?: string): string;

	/**
	 * Generate a badge.
	 * @param label Badge label
	 * @param message Badge message
	 * @param color Badge color
	 */
	generateBadge(label: string, message: string, color?: string): string;

	/**
	 * Generate table of contents from sections.
	 * @param sections Document sections
	 * @param maxDepth Maximum depth to include
	 */
	generateTableOfContents(sections: IDocumentSection[], maxDepth?: number): string;

	/**
	 * Escape markdown special characters.
	 * @param text Text to escape
	 */
	escapeMarkdown(text: string): string;
}
