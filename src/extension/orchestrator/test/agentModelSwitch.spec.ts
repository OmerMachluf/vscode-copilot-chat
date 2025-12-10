/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerSession } from '../workerSession';

describe('AgentModelSwitch', () => {
	let workerSession: WorkerSession;

	beforeEach(() => {
		workerSession = new WorkerSession(
			'test-worker',
			'Test task description',
			'/test/worktree',
			'plan-1',
			'main',
			'@agent',
			['Default instructions'],
			'gpt-4o'
		);
	});

	describe('hotSwapAgent', () => {
		it('should change agent ID and instructions', () => {
			workerSession.hotSwapAgent('@reviewer', ['Review these changes']);

			expect(workerSession.agentId).toBe('@reviewer');
			expect(workerSession.agentInstructions).toEqual(['Review these changes']);
		});

		it('should preserve context when preserveContext is true', () => {
			// Add some messages first
			workerSession.addUserMessage('Hello');
			workerSession.addAssistantMessage('Hi there');

			const messageCountBefore = workerSession.state.messages.length;

			workerSession.hotSwapAgent('@reviewer', ['Review instructions'], true);

			// Should have all previous messages plus the system message about the change
			expect(workerSession.state.messages.length).toBeGreaterThan(messageCountBefore);

			// Verify the system message about agent change
			const lastSystemMessage = workerSession.state.messages
				.filter(m => m.role === 'system')
				.pop();
			expect(lastSystemMessage?.content).toContain('Agent changed');
			expect(lastSystemMessage?.content).toContain('@reviewer');
			expect(lastSystemMessage?.content).toContain('context preserved');
		});

		it('should clear context when preserveContext is false', () => {
			// Add some messages first
			workerSession.addUserMessage('Hello');
			workerSession.addAssistantMessage('Hi there');

			workerSession.hotSwapAgent('@architect', ['Architecture instructions'], false);

			// Should only have the initial system message and the new agent change message
			const messages = workerSession.state.messages;
			expect(messages.length).toBe(2); // Initial + agent change

			// Verify the system message about agent change mentions fresh context
			const lastSystemMessage = messages.filter(m => m.role === 'system').pop();
			expect(lastSystemMessage?.content).toContain('Starting fresh context');
		});

		it('should fire onDidChange event', () => {
			const changeHandler = vi.fn();
			workerSession.onDidChange(changeHandler);

			workerSession.hotSwapAgent('@reviewer', ['Instructions']);

			expect(changeHandler).toHaveBeenCalled();
		});
	});

	describe('hotSwapModel', () => {
		it('should change model ID', () => {
			workerSession.hotSwapModel('claude-sonnet-4-20250514');

			expect(workerSession.modelId).toBe('claude-sonnet-4-20250514');
		});

		it('should preserve context when preserveContext is true', () => {
			workerSession.addUserMessage('Test message');
			const messageCountBefore = workerSession.state.messages.length;

			workerSession.hotSwapModel('gpt-4', true);

			expect(workerSession.state.messages.length).toBeGreaterThan(messageCountBefore);

			const lastSystemMessage = workerSession.state.messages
				.filter(m => m.role === 'system')
				.pop();
			expect(lastSystemMessage?.content).toContain('Model changed');
			expect(lastSystemMessage?.content).toContain('gpt-4');
			expect(lastSystemMessage?.content).toContain('context preserved');
		});

		it('should clear context when preserveContext is false', () => {
			workerSession.addUserMessage('Test message');
			workerSession.addAssistantMessage('Response');

			workerSession.hotSwapModel('gpt-4', false);

			// Should only have the initial system message and the new model change message
			const messages = workerSession.state.messages;
			expect(messages.length).toBe(2);

			const lastSystemMessage = messages.filter(m => m.role === 'system').pop();
			expect(lastSystemMessage?.content).toContain('Starting fresh context');
		});

		it('should fire onDidChange event', () => {
			const changeHandler = vi.fn();
			workerSession.onDidChange(changeHandler);

			workerSession.hotSwapModel('gpt-4');

			expect(changeHandler).toHaveBeenCalled();
		});
	});

	describe('getContextForNewAgent', () => {
		it('should return task in context summary', () => {
			const context = workerSession.getContextForNewAgent();

			expect(context).toContain('Test task description');
		});

		it('should include previous agent info', () => {
			const context = workerSession.getContextForNewAgent();

			expect(context).toContain('Previous agent: @agent');
		});

		it('should include conversation summary', () => {
			workerSession.addUserMessage('Can you help me with testing?');
			workerSession.addAssistantMessage('Sure, I can help with testing.');

			const context = workerSession.getContextForNewAgent();

			expect(context).toContain('Conversation Summary');
			expect(context).toContain('testing');
		});

		it('should truncate long messages', () => {
			const longMessage = 'A'.repeat(300);
			workerSession.addUserMessage(longMessage);

			const context = workerSession.getContextForNewAgent();

			// Should contain truncated version with ellipsis
			expect(context).toContain('...');
			expect(context).not.toContain(longMessage);
		});

		it('should include error state if present', () => {
			workerSession.error('Something went wrong');

			const context = workerSession.getContextForNewAgent();

			expect(context).toContain('Last Error');
			expect(context).toContain('Something went wrong');
		});

		it('should limit to last 10 key messages', () => {
			// Add more than 10 user messages
			for (let i = 0; i < 15; i++) {
				workerSession.addUserMessage(`Message ${i}`);
				workerSession.addAssistantMessage(`Response ${i}`);
			}

			const context = workerSession.getContextForNewAgent();

			// Should not contain earliest messages
			expect(context).not.toContain('Message 0');
			// Should contain later messages
			expect(context).toContain('Message 14');
		});
	});

	describe('model tier detection', () => {
		// These tests validate the model tier logic used in ChangeModelTool
		const getModelTier = (modelId: string): 'standard' | 'premium' | 'expensive' | 'unknown' => {
			const MODEL_TIERS: Record<string, 'standard' | 'premium' | 'expensive'> = {
				'gpt-4o-mini': 'standard',
				'gpt-3.5-turbo': 'standard',
				'gpt-4o': 'premium',
				'claude-sonnet-4-20250514': 'premium',
				'gpt-4': 'expensive',
				'claude-3-opus': 'expensive',
				'o1': 'expensive',
			};
			const normalized = modelId.toLowerCase().replace(/-\d{8}$/, '');
			return MODEL_TIERS[normalized] ?? MODEL_TIERS[modelId] ?? 'unknown';
		};

		it('should identify standard tier models', () => {
			expect(getModelTier('gpt-4o-mini')).toBe('standard');
			expect(getModelTier('gpt-3.5-turbo')).toBe('standard');
		});

		it('should identify premium tier models', () => {
			expect(getModelTier('gpt-4o')).toBe('premium');
			expect(getModelTier('claude-sonnet-4-20250514')).toBe('premium');
		});

		it('should identify expensive tier models', () => {
			expect(getModelTier('gpt-4')).toBe('expensive');
			expect(getModelTier('o1')).toBe('expensive');
		});

		it('should return unknown for unrecognized models', () => {
			expect(getModelTier('unknown-model')).toBe('unknown');
		});
	});

	describe('tier upgrade detection', () => {
		const isTierUpgrade = (fromTier: string, toTier: string): boolean => {
			const tierOrder = ['standard', 'premium', 'expensive'];
			const fromIndex = tierOrder.indexOf(fromTier);
			const toIndex = tierOrder.indexOf(toTier);
			return toIndex > fromIndex;
		};

		it('should detect upgrade from standard to premium', () => {
			expect(isTierUpgrade('standard', 'premium')).toBe(true);
		});

		it('should detect upgrade from standard to expensive', () => {
			expect(isTierUpgrade('standard', 'expensive')).toBe(true);
		});

		it('should detect upgrade from premium to expensive', () => {
			expect(isTierUpgrade('premium', 'expensive')).toBe(true);
		});

		it('should not detect downgrade as upgrade', () => {
			expect(isTierUpgrade('expensive', 'standard')).toBe(false);
			expect(isTierUpgrade('premium', 'standard')).toBe(false);
		});

		it('should not detect same tier as upgrade', () => {
			expect(isTierUpgrade('standard', 'standard')).toBe(false);
			expect(isTierUpgrade('premium', 'premium')).toBe(false);
		});
	});

	describe('combined agent and model switch', () => {
		it('should allow changing both agent and model', () => {
			workerSession.hotSwapAgent('@reviewer', ['Review instructions']);
			workerSession.hotSwapModel('claude-sonnet-4-20250514');

			expect(workerSession.agentId).toBe('@reviewer');
			expect(workerSession.modelId).toBe('claude-sonnet-4-20250514');
		});

		it('should preserve context through multiple switches', () => {
			workerSession.addUserMessage('Initial message');

			workerSession.hotSwapAgent('@architect', ['Arch instructions'], true);
			workerSession.addAssistantMessage('Architecture response');

			workerSession.hotSwapModel('gpt-4', true);

			// Should have all messages
			const messages = workerSession.state.messages;
			expect(messages.some(m => m.content === 'Initial message')).toBe(true);
			expect(messages.some(m => m.content === 'Architecture response')).toBe(true);
			expect(messages.filter(m => m.role === 'system' && m.content.includes('changed')).length).toBe(2);
		});
	});
});
