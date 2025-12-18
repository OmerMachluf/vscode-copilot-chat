/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BusinessDomain,
	WorkspaceProfile,
	AgentRecommendation,
	DomainKnowledge
} from '../common/domainTypes';
import { getDomainKnowledge } from '../common/domainKnowledgeBase';
import { AgentInfo } from '../../orchestrator/agentDiscoveryService';

/**
 * Configuration for instruction generation
 */
export interface InstructionGeneratorConfig {
	/** Include compliance considerations */
	includeCompliance: boolean;
	/** Include security best practices */
	includeSecurity: boolean;
	/** Include domain-specific patterns */
	includePatterns: boolean;
	/** Include integration guidance */
	includeIntegrations: boolean;
	/** Maximum instruction length (characters) */
	maxLength?: number;
	/** Verbosity level */
	verbosity: 'minimal' | 'standard' | 'detailed';
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: InstructionGeneratorConfig = {
	includeCompliance: true,
	includeSecurity: true,
	includePatterns: true,
	includeIntegrations: false,
	maxLength: 4000,
	verbosity: 'standard'
};

/**
 * Result of instruction generation
 */
export interface GeneratedInstructions {
	/** The generated instruction text */
	instructions: string;
	/** Domain-specific section */
	domainSection?: string;
	/** Technology-specific section */
	technologySection?: string;
	/** Compliance section */
	complianceSection?: string;
	/** Security section */
	securitySection?: string;
	/** Best practices section */
	bestPracticesSection?: string;
	/** Metadata about generation */
	metadata: {
		domain: BusinessDomain;
		agentId: string;
		generatedAt: number;
		characterCount: number;
	};
}

/**
 * Generates custom instructions for agents based on workspace profile and domain knowledge.
 * These instructions enhance agent performance by providing context-aware guidance.
 */
export class CustomInstructionGenerator {
	private readonly config: InstructionGeneratorConfig;

	constructor(config: Partial<InstructionGeneratorConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Generate custom instructions for an agent based on the workspace profile
	 */
	generateInstructions(
		agent: AgentInfo,
		profile: WorkspaceProfile,
		recommendation?: AgentRecommendation
	): GeneratedInstructions {
		const domainKnowledge = getDomainKnowledge(profile.domain);
		const sections: string[] = [];

		// Header
		sections.push(this.generateHeader(agent, profile));

		// Domain section
		const domainSection = this.generateDomainSection(profile, domainKnowledge);
		if (domainSection) {
			sections.push(domainSection);
		}

		// Technology section
		const technologySection = this.generateTechnologySection(profile);
		if (technologySection) {
			sections.push(technologySection);
		}

		// Compliance section
		let complianceSection: string | undefined;
		if (this.config.includeCompliance && domainKnowledge) {
			complianceSection = this.generateComplianceSection(profile, domainKnowledge);
			if (complianceSection) {
				sections.push(complianceSection);
			}
		}

		// Security section
		let securitySection: string | undefined;
		if (this.config.includeSecurity && domainKnowledge) {
			securitySection = this.generateSecuritySection(domainKnowledge);
			if (securitySection) {
				sections.push(securitySection);
			}
		}

		// Best practices section
		const bestPracticesSection = this.generateBestPracticesSection(profile, domainKnowledge);
		if (bestPracticesSection) {
			sections.push(bestPracticesSection);
		}

		// Agent-specific guidance
		const agentGuidance = this.generateAgentGuidance(agent, profile, recommendation);
		if (agentGuidance) {
			sections.push(agentGuidance);
		}

		// Combine and truncate if needed
		let instructions = sections.join('\n\n');
		if (this.config.maxLength && instructions.length > this.config.maxLength) {
			instructions = this.truncateInstructions(instructions, this.config.maxLength);
		}

		return {
			instructions,
			domainSection,
			technologySection,
			complianceSection,
			securitySection,
			bestPracticesSection,
			metadata: {
				domain: profile.domain,
				agentId: agent.id,
				generatedAt: Date.now(),
				characterCount: instructions.length
			}
		};
	}

	/**
	 * Generate header section
	 */
	private generateHeader(agent: AgentInfo, profile: WorkspaceProfile): string {
		const lines: string[] = [];
		lines.push(`# Context-Aware Instructions for ${agent.name}`);
		lines.push('');
		lines.push(`This workspace has been identified as a **${this.getDomainDisplayName(profile.domain)}** project.`);

		if (profile.characteristics.primaryLanguage) {
			lines.push(`Primary language: **${profile.characteristics.primaryLanguage}**`);
		}

		lines.push(`Project size: ${profile.characteristics.size}, Complexity: ${profile.characteristics.complexity}`);

		return lines.join('\n');
	}

	/**
	 * Generate domain-specific section
	 */
	private generateDomainSection(
		profile: WorkspaceProfile,
		domainKnowledge: DomainKnowledge | undefined
	): string | undefined {
		if (!domainKnowledge || profile.domain === 'general') {
			return undefined;
		}

		const lines: string[] = [];
		lines.push(`## ${this.getDomainDisplayName(profile.domain)} Domain Context`);
		lines.push('');

		// Patterns
		if (this.config.includePatterns && domainKnowledge.patterns.length > 0) {
			lines.push('### Common Patterns');
			const patternsToShow = this.config.verbosity === 'detailed'
				? domainKnowledge.patterns
				: domainKnowledge.patterns.slice(0, 3);

			for (const pattern of patternsToShow) {
				lines.push(`- **${pattern.name}**: ${pattern.description}`);
				if (this.config.verbosity === 'detailed') {
					lines.push(`  - Use case: ${pattern.useCase}`);
				}
			}
			lines.push('');
		}

		// Integrations
		if (this.config.includeIntegrations && domainKnowledge.integrations.length > 0) {
			lines.push('### Common Integrations');
			const integrationsToShow = this.config.verbosity === 'detailed'
				? domainKnowledge.integrations
				: domainKnowledge.integrations.slice(0, 5);
			lines.push(integrationsToShow.map(i => `- ${i}`).join('\n'));
			lines.push('');
		}

		return lines.length > 2 ? lines.join('\n') : undefined;
	}

	/**
	 * Generate technology-specific section
	 */
	private generateTechnologySection(profile: WorkspaceProfile): string | undefined {
		if (profile.technologies.length === 0) {
			return undefined;
		}

		const lines: string[] = [];
		lines.push('## Detected Technologies');
		lines.push('');

		// Group by category
		const byCategory = new Map<string, typeof profile.technologies>();
		for (const tech of profile.technologies) {
			const category = tech.category;
			if (!byCategory.has(category)) {
				byCategory.set(category, []);
			}
			byCategory.get(category)!.push(tech);
		}

		for (const [category, techs] of byCategory) {
			const topTechs = this.config.verbosity === 'detailed'
				? techs.slice(0, 10)
				: techs.slice(0, 5);

			if (topTechs.length > 0) {
				const techList = topTechs.map(t => {
					const version = t.version ? ` (${t.version})` : '';
					return `${t.name}${version}`;
				}).join(', ');
				lines.push(`- **${this.capitalizeFirst(category)}**: ${techList}`);
			}
		}

		// Detected patterns
		if (profile.patterns.length > 0) {
			lines.push('');
			lines.push('**Detected Architectural Patterns:**');
			lines.push(profile.patterns.map(p => `- ${this.formatPatternName(p)}`).join('\n'));
		}

		return lines.join('\n');
	}

	/**
	 * Generate compliance section
	 */
	private generateComplianceSection(
		profile: WorkspaceProfile,
		domainKnowledge: DomainKnowledge
	): string | undefined {
		if (profile.compliance.length === 0) {
			return undefined;
		}

		const lines: string[] = [];
		lines.push('## Compliance Requirements');
		lines.push('');
		lines.push('⚠️ **Important**: This project may be subject to the following compliance requirements:');
		lines.push('');

		for (const complianceId of profile.compliance) {
			const requirement = domainKnowledge.compliance.find(c => c.id === complianceId);
			if (requirement) {
				lines.push(`### ${requirement.name} (${requirement.id})`);
				lines.push(requirement.description);
				if (this.config.verbosity === 'detailed' && requirement.affectedAreas.length > 0) {
					lines.push(`- Affected areas: ${requirement.affectedAreas.join(', ')}`);
				}
				lines.push('');
			} else {
				lines.push(`- **${complianceId}**`);
			}
		}

		lines.push('When generating or modifying code, ensure compliance with these requirements.');

		return lines.join('\n');
	}

	/**
	 * Generate security section
	 */
	private generateSecuritySection(domainKnowledge: DomainKnowledge): string | undefined {
		if (domainKnowledge.securityConsiderations.length === 0) {
			return undefined;
		}

		const lines: string[] = [];
		lines.push('## Security Considerations');
		lines.push('');

		const considerationsToShow = this.config.verbosity === 'detailed'
			? domainKnowledge.securityConsiderations
			: domainKnowledge.securityConsiderations.slice(0, 5);

		for (const consideration of considerationsToShow) {
			lines.push(`- ${consideration}`);
		}

		return lines.join('\n');
	}

	/**
	 * Generate best practices section
	 */
	private generateBestPracticesSection(
		profile: WorkspaceProfile,
		domainKnowledge: DomainKnowledge | undefined
	): string | undefined {
		const lines: string[] = [];
		lines.push('## Best Practices');
		lines.push('');

		// Domain-specific best practices
		if (domainKnowledge && domainKnowledge.bestPractices.length > 0) {
			const practiceCount = this.config.verbosity === 'detailed' ? 8 : 4;
			const practices = domainKnowledge.bestPractices.slice(0, practiceCount);
			for (const practice of practices) {
				lines.push(`- ${practice}`);
			}
		}

		// Project-specific recommendations
		if (!profile.characteristics.hasTests) {
			lines.push('- Consider adding test coverage for critical functionality');
		}
		if (!profile.characteristics.hasDocumentation) {
			lines.push('- Document public APIs and complex logic');
		}
		if (profile.characteristics.complexity === 'high' || profile.characteristics.complexity === 'very-high') {
			lines.push('- Break complex operations into smaller, testable functions');
		}

		return lines.length > 2 ? lines.join('\n') : undefined;
	}

	/**
	 * Generate agent-specific guidance
	 */
	private generateAgentGuidance(
		agent: AgentInfo,
		profile: WorkspaceProfile,
		recommendation?: AgentRecommendation
	): string | undefined {
		const lines: string[] = [];
		lines.push('## Agent Guidance');
		lines.push('');

		// Based on agent capabilities
		const capabilities = agent.capabilities ?? [];

		if (capabilities.includes('code-generation')) {
			lines.push('### Code Generation');
			lines.push(`- Generate ${profile.characteristics.primaryLanguage ?? ''} code following project conventions`);
			if (profile.patterns.length > 0) {
				lines.push(`- Follow established patterns: ${profile.patterns.slice(0, 3).join(', ')}`);
			}
		}

		if (capabilities.includes('refactoring')) {
			lines.push('### Refactoring');
			lines.push('- Maintain backward compatibility when refactoring');
			lines.push('- Ensure tests pass after refactoring');
		}

		if (capabilities.includes('bug-fixing')) {
			lines.push('### Bug Fixing');
			lines.push('- Identify root cause before applying fixes');
			lines.push('- Add tests to prevent regression');
		}

		// Use case suggestions from recommendation
		if (recommendation && recommendation.suggestedUseCases.length > 0) {
			lines.push('');
			lines.push('### Suggested Use Cases');
			for (const useCase of recommendation.suggestedUseCases) {
				lines.push(`- ${useCase}`);
			}
		}

		return lines.length > 2 ? lines.join('\n') : undefined;
	}

	/**
	 * Truncate instructions to max length while preserving structure
	 */
	private truncateInstructions(instructions: string, maxLength: number): string {
		if (instructions.length <= maxLength) {
			return instructions;
		}

		// Try to truncate at a section boundary
		const sections = instructions.split('\n## ');
		let result = sections[0];

		for (let i = 1; i < sections.length; i++) {
			const next = '\n## ' + sections[i];
			if (result.length + next.length > maxLength - 50) {
				break;
			}
			result += next;
		}

		// Add truncation notice
		if (result.length < instructions.length) {
			result += '\n\n*[Instructions truncated for length]*';
		}

		return result;
	}

	/**
	 * Get display name for a domain
	 */
	private getDomainDisplayName(domain: BusinessDomain): string {
		const names: Record<BusinessDomain, string> = {
			'fintech': 'Financial Technology (FinTech)',
			'healthcare': 'Healthcare & Life Sciences',
			'ecommerce': 'E-Commerce & Retail',
			'enterprise': 'Enterprise Software',
			'gaming': 'Gaming & Interactive',
			'iot': 'Internet of Things (IoT)',
			'ai-ml': 'AI & Machine Learning',
			'general': 'General Software Development'
		};
		return names[domain] ?? domain;
	}

	/**
	 * Format pattern name for display
	 */
	private formatPatternName(pattern: string): string {
		return pattern
			.split('-')
			.map(word => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ');
	}

	/**
	 * Capitalize first letter
	 */
	private capitalizeFirst(str: string): string {
		return str.charAt(0).toUpperCase() + str.slice(1);
	}
}

/**
 * Generate instructions for a specific domain and agent combination.
 * Convenience function for quick instruction generation.
 */
export function generateDomainInstructions(
	domain: BusinessDomain,
	agentCapabilities: string[],
	options: {
		includeCompliance?: boolean;
		includeSecurity?: boolean;
		verbosity?: 'minimal' | 'standard' | 'detailed';
	} = {}
): string {
	const domainKnowledge = getDomainKnowledge(domain);
	if (!domainKnowledge) {
		return '';
	}

	const lines: string[] = [];

	// Domain intro
	lines.push(`# ${domain.charAt(0).toUpperCase() + domain.slice(1)} Domain Guidelines`);
	lines.push('');

	// Key patterns
	if (domainKnowledge.patterns.length > 0) {
		lines.push('## Key Patterns');
		for (const pattern of domainKnowledge.patterns.slice(0, 3)) {
			lines.push(`- **${pattern.name}**: ${pattern.description}`);
		}
		lines.push('');
	}

	// Compliance
	if (options.includeCompliance !== false && domainKnowledge.compliance.length > 0) {
		lines.push('## Compliance');
		for (const req of domainKnowledge.compliance) {
			lines.push(`- **${req.id}**: ${req.name}`);
		}
		lines.push('');
	}

	// Security
	if (options.includeSecurity !== false && domainKnowledge.securityConsiderations.length > 0) {
		lines.push('## Security');
		for (const sec of domainKnowledge.securityConsiderations.slice(0, 4)) {
			lines.push(`- ${sec}`);
		}
		lines.push('');
	}

	// Best practices
	if (domainKnowledge.bestPractices.length > 0) {
		lines.push('## Best Practices');
		for (const practice of domainKnowledge.bestPractices.slice(0, 4)) {
			lines.push(`- ${practice}`);
		}
	}

	return lines.join('\n');
}

/**
 * Generate a brief instruction snippet for inline use
 */
export function generateBriefInstructions(
	profile: WorkspaceProfile,
	taskContext?: string
): string {
	const parts: string[] = [];

	// Domain context
	if (profile.domain !== 'general') {
		parts.push(`[${profile.domain.toUpperCase()} context]`);
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

/**
 * Singleton instance for convenience
 */
let _generatorInstance: CustomInstructionGenerator | undefined;

export function getInstructionGenerator(
	config?: Partial<InstructionGeneratorConfig>
): CustomInstructionGenerator {
	if (!_generatorInstance || config) {
		_generatorInstance = new CustomInstructionGenerator(config);
	}
	return _generatorInstance;
}
