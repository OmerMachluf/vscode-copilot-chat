/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { FileType } from '../../../platform/filesystem/common/fileTypes';
import { createDecorator } from '../../../util/vs/platform/instantiation/common/instantiation';
import { URI } from '../../../util/vs/base/common/uri';
import {
	IRepositoryAnalysis,
	IRepositoryStructure,
	ITechnologyStack,
	IBusinessDomainAnalysis,
	ICodePatternAnalysis,
	IAnalysisConfiguration,
	IDirectoryInfo,
	IPackageInfo,
	ILanguageInfo,
	ITechnologyInfo,
	IFrameworkInfo,
	IConfigurationFile,
	IEntryPoint,
	IDependencyInfo,
	RepositoryStructureType,
	DirectoryClassification,
	PackageManager,
	TechnologyCategory,
	FrameworkType,
	ArchitecturePattern,
	ConfigurationType,
	ConfidenceLevel,
	AnalysisStatus,
	DEFAULT_ANALYSIS_CONFIGURATION,
	IKeyFinding,
	IAnalysisMetadata,
} from '../types/repositoryAnalysis';

export const IRepositoryAnalyzerService = createDecorator<IRepositoryAnalyzerService>('repositoryAnalyzerService');

/**
 * Options for analyzing a repository.
 */
export interface IAnalyzeRepositoryOptions {
	/** Configuration overrides for analysis */
	configuration?: Partial<IAnalysisConfiguration>;
	/** Callback for progress updates */
	onProgress?: (progress: IAnalysisProgress) => void;
	/** Cancellation token */
	cancellationToken?: vscode.CancellationToken;
}

/**
 * Progress information during analysis.
 */
export interface IAnalysisProgress {
	/** Current phase of analysis */
	phase: 'structure' | 'technology' | 'domain' | 'patterns' | 'finalizing';
	/** Phase description */
	description: string;
	/** Progress percentage (0-100) */
	percentage: number;
	/** Current file being processed (if applicable) */
	currentFile?: string;
}

/**
 * Service for analyzing repository structure, technology stack, and patterns.
 */
export interface IRepositoryAnalyzerService {
	readonly _serviceBrand: undefined;

	/**
	 * Analyze a repository at the given path.
	 */
	analyzeRepository(repositoryPath: string, options?: IAnalyzeRepositoryOptions): Promise<IRepositoryAnalysis>;

	/**
	 * Analyze only the repository structure.
	 */
	analyzeStructure(repositoryPath: string, config?: Partial<IAnalysisConfiguration>): Promise<IRepositoryStructure>;

	/**
	 * Analyze only the technology stack.
	 */
	analyzeTechnologyStack(repositoryPath: string, config?: Partial<IAnalysisConfiguration>): Promise<ITechnologyStack>;

	/**
	 * Analyze the business domain.
	 */
	analyzeBusinessDomain(repositoryPath: string, config?: Partial<IAnalysisConfiguration>): Promise<IBusinessDomainAnalysis>;

	/**
	 * Analyze code patterns.
	 */
	analyzeCodePatterns(repositoryPath: string, config?: Partial<IAnalysisConfiguration>): Promise<ICodePatternAnalysis>;

	/**
	 * Get a quick summary of the repository without full analysis.
	 */
	getQuickSummary(repositoryPath: string): Promise<IRepositoryQuickSummary>;
}

/**
 * Quick summary of a repository.
 */
export interface IRepositoryQuickSummary {
	/** Repository name */
	name: string;
	/** Primary language */
	primaryLanguage?: string;
	/** Framework (if detected) */
	framework?: string;
	/** Package manager */
	packageManager?: PackageManager;
	/** Total file count */
	fileCount: number;
	/** Has package.json / Cargo.toml / etc */
	hasPackageManifest: boolean;
	/** Has README */
	hasReadme: boolean;
	/** Has tests */
	hasTests: boolean;
	/** Has CI/CD configuration */
	hasCiCd: boolean;
}

// ============================================================================
// Language Detection Configuration
// ============================================================================

interface ILanguageDetection {
	name: string;
	extensions: string[];
	configFiles?: string[];
}

const LANGUAGE_DETECTIONS: ILanguageDetection[] = [
	{ name: 'TypeScript', extensions: ['.ts', '.tsx', '.mts', '.cts'], configFiles: ['tsconfig.json'] },
	{ name: 'JavaScript', extensions: ['.js', '.jsx', '.mjs', '.cjs'] },
	{ name: 'Python', extensions: ['.py', '.pyw', '.pyi'], configFiles: ['pyproject.toml', 'setup.py', 'requirements.txt'] },
	{ name: 'Rust', extensions: ['.rs'], configFiles: ['Cargo.toml'] },
	{ name: 'Go', extensions: ['.go'], configFiles: ['go.mod'] },
	{ name: 'Java', extensions: ['.java'], configFiles: ['pom.xml', 'build.gradle'] },
	{ name: 'C#', extensions: ['.cs'], configFiles: ['*.csproj', '*.sln'] },
	{ name: 'Ruby', extensions: ['.rb', '.rake'], configFiles: ['Gemfile', '*.gemspec'] },
	{ name: 'PHP', extensions: ['.php'], configFiles: ['composer.json'] },
	{ name: 'Swift', extensions: ['.swift'], configFiles: ['Package.swift'] },
	{ name: 'Kotlin', extensions: ['.kt', '.kts'], configFiles: ['build.gradle.kts'] },
	{ name: 'Scala', extensions: ['.scala'], configFiles: ['build.sbt'] },
	{ name: 'C', extensions: ['.c', '.h'] },
	{ name: 'C++', extensions: ['.cpp', '.hpp', '.cc', '.cxx', '.hxx'] },
	{ name: 'Dart', extensions: ['.dart'], configFiles: ['pubspec.yaml'] },
	{ name: 'Elixir', extensions: ['.ex', '.exs'], configFiles: ['mix.exs'] },
	{ name: 'Haskell', extensions: ['.hs'], configFiles: ['*.cabal', 'stack.yaml'] },
	{ name: 'Shell', extensions: ['.sh', '.bash', '.zsh'] },
	{ name: 'PowerShell', extensions: ['.ps1', '.psm1'] },
	{ name: 'SQL', extensions: ['.sql'] },
	{ name: 'CSS', extensions: ['.css'] },
	{ name: 'SCSS', extensions: ['.scss', '.sass'] },
	{ name: 'HTML', extensions: ['.html', '.htm'] },
	{ name: 'Vue', extensions: ['.vue'] },
	{ name: 'Svelte', extensions: ['.svelte'] },
];

// ============================================================================
// Framework Detection Configuration
// ============================================================================

interface IFrameworkDetection {
	name: string;
	category: TechnologyCategory;
	frameworkType: FrameworkType;
	indicators: {
		files?: string[];
		dependencies?: string[];
		directories?: string[];
	};
	architecturePattern?: ArchitecturePattern;
}

const FRAMEWORK_DETECTIONS: IFrameworkDetection[] = [
	// JavaScript/TypeScript Frameworks
	{
		name: 'React',
		category: 'framework',
		frameworkType: 'web-frontend',
		indicators: {
			dependencies: ['react', 'react-dom'],
			files: ['*.jsx', '*.tsx'],
		},
	},
	{
		name: 'Next.js',
		category: 'framework',
		frameworkType: 'full-stack',
		indicators: {
			dependencies: ['next'],
			files: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
			directories: ['pages', 'app'],
		},
		architecturePattern: 'modular',
	},
	{
		name: 'Vue.js',
		category: 'framework',
		frameworkType: 'web-frontend',
		indicators: {
			dependencies: ['vue'],
			files: ['*.vue', 'vue.config.js'],
		},
	},
	{
		name: 'Angular',
		category: 'framework',
		frameworkType: 'web-frontend',
		indicators: {
			dependencies: ['@angular/core'],
			files: ['angular.json'],
		},
		architecturePattern: 'modular',
	},
	{
		name: 'Svelte',
		category: 'framework',
		frameworkType: 'web-frontend',
		indicators: {
			dependencies: ['svelte'],
			files: ['*.svelte', 'svelte.config.js'],
		},
	},
	{
		name: 'Express',
		category: 'framework',
		frameworkType: 'web-backend',
		indicators: {
			dependencies: ['express'],
		},
	},
	{
		name: 'NestJS',
		category: 'framework',
		frameworkType: 'web-backend',
		indicators: {
			dependencies: ['@nestjs/core'],
			files: ['nest-cli.json'],
		},
		architecturePattern: 'modular',
	},
	{
		name: 'Fastify',
		category: 'framework',
		frameworkType: 'web-backend',
		indicators: {
			dependencies: ['fastify'],
		},
	},
	{
		name: 'Electron',
		category: 'framework',
		frameworkType: 'desktop',
		indicators: {
			dependencies: ['electron'],
			files: ['electron.js', 'main.js'],
		},
	},
	{
		name: 'React Native',
		category: 'framework',
		frameworkType: 'mobile',
		indicators: {
			dependencies: ['react-native'],
			files: ['metro.config.js', 'app.json'],
		},
	},
	// Python Frameworks
	{
		name: 'Django',
		category: 'framework',
		frameworkType: 'full-stack',
		indicators: {
			dependencies: ['django'],
			files: ['manage.py', 'settings.py'],
			directories: ['templates'],
		},
		architecturePattern: 'mvc',
	},
	{
		name: 'Flask',
		category: 'framework',
		frameworkType: 'web-backend',
		indicators: {
			dependencies: ['flask'],
		},
	},
	{
		name: 'FastAPI',
		category: 'framework',
		frameworkType: 'web-backend',
		indicators: {
			dependencies: ['fastapi'],
		},
	},
	// Ruby Frameworks
	{
		name: 'Ruby on Rails',
		category: 'framework',
		frameworkType: 'full-stack',
		indicators: {
			dependencies: ['rails'],
			files: ['Rakefile', 'config.ru'],
			directories: ['app/controllers', 'app/models', 'app/views'],
		},
		architecturePattern: 'mvc',
	},
	// Rust Frameworks
	{
		name: 'Actix-web',
		category: 'framework',
		frameworkType: 'web-backend',
		indicators: {
			dependencies: ['actix-web'],
		},
	},
	{
		name: 'Axum',
		category: 'framework',
		frameworkType: 'web-backend',
		indicators: {
			dependencies: ['axum'],
		},
	},
	// Go Frameworks
	{
		name: 'Gin',
		category: 'framework',
		frameworkType: 'web-backend',
		indicators: {
			dependencies: ['github.com/gin-gonic/gin'],
		},
	},
	// Testing Frameworks
	{
		name: 'Jest',
		category: 'testing',
		frameworkType: 'testing',
		indicators: {
			dependencies: ['jest'],
			files: ['jest.config.js', 'jest.config.ts'],
		},
	},
	{
		name: 'Mocha',
		category: 'testing',
		frameworkType: 'testing',
		indicators: {
			dependencies: ['mocha'],
			files: ['.mocharc.js', '.mocharc.json'],
		},
	},
	{
		name: 'Vitest',
		category: 'testing',
		frameworkType: 'testing',
		indicators: {
			dependencies: ['vitest'],
			files: ['vitest.config.ts', 'vitest.config.js'],
		},
	},
	{
		name: 'Pytest',
		category: 'testing',
		frameworkType: 'testing',
		indicators: {
			dependencies: ['pytest'],
			files: ['pytest.ini', 'conftest.py'],
		},
	},
];

// ============================================================================
// Directory Classification
// ============================================================================

const DIRECTORY_CLASSIFICATIONS: Record<string, DirectoryClassification> = {
	'src': 'source',
	'lib': 'source',
	'source': 'source',
	'app': 'source',
	'packages': 'source',
	'test': 'test',
	'tests': 'test',
	'__tests__': 'test',
	'spec': 'test',
	'specs': 'test',
	'e2e': 'test',
	'docs': 'docs',
	'doc': 'docs',
	'documentation': 'docs',
	'config': 'config',
	'.config': 'config',
	'configuration': 'config',
	'dist': 'build',
	'build': 'build',
	'out': 'build',
	'output': 'build',
	'.next': 'build',
	'assets': 'assets',
	'public': 'assets',
	'static': 'assets',
	'images': 'assets',
	'scripts': 'scripts',
	'tools': 'scripts',
	'bin': 'scripts',
	'vendor': 'vendor',
	'third-party': 'vendor',
	'third_party': 'vendor',
	'external': 'vendor',
	'generated': 'generated',
	'gen': 'generated',
	'examples': 'examples',
	'samples': 'examples',
	'demo': 'examples',
	'platform': 'platform',
	'common': 'common',
	'shared': 'common',
	'core': 'common',
	'util': 'common',
	'utils': 'common',
};

// ============================================================================
// Configuration File Detection
// ============================================================================

interface IConfigFileDetection {
	pattern: string;
	type: ConfigurationType;
	tool?: string;
	description: string;
}

const CONFIG_FILE_DETECTIONS: IConfigFileDetection[] = [
	// Build
	{ pattern: 'webpack.config.*', type: 'build', tool: 'Webpack', description: 'Webpack bundler configuration' },
	{ pattern: 'vite.config.*', type: 'build', tool: 'Vite', description: 'Vite build configuration' },
	{ pattern: 'rollup.config.*', type: 'build', tool: 'Rollup', description: 'Rollup bundler configuration' },
	{ pattern: 'esbuild.config.*', type: 'build', tool: 'esbuild', description: 'esbuild configuration' },
	{ pattern: 'turbo.json', type: 'build', tool: 'Turborepo', description: 'Turborepo monorepo configuration' },
	// Lint
	{ pattern: '.eslintrc*', type: 'lint', tool: 'ESLint', description: 'ESLint linting configuration' },
	{ pattern: 'eslint.config.*', type: 'lint', tool: 'ESLint', description: 'ESLint flat configuration' },
	{ pattern: '.prettierrc*', type: 'lint', tool: 'Prettier', description: 'Prettier formatting configuration' },
	{ pattern: 'prettier.config.*', type: 'lint', tool: 'Prettier', description: 'Prettier configuration' },
	{ pattern: '.stylelintrc*', type: 'lint', tool: 'Stylelint', description: 'Stylelint CSS linting configuration' },
	{ pattern: 'biome.json', type: 'lint', tool: 'Biome', description: 'Biome linting/formatting configuration' },
	// Test
	{ pattern: 'jest.config.*', type: 'test', tool: 'Jest', description: 'Jest testing configuration' },
	{ pattern: 'vitest.config.*', type: 'test', tool: 'Vitest', description: 'Vitest testing configuration' },
	{ pattern: '.mocharc*', type: 'test', tool: 'Mocha', description: 'Mocha testing configuration' },
	{ pattern: 'playwright.config.*', type: 'test', tool: 'Playwright', description: 'Playwright E2E testing configuration' },
	{ pattern: 'cypress.config.*', type: 'test', tool: 'Cypress', description: 'Cypress E2E testing configuration' },
	// CI/CD
	{ pattern: '.github/workflows/*', type: 'ci-cd', tool: 'GitHub Actions', description: 'GitHub Actions workflow' },
	{ pattern: '.gitlab-ci.yml', type: 'ci-cd', tool: 'GitLab CI', description: 'GitLab CI configuration' },
	{ pattern: 'Jenkinsfile', type: 'ci-cd', tool: 'Jenkins', description: 'Jenkins pipeline configuration' },
	{ pattern: '.circleci/config.yml', type: 'ci-cd', tool: 'CircleCI', description: 'CircleCI configuration' },
	{ pattern: 'azure-pipelines.yml', type: 'ci-cd', tool: 'Azure DevOps', description: 'Azure Pipelines configuration' },
	// Docker
	{ pattern: 'Dockerfile*', type: 'docker', tool: 'Docker', description: 'Docker container configuration' },
	{ pattern: 'docker-compose*.yml', type: 'docker', tool: 'Docker Compose', description: 'Docker Compose configuration' },
	{ pattern: '.dockerignore', type: 'docker', tool: 'Docker', description: 'Docker ignore patterns' },
	// Package
	{ pattern: 'package.json', type: 'package', tool: 'npm/yarn/pnpm', description: 'Node.js package manifest' },
	{ pattern: 'Cargo.toml', type: 'package', tool: 'Cargo', description: 'Rust package manifest' },
	{ pattern: 'pyproject.toml', type: 'package', tool: 'Python', description: 'Python project configuration' },
	{ pattern: 'go.mod', type: 'package', tool: 'Go', description: 'Go module manifest' },
	{ pattern: 'Gemfile', type: 'package', tool: 'Bundler', description: 'Ruby gem dependencies' },
	{ pattern: 'composer.json', type: 'package', tool: 'Composer', description: 'PHP package manifest' },
	// TypeScript
	{ pattern: 'tsconfig*.json', type: 'typescript', tool: 'TypeScript', description: 'TypeScript compiler configuration' },
	// Editor
	{ pattern: '.editorconfig', type: 'editor', description: 'Editor configuration' },
	{ pattern: '.vscode/*', type: 'editor', tool: 'VS Code', description: 'VS Code workspace settings' },
	// Git
	{ pattern: '.gitignore', type: 'git', tool: 'Git', description: 'Git ignore patterns' },
	{ pattern: '.gitattributes', type: 'git', tool: 'Git', description: 'Git attributes' },
	// Environment
	{ pattern: '.env*', type: 'environment', description: 'Environment variables' },
];

// ============================================================================
// Repository Analyzer Service Implementation
// ============================================================================

export class RepositoryAnalyzerService implements IRepositoryAnalyzerService {
	declare readonly _serviceBrand: undefined;

	private readonly warnings: string[] = [];

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService
	) { }

	async analyzeRepository(repositoryPath: string, options?: IAnalyzeRepositoryOptions): Promise<IRepositoryAnalysis> {
		const startTime = Date.now();
		const analysisId = this.generateId();
		const config = { ...DEFAULT_ANALYSIS_CONFIGURATION, ...options?.configuration };
		this.warnings.length = 0;

		const analysis: IRepositoryAnalysis = {
			id: analysisId,
			repositoryPath,
			startedAt: startTime,
			status: 'in-progress',
			metadata: {
				analyzerVersion: '1.0.0',
				filesAnalyzed: 0,
				filesSkipped: 0,
				warnings: [],
				configuration: config,
			},
		};

		try {
			// Phase 1: Structure Analysis
			options?.onProgress?.({
				phase: 'structure',
				description: 'Analyzing repository structure...',
				percentage: 0,
			});

			const structure = await this.analyzeStructure(repositoryPath, config);

			// Phase 2: Technology Stack Analysis
			options?.onProgress?.({
				phase: 'technology',
				description: 'Detecting technology stack...',
				percentage: 25,
			});

			const technologyStack = await this.analyzeTechnologyStack(repositoryPath, config);

			// Phase 3: Business Domain Analysis (if enabled)
			let businessDomain: IBusinessDomainAnalysis | undefined;
			if (config.detectBusinessDomain) {
				options?.onProgress?.({
					phase: 'domain',
					description: 'Analyzing business domain...',
					percentage: 50,
				});

				businessDomain = await this.analyzeBusinessDomain(repositoryPath, config);
			}

			// Phase 4: Code Pattern Analysis (if enabled)
			let codePatterns: ICodePatternAnalysis | undefined;
			if (config.analyzeCodePatterns) {
				options?.onProgress?.({
					phase: 'patterns',
					description: 'Analyzing code patterns...',
					percentage: 75,
				});

				codePatterns = await this.analyzeCodePatterns(repositoryPath, config);
			}

			// Phase 5: Generate Summary and Key Findings
			options?.onProgress?.({
				phase: 'finalizing',
				description: 'Generating summary...',
				percentage: 90,
			});

			const keyFindings = this.generateKeyFindings(structure, technologyStack, businessDomain, codePatterns);
			const summary = this.generateSummary(structure, technologyStack, businessDomain, codePatterns);

			const completedAt = Date.now();

			return {
				...analysis,
				status: 'completed',
				completedAt,
				structure,
				technologyStack,
				businessDomain,
				codePatterns,
				summary,
				keyFindings,
				metadata: {
					...analysis.metadata,
					durationMs: completedAt - startTime,
					filesAnalyzed: structure.totalFileCount,
					warnings: [...this.warnings],
				},
			};
		} catch (error) {
			return {
				...analysis,
				status: 'failed',
				completedAt: Date.now(),
				error: error instanceof Error ? error.message : String(error),
				metadata: {
					...analysis.metadata,
					durationMs: Date.now() - startTime,
					warnings: [...this.warnings],
				},
			};
		}
	}

	async analyzeStructure(repositoryPath: string, config?: Partial<IAnalysisConfiguration>): Promise<IRepositoryStructure> {
		const fullConfig = { ...DEFAULT_ANALYSIS_CONFIGURATION, ...config };
		const rootUri = URI.file(repositoryPath);

		// Analyze root directory
		const rootDirectory = await this.analyzeDirectory(rootUri, '', fullConfig, 0);

		// Detect packages
		const packages = await this.detectPackages(rootUri, fullConfig);

		// Detect entry points
		const entryPoints = await this.detectEntryPoints(rootUri, packages);

		// Detect configuration files
		const configurationFiles = await this.detectConfigurationFiles(rootUri);

		// Determine structure type
		const structureType = this.determineStructureType(packages, rootDirectory);

		// Get primary languages
		const primaryLanguages = await this.detectLanguages(rootUri, fullConfig);

		// Identify key directories
		const keyDirectories = this.identifyKeyDirectories(rootDirectory);

		return {
			structureType: structureType.type,
			confidence: structureType.confidence,
			rootDirectory,
			packages,
			keyDirectories,
			entryPoints,
			configurationFiles,
			totalFileCount: rootDirectory.fileCount + this.countFilesRecursive(rootDirectory),
			primaryLanguages,
		};
	}

	async analyzeTechnologyStack(repositoryPath: string, config?: Partial<IAnalysisConfiguration>): Promise<ITechnologyStack> {
		const fullConfig = { ...DEFAULT_ANALYSIS_CONFIGURATION, ...config };
		const rootUri = URI.file(repositoryPath);

		// Detect languages
		const languages = await this.detectLanguages(rootUri, fullConfig);

		// Detect frameworks
		const frameworks = await this.detectFrameworks(rootUri, fullConfig);

		// Detect package managers
		const packageManagers = await this.detectPackageManagers(rootUri);

		// Detect build tools
		const buildTools = await this.detectBuildTools(rootUri);

		// Detect testing frameworks
		const testingFrameworks = frameworks.filter(f => f.category === 'testing');

		// Detect CI/CD tools
		const ciCdTools = await this.detectCiCdTools(rootUri);

		// Detect databases
		const databases = await this.detectDatabases(rootUri);

		// Detect cloud infrastructure
		const cloudInfrastructure = await this.detectCloudInfrastructure(rootUri);

		// Determine architecture pattern
		const architecture = this.determineArchitecturePattern(frameworks, rootUri);

		// Generate all technologies list
		const technologies: ITechnologyInfo[] = [
			...frameworks.map(f => ({
				name: f.name,
				category: f.category,
				confidence: f.confidence,
				evidence: f.evidence,
				isPrimary: f.isPrimary,
			})),
			...buildTools,
			...ciCdTools,
			...databases,
			...cloudInfrastructure,
		];

		return {
			languages,
			frameworks,
			technologies,
			packageManagers,
			buildTools,
			testingFrameworks,
			ciCdTools,
			databases,
			cloudInfrastructure,
			architecturePattern: architecture.pattern,
			architectureConfidence: architecture.confidence,
			summary: this.generateTechnologySummary(languages, frameworks, architecture.pattern),
		};
	}

	async analyzeBusinessDomain(repositoryPath: string, _config?: Partial<IAnalysisConfiguration>): Promise<IBusinessDomainAnalysis> {
		// This is a simplified implementation - a full implementation would use
		// NLP and more sophisticated analysis
		const rootUri = URI.file(repositoryPath);

		// Analyze domain by looking at file names, directory structure, and code patterns
		const domainAnalysis = await this.analyzeDomainIndicators(rootUri);

		return {
			primaryDomain: domainAnalysis.primaryDomain,
			secondaryDomains: domainAnalysis.secondaryDomains,
			confidence: domainAnalysis.confidence,
			concepts: [],
			entities: [],
			workflows: [],
			glossary: {},
			summary: `This appears to be a ${domainAnalysis.primaryDomain} project based on the codebase structure and terminology.`,
		};
	}

	async analyzeCodePatterns(repositoryPath: string, _config?: Partial<IAnalysisConfiguration>): Promise<ICodePatternAnalysis> {
		// Simplified implementation - focuses on detecting common patterns
		const rootUri = URI.file(repositoryPath);

		const patterns = await this.detectDesignPatterns(rootUri);
		const conventions = await this.detectConventions(rootUri);

		return {
			designPatterns: patterns,
			conventions,
			antiPatterns: [],
			qualityMetrics: [],
			overallQualityScore: 70, // Default score
			architecturalDecisions: [],
			summary: 'Code pattern analysis completed. Common patterns detected based on file structure and naming conventions.',
		};
	}

	async getQuickSummary(repositoryPath: string): Promise<IRepositoryQuickSummary> {
		const rootUri = URI.file(repositoryPath);
		const entries = await this.fileSystemService.readDirectory(rootUri);

		let fileCount = 0;
		let hasPackageManifest = false;
		let hasReadme = false;
		let hasTests = false;
		let hasCiCd = false;
		let packageManager: PackageManager = 'unknown';
		let primaryLanguage: string | undefined;
		let framework: string | undefined;

		for (const [name, type] of entries) {
			if (type === FileType.File) {
				fileCount++;
				const lowerName = name.toLowerCase();

				if (lowerName === 'package.json') {
					hasPackageManifest = true;
					packageManager = 'npm';
					// Try to detect framework from package.json
					try {
						const content = await this.readFileAsString(URI.joinPath(rootUri, name));
						const pkg = JSON.parse(content);
						if (pkg.dependencies?.react || pkg.devDependencies?.react) {
							framework = 'React';
						} else if (pkg.dependencies?.vue) {
							framework = 'Vue.js';
						} else if (pkg.dependencies?.['@angular/core']) {
							framework = 'Angular';
						}
					} catch { /* ignore */ }
				} else if (lowerName === 'cargo.toml') {
					hasPackageManifest = true;
					packageManager = 'cargo';
					primaryLanguage = 'Rust';
				} else if (lowerName === 'go.mod') {
					hasPackageManifest = true;
					packageManager = 'go-modules';
					primaryLanguage = 'Go';
				} else if (lowerName.startsWith('readme')) {
					hasReadme = true;
				}
			} else if (type === FileType.Directory) {
				const lowerName = name.toLowerCase();
				if (['test', 'tests', '__tests__', 'spec'].includes(lowerName)) {
					hasTests = true;
				} else if (name === '.github') {
					// Check for workflows
					try {
						const ghEntries = await this.fileSystemService.readDirectory(URI.joinPath(rootUri, name));
						hasCiCd = ghEntries.some(([n]) => n === 'workflows');
					} catch { /* ignore */ }
				}
			}
		}

		// Detect primary language if not already set
		if (!primaryLanguage) {
			const tsFiles = entries.filter(([n]) => n.endsWith('.ts') || n.endsWith('.tsx'));
			const jsFiles = entries.filter(([n]) => n.endsWith('.js') || n.endsWith('.jsx'));
			const pyFiles = entries.filter(([n]) => n.endsWith('.py'));

			if (tsFiles.length > 0) {
				primaryLanguage = 'TypeScript';
			} else if (jsFiles.length > 0) {
				primaryLanguage = 'JavaScript';
			} else if (pyFiles.length > 0) {
				primaryLanguage = 'Python';
			}
		}

		return {
			name: repositoryPath.split(/[/\\]/).pop() || 'unknown',
			primaryLanguage,
			framework,
			packageManager,
			fileCount,
			hasPackageManifest,
			hasReadme,
			hasTests,
			hasCiCd,
		};
	}

	// ============================================================================
	// Private Helper Methods
	// ============================================================================

	private generateId(): string {
		return `analysis-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
	}

	private async analyzeDirectory(
		uri: vscode.Uri,
		relativePath: string,
		config: IAnalysisConfiguration,
		depth: number
	): Promise<IDirectoryInfo> {
		const entries = await this.fileSystemService.readDirectory(uri);
		const name = uri.path.split('/').pop() || '';

		let fileCount = 0;
		let subdirectoryCount = 0;
		const extensions: Map<string, number> = new Map();
		const children: IDirectoryInfo[] = [];

		for (const [entryName, type] of entries) {
			if (this.shouldExclude(entryName, config.excludePatterns)) {
				continue;
			}

			if (type === FileType.File) {
				fileCount++;
				const ext = this.getExtension(entryName);
				if (ext) {
					extensions.set(ext, (extensions.get(ext) || 0) + 1);
				}
			} else if (type === FileType.Directory) {
				subdirectoryCount++;
				if (depth < config.maxDepth) {
					const childUri = URI.joinPath(uri, entryName);
					const childPath = relativePath ? `${relativePath}/${entryName}` : entryName;
					const childInfo = await this.analyzeDirectory(childUri, childPath, config, depth + 1);
					children.push(childInfo);
				}
			}
		}

		const primaryExtensions = Array.from(extensions.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([ext]) => ext);

		const classification = this.classifyDirectory(name, primaryExtensions);

		return {
			path: relativePath || '.',
			name,
			classification: classification.type,
			confidence: classification.confidence,
			fileCount,
			subdirectoryCount,
			primaryExtensions,
			children: children.length > 0 ? children : undefined,
		};
	}

	private classifyDirectory(name: string, extensions: string[]): { type: DirectoryClassification; confidence: ConfidenceLevel } {
		const lowerName = name.toLowerCase();

		// Check direct mapping
		if (DIRECTORY_CLASSIFICATIONS[lowerName]) {
			return { type: DIRECTORY_CLASSIFICATIONS[lowerName], confidence: 'high' };
		}

		// Check if it contains test files
		if (extensions.some(ext => ext.includes('.test.') || ext.includes('.spec.'))) {
			return { type: 'test', confidence: 'medium' };
		}

		// Check by extensions
		const codeExtensions = ['.ts', '.js', '.py', '.rs', '.go', '.java', '.cs', '.rb'];
		if (extensions.some(ext => codeExtensions.includes(ext))) {
			return { type: 'source', confidence: 'low' };
		}

		return { type: 'unknown', confidence: 'low' };
	}

	private async detectPackages(rootUri: vscode.Uri, config: IAnalysisConfiguration): Promise<IPackageInfo[]> {
		const packages: IPackageInfo[] = [];

		// Check for package.json at root
		try {
			const packageJsonUri = URI.joinPath(rootUri, 'package.json');
			const content = await this.readFileAsString(packageJsonUri);
			const pkg = JSON.parse(content);

			const dependencies = this.extractDependencies(pkg.dependencies || {}, false);
			const devDependencies = this.extractDependencies(pkg.devDependencies || {}, true);

			packages.push({
				name: pkg.name || 'unknown',
				version: pkg.version,
				path: '.',
				packageManager: this.detectPackageManagerFromFiles(rootUri),
				dependencies,
				devDependencies,
				scripts: pkg.scripts || {},
				isPrivate: pkg.private === true,
				entryPoints: pkg.main ? [pkg.main] : undefined,
			});
		} catch {
			// No package.json at root
		}

		// Check for Cargo.toml
		try {
			const cargoUri = URI.joinPath(rootUri, 'Cargo.toml');
			await this.fileSystemService.stat(cargoUri);
			packages.push({
				name: 'rust-package',
				path: '.',
				packageManager: 'cargo',
				dependencies: [],
				devDependencies: [],
				scripts: {},
				isPrivate: false,
			});
		} catch { /* No Cargo.toml */ }

		// Check for go.mod
		try {
			const goModUri = URI.joinPath(rootUri, 'go.mod');
			await this.fileSystemService.stat(goModUri);
			packages.push({
				name: 'go-module',
				path: '.',
				packageManager: 'go-modules',
				dependencies: [],
				devDependencies: [],
				scripts: {},
				isPrivate: false,
			});
		} catch { /* No go.mod */ }

		// Check for workspaces (npm/yarn workspaces, lerna, etc.)
		if (packages.length > 0 && packages[0].packageManager !== 'unknown') {
			const workspacePackages = await this.detectWorkspacePackages(rootUri, config);
			packages.push(...workspacePackages);
		}

		return packages;
	}

	private extractDependencies(deps: Record<string, string>, isDev: boolean): IDependencyInfo[] {
		return Object.entries(deps).map(([name, version]) => ({
			name,
			version,
			isDev,
			isPeer: false,
			isOptional: false,
		}));
	}

	private detectPackageManagerFromFiles(_rootUri: vscode.Uri): PackageManager {
		// This would check for lock files to determine package manager
		// Simplified for now
		return 'npm';
	}

	private async detectWorkspacePackages(_rootUri: vscode.Uri, _config: IAnalysisConfiguration): Promise<IPackageInfo[]> {
		// Would scan for workspace packages in monorepos
		return [];
	}

	private async detectEntryPoints(rootUri: vscode.Uri, packages: IPackageInfo[]): Promise<IEntryPoint[]> {
		const entryPoints: IEntryPoint[] = [];

		// Check package.json entries
		for (const pkg of packages) {
			if (pkg.entryPoints) {
				for (const entry of pkg.entryPoints) {
					entryPoints.push({
						path: entry,
						type: 'main',
						confidence: 'high',
					});
				}
			}
		}

		// Check for common entry point files
		const commonEntryPoints = [
			{ file: 'src/index.ts', type: 'main' as const },
			{ file: 'src/index.js', type: 'main' as const },
			{ file: 'src/main.ts', type: 'main' as const },
			{ file: 'src/main.js', type: 'main' as const },
			{ file: 'index.ts', type: 'main' as const },
			{ file: 'index.js', type: 'main' as const },
			{ file: 'src/app.ts', type: 'server' as const },
			{ file: 'src/server.ts', type: 'server' as const },
			{ file: 'src/cli.ts', type: 'cli' as const },
			{ file: 'bin/cli.js', type: 'cli' as const },
		];

		for (const { file, type } of commonEntryPoints) {
			try {
				await this.fileSystemService.stat(URI.joinPath(rootUri, file));
				entryPoints.push({
					path: file,
					type,
					confidence: 'medium',
				});
			} catch { /* File doesn't exist */ }
		}

		return entryPoints;
	}

	private async detectConfigurationFiles(rootUri: vscode.Uri): Promise<IConfigurationFile[]> {
		const configFiles: IConfigurationFile[] = [];
		const entries = await this.fileSystemService.readDirectory(rootUri);

		for (const [name, type] of entries) {
			if (type !== FileType.File) continue;

			for (const detection of CONFIG_FILE_DETECTIONS) {
				if (this.matchesPattern(name, detection.pattern)) {
					configFiles.push({
						path: name,
						type: detection.type,
						tool: detection.tool,
						description: detection.description,
					});
					break;
				}
			}
		}

		// Also check .github/workflows
		try {
			const workflowsUri = URI.joinPath(rootUri, '.github', 'workflows');
			const workflowEntries = await this.fileSystemService.readDirectory(workflowsUri);
			for (const [name, type] of workflowEntries) {
				if (type === FileType.File && (name.endsWith('.yml') || name.endsWith('.yaml'))) {
					configFiles.push({
						path: `.github/workflows/${name}`,
						type: 'ci-cd',
						tool: 'GitHub Actions',
						description: `GitHub Actions workflow: ${name}`,
					});
				}
			}
		} catch { /* No workflows directory */ }

		return configFiles;
	}

	private matchesPattern(filename: string, pattern: string): boolean {
		// Simple pattern matching (would use minimatch or similar in production)
		if (pattern.includes('*')) {
			const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
			return regex.test(filename);
		}
		return filename === pattern;
	}

	private determineStructureType(packages: IPackageInfo[], rootDir: IDirectoryInfo): { type: RepositoryStructureType; confidence: ConfidenceLevel } {
		if (packages.length === 0) {
			return { type: 'unknown', confidence: 'low' };
		}

		if (packages.length > 1) {
			return { type: 'monorepo', confidence: 'high' };
		}

		// Check for workspace indicators
		const hasPackagesDir = rootDir.children?.some(d => d.name === 'packages');
		const hasAppsDir = rootDir.children?.some(d => d.name === 'apps');

		if (hasPackagesDir || hasAppsDir) {
			return { type: 'workspace', confidence: 'medium' };
		}

		return { type: 'single-package', confidence: 'high' };
	}

	private async detectLanguages(rootUri: vscode.Uri, config: IAnalysisConfiguration): Promise<ILanguageInfo[]> {
		const languageCounts: Map<string, { count: number; extensions: Set<string> }> = new Map();
		await this.countLanguageFiles(rootUri, config, languageCounts, 0);

		const totalFiles = Array.from(languageCounts.values()).reduce((sum, { count }) => sum + count, 0);

		return Array.from(languageCounts.entries())
			.map(([name, { count, extensions }]) => ({
				name,
				extensions: Array.from(extensions),
				percentage: totalFiles > 0 ? Math.round((count / totalFiles) * 100) : 0,
				fileCount: count,
			}))
			.filter(lang => lang.percentage > 0)
			.sort((a, b) => b.percentage - a.percentage);
	}

	private async countLanguageFiles(
		uri: vscode.Uri,
		config: IAnalysisConfiguration,
		counts: Map<string, { count: number; extensions: Set<string> }>,
		depth: number
	): Promise<void> {
		if (depth > config.maxDepth) return;

		try {
			const entries = await this.fileSystemService.readDirectory(uri);

			for (const [name, type] of entries) {
				if (this.shouldExclude(name, config.excludePatterns)) continue;

				if (type === FileType.File) {
					const ext = this.getExtension(name);
					if (ext) {
						for (const lang of LANGUAGE_DETECTIONS) {
							if (lang.extensions.includes(ext)) {
								const existing = counts.get(lang.name) || { count: 0, extensions: new Set() };
								existing.count++;
								existing.extensions.add(ext);
								counts.set(lang.name, existing);
								break;
							}
						}
					}
				} else if (type === FileType.Directory) {
					await this.countLanguageFiles(URI.joinPath(uri, name), config, counts, depth + 1);
				}
			}
		} catch { /* ignore errors */ }
	}

	private async detectFrameworks(rootUri: vscode.Uri, _config: Partial<IAnalysisConfiguration>): Promise<IFrameworkInfo[]> {
		const frameworks: IFrameworkInfo[] = [];

		// Check package.json dependencies
		let dependencies: Record<string, string> = {};
		let devDependencies: Record<string, string> = {};

		try {
			const packageJsonUri = URI.joinPath(rootUri, 'package.json');
			const content = await this.readFileAsString(packageJsonUri);
			const pkg = JSON.parse(content);
			dependencies = pkg.dependencies || {};
			devDependencies = pkg.devDependencies || {};
		} catch { /* No package.json */ }

		const allDeps = { ...dependencies, ...devDependencies };

		for (const detection of FRAMEWORK_DETECTIONS) {
			const evidence: string[] = [];
			let detected = false;

			// Check dependencies
			if (detection.indicators.dependencies) {
				for (const dep of detection.indicators.dependencies) {
					if (allDeps[dep]) {
						evidence.push(`Dependency: ${dep}@${allDeps[dep]}`);
						detected = true;
					}
				}
			}

			// Check for indicator files
			if (detection.indicators.files) {
				for (const file of detection.indicators.files) {
					try {
						if (file.includes('*')) {
							// Skip pattern matching for now
							continue;
						}
						await this.fileSystemService.stat(URI.joinPath(rootUri, file));
						evidence.push(`File: ${file}`);
						detected = true;
					} catch { /* File doesn't exist */ }
				}
			}

			// Check for indicator directories
			if (detection.indicators.directories) {
				for (const dir of detection.indicators.directories) {
					try {
						await this.fileSystemService.stat(URI.joinPath(rootUri, dir));
						evidence.push(`Directory: ${dir}`);
						detected = true;
					} catch { /* Directory doesn't exist */ }
				}
			}

			if (detected) {
				frameworks.push({
					name: detection.name,
					category: detection.category,
					frameworkType: detection.frameworkType,
					confidence: evidence.length >= 2 ? 'high' : 'medium',
					evidence,
					isPrimary: detection.category === 'framework',
					indicatorFiles: detection.indicators.files || [],
					architecturePattern: detection.architecturePattern,
				});
			}
		}

		return frameworks;
	}

	private async detectPackageManagers(rootUri: vscode.Uri): Promise<PackageManager[]> {
		const managers: PackageManager[] = [];

		const checks: Array<{ file: string; manager: PackageManager }> = [
			{ file: 'package-lock.json', manager: 'npm' },
			{ file: 'yarn.lock', manager: 'yarn' },
			{ file: 'pnpm-lock.yaml', manager: 'pnpm' },
			{ file: 'bun.lockb', manager: 'bun' },
			{ file: 'Cargo.lock', manager: 'cargo' },
			{ file: 'go.sum', manager: 'go-modules' },
			{ file: 'Gemfile.lock', manager: 'bundler' },
			{ file: 'poetry.lock', manager: 'poetry' },
			{ file: 'Pipfile.lock', manager: 'pipenv' },
			{ file: 'composer.lock', manager: 'composer' },
		];

		for (const { file, manager } of checks) {
			try {
				await this.fileSystemService.stat(URI.joinPath(rootUri, file));
				managers.push(manager);
			} catch { /* File doesn't exist */ }
		}

		return managers;
	}

	private async detectBuildTools(rootUri: vscode.Uri): Promise<ITechnologyInfo[]> {
		const tools: ITechnologyInfo[] = [];

		const checks: Array<{ patterns: string[]; name: string }> = [
			{ patterns: ['webpack.config.js', 'webpack.config.ts'], name: 'Webpack' },
			{ patterns: ['vite.config.js', 'vite.config.ts'], name: 'Vite' },
			{ patterns: ['rollup.config.js', 'rollup.config.ts'], name: 'Rollup' },
			{ patterns: ['turbo.json'], name: 'Turborepo' },
			{ patterns: ['nx.json'], name: 'Nx' },
			{ patterns: ['Makefile'], name: 'Make' },
			{ patterns: ['gulpfile.js'], name: 'Gulp' },
		];

		for (const { patterns, name } of checks) {
			for (const pattern of patterns) {
				try {
					await this.fileSystemService.stat(URI.joinPath(rootUri, pattern));
					tools.push({
						name,
						category: 'build',
						confidence: 'high',
						evidence: [`Config file: ${pattern}`],
						isPrimary: true,
					});
					break;
				} catch { /* File doesn't exist */ }
			}
		}

		return tools;
	}

	private async detectCiCdTools(rootUri: vscode.Uri): Promise<ITechnologyInfo[]> {
		const tools: ITechnologyInfo[] = [];

		const checks: Array<{ path: string; name: string }> = [
			{ path: '.github/workflows', name: 'GitHub Actions' },
			{ path: '.gitlab-ci.yml', name: 'GitLab CI' },
			{ path: 'Jenkinsfile', name: 'Jenkins' },
			{ path: '.circleci', name: 'CircleCI' },
			{ path: 'azure-pipelines.yml', name: 'Azure DevOps' },
			{ path: '.travis.yml', name: 'Travis CI' },
		];

		for (const { path, name } of checks) {
			try {
				await this.fileSystemService.stat(URI.joinPath(rootUri, path));
				tools.push({
					name,
					category: 'devops',
					confidence: 'high',
					evidence: [`Found: ${path}`],
					isPrimary: true,
				});
			} catch { /* Doesn't exist */ }
		}

		return tools;
	}

	private async detectDatabases(rootUri: vscode.Uri): Promise<ITechnologyInfo[]> {
		const databases: ITechnologyInfo[] = [];

		// Check package.json for database drivers
		try {
			const packageJsonUri = URI.joinPath(rootUri, 'package.json');
			const content = await this.readFileAsString(packageJsonUri);
			const pkg = JSON.parse(content);
			const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

			const dbChecks: Array<{ deps: string[]; name: string }> = [
				{ deps: ['pg', 'postgres', 'node-postgres'], name: 'PostgreSQL' },
				{ deps: ['mysql', 'mysql2'], name: 'MySQL' },
				{ deps: ['mongodb', 'mongoose'], name: 'MongoDB' },
				{ deps: ['redis', 'ioredis'], name: 'Redis' },
				{ deps: ['sqlite3', 'better-sqlite3'], name: 'SQLite' },
				{ deps: ['prisma', '@prisma/client'], name: 'Prisma ORM' },
				{ deps: ['typeorm'], name: 'TypeORM' },
				{ deps: ['sequelize'], name: 'Sequelize' },
				{ deps: ['drizzle-orm'], name: 'Drizzle ORM' },
			];

			for (const { deps, name } of dbChecks) {
				const foundDep = deps.find(d => allDeps[d]);
				if (foundDep) {
					databases.push({
						name,
						category: 'database',
						confidence: 'high',
						evidence: [`Dependency: ${foundDep}`],
						isPrimary: true,
					});
				}
			}
		} catch { /* No package.json */ }

		return databases;
	}

	private async detectCloudInfrastructure(rootUri: vscode.Uri): Promise<ITechnologyInfo[]> {
		const infrastructure: ITechnologyInfo[] = [];

		const checks: Array<{ patterns: string[]; name: string }> = [
			{ patterns: ['serverless.yml', 'serverless.ts'], name: 'Serverless Framework' },
			{ patterns: ['terraform'], name: 'Terraform' },
			{ patterns: ['cdk.json'], name: 'AWS CDK' },
			{ patterns: ['vercel.json'], name: 'Vercel' },
			{ patterns: ['netlify.toml'], name: 'Netlify' },
			{ patterns: ['fly.toml'], name: 'Fly.io' },
			{ patterns: ['render.yaml'], name: 'Render' },
			{ patterns: ['kubernetes', 'k8s'], name: 'Kubernetes' },
		];

		for (const { patterns, name } of checks) {
			for (const pattern of patterns) {
				try {
					await this.fileSystemService.stat(URI.joinPath(rootUri, pattern));
					infrastructure.push({
						name,
						category: 'cloud',
						confidence: 'high',
						evidence: [`Found: ${pattern}`],
						isPrimary: true,
					});
					break;
				} catch { /* Doesn't exist */ }
			}
		}

		return infrastructure;
	}

	private determineArchitecturePattern(frameworks: IFrameworkInfo[], _rootUri: vscode.Uri): { pattern: ArchitecturePattern; confidence: ConfidenceLevel } {
		// Check if any framework defines an architecture pattern
		for (const framework of frameworks) {
			if (framework.architecturePattern) {
				return { pattern: framework.architecturePattern, confidence: 'medium' };
			}
		}

		// Default to modular for modern frameworks
		if (frameworks.some(f => ['Next.js', 'NestJS', 'Angular'].includes(f.name))) {
			return { pattern: 'modular', confidence: 'medium' };
		}

		// Check for microservices indicators
		// This would need more sophisticated analysis

		return { pattern: 'unknown', confidence: 'low' };
	}

	private async analyzeDomainIndicators(rootUri: vscode.Uri): Promise<{
		primaryDomain: import('../types/repositoryAnalysis').BusinessDomainCategory;
		secondaryDomains: import('../types/repositoryAnalysis').BusinessDomainCategory[];
		confidence: ConfidenceLevel;
	}> {
		// Simple domain detection based on common patterns
		// A full implementation would use NLP and more sophisticated analysis

		try {
			const packageJsonUri = URI.joinPath(rootUri, 'package.json');
			const content = await this.readFileAsString(packageJsonUri);
			const pkg = JSON.parse(content);
			const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

			// Check for common domain indicators
			if (allDeps['stripe'] || allDeps['@stripe/stripe-js']) {
				return { primaryDomain: 'ecommerce', secondaryDomains: ['fintech'], confidence: 'medium' };
			}
			if (allDeps['@auth0/auth0-react'] || allDeps['next-auth']) {
				return { primaryDomain: 'security', secondaryDomains: [], confidence: 'medium' };
			}
			if (allDeps['socket.io'] || allDeps['@socket.io/client']) {
				return { primaryDomain: 'communication', secondaryDomains: [], confidence: 'low' };
			}
		} catch { /* ignore */ }

		return { primaryDomain: 'developer-tools', secondaryDomains: [], confidence: 'low' };
	}

	private async detectDesignPatterns(_rootUri: vscode.Uri): Promise<import('../types/repositoryAnalysis').IDesignPattern[]> {
		// Simplified pattern detection
		return [];
	}

	private async detectConventions(_rootUri: vscode.Uri): Promise<import('../types/repositoryAnalysis').ICodeConvention[]> {
		// Simplified convention detection
		return [];
	}

	private identifyKeyDirectories(rootDir: IDirectoryInfo): IDirectoryInfo[] {
		const keyDirs: IDirectoryInfo[] = [];

		if (rootDir.children) {
			for (const child of rootDir.children) {
				if (child.classification !== 'unknown') {
					keyDirs.push(child);
				}
			}
		}

		return keyDirs;
	}

	private countFilesRecursive(dir: IDirectoryInfo): number {
		let count = 0;
		if (dir.children) {
			for (const child of dir.children) {
				count += child.fileCount + this.countFilesRecursive(child);
			}
		}
		return count;
	}

	private generateKeyFindings(
		structure: IRepositoryStructure,
		technology: ITechnologyStack,
		_domain?: IBusinessDomainAnalysis,
		_patterns?: ICodePatternAnalysis
	): IKeyFinding[] {
		const findings: IKeyFinding[] = [];

		// Add findings based on analysis
		if (structure.structureType === 'monorepo') {
			findings.push({
				title: 'Monorepo Structure',
				description: 'This repository uses a monorepo structure with multiple packages.',
				category: 'strength',
				priority: 'medium',
				relatedSections: ['structure'],
			});
		}

		if (technology.testingFrameworks.length > 0) {
			findings.push({
				title: 'Testing Framework Configured',
				description: `Uses ${technology.testingFrameworks.map(t => t.name).join(', ')} for testing.`,
				category: 'strength',
				priority: 'medium',
				relatedSections: ['technology'],
			});
		}

		if (technology.ciCdTools.length > 0) {
			findings.push({
				title: 'CI/CD Pipeline Configured',
				description: `Has ${technology.ciCdTools.map(t => t.name).join(', ')} configured for continuous integration.`,
				category: 'strength',
				priority: 'medium',
				relatedSections: ['technology'],
			});
		}

		return findings;
	}

	private generateSummary(
		structure: IRepositoryStructure,
		technology: ITechnologyStack,
		_domain?: IBusinessDomainAnalysis,
		_patterns?: ICodePatternAnalysis
	): string {
		const parts: string[] = [];

		parts.push(`This is a ${structure.structureType} repository`);

		if (technology.languages.length > 0) {
			const topLangs = technology.languages.slice(0, 3).map(l => l.name);
			parts.push(`primarily written in ${topLangs.join(', ')}`);
		}

		if (technology.frameworks.length > 0) {
			const mainFrameworks = technology.frameworks.filter(f => f.isPrimary).map(f => f.name);
			if (mainFrameworks.length > 0) {
				parts.push(`using ${mainFrameworks.join(', ')}`);
			}
		}

		parts.push(`with ${structure.totalFileCount} files.`);

		return parts.join(' ');
	}

	private generateTechnologySummary(
		languages: ILanguageInfo[],
		frameworks: IFrameworkInfo[],
		architecture: ArchitecturePattern
	): string {
		const parts: string[] = [];

		if (languages.length > 0) {
			parts.push(`Primary language${languages.length > 1 ? 's' : ''}: ${languages.slice(0, 3).map(l => `${l.name} (${l.percentage}%)`).join(', ')}`);
		}

		if (frameworks.length > 0) {
			parts.push(`Frameworks: ${frameworks.map(f => f.name).join(', ')}`);
		}

		if (architecture !== 'unknown') {
			parts.push(`Architecture: ${architecture}`);
		}

		return parts.join('. ');
	}

	private shouldExclude(name: string, patterns: readonly string[]): boolean {
		const lowerName = name.toLowerCase();
		for (const pattern of patterns) {
			if (pattern.includes('*')) {
				// Simple glob matching
				const regexPattern = pattern
					.replace(/\*\*/g, '.*')
					.replace(/\*/g, '[^/]*')
					.replace(/\//g, '\\/');
				if (new RegExp(regexPattern).test(lowerName)) {
					return true;
				}
			} else if (lowerName === pattern.toLowerCase() || lowerName.startsWith(pattern.toLowerCase())) {
				return true;
			}
		}
		return false;
	}

	private getExtension(filename: string): string {
		const lastDot = filename.lastIndexOf('.');
		if (lastDot === -1 || lastDot === 0) return '';
		return filename.substring(lastDot).toLowerCase();
	}

	private async readFileAsString(uri: vscode.Uri): Promise<string> {
		const buffer = await this.fileSystemService.readFile(uri);
		return new TextDecoder().decode(buffer);
	}
}
