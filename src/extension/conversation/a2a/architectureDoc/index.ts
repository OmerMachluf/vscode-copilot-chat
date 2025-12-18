/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Architecture Documentation Generator module.
 *
 * This module provides comprehensive tools for generating architecture documentation
 * from repository analysis including:
 * - Type definitions for architecture models and components
 * - Pre-defined documentation templates
 * - Markdown generation utilities
 * - Mermaid diagram generation
 * - Document building service
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

export {
	// Component types
	ComponentType,
	ComponentVisibility,
	ComplexityLevel,

	// File and directory analysis
	IFileInfo,
	IDirectoryInfo,
	IRepositoryStats,

	// Symbol and code analysis
	SymbolType,
	ICodeSymbol,
	ICodeDependency,

	// Component definitions
	IArchitectureComponent,
	IArchitectureLayer,
	IArchitectureModule,

	// Architecture patterns and insights
	IArchitecturePattern,
	IArchitectureInsight,

	// Technology stack
	ITechnology,
	ITechnologyStack,

	// Development guidelines
	ICodingConvention,
	IDevelopmentWorkflow,

	// Complete architecture model
	IArchitectureModel,

	// Documentation templates
	IDocumentSection,
	IDocumentTemplate,
	IDocumentGenerationOptions,
	IDocumentGenerationResult,

	// Diagram generation
	DiagramType,
	IDiagramOptions,
	IGeneratedDiagram,

	// Service interfaces
	IArchitectureAnalyzer,
	IAnalysisOptions,
	IDocumentBuilder,
	IDiagramGenerator,
	IMarkdownGenerator
} from './architectureTypes';

// ============================================================================
// Templates
// ============================================================================

export {
	// Built-in templates
	STANDARD_TEMPLATE,
	MINIMAL_TEMPLATE,
	ONBOARDING_TEMPLATE,
	TECHNICAL_TEMPLATE,
	API_TEMPLATE,
	BUILT_IN_TEMPLATES,

	// Template utilities
	getTemplateById,
	getAvailableTemplateIds,
	createCustomTemplate,
	filterTemplateSections,
	getAllSectionIds,
	findSectionById
} from './architectureTemplates';

// ============================================================================
// Markdown Generation
// ============================================================================

export {
	MarkdownGenerator,
	markdownGenerator
} from './markdownGenerator';

// ============================================================================
// Diagram Generation
// ============================================================================

export {
	DiagramGenerator,
	diagramGenerator
} from './diagramGenerator';

// ============================================================================
// Document Builder
// ============================================================================

export {
	DocumentBuilder,
	documentBuilder
} from './documentBuilder';
