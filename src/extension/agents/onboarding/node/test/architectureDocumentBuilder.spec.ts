/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, beforeEach, it, expect } from 'vitest';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { MockLogService } from '../../../../platform/log/test/mockLogService';
import { ArchitectureDocumentBuilderService } from '../node/architectureDocumentBuilder';
import { RepositoryAnalysis, Component, DataFlow } from '../common/onboardingTypes';

describe('ArchitectureDocumentBuilderService', () => {
	let store: DisposableStore;
	let logService: MockLogService;
	let documentBuilder: ArchitectureDocumentBuilderService;

	beforeEach(() => {
		store = new DisposableStore();
		logService = new MockLogService();
		documentBuilder = store.add(new ArchitectureDocumentBuilderService(logService));
	});

	afterEach(() => {
		store.dispose();
	});

	const createMockAnalysis = (overrides: Partial<RepositoryAnalysis> = {}): RepositoryAnalysis => ({
		structure: {
			directories: [
				{ name: 'src', type: 'source', purposes: ['application'], fileCount: 25 },
				{ name: 'tests', type: 'test', purposes: ['testing'], fileCount: 10 },
				{ name: 'docs', type: 'documentation', purposes: ['documentation'], fileCount: 5 }
			],
			fileTypes: {
				languages: [
					{ language: 'TypeScript', fileCount: 20, percentage: 80, extensions: ['.ts', '.tsx'] },
					{ language: 'JavaScript', fileCount: 5, percentage: 20, extensions: ['.js'] }
				]
			},
			dependencies: {
				packageManager: 'npm',
				totalDependencies: 15,
				dependencies: ['express', 'react'],
				devDependencies: ['jest', 'eslint']
			},
			buildSystem: {
				scripts: [
					{ name: 'build', command: 'npm run build', type: 'build' },
					{ name: 'test', command: 'npm test', type: 'test' },
					{ name: 'dev', command: 'npm run dev', type: 'development' }
				]
			},
			testStructure: {
				hasTests: true,
				testFrameworks: ['jest', 'react-testing-library'],
				testDirectories: ['tests', '__tests__'],
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
			databases: ['PostgreSQL', 'Redis'],
			deployment: {
				platforms: ['AWS', 'Docker'],
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
			keywords: ['payment', 'cart', 'product', 'user', 'order'],
			compliance: {
				regulations: ['PCI-DSS'],
				securityRequirements: ['encryption', 'authentication'],
				dataPrivacy: true,
				auditTrails: true
			}
		},
		patterns: {
			architecturalPatterns: [
				{ pattern: 'MVC', confidence: 0.9, evidence: ['controllers/', 'models/', 'views/'] },
				{ pattern: 'Microservices', confidence: 0.7, evidence: ['services/', 'api-gateway/'] }
			],
			designPatterns: [
				{ pattern: 'Factory', occurrences: 5, files: ['userFactory.ts', 'productFactory.ts'] },
				{ pattern: 'Observer', occurrences: 3, files: ['eventEmitter.ts'] }
			],
			namingConventions: [
				{ type: 'function', convention: 'camelCase', consistency: 0.95 },
				{ type: 'class', convention: 'PascalCase', consistency: 0.9 },
				{ type: 'variable', convention: 'camelCase', consistency: 0.85 }
			],
			codeStyle: {
				indentation: 'spaces',
				indentSize: 2,
				lineEndings: 'LF',
				quoteStyle: 'single',
				semicolons: true
			}
		},
		metadata: {
			timestamp: Date.now(),
			version: '1.0.0',
			confidence: 0.85,
			analysisTimeMs: 750,
			sources: ['package.json', 'src/', 'tests/', 'docker-compose.yml']
		},
		...overrides
	});

	const createMockComponents = (): Component[] => [
		{
			name: 'UserController',
			type: 'Controller',
			responsibilities: ['Handle user authentication', 'Manage user profiles', 'Process user requests'],
			dependencies: ['UserService', 'AuthMiddleware'],
			interfaces: [
				{ name: 'IUserController', type: 'interface', description: 'User controller contract' }
			]
		},
		{
			name: 'ProductService',
			type: 'Service',
			responsibilities: ['Manage product catalog', 'Handle product queries', 'Update product information'],
			dependencies: ['DatabaseRepository', 'CacheService'],
			interfaces: [
				{ name: 'IProductService', type: 'interface', description: 'Product service contract' }
			]
		},
		{
			name: 'DatabaseRepository',
			type: 'Repository',
			responsibilities: ['Data persistence', 'Database queries', 'Transaction management'],
			dependencies: [],
			interfaces: [
				{ name: 'IRepository', type: 'interface', description: 'Repository pattern interface' }
			]
		}
	];

	const createMockDataFlows = (): DataFlow[] => [
		{
			from: 'Client',
			to: 'API Gateway',
			data: 'HTTP Requests',
			protocol: 'HTTP/HTTPS',
			description: 'Client requests routed through API gateway'
		},
		{
			from: 'API Gateway',
			to: 'User Service',
			data: 'User Commands',
			protocol: 'REST',
			description: 'User-related operations'
		},
		{
			from: 'User Service',
			to: 'Database',
			data: 'SQL Queries',
			protocol: 'TCP',
			description: 'User data persistence'
		}
	];

	describe('generateArchitectureDoc', () => {
		it('should generate complete architecture document', async () => {
			const analysis = createMockAnalysis();

			const document = await documentBuilder.generateArchitectureDoc(analysis);

			expect(document).toBeDefined();
			expect(document.length).toBeGreaterThan(100);

			// Should contain all major sections
			expect(document).toContain('# Repository Architecture Documentation');
			expect(document).toContain('# Executive Summary');
			expect(document).toContain('# System Overview');
			expect(document).toContain('# Technology Stack');
			expect(document).toContain('# Business Domain and Context');
			expect(document).toContain('# Code Patterns and Conventions');
			expect(document).toContain('# Development Guidelines');
			expect(document).toContain('# Getting Started');
		});

		it('should include metadata in header', async () => {
			const analysis = createMockAnalysis();

			const document = await documentBuilder.generateArchitectureDoc(analysis);

			expect(document).toContain('**Generated on:**');
			expect(document).toContain('**Analysis Version:** 1.0.0');
			expect(document).toContain('**Confidence Level:** 85.0%');
			expect(document).toContain('**Analysis Duration:** 750ms');
		});

		it('should include component diagrams when components are available', async () => {
			const components = createMockComponents();
			const analysis = createMockAnalysis();
			(analysis as any).components = components;

			const document = await documentBuilder.generateArchitectureDoc(analysis);

			expect(document).toContain('# Component Architecture');
			expect(document).toContain('## Component Overview');
			expect(document).toContain('UserController');
			expect(document).toContain('ProductService');
			expect(document).toContain('DatabaseRepository');
		});

		it('should include data flow diagrams when data flows are available', async () => {
			const dataFlows = createMockDataFlows();
			const analysis = createMockAnalysis();
			(analysis as any).dataFlows = dataFlows;

			const document = await documentBuilder.generateArchitectureDoc(analysis);

			expect(document).toContain('# Data Flow Architecture');
			expect(document).toContain('## Data Flow Overview');
			expect(document).toContain('Client');
			expect(document).toContain('API Gateway');
			expect(document).toContain('HTTP/HTTPS');
		});
	});

	describe('generateSystemOverview', () => {
		it('should generate directory structure table', () => {
			const analysis = createMockAnalysis();

			const overview = documentBuilder.generateSystemOverview(analysis.structure);

			expect(overview).toContain('## Directory Structure');
			expect(overview).toContain('| Directory | Type | Purpose | File Count |');
			expect(overview).toContain('| `src` | source | application | 25 |');
			expect(overview).toContain('| `tests` | test | testing | 10 |');
		});

		it('should include language distribution', () => {
			const analysis = createMockAnalysis();

			const overview = documentBuilder.generateSystemOverview(analysis.structure);

			expect(overview).toContain('## Language Distribution');
			expect(overview).toContain('| Language | Files | Percentage | Extensions |');
			expect(overview).toContain('| TypeScript | 20 | 80.0% | .ts, .tsx |');
			expect(overview).toContain('| JavaScript | 5 | 20.0% | .js |');
		});

		it('should include dependencies overview', () => {
			const analysis = createMockAnalysis();

			const overview = documentBuilder.generateSystemOverview(analysis.structure);

			expect(overview).toContain('## Dependencies Overview');
			expect(overview).toContain('- **Package Manager**: npm');
			expect(overview).toContain('- **Total Dependencies**: 15');
			expect(overview).toContain('- **Production Dependencies**: 2');
			expect(overview).toContain('- **Development Dependencies**: 2');
		});

		it('should include testing setup when tests are present', () => {
			const analysis = createMockAnalysis();

			const overview = documentBuilder.generateSystemOverview(analysis.structure);

			expect(overview).toContain('## Testing Setup');
			expect(overview).toContain('- **Test Frameworks**: jest, react-testing-library');
			expect(overview).toContain('- **Coverage Configured**: Yes');
			expect(overview).toContain('- **Test Types**: unit, integration');
		});

		it('should handle empty structure gracefully', () => {
			const emptyStructure = {
				directories: [],
				fileTypes: { languages: [] },
				dependencies: { packageManager: 'npm', totalDependencies: 0, dependencies: [], devDependencies: [] },
				buildSystem: { scripts: [] },
				testStructure: { hasTests: false, testFrameworks: [], testDirectories: [], coverageConfigured: false, testTypes: [] }
			};

			const overview = documentBuilder.generateSystemOverview(emptyStructure);

			expect(overview).toContain('# System Overview');
			expect(overview).toContain('## Directory Structure');
			expect(overview).toContain('## Dependencies Overview');
		});
	});

	describe('generateComponentDiagrams', () => {
		it('should generate component overview table', () => {
			const components = createMockComponents();

			const diagrams = documentBuilder.generateComponentDiagrams(components);

			expect(diagrams).toContain('# Component Architecture');
			expect(diagrams).toContain('## Component Overview');
			expect(diagrams).toContain('| Component | Type | Responsibilities | Dependencies |');
			expect(diagrams).toContain('| UserController | Controller |');
			expect(diagrams).toContain('| ProductService | Service |');
		});

		it('should include detailed component information', () => {
			const components = createMockComponents();

			const diagrams = documentBuilder.generateComponentDiagrams(components);

			expect(diagrams).toContain('## Component Details');
			expect(diagrams).toContain('### UserController (Controller)');
			expect(diagrams).toContain('**Responsibilities:**');
			expect(diagrams).toContain('- Handle user authentication');
			expect(diagrams).toContain('**Dependencies:**');
			expect(diagrams).toContain('- UserService');
			expect(diagrams).toContain('**Interfaces:**');
			expect(diagrams).toContain('- **IUserController** (interface)');
		});

		it('should generate dependency diagram', () => {
			const components = createMockComponents();

			const diagrams = documentBuilder.generateComponentDiagrams(components);

			expect(diagrams).toContain('## Component Dependencies');
			expect(diagrams).toContain('UserController (Controller)');
			expect(diagrams).toContain('└─ depends on: UserService');
		});
	});

	describe('generateDataFlowDiagrams', () => {
		it('should generate data flow overview table', () => {
			const dataFlows = createMockDataFlows();

			const diagrams = documentBuilder.generateDataFlowDiagrams(dataFlows);

			expect(diagrams).toContain('# Data Flow Architecture');
			expect(diagrams).toContain('## Data Flow Overview');
			expect(diagrams).toContain('| From | To | Data Type | Protocol | Description |');
			expect(diagrams).toContain('| Client | API Gateway | HTTP Requests | HTTP/HTTPS |');
		});

		it('should generate flow diagram', () => {
			const dataFlows = createMockDataFlows();

			const diagrams = documentBuilder.generateDataFlowDiagrams(dataFlows);

			expect(diagrams).toContain('## Data Flow Diagram');
			expect(diagrams).toContain('Client ──[HTTP Requests (HTTP/HTTPS)]──> API Gateway');
			expect(diagrams).toContain('↳ Client requests routed through API gateway');
		});
	});

	describe('performance and robustness', () => {
		it('should handle large analysis efficiently', async () => {
			const largeAnalysis = createMockAnalysis({
				structure: {
					...createMockAnalysis().structure,
					directories: new Array(50).fill(0).map((_, i) => ({
						name: `dir${i}`,
						type: 'source',
						purposes: ['application'],
						fileCount: Math.floor(Math.random() * 100)
					}))
				}
			});

			const startTime = Date.now();
			const document = await documentBuilder.generateArchitectureDoc(largeAnalysis);
			const endTime = Date.now();

			expect(document).toBeDefined();
			expect(endTime - startTime).toBeLessThan(2000); // Should complete within 2 seconds
		});

		it('should handle missing optional data gracefully', async () => {
			const minimalAnalysis = createMockAnalysis({
				technologies: {
					primaryLanguages: [],
					frameworks: [],
					databases: [],
					deployment: { platforms: [], containerized: false, serverless: false },
					cicd: { providers: [], stages: [] }
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
				}
			});

			const document = await documentBuilder.generateArchitectureDoc(minimalAnalysis);

			expect(document).toBeDefined();
			expect(document).toContain('# Repository Architecture Documentation');
			expect(document).toContain('# Technology Stack');
			expect(document).toContain('# Getting Started');
		});
	});
});