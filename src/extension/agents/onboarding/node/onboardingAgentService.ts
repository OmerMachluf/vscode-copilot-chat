/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { Disposable } from '../../../../util/vs/base/common/lifecycle';
import { ILogService } from '../../../../platform/log/common/logService';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import {
	IOnboardingAgentService,
	OnboardingOptions,
	OnboardingResult,
	RepositoryAnalysis,
	AgentRecommendation,
	GeneratedConfig,
	SetupInstruction,
	OnboardingMetadata,
	IRepositoryAnalyzerService,
	IArchitectureDocumentBuilderService,
	IAgentRecommendationEngineService
} from '../common/onboardingTypes';
import { RepositoryInvestigationEngine } from './repositoryInvestigationEngine';

/**
 * Main onboarding agent service that orchestrates the complete repository onboarding process.
 * This service coordinates repository analysis, documentation generation, and agent recommendations.
 */
export class OnboardingAgentService extends Disposable implements IOnboardingAgentService {
	readonly _serviceBrand: undefined;

	private readonly investigationEngine: RepositoryInvestigationEngine;

	constructor(
		@IRepositoryAnalyzerService private readonly repositoryAnalyzer: IRepositoryAnalyzerService,
		@IArchitectureDocumentBuilderService private readonly documentBuilder: IArchitectureDocumentBuilderService,
		@IAgentRecommendationEngineService private readonly recommendationEngine: IAgentRecommendationEngineService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		// Initialize the investigation engine with the repository analyzer
		this.investigationEngine = new RepositoryInvestigationEngine(
			undefined!, // Will be injected properly when subTaskManager is available
			repositoryAnalyzer,
			logService
		);
	}

	/**
	 * Perform comprehensive repository onboarding with the specified options.
	 */
	async onboardRepository(options: OnboardingOptions): Promise<OnboardingResult> {
		this.logService.info('[OnboardingAgentService] Starting repository onboarding', { options });

		const startTime = Date.now();

		try {
			// Step 1: Analyze the repository comprehensively
			const analysis = await this.analyzeRepository();

			// Step 2: Get agent recommendations
			const agentRecommendations = await this.getAgentRecommendations(analysis);

			// Step 3: Generate architecture documentation (if requested)
			let architectureDocument = '';
			if (options.generateDocs) {
				architectureDocument = await this.generateArchitectureDoc(analysis);
			}

			// Step 4: Generate custom configurations (if requested)
			const customConfigurations: GeneratedConfig[] = [];
			if (options.setupAgents || options.createCommands) {
				const configs = await this.generateConfigurations(agentRecommendations);
				customConfigurations.push(...configs);
			}

			// Step 5: Generate setup instructions
			const setupInstructions = this.generateSetupInstructions(options, analysis, agentRecommendations);

			// Step 6: Build metadata
			const metadata: OnboardingMetadata = {
				timestamp: Date.now(),
				version: '1.0.0',
				duration: Date.now() - startTime,
				options,
				generatedFiles: customConfigurations.map(c => c.filename),
				recommendations: agentRecommendations.length
			};

			const result: OnboardingResult = {
				architectureDocument,
				agentRecommendations,
				customConfigurations,
				setupInstructions,
				analysis,
				metadata
			};

			this.logService.info('[OnboardingAgentService] Repository onboarding completed', {
				duration: metadata.duration,
				recommendations: agentRecommendations.length,
				configurations: customConfigurations.length,
				docGenerated: !!architectureDocument
			});

			return result;
		} catch (error) {
			this.logService.error('[OnboardingAgentService] Repository onboarding failed', error);
			throw error;
		}
	}

	/**
	 * Analyze repository structure and patterns using the investigation engine.
	 */
	async analyzeRepository(): Promise<RepositoryAnalysis> {
		this.logService.info('[OnboardingAgentService] Analyzing repository');

		// Use the enhanced investigation engine for comprehensive analysis
		return this.investigationEngine.performComprehensiveAnalysis();
	}

	/**
	 * Generate architecture documentation from analysis results.
	 */
	async generateArchitectureDoc(analysis: RepositoryAnalysis): Promise<string> {
		this.logService.info('[OnboardingAgentService] Generating architecture documentation');

		return this.documentBuilder.generateArchitectureDoc(analysis);
	}

	/**
	 * Get agent recommendations based on analysis results.
	 */
	async getAgentRecommendations(analysis: RepositoryAnalysis): Promise<AgentRecommendation[]> {
		this.logService.info('[OnboardingAgentService] Getting agent recommendations');

		return this.recommendationEngine.recommendAgents(analysis);
	}

	/**
	 * Generate custom configurations and commands based on recommendations.
	 */
	async generateConfigurations(recommendations: AgentRecommendation[]): Promise<GeneratedConfig[]> {
		this.logService.info('[OnboardingAgentService] Generating custom configurations');

		const configurations: GeneratedConfig[] = [];

		for (const recommendation of recommendations) {
			// Generate agent configuration files
			if (recommendation.configuration) {
				const agentConfig: GeneratedConfig = {
					type: 'agent',
					filename: `${recommendation.agentType}.agent.md`,
					content: this.generateAgentConfigContent(recommendation),
					path: `.claude/agents/custom/${recommendation.agentType}.agent.md`
				};
				configurations.push(agentConfig);
			}

			// Generate custom instructions
			if (recommendation.customInstructions.length > 0) {
				const instructionConfig: GeneratedConfig = {
					type: 'instruction',
					filename: `${recommendation.agentType}.instructions.md`,
					content: this.generateInstructionContent(recommendation),
					path: `.claude/instructions/${recommendation.agentType}.instructions.md`
				};
				configurations.push(instructionConfig);
			}
		}

		// Generate workflow configurations
		const workflowConfig = this.generateWorkflowConfiguration(recommendations);
		if (workflowConfig) {
			configurations.push(workflowConfig);
		}

		return configurations;
	}

	/**
	 * Generate setup instructions for the onboarding process.
	 */
	private generateSetupInstructions(
		options: OnboardingOptions,
		analysis: RepositoryAnalysis,
		recommendations: AgentRecommendation[]
	): SetupInstruction[] {
		const instructions: SetupInstruction[] = [];

		// Step 1: Review analysis results
		instructions.push({
			step: 1,
			title: 'Review Repository Analysis',
			description: 'Review the generated architecture documentation and analysis results to understand the repository structure and technologies.',
			files: ['ARCHITECTURE.md'],
			optional: false
		});

		// Step 2: Install dependencies (if needed)
		if (analysis.structure.dependencies.totalDependencies > 0) {
			const packageManager = analysis.structure.dependencies.packageManager;
			instructions.push({
				step: 2,
				title: 'Install Dependencies',
				description: `Install project dependencies using ${packageManager}.`,
				commands: [
					packageManager === 'npm' ? 'npm install' :
						packageManager === 'yarn' ? 'yarn install' :
							packageManager === 'pnpm' ? 'pnpm install' :
								'# Install dependencies using your package manager'
				],
				optional: false
			});
		}

		// Step 3: Set up agents (if requested)
		if (options.setupAgents && recommendations.length > 0) {
			instructions.push({
				step: 3,
				title: 'Configure Custom Agents',
				description: 'Review and customize the generated agent configurations to fit your specific needs.',
				files: recommendations.map(r => `.claude/agents/custom/${r.agentType}.agent.md`),
				optional: false
			});
		}

		// Step 4: Create custom commands (if requested)
		if (options.createCommands) {
			instructions.push({
				step: 4,
				title: 'Set Up Custom Commands',
				description: 'Review and activate the generated custom commands for your workflow.',
				files: ['.claude/commands/workflow.md'],
				optional: false
			});
		}

		// Step 5: Test the setup
		instructions.push({
			step: instructions.length + 1,
			title: 'Test the Setup',
			description: 'Test the onboarding setup by running a simple agent task or command.',
			commands: ['# Test your setup with a simple task'],
			optional: false
		});

		// Step 6: Iterate and improve
		instructions.push({
			step: instructions.length + 1,
			title: 'Iterate and Improve',
			description: 'Based on your experience, iterate on the agent configurations and instructions to improve the onboarding experience.',
			optional: true
		});

		return instructions;
	}

	/**
	 * Generate agent configuration content for a recommendation.
	 */
	private generateAgentConfigContent(recommendation: AgentRecommendation): string {
		const content: string[] = [];

		content.push(`# ${recommendation.agentType} Agent Configuration`);
		content.push('');
		content.push(`**Purpose:** ${recommendation.purpose}`);
		content.push(`**Priority:** ${recommendation.priority}`);
		content.push('');

		content.push('## Configuration');
		content.push('');
		content.push('```yaml');
		content.push(`name: ${recommendation.configuration.name}`);
		content.push(`description: ${recommendation.configuration.description}`);

		if (recommendation.configuration.model) {
			content.push(`model: ${recommendation.configuration.model}`);
		}

		if (recommendation.configuration.temperature) {
			content.push(`temperature: ${recommendation.configuration.temperature}`);
		}

		if (recommendation.configuration.tools.length > 0) {
			content.push('tools:');
			for (const tool of recommendation.configuration.tools) {
				content.push(`  - ${tool}`);
			}
		}
		content.push('```');
		content.push('');

		// Custom instructions
		if (recommendation.customInstructions.length > 0) {
			content.push('## Custom Instructions');
			content.push('');
			for (const instruction of recommendation.customInstructions) {
				content.push(`- ${instruction}`);
			}
			content.push('');
		}

		// Suggested skills
		if (recommendation.suggestedSkills.length > 0) {
			content.push('## Suggested Skills');
			content.push('');
			for (const skill of recommendation.suggestedSkills) {
				content.push(`- ${skill}`);
			}
			content.push('');
		}

		content.push('## Reasoning');
		content.push('');
		content.push(recommendation.reasoning);

		return content.join('\n');
	}

	/**
	 * Generate instruction content for a recommendation.
	 */
	private generateInstructionContent(recommendation: AgentRecommendation): string {
		const content: string[] = [];

		content.push(`# ${recommendation.agentType} Instructions`);
		content.push('');
		content.push(`These are specialized instructions for the ${recommendation.agentType} agent.`);
		content.push('');

		content.push('## Custom Instructions');
		content.push('');
		for (const instruction of recommendation.customInstructions) {
			content.push(`- ${instruction}`);
		}

		return content.join('\n');
	}

	/**
	 * Generate workflow configuration based on recommendations.
	 */
	private generateWorkflowConfiguration(recommendations: AgentRecommendation[]): GeneratedConfig | null {
		if (recommendations.length === 0) {
			return null;
		}

		const content: string[] = [];

		content.push('# Repository Workflow Commands');
		content.push('');
		content.push('Custom workflow commands generated based on repository analysis.');
		content.push('');

		content.push('## Available Agents');
		content.push('');

		for (const recommendation of recommendations.slice(0, 5)) { // Limit to top 5 recommendations
			content.push(`### ${recommendation.agentType}`);
			content.push('');
			content.push(`**Purpose:** ${recommendation.purpose}`);
			content.push(`**Priority:** ${recommendation.priority}`);
			content.push('');
			content.push(`Usage: \`/${recommendation.agentType} [your request]\``);
			content.push('');
		}

		return {
			type: 'workflow',
			filename: 'workflow.md',
			content: content.join('\n'),
			path: '.claude/commands/workflow.md'
		};
	}
}