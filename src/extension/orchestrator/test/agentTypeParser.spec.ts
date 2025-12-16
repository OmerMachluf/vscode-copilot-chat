/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	parseAgentType,
	isCopilotAgentType,
	isClaudeAgentType,
	isCliAgentType,
	isCloudAgentType,
	getBackendType,
	normalizeAgentName,
	createAgentTypeString,
	getClaudeSlashCommand,
	registerCustomAgentSlashCommand,
	unregisterCustomAgentSlashCommand,
	clearCustomAgentSlashCommands,
	getAllSlashCommands,
	isBuiltInAgentName,
	validateCustomAgentName,
	registerCustomAgents,
	BUILTIN_AGENT_NAMES,
	AgentTypeParseError,
	AgentNameConflictError,
} from '../agentTypeParser';

describe('agentTypeParser', () => {
	describe('parseAgentType', () => {
		describe('Copilot backend (@ prefix)', () => {
			it('should parse @agent correctly', () => {
				const result = parseAgentType('@agent');
				expect(result.backend).toBe('copilot');
				expect(result.agentName).toBe('agent');
				expect(result.slashCommand).toBeUndefined();
				expect(result.rawType).toBe('@agent');
			});

			it('should parse @architect correctly', () => {
				const result = parseAgentType('@architect');
				expect(result.backend).toBe('copilot');
				expect(result.agentName).toBe('architect');
			});

			it('should parse @reviewer correctly', () => {
				const result = parseAgentType('@reviewer');
				expect(result.backend).toBe('copilot');
				expect(result.agentName).toBe('reviewer');
			});

			it('should handle model override', () => {
				const result = parseAgentType('@agent', 'gpt-4');
				expect(result.modelOverride).toBe('gpt-4');
			});
		});

		describe('Claude backend', () => {
			it('should parse claude:agent correctly', () => {
				const result = parseAgentType('claude:agent');
				expect(result.backend).toBe('claude');
				expect(result.agentName).toBe('agent');
				expect(result.slashCommand).toBe('/agent');
			});

			it('should parse claude:architect with slash command', () => {
				const result = parseAgentType('claude:architect');
				expect(result.backend).toBe('claude');
				expect(result.agentName).toBe('architect');
				expect(result.slashCommand).toBe('/architect');
			});

			it('should parse claude:reviewer with slash command', () => {
				const result = parseAgentType('claude:reviewer');
				expect(result.backend).toBe('claude');
				expect(result.agentName).toBe('reviewer');
				expect(result.slashCommand).toBe('/review');
			});

			it('should generate default slash command for custom agents', () => {
				const result = parseAgentType('claude:my-custom-agent');
				expect(result.backend).toBe('claude');
				expect(result.agentName).toBe('my-custom-agent');
				expect(result.slashCommand).toBe('/my-custom-agent');
			});

			it('should handle model override', () => {
				const result = parseAgentType('claude:agent', 'claude-3-5-sonnet');
				expect(result.modelOverride).toBe('claude-3-5-sonnet');
			});
		});

		describe('CLI backend', () => {
			it('should parse cli:agent correctly', () => {
				const result = parseAgentType('cli:agent');
				expect(result.backend).toBe('cli');
				expect(result.agentName).toBe('agent');
			});
		});

		describe('Cloud backend', () => {
			it('should parse cloud:agent correctly', () => {
				const result = parseAgentType('cloud:agent');
				expect(result.backend).toBe('cloud');
				expect(result.agentName).toBe('agent');
			});
		});

		describe('Bare agent names', () => {
			it('should treat bare agent name as copilot backend', () => {
				const result = parseAgentType('agent');
				expect(result.backend).toBe('copilot');
				expect(result.agentName).toBe('agent');
			});

			it('should normalize case', () => {
				const result = parseAgentType('Agent');
				expect(result.agentName).toBe('agent');
			});
		});

		describe('Error handling', () => {
			it('should throw for empty string', () => {
				expect(() => parseAgentType('')).toThrow(AgentTypeParseError);
			});

			it('should throw for null/undefined', () => {
				expect(() => parseAgentType(null as any)).toThrow(AgentTypeParseError);
			});

			it('should throw for missing agent name after colon', () => {
				expect(() => parseAgentType('claude:')).toThrow(AgentTypeParseError);
			});

			it('should throw for invalid backend', () => {
				expect(() => parseAgentType('invalid:agent')).toThrow(AgentTypeParseError);
			});

			it('should throw for missing agent name after @', () => {
				expect(() => parseAgentType('@')).toThrow(AgentTypeParseError);
			});
		});

		describe('Whitespace handling', () => {
			it('should trim whitespace', () => {
				const result = parseAgentType('  @agent  ');
				expect(result.backend).toBe('copilot');
				expect(result.agentName).toBe('agent');
			});
		});
	});

	describe('Type checking functions', () => {
		describe('isCopilotAgentType', () => {
			it('should return true for @ prefix', () => {
				expect(isCopilotAgentType('@agent')).toBe(true);
			});

			it('should return true for copilot: prefix', () => {
				expect(isCopilotAgentType('copilot:agent')).toBe(true);
			});

			it('should return true for bare name', () => {
				expect(isCopilotAgentType('agent')).toBe(true);
			});

			it('should return false for claude:', () => {
				expect(isCopilotAgentType('claude:agent')).toBe(false);
			});

			it('should return false for empty string', () => {
				expect(isCopilotAgentType('')).toBe(false);
			});
		});

		describe('isClaudeAgentType', () => {
			it('should return true for claude:', () => {
				expect(isClaudeAgentType('claude:agent')).toBe(true);
			});

			it('should return false for @', () => {
				expect(isClaudeAgentType('@agent')).toBe(false);
			});

			it('should return false for empty string', () => {
				expect(isClaudeAgentType('')).toBe(false);
			});
		});

		describe('isCliAgentType', () => {
			it('should return true for cli:', () => {
				expect(isCliAgentType('cli:agent')).toBe(true);
			});

			it('should return false for others', () => {
				expect(isCliAgentType('@agent')).toBe(false);
			});
		});

		describe('isCloudAgentType', () => {
			it('should return true for cloud:', () => {
				expect(isCloudAgentType('cloud:agent')).toBe(true);
			});

			it('should return false for others', () => {
				expect(isCloudAgentType('@agent')).toBe(false);
			});
		});
	});

	describe('getBackendType', () => {
		it('should return copilot for @ prefix', () => {
			expect(getBackendType('@agent')).toBe('copilot');
		});

		it('should return claude for claude:', () => {
			expect(getBackendType('claude:agent')).toBe('claude');
		});

		it('should return cli for cli:', () => {
			expect(getBackendType('cli:agent')).toBe('cli');
		});

		it('should return cloud for cloud:', () => {
			expect(getBackendType('cloud:agent')).toBe('cloud');
		});

		it('should return copilot as default', () => {
			expect(getBackendType('agent')).toBe('copilot');
			expect(getBackendType('')).toBe('copilot');
		});
	});

	describe('normalizeAgentName', () => {
		it('should strip @ prefix', () => {
			expect(normalizeAgentName('@architect')).toBe('architect');
		});

		it('should strip backend prefix', () => {
			expect(normalizeAgentName('claude:agent')).toBe('agent');
		});

		it('should lowercase', () => {
			expect(normalizeAgentName('AGENT')).toBe('agent');
		});

		it('should return agent for empty string', () => {
			expect(normalizeAgentName('')).toBe('agent');
		});
	});

	describe('createAgentTypeString', () => {
		it('should create @ string for copilot', () => {
			expect(createAgentTypeString('copilot', 'architect')).toBe('@architect');
		});

		it('should create prefixed string for other backends', () => {
			expect(createAgentTypeString('claude', 'agent')).toBe('claude:agent');
			expect(createAgentTypeString('cli', 'agent')).toBe('cli:agent');
			expect(createAgentTypeString('cloud', 'agent')).toBe('cloud:agent');
		});
	});

	describe('Custom agent slash commands', () => {
		beforeEach(() => {
			clearCustomAgentSlashCommands();
		});

		afterEach(() => {
			clearCustomAgentSlashCommands();
		});

		describe('registerCustomAgentSlashCommand', () => {
			it('should register custom agent slash command', () => {
				registerCustomAgentSlashCommand('my-agent');
				expect(getClaudeSlashCommand('my-agent')).toBe('/my-agent');
			});

			it('should allow custom slash command override', () => {
				registerCustomAgentSlashCommand('my-agent', '/custom-command');
				expect(getClaudeSlashCommand('my-agent')).toBe('/custom-command');
			});

			it('should throw for built-in agent name', () => {
				expect(() => registerCustomAgentSlashCommand('agent')).toThrow(AgentNameConflictError);
				expect(() => registerCustomAgentSlashCommand('architect')).toThrow(AgentNameConflictError);
			});

			it('should normalize case', () => {
				registerCustomAgentSlashCommand('My-Agent');
				expect(getClaudeSlashCommand('my-agent')).toBe('/my-agent');
			});
		});

		describe('unregisterCustomAgentSlashCommand', () => {
			it('should unregister custom agent', () => {
				registerCustomAgentSlashCommand('my-agent');
				expect(unregisterCustomAgentSlashCommand('my-agent')).toBe(true);
				expect(getClaudeSlashCommand('my-agent')).toBeUndefined();
			});

			it('should return false for non-existent agent', () => {
				expect(unregisterCustomAgentSlashCommand('non-existent')).toBe(false);
			});
		});

		describe('getAllSlashCommands', () => {
			it('should return built-in commands', () => {
				const commands = getAllSlashCommands();
				expect(commands.get('agent')).toBe('/agent');
				expect(commands.get('architect')).toBe('/architect');
				expect(commands.get('reviewer')).toBe('/review');
			});

			it('should include custom commands', () => {
				registerCustomAgentSlashCommand('my-agent');
				const commands = getAllSlashCommands();
				expect(commands.get('my-agent')).toBe('/my-agent');
			});
		});

		describe('getClaudeSlashCommand', () => {
			it('should return built-in slash command', () => {
				expect(getClaudeSlashCommand('architect')).toBe('/architect');
				expect(getClaudeSlashCommand('reviewer')).toBe('/review');
			});

			it('should return custom slash command', () => {
				registerCustomAgentSlashCommand('my-agent');
				expect(getClaudeSlashCommand('my-agent')).toBe('/my-agent');
			});

			it('should return undefined for unregistered agent', () => {
				expect(getClaudeSlashCommand('unknown-agent')).toBeUndefined();
			});
		});
	});

	describe('Built-in agent validation', () => {
		describe('BUILTIN_AGENT_NAMES', () => {
			it('should contain expected agents', () => {
				expect(BUILTIN_AGENT_NAMES.has('agent')).toBe(true);
				expect(BUILTIN_AGENT_NAMES.has('architect')).toBe(true);
				expect(BUILTIN_AGENT_NAMES.has('reviewer')).toBe(true);
				expect(BUILTIN_AGENT_NAMES.has('planner')).toBe(true);
				expect(BUILTIN_AGENT_NAMES.has('repository-researcher')).toBe(true);
			});
		});

		describe('isBuiltInAgentName', () => {
			it('should return true for built-in names', () => {
				expect(isBuiltInAgentName('agent')).toBe(true);
				expect(isBuiltInAgentName('architect')).toBe(true);
				expect(isBuiltInAgentName('AGENT')).toBe(true); // case insensitive
			});

			it('should return false for custom names', () => {
				expect(isBuiltInAgentName('my-custom-agent')).toBe(false);
			});
		});

		describe('validateCustomAgentName', () => {
			it('should not throw for valid custom name', () => {
				expect(() => validateCustomAgentName('my-custom-agent')).not.toThrow();
			});

			it('should throw for built-in name', () => {
				expect(() => validateCustomAgentName('agent')).toThrow(AgentNameConflictError);
				expect(() => validateCustomAgentName('architect')).toThrow(AgentNameConflictError);
			});

			it('should provide helpful error message', () => {
				try {
					validateCustomAgentName('architect');
					expect.fail('Should have thrown');
				} catch (e) {
					expect(e).toBeInstanceOf(AgentNameConflictError);
					expect((e as AgentNameConflictError).message).toContain('conflicts with built-in agent');
					expect((e as AgentNameConflictError).agentName).toBe('architect');
				}
			});
		});
	});

	describe('Custom agent Claude backend integration', () => {
		beforeEach(() => {
			clearCustomAgentSlashCommands();
		});

		afterEach(() => {
			clearCustomAgentSlashCommands();
		});

		it('should parse custom agent with claude backend', () => {
			const result = parseAgentType('claude:my-custom-agent');
			expect(result.backend).toBe('claude');
			expect(result.agentName).toBe('my-custom-agent');
			expect(result.slashCommand).toBe('/my-custom-agent');
		});

		it('should use registered slash command if available', () => {
			registerCustomAgentSlashCommand('my-custom-agent', '/custom');
			const result = parseAgentType('claude:my-custom-agent');
			expect(result.slashCommand).toBe('/custom');
		});

		it('should work with custom agents that have copilot backend', () => {
			const result = parseAgentType('@my-custom-agent');
			expect(result.backend).toBe('copilot');
			expect(result.agentName).toBe('my-custom-agent');
			expect(result.slashCommand).toBeUndefined();
		});
	});

	describe('registerCustomAgents (batch registration)', () => {
		beforeEach(() => {
			clearCustomAgentSlashCommands();
		});

		afterEach(() => {
			clearCustomAgentSlashCommands();
		});

		it('should register multiple custom agents at once', () => {
			const registered = registerCustomAgents([
				{ name: 'agent-one' },
				{ name: 'agent-two' },
				{ name: 'agent-three' },
			]);

			expect(registered).toHaveLength(3);
			expect(getClaudeSlashCommand('agent-one')).toBe('/agent-one');
			expect(getClaudeSlashCommand('agent-two')).toBe('/agent-two');
			expect(getClaudeSlashCommand('agent-three')).toBe('/agent-three');
		});

		it('should skip built-in agent names without throwing', () => {
			const registered = registerCustomAgents([
				{ name: 'my-agent' },
				{ name: 'agent' }, // built-in, should be skipped
				{ name: 'architect' }, // built-in, should be skipped
			]);

			expect(registered).toHaveLength(1);
			expect(registered).toContain('my-agent');
			expect(getClaudeSlashCommand('my-agent')).toBe('/my-agent');
		});

		it('should support custom slash commands in batch', () => {
			const registered = registerCustomAgents([
				{ name: 'my-agent', slashCommand: '/custom-slash' },
				{ name: 'other-agent' },
			]);

			expect(registered).toHaveLength(2);
			expect(getClaudeSlashCommand('my-agent')).toBe('/custom-slash');
			expect(getClaudeSlashCommand('other-agent')).toBe('/other-agent');
		});

		it('should clear existing registrations when clearExisting is true', () => {
			registerCustomAgentSlashCommand('existing-agent');
			expect(getClaudeSlashCommand('existing-agent')).toBe('/existing-agent');

			registerCustomAgents([{ name: 'new-agent' }], true);

			expect(getClaudeSlashCommand('existing-agent')).toBeUndefined();
			expect(getClaudeSlashCommand('new-agent')).toBe('/new-agent');
		});

		it('should preserve existing registrations when clearExisting is false', () => {
			registerCustomAgentSlashCommand('existing-agent');

			registerCustomAgents([{ name: 'new-agent' }], false);

			expect(getClaudeSlashCommand('existing-agent')).toBe('/existing-agent');
			expect(getClaudeSlashCommand('new-agent')).toBe('/new-agent');
		});
	});
});
