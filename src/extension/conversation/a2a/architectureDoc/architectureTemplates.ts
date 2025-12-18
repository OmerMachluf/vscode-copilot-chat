/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Architecture documentation templates.
 *
 * This module provides pre-defined templates for generating architecture documentation
 * with different levels of detail and focus areas.
 */

import { IDocumentSection, IDocumentTemplate } from './architectureTypes';

// ============================================================================
// Section Definitions
// ============================================================================

/**
 * Creates a section for the system overview.
 */
function createOverviewSection(): IDocumentSection {
	return {
		id: 'overview',
		title: 'System Overview',
		level: 2,
		order: 1,
		content: '',
		subsections: [
			{
				id: 'overview-description',
				title: 'Description',
				level: 3,
				order: 1,
				content: '{{description}}'
			},
			{
				id: 'overview-purpose',
				title: 'Purpose',
				level: 3,
				order: 2,
				content: '{{purpose}}'
			},
			{
				id: 'overview-key-features',
				title: 'Key Features',
				level: 3,
				order: 3,
				content: '{{keyFeatures}}'
			}
		]
	};
}

/**
 * Creates a section for repository statistics.
 */
function createStatsSection(): IDocumentSection {
	return {
		id: 'stats',
		title: 'Repository Statistics',
		level: 2,
		order: 2,
		collapsible: true,
		content: '',
		subsections: [
			{
				id: 'stats-summary',
				title: 'Summary',
				level: 3,
				order: 1,
				content: '{{statsSummary}}'
			},
			{
				id: 'stats-languages',
				title: 'Languages',
				level: 3,
				order: 2,
				content: '{{languageBreakdown}}'
			},
			{
				id: 'stats-files',
				title: 'File Distribution',
				level: 3,
				order: 3,
				content: '{{fileDistribution}}'
			}
		]
	};
}

/**
 * Creates a section for technology stack.
 */
function createTechStackSection(): IDocumentSection {
	return {
		id: 'tech-stack',
		title: 'Technology Stack',
		level: 2,
		order: 3,
		content: '',
		subsections: [
			{
				id: 'tech-languages',
				title: 'Languages',
				level: 3,
				order: 1,
				content: '{{techLanguages}}'
			},
			{
				id: 'tech-frameworks',
				title: 'Frameworks',
				level: 3,
				order: 2,
				content: '{{techFrameworks}}'
			},
			{
				id: 'tech-libraries',
				title: 'Key Libraries',
				level: 3,
				order: 3,
				content: '{{techLibraries}}'
			},
			{
				id: 'tech-tools',
				title: 'Development Tools',
				level: 3,
				order: 4,
				content: '{{techTools}}'
			},
			{
				id: 'tech-infrastructure',
				title: 'Infrastructure',
				level: 3,
				order: 5,
				content: '{{techInfrastructure}}'
			}
		]
	};
}

/**
 * Creates a section for architecture overview with diagrams.
 */
function createArchitectureSection(): IDocumentSection {
	return {
		id: 'architecture',
		title: 'Architecture',
		level: 2,
		order: 4,
		content: '',
		subsections: [
			{
				id: 'arch-high-level',
				title: 'High-Level Architecture',
				level: 3,
				order: 1,
				content: '{{highLevelArchitecture}}'
			},
			{
				id: 'arch-diagram',
				title: 'Architecture Diagram',
				level: 3,
				order: 2,
				content: '{{architectureDiagram}}'
			},
			{
				id: 'arch-layers',
				title: 'Layers',
				level: 3,
				order: 3,
				content: '{{architectureLayers}}'
			},
			{
				id: 'arch-patterns',
				title: 'Design Patterns',
				level: 3,
				order: 4,
				content: '{{designPatterns}}'
			}
		]
	};
}

/**
 * Creates a section for component documentation.
 */
function createComponentsSection(): IDocumentSection {
	return {
		id: 'components',
		title: 'Components',
		level: 2,
		order: 5,
		content: '',
		subsections: [
			{
				id: 'components-overview',
				title: 'Component Overview',
				level: 3,
				order: 1,
				content: '{{componentsOverview}}'
			},
			{
				id: 'components-diagram',
				title: 'Component Diagram',
				level: 3,
				order: 2,
				content: '{{componentDiagram}}'
			},
			{
				id: 'components-details',
				title: 'Component Details',
				level: 3,
				order: 3,
				content: '{{componentDetails}}'
			}
		]
	};
}

/**
 * Creates a section for module documentation.
 */
function createModulesSection(): IDocumentSection {
	return {
		id: 'modules',
		title: 'Modules',
		level: 2,
		order: 6,
		content: '',
		subsections: [
			{
				id: 'modules-structure',
				title: 'Module Structure',
				level: 3,
				order: 1,
				content: '{{moduleStructure}}'
			},
			{
				id: 'modules-diagram',
				title: 'Module Diagram',
				level: 3,
				order: 2,
				content: '{{moduleDiagram}}'
			},
			{
				id: 'modules-details',
				title: 'Module Details',
				level: 3,
				order: 3,
				content: '{{moduleDetails}}'
			}
		]
	};
}

/**
 * Creates a section for dependencies.
 */
function createDependenciesSection(): IDocumentSection {
	return {
		id: 'dependencies',
		title: 'Dependencies',
		level: 2,
		order: 7,
		content: '',
		subsections: [
			{
				id: 'deps-internal',
				title: 'Internal Dependencies',
				level: 3,
				order: 1,
				content: '{{internalDependencies}}'
			},
			{
				id: 'deps-external',
				title: 'External Dependencies',
				level: 3,
				order: 2,
				content: '{{externalDependencies}}'
			},
			{
				id: 'deps-diagram',
				title: 'Dependency Graph',
				level: 3,
				order: 3,
				content: '{{dependencyDiagram}}'
			}
		]
	};
}

/**
 * Creates a section for directory structure.
 */
function createDirectoryStructureSection(): IDocumentSection {
	return {
		id: 'directory-structure',
		title: 'Directory Structure',
		level: 2,
		order: 8,
		collapsible: true,
		content: '{{directoryTree}}',
		subsections: [
			{
				id: 'dir-key-directories',
				title: 'Key Directories',
				level: 3,
				order: 1,
				content: '{{keyDirectories}}'
			}
		]
	};
}

/**
 * Creates a section for entry points.
 */
function createEntryPointsSection(): IDocumentSection {
	return {
		id: 'entry-points',
		title: 'Entry Points',
		level: 2,
		order: 9,
		content: '{{entryPoints}}',
		subsections: [
			{
				id: 'entry-main',
				title: 'Main Entry Points',
				level: 3,
				order: 1,
				content: '{{mainEntryPoints}}'
			},
			{
				id: 'entry-api',
				title: 'API Entry Points',
				level: 3,
				order: 2,
				content: '{{apiEntryPoints}}'
			}
		]
	};
}

/**
 * Creates a section for coding conventions.
 */
function createConventionsSection(): IDocumentSection {
	return {
		id: 'conventions',
		title: 'Coding Conventions',
		level: 2,
		order: 10,
		content: '',
		subsections: [
			{
				id: 'conv-naming',
				title: 'Naming Conventions',
				level: 3,
				order: 1,
				content: '{{namingConventions}}'
			},
			{
				id: 'conv-formatting',
				title: 'Formatting',
				level: 3,
				order: 2,
				content: '{{formattingConventions}}'
			},
			{
				id: 'conv-structure',
				title: 'Code Structure',
				level: 3,
				order: 3,
				content: '{{structureConventions}}'
			},
			{
				id: 'conv-documentation',
				title: 'Documentation',
				level: 3,
				order: 4,
				content: '{{documentationConventions}}'
			}
		]
	};
}

/**
 * Creates a section for development workflow.
 */
function createWorkflowSection(): IDocumentSection {
	return {
		id: 'workflow',
		title: 'Development Workflow',
		level: 2,
		order: 11,
		content: '',
		subsections: [
			{
				id: 'workflow-branching',
				title: 'Branching Strategy',
				level: 3,
				order: 1,
				content: '{{branchingStrategy}}'
			},
			{
				id: 'workflow-commit',
				title: 'Commit Conventions',
				level: 3,
				order: 2,
				content: '{{commitConventions}}'
			},
			{
				id: 'workflow-ci',
				title: 'CI/CD',
				level: 3,
				order: 3,
				content: '{{cicdWorkflow}}'
			},
			{
				id: 'workflow-testing',
				title: 'Testing',
				level: 3,
				order: 4,
				content: '{{testingWorkflow}}'
			}
		]
	};
}

/**
 * Creates a section for getting started guide.
 */
function createGettingStartedSection(): IDocumentSection {
	return {
		id: 'getting-started',
		title: 'Getting Started',
		level: 2,
		order: 12,
		content: '',
		subsections: [
			{
				id: 'gs-prerequisites',
				title: 'Prerequisites',
				level: 3,
				order: 1,
				content: '{{prerequisites}}'
			},
			{
				id: 'gs-installation',
				title: 'Installation',
				level: 3,
				order: 2,
				content: '{{installation}}'
			},
			{
				id: 'gs-configuration',
				title: 'Configuration',
				level: 3,
				order: 3,
				content: '{{configuration}}'
			},
			{
				id: 'gs-first-steps',
				title: 'First Steps',
				level: 3,
				order: 4,
				content: '{{firstSteps}}'
			}
		]
	};
}

/**
 * Creates a section for insights and recommendations.
 */
function createInsightsSection(): IDocumentSection {
	return {
		id: 'insights',
		title: 'Architecture Insights',
		level: 2,
		order: 13,
		content: '',
		subsections: [
			{
				id: 'insights-strengths',
				title: 'Strengths',
				level: 3,
				order: 1,
				content: '{{strengths}}'
			},
			{
				id: 'insights-concerns',
				title: 'Areas of Concern',
				level: 3,
				order: 2,
				content: '{{concerns}}'
			},
			{
				id: 'insights-recommendations',
				title: 'Recommendations',
				level: 3,
				order: 3,
				content: '{{recommendations}}'
			}
		]
	};
}

/**
 * Creates a section for recommended reading order.
 */
function createReadingOrderSection(): IDocumentSection {
	return {
		id: 'reading-order',
		title: 'Recommended Reading Order',
		level: 2,
		order: 14,
		content: '{{readingOrder}}'
	};
}

// ============================================================================
// Template Definitions
// ============================================================================

/**
 * Standard architecture documentation template.
 * Provides comprehensive documentation with all sections.
 */
export const STANDARD_TEMPLATE: IDocumentTemplate = {
	id: 'standard',
	name: 'Standard Architecture Documentation',
	description: 'Comprehensive architecture documentation with all sections including diagrams, components, and development guidelines.',
	version: '1.0.0',
	outputFormat: 'markdown',
	requiredFields: [
		'name',
		'description',
		'rootPath',
		'stats',
		'techStack',
		'components'
	],
	optionalFields: [
		'layers',
		'modules',
		'patterns',
		'insights',
		'conventions',
		'workflow',
		'entryPoints',
		'recommendedReadingOrder'
	],
	sections: [
		createOverviewSection(),
		createStatsSection(),
		createTechStackSection(),
		createArchitectureSection(),
		createComponentsSection(),
		createModulesSection(),
		createDependenciesSection(),
		createDirectoryStructureSection(),
		createEntryPointsSection(),
		createConventionsSection(),
		createWorkflowSection(),
		createGettingStartedSection(),
		createInsightsSection(),
		createReadingOrderSection()
	]
};

/**
 * Minimal architecture documentation template.
 * Provides a quick overview without detailed sections.
 */
export const MINIMAL_TEMPLATE: IDocumentTemplate = {
	id: 'minimal',
	name: 'Minimal Architecture Overview',
	description: 'Quick architecture overview with essential information only.',
	version: '1.0.0',
	outputFormat: 'markdown',
	requiredFields: [
		'name',
		'description',
		'techStack'
	],
	optionalFields: [
		'stats',
		'components'
	],
	sections: [
		createOverviewSection(),
		createTechStackSection(),
		createDirectoryStructureSection(),
		createReadingOrderSection()
	]
};

/**
 * Onboarding-focused template.
 * Designed to help new developers understand the codebase quickly.
 */
export const ONBOARDING_TEMPLATE: IDocumentTemplate = {
	id: 'onboarding',
	name: 'Developer Onboarding Guide',
	description: 'Documentation focused on helping new developers get up to speed quickly.',
	version: '1.0.0',
	outputFormat: 'markdown',
	requiredFields: [
		'name',
		'description',
		'techStack',
		'entryPoints'
	],
	optionalFields: [
		'stats',
		'components',
		'conventions',
		'workflow',
		'recommendedReadingOrder'
	],
	sections: [
		createOverviewSection(),
		createTechStackSection(),
		createGettingStartedSection(),
		createDirectoryStructureSection(),
		createArchitectureSection(),
		createComponentsSection(),
		createConventionsSection(),
		createWorkflowSection(),
		createEntryPointsSection(),
		createReadingOrderSection()
	]
};

/**
 * Technical deep-dive template.
 * Provides detailed technical documentation with emphasis on code structure.
 */
export const TECHNICAL_TEMPLATE: IDocumentTemplate = {
	id: 'technical',
	name: 'Technical Architecture Deep-Dive',
	description: 'Detailed technical documentation with emphasis on code structure, patterns, and dependencies.',
	version: '1.0.0',
	outputFormat: 'markdown',
	requiredFields: [
		'name',
		'description',
		'stats',
		'techStack',
		'components',
		'patterns'
	],
	optionalFields: [
		'layers',
		'modules',
		'insights'
	],
	sections: [
		createOverviewSection(),
		createStatsSection(),
		createTechStackSection(),
		createArchitectureSection(),
		createComponentsSection(),
		createModulesSection(),
		createDependenciesSection(),
		createInsightsSection()
	]
};

/**
 * API-focused template.
 * Documentation focused on API structure and entry points.
 */
export const API_TEMPLATE: IDocumentTemplate = {
	id: 'api',
	name: 'API Architecture Documentation',
	description: 'Documentation focused on API structure, endpoints, and integration points.',
	version: '1.0.0',
	outputFormat: 'markdown',
	requiredFields: [
		'name',
		'description',
		'entryPoints',
		'components'
	],
	optionalFields: [
		'techStack',
		'patterns'
	],
	sections: [
		createOverviewSection(),
		createTechStackSection(),
		createEntryPointsSection(),
		createComponentsSection(),
		createDependenciesSection()
	]
};

// ============================================================================
// Template Registry
// ============================================================================

/**
 * All available built-in templates.
 */
export const BUILT_IN_TEMPLATES: IDocumentTemplate[] = [
	STANDARD_TEMPLATE,
	MINIMAL_TEMPLATE,
	ONBOARDING_TEMPLATE,
	TECHNICAL_TEMPLATE,
	API_TEMPLATE
];

/**
 * Get a template by ID.
 * @param templateId Template identifier
 * @returns Template or undefined if not found
 */
export function getTemplateById(templateId: string): IDocumentTemplate | undefined {
	return BUILT_IN_TEMPLATES.find(t => t.id === templateId);
}

/**
 * Get all available template IDs.
 * @returns Array of template IDs
 */
export function getAvailableTemplateIds(): string[] {
	return BUILT_IN_TEMPLATES.map(t => t.id);
}

/**
 * Create a custom template by extending an existing one.
 * @param baseTemplateId Base template ID
 * @param overrides Properties to override
 * @returns New template
 */
export function createCustomTemplate(
	baseTemplateId: string,
	overrides: Partial<Omit<IDocumentTemplate, 'id'>> & { id: string }
): IDocumentTemplate | undefined {
	const base = getTemplateById(baseTemplateId);
	if (!base) {
		return undefined;
	}

	return {
		...base,
		...overrides,
		sections: overrides.sections ?? base.sections,
		requiredFields: overrides.requiredFields ?? base.requiredFields,
		optionalFields: overrides.optionalFields ?? base.optionalFields
	};
}

/**
 * Filter template sections by ID.
 * @param template Template to filter
 * @param includeSections Section IDs to include (all if undefined)
 * @param excludeSections Section IDs to exclude
 * @returns Filtered sections
 */
export function filterTemplateSections(
	template: IDocumentTemplate,
	includeSections?: string[],
	excludeSections?: string[]
): IDocumentSection[] {
	let sections = template.sections;

	if (includeSections && includeSections.length > 0) {
		sections = sections.filter(s => includeSections.includes(s.id));
	}

	if (excludeSections && excludeSections.length > 0) {
		sections = sections.filter(s => !excludeSections.includes(s.id));
	}

	return sections.sort((a, b) => a.order - b.order);
}

/**
 * Get all section IDs from a template (including subsections).
 * @param template Template to extract section IDs from
 * @returns Array of all section IDs
 */
export function getAllSectionIds(template: IDocumentTemplate): string[] {
	const ids: string[] = [];

	function collectIds(sections: IDocumentSection[]): void {
		for (const section of sections) {
			ids.push(section.id);
			if (section.subsections) {
				collectIds(section.subsections);
			}
		}
	}

	collectIds(template.sections);
	return ids;
}

/**
 * Find a section by ID in a template.
 * @param template Template to search
 * @param sectionId Section ID to find
 * @returns Section or undefined
 */
export function findSectionById(
	template: IDocumentTemplate,
	sectionId: string
): IDocumentSection | undefined {
	function findInSections(sections: IDocumentSection[]): IDocumentSection | undefined {
		for (const section of sections) {
			if (section.id === sectionId) {
				return section;
			}
			if (section.subsections) {
				const found = findInSections(section.subsections);
				if (found) {
					return found;
				}
			}
		}
		return undefined;
	}

	return findInSections(template.sections);
}
