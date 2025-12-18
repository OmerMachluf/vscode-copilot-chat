/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { createDecorator } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { FileType } from '../../../platform/filesystem/common/fileTypes';
import { URI } from '../../../util/vs/base/common/uri';
import { IAgentDiscoveryService, AgentInfo } from '../../orchestrator/agentDiscoveryService';
import {
	BusinessDomain,
	WorkspaceProfile,
	RecommendationContext,
	RecommendationResult,
	AgentRecommendation,
	UserPreferences
} from '../common/domainTypes';
import { AgentRecommendationEngine } from './agentRecommendationEngine';
import {
	CustomInstructionGenerator,
	GeneratedInstructions,
	InstructionGeneratorConfig
} from './customInstructionGenerator';

export const IAgentRecommendationService = createDecorator<IAgentRecommendationService>('agentRecommendationService');

/**
 * Service interface for agent recommendations
 */
export interface IAgentRecommendationService {
	readonly _serviceBrand: undefined;

	/**
	 * Analyze the current workspace and build a profile
	 */
	analyzeWorkspace(): Promise<WorkspaceProfile>;

	/**
	 * Get the cached workspace profile (or analyze if not cached)
	 */
	getWorkspaceProfile(): Promise<WorkspaceProfile>;

	/**
	 * Get agent recommendations for the current workspace
	 */
	getRecommendations(options?: RecommendationOptions): Promise<RecommendationResult>;

	/**
	 * Get recommendations for a specific task
	 */
	getRecommendationsForTask(task: string, options?: RecommendationOptions): Promise<RecommendationResult>;

	/**
	 * Get the best agent for a specific task
	 */
	getBestAgentForTask(task: string): Promise<AgentRecommendation | undefined>;

	/**
	 * Generate custom instructions for an agent
	 */
	generateInstructions(
		agent: AgentInfo,
		profile?: WorkspaceProfile
	): Promise<GeneratedInstructions>;

	/**
	 * Generate brief context for inline use
	 */
	generateBriefContext(taskContext?: string): Promise<string>;

	/**
	 * Clear cached analysis
	 */
	clearCache(): void;

	/**
	 * Set user preferences for recommendations
	 */
	setUserPreferences(preferences: UserPreferences): void;

	/**
	 * Get current user preferences
	 */
	getUserPreferences(): UserPreferences | undefined;
}

/**
 * Options for getting recommendations
 */
export interface RecommendationOptions {
	/** Override the inferred domain */
	domainOverride?: BusinessDomain;
	/** Files currently focused in the editor */
	focusedFiles?: string[];
	/** Previous agent selections for learning */
	previousSelections?: string[];
	/** Maximum number of recommendations to return */
	maxRecommendations?: number;
	/** Minimum score threshold (0-1) */
	minScore?: number;
}

/**
 * Implementation of the agent recommendation service
 */
export class AgentRecommendationService implements IAgentRecommendationService {
	declare readonly _serviceBrand: undefined;

	private readonly engine: AgentRecommendationEngine;
	private readonly instructionGenerator: CustomInstructionGenerator;

	private cachedProfile: WorkspaceProfile | undefined;
	private cacheTimestamp = 0;
	private readonly cacheTtlMs = 60000; // 1 minute cache

	private userPreferences: UserPreferences | undefined;

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IAgentDiscoveryService private readonly agentDiscoveryService: IAgentDiscoveryService
	) {
		this.engine = new AgentRecommendationEngine();
		this.instructionGenerator = new CustomInstructionGenerator();
	}

	async analyzeWorkspace(): Promise<WorkspaceProfile> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders?.length) {
			return this.getDefaultProfile();
		}

		const rootFolder = workspaceFolders[0];
		const fileList: string[] = [];
		const packageDependencies = new Map<string, string>();
		const fileContents = new Map<string, string>();

		// Collect files (limit depth for performance)
		await this.collectFiles(rootFolder.uri, fileList, 5);

		// Read package files for dependencies
		await this.collectDependencies(rootFolder.uri, packageDependencies, fileContents);

		// Analyze workspace
		const profile = await this.engine.analyzeWorkspace(
			fileList,
			packageDependencies,
			fileContents
		);

		// Cache the result
		this.cachedProfile = profile;
		this.cacheTimestamp = Date.now();

		return profile;
	}

	async getWorkspaceProfile(): Promise<WorkspaceProfile> {
		// Check cache
		const now = Date.now();
		if (this.cachedProfile && (now - this.cacheTimestamp) < this.cacheTtlMs) {
			return this.cachedProfile;
		}

		return this.analyzeWorkspace();
	}

	async getRecommendations(options?: RecommendationOptions): Promise<RecommendationResult> {
		const profile = await this.getWorkspaceProfile();
		const agents = await this.agentDiscoveryService.getAvailableAgents();

		// Apply domain override if specified
		const effectiveProfile = options?.domainOverride
			? { ...profile, domain: options.domainOverride }
			: profile;

		const context: RecommendationContext = {
			workspaceProfile: effectiveProfile,
			focusedFiles: options?.focusedFiles,
			previousSelections: options?.previousSelections,
			preferences: this.userPreferences
		};

		let result = this.engine.generateRecommendations(context, agents);

		// Apply filtering
		if (options?.minScore) {
			result = {
				...result,
				recommendations: result.recommendations.filter(r => r.score >= options.minScore!)
			};
		}

		if (options?.maxRecommendations) {
			result = {
				...result,
				recommendations: result.recommendations.slice(0, options.maxRecommendations)
			};
		}

		return result;
	}

	async getRecommendationsForTask(task: string, options?: RecommendationOptions): Promise<RecommendationResult> {
		const profile = await this.getWorkspaceProfile();
		const agents = await this.agentDiscoveryService.getAvailableAgents();

		// Apply domain override if specified
		const effectiveProfile = options?.domainOverride
			? { ...profile, domain: options.domainOverride }
			: profile;

		const context: RecommendationContext = {
			workspaceProfile: effectiveProfile,
			currentTask: task,
			focusedFiles: options?.focusedFiles,
			previousSelections: options?.previousSelections,
			preferences: this.userPreferences
		};

		let result = this.engine.generateRecommendations(context, agents);

		// Apply filtering
		if (options?.minScore) {
			result = {
				...result,
				recommendations: result.recommendations.filter(r => r.score >= options.minScore!)
			};
		}

		if (options?.maxRecommendations) {
			result = {
				...result,
				recommendations: result.recommendations.slice(0, options.maxRecommendations)
			};
		}

		return result;
	}

	async getBestAgentForTask(task: string): Promise<AgentRecommendation | undefined> {
		const result = await this.getRecommendationsForTask(task, {
			maxRecommendations: 1,
			minScore: 0.3
		});

		return result.recommendations[0];
	}

	async generateInstructions(
		agent: AgentInfo,
		profile?: WorkspaceProfile
	): Promise<GeneratedInstructions> {
		const effectiveProfile = profile ?? await this.getWorkspaceProfile();

		// Get recommendation for this agent to include use cases
		const recommendations = await this.getRecommendations();
		const agentRecommendation = recommendations.recommendations.find(r => r.agentId === agent.id);

		return this.instructionGenerator.generateInstructions(
			agent,
			effectiveProfile,
			agentRecommendation
		);
	}

	async generateBriefContext(taskContext?: string): Promise<string> {
		const profile = await this.getWorkspaceProfile();

		const parts: string[] = [];

		// Domain context
		if (profile.domain !== 'general') {
			parts.push(`[${profile.domain.toUpperCase()}]`);
		}

		// Key compliance
		if (profile.compliance.length > 0) {
			parts.push(`Compliance: ${profile.compliance.slice(0, 2).join(', ')}`);
		}

		// Primary tech
		if (profile.technologies.length > 0) {
			const topTech = profile.technologies.slice(0, 3).map(t => t.name);
			parts.push(`Stack: ${topTech.join(', ')}`);
		}

		// Task hint
		if (taskContext) {
			parts.push(`Task: ${taskContext}`);
		}

		return parts.join(' | ');
	}

	clearCache(): void {
		this.cachedProfile = undefined;
		this.cacheTimestamp = 0;
	}

	setUserPreferences(preferences: UserPreferences): void {
		this.userPreferences = preferences;
	}

	getUserPreferences(): UserPreferences | undefined {
		return this.userPreferences;
	}

	/**
	 * Collect files from workspace
	 */
	private async collectFiles(
		uri: URI,
		fileList: string[],
		maxDepth: number,
		currentDepth = 0
	): Promise<void> {
		if (currentDepth >= maxDepth) {
			return;
		}

		try {
			const entries = await this.fileSystemService.readDirectory(uri);

			for (const [name, type] of entries) {
				// Skip common non-essential directories
				if (this.shouldSkipDirectory(name)) {
					continue;
				}

				const entryUri = URI.joinPath(uri, name);

				if (type === FileType.File) {
					fileList.push(entryUri.fsPath);
				} else if (type === FileType.Directory) {
					await this.collectFiles(entryUri, fileList, maxDepth, currentDepth + 1);
				}
			}
		} catch {
			// Ignore errors reading directories
		}
	}

	/**
	 * Collect dependencies from package files
	 */
	private async collectDependencies(
		rootUri: URI,
		dependencies: Map<string, string>,
		fileContents: Map<string, string>
	): Promise<void> {
		// Try package.json
		await this.tryReadPackageJson(rootUri, dependencies, fileContents);

		// Try requirements.txt
		await this.tryReadRequirementsTxt(rootUri, dependencies, fileContents);

		// Try go.mod
		await this.tryReadGoMod(rootUri, dependencies, fileContents);

		// Try Gemfile
		await this.tryReadGemfile(rootUri, dependencies, fileContents);

		// Read a sample of source files for content analysis
		await this.readSampleFiles(rootUri, fileContents);
	}

	private async tryReadPackageJson(
		rootUri: URI,
		dependencies: Map<string, string>,
		fileContents: Map<string, string>
	): Promise<void> {
		try {
			const packageJsonUri = URI.joinPath(rootUri, 'package.json');
			const buffer = await this.fileSystemService.readFile(packageJsonUri);
			const content = new TextDecoder().decode(buffer);
			fileContents.set('package.json', content);

			const pkg = JSON.parse(content);
			const allDeps = {
				...pkg.dependencies,
				...pkg.devDependencies,
				...pkg.peerDependencies
			};

			for (const [name, version] of Object.entries(allDeps)) {
				dependencies.set(name, String(version));
			}
		} catch {
			// File doesn't exist or is invalid
		}
	}

	private async tryReadRequirementsTxt(
		rootUri: URI,
		dependencies: Map<string, string>,
		fileContents: Map<string, string>
	): Promise<void> {
		try {
			const requirementsUri = URI.joinPath(rootUri, 'requirements.txt');
			const buffer = await this.fileSystemService.readFile(requirementsUri);
			const content = new TextDecoder().decode(buffer);
			fileContents.set('requirements.txt', content);

			const lines = content.split('\n');
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed && !trimmed.startsWith('#')) {
					const match = trimmed.match(/^([a-zA-Z0-9_-]+)(?:[=<>!~]+(.+))?/);
					if (match) {
						dependencies.set(match[1], match[2] ?? 'latest');
					}
				}
			}
		} catch {
			// File doesn't exist
		}
	}

	private async tryReadGoMod(
		rootUri: URI,
		dependencies: Map<string, string>,
		fileContents: Map<string, string>
	): Promise<void> {
		try {
			const goModUri = URI.joinPath(rootUri, 'go.mod');
			const buffer = await this.fileSystemService.readFile(goModUri);
			const content = new TextDecoder().decode(buffer);
			fileContents.set('go.mod', content);

			const lines = content.split('\n');
			for (const line of lines) {
				const match = line.match(/^\s*require\s+([^\s]+)\s+([^\s]+)/);
				if (match) {
					dependencies.set(match[1], match[2]);
				}
			}
		} catch {
			// File doesn't exist
		}
	}

	private async tryReadGemfile(
		rootUri: URI,
		dependencies: Map<string, string>,
		fileContents: Map<string, string>
	): Promise<void> {
		try {
			const gemfileUri = URI.joinPath(rootUri, 'Gemfile');
			const buffer = await this.fileSystemService.readFile(gemfileUri);
			const content = new TextDecoder().decode(buffer);
			fileContents.set('Gemfile', content);

			const lines = content.split('\n');
			for (const line of lines) {
				const match = line.match(/gem\s+['"]([^'"]+)['"](?:,\s*['"]([^'"]+)['"])?/);
				if (match) {
					dependencies.set(match[1], match[2] ?? 'latest');
				}
			}
		} catch {
			// File doesn't exist
		}
	}

	private async readSampleFiles(
		rootUri: URI,
		fileContents: Map<string, string>
	): Promise<void> {
		// Read a few key config files for content analysis
		const configFiles = [
			'.env.example',
			'docker-compose.yml',
			'docker-compose.yaml',
			'Dockerfile',
			'serverless.yml',
			'terraform.tf',
			'main.tf'
		];

		for (const configFile of configFiles) {
			try {
				const fileUri = URI.joinPath(rootUri, configFile);
				const buffer = await this.fileSystemService.readFile(fileUri);
				const content = new TextDecoder().decode(buffer);
				fileContents.set(configFile, content.slice(0, 5000)); // Limit size
			} catch {
				// File doesn't exist
			}
		}
	}

	private shouldSkipDirectory(name: string): boolean {
		const skipDirs = [
			'node_modules',
			'.git',
			'dist',
			'build',
			'out',
			'coverage',
			'.next',
			'__pycache__',
			'.venv',
			'venv',
			'vendor',
			'.cache',
			'.nuxt',
			'.output'
		];
		return skipDirs.includes(name.toLowerCase());
	}

	private getDefaultProfile(): WorkspaceProfile {
		return {
			domain: 'general',
			domainConfidence: 0.5,
			technologies: [],
			patterns: [],
			compliance: [],
			characteristics: {
				size: 'small',
				complexity: 'low',
				hasTests: false,
				hasCICD: false,
				hasDocumentation: false,
				isMonorepo: false,
				hasContainerization: false
			},
			analyzedAt: Date.now()
		};
	}
}
