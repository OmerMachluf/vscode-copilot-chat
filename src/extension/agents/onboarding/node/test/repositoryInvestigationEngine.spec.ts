/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, beforeEach, it, expect, vi } from 'vitest';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { MockLogService } from '../../../../platform/log/test/mockLogService';
import { RepositoryInvestigationEngine } from '../node/repositoryInvestigationEngine';
import { ISubTaskManager } from '../../../orchestrator/subTaskManager';
import { IRepositoryAnalyzerService } from '../common/onboardingTypes';

class MockSubTaskManager implements ISubTaskManager {
	readonly _serviceBrand: undefined;

	async spawnSubTask(): Promise<any> {
		// Mock implementation returns sample analysis data
		return {
			structure: {
				directories: [
					{ name: 'src', type: 'source', purposes: ['application'], fileCount: 50 },
					{ name: 'tests', type: 'test', purposes: ['testing'], fileCount: 20 }
				],
				fileTypes: {
					languages: [
						{ language: 'TypeScript', fileCount: 40, percentage: 80, extensions: ['.ts', '.tsx'] },
						{ language: 'JavaScript', fileCount: 10, percentage: 20, extensions: ['.js'] }
					]
				},
				dependencies: {
					packageManager: 'npm',
					totalDependencies: 25,
					dependencies: ['express', 'react'],
					devDependencies: ['jest', 'eslint']
				},
				buildSystem: {
					scripts: [
						{ name: 'build', command: 'npm run build', type: 'build' },
						{ name: 'test', command: 'npm test', type: 'test' }
					]
				},
				testStructure: {
					hasTests: true,
					testFrameworks: ['jest'],
					testDirectories: ['tests'],
					coverageConfigured: true,
					testTypes: ['unit', 'integration']
				}
			},
			technologies: {
				primaryLanguages: ['TypeScript', 'JavaScript'],
				frameworks: [
					{ name: 'React', category: 'frontend', confidence: 0.9, version: '18.0.0' },
					{ name: 'Express', category: 'backend', confidence: 0.8, version: '4.18.0' }
				],
				databases: ['PostgreSQL'],
				deployment: {
					platforms: ['AWS'],
					containerized: true,
					serverless: false
				},
				cicd: {
					providers: ['GitHub Actions'],
					stages: ['build', 'test', 'deploy']
				}
			},
			domain: {
				domain: 'e-commerce',
				scale: 'medium',
				confidence: 0.8,
				keywords: ['payment', 'cart', 'product', 'user'],
				compliance: {
					regulations: ['PCI-DSS'],
					securityRequirements: ['encryption', 'authentication'],
					dataPrivacy: true,
					auditTrails: true
				}
			},
			patterns: {
				architecturalPatterns: [
					{ pattern: 'MVC', confidence: 0.8, evidence: ['controllers/', 'models/', 'views/'] }
				],
				designPatterns: [
					{ pattern: 'Factory', occurrences: 5, files: ['factory.ts', 'userFactory.ts'] }
				],
				namingConventions: [
					{ type: 'function', convention: 'camelCase', consistency: 0.9 },
					{ type: 'class', convention: 'PascalCase', consistency: 0.95 }
				],
				codeStyle: {
					indentation: 'tabs',
					indentSize: 4,
					lineEndings: 'LF',
					quoteStyle: 'single',
					semicolons: true
				}
			},
			metadata: {
				timestamp: Date.now(),
				version: '1.0.0',
				confidence: 0.85,
				analysisTimeMs: 500,
				sources: ['package.json', 'src/', 'tests/']
			}
		};
	}
}

class MockRepositoryAnalyzer implements IRepositoryAnalyzerService {
	readonly _serviceBrand: undefined;

	async analyzeRepository(): Promise<any> {
		return {
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
			},
			domain: {
				domain: 'general',
				scale: 'small',
				confidence: 0.5,
				keywords: [],
				compliance: { regulations: [], securityRequirements: [], dataPrivacy: false, auditTrails: false }
			},
			patterns: {
				architecturalPatterns: [],
				designPatterns: [],
				namingConventions: [],
				codeStyle: { indentation: 'spaces', lineEndings: 'LF', quoteStyle: 'single', semicolons: true }
			},
			metadata: {
				timestamp: Date.now(),
				version: '1.0.0',
				confidence: 0.5,
				analysisTimeMs: 100,
				sources: []
			}
		};
	}
}

describe('RepositoryInvestigationEngine', () => {
	let store: DisposableStore;
	let logService: MockLogService;
	let mockSubTaskManager: MockSubTaskManager;
	let mockRepositoryAnalyzer: MockRepositoryAnalyzer;
	let engine: RepositoryInvestigationEngine;

	beforeEach(() => {
		store = new DisposableStore();
		logService = new MockLogService();
		mockSubTaskManager = new MockSubTaskManager();
		mockRepositoryAnalyzer = new MockRepositoryAnalyzer();

		engine = store.add(new RepositoryInvestigationEngine(
			mockSubTaskManager,
			mockRepositoryAnalyzer,
			logService
		));
	});

	afterEach(() => {
		store.dispose();
	});

	describe('performComprehensiveAnalysis', () => {
		it('should perform complete repository analysis with enhanced features', async () => {
			const result = await engine.performComprehensiveAnalysis();

			expect(result).toBeDefined();
			expect(result.structure).toBeDefined();
			expect(result.technologies).toBeDefined();
			expect(result.domain).toBeDefined();
			expect(result.patterns).toBeDefined();
			expect(result.metadata).toBeDefined();

			// Verify enhanced analysis includes components and data flows
			expect(result.metadata.confidence).toBeGreaterThan(0);
			expect(result.metadata.timestamp).toBeDefined();
		});

		it('should handle analysis when A2A orchestration is available', async () => {
			const result = await engine.performComprehensiveAnalysis();

			// Should use enhanced analysis from A2A subtask
			expect(result.technologies.frameworks).toContain(
				expect.objectContaining({ name: 'React', category: 'frontend' })
			);
			expect(result.domain.domain).toBe('e-commerce');
			expect(result.patterns.architecturalPatterns).toContain(
				expect.objectContaining({ pattern: 'MVC', confidence: 0.8 })
			);
		});

		it('should handle analysis when A2A orchestration fails', async () => {
			// Mock subtask failure
			vi.spyOn(mockSubTaskManager, 'spawnSubTask').mockRejectedValue(new Error('A2A not available'));

			const result = await engine.performComprehensiveAnalysis();

			// Should fall back to base analyzer
			expect(result).toBeDefined();
			expect(result.domain.domain).toBe('general');
			expect(result.domain.scale).toBe('small');
		});
	});

	describe('extractComponents', () => {
		it('should extract architectural components from structure and patterns', async () => {
			const mockStructure = {
				directories: [
					{ name: 'src/controllers', type: 'source', purposes: ['controllers'], fileCount: 10 },
					{ name: 'src/models', type: 'source', purposes: ['models'], fileCount: 15 },
					{ name: 'src/services', type: 'source', purposes: ['services'], fileCount: 8 }
				]
			} as any;

			const mockPatterns = {
				architecturalPatterns: [
					{ pattern: 'MVC', confidence: 0.9, evidence: ['controllers/', 'models/', 'views/'] }
				]
			} as any;

			const components = await engine.extractComponents(mockStructure, mockPatterns);

			expect(components).toHaveLength(3);
			expect(components).toContain(
				expect.objectContaining({
					name: 'Controllers',
					type: 'Controller Layer',
					responsibilities: expect.arrayContaining(['Handle HTTP requests and responses'])
				})
			);
			expect(components).toContain(
				expect.objectContaining({
					name: 'Models',
					type: 'Data Layer',
					responsibilities: expect.arrayContaining(['Define data structures and business entities'])
				})
			);
			expect(components).toContain(
				expect.objectContaining({
					name: 'Services',
					type: 'Business Logic Layer',
					responsibilities: expect.arrayContaining(['Implement core business logic'])
				})
			);
		});

		it('should handle empty structure gracefully', async () => {
			const mockStructure = { directories: [] } as any;
			const mockPatterns = { architecturalPatterns: [] } as any;

			const components = await engine.extractComponents(mockStructure, mockPatterns);

			expect(components).toEqual([]);
		});
	});

	describe('analyzeDataFlows', () => {
		it('should analyze data flows between components', async () => {
			const mockStructure = {
				directories: [
					{ name: 'src/api', type: 'source', purposes: ['api'], fileCount: 5 },
					{ name: 'src/database', type: 'source', purposes: ['database'], fileCount: 3 }
				]
			} as any;

			const mockTechnologies = {
				frameworks: [
					{ name: 'Express', category: 'backend', confidence: 0.8 }
				],
				databases: ['PostgreSQL']
			} as any;

			const dataFlows = await engine.analyzeDataFlows(mockStructure, mockTechnologies);

			expect(dataFlows).toHaveLength(2);
			expect(dataFlows).toContain(
				expect.objectContaining({
					from: 'Client',
					to: 'API',
					data: 'HTTP Requests',
					protocol: 'HTTP/HTTPS'
				})
			);
			expect(dataFlows).toContain(
				expect.objectContaining({
					from: 'API',
					to: 'Database',
					data: 'SQL Queries',
					protocol: 'TCP'
				})
			);
		});

		it('should handle minimal structure', async () => {
			const mockStructure = { directories: [] } as any;
			const mockTechnologies = { frameworks: [], databases: [] } as any;

			const dataFlows = await engine.analyzeDataFlows(mockStructure, mockTechnologies);

			expect(dataFlows).toEqual([]);
		});
	});

	describe('error handling', () => {
		it('should log errors and continue with fallback analysis', async () => {
			const logErrorSpy = vi.spyOn(logService, 'error');
			vi.spyOn(mockSubTaskManager, 'spawnSubTask').mockRejectedValue(new Error('Network error'));

			const result = await engine.performComprehensiveAnalysis();

			expect(logErrorSpy).toHaveBeenCalledWith(
				'[RepositoryInvestigationEngine] Enhanced analysis failed, using fallback',
				expect.any(Error)
			);
			expect(result).toBeDefined();
			expect(result.domain.domain).toBe('general'); // Fallback result
		});
	});

	describe('performance', () => {
		it('should complete analysis within reasonable time', async () => {
			const startTime = Date.now();
			await engine.performComprehensiveAnalysis();
			const endTime = Date.now();

			// Should complete within 5 seconds (generous for test environment)
			expect(endTime - startTime).toBeLessThan(5000);
		});
	});
});