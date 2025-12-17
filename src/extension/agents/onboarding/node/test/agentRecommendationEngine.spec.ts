/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, beforeEach, it, expect } from 'vitest';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { MockLogService } from '../../../../platform/log/test/mockLogService';
import { AgentRecommendationEngineService } from '../node/agentRecommendationEngine';
import { RepositoryAnalysis } from '../common/onboardingTypes';

describe('AgentRecommendationEngineService', () => {
	let store: DisposableStore;
	let logService: MockLogService;
	let recommendationEngine: AgentRecommendationEngineService;

	beforeEach(() => {
		store = new DisposableStore();
		logService = new MockLogService();
		recommendationEngine = store.add(new AgentRecommendationEngineService(logService));
	});

	afterEach(() => {
		store.dispose();
	});

	const createMockAnalysis = (overrides: Partial<RepositoryAnalysis> = {}): RepositoryAnalysis => ({
		structure: {
			directories: [
				{ name: 'src', type: 'source', purposes: ['application'], fileCount: 20 }
			],
			fileTypes: {
				languages: [
					{ language: 'TypeScript', fileCount: 20, percentage: 100, extensions: ['.ts'] }
				]
			},
			dependencies: {
				packageManager: 'npm',
				totalDependencies: 10,
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
			frameworks: [],
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
			domain: 'general',
			scale: 'small',
			confidence: 0.5,
			keywords: [],
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
			namingConventions: [
				{ type: 'function', convention: 'camelCase', consistency: 0.9 }
			],
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
			confidence: 0.5,
			analysisTimeMs: 100,
			sources: []
		},
		...overrides
	});

	describe('recommendAgents', () => {
		it('should recommend core agents for any repository', async () => {
			const analysis = createMockAnalysis();

			const recommendations = await recommendationEngine.recommendAgents(analysis);

			expect(recommendations).toBeDefined();
			expect(recommendations.length).toBeGreaterThan(0);

			// Should always recommend code reviewer
			const codeReviewer = recommendations.find(r => r.agentType === 'code-reviewer');
			expect(codeReviewer).toBeDefined();
			expect(codeReviewer!.priority).toBe('high');
			expect(codeReviewer!.configuration.name).toBe('Code Reviewer');
		});

		it('should recommend architecture analyst for complex projects', async () => {
			const analysis = createMockAnalysis({
				structure: {
					...createMockAnalysis().structure,
					directories: new Array(15).fill(0).map((_, i) => ({
						name: `dir${i}`,
						type: 'source',
						purposes: ['application'],
						fileCount: 10
					}))
				}
			});

			const recommendations = await recommendationEngine.recommendAgents(analysis);

			const architectAnalyst = recommendations.find(r => r.agentType === 'architecture-analyst');
			expect(architectAnalyst).toBeDefined();
			expect(architectAnalyst!.priority).toBe('high');
		});

		it('should recommend React specialist for React projects', async () => {
			const analysis = createMockAnalysis({
				technologies: {
					...createMockAnalysis().technologies,
					frameworks: [
						{ name: 'React', category: 'frontend', confidence: 0.9, version: '18.0.0' }
					]
				}
			});

			const recommendations = await recommendationEngine.recommendAgents(analysis);

			const reactSpecialist = recommendations.find(r => r.agentType === 'react-specialist');
			expect(reactSpecialist).toBeDefined();
			expect(reactSpecialist!.purpose).toContain('React');
			expect(reactSpecialist!.priority).toBe('high');
		});

		it('should recommend database specialist for database-driven projects', async () => {
			const analysis = createMockAnalysis({
				technologies: {
					...createMockAnalysis().technologies,
					databases: ['PostgreSQL', 'Redis']
				}
			});

			const recommendations = await recommendationEngine.recommendAgents(analysis);

			const dbSpecialist = recommendations.find(r => r.agentType === 'database-specialist');
			expect(dbSpecialist).toBeDefined();
			expect(dbSpecialist!.purpose).toContain('database');
			expect(dbSpecialist!.configuration.description).toContain('PostgreSQL, Redis');
		});

		it('should recommend security specialist for security-sensitive domains', async () => {
			const analysis = createMockAnalysis({
				domain: {
					...createMockAnalysis().domain,
					compliance: {
						regulations: ['GDPR', 'HIPAA'],
						securityRequirements: ['encryption', 'authentication'],
						dataPrivacy: true,
						auditTrails: true
					}
				}
			});

			const recommendations = await recommendationEngine.recommendAgents(analysis);

			const securitySpecialist = recommendations.find(r => r.agentType === 'security-specialist');
			expect(securitySpecialist).toBeDefined();
			expect(securitySpecialist!.priority).toBe('high');
			expect(securitySpecialist!.customInstructions).toContain('Perform regular security audits');
		});

		it('should recommend performance specialist for large-scale projects', async () => {
			const analysis = createMockAnalysis({
				domain: {
					...createMockAnalysis().domain,
					scale: 'enterprise'
				}
			});

			const recommendations = await recommendationEngine.recommendAgents(analysis);

			const performanceSpecialist = recommendations.find(r => r.agentType === 'performance-specialist');
			expect(performanceSpecialist).toBeDefined();
			expect(performanceSpecialist!.priority).toBe('high');
		});

		it('should recommend refactoring specialist for inconsistent codebases', async () => {
			const analysis = createMockAnalysis({
				patterns: {
					...createMockAnalysis().patterns,
					namingConventions: [
						{ type: 'function', convention: 'camelCase', consistency: 0.6 } // Low consistency
					],
					architecturalPatterns: [
						{ pattern: 'MVC', confidence: 0.8, evidence: ['controllers/'] },
						{ pattern: 'MVP', confidence: 0.7, evidence: ['presenters/'] },
						{ pattern: 'MVVM', confidence: 0.6, evidence: ['viewmodels/'] }
					]
				}
			});

			const recommendations = await recommendationEngine.recommendAgents(analysis);

			const refactoringSpecialist = recommendations.find(r => r.agentType === 'refactoring-specialist');
			expect(refactoringSpecialist).toBeDefined();
			expect(refactoringSpecialist!.purpose).toContain('refactoring');
		});

		it('should recommend test specialist for projects with tests', async () => {
			const analysis = createMockAnalysis({
				structure: {
					...createMockAnalysis().structure,
					testStructure: {
						hasTests: true,
						testFrameworks: ['jest', 'cypress'],
						testDirectories: ['tests', 'e2e'],
						coverageConfigured: true,
						testTypes: ['unit', 'integration', 'e2e']
					}
				}
			});

			const recommendations = await recommendationEngine.recommendAgents(analysis);

			const testSpecialist = recommendations.find(r => r.agentType === 'test-specialist');
			expect(testSpecialist).toBeDefined();
			expect(testSpecialist!.priority).toBe('high');
			expect(testSpecialist!.configuration.description).toContain('jest, cypress');
		});

		it('should recommend test setup specialist for projects without tests', async () => {
			const analysis = createMockAnalysis({
				structure: {
					...createMockAnalysis().structure,
					testStructure: {
						hasTests: false,
						testFrameworks: [],
						testDirectories: [],
						coverageConfigured: false,
						testTypes: []
					}
				}
			});

			const recommendations = await recommendationEngine.recommendAgents(analysis);

			const testSetupSpecialist = recommendations.find(r => r.agentType === 'test-setup-specialist');
			expect(testSetupSpecialist).toBeDefined();
			expect(testSetupSpecialist!.purpose).toContain('test infrastructure setup');
		});

		it('should recommend DevOps specialist for containerized deployments', async () => {
			const analysis = createMockAnalysis({
				technologies: {
					...createMockAnalysis().technologies,
					deployment: {
						platforms: ['AWS', 'Docker'],
						containerized: true,
						serverless: false
					}
				}
			});

			const recommendations = await recommendationEngine.recommendAgents(analysis);

			const devopsSpecialist = recommendations.find(r => r.agentType === 'devops-specialist');
			expect(devopsSpecialist).toBeDefined();
			expect(devopsSpecialist!.configuration.description).toContain('AWS, Docker');
		});

		it('should sort recommendations by priority', async () => {
			const analysis = createMockAnalysis({
				domain: {
					...createMockAnalysis().domain,
					scale: 'enterprise',
					compliance: {
						regulations: ['GDPR'],
						securityRequirements: ['encryption'],
						dataPrivacy: true,
						auditTrails: true
					}
				}
			});

			const recommendations = await recommendationEngine.recommendAgents(analysis);

			// Should be sorted by priority (high to low)
			const priorities = recommendations.map(r => r.priority);
			const highCount = priorities.filter(p => p === 'high').length;
			const mediumCount = priorities.filter(p => p === 'medium').length;
			const lowCount = priorities.filter(p => p === 'low').length;

			expect(highCount).toBeGreaterThan(0);

			// High priority items should come before medium priority items
			const firstMediumIndex = priorities.findIndex(p => p === 'medium');
			const lastHighIndex = priorities.lastIndexOf('high');

			if (firstMediumIndex !== -1 && lastHighIndex !== -1) {
				expect(lastHighIndex).toBeLessThan(firstMediumIndex);
			}
		});

		it('should handle minimal analysis gracefully', async () => {
			const minimalAnalysis = createMockAnalysis({
				structure: {
					directories: [],
					fileTypes: { languages: [] },
					dependencies: { packageManager: 'npm', totalDependencies: 0, dependencies: [], devDependencies: [] },
					buildSystem: { scripts: [] },
					testStructure: { hasTests: false, testFrameworks: [], testDirectories: [], coverageConfigured: false, testTypes: [] }
				},
				technologies: {
					primaryLanguages: [],
					frameworks: [],
					databases: [],
					deployment: { platforms: [], containerized: false, serverless: false },
					cicd: { providers: [], stages: [] }
				}
			});

			const recommendations = await recommendationEngine.recommendAgents(minimalAnalysis);

			expect(recommendations).toBeDefined();
			expect(recommendations.length).toBeGreaterThan(0);
			// Should still recommend basic agents like code reviewer
			expect(recommendations.some(r => r.agentType === 'code-reviewer')).toBe(true);
		});
	});
});