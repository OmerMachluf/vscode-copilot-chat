/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Document builder service for architecture documentation.
 *
 * This module provides the main service for building architecture documentation
 * by combining templates, model data, and markdown generation.
 */

import {
	IArchitectureComponent,
	IArchitectureModel,
	IArchitecturePattern,
	ICodingConvention,
	IDocumentBuilder,
	IDocumentGenerationOptions,
	IDocumentGenerationResult,
	IDocumentSection,
	IDocumentTemplate,
	ITechnology
} from './architectureTypes';
import {
	BUILT_IN_TEMPLATES,
	filterTemplateSections,
	getTemplateById
} from './architectureTemplates';
import { MarkdownGenerator } from './markdownGenerator';
import { DiagramGenerator } from './diagramGenerator';

// ============================================================================
// Document Builder Implementation
// ============================================================================

/**
 * Implementation of the document builder service.
 */
export class DocumentBuilder implements IDocumentBuilder {

	/**
	 * Registered templates (built-in + custom).
	 */
	private readonly templates: Map<string, IDocumentTemplate> = new Map();

	/**
	 * Markdown generator instance.
	 */
	private readonly markdown: MarkdownGenerator;

	/**
	 * Diagram generator instance.
	 */
	private readonly diagrams: DiagramGenerator;

	/**
	 * Create a new document builder.
	 */
	constructor() {
		this.markdown = new MarkdownGenerator();
		this.diagrams = new DiagramGenerator();

		// Register built-in templates
		for (const template of BUILT_IN_TEMPLATES) {
			this.templates.set(template.id, template);
		}
	}

	/**
	 * Get all available templates.
	 */
	getTemplates(): IDocumentTemplate[] {
		return Array.from(this.templates.values());
	}

	/**
	 * Get a template by ID.
	 */
	getTemplate(templateId: string): IDocumentTemplate | undefined {
		return this.templates.get(templateId) ?? getTemplateById(templateId);
	}

	/**
	 * Register a custom template.
	 */
	registerTemplate(template: IDocumentTemplate): void {
		this.templates.set(template.id, template);
	}

	/**
	 * Generate documentation from an architecture model.
	 */
	async generateDocument(
		model: IArchitectureModel,
		options: IDocumentGenerationOptions
	): Promise<IDocumentGenerationResult> {
		const startTime = Date.now();
		const generatedSections: string[] = [];
		const skippedSections: string[] = [];
		const warnings: string[] = [];

		try {
			// Get template
			const template = this.getTemplate(options.templateId);
			if (!template) {
				return {
					success: false,
					generatedSections: [],
					skippedSections: [],
					warnings: [],
					error: `Template '${options.templateId}' not found`,
					generationTime: Date.now() - startTime
				};
			}

			// Validate required fields
			const missingFields = this.validateRequiredFields(model, template);
			if (missingFields.length > 0) {
				warnings.push(`Missing optional data: ${missingFields.join(', ')}`);
			}

			// Filter sections
			const sections = filterTemplateSections(
				template,
				options.includeSections,
				options.excludeSections
			);

			// Build document content
			const contentParts: string[] = [];

			// Add title
			contentParts.push(this.markdown.generateHeading(model.name, 1));
			contentParts.push('');

			// Add description
			if (model.description) {
				contentParts.push(model.description);
				contentParts.push('');
			}

			// Add badges
			contentParts.push(this.generateBadges(model));
			contentParts.push('');

			// Add table of contents if requested
			if (options.includeToc !== false) {
				contentParts.push(this.markdown.generateTableOfContents(sections));
				contentParts.push('');
				contentParts.push(this.markdown.generateHorizontalRule());
				contentParts.push('');
			}

			// Generate each section
			for (const section of sections) {
				try {
					const sectionContent = await this.generateSectionContent(model, section, options);
					if (sectionContent) {
						contentParts.push(sectionContent);
						contentParts.push('');
						generatedSections.push(section.id);
					} else {
						skippedSections.push(section.id);
					}
				} catch (e) {
					const error = e instanceof Error ? e.message : String(e);
					warnings.push(`Error generating section '${section.id}': ${error}`);
					skippedSections.push(section.id);
				}
			}

			// Add footer
			contentParts.push(this.markdown.generateHorizontalRule());
			contentParts.push('');
			contentParts.push(`*Generated on ${new Date().toISOString()} by Architecture Documentation Generator*`);

			const content = contentParts.join('\n');

			return {
				success: true,
				content,
				outputPath: options.outputPath,
				generatedSections,
				skippedSections,
				warnings,
				generationTime: Date.now() - startTime
			};
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e);
			return {
				success: false,
				generatedSections,
				skippedSections,
				warnings,
				error,
				generationTime: Date.now() - startTime
			};
		}
	}

	/**
	 * Generate a specific section.
	 */
	async generateSection(model: IArchitectureModel, sectionId: string): Promise<string> {
		// Find section in any template
		for (const template of this.templates.values()) {
			const section = this.findSection(template.sections, sectionId);
			if (section) {
				return await this.generateSectionContent(model, section, {
					templateId: template.id,
					outputPath: '',
					detailLevel: 'standard'
				}) ?? '';
			}
		}

		return '';
	}

	// ============================================================================
	// Section Generation
	// ============================================================================

	/**
	 * Generate content for a section.
	 */
	private async generateSectionContent(
		model: IArchitectureModel,
		section: IDocumentSection,
		options: IDocumentGenerationOptions
	): Promise<string | null> {
		const parts: string[] = [];

		// Section heading
		parts.push(this.markdown.generateHeading(section.title, section.level));
		parts.push('');

		// Section content based on ID
		const content = this.generateContentForSection(model, section.id, options);
		if (content) {
			if (section.collapsible) {
				parts.push(this.markdown.generateDetails(section.title, content));
			} else {
				parts.push(content);
			}
		}

		// Generate subsections
		if (section.subsections) {
			for (const subsection of section.subsections.sort((a, b) => a.order - b.order)) {
				const subsectionContent = await this.generateSectionContent(model, subsection, options);
				if (subsectionContent) {
					parts.push('');
					parts.push(subsectionContent);
				}
			}
		}

		return parts.length > 2 ? parts.join('\n') : null;
	}

	/**
	 * Generate content for a specific section ID.
	 */
	private generateContentForSection(
		model: IArchitectureModel,
		sectionId: string,
		options: IDocumentGenerationOptions
	): string {
		switch (sectionId) {
			// Overview sections
			case 'overview-description':
				return model.description;
			case 'overview-purpose':
				return this.generatePurpose(model);
			case 'overview-key-features':
				return this.generateKeyFeatures(model);

			// Statistics sections
			case 'stats-summary':
				return this.generateStatsSummary(model);
			case 'stats-languages':
				return this.generateLanguageStats(model);
			case 'stats-files':
				return this.generateFileStats(model);

			// Tech stack sections
			case 'tech-languages':
				return this.generateTechList(model.techStack.languages, 'Languages');
			case 'tech-frameworks':
				return this.generateTechList(model.techStack.frameworks, 'Frameworks');
			case 'tech-libraries':
				return this.generateTechList(model.techStack.libraries.slice(0, 20), 'Libraries');
			case 'tech-tools':
				return this.generateTechList(model.techStack.tools, 'Tools');
			case 'tech-infrastructure':
				return this.generateTechList(model.techStack.infrastructure, 'Infrastructure');

			// Architecture sections
			case 'arch-high-level':
				return this.generateHighLevelArchitecture(model);
			case 'arch-diagram':
				return this.generateArchitectureDiagram(model, options);
			case 'arch-layers':
				return this.generateLayersSection(model);
			case 'arch-patterns':
				return this.generatePatternsSection(model);

			// Component sections
			case 'components-overview':
				return this.generateComponentsOverview(model);
			case 'components-diagram':
				return this.generateComponentDiagram(model, options);
			case 'components-details':
				return this.generateComponentDetails(model, options);

			// Module sections
			case 'modules-structure':
				return this.generateModuleStructure(model);
			case 'modules-diagram':
				return this.generateModuleDiagram(model, options);
			case 'modules-details':
				return this.generateModuleDetails(model, options);

			// Dependency sections
			case 'deps-internal':
				return this.generateInternalDependencies(model);
			case 'deps-external':
				return this.generateExternalDependencies(model);
			case 'deps-diagram':
				return this.generateDependencyDiagram(model, options);

			// Directory structure
			case 'directory-structure':
				return this.generateDirectoryTree(model);
			case 'dir-key-directories':
				return this.generateKeyDirectories(model);

			// Entry points
			case 'entry-points':
			case 'entry-main':
				return this.generateEntryPoints(model);
			case 'entry-api':
				return this.generateApiEntryPoints(model);

			// Conventions sections
			case 'conv-naming':
				return this.generateConventions(model.conventions, 'naming');
			case 'conv-formatting':
				return this.generateConventions(model.conventions, 'formatting');
			case 'conv-structure':
				return this.generateConventions(model.conventions, 'structure');
			case 'conv-documentation':
				return this.generateConventions(model.conventions, 'documentation');

			// Workflow sections
			case 'workflow-branching':
				return model.workflow.branchingStrategy ?? 'Not detected';
			case 'workflow-commit':
				return this.generateListOrEmpty(model.workflow.commitConventions, 'No commit conventions detected');
			case 'workflow-ci':
				return this.generateListOrEmpty(model.workflow.cicdPipelines, 'No CI/CD pipelines detected');
			case 'workflow-testing':
				return this.generateListOrEmpty(model.workflow.testingRequirements, 'No testing requirements detected');

			// Getting started sections
			case 'gs-prerequisites':
				return this.generatePrerequisites(model);
			case 'gs-installation':
				return this.generateInstallation(model);
			case 'gs-configuration':
				return this.generateConfiguration(model);
			case 'gs-first-steps':
				return this.generateFirstSteps(model);

			// Insights sections
			case 'insights-strengths':
				return this.generateInsights(model, 'strength');
			case 'insights-concerns':
				return this.generateInsights(model, 'concern');
			case 'insights-recommendations':
				return this.generateInsights(model, 'recommendation');

			// Reading order
			case 'reading-order':
				return this.generateReadingOrder(model);

			default:
				return '';
		}
	}

	// ============================================================================
	// Content Generators
	// ============================================================================

	private generateBadges(model: IArchitectureModel): string {
		const badges: string[] = [];

		// Language badges
		for (const lang of model.techStack.languages.slice(0, 3)) {
			badges.push(this.markdown.generateBadge('language', lang.name, 'blue'));
		}

		// Stats badges
		badges.push(this.markdown.generateBadge('files', model.stats.totalFiles.toString(), 'green'));
		badges.push(this.markdown.generateBadge('LOC', model.stats.totalLinesOfCode.toLocaleString(), 'orange'));

		return badges.join(' ');
	}

	private generatePurpose(model: IArchitectureModel): string {
		// Extract purpose from patterns or description
		const purposes: string[] = [];

		if (model.patterns.length > 0) {
			purposes.push(`This codebase implements ${model.patterns.map(p => p.name).join(', ')} patterns.`);
		}

		if (model.techStack.frameworks.length > 0) {
			purposes.push(`Built with ${model.techStack.frameworks.map(f => f.name).join(', ')}.`);
		}

		return purposes.join('\n\n') || model.description;
	}

	private generateKeyFeatures(model: IArchitectureModel): string {
		const features: string[] = [];

		// Extract from components
		const services = model.components.filter(c => c.type === 'service');
		if (services.length > 0) {
			features.push(`${services.length} services providing core functionality`);
		}

		// Extract from patterns
		for (const pattern of model.patterns.slice(0, 3)) {
			features.push(`${pattern.name} architecture`);
		}

		// Extract from tech stack
		for (const framework of model.techStack.frameworks.slice(0, 2)) {
			features.push(`${framework.name} integration`);
		}

		return features.length > 0
			? this.markdown.generateList(features)
			: 'Key features not detected';
	}

	private generateStatsSummary(model: IArchitectureModel): string {
		return this.markdown.generateStatsSummary({
			'Total Files': model.stats.totalFiles,
			'Total Directories': model.stats.totalDirectories,
			'Lines of Code': model.stats.totalLinesOfCode,
			'Total Size': this.formatBytes(model.stats.totalSize)
		});
	}

	private generateLanguageStats(model: IArchitectureModel): string {
		const headers = ['Language', 'Files', 'Lines of Code', 'Percentage'];
		const rows: string[][] = [];

		const totalLoc = model.stats.totalLinesOfCode || 1;

		for (const [lang, loc] of Object.entries(model.stats.locByLanguage)) {
			const files = model.stats.filesByLanguage[lang] ?? 0;
			const percentage = ((loc / totalLoc) * 100).toFixed(1) + '%';
			rows.push([lang, files.toString(), loc.toLocaleString(), percentage]);
		}

		// Sort by LOC descending
		rows.sort((a, b) => parseInt(b[2].replace(/,/g, '')) - parseInt(a[2].replace(/,/g, '')));

		return this.markdown.generateTable(headers, rows.slice(0, 10));
	}

	private generateFileStats(model: IArchitectureModel): string {
		const headers = ['Extension', 'Count'];
		const rows: string[][] = [];

		for (const [ext, count] of Object.entries(model.stats.filesByExtension)) {
			rows.push([ext || '(no extension)', count.toString()]);
		}

		rows.sort((a, b) => parseInt(b[1]) - parseInt(a[1]));

		return this.markdown.generateTable(headers, rows.slice(0, 15));
	}

	private generateTechList(techs: ITechnology[], _category: string): string {
		if (techs.length === 0) {
			return 'None detected';
		}

		const headers = ['Name', 'Version', 'Confidence'];
		const rows = techs.map(t => [
			t.url ? this.markdown.generateLink(t.name, t.url) : t.name,
			t.version ?? '-',
			`${(t.confidence * 100).toFixed(0)}%`
		]);

		return this.markdown.generateTable(headers, rows);
	}

	private generateHighLevelArchitecture(model: IArchitectureModel): string {
		const parts: string[] = [];

		if (model.layers.length > 0) {
			parts.push('This codebase follows a layered architecture:');
			parts.push('');
			parts.push(this.markdown.generateList(
				model.layers.map(l => `**${l.name}**: ${l.description}`)
			));
		} else if (model.patterns.length > 0) {
			parts.push('Key architectural patterns:');
			parts.push('');
			parts.push(this.markdown.generateList(
				model.patterns.map(p => `**${p.name}**: ${p.description}`)
			));
		}

		return parts.join('\n');
	}

	private generateArchitectureDiagram(model: IArchitectureModel, options: IDocumentGenerationOptions): string {
		if (options.includeDiagrams === false) {
			return '';
		}

		const diagram = this.diagrams.generateDiagram(model, { type: 'architecture' });
		return this.markdown.generateMermaidBlock(diagram.code);
	}

	private generateLayersSection(model: IArchitectureModel): string {
		if (model.layers.length === 0) {
			return 'No architectural layers detected.';
		}

		const headers = ['Layer', 'Components', 'Description'];
		const rows = model.layers
			.sort((a, b) => a.order - b.order)
			.map(l => [l.name, l.components.length.toString(), l.description]);

		return this.markdown.generateTable(headers, rows);
	}

	private generatePatternsSection(model: IArchitectureModel): string {
		if (model.patterns.length === 0) {
			return 'No specific design patterns detected.';
		}

		return model.patterns.map(p => this.formatPattern(p)).join('\n\n');
	}

	private formatPattern(pattern: IArchitecturePattern): string {
		const parts: string[] = [];

		parts.push(`### ${pattern.name}`);
		parts.push('');
		parts.push(pattern.description);
		parts.push('');
		parts.push(`**Category:** ${pattern.category}`);
		parts.push(`**Confidence:** ${(pattern.confidence * 100).toFixed(0)}%`);

		if (pattern.components.length > 0) {
			parts.push('');
			parts.push('**Components:**');
			parts.push(this.markdown.generateList(pattern.components.slice(0, 5)));
		}

		return parts.join('\n');
	}

	private generateComponentsOverview(model: IArchitectureModel): string {
		const byType: Record<string, number> = {};

		for (const comp of model.components) {
			byType[comp.type] = (byType[comp.type] ?? 0) + 1;
		}

		const headers = ['Type', 'Count'];
		const rows = Object.entries(byType)
			.sort((a, b) => b[1] - a[1])
			.map(([type, count]) => [type, count.toString()]);

		return this.markdown.generateTable(headers, rows);
	}

	private generateComponentDiagram(model: IArchitectureModel, options: IDocumentGenerationOptions): string {
		if (options.includeDiagrams === false || model.components.length === 0) {
			return '';
		}

		const diagram = this.diagrams.generateDiagram(model, {
			type: 'component',
			groupBy: 'type',
			maxNodes: 15
		});

		return this.markdown.generateMermaidBlock(diagram.code);
	}

	private generateComponentDetails(model: IArchitectureModel, options: IDocumentGenerationOptions): string {
		const maxComponents = options.detailLevel === 'comprehensive' ? 20 :
			options.detailLevel === 'detailed' ? 15 :
				options.detailLevel === 'standard' ? 10 : 5;

		const components = model.components.slice(0, maxComponents);

		return components.map(c => this.formatComponent(c)).join('\n\n');
	}

	private formatComponent(comp: IArchitectureComponent): string {
		const parts: string[] = [];

		parts.push(`#### ${comp.name}`);
		parts.push('');
		parts.push(`**Type:** ${comp.type} | **Path:** \`${comp.path}\``);
		parts.push('');
		parts.push(comp.description);

		if (comp.responsibilities && comp.responsibilities.length > 0) {
			parts.push('');
			parts.push('**Responsibilities:**');
			parts.push(this.markdown.generateList(comp.responsibilities));
		}

		if (comp.dependencies.length > 0) {
			parts.push('');
			parts.push(`**Dependencies:** ${comp.dependencies.slice(0, 5).join(', ')}`);
		}

		return parts.join('\n');
	}

	private generateModuleStructure(model: IArchitectureModel): string {
		if (model.modules.length === 0) {
			return 'No module structure detected.';
		}

		const headers = ['Module', 'Path', 'Components'];
		const rows = model.modules.map(m => [
			m.name,
			`\`${m.path}\``,
			m.components.length.toString()
		]);

		return this.markdown.generateTable(headers, rows);
	}

	private generateModuleDiagram(model: IArchitectureModel, options: IDocumentGenerationOptions): string {
		if (options.includeDiagrams === false || model.modules.length === 0) {
			return '';
		}

		const diagram = this.diagrams.generateDiagram(model, { type: 'module' });
		return this.markdown.generateMermaidBlock(diagram.code);
	}

	private generateModuleDetails(model: IArchitectureModel, options: IDocumentGenerationOptions): string {
		const maxModules = options.detailLevel === 'comprehensive' ? 15 :
			options.detailLevel === 'detailed' ? 10 : 5;

		const modules = model.modules.slice(0, maxModules);

		return modules.map(m => {
			const parts: string[] = [];
			parts.push(`#### ${m.name}`);
			parts.push('');
			parts.push(`**Path:** \`${m.path}\``);
			parts.push('');
			parts.push(m.description);

			if (m.entryPoints.length > 0) {
				parts.push('');
				parts.push(`**Entry Points:** ${m.entryPoints.map(e => `\`${e}\``).join(', ')}`);
			}

			return parts.join('\n');
		}).join('\n\n');
	}

	private generateInternalDependencies(model: IArchitectureModel): string {
		const deps: Array<{ from: string; to: string; count: number }> = [];

		for (const comp of model.components) {
			for (const depId of comp.dependencies) {
				const existing = deps.find(d => d.from === comp.name && d.to === depId);
				if (existing) {
					existing.count++;
				} else {
					deps.push({ from: comp.name, to: depId, count: 1 });
				}
			}
		}

		if (deps.length === 0) {
			return 'No internal dependencies detected.';
		}

		const headers = ['From', 'To'];
		const rows = deps.slice(0, 20).map(d => [d.from, d.to]);

		return this.markdown.generateTable(headers, rows);
	}

	private generateExternalDependencies(model: IArchitectureModel): string {
		const allDeps = [
			...model.techStack.libraries,
			...model.techStack.frameworks
		];

		if (allDeps.length === 0) {
			return 'No external dependencies detected.';
		}

		const headers = ['Dependency', 'Version', 'Category'];
		const rows = allDeps.slice(0, 25).map(d => [
			d.name,
			d.version ?? '-',
			d.category
		]);

		return this.markdown.generateTable(headers, rows);
	}

	private generateDependencyDiagram(model: IArchitectureModel, options: IDocumentGenerationOptions): string {
		if (options.includeDiagrams === false || model.components.length === 0) {
			return '';
		}

		const diagram = this.diagrams.generateDiagram(model, {
			type: 'dependency',
			direction: 'LR',
			maxNodes: 20
		});

		return this.markdown.generateMermaidBlock(diagram.code);
	}

	private generateDirectoryTree(model: IArchitectureModel): string {
		// Build tree from module paths
		const tree: Array<{ name: string; type: 'directory' | 'file'; children?: Array<{ name: string; type: 'directory' | 'file' }> }> = [];

		const paths = model.modules.map(m => m.path).slice(0, 20);

		for (const path of paths) {
			const parts = path.split('/').filter(p => p);
			let current = tree;

			for (let i = 0; i < parts.length; i++) {
				const part = parts[i];
				let found = current.find(t => t.name === part);

				if (!found) {
					found = {
						name: part,
						type: i === parts.length - 1 ? 'file' : 'directory',
						children: []
					};
					current.push(found);
				}

				current = found.children!;
			}
		}

		return this.markdown.generateCodeBlock(this.markdown.generateFileTree(tree), '');
	}

	private generateKeyDirectories(model: IArchitectureModel): string {
		const keyDirs = model.modules
			.filter(m => m.components.length > 3)
			.slice(0, 10);

		if (keyDirs.length === 0) {
			return 'No key directories identified.';
		}

		return this.markdown.generateList(
			keyDirs.map(m => `**${m.path}**: ${m.description}`)
		);
	}

	private generateEntryPoints(model: IArchitectureModel): string {
		if (model.entryPoints.length === 0) {
			return 'No entry points identified.';
		}

		return this.markdown.generateList(
			model.entryPoints.map(e => `\`${e}\``)
		);
	}

	private generateApiEntryPoints(model: IArchitectureModel): string {
		const apiComponents = model.components.filter(c =>
			c.type === 'controller' || c.type === 'handler'
		);

		if (apiComponents.length === 0) {
			return 'No API entry points detected.';
		}

		return this.markdown.generateList(
			apiComponents.slice(0, 10).map(c => `**${c.name}**: \`${c.path}\``)
		);
	}

	private generateConventions(conventions: ICodingConvention[], category: string): string {
		const filtered = conventions.filter(c => c.category === category);

		if (filtered.length === 0) {
			return `No ${category} conventions detected.`;
		}

		return filtered.map(c => {
			const parts: string[] = [];
			parts.push(`**${c.name}**`);
			parts.push(c.description);

			if (c.examples && c.examples.length > 0) {
				parts.push('');
				parts.push('*Examples:*');
				parts.push(this.markdown.generateList(c.examples.slice(0, 3)));
			}

			return parts.join('\n');
		}).join('\n\n');
	}

	private generateListOrEmpty(items: string[] | undefined, emptyMessage: string): string {
		if (!items || items.length === 0) {
			return emptyMessage;
		}
		return this.markdown.generateList(items);
	}

	private generatePrerequisites(model: IArchitectureModel): string {
		const prereqs: string[] = [];

		// Add languages
		for (const lang of model.techStack.languages) {
			prereqs.push(`${lang.name}${lang.version ? ` ${lang.version}+` : ''}`);
		}

		// Add key tools
		for (const tool of model.techStack.tools.slice(0, 3)) {
			prereqs.push(tool.name);
		}

		return prereqs.length > 0
			? this.markdown.generateList(prereqs)
			: 'Prerequisites not detected. Please check the project documentation.';
	}

	private generateInstallation(model: IArchitectureModel): string {
		const steps: string[] = [];

		steps.push(`Clone the repository: \`git clone <repository-url>\``);
		steps.push(`Navigate to project: \`cd ${model.name}\``);

		// Add package manager commands based on detected tech
		if (model.techStack.tools.find(t => t.name.toLowerCase().includes('npm'))) {
			steps.push('Install dependencies: `npm install`');
		} else if (model.techStack.tools.find(t => t.name.toLowerCase().includes('yarn'))) {
			steps.push('Install dependencies: `yarn install`');
		}

		return this.markdown.generateList(steps, true);
	}

	private generateConfiguration(model: IArchitectureModel): string {
		const configFiles = model.components.filter(c => c.type === 'config');

		if (configFiles.length === 0) {
			return 'Check the project root for configuration files.';
		}

		return this.markdown.generateList(
			configFiles.slice(0, 5).map(c => `\`${c.path}\`: ${c.description}`)
		);
	}

	private generateFirstSteps(model: IArchitectureModel): string {
		const steps: string[] = [];

		steps.push('Review this architecture documentation');

		if (model.recommendedReadingOrder.length > 0) {
			steps.push(`Start with \`${model.recommendedReadingOrder[0]}\``);
		}

		if (model.entryPoints.length > 0) {
			steps.push(`Explore the main entry point: \`${model.entryPoints[0]}\``);
		}

		steps.push('Run the tests to verify your setup');
		steps.push('Make a small change and verify it works');

		return this.markdown.generateList(steps, true);
	}

	private generateInsights(model: IArchitectureModel, type: string): string {
		const insights = model.insights.filter(i => i.type === type);

		if (insights.length === 0) {
			return `No ${type}s identified.`;
		}

		return insights.map(i => {
			const parts: string[] = [];

			const severity = i.severity ? ` (${i.severity})` : '';
			parts.push(`### ${i.title}${severity}`);
			parts.push('');
			parts.push(i.description);

			if (i.suggestions && i.suggestions.length > 0) {
				parts.push('');
				parts.push('**Suggestions:**');
				parts.push(this.markdown.generateList(i.suggestions));
			}

			return parts.join('\n');
		}).join('\n\n');
	}

	private generateReadingOrder(model: IArchitectureModel): string {
		if (model.recommendedReadingOrder.length === 0) {
			const defaultOrder = [
				'Start with the main entry point',
				'Review core services/components',
				'Explore the data models',
				'Check the API/controller layer',
				'Review tests for usage examples'
			];
			return this.markdown.generateList(defaultOrder, true);
		}

		return this.markdown.generateList(
			model.recommendedReadingOrder.map((f, i) => `\`${f}\``),
			true
		);
	}

	// ============================================================================
	// Utility Methods
	// ============================================================================

	private validateRequiredFields(model: IArchitectureModel, template: IDocumentTemplate): string[] {
		const missing: string[] = [];

		for (const field of template.requiredFields) {
			const value = (model as Record<string, unknown>)[field];
			if (value === undefined || value === null ||
				(Array.isArray(value) && value.length === 0)) {
				missing.push(field);
			}
		}

		return missing;
	}

	private findSection(sections: IDocumentSection[], id: string): IDocumentSection | undefined {
		for (const section of sections) {
			if (section.id === id) {
				return section;
			}
			if (section.subsections) {
				const found = this.findSection(section.subsections, id);
				if (found) {
					return found;
				}
			}
		}
		return undefined;
	}

	private formatBytes(bytes: number): string {
		if (bytes === 0) return '0 Bytes';

		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));

		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Default document builder instance.
 */
export const documentBuilder = new DocumentBuilder();
