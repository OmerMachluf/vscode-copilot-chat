/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../util/vs/base/common/lifecycle';
import { ILogService } from '../../../../platform/log/common/log';
import {
	IAgentRecommendationEngineService,
	RepositoryAnalysis,
	AgentRecommendation,
	AgentConfiguration,
	Structure,
	Technologies,
	Domain,
	Patterns
} from '../common/onboardingTypes';

/**
 * Service that analyzes repository characteristics and recommends appropriate agents
 * for development workflows based on technology stack, patterns, and domain requirements.
 */
export class AgentRecommendationEngineService extends Disposable implements IAgentRecommendationEngineService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	async recommendAgents(analysis: RepositoryAnalysis): Promise<AgentRecommendation[]> {
		this.logService.debug('[AgentRecommendationEngine] Starting agent recommendation analysis', {
			domain: analysis.domain.domain,
			scale: analysis.domain.scale,
			languages: analysis.technologies.primaryLanguages,
			frameworks: analysis.technologies.frameworks.map(f => f.name)
		});

		const recommendations: AgentRecommendation[] = [];

		try {
			// Core agents that are useful for any repository
			recommendations.push(...this.recommendCoreAgents(analysis.structure, analysis.technologies));

			// Technology-specific agents
			recommendations.push(...this.recommendTechnologyAgents(analysis.technologies));

			// Domain-specific agents
			recommendations.push(...this.recommendDomainAgents(analysis.domain));

			// Pattern-based agents
			recommendations.push(...this.recommendPatternAgents(analysis.patterns));

			// Scale-based agents
			recommendations.push(...this.recommendScaleAgents(analysis.domain.scale, analysis.structure));

			// Sort by priority (high to low)
			const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
			recommendations.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);

			this.logService.info('[AgentRecommendationEngine] Generated recommendations', {
				total: recommendations.length,
				high: recommendations.filter(r => r.priority === 'high').length,
				medium: recommendations.filter(r => r.priority === 'medium').length,
				low: recommendations.filter(r => r.priority === 'low').length
			});

			return recommendations;

		} catch (error) {
			this.logService.error('[AgentRecommendationEngine] Failed to generate recommendations', error);
			throw error;
		}
	}

	private recommendCoreAgents(structure: Structure, technologies: Technologies): AgentRecommendation[] {
		const agents: AgentRecommendation[] = [];

		// Code reviewer - always recommend
		agents.push({
			agentType: 'code-reviewer',
			purpose: 'Review code changes for quality, security, and best practices',
			priority: 'high',
			reasoning: 'Code review is essential for maintaining code quality and catching issues early.',
			suggestedSkills: ['static-analysis', 'security-review', 'performance-analysis'],
			customInstructions: [
				'Focus on maintainability and readability',
				'Check for security vulnerabilities',
				'Ensure adherence to coding standards',
				'Validate error handling and edge cases'
			],
			configuration: {
				name: 'Code Reviewer',
				description: 'Reviews pull requests and code changes for quality and best practices',
				tools: ['Read', 'Grep', 'Glob'],
				temperature: 0.3
			}
		});

		// Architecture analyst for complex projects
		if (structure.directories.length > 10) {
			agents.push({
				agentType: 'architecture-analyst',
				purpose: 'Analyze and improve system architecture',
				priority: 'high',
				reasoning: 'Large codebase with many directories benefits from architectural oversight.',
				suggestedSkills: ['system-design', 'dependency-analysis', 'refactoring'],
				customInstructions: [
					'Focus on modularity and separation of concerns',
					'Identify architectural debt and improvement opportunities',
					'Ensure proper layering and dependency management'
				],
				configuration: {
					name: 'Architecture Analyst',
					description: 'Analyzes system architecture and suggests improvements',
					tools: ['Read', 'Grep', 'Glob', 'Task'],
					temperature: 0.4
				}
			});
		}

		return agents;
	}

	private recommendTechnologyAgents(technologies: Technologies): AgentRecommendation[] {
		const agents: AgentRecommendation[] = [];

		// React specialist
		const reactFramework = technologies.frameworks.find(f => f.name.toLowerCase().includes('react'));
		if (reactFramework) {
			agents.push({
				agentType: 'react-specialist',
				purpose: 'React development and best practices',
				priority: 'high',
				reasoning: `React framework detected with ${reactFramework.confidence * 100}% confidence.`,
				suggestedSkills: ['component-design', 'state-management', 'performance-optimization'],
				customInstructions: [
					'Follow React best practices and patterns',
					'Optimize component performance and re-renders',
					'Ensure proper state management',
					'Use modern React features appropriately'
				],
				configuration: {
					name: 'React Specialist',
					description: `React development specialist for ${reactFramework.name} ${reactFramework.version || 'latest'}`,
					tools: ['Read', 'Write', 'Edit', 'Bash'],
					temperature: 0.3
				}
			});
		}

		// Database specialist
		if (technologies.databases.length > 0) {
			agents.push({
				agentType: 'database-specialist',
				purpose: 'Database design and optimization',
				priority: 'medium',
				reasoning: `Project uses databases: ${technologies.databases.join(', ')}.`,
				suggestedSkills: ['query-optimization', 'schema-design', 'migration-management'],
				customInstructions: [
					'Optimize database queries and schema design',
					'Ensure proper indexing and performance',
					'Review migration scripts for safety',
					'Follow database best practices'
				],
				configuration: {
					name: 'Database Specialist',
					description: `Database specialist for ${technologies.databases.join(', ')}`,
					tools: ['Read', 'Write', 'Edit'],
					temperature: 0.3
				}
			});
		}

		// DevOps specialist for containerized deployments
		if (technologies.deployment.containerized) {
			agents.push({
				agentType: 'devops-specialist',
				purpose: 'DevOps and deployment optimization',
				priority: 'medium',
				reasoning: 'Project uses containerized deployment requiring DevOps expertise.',
				suggestedSkills: ['containerization', 'ci-cd', 'infrastructure-as-code'],
				customInstructions: [
					'Optimize Docker configurations and build processes',
					'Improve CI/CD pipeline efficiency',
					'Ensure security in deployment configurations',
					'Monitor and optimize infrastructure costs'
				],
				configuration: {
					name: 'DevOps Specialist',
					description: `DevOps specialist for ${technologies.deployment.platforms.join(', ')}`,
					tools: ['Read', 'Write', 'Edit', 'Bash'],
					temperature: 0.3
				}
			});
		}

		return agents;
	}

	private recommendDomainAgents(domain: Domain): AgentRecommendation[] {
		const agents: AgentRecommendation[] = [];

		// Security specialist for sensitive domains
		if (domain.compliance.regulations.length > 0 || domain.compliance.securityRequirements.length > 0) {
			agents.push({
				agentType: 'security-specialist',
				purpose: 'Security analysis and compliance',
				priority: 'high',
				reasoning: `Project has compliance requirements: ${domain.compliance.regulations.join(', ')}.`,
				suggestedSkills: ['security-audit', 'compliance-review', 'vulnerability-assessment'],
				customInstructions: [
					'Perform regular security audits',
					'Ensure compliance with regulations',
					'Review authentication and authorization',
					'Validate input sanitization and data protection'
				],
				configuration: {
					name: 'Security Specialist',
					description: 'Security and compliance specialist',
					tools: ['Read', 'Grep', 'Glob'],
					temperature: 0.2
				}
			});
		}

		// Performance specialist for large-scale projects
		if (domain.scale === 'enterprise' || domain.scale === 'large') {
			agents.push({
				agentType: 'performance-specialist',
				purpose: 'Performance optimization and monitoring',
				priority: 'high',
				reasoning: 'Large-scale project requires performance optimization.',
				suggestedSkills: ['performance-profiling', 'optimization', 'monitoring'],
				customInstructions: [
					'Monitor application performance metrics',
					'Identify and resolve performance bottlenecks',
					'Optimize algorithms and data structures',
					'Implement caching and scaling strategies'
				],
				configuration: {
					name: 'Performance Specialist',
					description: 'Performance optimization specialist',
					tools: ['Read', 'Grep', 'Bash'],
					temperature: 0.3
				}
			});
		}

		return agents;
	}

	private recommendPatternAgents(patterns: Patterns): AgentRecommendation[] {
		const agents: AgentRecommendation[] = [];

		// Refactoring specialist for inconsistent code
		const hasLowConsistency = patterns.namingConventions.some(nc => nc.consistency < 0.7);
		const hasMultiplePatterns = patterns.architecturalPatterns.length > 2;

		if (hasLowConsistency || hasMultiplePatterns) {
			agents.push({
				agentType: 'refactoring-specialist',
				purpose: 'Code refactoring and consistency improvement',
				priority: 'medium',
				reasoning: 'Code shows inconsistent patterns that could benefit from refactoring.',
				suggestedSkills: ['refactoring', 'code-consistency', 'pattern-recognition'],
				customInstructions: [
					'Improve code consistency and maintainability',
					'Refactor duplicate code and anti-patterns',
					'Standardize naming conventions',
					'Simplify complex code structures'
				],
				configuration: {
					name: 'Refactoring Specialist',
					description: 'Code refactoring and consistency specialist',
					tools: ['Read', 'Write', 'Edit', 'Grep'],
					temperature: 0.3
				}
			});
		}

		return agents;
	}

	private recommendScaleAgents(scale: string, structure: Structure): AgentRecommendation[] {
		const agents: AgentRecommendation[] = [];

		// Test specialist based on existing test structure
		if (structure.testStructure.hasTests) {
			agents.push({
				agentType: 'test-specialist',
				purpose: 'Test development and quality assurance',
				priority: 'high',
				reasoning: 'Project has existing tests indicating commitment to quality.',
				suggestedSkills: ['unit-testing', 'integration-testing', 'test-coverage'],
				customInstructions: [
					'Maintain and improve test coverage',
					'Write meaningful and maintainable tests',
					'Optimize test execution performance',
					'Ensure tests are reliable and deterministic'
				],
				configuration: {
					name: 'Test Specialist',
					description: `Testing specialist for ${structure.testStructure.testFrameworks.join(', ')}`,
					tools: ['Read', 'Write', 'Edit', 'Bash'],
					temperature: 0.3
				}
			});
		} else {
			// Test setup specialist for projects without tests
			agents.push({
				agentType: 'test-setup-specialist',
				purpose: 'Test infrastructure setup and configuration',
				priority: 'medium',
				reasoning: 'Project lacks test infrastructure which should be established.',
				suggestedSkills: ['test-framework-setup', 'ci-integration', 'test-strategy'],
				customInstructions: [
					'Set up appropriate testing framework',
					'Configure test runners and CI integration',
					'Establish testing conventions and guidelines',
					'Create initial test structure and examples'
				],
				configuration: {
					name: 'Test Setup Specialist',
					description: 'Test infrastructure setup specialist',
					tools: ['Read', 'Write', 'Edit', 'Bash'],
					temperature: 0.3
				}
			});
		}

		return agents;
	}
}