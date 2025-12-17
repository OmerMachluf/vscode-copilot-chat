/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, beforeEach, it, expect, vi } from 'vitest';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { MockLogService } from '../../../../platform/log/test/mockLogService';
import { OnboardingAgentService } from '../node/onboardingAgentService';
import {
	IRepositoryAnalyzerService,
	IArchitectureDocumentBuilderService,
	IAgentRecommendationEngineService,
	OnboardingOptions,
	RepositoryAnalysis,
	AgentRecommendation,
	OnboardingResult
} from '../common/onboardingTypes';

class MockRepositoryAnalyzerService implements IRepositoryAnalyzerService {
	readonly _serviceBrand: undefined;

	async analyzeRepository(): Promise<RepositoryAnalysis> {
		return {
			structure: {
				directories: [
					{ name: 'src', type: 'source', purposes: ['application'], fileCount: 50 }
				],
				fileTypes: {
					languages: [
						{ language: 'TypeScript', fileCount: 40, percentage: 80, extensions: ['.ts'] }
					]
				},
				dependencies: {
					packageManager: 'npm',
					totalDependencies: 25,
					dependencies: ['express'],
					devDependencies: ['jest']
				},
				buildSystem: {
					scripts: [
						{ name: 'build', command: 'npm run build', type: 'build' }
					]
				},
				testStructure: {
					hasTests: true,
					testFrameworks: ['jest'],
					testDirectories: ['tests'],
					coverageConfigured: true,
					testTypes: ['unit']
				}
			},
			technologies: {
				primaryLanguages: ['TypeScript'],
				frameworks: [
					{ name: 'Express', category: 'backend', confidence: 0.8, version: '4.18.0' }
				],
				databases: [],
				deployment: {
					platforms: [],
					containerized: false,
					serverless: false
				},
				cicd: {
					providers: [],
					stages: []
				}
			},
			domain: {
				domain: 'web-application',
				scale: 'medium',
				confidence: 0.7,
				keywords: ['web', 'api'],
				compliance: {
					regulations: [],
					securityRequirements: [],
					dataPrivacy: false,
					auditTrails: false
				}
			},
			patterns: {
				architecturalPatterns: [],
				designPatterns: [],
				namingConventions: [],
				codeStyle: {
					indentation: 'spaces',
					lineEndings: 'LF',
					quoteStyle: 'single',
					semicolons: true
				}
			},
			metadata: {
				timestamp: Date.now(),
				version: '1.0.0',
				confidence: 0.7,
				analysisTimeMs: 300,
				sources: ['package.json', 'src/']
			}
		} as RepositoryAnalysis;
	}
}

class MockArchitectureDocumentBuilder implements IArchitectureDocumentBuilderService {
	readonly _serviceBrand: undefined;

	async generateArchitectureDoc(analysis: RepositoryAnalysis): Promise<string> {
		return `# Architecture Documentation\n\nProject: ${analysis.domain.domain}\nLanguages: ${analysis.technologies.primaryLanguages.join(', ')}\n`;
	}

	generateSystemOverview(structure: any): string {
		return '# System Overview\nRepository structure overview.';
	}

	generateComponentDiagrams(components: any[]): string {
		return '# Component Diagrams\nComponent architecture diagrams.';
	}

	generateDataFlowDiagrams(flows: any[]): string {
		return '# Data Flow Diagrams\nData flow architecture.';
	}
}

class MockAgentRecommendationEngine implements IAgentRecommendationEngineService {
	readonly _serviceBrand: undefined;

	async recommendAgents(analysis: RepositoryAnalysis): Promise<AgentRecommendation[]> {
		return [
			{
				agentType: 'code-reviewer',
				purpose: 'Review code changes for quality and best practices',
				priority: 'high',
				reasoning: 'Code review is essential for maintaining quality.',
				suggestedSkills: ['static-analysis', 'security-review'],
				customInstructions: [
					'Focus on maintainability and readability',
					'Check for security vulnerabilities'
				],
				configuration: {
					name: 'Code Reviewer',
					description: 'Reviews code changes',
					tools: ['Read', 'Grep', 'Glob'],
					temperature: 0.3
				}
			},
			{
				agentType: 'test-specialist',
				purpose: 'Test development and quality assurance',
				priority: 'medium',
				reasoning: 'Existing tests indicate commitment to quality.',
				suggestedSkills: ['unit-testing', 'test-coverage'],
				customInstructions: [
					'Maintain and improve test coverage',
					'Write meaningful tests'
				],
				configuration: {
					name: 'Test Specialist',
					description: 'Testing specialist',
					tools: ['Read', 'Write', 'Bash'],
					temperature: 0.3
				}
			}
		];
	}
}

describe('OnboardingAgentService', () => {
	let store: DisposableStore;
	let logService: MockLogService;
	let mockRepositoryAnalyzer: MockRepositoryAnalyzerService;
	let mockDocumentBuilder: MockArchitectureDocumentBuilder;
	let mockRecommendationEngine: MockAgentRecommendationEngine;
	let onboardingService: OnboardingAgentService;

	beforeEach(() => {
		store = new DisposableStore();
		logService = new MockLogService();
		mockRepositoryAnalyzer = new MockRepositoryAnalyzerService();
		mockDocumentBuilder = new MockArchitectureDocumentBuilder();
		mockRecommendationEngine = new MockAgentRecommendationEngine();

		onboardingService = store.add(new OnboardingAgentService(
			mockRepositoryAnalyzer,
			mockDocumentBuilder,
			mockRecommendationEngine,
			logService
		));
	});

	afterEach(() => {
		store.dispose();
	});

	describe('onboardRepository', () => {
		it('should perform complete onboarding with all options enabled', async () => {
			const options: OnboardingOptions = {
				generateDocs: true,
				setupAgents: true,
				createCommands: true,
				analyzeComponents: true,
				mapDataFlows: true
			};

			const result: OnboardingResult = await onboardingService.onboardRepository(options);

			expect(result).toBeDefined();
			expect(result.analysis).toBeDefined();
			expect(result.agentRecommendations).toHaveLength(2);
			expect(result.architectureDocument).toContain('# Architecture Documentation');
			expect(result.customConfigurations).toHaveLength(3); // 2 agents + 1 workflow
			expect(result.setupInstructions).toBeDefined();
			expect(result.metadata).toBeDefined();
			expect(result.metadata.duration).toBeGreaterThan(0);
		});

		it('should perform minimal onboarding with no optional features', async () => {
			const options: OnboardingOptions = {
				generateDocs: false,
				setupAgents: false,
				createCommands: false,
				analyzeComponents: false,
				mapDataFlows: false
			};

			const result: OnboardingResult = await onboardingService.onboardRepository(options);

			expect(result).toBeDefined();
			expect(result.analysis).toBeDefined();
			expect(result.agentRecommendations).toHaveLength(2);
			expect(result.architectureDocument).toBe(''); // No documentation generated
			expect(result.customConfigurations).toHaveLength(0); // No configs generated
			expect(result.setupInstructions).toBeDefined();
			expect(result.metadata.options).toEqual(options);
		});

		it('should generate agent configurations when setupAgents is true', async () => {
			const options: OnboardingOptions = {
				generateDocs: false,
				setupAgents: true,
				createCommands: false,
				analyzeComponents: false,
				mapDataFlows: false
			};

			const result: OnboardingResult = await onboardingService.onboardRepository(options);

			expect(result.customConfigurations).toHaveLength(2); // 2 agent configs
			expect(result.customConfigurations[0].type).toBe('agent');
			expect(result.customConfigurations[0].filename).toBe('code-reviewer.agent.md');
			expect(result.customConfigurations[0].content).toContain('**Purpose:** Review code changes for quality and best practices');
		});

		it('should generate workflow configuration when createCommands is true', async () => {
			const options: OnboardingOptions = {
				generateDocs: false,
				setupAgents: false,
				createCommands: true,
				analyzeComponents: false,
				mapDataFlows: false
			};

			const result: OnboardingResult = await onboardingService.onboardRepository(options);

			expect(result.customConfigurations).toHaveLength(1); // 1 workflow config
			expect(result.customConfigurations[0].type).toBe('workflow');
			expect(result.customConfigurations[0].filename).toBe('workflow.md');
			expect(result.customConfigurations[0].content).toContain('# Repository Workflow Commands');
		});

		it('should handle analysis errors gracefully', async () => {
			const logErrorSpy = vi.spyOn(logService, 'error');
			vi.spyOn(mockRepositoryAnalyzer, 'analyzeRepository').mockRejectedValue(new Error('Analysis failed'));

			const options: OnboardingOptions = {
				generateDocs: false,
				setupAgents: false,
				createCommands: false,
				analyzeComponents: false,
				mapDataFlows: false
			};

			await expect(onboardingService.onboardRepository(options)).rejects.toThrow('Analysis failed');
			expect(logErrorSpy).toHaveBeenCalledWith('[OnboardingAgentService] Repository onboarding failed', expect.any(Error));
		});
	});

	describe('analyzeRepository', () => {
		it('should delegate to investigation engine', async () => {
			const spy = vi.spyOn(mockRepositoryAnalyzer, 'analyzeRepository');

			await onboardingService.analyzeRepository();

			expect(spy).toHaveBeenCalled();
		});
	});

	describe('generateArchitectureDoc', () => {
		it('should generate documentation from analysis', async () => {
			const analysis = await mockRepositoryAnalyzer.analyzeRepository();
			const doc = await onboardingService.generateArchitectureDoc(analysis);

			expect(doc).toContain('# Architecture Documentation');
			expect(doc).toContain(analysis.domain.domain);
		});
	});

	describe('getAgentRecommendations', () => {
		it('should get recommendations from engine', async () => {
			const analysis = await mockRepositoryAnalyzer.analyzeRepository();
			const recommendations = await onboardingService.getAgentRecommendations(analysis);

			expect(recommendations).toHaveLength(2);
			expect(recommendations[0].agentType).toBe('code-reviewer');
			expect(recommendations[1].agentType).toBe('test-specialist');
		});
	});

	describe('generateConfigurations', () => {
		it('should generate configurations for all recommendations', async () => {
			const recommendations = [
				{
					agentType: 'test-agent',
					purpose: 'Testing',
					priority: 'high',
					reasoning: 'Test reasoning',
					suggestedSkills: ['testing'],
					customInstructions: ['Write tests'],
					configuration: {
						name: 'Test Agent',
						description: 'Test agent description',
						tools: ['Read', 'Write'],
						temperature: 0.3
					}
				}
			] as AgentRecommendation[];

			const configs = await onboardingService.generateConfigurations(recommendations);

			expect(configs).toHaveLength(2); // agent config + instruction config
			expect(configs[0].type).toBe('agent');
			expect(configs[1].type).toBe('instruction');
		});
	});

	describe('performance', () => {
		it('should complete onboarding within reasonable time', async () => {
			const options: OnboardingOptions = {
				generateDocs: true,
				setupAgents: true,
				createCommands: true,
				analyzeComponents: true,
				mapDataFlows: true
			};

			const startTime = Date.now();
			await onboardingService.onboardRepository(options);
			const endTime = Date.now();

			// Should complete within 5 seconds (generous for test environment)
			expect(endTime - startTime).toBeLessThan(5000);
		});
	});
});