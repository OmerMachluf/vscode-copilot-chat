/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, beforeEach } from 'vitest';
import { DiagramGenerator } from '../diagramGenerator';
import { IArchitectureModel } from '../architectureTypes';

describe('DiagramGenerator', () => {
	let generator: DiagramGenerator;
	let mockModel: IArchitectureModel;

	beforeEach(() => {
		generator = new DiagramGenerator();

		// Create a minimal mock model for testing
		mockModel = {
			name: 'Test Project',
			description: 'A test project',
			rootPath: '/test',
			analyzedAt: Date.now(),
			version: '1.0.0',
			stats: {
				totalFiles: 100,
				totalDirectories: 20,
				totalSize: 1000000,
				totalLinesOfCode: 5000,
				filesByExtension: { '.ts': 50, '.js': 30 },
				filesByLanguage: { TypeScript: 50, JavaScript: 30 },
				locByLanguage: { TypeScript: 3000, JavaScript: 2000 }
			},
			techStack: {
				languages: [
					{ name: 'TypeScript', category: 'language', confidence: 0.9, usageFiles: [] }
				],
				frameworks: [],
				libraries: [],
				tools: [],
				platforms: [],
				databases: [],
				infrastructure: []
			},
			components: [
				{
					id: 'service-auth',
					name: 'AuthService',
					type: 'service',
					description: 'Authentication service',
					path: 'src/services/auth.ts',
					files: ['src/services/auth.ts'],
					symbols: [],
					dependencies: ['repo-user'],
					dependents: ['controller-api'],
					visibility: 'public'
				},
				{
					id: 'repo-user',
					name: 'UserRepository',
					type: 'repository',
					description: 'User data repository',
					path: 'src/repos/user.ts',
					files: ['src/repos/user.ts'],
					symbols: [],
					dependencies: [],
					dependents: ['service-auth'],
					visibility: 'internal'
				},
				{
					id: 'controller-api',
					name: 'ApiController',
					type: 'controller',
					description: 'API endpoint controller',
					path: 'src/controllers/api.ts',
					files: ['src/controllers/api.ts'],
					symbols: [],
					dependencies: ['service-auth'],
					dependents: [],
					visibility: 'public'
				}
			],
			layers: [
				{
					id: 'layer-presentation',
					name: 'Presentation',
					order: 0,
					description: 'User interface layer',
					components: ['controller-api'],
					allowedDependencies: ['layer-business']
				},
				{
					id: 'layer-business',
					name: 'Business',
					order: 1,
					description: 'Business logic layer',
					components: ['service-auth'],
					allowedDependencies: ['layer-data']
				},
				{
					id: 'layer-data',
					name: 'Data',
					order: 2,
					description: 'Data access layer',
					components: ['repo-user'],
					allowedDependencies: []
				}
			],
			modules: [
				{
					id: 'module-core',
					name: 'Core',
					path: 'src/core',
					description: 'Core module',
					components: ['service-auth'],
					subModules: [],
					entryPoints: ['src/core/index.ts'],
					exports: []
				}
			],
			patterns: [],
			insights: [],
			conventions: [],
			workflow: {},
			entryPoints: ['src/index.ts'],
			recommendedReadingOrder: ['src/index.ts', 'src/core/index.ts']
		};
	});

	describe('isSupported', () => {
		it('should return true for supported diagram types', () => {
			expect(generator.isSupported('component')).toBe(true);
			expect(generator.isSupported('dependency')).toBe(true);
			expect(generator.isSupported('class')).toBe(true);
			expect(generator.isSupported('architecture')).toBe(true);
			expect(generator.isSupported('module')).toBe(true);
			expect(generator.isSupported('layer')).toBe(true);
			expect(generator.isSupported('flowchart')).toBe(true);
		});

		it('should return false for unsupported diagram types', () => {
			expect(generator.isSupported('sequence')).toBe(false);
		});
	});

	describe('generateDiagram', () => {
		it('should generate a component diagram', () => {
			const result = generator.generateDiagram(mockModel, { type: 'component' });

			expect(result.type).toBe('component');
			expect(result.format).toBe('mermaid');
			expect(result.code).toContain('graph TB');
			expect(result.code).toContain('AuthService');
			expect(result.code).toContain('UserRepository');
			expect(result.code).toContain('ApiController');
		});

		it('should generate a dependency diagram', () => {
			const result = generator.generateDiagram(mockModel, { type: 'dependency' });

			expect(result.type).toBe('dependency');
			expect(result.code).toContain('graph LR');
			expect(result.code).toContain('-->');
		});

		it('should generate a class diagram', () => {
			const result = generator.generateDiagram(mockModel, { type: 'class' });

			expect(result.type).toBe('class');
			expect(result.code).toContain('classDiagram');
			expect(result.code).toContain('class AuthService');
		});

		it('should generate an architecture diagram', () => {
			const result = generator.generateDiagram(mockModel, { type: 'architecture' });

			expect(result.type).toBe('architecture');
			expect(result.code).toContain('graph TB');
			expect(result.title).toBe('Architecture Overview');
		});

		it('should generate a module diagram', () => {
			const result = generator.generateDiagram(mockModel, { type: 'module' });

			expect(result.type).toBe('module');
			expect(result.code).toContain('Core');
		});

		it('should generate a layer diagram', () => {
			const result = generator.generateDiagram(mockModel, { type: 'layer' });

			expect(result.type).toBe('layer');
			expect(result.code).toContain('Presentation');
			expect(result.code).toContain('Business');
			expect(result.code).toContain('Data');
		});

		it('should generate a flowchart', () => {
			const result = generator.generateDiagram(mockModel, { type: 'flowchart' });

			expect(result.type).toBe('flowchart');
			expect(result.code).toContain('flowchart TD');
		});

		it('should handle unsupported diagram types gracefully', () => {
			const result = generator.generateDiagram(mockModel, { type: 'sequence' });

			expect(result.code).toContain('not supported');
		});
	});

	describe('generateDiagram with options', () => {
		it('should respect direction option', () => {
			const result = generator.generateDiagram(mockModel, {
				type: 'component',
				direction: 'LR'
			});

			expect(result.code).toContain('graph LR');
		});

		it('should respect maxNodes option', () => {
			const result = generator.generateDiagram(mockModel, {
				type: 'component',
				maxNodes: 1
			});

			// Should only have one component
			const nodeMatches = result.code.match(/\["/g);
			expect(nodeMatches?.length).toBeLessThanOrEqual(2); // Allow for title and one component
		});

		it('should respect include option', () => {
			const result = generator.generateDiagram(mockModel, {
				type: 'component',
				include: ['service-auth']
			});

			expect(result.code).toContain('AuthService');
			expect(result.code).not.toContain('UserRepository');
		});

		it('should respect exclude option', () => {
			const result = generator.generateDiagram(mockModel, {
				type: 'component',
				exclude: ['service-auth']
			});

			expect(result.code).not.toContain('AuthService');
			expect(result.code).toContain('UserRepository');
		});

		it('should respect groupBy option', () => {
			const result = generator.generateDiagram(mockModel, {
				type: 'component',
				groupBy: 'type'
			});

			expect(result.code).toContain('subgraph');
		});

		it('should respect custom title', () => {
			const result = generator.generateDiagram(mockModel, {
				type: 'architecture',
				title: 'Custom Title'
			});

			expect(result.title).toBe('Custom Title');
		});
	});

	describe('generateAllDiagrams', () => {
		it('should generate multiple diagram types', () => {
			const results = generator.generateAllDiagrams(mockModel);

			expect(results.length).toBeGreaterThan(0);

			const types = results.map(r => r.type);
			expect(types).toContain('architecture');
			expect(types).toContain('component');
			expect(types).toContain('dependency');
		});

		it('should generate layer diagram when layers exist', () => {
			const results = generator.generateAllDiagrams(mockModel);

			const types = results.map(r => r.type);
			expect(types).toContain('layer');
		});

		it('should generate module diagram when modules exist', () => {
			const results = generator.generateAllDiagrams(mockModel);

			const types = results.map(r => r.type);
			expect(types).toContain('module');
		});
	});

	describe('diagram content validation', () => {
		it('should include styling in component diagrams', () => {
			const result = generator.generateDiagram(mockModel, { type: 'component' });

			expect(result.code).toContain('classDef service');
			expect(result.code).toContain('classDef controller');
		});

		it('should include relationships in dependency diagrams', () => {
			const result = generator.generateDiagram(mockModel, { type: 'dependency' });

			// Check for edge connections
			expect(result.code).toContain('-->');
		});

		it('should include layer order in layer diagrams', () => {
			const result = generator.generateDiagram(mockModel, { type: 'layer' });

			// Presentation should appear before Data in the diagram
			const presentationIndex = result.code.indexOf('Presentation');
			const dataIndex = result.code.indexOf('Data');

			expect(presentationIndex).toBeLessThan(dataIndex);
		});
	});

	describe('edge cases', () => {
		it('should handle empty components', () => {
			const emptyModel = { ...mockModel, components: [] };

			const result = generator.generateDiagram(emptyModel, { type: 'component' });

			expect(result.type).toBe('component');
			expect(result.format).toBe('mermaid');
		});

		it('should handle empty layers', () => {
			const noLayersModel = { ...mockModel, layers: [] };

			const results = generator.generateAllDiagrams(noLayersModel);

			const types = results.map(r => r.type);
			expect(types).not.toContain('layer');
		});

		it('should handle empty modules', () => {
			const noModulesModel = { ...mockModel, modules: [] };

			const results = generator.generateAllDiagrams(noModulesModel);

			const types = results.map(r => r.type);
			expect(types).not.toContain('module');
		});

		it('should handle components with special characters in names', () => {
			const specialModel = {
				...mockModel,
				components: [
					{
						id: 'special-comp',
						name: 'My Component (v2.0)',
						type: 'service' as const,
						description: 'Test',
						path: 'test.ts',
						files: [],
						symbols: [],
						dependencies: [],
						dependents: [],
						visibility: 'public' as const
					}
				]
			};

			const result = generator.generateDiagram(specialModel, { type: 'component' });

			// Should not throw and should produce valid mermaid
			expect(result.code).toContain('graph');
		});
	});
});
