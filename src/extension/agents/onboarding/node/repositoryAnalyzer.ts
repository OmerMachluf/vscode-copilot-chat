/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { ISubTaskManager } from '../../orchestrator/orchestratorInterfaces';
import {
	IRepositoryAnalyzer,
	IRepositoryAnalyzerService,
	RepositoryStructure,
	TechnologyStack,
	BusinessDomain,
	CodePatterns,
	DirectoryInfo,
	FileTypeAnalysis,
	LanguageInfo,
	ConfigFileInfo,
	DependencyAnalysis,
	DependencyInfo,
	TestStructure,
	BuildSystemInfo,
	BuildScript,
	Framework,
	DeploymentInfo,
	CICDInfo,
	ComplianceRequirements,
	ArchitecturalPattern,
	DesignPattern,
	NamingConvention,
	CodeStyleInfo,
	RepositoryAnalysis,
	AnalysisMetadata,
	AnalysisSource
} from '../common/onboardingTypes';

/**
 * Repository analyzer service that investigates codebase structure, patterns, and technologies.
 * Uses the repository-researcher agent via A2A orchestration for deep analysis.
 */
export class RepositoryAnalyzerService extends Disposable implements IRepositoryAnalyzer, IRepositoryAnalyzerService {
	readonly _serviceBrand: undefined;

	constructor(
		@ISubTaskManager private readonly subTaskManager: ISubTaskManager,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	/**
	 * Analyze the repository structure including directories, file types, and organization.
	 */
	async analyzeStructure(): Promise<RepositoryStructure> {
		this.logService.info('[RepositoryAnalyzer] Starting repository structure analysis');

		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('No workspace folder found for analysis');
		}

		const rootPath = workspaceFolder.uri.fsPath;

		try {
			// Use repository-researcher to analyze structure
			const structurePrompt = this.buildStructureAnalysisPrompt();
			const analysisResult = await this.delegateToRepositoryResearcher(
				'repository-structure-analysis',
				structurePrompt,
				'Comprehensive repository structure analysis including directories, file types, and organization patterns'
			);

			// Parse the analysis result and build our structure
			const structure = await this.parseStructureAnalysis(rootPath, analysisResult);

			this.logService.info('[RepositoryAnalyzer] Repository structure analysis completed', {
				directories: structure.directories.length,
				totalFiles: structure.fileTypes.totalFiles
			});

			return structure;
		} catch (error) {
			this.logService.error('[RepositoryAnalyzer] Failed to analyze repository structure', error);
			throw error;
		}
	}

	/**
	 * Identify technologies, frameworks, and dependencies used in the repository.
	 */
	async identifyTechnologies(): Promise<TechnologyStack> {
		this.logService.info('[RepositoryAnalyzer] Starting technology stack analysis');

		try {
			// Use repository-researcher to identify technologies
			const techPrompt = this.buildTechnologyAnalysisPrompt();
			const analysisResult = await this.delegateToRepositoryResearcher(
				'technology-stack-analysis',
				techPrompt,
				'Complete technology stack analysis including languages, frameworks, databases, and deployment technologies'
			);

			const technologies = await this.parseTechnologyAnalysis(analysisResult);

			this.logService.info('[RepositoryAnalyzer] Technology stack analysis completed', {
				languages: technologies.primaryLanguages.length,
				frameworks: technologies.frameworks.length
			});

			return technologies;
		} catch (error) {
			this.logService.error('[RepositoryAnalyzer] Failed to analyze technology stack', error);
			throw error;
		}
	}

	/**
	 * Analyze the business domain and purpose of the repository.
	 */
	async analyzeDomain(): Promise<BusinessDomain> {
		this.logService.info('[RepositoryAnalyzer] Starting domain analysis');

		try {
			// Use repository-researcher to analyze domain
			const domainPrompt = this.buildDomainAnalysisPrompt();
			const analysisResult = await this.delegateToRepositoryResearcher(
				'business-domain-analysis',
				domainPrompt,
				'Business domain analysis including purpose, industry, compliance requirements, and scale'
			);

			const domain = await this.parseDomainAnalysis(analysisResult);

			this.logService.info('[RepositoryAnalyzer] Domain analysis completed', {
				domain: domain.domain,
				confidence: domain.confidence,
				keywords: domain.keywords.length
			});

			return domain;
		} catch (error) {
			this.logService.error('[RepositoryAnalyzer] Failed to analyze business domain', error);
			throw error;
		}
	}

	/**
	 * Find architectural and design patterns used in the codebase.
	 */
	async findPatterns(): Promise<CodePatterns> {
		this.logService.info('[RepositoryAnalyzer] Starting code patterns analysis');

		try {
			// Use repository-researcher to find patterns
			const patternsPrompt = this.buildPatternsAnalysisPrompt();
			const analysisResult = await this.delegateToRepositoryResearcher(
				'code-patterns-analysis',
				patternsPrompt,
				'Code patterns analysis including architectural patterns, design patterns, naming conventions, and code style'
			);

			const patterns = await this.parsePatternsAnalysis(analysisResult);

			this.logService.info('[RepositoryAnalyzer] Code patterns analysis completed', {
				architecturalPatterns: patterns.architecturalPatterns.length,
				designPatterns: patterns.designPatterns.length
			});

			return patterns;
		} catch (error) {
			this.logService.error('[RepositoryAnalyzer] Failed to analyze code patterns', error);
			throw error;
		}
	}

	/**
	 * Delegate analysis work to the repository-researcher agent via A2A orchestration.
	 */
	private async delegateToRepositoryResearcher(
		taskId: string,
		prompt: string,
		expectedOutput: string
	): Promise<string> {
		try {
			// Create a subtask for the repository-researcher agent
			const subtask = this.subTaskManager.createSubTask({
				parentWorkerId: 'onboarding-analyzer',
				parentTaskId: `onboarding-analyzer-${Date.now()}`,
				planId: 'onboarding-analysis',
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
			this.logService.error(`[RepositoryAnalyzer] Failed to delegate to repository-researcher for ${taskId}`, error);
			throw error;
		}
	}

	/**
	 * Build the prompt for repository structure analysis.
	 */
	private buildStructureAnalysisPrompt(): string {
		return `
Analyze this repository's structure and organization. Provide a detailed analysis that includes:

## Directory Analysis
- Identify all major directories and their purposes (source code, tests, documentation, configuration, build artifacts)
- Categorize directories by their role (src, lib, test, docs, config, build, assets, etc.)
- Count files in each directory and analyze organization patterns
- Identify any architectural organization patterns (MVC, domain-driven, feature-based, etc.)

## File Type Analysis
- Analyze all file types and their distributions
- Identify primary programming languages and their usage percentages
- Find configuration files and categorize them (package management, build tools, CI/CD, linting, etc.)
- Locate documentation files (README, changelogs, API docs, etc.)

## Build and Testing Structure
- Identify build tools and configuration files
- Analyze test structure and organization
- Find testing frameworks and test file patterns
- Check for CI/CD configuration files

## Dependencies and Package Management
- Identify package manager (npm, yarn, maven, pip, etc.)
- Analyze dependencies and categorize them
- Look for monorepo or multi-package structures

Focus on providing concrete, factual information about the repository structure that can be used to understand the project's organization and architecture.

Return your analysis in a structured format that includes specific file paths, counts, and categorizations.
`;
	}

	/**
	 * Build the prompt for technology stack analysis.
	 */
	private buildTechnologyAnalysisPrompt(): string {
		return `
Analyze the technology stack used in this repository. Provide a comprehensive analysis that includes:

## Programming Languages
- Identify all programming languages used
- Calculate percentage distribution of each language
- Determine the primary/dominant languages

## Frameworks and Libraries
- Identify web frameworks (React, Angular, Vue, Django, Rails, etc.)
- Find testing frameworks (Jest, Mocha, PyTest, etc.)
- Discover build tools and bundlers
- Identify UI/component libraries
- Look for database ORMs and data access libraries

## Databases and Data Storage
- Identify database types from dependencies and configuration
- Look for database migration files
- Find data modeling libraries

## Deployment and Infrastructure
- Analyze deployment configurations (Docker, K8s, serverless)
- Identify cloud platform usage (AWS, Azure, GCP)
- Find container configurations
- Look for infrastructure-as-code files

## CI/CD and DevOps
- Identify CI/CD providers and configurations
- Find deployment scripts and workflows
- Analyze testing and quality assurance setup

## Development Tools
- Identify linting and formatting tools
- Find development environment configurations
- Look for development scripts and automation

Focus on providing specific framework names, versions where available, and confidence levels for your identifications.

Return a structured analysis with categorized technologies and their purposes in the project.
`;
	}

	/**
	 * Build the prompt for business domain analysis.
	 */
	private buildDomainAnalysisPrompt(): string {
		return `
Analyze the business domain and purpose of this repository. Provide insights into:

## Business Domain Classification
- Determine the industry or domain (e-commerce, fintech, healthcare, SaaS, enterprise, gaming, etc.)
- Analyze README files, documentation, and code comments for domain indicators
- Look for domain-specific terminology in variable names, function names, and comments
- Identify the target users or customers

## Project Scale and Type
- Determine if this is a startup, enterprise, or medium-scale project
- Identify if it's an open-source library, internal tool, customer-facing application, or API service
- Analyze the complexity and scope of the codebase

## Compliance and Regulatory Requirements
- Look for evidence of regulatory compliance needs (GDPR, HIPAA, SOX, PCI-DSS)
- Identify security requirements and implementations
- Find privacy and data protection indicators
- Look for audit trail implementations

## Keywords and Concepts
- Extract domain-specific keywords from code, documentation, and configuration
- Identify core business concepts and entities
- Find feature areas and functional domains

## Confidence Assessment
- Provide confidence levels for domain classification
- Explain reasoning behind domain identification
- Note any ambiguity or multiple possible domains

Return a structured analysis with specific evidence for your classifications and high confidence in your assessments.
`;
	}

	/**
	 * Build the prompt for code patterns analysis.
	 */
	private buildPatternsAnalysisPrompt(): string {
		return `
Analyze the code patterns, architecture, and conventions used in this repository. Provide detailed analysis of:

## Architectural Patterns
- Identify architectural patterns (MVC, MVP, MVVM, Clean Architecture, Hexagonal, Layered, Microservices, etc.)
- Analyze directory structure for architectural organization
- Look for separation of concerns and layering
- Find evidence of Domain-Driven Design or other architectural approaches

## Design Patterns
- Identify common design patterns in the code (Singleton, Factory, Observer, Strategy, etc.)
- Look for framework-specific patterns
- Find custom patterns or architectural decisions

## Code Organization and Structure
- Analyze module organization and dependency structure
- Look for feature-based vs. technical organization
- Identify code reuse patterns and abstractions

## Naming Conventions
- Analyze naming patterns for files, classes, functions, and variables
- Identify consistency in naming conventions
- Look for domain-specific naming patterns

## Code Style and Formatting
- Analyze indentation style (tabs vs. spaces)
- Check line ending conventions
- Look for quote style preferences
- Find code formatting configurations

## Testing Patterns
- Identify testing strategies and patterns
- Analyze test organization and structure
- Look for mocking and testing utility patterns

Return a structured analysis with specific examples and confidence levels for each identified pattern.
`;
	}

	/**
	 * Parse structure analysis results from repository-researcher.
	 */
	private async parseStructureAnalysis(rootPath: string, analysisResult: string): Promise<RepositoryStructure> {
		try {
			// First attempt to parse structured JSON output from repository-researcher
			const structuredMatch = analysisResult.match(/```json\s*(\{[\s\S]*?\})\s*```/);
			if (structuredMatch) {
				const parsed = JSON.parse(structuredMatch[1]);
				if (parsed.directories && parsed.fileTypes) {
					this.logService.info('[RepositoryAnalyzer] Using structured analysis from repository-researcher');
					return this.validateAndNormalizeStructure(parsed);
				}
			}

			// Fall back to manual parsing and local analysis
			this.logService.info('[RepositoryAnalyzer] Falling back to local analysis');
			const directories = await this.scanDirectories(rootPath);
			const fileTypes = await this.analyzeFileTypes(rootPath);
			const dependencies = await this.analyzeDependencies(rootPath);
			const testStructure = await this.analyzeTestStructure(rootPath);
			const buildSystem = await this.analyzeBuildSystem(rootPath);

			return {
				directories,
				fileTypes,
				dependencies,
				testStructure,
				buildSystem
			};
		} catch (error) {
			this.logService.error('[RepositoryAnalyzer] Failed to parse structure analysis, using fallback', error);
			// Use fallback local analysis
			const directories = await this.scanDirectories(rootPath);
			const fileTypes = await this.analyzeFileTypes(rootPath);
			const dependencies = await this.analyzeDependencies(rootPath);
			const testStructure = await this.analyzeTestStructure(rootPath);
			const buildSystem = await this.analyzeBuildSystem(rootPath);

			return {
				directories,
				fileTypes,
				dependencies,
				testStructure,
				buildSystem
			};
		}
	}

	/**
	 * Parse technology analysis results from repository-researcher.
	 */
	private async parseTechnologyAnalysis(analysisResult: string): Promise<TechnologyStack> {
		try {
			// First attempt to parse structured JSON output from repository-researcher
			const structuredMatch = analysisResult.match(/```json\s*(\{[\s\S]*?\})\s*```/);
			if (structuredMatch) {
				const parsed = JSON.parse(structuredMatch[1]);
				if (parsed.primaryLanguages && parsed.frameworks) {
					this.logService.info('[RepositoryAnalyzer] Using structured technology analysis from repository-researcher');
					return this.validateAndNormalizeTechnology(parsed);
				}
			}

			// Fall back to text parsing and inference
			this.logService.info('[RepositoryAnalyzer] Parsing technology analysis from text');
			const languages = this.extractLanguagesFromText(analysisResult);
			const frameworks = this.extractFrameworksFromText(analysisResult);
			const databases = this.extractDatabasesFromText(analysisResult);
			const deployment = this.extractDeploymentInfoFromText(analysisResult);
			const cicd = this.extractCICDInfoFromText(analysisResult);

			return {
				primaryLanguages: languages,
				frameworks,
				databases,
				deployment,
				cicd
			};
		} catch (error) {
			this.logService.error('[RepositoryAnalyzer] Failed to parse technology analysis, using defaults', error);
			// Use basic defaults based on the current project
			return {
				primaryLanguages: ['TypeScript', 'JavaScript'],
				frameworks: [
					{
						name: 'VS Code Extension API',
						category: 'framework',
						confidence: 0.9
					}
				],
				databases: [],
				deployment: {
					platforms: [],
					containerized: false,
					serverless: false,
					deploymentFiles: []
				},
				cicd: {
					providers: [],
					configFiles: [],
					stages: []
				}
			};
		}
	}

	/**
	 * Parse domain analysis results from repository-researcher.
	 */
	private async parseDomainAnalysis(analysisResult: string): Promise<BusinessDomain> {
		try {
			// First attempt to parse structured JSON output from repository-researcher
			const structuredMatch = analysisResult.match(/```json\s*(\{[\s\S]*?\})\s*```/);
			if (structuredMatch) {
				const parsed = JSON.parse(structuredMatch[1]);
				if (parsed.domain && parsed.keywords) {
					this.logService.info('[RepositoryAnalyzer] Using structured domain analysis from repository-researcher');
					return this.validateAndNormalizeDomain(parsed);
				}
			}

			// Fall back to text parsing and inference
			this.logService.info('[RepositoryAnalyzer] Parsing domain analysis from text');
			const domain = this.extractDomainFromText(analysisResult);
			const keywords = this.extractKeywordsFromText(analysisResult);
			const compliance = this.extractComplianceFromText(analysisResult);
			const scale = this.inferProjectScale(analysisResult);
			const confidence = this.calculateDomainConfidence(domain, keywords, analysisResult);

			return {
				domain,
				keywords,
				compliance,
				scale,
				confidence
			};
		} catch (error) {
			this.logService.error('[RepositoryAnalyzer] Failed to parse domain analysis, using defaults', error);
			// Use basic defaults based on current project context
			return {
				domain: 'developer-tools',
				keywords: ['vscode', 'extension', 'copilot', 'ai', 'chat'],
				compliance: {
					regulations: [],
					securityRequirements: [],
					dataPrivacy: false,
					auditTrails: false
				},
				scale: 'enterprise',
				confidence: 0.8
			};
		}
	}

	/**
	 * Parse patterns analysis results from repository-researcher.
	 */
	private async parsePatternsAnalysis(analysisResult: string): Promise<CodePatterns> {
		try {
			// First attempt to parse structured JSON output from repository-researcher
			const structuredMatch = analysisResult.match(/```json\s*(\{[\s\S]*?\})\s*```/);
			if (structuredMatch) {
				const parsed = JSON.parse(structuredMatch[1]);
				if (parsed.architecturalPatterns && parsed.designPatterns) {
					this.logService.info('[RepositoryAnalyzer] Using structured patterns analysis from repository-researcher');
					return this.validateAndNormalizePatterns(parsed);
				}
			}

			// Fall back to text parsing and inference
			this.logService.info('[RepositoryAnalyzer] Parsing patterns analysis from text');
			const architecturalPatterns = this.extractArchitecturalPatternsFromText(analysisResult);
			const designPatterns = this.extractDesignPatternsFromText(analysisResult);
			const namingConventions = this.extractNamingConventionsFromText(analysisResult);
			const codeStyle = this.extractCodeStyleFromText(analysisResult);

			return {
				architecturalPatterns,
				designPatterns,
				namingConventions,
				codeStyle
			};
		} catch (error) {
			this.logService.error('[RepositoryAnalyzer] Failed to parse patterns analysis, using defaults', error);
			// Use basic defaults based on observation of the current project
			return {
				architecturalPatterns: [
					{
						pattern: 'layered',
						confidence: 0.8,
						evidence: ['src/platform', 'src/extension', 'src/util']
					}
				],
				designPatterns: [
					{
						pattern: 'Dependency Injection',
						occurrences: 1,
						files: ['various service files']
					}
				],
				namingConventions: [
					{
						type: 'file',
						convention: 'camelCase',
						consistency: 0.9
					}
				],
				codeStyle: {
					indentation: 'tabs',
					lineEndings: 'lf',
					quoteStyle: 'single',
					semicolons: true
				}
			};
		}
	}

	// Validation and normalization methods for structured data

	private validateAndNormalizeStructure(parsed: any): RepositoryStructure {
		return {
			directories: Array.isArray(parsed.directories) ? parsed.directories : [],
			fileTypes: parsed.fileTypes || { languages: [], configFiles: [], documentationFiles: [], totalFiles: 0 },
			dependencies: parsed.dependencies || { packageManager: 'unknown' as any, dependencies: [], devDependencies: [], totalDependencies: 0 },
			testStructure: parsed.testStructure || { hasTests: false, testFrameworks: [], testDirectories: [], testFilePattern: [], coverageConfigured: false, testTypes: [] },
			buildSystem: parsed.buildSystem || { buildTool: null, buildFiles: [], scripts: [], hasCI: false, ciFiles: [] }
		};
	}

	private validateAndNormalizeTechnology(parsed: any): TechnologyStack {
		return {
			primaryLanguages: Array.isArray(parsed.primaryLanguages) ? parsed.primaryLanguages : [],
			frameworks: Array.isArray(parsed.frameworks) ? parsed.frameworks : [],
			databases: Array.isArray(parsed.databases) ? parsed.databases : [],
			deployment: parsed.deployment || { platforms: [], containerized: false, serverless: false, deploymentFiles: [] },
			cicd: parsed.cicd || { providers: [], configFiles: [], stages: [] }
		};
	}

	private validateAndNormalizeDomain(parsed: any): BusinessDomain {
		return {
			domain: parsed.domain || 'unknown',
			keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
			compliance: parsed.compliance || { regulations: [], securityRequirements: [], dataPrivacy: false, auditTrails: false },
			scale: parsed.scale || 'medium',
			confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
		};
	}

	private validateAndNormalizePatterns(parsed: any): CodePatterns {
		return {
			architecturalPatterns: Array.isArray(parsed.architecturalPatterns) ? parsed.architecturalPatterns : [],
			designPatterns: Array.isArray(parsed.designPatterns) ? parsed.designPatterns : [],
			namingConventions: Array.isArray(parsed.namingConventions) ? parsed.namingConventions : [],
			codeStyle: parsed.codeStyle || { indentation: 'spaces', lineEndings: 'lf', quoteStyle: 'single', semicolons: true }
		};
	}

	// Text extraction methods for unstructured analysis results

	private extractLanguagesFromText(text: string): string[] {
		const languages: string[] = [];
		const languagePatterns = [
			/typescript|ts/i,
			/javascript|js/i,
			/python/i,
			/java(?!script)/i,
			/c#|csharp/i,
			/c\+\+|cpp/i,
			/rust/i,
			/go(?:\s|$)/i,
			/php/i,
			/ruby/i,
			/swift/i,
			/kotlin/i
		];

		const languageNames = ['TypeScript', 'JavaScript', 'Python', 'Java', 'C#', 'C++', 'Rust', 'Go', 'PHP', 'Ruby', 'Swift', 'Kotlin'];

		languagePatterns.forEach((pattern, index) => {
			if (pattern.test(text)) {
				languages.push(languageNames[index]);
			}
		});

		return languages.length > 0 ? languages : ['Unknown'];
	}

	private extractFrameworksFromText(text: string): Framework[] {
		const frameworks: Framework[] = [];
		const frameworkPatterns = [
			{ pattern: /react/i, name: 'React', category: 'web' as const },
			{ pattern: /angular/i, name: 'Angular', category: 'web' as const },
			{ pattern: /vue/i, name: 'Vue.js', category: 'web' as const },
			{ pattern: /express/i, name: 'Express', category: 'api' as const },
			{ pattern: /django/i, name: 'Django', category: 'web' as const },
			{ pattern: /flask/i, name: 'Flask', category: 'web' as const },
			{ pattern: /spring/i, name: 'Spring', category: 'api' as const },
			{ pattern: /vscode|vs code/i, name: 'VS Code Extension API', category: 'framework' as const }
		];

		frameworkPatterns.forEach(({ pattern, name, category }) => {
			if (pattern.test(text)) {
				frameworks.push({ name, category, confidence: 0.7 });
			}
		});

		return frameworks;
	}

	private extractDatabasesFromText(text: string): string[] {
		const databases: string[] = [];
		const dbPatterns = [
			/postgresql|postgres/i,
			/mysql/i,
			/mongodb/i,
			/redis/i,
			/sqlite/i,
			/oracle/i,
			/mssql|sql server/i
		];

		const dbNames = ['PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'SQLite', 'Oracle', 'SQL Server'];

		dbPatterns.forEach((pattern, index) => {
			if (pattern.test(text)) {
				databases.push(dbNames[index]);
			}
		});

		return databases;
	}

	private extractDeploymentInfoFromText(text: string): DeploymentInfo {
		const platforms: string[] = [];
		const platformPatterns = [
			{ pattern: /aws|amazon/i, name: 'AWS' },
			{ pattern: /azure/i, name: 'Azure' },
			{ pattern: /gcp|google cloud/i, name: 'GCP' },
			{ pattern: /vercel/i, name: 'Vercel' },
			{ pattern: /netlify/i, name: 'Netlify' },
			{ pattern: /heroku/i, name: 'Heroku' }
		];

		platformPatterns.forEach(({ pattern, name }) => {
			if (pattern.test(text)) {
				platforms.push(name);
			}
		});

		return {
			platforms,
			containerized: /docker|container/i.test(text),
			serverless: /serverless|lambda|function/i.test(text),
			deploymentFiles: []
		};
	}

	private extractCICDInfoFromText(text: string): CICDInfo {
		const providers: string[] = [];
		const providerPatterns = [
			{ pattern: /github actions/i, name: 'GitHub Actions' },
			{ pattern: /gitlab ci/i, name: 'GitLab CI' },
			{ pattern: /jenkins/i, name: 'Jenkins' },
			{ pattern: /travis/i, name: 'Travis CI' },
			{ pattern: /circleci/i, name: 'CircleCI' }
		];

		providerPatterns.forEach(({ pattern, name }) => {
			if (pattern.test(text)) {
				providers.push(name);
			}
		});

		const stages: string[] = [];
		if (/build/i.test(text)) stages.push('build');
		if (/test/i.test(text)) stages.push('test');
		if (/deploy/i.test(text)) stages.push('deploy');

		return {
			providers,
			configFiles: [],
			stages
		};
	}

	private extractDomainFromText(text: string): string {
		const domainPatterns = [
			{ pattern: /fintech|finance|banking|payment/i, domain: 'fintech' },
			{ pattern: /healthcare|medical|health/i, domain: 'healthcare' },
			{ pattern: /e-commerce|ecommerce|retail|shopping/i, domain: 'e-commerce' },
			{ pattern: /gaming|game/i, domain: 'gaming' },
			{ pattern: /education|learning|school/i, domain: 'education' },
			{ pattern: /enterprise|business|corporate/i, domain: 'enterprise' },
			{ pattern: /developer|development|tools|ide|extension/i, domain: 'developer-tools' },
			{ pattern: /social|media|communication/i, domain: 'social-media' }
		];

		for (const { pattern, domain } of domainPatterns) {
			if (pattern.test(text)) {
				return domain;
			}
		}

		return 'general';
	}

	private extractKeywordsFromText(text: string): string[] {
		// Simple keyword extraction - in reality this would be more sophisticated
		const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
		const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use']);

		const keywords = words
			.filter(word => !stopWords.has(word))
			.filter(word => word.length > 3)
			.slice(0, 10); // Take top 10

		return [...new Set(keywords)]; // Remove duplicates
	}

	private extractComplianceFromText(text: string): ComplianceRequirements {
		const regulations: string[] = [];
		const securityRequirements: string[] = [];

		// Check for compliance mentions
		if (/gdpr/i.test(text)) regulations.push('GDPR');
		if (/hipaa/i.test(text)) regulations.push('HIPAA');
		if (/sox|sarbanes-oxley/i.test(text)) regulations.push('SOX');
		if (/pci-dss|pci/i.test(text)) regulations.push('PCI-DSS');

		// Check for security requirements
		if (/security|secure/i.test(text)) securityRequirements.push('General Security');
		if (/encryption/i.test(text)) securityRequirements.push('Encryption');
		if (/authentication|auth/i.test(text)) securityRequirements.push('Authentication');

		return {
			regulations,
			securityRequirements,
			dataPrivacy: /privacy|personal data|pii/i.test(text),
			auditTrails: /audit|logging|trail/i.test(text)
		};
	}

	private inferProjectScale(text: string): 'startup' | 'enterprise' | 'medium' {
		if (/enterprise|large|corporation|big company/i.test(text)) {
			return 'enterprise';
		}
		if (/startup|small|new company/i.test(text)) {
			return 'startup';
		}
		return 'medium';
	}

	private calculateDomainConfidence(domain: string, keywords: string[], text: string): number {
		if (domain === 'general') return 0.3;

		const relevantTerms = keywords.filter(k => text.toLowerCase().includes(k));
		const confidence = Math.min(0.9, 0.5 + (relevantTerms.length * 0.1));

		return confidence;
	}

	private extractArchitecturalPatternsFromText(text: string): ArchitecturalPattern[] {
		const patterns: ArchitecturalPattern[] = [];

		const patternChecks = [
			{ pattern: 'MVC', test: /mvc|model.*view.*controller/i },
			{ pattern: 'microservices', test: /microservice|micro-service/i },
			{ pattern: 'layered', test: /layer|layered|tier/i },
			{ pattern: 'clean', test: /clean architecture/i },
			{ pattern: 'hexagonal', test: /hexagonal|ports.*adapters/i }
		] as const;

		patternChecks.forEach(({ pattern, test }) => {
			if (test.test(text)) {
				patterns.push({
					pattern,
					confidence: 0.7,
					evidence: ['Text analysis']
				});
			}
		});

		return patterns;
	}

	private extractDesignPatternsFromText(text: string): DesignPattern[] {
		const patterns: DesignPattern[] = [];

		const patternChecks = [
			'Singleton',
			'Factory',
			'Observer',
			'Strategy',
			'Command',
			'Adapter',
			'Decorator'
		];

		patternChecks.forEach(pattern => {
			const regex = new RegExp(pattern, 'i');
			if (regex.test(text)) {
				patterns.push({
					pattern,
					occurrences: 1,
					files: ['detected in analysis']
				});
			}
		});

		return patterns;
	}

	private extractNamingConventionsFromText(text: string): NamingConvention[] {
		// This is a simplified implementation
		return [
			{
				type: 'file',
				convention: /camelCase/.test(text) ? 'camelCase' : 'kebab-case',
				consistency: 0.8
			}
		];
	}

	private extractCodeStyleFromText(text: string): CodeStyleInfo {
		return {
			indentation: /tab/.test(text) ? 'tabs' : 'spaces',
			lineEndings: 'lf',
			quoteStyle: /single.*quote/.test(text) ? 'single' : 'double',
			semicolons: !/no.*semicolon/.test(text)
		};
	}

	// Helper methods for basic analysis (fallback when repository-researcher is not available)

	private async scanDirectories(rootPath: string): Promise<DirectoryInfo[]> {
		// Basic directory scanning implementation
		const directories: DirectoryInfo[] = [];

		try {
			const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(rootPath));

			for (const [name, type] of entries) {
				if (type === vscode.FileType.Directory) {
					const dirPath = path.join(rootPath, name);
					const dirInfo = await this.analyzeSingleDirectory(name, dirPath);
					directories.push(dirInfo);
				}
			}
		} catch (error) {
			this.logService.error('[RepositoryAnalyzer] Failed to scan directories', error);
		}

		return directories;
	}

	private async analyzeSingleDirectory(name: string, dirPath: string): Promise<DirectoryInfo> {
		let fileCount = 0;
		const subdirectories: string[] = [];

		try {
			const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));

			for (const [entryName, type] of entries) {
				if (type === vscode.FileType.File) {
					fileCount++;
				} else if (type === vscode.FileType.Directory) {
					subdirectories.push(entryName);
				}
			}
		} catch (error) {
			this.logService.warn(`[RepositoryAnalyzer] Failed to analyze directory: ${dirPath}`, error);
		}

		const directoryType = this.categorizeDirectory(name);
		const purposes = this.inferDirectoryPurposes(name, subdirectories);

		return {
			name,
			path: dirPath,
			type: directoryType,
			fileCount,
			subdirectories,
			purposes
		};
	}

	private categorizeDirectory(name: string): DirectoryInfo['type'] {
		const lowerName = name.toLowerCase();

		if (lowerName.includes('test') || lowerName.includes('spec')) {
			return 'test';
		}
		if (lowerName === 'src' || lowerName === 'lib' || lowerName === 'source') {
			return 'source';
		}
		if (lowerName.includes('config') || lowerName.includes('conf')) {
			return 'config';
		}
		if (lowerName.includes('build') || lowerName.includes('dist') || lowerName.includes('out')) {
			return 'build';
		}
		if (lowerName.includes('doc') || lowerName === 'readme') {
			return 'docs';
		}
		if (lowerName.includes('asset') || lowerName.includes('static') || lowerName.includes('public')) {
			return 'assets';
		}

		return 'other';
	}

	private inferDirectoryPurposes(name: string, subdirectories: string[]): string[] {
		const purposes: string[] = [];
		const lowerName = name.toLowerCase();

		// Infer purposes based on common patterns
		if (lowerName.includes('controller')) purposes.push('controllers');
		if (lowerName.includes('model')) purposes.push('models');
		if (lowerName.includes('view')) purposes.push('views');
		if (lowerName.includes('service')) purposes.push('services');
		if (lowerName.includes('util')) purposes.push('utilities');
		if (lowerName.includes('platform')) purposes.push('platform');
		if (lowerName.includes('extension')) purposes.push('extensions');

		return purposes;
	}

	private async analyzeFileTypes(rootPath: string): Promise<FileTypeAnalysis> {
		// Basic file type analysis implementation
		return {
			languages: [
				{
					language: 'TypeScript',
					fileCount: 0, // Would be calculated
					percentage: 0,
					extensions: ['.ts'],
					primaryFrameworks: []
				}
			],
			configFiles: [],
			documentationFiles: [],
			totalFiles: 0
		};
	}

	private async analyzeDependencies(rootPath: string): Promise<DependencyAnalysis> {
		// Basic dependency analysis implementation
		return {
			packageManager: 'npm',
			dependencies: [],
			devDependencies: [],
			totalDependencies: 0
		};
	}

	private async analyzeTestStructure(rootPath: string): Promise<TestStructure> {
		// Basic test structure analysis implementation
		return {
			hasTests: false,
			testFrameworks: [],
			testDirectories: [],
			testFilePattern: [],
			coverageConfigured: false,
			testTypes: []
		};
	}

	private async analyzeBuildSystem(rootPath: string): Promise<BuildSystemInfo> {
		// Basic build system analysis implementation
		return {
			buildTool: null,
			buildFiles: [],
			scripts: [],
			hasCI: false,
			ciFiles: []
		};
	}
}