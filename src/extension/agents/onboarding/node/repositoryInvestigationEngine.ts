/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import * as path from 'path';
import { ILogService } from '../../../../platform/log/common/logService';
import { Disposable } from '../../../../util/vs/base/common/lifecycle';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { ISubTaskManager } from '../../orchestrator/orchestratorInterfaces';
import {
	IRepositoryAnalyzer,
	IRepositoryAnalyzerService,
	RepositoryStructure,
	TechnologyStack,
	BusinessDomain,
	CodePatterns,
	RepositoryAnalysis,
	AnalysisMetadata,
	AnalysisSource,
	Component,
	DataFlow,
	ComponentInterface
} from '../common/onboardingTypes';

/**
 * Enhanced repository investigation engine that provides comprehensive analysis
 * of repository architecture, patterns, and technologies for onboarding purposes.
 * This engine builds upon the existing RepositoryAnalyzer and adds advanced capabilities.
 */
export class RepositoryInvestigationEngine extends Disposable implements IRepositoryAnalyzer {
	readonly _serviceBrand: undefined;

	constructor(
		@ISubTaskManager private readonly subTaskManager: ISubTaskManager,
		@IRepositoryAnalyzerService private readonly repositoryAnalyzer: IRepositoryAnalyzerService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	/**
	 * Perform comprehensive repository analysis including structure, technologies, domain, and patterns.
	 * This is the main entry point for the investigation engine.
	 */
	async performComprehensiveAnalysis(token?: CancellationToken): Promise<RepositoryAnalysis> {
		this.logService.info('[RepositoryInvestigationEngine] Starting comprehensive repository analysis');

		const startTime = Date.now();
		const sources: AnalysisSource[] = [];

		try {
			// Run all analysis phases in parallel for better performance
			const [structure, technologies, domain, patterns] = await Promise.all([
				this.analyzeStructure(),
				this.identifyTechnologies(),
				this.analyzeDomain(),
				this.findPatterns()
			]);

			// Extract components and data flows from the analysis
			const components = await this.extractComponents(structure, patterns);
			const dataFlows = await this.analyzeDataFlows(structure, technologies);

			// Calculate overall analysis confidence
			const confidence = this.calculateOverallConfidence(domain, technologies, patterns);

			// Build metadata
			const metadata: AnalysisMetadata = {
				timestamp: Date.now(),
				version: '1.0.0',
				analysisTimeMs: Date.now() - startTime,
				confidence,
				sources
			};

			const analysis: RepositoryAnalysis = {
				structure,
				technologies,
				domain,
				patterns,
				metadata
			};

			this.logService.info('[RepositoryInvestigationEngine] Comprehensive analysis completed', {
				duration: metadata.analysisTimeMs,
				confidence: metadata.confidence,
				components: components.length
			});

			// Store components and data flows as metadata for later use
			(analysis as RepositoryAnalysis & { components?: Component[]; dataFlows?: DataFlow[] }).components = components;
			(analysis as RepositoryAnalysis & { components?: Component[]; dataFlows?: DataFlow[] }).dataFlows = dataFlows;

			return analysis;
		} catch (error) {
			this.logService.error('[RepositoryInvestigationEngine] Failed to perform comprehensive analysis', error);
			throw error;
		}
	}

	/**
	 * Analyze repository structure using the existing analyzer but with enhancements.
	 */
	async analyzeStructure(): Promise<RepositoryStructure> {
		return this.repositoryAnalyzer.analyzeStructure();
	}

	/**
	 * Identify technologies using the existing analyzer.
	 */
	async identifyTechnologies(): Promise<TechnologyStack> {
		return this.repositoryAnalyzer.identifyTechnologies();
	}

	/**
	 * Analyze business domain using the existing analyzer.
	 */
	async analyzeDomain(): Promise<BusinessDomain> {
		return this.repositoryAnalyzer.analyzeDomain();
	}

	/**
	 * Find patterns using the existing analyzer.
	 */
	async findPatterns(): Promise<CodePatterns> {
		return this.repositoryAnalyzer.findPatterns();
	}

	/**
	 * Extract architectural components from the repository structure and patterns.
	 * This provides insights into the system architecture and component relationships.
	 */
	private async extractComponents(structure: RepositoryStructure, patterns: CodePatterns): Promise<Component[]> {
		this.logService.info('[RepositoryInvestigationEngine] Extracting architectural components');

		const components: Component[] = [];

		try {
			// Use repository-researcher to analyze components
			const componentPrompt = this.buildComponentAnalysisPrompt(structure, patterns);
			const analysisResult = await this.delegateToRepositoryResearcher(
				'component-analysis',
				componentPrompt,
				'Architectural component analysis including services, controllers, models, and their relationships'
			);

			// Parse component analysis results
			const extractedComponents = await this.parseComponentAnalysis(analysisResult, structure);
			components.push(...extractedComponents);

		} catch (error) {
			this.logService.error('[RepositoryInvestigationEngine] Failed to extract components, using fallback', error);
			// Fallback to basic component extraction based on directory structure
			const fallbackComponents = this.extractBasicComponents(structure);
			components.push(...fallbackComponents);
		}

		return components;
	}

	/**
	 * Analyze data flows between components to understand system interactions.
	 */
	private async analyzeDataFlows(structure: RepositoryStructure, technologies: TechnologyStack): Promise<DataFlow[]> {
		this.logService.info('[RepositoryInvestigationEngine] Analyzing data flows');

		const dataFlows: DataFlow[] = [];

		try {
			// Use repository-researcher to analyze data flows
			const flowPrompt = this.buildDataFlowAnalysisPrompt(structure, technologies);
			const analysisResult = await this.delegateToRepositoryResearcher(
				'dataflow-analysis',
				flowPrompt,
				'Data flow analysis including API calls, database connections, and component interactions'
			);

			// Parse data flow analysis results
			const extractedFlows = await this.parseDataFlowAnalysis(analysisResult);
			dataFlows.push(...extractedFlows);

		} catch (error) {
			this.logService.error('[RepositoryInvestigationEngine] Failed to analyze data flows, using fallback', error);
			// Fallback to basic flow inference
			const fallbackFlows = this.inferBasicDataFlows(structure, technologies);
			dataFlows.push(...fallbackFlows);
		}

		return dataFlows;
	}

	/**
	 * Calculate overall confidence in the analysis based on individual component confidences.
	 */
	private calculateOverallConfidence(domain: BusinessDomain, technologies: TechnologyStack, patterns: CodePatterns): number {
		const confidences = [
			domain.confidence,
			technologies.frameworks.reduce((avg, f) => avg + f.confidence, 0) / Math.max(technologies.frameworks.length, 1),
			patterns.architecturalPatterns.reduce((avg, p) => avg + p.confidence, 0) / Math.max(patterns.architecturalPatterns.length, 1)
		].filter(c => !isNaN(c));

		return confidences.length > 0 ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length : 0.5;
	}

	/**
	 * Delegate analysis work to the repository-researcher agent.
	 */
	private async delegateToRepositoryResearcher(
		taskId: string,
		prompt: string,
		expectedOutput: string
	): Promise<string> {
		try {
			// Create a subtask for the repository-researcher agent
			const subtask = this.subTaskManager.createSubTask({
				parentWorkerId: 'investigation-engine',
				parentTaskId: `investigation-engine-${Date.now()}`,
				planId: 'repository-investigation',
				worktreePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
				agentType: '@repository-researcher',
				prompt,
				expectedOutput,
				currentDepth: 0,
				spawnContext: 'agent'
			});

			// Execute the subtask and wait for completion
			const result = await this.subTaskManager.executeSubTask(subtask.id, CancellationToken.None);

			if (result.status !== 'success') {
				throw new Error(`Repository analysis failed: ${result.error || 'Unknown error'}`);
			}

			return result.output || '';
		} catch (error) {
			this.logService.error(`[RepositoryInvestigationEngine] Failed to delegate to repository-researcher for ${taskId}`, error);
			throw error;
		}
	}

	/**
	 * Build prompt for component analysis.
	 */
	private buildComponentAnalysisPrompt(structure: RepositoryStructure, patterns: CodePatterns): string {
		return `
Analyze the architectural components of this repository and identify their relationships. Provide a detailed analysis that includes:

## Component Identification
- Identify major architectural components (services, controllers, models, views, utilities, middleware, etc.)
- Analyze the purpose and responsibilities of each component
- Determine component boundaries and interfaces
- Identify shared/common components vs. domain-specific ones

## Component Relationships
- Map dependencies between components
- Identify data flow patterns between components
- Find communication patterns (direct calls, events, APIs, etc.)
- Analyze coupling and cohesion levels

## Architecture Patterns Context
Based on the identified patterns: ${patterns.architecturalPatterns.map(p => p.pattern).join(', ')}

## Directory Structure Context
Key directories found: ${structure.directories.map(d => `${d.name} (${d.type})`).join(', ')}

## Technology Context
Primary languages: ${structure.fileTypes.languages.map(l => l.language).join(', ')}

Focus on providing concrete component identification with:
- Component name and type
- Primary responsibilities
- Key interfaces (APIs, events, database connections)
- Dependencies on other components

Return your analysis in a structured format with specific component details and relationships.
`;
	}

	/**
	 * Build prompt for data flow analysis.
	 */
	private buildDataFlowAnalysisPrompt(structure: RepositoryStructure, technologies: TechnologyStack): string {
		return `
Analyze the data flow patterns in this repository to understand how information moves through the system. Provide analysis that includes:

## API and Service Communication
- Identify REST API endpoints, GraphQL schemas, or other service interfaces
- Map request/response patterns
- Identify data transformation points
- Find middleware and interceptors

## Database and Storage Interactions
- Identify database connections and ORM usage
- Map data access patterns (repositories, DAOs, active record, etc.)
- Find caching layers and storage mechanisms
- Analyze data persistence strategies

## Event and Message Flows
- Identify event-driven communication patterns
- Find message queues, pub/sub systems, or event buses
- Map asynchronous processing patterns
- Identify background job processing

## Technology Context
Frameworks: ${technologies.frameworks.map(f => f.name).join(', ')}
Databases: ${technologies.databases.join(', ')}
Deployment: ${technologies.deployment.platforms.join(', ')}

## File Structure Context
Build system: ${structure.buildSystem.buildTool}
Dependencies: ${structure.dependencies.packageManager}

Focus on identifying concrete data flows with:
- Source component/system
- Target component/system
- Data type and format
- Communication protocol/method
- Flow description and purpose

Return a structured analysis of the key data flows in the system.
`;
	}

	/**
	 * Parse component analysis results.
	 */
	private async parseComponentAnalysis(analysisResult: string, structure: RepositoryStructure): Promise<Component[]> {
		const components: Component[] = [];

		try {
			// Try to parse structured JSON output
			const structuredMatch = analysisResult.match(/```json\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```/);
			if (structuredMatch) {
				const parsed = JSON.parse(structuredMatch[1]);
				const parsedComponents = Array.isArray(parsed) ? parsed : parsed.components || [];

				for (const comp of parsedComponents) {
					if (comp.name && comp.type) {
						components.push({
							name: comp.name,
							type: comp.type || 'other',
							responsibilities: Array.isArray(comp.responsibilities) ? comp.responsibilities : [comp.description || 'No description'],
							dependencies: Array.isArray(comp.dependencies) ? comp.dependencies : [],
							interfaces: Array.isArray(comp.interfaces) ? comp.interfaces : []
						});
					}
				}
			}

			// If no structured output found, extract from text
			if (components.length === 0) {
				const textComponents = this.extractComponentsFromText(analysisResult, structure);
				components.push(...textComponents);
			}
		} catch (error) {
			this.logService.error('[RepositoryInvestigationEngine] Failed to parse component analysis', error);
			// Use fallback extraction
			const fallbackComponents = this.extractBasicComponents(structure);
			components.push(...fallbackComponents);
		}

		return components;
	}

	/**
	 * Parse data flow analysis results.
	 */
	private async parseDataFlowAnalysis(analysisResult: string): Promise<DataFlow[]> {
		const dataFlows: DataFlow[] = [];

		try {
			// Try to parse structured JSON output
			const structuredMatch = analysisResult.match(/```json\s*(\[[\s\S]*?\])\s*```/);
			if (structuredMatch) {
				const parsed = JSON.parse(structuredMatch[1]);

				for (const flow of parsed) {
					if (flow.from && flow.to) {
						dataFlows.push({
							from: flow.from,
							to: flow.to,
							data: flow.data || 'Unknown data',
							protocol: flow.protocol,
							description: flow.description
						});
					}
				}
			}

			// If no structured output found, extract from text
			if (dataFlows.length === 0) {
				const textFlows = this.extractDataFlowsFromText(analysisResult);
				dataFlows.push(...textFlows);
			}
		} catch (error) {
			this.logService.error('[RepositoryInvestigationEngine] Failed to parse data flow analysis', error);
		}

		return dataFlows;
	}

	/**
	 * Extract basic components from directory structure as fallback.
	 */
	private extractBasicComponents(structure: RepositoryStructure): Component[] {
		const components: Component[] = [];

		for (const dir of structure.directories) {
			let componentType: Component['type'] = 'other';
			const responsibilities: string[] = [];

			// Infer component type from directory name and purposes
			if (dir.purposes.includes('controllers')) {
				componentType = 'controller';
				responsibilities.push('Handle HTTP requests and responses');
			} else if (dir.purposes.includes('models')) {
				componentType = 'model';
				responsibilities.push('Define data structures and business logic');
			} else if (dir.purposes.includes('services')) {
				componentType = 'service';
				responsibilities.push('Provide business logic and data processing');
			} else if (dir.purposes.includes('utilities')) {
				componentType = 'utility';
				responsibilities.push('Provide helper functions and utilities');
			} else if (dir.type === 'source') {
				componentType = 'service';
				responsibilities.push('Core application logic');
			}

			if (componentType !== 'other' || dir.fileCount > 5) {
				components.push({
					name: dir.name,
					type: componentType,
					responsibilities: responsibilities.length > 0 ? responsibilities : [`Manages ${dir.name} functionality`],
					dependencies: [],
					interfaces: []
				});
			}
		}

		return components;
	}

	/**
	 * Extract components from text analysis.
	 */
	private extractComponentsFromText(text: string, structure: RepositoryStructure): Component[] {
		const components: Component[] = [];
		const componentPatterns = [
			{ pattern: /controller/gi, type: 'controller' as const },
			{ pattern: /service/gi, type: 'service' as const },
			{ pattern: /model/gi, type: 'model' as const },
			{ pattern: /view/gi, type: 'view' as const },
			{ pattern: /middleware/gi, type: 'middleware' as const },
			{ pattern: /utility|util/gi, type: 'utility' as const }
		];

		for (const { pattern, type } of componentPatterns) {
			const matches = text.match(pattern);
			if (matches && matches.length > 0) {
				components.push({
					name: `${type}s`,
					type,
					responsibilities: [`Handle ${type} related functionality`],
					dependencies: [],
					interfaces: []
				});
			}
		}

		return components;
	}

	/**
	 * Extract data flows from text analysis.
	 */
	private extractDataFlowsFromText(text: string): DataFlow[] {
		const flows: DataFlow[] = [];

		// Look for API patterns
		if (/api|endpoint|rest/i.test(text)) {
			flows.push({
				from: 'Client',
				to: 'API Layer',
				data: 'HTTP Requests',
				protocol: 'HTTP/HTTPS',
				description: 'Client requests to API endpoints'
			});
		}

		// Look for database patterns
		if (/database|db|sql|query/i.test(text)) {
			flows.push({
				from: 'Application Layer',
				to: 'Database',
				data: 'Queries and Data',
				protocol: 'SQL/NoSQL',
				description: 'Data persistence and retrieval'
			});
		}

		return flows;
	}

	/**
	 * Infer basic data flows from structure and technologies.
	 */
	private inferBasicDataFlows(structure: RepositoryStructure, technologies: TechnologyStack): DataFlow[] {
		const flows: DataFlow[] = [];

		// Infer API flows based on frameworks
		const webFrameworks = technologies.frameworks.filter(f => f.category === 'web' || f.category === 'api');
		if (webFrameworks.length > 0) {
			flows.push({
				from: 'Client',
				to: 'Web Server',
				data: 'HTTP Requests',
				protocol: 'HTTP/HTTPS',
				description: `Handled by ${webFrameworks[0].name}`
			});
		}

		// Infer database flows
		if (technologies.databases.length > 0) {
			flows.push({
				from: 'Application',
				to: technologies.databases[0],
				data: 'Application Data',
				protocol: 'Database Protocol',
				description: 'Data storage and retrieval'
			});
		}

		// Infer build flows
		if (structure.buildSystem.buildTool) {
			flows.push({
				from: 'Source Code',
				to: 'Build System',
				data: 'Source Files',
				protocol: 'File System',
				description: `Build process using ${structure.buildSystem.buildTool}`
			});
		}

		return flows;
	}
}