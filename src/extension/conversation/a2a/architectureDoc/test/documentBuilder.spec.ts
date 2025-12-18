/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, beforeEach } from 'vitest';
import { DocumentBuilder } from '../documentBuilder';
import { IArchitectureModel, IDocumentTemplate } from '../architectureTypes';

describe('DocumentBuilder', () => {
	let builder: DocumentBuilder;
	let mockModel: IArchitectureModel;

	beforeEach(() => {
		builder = new DocumentBuilder();

		// Create a comprehensive mock model
		mockModel = {
			name: 'Test Project',
			description: 'A comprehensive test project for documentation generation',
			rootPath: '/test/project',
			analyzedAt: Date.now(),
			version: '1.0.0',
			stats: {
				totalFiles: 150,
				totalDirectories: 25,
				totalSize: 2500000,
				totalLinesOfCode: 12000,
				filesByExtension: { '.ts': 80, '.js': 40, '.json': 30 },
				filesByLanguage: { TypeScript: 80, JavaScript: 40 },
				locByLanguage: { TypeScript: 8000, JavaScript: 4000 }
			},
			techStack: {
				languages: [
					{ name: 'TypeScript', category: 'language', version: '5.0', confidence: 0.95, usageFiles: ['src/**/*.ts'] },
					{ name: 'JavaScript', category: 'language', version: 'ES2022', confidence: 0.9, usageFiles: ['lib/**/*.js'] }
				],
				frameworks: [
					{ name: 'Express', category: 'framework', version: '4.18', confidence: 0.9, usageFiles: ['src/app.ts'] }
				],
				libraries: [
					{ name: 'lodash', category: 'library', version: '4.17', confidence: 0.85, usageFiles: [] }
				],
				tools: [
					{ name: 'npm', category: 'tool', confidence: 0.95, usageFiles: ['package.json'] }
				],
				platforms: [],
				databases: [],
				infrastructure: []
			},
			components: [
				{
					id: 'auth-service',
					name: 'AuthService',
					type: 'service',
					description: 'Handles user authentication and authorization',
					path: 'src/services/auth.ts',
					files: ['src/services/auth.ts'],
					symbols: [
						{ name: 'login', type: 'method', filePath: 'src/services/auth.ts', line: 10, column: 2, visibility: 'public' },
						{ name: 'logout', type: 'method', filePath: 'src/services/auth.ts', line: 25, column: 2, visibility: 'public' }
					],
					dependencies: ['user-repo'],
					dependents: ['api-controller'],
					visibility: 'public',
					responsibilities: ['User login', 'Token management', 'Session handling']
				},
				{
					id: 'user-repo',
					name: 'UserRepository',
					type: 'repository',
					description: 'Data access layer for user entities',
					path: 'src/repos/user.ts',
					files: ['src/repos/user.ts'],
					symbols: [],
					dependencies: [],
					dependents: ['auth-service'],
					visibility: 'internal'
				},
				{
					id: 'api-controller',
					name: 'ApiController',
					type: 'controller',
					description: 'REST API endpoint handlers',
					path: 'src/controllers/api.ts',
					files: ['src/controllers/api.ts'],
					symbols: [],
					dependencies: ['auth-service'],
					dependents: [],
					visibility: 'public'
				}
			],
			layers: [
				{
					id: 'presentation',
					name: 'Presentation Layer',
					order: 0,
					description: 'API controllers and request handling',
					components: ['api-controller'],
					allowedDependencies: ['business']
				},
				{
					id: 'business',
					name: 'Business Layer',
					order: 1,
					description: 'Business logic and services',
					components: ['auth-service'],
					allowedDependencies: ['data']
				},
				{
					id: 'data',
					name: 'Data Layer',
					order: 2,
					description: 'Data access and persistence',
					components: ['user-repo'],
					allowedDependencies: []
				}
			],
			modules: [
				{
					id: 'core',
					name: 'Core Module',
					path: 'src/core',
					description: 'Core application functionality',
					components: ['auth-service', 'user-repo'],
					subModules: [],
					entryPoints: ['src/core/index.ts'],
					exports: []
				}
			],
			patterns: [
				{
					name: 'Repository Pattern',
					category: 'structural',
					description: 'Abstracts data access logic',
					confidence: 0.85,
					components: ['user-repo'],
					files: ['src/repos/*.ts'],
					evidence: ['Repository classes found', 'Data access abstraction']
				}
			],
			insights: [
				{
					id: 'insight-1',
					type: 'strength',
					title: 'Good Separation of Concerns',
					description: 'Clear layer separation between presentation, business, and data layers'
				},
				{
					id: 'insight-2',
					type: 'recommendation',
					severity: 'medium',
					title: 'Add Integration Tests',
					description: 'Consider adding integration tests for API endpoints',
					suggestions: ['Add Jest integration tests', 'Use supertest for API testing']
				}
			],
			conventions: [
				{
					category: 'naming',
					name: 'PascalCase for Classes',
					description: 'All class names use PascalCase',
					source: 'detected',
					examples: ['AuthService', 'UserRepository']
				}
			],
			workflow: {
				branchingStrategy: 'Git Flow',
				commitConventions: ['Conventional Commits'],
				cicdPipelines: ['GitHub Actions']
			},
			entryPoints: ['src/index.ts', 'src/app.ts'],
			recommendedReadingOrder: ['src/index.ts', 'src/core/index.ts', 'src/services/auth.ts']
		};
	});

	describe('getTemplates', () => {
		it('should return all built-in templates', () => {
			const templates = builder.getTemplates();

			expect(templates.length).toBeGreaterThanOrEqual(5);

			const ids = templates.map(t => t.id);
			expect(ids).toContain('standard');
			expect(ids).toContain('minimal');
			expect(ids).toContain('onboarding');
			expect(ids).toContain('technical');
			expect(ids).toContain('api');
		});
	});

	describe('getTemplate', () => {
		it('should return a template by ID', () => {
			const template = builder.getTemplate('standard');

			expect(template).toBeDefined();
			expect(template?.id).toBe('standard');
			expect(template?.name).toBe('Standard Architecture Documentation');
		});

		it('should return undefined for unknown template', () => {
			const template = builder.getTemplate('nonexistent');

			expect(template).toBeUndefined();
		});
	});

	describe('registerTemplate', () => {
		it('should register a custom template', () => {
			const customTemplate: IDocumentTemplate = {
				id: 'custom',
				name: 'Custom Template',
				description: 'A custom template for testing',
				version: '1.0.0',
				outputFormat: 'markdown',
				requiredFields: ['name'],
				optionalFields: [],
				sections: [
					{ id: 'intro', title: 'Introduction', level: 2, order: 1, content: '' }
				]
			};

			builder.registerTemplate(customTemplate);

			const retrieved = builder.getTemplate('custom');
			expect(retrieved).toBeDefined();
			expect(retrieved?.name).toBe('Custom Template');
		});
	});

	describe('generateDocument', () => {
		it('should generate a document with standard template', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard'
			});

			expect(result.success).toBe(true);
			expect(result.content).toBeDefined();
			expect(result.generatedSections.length).toBeGreaterThan(0);
			expect(result.generationTime).toBeGreaterThan(0);
		});

		it('should include title in generated document', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'minimal',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'minimal'
			});

			expect(result.content).toContain('# Test Project');
		});

		it('should include description in generated document', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'minimal',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'minimal'
			});

			expect(result.content).toContain('comprehensive test project');
		});

		it('should include table of contents by default', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard'
			});

			expect(result.content).toContain('## Table of Contents');
		});

		it('should exclude table of contents when specified', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard',
				includeToc: false
			});

			expect(result.content).not.toContain('## Table of Contents');
		});

		it('should include badges', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard'
			});

			expect(result.content).toContain('img.shields.io');
		});

		it('should generate diagrams by default', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard',
				includeDiagrams: true
			});

			expect(result.content).toContain('```mermaid');
		});

		it('should exclude diagrams when specified', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'minimal',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'minimal',
				includeDiagrams: false
			});

			expect(result.content).not.toContain('```mermaid');
		});

		it('should include footer with generation timestamp', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'minimal',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'minimal'
			});

			expect(result.content).toContain('Generated on');
			expect(result.content).toContain('Architecture Documentation Generator');
		});

		it('should fail for unknown template', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'nonexistent',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard'
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain('not found');
		});

		it('should respect includeSections option', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard',
				includeSections: ['overview']
			});

			expect(result.success).toBe(true);
			expect(result.generatedSections).toContain('overview');
		});

		it('should respect excludeSections option', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard',
				excludeSections: ['stats']
			});

			expect(result.success).toBe(true);
			expect(result.generatedSections).not.toContain('stats');
		});
	});

	describe('generateSection', () => {
		it('should generate a specific section', async () => {
			const content = await builder.generateSection(mockModel, 'overview-description');

			expect(content).toBe(mockModel.description);
		});

		it('should return empty string for unknown section', async () => {
			const content = await builder.generateSection(mockModel, 'nonexistent-section');

			expect(content).toBe('');
		});
	});

	describe('detail levels', () => {
		it('should generate minimal content for minimal level', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'minimal'
			});

			const standardResult = await builder.generateDocument(mockModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'comprehensive'
			});

			// Comprehensive should have more content
			expect(standardResult.content!.length).toBeGreaterThan(result.content!.length);
		});
	});

	describe('content generation', () => {
		it('should include technology stack', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard'
			});

			expect(result.content).toContain('TypeScript');
			expect(result.content).toContain('Express');
		});

		it('should include component information', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard'
			});

			expect(result.content).toContain('AuthService');
			expect(result.content).toContain('service');
		});

		it('should include layer information', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard'
			});

			expect(result.content).toContain('Presentation Layer');
			expect(result.content).toContain('Business Layer');
			expect(result.content).toContain('Data Layer');
		});

		it('should include patterns', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard'
			});

			expect(result.content).toContain('Repository Pattern');
		});

		it('should include insights', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard'
			});

			expect(result.content).toContain('Good Separation of Concerns');
			expect(result.content).toContain('Add Integration Tests');
		});

		it('should include conventions', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard'
			});

			expect(result.content).toContain('PascalCase for Classes');
		});

		it('should include workflow information', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard'
			});

			expect(result.content).toContain('Git Flow');
		});

		it('should include entry points', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard'
			});

			expect(result.content).toContain('src/index.ts');
		});

		it('should include recommended reading order', async () => {
			const result = await builder.generateDocument(mockModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard'
			});

			expect(result.content).toContain('src/core/index.ts');
		});
	});

	describe('edge cases', () => {
		it('should handle empty components array', async () => {
			const emptyModel = { ...mockModel, components: [] };

			const result = await builder.generateDocument(emptyModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard'
			});

			expect(result.success).toBe(true);
		});

		it('should handle empty layers array', async () => {
			const noLayersModel = { ...mockModel, layers: [] };

			const result = await builder.generateDocument(noLayersModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard'
			});

			expect(result.success).toBe(true);
		});

		it('should handle empty tech stack', async () => {
			const noTechModel = {
				...mockModel,
				techStack: {
					languages: [],
					frameworks: [],
					libraries: [],
					tools: [],
					platforms: [],
					databases: [],
					infrastructure: []
				}
			};

			const result = await builder.generateDocument(noTechModel, {
				templateId: 'standard',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'standard'
			});

			expect(result.success).toBe(true);
		});

		it('should handle model with minimal data', async () => {
			const minimalModel: IArchitectureModel = {
				name: 'Minimal',
				description: 'Minimal model',
				rootPath: '/',
				analyzedAt: Date.now(),
				version: '1.0.0',
				stats: {
					totalFiles: 0,
					totalDirectories: 0,
					totalSize: 0,
					totalLinesOfCode: 0,
					filesByExtension: {},
					filesByLanguage: {},
					locByLanguage: {}
				},
				techStack: {
					languages: [],
					frameworks: [],
					libraries: [],
					tools: [],
					platforms: [],
					databases: [],
					infrastructure: []
				},
				components: [],
				layers: [],
				modules: [],
				patterns: [],
				insights: [],
				conventions: [],
				workflow: {},
				entryPoints: [],
				recommendedReadingOrder: []
			};

			const result = await builder.generateDocument(minimalModel, {
				templateId: 'minimal',
				outputPath: 'ARCHITECTURE.md',
				detailLevel: 'minimal'
			});

			expect(result.success).toBe(true);
			expect(result.content).toContain('# Minimal');
		});
	});
});
