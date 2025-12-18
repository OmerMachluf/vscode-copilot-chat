/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BusinessDomain,
	DetectedTechnology,
	TechnologyCategory,
	WorkspaceProfile,
	ProjectCharacteristics,
	RecommendationContext,
	RecommendationResult,
	AgentRecommendation
} from '../common/domainTypes';
import {
	DOMAIN_KNOWLEDGE,
	TECHNOLOGY_PATTERNS,
	AGENT_CAPABILITIES,
	findDomainsForTechnologies,
	getDomainKnowledge,
	findCapabilitiesForTask,
	findCapabilitiesForDomain
} from '../common/domainKnowledgeBase';
import { AgentInfo } from '../../orchestrator/agentDiscoveryService';

/**
 * Core agent recommendation engine.
 * Analyzes workspace profiles and generates intelligent agent recommendations
 * based on detected technologies, business domain, and task context.
 */
export class AgentRecommendationEngine {
	/**
	 * Analyze workspace files and configuration to build a profile
	 */
	async analyzeWorkspace(
		fileList: string[],
		packageDependencies: Map<string, string>,
		fileContents: Map<string, string>
	): Promise<WorkspaceProfile> {
		// Detect technologies
		const technologies = this.detectTechnologies(fileList, packageDependencies, fileContents);

		// Infer domain from technologies
		const domainResult = this.inferDomain(technologies);

		// Detect patterns
		const patterns = this.detectPatterns(technologies, fileList, fileContents);

		// Detect compliance requirements
		const compliance = this.detectCompliance(domainResult.domain, technologies);

		// Analyze project characteristics
		const characteristics = this.analyzeCharacteristics(fileList, packageDependencies);

		return {
			domain: domainResult.domain,
			domainConfidence: domainResult.confidence,
			technologies,
			patterns,
			compliance,
			characteristics,
			analyzedAt: Date.now()
		};
	}

	/**
	 * Detect technologies from workspace files
	 */
	detectTechnologies(
		fileList: string[],
		packageDependencies: Map<string, string>,
		fileContents: Map<string, string>
	): DetectedTechnology[] {
		const detected: DetectedTechnology[] = [];
		const normalizedFiles = fileList.map(f => f.toLowerCase().replace(/\\/g, '/'));

		for (const pattern of TECHNOLOGY_PATTERNS) {
			const evidence: string[] = [];
			let confidence = 0;

			// Check file patterns
			if (pattern.filePatterns) {
				for (const filePattern of pattern.filePatterns) {
					const regex = this.globToRegex(filePattern);
					const matches = normalizedFiles.filter(f => regex.test(f));
					if (matches.length > 0) {
						evidence.push(`Files matching ${filePattern}: ${matches.length} found`);
						confidence += Math.min(0.3, matches.length * 0.05);
					}
				}
			}

			// Check config files
			if (pattern.configFiles) {
				for (const configFile of pattern.configFiles) {
					const configRegex = this.globToRegex(configFile);
					const hasConfig = normalizedFiles.some(f => configRegex.test(f));
					if (hasConfig) {
						evidence.push(`Config file: ${configFile}`);
						confidence += 0.4;
					}
				}
			}

			// Check package dependencies
			if (pattern.packageNames) {
				for (const pkgName of pattern.packageNames) {
					if (pkgName.includes('*')) {
						// Handle wildcard package names like @aws-sdk/*
						const pkgPrefix = pkgName.replace('/*', '').replace('*', '');
						const matches = Array.from(packageDependencies.keys()).filter(
							k => k.startsWith(pkgPrefix) || k.includes(pkgPrefix)
						);
						if (matches.length > 0) {
							evidence.push(`Package: ${matches.join(', ')}`);
							confidence += 0.5;
						}
					} else if (packageDependencies.has(pkgName)) {
						evidence.push(`Package: ${pkgName}@${packageDependencies.get(pkgName)}`);
						confidence += 0.5;
					}
				}
			}

			// Check content patterns
			if (pattern.contentPatterns) {
				for (const contentPattern of pattern.contentPatterns) {
					const contentRegex = new RegExp(contentPattern, 'i');
					for (const [file, content] of fileContents) {
						if (contentRegex.test(content)) {
							evidence.push(`Content match in: ${file}`);
							confidence += 0.2;
							break; // One match is enough
						}
					}
				}
			}

			// If we have any evidence, add the technology
			if (evidence.length > 0 && confidence > 0) {
				detected.push({
					id: pattern.technologyId,
					name: this.getTechnologyName(pattern.technologyId),
					category: this.getTechnologyCategory(pattern.technologyId),
					confidence: Math.min(1, confidence),
					evidence
				});
			}
		}

		// Sort by confidence
		return detected.sort((a, b) => b.confidence - a.confidence);
	}

	/**
	 * Infer business domain from detected technologies
	 */
	inferDomain(technologies: DetectedTechnology[]): { domain: BusinessDomain; confidence: number } {
		if (technologies.length === 0) {
			return { domain: 'general', confidence: 0.5 };
		}

		const domainScores = findDomainsForTechnologies(technologies);

		// Find domain-specific technologies that give strong signals
		const domainSignals = new Map<BusinessDomain, number>();

		for (const tech of technologies) {
			// Healthcare signals
			if (['hl7-fhir', 'hapi-fhir'].includes(tech.id)) {
				domainSignals.set('healthcare', (domainSignals.get('healthcare') ?? 0) + tech.confidence * 2);
			}

			// FinTech signals
			if (['stripe', 'plaid'].includes(tech.id)) {
				domainSignals.set('fintech', (domainSignals.get('fintech') ?? 0) + tech.confidence * 1.5);
			}

			// E-commerce signals
			if (['shopify', 'magento', 'woocommerce'].includes(tech.id)) {
				domainSignals.set('ecommerce', (domainSignals.get('ecommerce') ?? 0) + tech.confidence * 2);
			}

			// Gaming signals
			if (['unity', 'unreal', 'godot'].includes(tech.id)) {
				domainSignals.set('gaming', (domainSignals.get('gaming') ?? 0) + tech.confidence * 2);
			}

			// IoT signals
			if (['mqtt', 'influxdb', 'timescaledb', 'aws-iot'].includes(tech.id)) {
				domainSignals.set('iot', (domainSignals.get('iot') ?? 0) + tech.confidence * 1.5);
			}

			// AI/ML signals
			if (['pytorch', 'tensorflow', 'huggingface', 'langchain', 'openai'].includes(tech.id)) {
				domainSignals.set('ai-ml', (domainSignals.get('ai-ml') ?? 0) + tech.confidence * 1.5);
			}
		}

		// Combine scores from technology matching and domain signals
		const combinedScores = new Map<BusinessDomain, number>();
		for (const [domain, score] of domainScores) {
			combinedScores.set(domain, score + (domainSignals.get(domain) ?? 0));
		}
		for (const [domain, signal] of domainSignals) {
			if (!combinedScores.has(domain)) {
				combinedScores.set(domain, signal);
			}
		}

		// Find the best match
		let bestDomain: BusinessDomain = 'general';
		let bestScore = 0;

		for (const [domain, score] of combinedScores) {
			if (score > bestScore) {
				bestScore = score;
				bestDomain = domain;
			}
		}

		// Calculate confidence based on score relative to technology count
		const maxPossibleScore = technologies.reduce((sum, t) => sum + t.confidence, 0) * 2;
		const confidence = maxPossibleScore > 0 ? Math.min(1, bestScore / maxPossibleScore + 0.3) : 0.5;

		return {
			domain: bestDomain,
			confidence: Math.min(1, confidence)
		};
	}

	/**
	 * Detect architectural patterns from the codebase
	 */
	detectPatterns(
		technologies: DetectedTechnology[],
		fileList: string[],
		fileContents: Map<string, string>
	): string[] {
		const patterns: Set<string> = new Set();
		const normalizedFiles = fileList.map(f => f.toLowerCase().replace(/\\/g, '/'));

		// Microservices indicators
		if (normalizedFiles.some(f => f.includes('docker-compose') || f.includes('kubernetes'))) {
			patterns.add('microservices');
		}

		// Event sourcing indicators
		const hasKafka = technologies.some(t => t.id === 'kafka');
		const hasEventStore = normalizedFiles.some(f => f.includes('event') && f.includes('store'));
		if (hasKafka || hasEventStore) {
			patterns.add('event-sourcing');
		}

		// API Gateway pattern
		if (normalizedFiles.some(f => f.includes('gateway') || f.includes('api-gateway'))) {
			patterns.add('api-gateway');
		}

		// MVC pattern
		if (normalizedFiles.some(f =>
			f.includes('/controllers/') ||
			f.includes('/views/') ||
			f.includes('/models/')
		)) {
			patterns.add('mvc');
		}

		// Repository pattern
		if (normalizedFiles.some(f => f.includes('/repositories/') || f.includes('repository.'))) {
			patterns.add('repository-pattern');
		}

		// CQRS pattern
		if (normalizedFiles.some(f =>
			(f.includes('command') && f.includes('handler')) ||
			(f.includes('query') && f.includes('handler'))
		)) {
			patterns.add('cqrs');
		}

		// Domain-Driven Design
		if (normalizedFiles.some(f =>
			f.includes('/domain/') ||
			f.includes('/aggregates/') ||
			f.includes('/valueobjects/')
		)) {
			patterns.add('domain-driven-design');
		}

		// Clean Architecture / Hexagonal
		if (normalizedFiles.some(f =>
			f.includes('/application/') &&
			f.includes('/infrastructure/') &&
			f.includes('/domain/')
		)) {
			patterns.add('clean-architecture');
		}

		// Feature flags
		for (const content of fileContents.values()) {
			if (/feature.*flag|launch.*darkly|split\.io|flagsmith/i.test(content)) {
				patterns.add('feature-flags');
				break;
			}
		}

		return Array.from(patterns);
	}

	/**
	 * Detect applicable compliance requirements
	 */
	detectCompliance(domain: BusinessDomain, technologies: DetectedTechnology[]): string[] {
		const compliance: Set<string> = new Set();
		const domainKnowledge = getDomainKnowledge(domain);

		if (domainKnowledge) {
			// Add all compliance requirements for the detected domain
			for (const req of domainKnowledge.compliance) {
				compliance.add(req.id);
			}
		}

		// Technology-specific compliance
		const hasStripe = technologies.some(t => t.id === 'stripe');
		const hasPlaid = technologies.some(t => t.id === 'plaid');
		if (hasStripe || hasPlaid) {
			compliance.add('PCI-DSS');
		}

		const hasHealthcare = technologies.some(t => ['hl7-fhir', 'hapi-fhir'].includes(t.id));
		if (hasHealthcare) {
			compliance.add('HIPAA');
		}

		// GDPR is generally applicable
		compliance.add('GDPR');

		return Array.from(compliance);
	}

	/**
	 * Analyze project characteristics
	 */
	analyzeCharacteristics(
		fileList: string[],
		packageDependencies: Map<string, string>
	): ProjectCharacteristics {
		const normalizedFiles = fileList.map(f => f.toLowerCase().replace(/\\/g, '/'));

		// Estimate size
		let size: ProjectCharacteristics['size'] = 'small';
		if (fileList.length > 1000) {
			size = 'enterprise';
		} else if (fileList.length > 500) {
			size = 'large';
		} else if (fileList.length > 100) {
			size = 'medium';
		}

		// Estimate complexity based on technologies and patterns
		let complexityScore = 0;
		complexityScore += Math.min(5, packageDependencies.size / 20);
		complexityScore += Math.min(3, fileList.length / 200);

		let complexity: ProjectCharacteristics['complexity'] = 'low';
		if (complexityScore > 6) {
			complexity = 'very-high';
		} else if (complexityScore > 4) {
			complexity = 'high';
		} else if (complexityScore > 2) {
			complexity = 'medium';
		}

		// Detect primary language
		const languageCounts = new Map<string, number>();
		const languageExtensions: Record<string, string> = {
			'.ts': 'typescript',
			'.tsx': 'typescript',
			'.js': 'javascript',
			'.jsx': 'javascript',
			'.py': 'python',
			'.java': 'java',
			'.cs': 'csharp',
			'.go': 'go',
			'.rs': 'rust',
			'.rb': 'ruby',
			'.php': 'php'
		};

		for (const file of fileList) {
			for (const [ext, lang] of Object.entries(languageExtensions)) {
				if (file.endsWith(ext)) {
					languageCounts.set(lang, (languageCounts.get(lang) ?? 0) + 1);
					break;
				}
			}
		}

		let primaryLanguage: string | undefined;
		let maxCount = 0;
		for (const [lang, count] of languageCounts) {
			if (count > maxCount) {
				maxCount = count;
				primaryLanguage = lang;
			}
		}

		// Detect features
		const hasTests = normalizedFiles.some(f =>
			f.includes('test') ||
			f.includes('spec') ||
			f.includes('__tests__')
		);

		const hasCICD = normalizedFiles.some(f =>
			f.includes('.github/workflows') ||
			f.includes('.gitlab-ci') ||
			f.includes('jenkinsfile') ||
			f.includes('azure-pipelines') ||
			f.includes('.circleci')
		);

		const hasDocumentation = normalizedFiles.some(f =>
			f.includes('readme') ||
			f.includes('docs/') ||
			f.includes('documentation')
		);

		const isMonorepo = normalizedFiles.some(f =>
			f.includes('packages/') ||
			f.includes('apps/') ||
			f.includes('lerna.json') ||
			f.includes('pnpm-workspace') ||
			f.includes('nx.json')
		);

		const hasContainerization = normalizedFiles.some(f =>
			f.includes('dockerfile') ||
			f.includes('docker-compose')
		);

		return {
			size,
			complexity,
			primaryLanguage,
			hasTests,
			hasCICD,
			hasDocumentation,
			isMonorepo,
			hasContainerization
		};
	}

	/**
	 * Generate agent recommendations based on context
	 */
	generateRecommendations(
		context: RecommendationContext,
		availableAgents: AgentInfo[]
	): RecommendationResult {
		const recommendations: AgentRecommendation[] = [];
		const { workspaceProfile, currentTask, preferences } = context;

		// Get domain-specific capabilities
		const domainCapabilities = findCapabilitiesForDomain(workspaceProfile.domain);

		// Get task-specific capabilities if we have a current task
		const taskCapabilities = currentTask
			? findCapabilitiesForTask(currentTask.split(/\s+/))
			: [];

		// Score each available agent
		for (const agent of availableAgents) {
			// Skip excluded agents
			if (preferences?.excludedAgents?.includes(agent.id)) {
				continue;
			}

			const { score, reasons, matchedCapabilities } = this.scoreAgent(
				agent,
				workspaceProfile,
				domainCapabilities,
				taskCapabilities,
				currentTask
			);

			// Add preference boost
			let finalScore = score;
			if (preferences?.preferredAgents?.includes(agent.id)) {
				finalScore = Math.min(1, finalScore + 0.3);
				reasons.push('User preferred agent');
			}

			// Generate suggested use cases
			const suggestedUseCases = this.generateUseCases(agent, workspaceProfile);

			recommendations.push({
				agentId: agent.id,
				agentName: agent.name,
				score: finalScore,
				reasons,
				matchedCapabilities,
				suggestedUseCases
			});
		}

		// Sort by score (highest first)
		recommendations.sort((a, b) => b.score - a.score);

		// Calculate overall confidence
		const topScores = recommendations.slice(0, 3).map(r => r.score);
		const avgTopScore = topScores.length > 0
			? topScores.reduce((a, b) => a + b, 0) / topScores.length
			: 0;
		const confidence = avgTopScore * workspaceProfile.domainConfidence;

		// Generate suggestions for improving recommendations
		const suggestions = this.generateSuggestions(workspaceProfile, recommendations);

		return {
			recommendations,
			workspaceProfile,
			confidence,
			suggestions
		};
	}

	/**
	 * Score an agent against the current context
	 */
	private scoreAgent(
		agent: AgentInfo,
		profile: WorkspaceProfile,
		domainCapabilities: ReturnType<typeof findCapabilitiesForDomain>,
		taskCapabilities: ReturnType<typeof findCapabilitiesForTask>,
		currentTask?: string
	): { score: number; reasons: string[]; matchedCapabilities: string[] } {
		let score = 0;
		const reasons: string[] = [];
		const matchedCapabilities: string[] = [];

		// Match agent capabilities with domain capabilities
		const agentCaps = agent.capabilities ?? [];
		for (const cap of agentCaps) {
			const matchingDomainCap = domainCapabilities.find(dc =>
				dc.id === cap || dc.taskTypes.some(t => cap.includes(t))
			);
			if (matchingDomainCap) {
				score += 0.2;
				matchedCapabilities.push(matchingDomainCap.name);
				reasons.push(`Capability "${matchingDomainCap.name}" matches domain ${profile.domain}`);
			}
		}

		// Match with task capabilities
		for (const cap of agentCaps) {
			const matchingTaskCap = taskCapabilities.find(tc =>
				tc.id === cap || tc.taskTypes.some(t => cap.includes(t))
			);
			if (matchingTaskCap) {
				score += 0.3;
				if (!matchedCapabilities.includes(matchingTaskCap.name)) {
					matchedCapabilities.push(matchingTaskCap.name);
				}
				reasons.push(`Capability "${matchingTaskCap.name}" matches current task`);
			}
		}

		// Technology match
		const agentTools = agent.tools ?? [];
		for (const tech of profile.technologies) {
			if (agentTools.some(t => t.toLowerCase().includes(tech.id.toLowerCase()))) {
				score += 0.1 * tech.confidence;
				reasons.push(`Tool support for ${tech.name}`);
			}
		}

		// Task keyword matching
		if (currentTask) {
			const taskLower = currentTask.toLowerCase();
			const agentDescLower = agent.description.toLowerCase();

			// Check for action keywords
			const actionKeywords = ['create', 'fix', 'implement', 'refactor', 'test', 'document', 'review', 'deploy'];
			for (const keyword of actionKeywords) {
				if (taskLower.includes(keyword) && agentDescLower.includes(keyword)) {
					score += 0.15;
					reasons.push(`Agent description matches task action "${keyword}"`);
				}
			}
		}

		// Base score for built-in agents (they're generally well-suited)
		if (agent.source === 'builtin') {
			score += 0.1;
		}

		// Normalize score
		score = Math.min(1, Math.max(0, score));

		return { score, reasons, matchedCapabilities };
	}

	/**
	 * Generate suggested use cases for an agent
	 */
	private generateUseCases(agent: AgentInfo, profile: WorkspaceProfile): string[] {
		const useCases: string[] = [];
		const agentCaps = agent.capabilities ?? [];

		if (agentCaps.includes('code-generation')) {
			useCases.push(`Generate ${profile.primaryLanguage ?? 'code'} based on specifications`);
		}

		if (agentCaps.includes('refactoring')) {
			useCases.push('Improve code structure and maintainability');
		}

		if (agentCaps.includes('bug-fixing')) {
			useCases.push('Debug and fix issues in the codebase');
		}

		if (agentCaps.includes('testing') && !profile.characteristics.hasTests) {
			useCases.push('Add test coverage to the project');
		}

		if (agentCaps.includes('documentation') && !profile.characteristics.hasDocumentation) {
			useCases.push('Create or improve project documentation');
		}

		// Domain-specific use cases
		const domainKnowledge = getDomainKnowledge(profile.domain);
		if (domainKnowledge) {
			const pattern = domainKnowledge.patterns[0];
			if (pattern) {
				useCases.push(`Implement ${pattern.name} pattern for ${profile.domain} use case`);
			}
		}

		return useCases.slice(0, 5);
	}

	/**
	 * Generate suggestions for improving recommendations
	 */
	private generateSuggestions(
		profile: WorkspaceProfile,
		recommendations: AgentRecommendation[]
	): string[] {
		const suggestions: string[] = [];

		if (profile.domainConfidence < 0.5) {
			suggestions.push('Add domain-specific configuration or dependencies for better domain detection');
		}

		if (profile.technologies.length < 3) {
			suggestions.push('More technology indicators would improve recommendation accuracy');
		}

		if (!profile.characteristics.hasTests) {
			suggestions.push('Consider adding tests to enable testing-focused agent recommendations');
		}

		if (recommendations.length === 0) {
			suggestions.push('No matching agents found. Consider defining custom agents for your workflow');
		}

		return suggestions;
	}

	/**
	 * Convert glob pattern to regex
	 */
	private globToRegex(glob: string): RegExp {
		const escaped = glob
			.replace(/[.+^${}()|[\]\\]/g, '\\$&')
			.replace(/\*\*/g, '.*')
			.replace(/\*/g, '[^/]*')
			.replace(/\?/g, '.');
		return new RegExp(`(^|/)${escaped}$`, 'i');
	}

	/**
	 * Get human-readable name for a technology
	 */
	private getTechnologyName(id: string): string {
		const names: Record<string, string> = {
			'react': 'React',
			'vue': 'Vue.js',
			'angular': 'Angular',
			'nextjs': 'Next.js',
			'svelte': 'Svelte',
			'nodejs': 'Node.js',
			'express': 'Express.js',
			'fastify': 'Fastify',
			'nestjs': 'NestJS',
			'django': 'Django',
			'flask': 'Flask',
			'fastapi': 'FastAPI',
			'spring-boot': 'Spring Boot',
			'rails': 'Ruby on Rails',
			'dotnet': '.NET',
			'go': 'Go',
			'rust': 'Rust',
			'postgresql': 'PostgreSQL',
			'mysql': 'MySQL',
			'mongodb': 'MongoDB',
			'redis': 'Redis',
			'elasticsearch': 'Elasticsearch',
			'docker': 'Docker',
			'kubernetes': 'Kubernetes',
			'terraform': 'Terraform',
			'github-actions': 'GitHub Actions',
			'jenkins': 'Jenkins',
			'jest': 'Jest',
			'pytest': 'pytest',
			'mocha': 'Mocha',
			'cypress': 'Cypress',
			'playwright': 'Playwright',
			'aws': 'AWS',
			'azure': 'Azure',
			'gcp': 'Google Cloud',
			'hl7-fhir': 'HL7 FHIR',
			'stripe': 'Stripe',
			'plaid': 'Plaid',
			'shopify': 'Shopify',
			'pytorch': 'PyTorch',
			'tensorflow': 'TensorFlow',
			'huggingface': 'Hugging Face',
			'langchain': 'LangChain',
			'openai': 'OpenAI'
		};
		return names[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
	}

	/**
	 * Get category for a technology
	 */
	private getTechnologyCategory(id: string): TechnologyCategory {
		const categories: Record<string, TechnologyCategory> = {
			// Frontend
			'react': 'frontend',
			'vue': 'frontend',
			'angular': 'frontend',
			'nextjs': 'frontend',
			'svelte': 'frontend',
			// Backend
			'nodejs': 'backend',
			'express': 'backend',
			'fastify': 'backend',
			'nestjs': 'backend',
			'django': 'backend',
			'flask': 'backend',
			'fastapi': 'backend',
			'spring-boot': 'backend',
			'rails': 'backend',
			'dotnet': 'backend',
			'go': 'backend',
			'rust': 'backend',
			// Database
			'postgresql': 'database',
			'mysql': 'database',
			'mongodb': 'database',
			'redis': 'database',
			'elasticsearch': 'database',
			// DevOps
			'docker': 'devops',
			'kubernetes': 'devops',
			'terraform': 'devops',
			'github-actions': 'devops',
			'jenkins': 'devops',
			'aws': 'devops',
			'azure': 'devops',
			'gcp': 'devops',
			// Testing
			'jest': 'testing',
			'pytest': 'testing',
			'mocha': 'testing',
			'cypress': 'testing',
			'playwright': 'testing',
			// Security
			'stripe': 'security',
			'plaid': 'security'
		};
		return categories[id] ?? 'backend';
	}
}

/**
 * Singleton instance for convenience
 */
let _engineInstance: AgentRecommendationEngine | undefined;

export function getRecommendationEngine(): AgentRecommendationEngine {
	if (!_engineInstance) {
		_engineInstance = new AgentRecommendationEngine();
	}
	return _engineInstance;
}
