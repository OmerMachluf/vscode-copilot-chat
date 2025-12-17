/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../util/vs/base/common/lifecycle';
import { ILogService } from '../../../../platform/log/common/logService';
import {
	IArchitectureDocumentBuilder,
	IArchitectureDocumentBuilderService,
	RepositoryAnalysis,
	RepositoryStructure,
	Component,
	DataFlow,
	TechnologyStack,
	BusinessDomain,
	CodePatterns
} from '../common/onboardingTypes';

/**
 * Service for generating comprehensive architecture documentation from repository analysis.
 * This service creates structured documentation that helps onboard new team members and agents.
 */
export class ArchitectureDocumentBuilderService extends Disposable implements IArchitectureDocumentBuilder, IArchitectureDocumentBuilderService {
	readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	/**
	 * Generate a comprehensive architecture document from repository analysis.
	 */
	async generateArchitectureDoc(analysis: RepositoryAnalysis): Promise<string> {
		this.logService.info('[ArchitectureDocumentBuilder] Generating architecture documentation');

		const sections: string[] = [];

		// Document header
		sections.push(this.generateHeader(analysis));

		// Executive summary
		sections.push(this.generateExecutiveSummary(analysis));

		// System overview
		sections.push(this.generateSystemOverview(analysis.structure));

		// Technology stack section
		sections.push(this.generateTechnologySection(analysis.technologies));

		// Business domain section
		sections.push(this.generateDomainSection(analysis.domain));

		// Architecture patterns section
		sections.push(this.generatePatternsSection(analysis.patterns));

		// Component architecture (if available)
		const analysisWithComponents = analysis as RepositoryAnalysis & { components?: Component[] };
		if (analysisWithComponents.components && analysisWithComponents.components.length > 0) {
			sections.push(this.generateComponentDiagrams(analysisWithComponents.components));
		}

		// Data flow diagrams (if available)
		const analysisWithDataFlows = analysis as RepositoryAnalysis & { dataFlows?: DataFlow[] };
		if (analysisWithDataFlows.dataFlows && analysisWithDataFlows.dataFlows.length > 0) {
			sections.push(this.generateDataFlowDiagrams(analysisWithDataFlows.dataFlows));
		}

		// Development guidelines
		sections.push(this.generateDevelopmentGuidelines(analysis.patterns, analysis.technologies));

		// Getting started section
		sections.push(this.generateGettingStarted(analysis.structure, analysis.technologies));

		// Footer with metadata
		sections.push(this.generateFooter(analysis));

		const document = sections.join('\n\n');

		this.logService.info('[ArchitectureDocumentBuilder] Architecture documentation generated', {
			sections: sections.length,
			length: document.length
		});

		return document;
	}

	/**
	 * Generate system overview section.
	 */
	generateSystemOverview(structure: RepositoryStructure): string {
		const overview: string[] = [];

		overview.push('# System Overview');
		overview.push('');
		overview.push('This section provides an overview of the repository structure and organization.');
		overview.push('');

		// Directory structure
		overview.push('## Directory Structure');
		overview.push('');
		overview.push('| Directory | Type | Purpose | File Count |');
		overview.push('|-----------|------|---------|------------|');

		for (const dir of structure.directories.slice(0, 10)) { // Limit to top 10 directories
			const purposes = dir.purposes.length > 0 ? dir.purposes.join(', ') : 'General';
			overview.push(`| \`${dir.name}\` | ${dir.type} | ${purposes} | ${dir.fileCount} |`);
		}

		overview.push('');

		// File type analysis
		if (structure.fileTypes.languages.length > 0) {
			overview.push('## Language Distribution');
			overview.push('');
			overview.push('| Language | Files | Percentage | Extensions |');
			overview.push('|----------|-------|------------|------------|');

			for (const lang of structure.fileTypes.languages) {
				const extensions = lang.extensions.join(', ');
				overview.push(`| ${lang.language} | ${lang.fileCount} | ${lang.percentage.toFixed(1)}% | ${extensions} |`);
			}
			overview.push('');
		}

		// Dependencies overview
		overview.push('## Dependencies Overview');
		overview.push('');
		overview.push(`- **Package Manager**: ${structure.dependencies.packageManager}`);
		overview.push(`- **Total Dependencies**: ${structure.dependencies.totalDependencies}`);
		overview.push(`- **Production Dependencies**: ${structure.dependencies.dependencies.length}`);
		overview.push(`- **Development Dependencies**: ${structure.dependencies.devDependencies.length}`);

		// Test structure
		if (structure.testStructure.hasTests) {
			overview.push('');
			overview.push('## Testing Setup');
			overview.push('');
			overview.push(`- **Test Frameworks**: ${structure.testStructure.testFrameworks.join(', ')}`);
			overview.push(`- **Test Directories**: ${structure.testStructure.testDirectories.join(', ')}`);
			overview.push(`- **Coverage Configured**: ${structure.testStructure.coverageConfigured ? 'Yes' : 'No'}`);
			overview.push(`- **Test Types**: ${structure.testStructure.testTypes.join(', ')}`);
		}

		return overview.join('\n');
	}

	/**
	 * Generate component diagrams section.
	 */
	generateComponentDiagrams(components: Component[]): string {
		const diagrams: string[] = [];

		diagrams.push('# Component Architecture');
		diagrams.push('');
		diagrams.push('This section describes the major architectural components and their relationships.');
		diagrams.push('');

		// Component overview table
		diagrams.push('## Component Overview');
		diagrams.push('');
		diagrams.push('| Component | Type | Responsibilities | Dependencies |');
		diagrams.push('|-----------|------|------------------|--------------|');

		for (const component of components) {
			const responsibilities = component.responsibilities.slice(0, 2).join('; '); // Limit for readability
			const dependencies = component.dependencies.slice(0, 3).join(', ');
			diagrams.push(`| ${component.name} | ${component.type} | ${responsibilities} | ${dependencies || 'None'} |`);
		}

		diagrams.push('');

		// Component details
		diagrams.push('## Component Details');
		diagrams.push('');

		for (const component of components) {
			diagrams.push(`### ${component.name} (${component.type})`);
			diagrams.push('');

			// Responsibilities
			if (component.responsibilities.length > 0) {
				diagrams.push('**Responsibilities:**');
				for (const responsibility of component.responsibilities) {
					diagrams.push(`- ${responsibility}`);
				}
				diagrams.push('');
			}

			// Dependencies
			if (component.dependencies.length > 0) {
				diagrams.push('**Dependencies:**');
				for (const dependency of component.dependencies) {
					diagrams.push(`- ${dependency}`);
				}
				diagrams.push('');
			}

			// Interfaces
			if (component.interfaces.length > 0) {
				diagrams.push('**Interfaces:**');
				for (const intf of component.interfaces) {
					diagrams.push(`- **${intf.name}** (${intf.type}): ${intf.description}`);
				}
				diagrams.push('');
			}
		}

		// Simple text-based dependency diagram
		diagrams.push('## Component Dependencies');
		diagrams.push('');
		diagrams.push('```');
		diagrams.push(this.generateTextDependencyDiagram(components));
		diagrams.push('```');

		return diagrams.join('\n');
	}

	/**
	 * Generate data flow diagrams section.
	 */
	generateDataFlowDiagrams(flows: DataFlow[]): string {
		const diagrams: string[] = [];

		diagrams.push('# Data Flow Architecture');
		diagrams.push('');
		diagrams.push('This section describes how data flows through the system components.');
		diagrams.push('');

		// Data flow table
		diagrams.push('## Data Flow Overview');
		diagrams.push('');
		diagrams.push('| From | To | Data Type | Protocol | Description |');
		diagrams.push('|------|----|-----------|-----------| ------------|');

		for (const flow of flows) {
			const protocol = flow.protocol || 'N/A';
			const description = flow.description || 'No description';
			diagrams.push(`| ${flow.from} | ${flow.to} | ${flow.data} | ${protocol} | ${description} |`);
		}

		diagrams.push('');

		// Simple text-based flow diagram
		diagrams.push('## Data Flow Diagram');
		diagrams.push('');
		diagrams.push('```');
		diagrams.push(this.generateTextFlowDiagram(flows));
		diagrams.push('```');

		return diagrams.join('\n');
	}

	/**
	 * Generate document header.
	 */
	private generateHeader(analysis: RepositoryAnalysis): string {
		const header: string[] = [];

		header.push('# Repository Architecture Documentation');
		header.push('');
		header.push('> *Automatically generated architecture documentation*');
		header.push('');
		header.push(`**Generated on:** ${new Date(analysis.metadata.timestamp).toISOString()}`);
		header.push(`**Analysis Version:** ${analysis.metadata.version}`);
		header.push(`**Confidence Level:** ${(analysis.metadata.confidence * 100).toFixed(1)}%`);
		header.push(`**Analysis Duration:** ${analysis.metadata.analysisTimeMs}ms`);

		return header.join('\n');
	}

	/**
	 * Generate executive summary.
	 */
	private generateExecutiveSummary(analysis: RepositoryAnalysis): string {
		const summary: string[] = [];

		summary.push('# Executive Summary');
		summary.push('');

		// Business domain summary
		summary.push(`**Domain:** ${analysis.domain.domain}`);
		summary.push(`**Scale:** ${analysis.domain.scale}`);
		summary.push(`**Primary Languages:** ${analysis.technologies.primaryLanguages.join(', ')}`);

		// Key frameworks
		const keyFrameworks = analysis.technologies.frameworks
			.filter(f => f.confidence > 0.7)
			.slice(0, 3)
			.map(f => f.name)
			.join(', ');

		if (keyFrameworks) {
			summary.push(`**Key Frameworks:** ${keyFrameworks}`);
		}

		// Architecture patterns
		const keyPatterns = analysis.patterns.architecturalPatterns
			.filter(p => p.confidence > 0.7)
			.slice(0, 2)
			.map(p => p.pattern)
			.join(', ');

		if (keyPatterns) {
			summary.push(`**Architecture Patterns:** ${keyPatterns}`);
		}

		// Key insights
		summary.push('');
		summary.push('## Key Insights');
		summary.push('');

		if (analysis.domain.keywords.length > 0) {
			summary.push(`- **Domain Focus:** ${analysis.domain.keywords.slice(0, 5).join(', ')}`);
		}

		if (analysis.technologies.deployment.platforms.length > 0) {
			summary.push(`- **Deployment Platforms:** ${analysis.technologies.deployment.platforms.join(', ')}`);
		}

		if (analysis.technologies.cicd.providers.length > 0) {
			summary.push(`- **CI/CD:** ${analysis.technologies.cicd.providers.join(', ')}`);
		}

		if (analysis.domain.compliance.regulations.length > 0) {
			summary.push(`- **Compliance:** ${analysis.domain.compliance.regulations.join(', ')}`);
		}

		return summary.join('\n');
	}

	/**
	 * Generate technology section.
	 */
	private generateTechnologySection(technologies: TechnologyStack): string {
		const tech: string[] = [];

		tech.push('# Technology Stack');
		tech.push('');
		tech.push('This section provides details about the technologies used in the project.');
		tech.push('');

		// Primary languages
		tech.push('## Programming Languages');
		tech.push('');
		for (const lang of technologies.primaryLanguages) {
			tech.push(`- **${lang}**`);
		}
		tech.push('');

		// Frameworks
		if (technologies.frameworks.length > 0) {
			tech.push('## Frameworks and Libraries');
			tech.push('');
			tech.push('| Framework | Category | Confidence | Version |');
			tech.push('|-----------|----------|------------|---------|');

			for (const framework of technologies.frameworks) {
				const version = framework.version || 'Unknown';
				const confidence = (framework.confidence * 100).toFixed(0) + '%';
				tech.push(`| ${framework.name} | ${framework.category} | ${confidence} | ${version} |`);
			}
			tech.push('');
		}

		// Databases
		if (technologies.databases.length > 0) {
			tech.push('## Databases');
			tech.push('');
			for (const db of technologies.databases) {
				tech.push(`- ${db}`);
			}
			tech.push('');
		}

		// Deployment
		if (technologies.deployment.platforms.length > 0) {
			tech.push('## Deployment and Infrastructure');
			tech.push('');
			tech.push(`**Platforms:** ${technologies.deployment.platforms.join(', ')}`);
			tech.push(`**Containerized:** ${technologies.deployment.containerized ? 'Yes' : 'No'}`);
			tech.push(`**Serverless:** ${technologies.deployment.serverless ? 'Yes' : 'No'}`);
		}

		// CI/CD
		if (technologies.cicd.providers.length > 0) {
			tech.push('');
			tech.push('## Continuous Integration/Deployment');
			tech.push('');
			tech.push(`**Providers:** ${technologies.cicd.providers.join(', ')}`);
			tech.push(`**Stages:** ${technologies.cicd.stages.join(', ')}`);
		}

		return tech.join('\n');
	}

	/**
	 * Generate domain section.
	 */
	private generateDomainSection(domain: BusinessDomain): string {
		const domainSection: string[] = [];

		domainSection.push('# Business Domain and Context');
		domainSection.push('');
		domainSection.push('This section provides insights into the business domain and purpose of the repository.');
		domainSection.push('');

		domainSection.push(`**Primary Domain:** ${domain.domain}`);
		domainSection.push(`**Project Scale:** ${domain.scale}`);
		domainSection.push(`**Domain Confidence:** ${(domain.confidence * 100).toFixed(1)}%`);

		if (domain.keywords.length > 0) {
			domainSection.push('');
			domainSection.push('## Domain Keywords');
			domainSection.push('');
			domainSection.push(domain.keywords.map(k => `\`${k}\``).join(' • '));
		}

		// Compliance and security
		domainSection.push('');
		domainSection.push('## Compliance and Security');
		domainSection.push('');

		if (domain.compliance.regulations.length > 0) {
			domainSection.push(`**Regulatory Compliance:** ${domain.compliance.regulations.join(', ')}`);
		}

		if (domain.compliance.securityRequirements.length > 0) {
			domainSection.push(`**Security Requirements:** ${domain.compliance.securityRequirements.join(', ')}`);
		}

		domainSection.push(`**Data Privacy Requirements:** ${domain.compliance.dataPrivacy ? 'Yes' : 'No'}`);
		domainSection.push(`**Audit Trail Requirements:** ${domain.compliance.auditTrails ? 'Yes' : 'No'}`);

		return domainSection.join('\n');
	}

	/**
	 * Generate patterns section.
	 */
	private generatePatternsSection(patterns: CodePatterns): string {
		const patternsSection: string[] = [];

		patternsSection.push('# Code Patterns and Conventions');
		patternsSection.push('');
		patternsSection.push('This section describes the architectural and design patterns used in the codebase.');
		patternsSection.push('');

		// Architectural patterns
		if (patterns.architecturalPatterns.length > 0) {
			patternsSection.push('## Architectural Patterns');
			patternsSection.push('');

			for (const pattern of patterns.architecturalPatterns) {
				patternsSection.push(`### ${pattern.pattern}`);
				patternsSection.push('');
				patternsSection.push(`**Confidence:** ${(pattern.confidence * 100).toFixed(0)}%`);
				patternsSection.push('');

				if (pattern.evidence.length > 0) {
					patternsSection.push('**Evidence:**');
					for (const evidence of pattern.evidence) {
						patternsSection.push(`- ${evidence}`);
					}
					patternsSection.push('');
				}
			}
		}

		// Design patterns
		if (patterns.designPatterns.length > 0) {
			patternsSection.push('## Design Patterns');
			patternsSection.push('');
			patternsSection.push('| Pattern | Occurrences | Example Files |');
			patternsSection.push('|---------|-------------|---------------|');

			for (const pattern of patterns.designPatterns) {
				const files = pattern.files.slice(0, 2).join(', '); // Limit for readability
				patternsSection.push(`| ${pattern.pattern} | ${pattern.occurrences} | ${files} |`);
			}
			patternsSection.push('');
		}

		// Naming conventions
		if (patterns.namingConventions.length > 0) {
			patternsSection.push('## Naming Conventions');
			patternsSection.push('');

			for (const convention of patterns.namingConventions) {
				const consistency = (convention.consistency * 100).toFixed(0) + '%';
				patternsSection.push(`- **${convention.type}**: ${convention.convention} (${consistency} consistent)`);
			}
			patternsSection.push('');
		}

		// Code style
		patternsSection.push('## Code Style');
		patternsSection.push('');
		patternsSection.push(`- **Indentation:** ${patterns.codeStyle.indentation}`);
		if (patterns.codeStyle.indentSize) {
			patternsSection.push(`- **Indent Size:** ${patterns.codeStyle.indentSize} spaces`);
		}
		patternsSection.push(`- **Line Endings:** ${patterns.codeStyle.lineEndings}`);
		patternsSection.push(`- **Quote Style:** ${patterns.codeStyle.quoteStyle}`);
		patternsSection.push(`- **Semicolons:** ${patterns.codeStyle.semicolons === true ? 'Required' : patterns.codeStyle.semicolons === false ? 'Not used' : 'Mixed'}`);

		return patternsSection.join('\n');
	}

	/**
	 * Generate development guidelines.
	 */
	private generateDevelopmentGuidelines(patterns: CodePatterns, technologies: TechnologyStack): string {
		const guidelines: string[] = [];

		guidelines.push('# Development Guidelines');
		guidelines.push('');
		guidelines.push('This section provides guidelines for developers working on this project.');
		guidelines.push('');

		// Code style guidelines
		guidelines.push('## Code Style Guidelines');
		guidelines.push('');
		guidelines.push(`- Use ${patterns.codeStyle.indentation} for indentation`);
		guidelines.push(`- Use ${patterns.codeStyle.quoteStyle} quotes for strings`);
		guidelines.push(`- Line endings should be ${patterns.codeStyle.lineEndings}`);

		if (patterns.codeStyle.semicolons === true) {
			guidelines.push('- Always use semicolons');
		} else if (patterns.codeStyle.semicolons === false) {
			guidelines.push('- Do not use semicolons');
		}

		// Naming conventions
		if (patterns.namingConventions.length > 0) {
			guidelines.push('');
			guidelines.push('## Naming Conventions');
			guidelines.push('');
			for (const convention of patterns.namingConventions) {
				guidelines.push(`- **${convention.type}**: Use ${convention.convention}`);
			}
		}

		// Technology-specific guidelines
		if (technologies.frameworks.length > 0) {
			guidelines.push('');
			guidelines.push('## Framework-Specific Guidelines');
			guidelines.push('');

			for (const framework of technologies.frameworks.slice(0, 3)) {
				guidelines.push(`### ${framework.name}`);
				guidelines.push('');
				guidelines.push(`Follow ${framework.name} best practices for ${framework.category} development.`);
				guidelines.push('');
			}
		}

		return guidelines.join('\n');
	}

	/**
	 * Generate getting started section.
	 */
	private generateGettingStarted(structure: RepositoryStructure, technologies: TechnologyStack): string {
		const gettingStarted: string[] = [];

		gettingStarted.push('# Getting Started');
		gettingStarted.push('');
		gettingStarted.push('This section provides instructions for setting up the development environment.');
		gettingStarted.push('');

		// Prerequisites
		gettingStarted.push('## Prerequisites');
		gettingStarted.push('');
		gettingStarted.push(`- ${structure.dependencies.packageManager} (package manager)`);

		for (const lang of technologies.primaryLanguages) {
			gettingStarted.push(`- ${lang} runtime/compiler`);
		}

		// Setup steps
		gettingStarted.push('');
		gettingStarted.push('## Setup Instructions');
		gettingStarted.push('');
		gettingStarted.push('1. Clone the repository');
		gettingStarted.push('2. Install dependencies:');

		switch (structure.dependencies.packageManager) {
			case 'npm':
				gettingStarted.push('   ```bash\n   npm install\n   ```');
				break;
			case 'yarn':
				gettingStarted.push('   ```bash\n   yarn install\n   ```');
				break;
			case 'pnpm':
				gettingStarted.push('   ```bash\n   pnpm install\n   ```');
				break;
			default:
				gettingStarted.push('   ```bash\n   # Install dependencies using your package manager\n   ```');
		}

		// Build and run
		if (structure.buildSystem.scripts.length > 0) {
			gettingStarted.push('');
			gettingStarted.push('3. Available scripts:');

			for (const script of structure.buildSystem.scripts.slice(0, 5)) {
				gettingStarted.push(`   - **${script.name}**: ${script.command} (${script.type})`);
			}
		}

		return gettingStarted.join('\n');
	}

	/**
	 * Generate document footer with metadata.
	 */
	private generateFooter(analysis: RepositoryAnalysis): string {
		const footer: string[] = [];

		footer.push('---');
		footer.push('');
		footer.push('## Document Metadata');
		footer.push('');
		footer.push('| Property | Value |');
		footer.push('|----------|-------|');
		footer.push(`| Generated | ${new Date(analysis.metadata.timestamp).toISOString()} |`);
		footer.push(`| Version | ${analysis.metadata.version} |`);
		footer.push(`| Analysis Duration | ${analysis.metadata.analysisTimeMs}ms |`);
		footer.push(`| Confidence | ${(analysis.metadata.confidence * 100).toFixed(1)}% |`);

		if (analysis.metadata.sources.length > 0) {
			footer.push(`| Sources | ${analysis.metadata.sources.length} analysis sources |`);
		}

		footer.push('');
		footer.push('*This document was automatically generated by the Repository Investigation Engine.*');

		return footer.join('\n');
	}

	/**
	 * Generate a simple text-based dependency diagram.
	 */
	private generateTextDependencyDiagram(components: Component[]): string {
		const diagram: string[] = [];

		for (const component of components) {
			diagram.push(`${component.name} (${component.type})`);

			if (component.dependencies.length > 0) {
				for (const dep of component.dependencies) {
					diagram.push(`  └─ depends on: ${dep}`);
				}
			} else {
				diagram.push('  └─ no dependencies');
			}

			diagram.push('');
		}

		return diagram.join('\n');
	}

	/**
	 * Generate a simple text-based flow diagram.
	 */
	private generateTextFlowDiagram(flows: DataFlow[]): string {
		const diagram: string[] = [];

		for (const flow of flows) {
			const protocol = flow.protocol ? ` (${flow.protocol})` : '';
			diagram.push(`${flow.from} ──[${flow.data}${protocol}]──> ${flow.to}`);

			if (flow.description) {
				diagram.push(`  ↳ ${flow.description}`);
			}

			diagram.push('');
		}

		return diagram.join('\n');
	}
}