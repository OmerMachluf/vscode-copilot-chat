/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createDecorator } from '../../util/vs/platform/instantiation/common/instantiation';
import { CancellationToken } from '../../util/vs/base/common/cancellation';

// ============================================================================
// Repository Analysis Interfaces
// ============================================================================

export interface IRepositoryMetadata {
	readonly name: string;
	readonly description?: string;
	readonly type: 'library' | 'application' | 'extension' | 'package' | 'unknown';
	readonly language: string;
	readonly framework?: string;
	readonly version?: string;
	readonly license?: string;
	readonly dependencies: Record<string, string>;
	readonly devDependencies: Record<string, string>;
	readonly scripts: Record<string, string>;
	readonly entryPoints: string[];
	readonly configFiles: string[];
	readonly testFiles: string[];
	readonly documentationFiles: string[];
}

export interface ICodebasePattern {
	readonly type: 'architecture' | 'design' | 'convention' | 'antipattern';
	readonly name: string;
	readonly description: string;
	readonly files: string[];
	readonly confidence: number;
	readonly examples: string[];
}

export interface IProjectStructure {
	readonly rootPath: string;
	readonly sourceDirectories: string[];
	readonly testDirectories: string[];
	readonly configDirectories: string[];
	readonly buildDirectories: string[];
	readonly documentationDirectories: string[];
	readonly totalFiles: number;
	readonly totalLines: number;
	readonly fileTypes: Record<string, number>;
	readonly largestFiles: Array<{ path: string; lines: number; size: number }>;
}

export interface IArchitectureInsight {
	readonly category: 'structure' | 'patterns' | 'dependencies' | 'quality' | 'complexity';
	readonly title: string;
	readonly description: string;
	readonly severity: 'info' | 'warning' | 'error';
	readonly files?: string[];
	readonly suggestions?: string[];
}

export interface IRepositoryAnalysis {
	readonly metadata: IRepositoryMetadata;
	readonly structure: IProjectStructure;
	readonly patterns: ICodebasePattern[];
	readonly insights: IArchitectureInsight[];
	readonly timestamp: number;
}

export interface IRepositoryAnalysisOptions {
	readonly includeTests?: boolean;
	readonly includeDependencies?: boolean;
	readonly includePatterns?: boolean;
	readonly maxFiles?: number;
	readonly excludePatterns?: string[];
	readonly focusAreas?: Array<'structure' | 'patterns' | 'dependencies' | 'quality'>;
}

// ============================================================================
// Repository Analysis Service Interface
// ============================================================================

export const IRepositoryAnalysisService = createDecorator<IRepositoryAnalysisService>('repositoryAnalysisService');

export interface IRepositoryAnalysisService {
	readonly _serviceBrand: undefined;

	/**
	 * Analyzes a repository and returns comprehensive analysis results.
	 */
	analyzeRepository(
		workspacePath: string,
		options?: IRepositoryAnalysisOptions,
		token?: CancellationToken
	): Promise<IRepositoryAnalysis>;

	/**
	 * Extracts project metadata from package.json, composer.json, etc.
	 */
	extractProjectMetadata(workspacePath: string, token?: CancellationToken): Promise<IRepositoryMetadata>;

	/**
	 * Analyzes project structure and organization.
	 */
	analyzeProjectStructure(workspacePath: string, token?: CancellationToken): Promise<IProjectStructure>;

	/**
	 * Detects common patterns and architectural decisions.
	 */
	detectCodebasePatterns(workspacePath: string, token?: CancellationToken): Promise<ICodebasePattern[]>;

	/**
	 * Generates insights about the codebase architecture and quality.
	 */
	generateArchitectureInsights(analysis: IRepositoryAnalysis, token?: CancellationToken): Promise<IArchitectureInsight[]>;
}

// ============================================================================
// Repository Analysis Service Implementation
// ============================================================================

export class RepositoryAnalysisService implements IRepositoryAnalysisService {
	readonly _serviceBrand: undefined;

	constructor() {
		// Service initialization
	}

	async analyzeRepository(
		workspacePath: string,
		options: IRepositoryAnalysisOptions = {},
		token?: CancellationToken
	): Promise<IRepositoryAnalysis> {
		token?.throwIfCancellationRequested();

		// Perform comprehensive repository analysis
		const [metadata, structure, patterns] = await Promise.all([
			this.extractProjectMetadata(workspacePath, token),
			this.analyzeProjectStructure(workspacePath, token),
			options.includePatterns !== false
				? this.detectCodebasePatterns(workspacePath, token)
				: Promise.resolve([])
		]);

		const analysis: IRepositoryAnalysis = {
			metadata,
			structure,
			patterns,
			insights: [], // Will be populated by generateArchitectureInsights
			timestamp: Date.now()
		};

		// Generate insights based on the analysis
		const insights = await this.generateArchitectureInsights(analysis, token);

		return {
			...analysis,
			insights
		};
	}

	async extractProjectMetadata(workspacePath: string, token?: CancellationToken): Promise<IRepositoryMetadata> {
		token?.throwIfCancellationRequested();

		// Try to find and parse package.json
		const packageJsonPath = path.join(workspacePath, 'package.json');
		let packageData: any = {};

		try {
			const packageContent = await fs.readFile(packageJsonPath, 'utf-8');
			packageData = JSON.parse(packageContent);
		} catch {
			// package.json not found or invalid, will use defaults
		}

		// Determine project type based on package.json and file structure
		const projectType = await this._determineProjectType(workspacePath, packageData);

		// Extract entry points
		const entryPoints = await this._findEntryPoints(workspacePath, packageData);

		// Find configuration files
		const configFiles = await this._findConfigurationFiles(workspacePath);

		// Find test files
		const testFiles = await this._findTestFiles(workspacePath);

		// Find documentation files
		const documentationFiles = await this._findDocumentationFiles(workspacePath);

		return {
			name: packageData.name || path.basename(workspacePath),
			description: packageData.description,
			type: projectType,
			language: await this._detectPrimaryLanguage(workspacePath),
			framework: await this._detectFramework(workspacePath, packageData),
			version: packageData.version,
			license: packageData.license,
			dependencies: packageData.dependencies || {},
			devDependencies: packageData.devDependencies || {},
			scripts: packageData.scripts || {},
			entryPoints,
			configFiles,
			testFiles,
			documentationFiles
		};
	}

	async analyzeProjectStructure(workspacePath: string, token?: CancellationToken): Promise<IProjectStructure> {
		token?.throwIfCancellationRequested();

		const structure = await this._analyzeDirectoryStructure(workspacePath, token);
		const fileAnalysis = await this._analyzeFiles(workspacePath, token);

		return {
			rootPath: workspacePath,
			sourceDirectories: structure.sourceDirectories,
			testDirectories: structure.testDirectories,
			configDirectories: structure.configDirectories,
			buildDirectories: structure.buildDirectories,
			documentationDirectories: structure.documentationDirectories,
			totalFiles: fileAnalysis.totalFiles,
			totalLines: fileAnalysis.totalLines,
			fileTypes: fileAnalysis.fileTypes,
			largestFiles: fileAnalysis.largestFiles
		};
	}

	async detectCodebasePatterns(workspacePath: string, token?: CancellationToken): Promise<ICodebasePattern[]> {
		token?.throwIfCancellationRequested();

		const patterns: ICodebasePattern[] = [];

		// Detect common architectural patterns
		patterns.push(...await this._detectArchitecturalPatterns(workspacePath, token));

		// Detect design patterns
		patterns.push(...await this._detectDesignPatterns(workspacePath, token));

		// Detect naming conventions
		patterns.push(...await this._detectNamingConventions(workspacePath, token));

		// Detect potential antipatterns
		patterns.push(...await this._detectAntiPatterns(workspacePath, token));

		return patterns;
	}

	async generateArchitectureInsights(analysis: IRepositoryAnalysis, token?: CancellationToken): Promise<IArchitectureInsight[]> {
		token?.throwIfCancellationRequested();

		const insights: IArchitectureInsight[] = [];

		// Structure insights
		insights.push(...this._generateStructureInsights(analysis.structure));

		// Pattern insights
		insights.push(...this._generatePatternInsights(analysis.patterns));

		// Dependency insights
		insights.push(...this._generateDependencyInsights(analysis.metadata));

		// Quality insights
		insights.push(...this._generateQualityInsights(analysis));

		return insights;
	}

	// ============================================================================
	// Private Helper Methods
	// ============================================================================

	private async _determineProjectType(workspacePath: string, packageData: any): Promise<IRepositoryMetadata['type']> {
		// VS Code extension
		if (packageData.engines?.vscode || packageData.contributes) {
			return 'extension';
		}

		// Library if it has a main entry point but no start script
		if (packageData.main && !packageData.scripts?.start) {
			return 'library';
		}

		// Application if it has start script or is executable
		if (packageData.scripts?.start || packageData.bin) {
			return 'application';
		}

		// Package if published to npm
		if (packageData.name && packageData.version && !packageData.private) {
			return 'package';
		}

		return 'unknown';
	}

	private async _detectPrimaryLanguage(workspacePath: string): Promise<string> {
		const fileExtensions: Record<string, number> = {};

		try {
			const files = await this._getAllFiles(workspacePath);

			for (const file of files) {
				const ext = path.extname(file).toLowerCase();
				if (ext) {
					fileExtensions[ext] = (fileExtensions[ext] || 0) + 1;
				}
			}
		} catch {
			// If we can't read files, default to TypeScript since this is a VS Code extension
			return 'typescript';
		}

		// Find the most common extension
		const mostCommon = Object.entries(fileExtensions)
			.sort(([, a], [, b]) => b - a)[0];

		if (!mostCommon) {
			return 'unknown';
		}

		const languageMap: Record<string, string> = {
			'.ts': 'typescript',
			'.js': 'javascript',
			'.tsx': 'typescript',
			'.jsx': 'javascript',
			'.py': 'python',
			'.java': 'java',
			'.cs': 'csharp',
			'.cpp': 'cpp',
			'.c': 'c',
			'.php': 'php',
			'.rb': 'ruby',
			'.go': 'go',
			'.rs': 'rust',
			'.swift': 'swift',
			'.kt': 'kotlin'
		};

		return languageMap[mostCommon[0]] || 'unknown';
	}

	private async _detectFramework(workspacePath: string, packageData: any): Promise<string | undefined> {
		const dependencies = { ...packageData.dependencies, ...packageData.devDependencies };

		// React
		if (dependencies.react) return 'React';

		// Angular
		if (dependencies['@angular/core']) return 'Angular';

		// Vue
		if (dependencies.vue) return 'Vue';

		// Express
		if (dependencies.express) return 'Express';

		// Next.js
		if (dependencies.next) return 'Next.js';

		// Electron
		if (dependencies.electron) return 'Electron';

		// VS Code Extension
		if (dependencies.vscode || packageData.engines?.vscode) return 'VS Code Extension';

		return undefined;
	}

	private async _getAllFiles(dirPath: string): Promise<string[]> {
		const files: string[] = [];

		try {
			const entries = await fs.readdir(dirPath, { withFileTypes: true });

			for (const entry of entries) {
				const fullPath = path.join(dirPath, entry.name);

				if (entry.isDirectory() && !this._shouldSkipDirectory(entry.name)) {
					files.push(...await this._getAllFiles(fullPath));
				} else if (entry.isFile()) {
					files.push(fullPath);
				}
			}
		} catch {
			// Directory not accessible
		}

		return files;
	}

	private _shouldSkipDirectory(dirname: string): boolean {
		const skipDirs = [
			'node_modules', '.git', '.vscode', 'dist', 'build', 'out',
			'coverage', '.nyc_output', 'logs', 'tmp', 'temp'
		];
		return skipDirs.includes(dirname) || dirname.startsWith('.');
	}

	private async _findEntryPoints(workspacePath: string, packageData: any): Promise<string[]> {
		const entryPoints: string[] = [];

		// From package.json
		if (packageData.main) entryPoints.push(packageData.main);
		if (packageData.module) entryPoints.push(packageData.module);
		if (packageData.types) entryPoints.push(packageData.types);

		// Common entry point files
		const commonEntries = [
			'index.js', 'index.ts', 'main.js', 'main.ts',
			'app.js', 'app.ts', 'src/index.js', 'src/index.ts',
			'src/main.js', 'src/main.ts', 'extension.js', 'extension.ts'
		];

		for (const entry of commonEntries) {
			const fullPath = path.join(workspacePath, entry);
			try {
				await fs.access(fullPath);
				if (!entryPoints.includes(entry)) {
					entryPoints.push(entry);
				}
			} catch {
				// File doesn't exist
			}
		}

		return entryPoints;
	}

	private async _findConfigurationFiles(workspacePath: string): Promise<string[]> {
		const configFiles: string[] = [];
		const configPatterns = [
			'tsconfig.json', 'jsconfig.json', 'package.json', 'webpack.config.js',
			'rollup.config.js', 'vite.config.js', 'jest.config.js', 'babel.config.js',
			'eslint.config.js', '.eslintrc.*', 'prettier.config.js', '.prettierrc.*',
			'docker-compose.yml', 'Dockerfile', '.env.*', 'README.md', 'LICENSE'
		];

		for (const pattern of configPatterns) {
			if (pattern.includes('*')) {
				// Handle glob patterns
				const files = await this._findFilesByPattern(workspacePath, pattern);
				configFiles.push(...files);
			} else {
				const fullPath = path.join(workspacePath, pattern);
				try {
					await fs.access(fullPath);
					configFiles.push(pattern);
				} catch {
					// File doesn't exist
				}
			}
		}

		return configFiles;
	}

	private async _findTestFiles(workspacePath: string): Promise<string[]> {
		const testFiles: string[] = [];
		const allFiles = await this._getAllFiles(workspacePath);

		for (const file of allFiles) {
			const basename = path.basename(file);
			if (
				basename.includes('.test.') ||
				basename.includes('.spec.') ||
				basename.endsWith('.test.ts') ||
				basename.endsWith('.spec.ts') ||
				basename.endsWith('.test.js') ||
				basename.endsWith('.spec.js') ||
				file.includes('/test/') ||
				file.includes('/tests/') ||
				file.includes('/__tests__/')
			) {
				testFiles.push(path.relative(workspacePath, file));
			}
		}

		return testFiles;
	}

	private async _findDocumentationFiles(workspacePath: string): Promise<string[]> {
		const docFiles: string[] = [];
		const allFiles = await this._getAllFiles(workspacePath);

		for (const file of allFiles) {
			const basename = path.basename(file).toLowerCase();
			const relativePath = path.relative(workspacePath, file);

			if (
				basename.startsWith('readme') ||
				basename.startsWith('changelog') ||
				basename.startsWith('contributing') ||
				basename.startsWith('license') ||
				basename.startsWith('authors') ||
				basename.endsWith('.md') && relativePath.includes('/docs/') ||
				relativePath.includes('/documentation/')
			) {
				docFiles.push(relativePath);
			}
		}

		return docFiles;
	}

	private async _findFilesByPattern(workspacePath: string, pattern: string): Promise<string[]> {
		// Simple glob pattern matching for config files
		const files: string[] = [];
		const baseName = pattern.replace('.*', '');

		try {
			const entries = await fs.readdir(workspacePath);
			for (const entry of entries) {
				if (entry.startsWith(baseName)) {
					files.push(entry);
				}
			}
		} catch {
			// Directory not accessible
		}

		return files;
	}

	private async _analyzeDirectoryStructure(workspacePath: string, token?: CancellationToken): Promise<{
		sourceDirectories: string[];
		testDirectories: string[];
		configDirectories: string[];
		buildDirectories: string[];
		documentationDirectories: string[];
	}> {
		const sourceDirectories: string[] = [];
		const testDirectories: string[] = [];
		const configDirectories: string[] = [];
		const buildDirectories: string[] = [];
		const documentationDirectories: string[] = [];

		try {
			const entries = await fs.readdir(workspacePath, { withFileTypes: true });

			for (const entry of entries) {
				if (!entry.isDirectory()) continue;

				token?.throwIfCancellationRequested();

				const dirName = entry.name.toLowerCase();

				if (this._isSourceDirectory(dirName)) {
					sourceDirectories.push(entry.name);
				} else if (this._isTestDirectory(dirName)) {
					testDirectories.push(entry.name);
				} else if (this._isConfigDirectory(dirName)) {
					configDirectories.push(entry.name);
				} else if (this._isBuildDirectory(dirName)) {
					buildDirectories.push(entry.name);
				} else if (this._isDocumentationDirectory(dirName)) {
					documentationDirectories.push(entry.name);
				}
			}
		} catch {
			// Directory not accessible
		}

		return {
			sourceDirectories,
			testDirectories,
			configDirectories,
			buildDirectories,
			documentationDirectories
		};
	}

	private _isSourceDirectory(dirName: string): boolean {
		return ['src', 'source', 'lib', 'app', 'components', 'modules', 'packages'].includes(dirName);
	}

	private _isTestDirectory(dirName: string): boolean {
		return ['test', 'tests', '__tests__', 'spec', 'specs'].includes(dirName);
	}

	private _isConfigDirectory(dirName: string): boolean {
		return ['config', 'configuration', '.vscode', '.github', 'scripts'].includes(dirName);
	}

	private _isBuildDirectory(dirName: string): boolean {
		return ['dist', 'build', 'out', 'target', 'bin', 'release'].includes(dirName);
	}

	private _isDocumentationDirectory(dirName: string): boolean {
		return ['docs', 'documentation', 'wiki', 'guides'].includes(dirName);
	}

	private async _analyzeFiles(workspacePath: string, token?: CancellationToken): Promise<{
		totalFiles: number;
		totalLines: number;
		fileTypes: Record<string, number>;
		largestFiles: Array<{ path: string; lines: number; size: number }>;
	}> {
		const allFiles = await this._getAllFiles(workspacePath);
		const fileTypes: Record<string, number> = {};
		const fileSizes: Array<{ path: string; lines: number; size: number }> = [];
		let totalLines = 0;

		for (const file of allFiles) {
			token?.throwIfCancellationRequested();

			const ext = path.extname(file).toLowerCase();
			if (ext) {
				fileTypes[ext] = (fileTypes[ext] || 0) + 1;
			}

			try {
				const stats = await fs.stat(file);
				let lines = 0;

				// Count lines for text files only
				if (this._isTextFile(ext)) {
					const content = await fs.readFile(file, 'utf-8');
					lines = content.split('\n').length;
					totalLines += lines;
				}

				fileSizes.push({
					path: path.relative(workspacePath, file),
					lines,
					size: stats.size
				});
			} catch {
				// File not accessible
			}
		}

		// Sort by lines descending and take top 10
		const largestFiles = fileSizes
			.sort((a, b) => b.lines - a.lines)
			.slice(0, 10);

		return {
			totalFiles: allFiles.length,
			totalLines,
			fileTypes,
			largestFiles
		};
	}

	private _isTextFile(extension: string): boolean {
		const textExtensions = [
			'.ts', '.js', '.tsx', '.jsx', '.py', '.java', '.cs', '.cpp', '.c',
			'.php', '.rb', '.go', '.rs', '.swift', '.kt', '.html', '.css', '.scss',
			'.less', '.md', '.txt', '.json', '.xml', '.yml', '.yaml', '.toml', '.ini'
		];
		return textExtensions.includes(extension);
	}

	private async _detectArchitecturalPatterns(workspacePath: string, token?: CancellationToken): Promise<ICodebasePattern[]> {
		const patterns: ICodebasePattern[] = [];
		const allFiles = await this._getAllFiles(workspacePath);

		// Detect MVC Pattern
		const mvcPattern = await this._detectMVCPattern(allFiles, workspacePath);
		if (mvcPattern) patterns.push(mvcPattern);

		// Detect Microservices Pattern
		const microservicesPattern = await this._detectMicroservicesPattern(allFiles, workspacePath);
		if (microservicesPattern) patterns.push(microservicesPattern);

		// Detect Plugin/Extension Architecture
		const pluginPattern = await this._detectPluginArchitecture(allFiles, workspacePath);
		if (pluginPattern) patterns.push(pluginPattern);

		// Detect Layered Architecture
		const layeredPattern = await this._detectLayeredArchitecture(allFiles, workspacePath);
		if (layeredPattern) patterns.push(layeredPattern);

		// Detect Component-Based Architecture
		const componentPattern = await this._detectComponentArchitecture(allFiles, workspacePath);
		if (componentPattern) patterns.push(componentPattern);

		return patterns;
	}

	private async _detectDesignPatterns(workspacePath: string, token?: CancellationToken): Promise<ICodebasePattern[]> {
		const patterns: ICodebasePattern[] = [];
		// Implementation for detecting design patterns like Singleton, Factory, Observer, etc.
		// This would analyze code content and structure
		return patterns;
	}

	private async _detectNamingConventions(workspacePath: string, token?: CancellationToken): Promise<ICodebasePattern[]> {
		const patterns: ICodebasePattern[] = [];
		// Implementation for detecting naming conventions like camelCase, PascalCase, etc.
		return patterns;
	}

	private async _detectAntiPatterns(workspacePath: string, token?: CancellationToken): Promise<ICodebasePattern[]> {
		const patterns: ICodebasePattern[] = [];
		// Implementation for detecting anti-patterns and code smells
		return patterns;
	}

	private _generateStructureInsights(structure: IProjectStructure): IArchitectureInsight[] {
		const insights: IArchitectureInsight[] = [];

		// Check for proper source organization
		if (structure.sourceDirectories.length === 0) {
			insights.push({
				category: 'structure',
				title: 'No source directories found',
				description: 'Consider organizing source code in dedicated directories like src/, lib/, or app/',
				severity: 'warning'
			});
		}

		// Check for test organization
		if (structure.testDirectories.length === 0) {
			insights.push({
				category: 'structure',
				title: 'No test directories found',
				description: 'Consider adding test directories and implementing automated testing',
				severity: 'info'
			});
		}

		// Check for large files
		const largeFiles = structure.largestFiles.filter(f => f.lines > 1000);
		if (largeFiles.length > 0) {
			insights.push({
				category: 'quality',
				title: 'Large files detected',
				description: `Found ${largeFiles.length} files with more than 1000 lines. Consider breaking them down.`,
				severity: 'warning',
				files: largeFiles.map(f => f.path),
				suggestions: ['Break down large files into smaller modules', 'Extract reusable components']
			});
		}

		return insights;
	}

	private _generatePatternInsights(patterns: ICodebasePattern[]): IArchitectureInsight[] {
		const insights: IArchitectureInsight[] = [];

		const antiPatterns = patterns.filter(p => p.type === 'antipattern');
		if (antiPatterns.length > 0) {
			insights.push({
				category: 'quality',
				title: 'Anti-patterns detected',
				description: `Found ${antiPatterns.length} potential anti-patterns that may affect code quality`,
				severity: 'warning',
				suggestions: antiPatterns.map(p => `Address ${p.name}: ${p.description}`)
			});
		}

		return insights;
	}

	private _generateDependencyInsights(metadata: IRepositoryMetadata): IArchitectureInsight[] {
		const insights: IArchitectureInsight[] = [];

		const totalDeps = Object.keys(metadata.dependencies).length;
		const totalDevDeps = Object.keys(metadata.devDependencies).length;

		if (totalDeps > 50) {
			insights.push({
				category: 'dependencies',
				title: 'High number of dependencies',
				description: `Project has ${totalDeps} production dependencies. Consider reviewing if all are necessary.`,
				severity: 'warning',
				suggestions: ['Audit dependencies for unused packages', 'Consider bundling or tree-shaking']
			});
		}

		if (totalDevDeps > 100) {
			insights.push({
				category: 'dependencies',
				title: 'High number of dev dependencies',
				description: `Project has ${totalDevDeps} development dependencies. Consider cleanup.`,
				severity: 'info'
			});
		}

		return insights;
	}

	private _generateQualityInsights(analysis: IRepositoryAnalysis): IArchitectureInsight[] {
		const insights: IArchitectureInsight[] = [];

		// Calculate basic metrics
		const avgLinesPerFile = analysis.structure.totalLines / analysis.structure.totalFiles;

		if (avgLinesPerFile > 500) {
			insights.push({
				category: 'quality',
				title: 'High average lines per file',
				description: `Average of ${Math.round(avgLinesPerFile)} lines per file suggests files may be too large`,
				severity: 'info',
				suggestions: ['Consider breaking down large files', 'Extract common functionality']
			});
		}

		return insights;
	}
}