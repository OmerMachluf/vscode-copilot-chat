/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SkillsService, formatSkillsForPrompt } from '../../skillsService';
import { AgentInstructionService, AgentDefinition } from '../../agentInstructionService';
import { registerCustomAgents, clearCustomAgentSlashCommands, parseAgentType, getAllSlashCommands } from '../../agentTypeParser';

/**
 * Integration tests for Skills, Architecture Access, and Custom Agent features.
 *
 * These tests verify the integration between:
 * - SkillsService for skill discovery and loading
 * - AgentInstructionService for architecture document access control
 * - agentTypeParser for custom agent slash command generation
 */

describe('Skills and Architecture Integration', () => {
	describe('SkillsService Integration', () => {
		let skillsService: SkillsService;

		beforeEach(() => {
			// Create service with minimal mocks
			skillsService = new SkillsService(
				{} as any, // fileSystemService
				{} as any  // extensionContext
			);
		});

		describe('Skill Reference Parsing', () => {
			it('should parse multiple skill references from complex prompt', () => {
				const prompt = `
					Please help me with this task.
					I need to use #skill:microservices patterns and #skill:design-patterns knowledge.
					Also consider #skill:security-best-practices.
				`;

				const refs = skillsService.parseSkillReferences(prompt);

				expect(refs).toHaveLength(3);
				expect(refs.map(r => r.skillId)).toEqual([
					'microservices',
					'design-patterns',
					'security-best-practices',
				]);
			});

			it('should handle skill references in code blocks', () => {
				const prompt = `
					Use the following approach:
					\`\`\`
					// Reference: #skill:api-patterns
					const api = createApi();
					\`\`\`
					And also #skill:error-handling patterns.
				`;

				const refs = skillsService.parseSkillReferences(prompt);

				expect(refs).toHaveLength(2);
				expect(refs[0].skillId).toBe('api-patterns');
				expect(refs[1].skillId).toBe('error-handling');
			});

			it('should not parse invalid skill patterns', () => {
				const prompt = `
					This is not a skill: skill:nohash
					Neither is this: #skill (no colon)
					Or this: #skill: (empty name)
				`;

				const refs = skillsService.parseSkillReferences(prompt);

				expect(refs).toHaveLength(0);
			});
		});

		describe('formatSkillsForPrompt', () => {
			it('should format multiple skills correctly', () => {
				const skills = [
					{
						id: 'microservices',
						name: 'Microservices Patterns',
						description: 'Patterns for microservice architecture',
						keywords: ['microservice', 'distributed'],
						content: '# Service Communication\n\nUse REST or gRPC...',
						source: 'repo' as const,
					},
					{
						id: 'security',
						name: 'Security Best Practices',
						description: 'Security guidelines',
						keywords: ['security', 'auth'],
						content: '# Authentication\n\nUse JWT tokens...',
						source: 'builtin' as const,
					},
				];

				const result = formatSkillsForPrompt(skills);

				expect(result).toContain('## Referenced Skills');
				expect(result).toContain('### Microservices Patterns');
				expect(result).toContain('### Security Best Practices');
				expect(result).toContain('Service Communication');
				expect(result).toContain('Authentication');
			});
		});
	});

	describe('Architecture Access Control', () => {
		describe('AgentDefinition with hasArchitectureAccess', () => {
			it('should parse hasArchitectureAccess: true correctly', () => {
				const content = `---
name: Architect
description: System architect
hasArchitectureAccess: true
tools: ['search', 'read_file']
---
You are an architect.`;

				const service = new AgentInstructionService({} as any, {} as any);
				const def = service.parseAgentDefinition(content, 'builtin');

				expect(def).toBeDefined();
				expect(def!.hasArchitectureAccess).toBe(true);
			});

			it('should parse hasArchitectureAccess: false correctly', () => {
				const content = `---
name: Agent
description: Implementation agent
hasArchitectureAccess: false
tools: ['edit', 'create']
---
You implement code.`;

				const service = new AgentInstructionService({} as any, {} as any);
				const def = service.parseAgentDefinition(content, 'builtin');

				expect(def).toBeDefined();
				expect(def!.hasArchitectureAccess).toBe(false);
			});

			it('should default to undefined when hasArchitectureAccess not specified', () => {
				const content = `---
name: Reviewer
description: Code reviewer
tools: ['search']
---
You review code.`;

				const service = new AgentInstructionService({} as any, {} as any);
				const def = service.parseAgentDefinition(content, 'repo');

				expect(def).toBeDefined();
				expect(def!.hasArchitectureAccess).toBeUndefined();
			});
		});

		describe('Extended AgentDefinition fields', () => {
			it('should parse useSkills array', () => {
				const content = `---
name: Designer
description: UI Designer
useSkills: [design-patterns, accessibility]
tools: ['search']
---
You design UIs.`;

				const service = new AgentInstructionService({} as any, {} as any);
				const def = service.parseAgentDefinition(content, 'repo');

				expect(def).toBeDefined();
				expect(def!.useSkills).toEqual(['design-patterns', 'accessibility']);
			});

			it('should parse backend preference', () => {
				const content = `---
name: Claude Agent
description: Prefers Claude backend
backend: claude
tools: ['search']
---
You use Claude.`;

				const service = new AgentInstructionService({} as any, {} as any);
				const def = service.parseAgentDefinition(content, 'repo');

				expect(def).toBeDefined();
				expect(def!.backend).toBe('claude');
			});

			it('should parse claudeSlashCommand override', () => {
				const content = `---
name: MyAgent
description: Custom agent
claudeSlashCommand: /my-custom-command
tools: ['search']
---
You are custom.`;

				const service = new AgentInstructionService({} as any, {} as any);
				const def = service.parseAgentDefinition(content, 'repo');

				expect(def).toBeDefined();
				expect(def!.claudeSlashCommand).toBe('/my-custom-command');
			});
		});
	});

	describe('Custom Agent Claude Support', () => {
		beforeEach(() => {
			clearCustomAgentSlashCommands();
		});

		afterEach(() => {
			clearCustomAgentSlashCommands();
		});

		describe('Batch Custom Agent Registration', () => {
			it('should register discovered custom agents', () => {
				// Simulate discovering custom agents from filesystem
				const discoveredAgents = [
					{ name: 'data-analyst', slashCommand: '/analyze' },
					{ name: 'test-generator' },
					{ name: 'doc-writer', slashCommand: '/docs' },
				];

				const registered = registerCustomAgents(discoveredAgents);

				expect(registered).toHaveLength(3);
				expect(getAllSlashCommands().get('data-analyst')).toBe('/analyze');
				expect(getAllSlashCommands().get('test-generator')).toBe('/test-generator');
				expect(getAllSlashCommands().get('doc-writer')).toBe('/docs');
			});

			it('should work with parseAgentType for Claude backend', () => {
				registerCustomAgents([
					{ name: 'my-analyzer', slashCommand: '/custom-analyze' },
				]);

				const parsed = parseAgentType('claude:my-analyzer');

				expect(parsed.backend).toBe('claude');
				expect(parsed.agentName).toBe('my-analyzer');
				expect(parsed.slashCommand).toBe('/custom-analyze');
			});
		});

		describe('Custom Agent Validation', () => {
			it('should not register agents with built-in names', () => {
				const registered = registerCustomAgents([
					{ name: 'valid-agent' },
					{ name: 'agent' }, // Built-in
					{ name: 'architect' }, // Built-in
					{ name: 'another-valid' },
				]);

				expect(registered).toHaveLength(2);
				expect(registered).toContain('valid-agent');
				expect(registered).toContain('another-valid');
				expect(registered).not.toContain('agent');
				expect(registered).not.toContain('architect');
			});
		});
	});

	describe('End-to-End Workflow', () => {
		it('should support skill reference workflow', () => {
			const skillsService = new SkillsService({} as any, {} as any);

			// User prompt with skill references
			const prompt = 'Implement a REST API using #skill:rest-patterns and #skill:error-handling';

			// Parse skill references
			const refs = skillsService.parseSkillReferences(prompt);
			expect(refs).toHaveLength(2);

			// In real usage, loadSkillsForAgent would load the actual skill content
			// Here we verify the parsing works correctly
			expect(refs[0].skillId).toBe('rest-patterns');
			expect(refs[1].skillId).toBe('error-handling');
		});

		it('should support architecture-aware agent workflow', () => {
			const instructionService = new AgentInstructionService({} as any, {} as any);

			// Agent definition with architecture access
			const architectContent = `---
name: Architect
description: System architect with full access
hasArchitectureAccess: true
tools: ['search', 'read_file']
---
You design systems.`;

			const agentContent = `---
name: Agent
description: Implementation agent without architecture access
hasArchitectureAccess: false
tools: ['edit']
---
You implement code.`;

			const architect = instructionService.parseAgentDefinition(architectContent, 'builtin');
			const agent = instructionService.parseAgentDefinition(agentContent, 'builtin');

			expect(architect!.hasArchitectureAccess).toBe(true);
			expect(agent!.hasArchitectureAccess).toBe(false);
		});

		it('should support custom agent Claude workflow', () => {
			clearCustomAgentSlashCommands();

			// Register custom agent
			registerCustomAgents([
				{ name: 'my-specialist', slashCommand: '/specialist' },
			]);

			// Parse agent type with Claude backend
			const parsed = parseAgentType('claude:my-specialist');

			expect(parsed.backend).toBe('claude');
			expect(parsed.slashCommand).toBe('/specialist');

			clearCustomAgentSlashCommands();
		});
	});
});
