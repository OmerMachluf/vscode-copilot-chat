/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

/**
 * Regex to match paths inside .github/agents/
 */
const AGENTS_PATH_REGEX = /[/\\]\.github[/\\]agents[/\\]/i;

describe('CustomInstructions', () => {
	describe('AGENTS_PATH_REGEX', () => {
		it('should match Unix-style paths inside .github/agents/', () => {
			const path = 'file:///q:/src/PowerQuery/Web/src/.github/agents/agent/agent-instructions.md';
			expect(AGENTS_PATH_REGEX.test(path)).toBe(true);
		});

		it('should match Windows-style paths inside .github/agents/', () => {
			const path = 'file:///Q:\\src\\PowerQuery\\Web\\src\\.github\\agents\\agent\\agent-instructions.md';
			expect(AGENTS_PATH_REGEX.test(path)).toBe(true);
		});

		it('should match mixed-style paths inside .github/agents/', () => {
			const path = 'Q:/src/PowerQuery/Web/src/.github/agents/agent/agent-instructions.md';
			expect(AGENTS_PATH_REGEX.test(path)).toBe(true);
		});

		it('should match URI toString() format', () => {
			// This is what URI.toString() typically produces
			const path = 'file:///q%3A/src/PowerQuery/Web/src/.github/agents/agent/agent-instructions.md';
			expect(AGENTS_PATH_REGEX.test(path)).toBe(true);
		});

		it('should NOT match paths outside .github/agents/', () => {
			const path = 'file:///q:/src/PowerQuery/Web/src/.github/instructions/my-instructions.md';
			expect(AGENTS_PATH_REGEX.test(path)).toBe(false);
		});

		it('should NOT match paths with just .github/', () => {
			const path = 'file:///q:/src/PowerQuery/Web/src/.github/copilot-instructions.md';
			expect(AGENTS_PATH_REGEX.test(path)).toBe(false);
		});

		it('should be case-insensitive for .github', () => {
			const path = 'file:///q:/src/PowerQuery/Web/src/.GitHub/agents/agent/test.md';
			expect(AGENTS_PATH_REGEX.test(path)).toBe(true);
		});

		it('should be case-insensitive for agents', () => {
			const path = 'file:///q:/src/PowerQuery/Web/src/.github/Agents/agent/test.md';
			expect(AGENTS_PATH_REGEX.test(path)).toBe(true);
		});
	});

	describe('instruction filename filtering', () => {
		// Updated to be case-insensitive
		const isInstructionFile = (name: string): boolean => {
			return name.toLowerCase().endsWith('.md') && name.toLowerCase().includes('instructions');
		};

		it('should match agent-instructions.md', () => {
			expect(isInstructionFile('agent-instructions.md')).toBe(true);
		});

		it('should match my-instructions.md', () => {
			expect(isInstructionFile('my-instructions.md')).toBe(true);
		});

		it('should match instructions.md', () => {
			expect(isInstructionFile('instructions.md')).toBe(true);
		});

		it('should match coding-instructions-v2.md', () => {
			expect(isInstructionFile('coding-instructions-v2.md')).toBe(true);
		});

		it('should match agent.instructions.md (dot separator)', () => {
			expect(isInstructionFile('agent.instructions.md')).toBe(true);
		});

		it('should match Instructions.md (case-insensitive)', () => {
			expect(isInstructionFile('Instructions.md')).toBe(true);
		});

		it('should match INSTRUCTIONS.md (case-insensitive)', () => {
			expect(isInstructionFile('INSTRUCTIONS.md')).toBe(true);
		});

		it('should match agent-Instructions.md (case-insensitive)', () => {
			expect(isInstructionFile('agent-Instructions.md')).toBe(true);
		});

		it('should match Agent-INSTRUCTIONS.MD (all uppercase extension)', () => {
			expect(isInstructionFile('Agent-INSTRUCTIONS.MD')).toBe(true);
		});

		it('should NOT match agent.md (no "instructions" in name)', () => {
			expect(isInstructionFile('agent.md')).toBe(false);
		});

		it('should NOT match skills.md', () => {
			expect(isInstructionFile('skills.md')).toBe(false);
		});

		it('should NOT match readme.md', () => {
			expect(isInstructionFile('readme.md')).toBe(false);
		});
	});

	describe('filtering chatVariables URIs', () => {
		// Simulate how URIs look when they come through chatVariables
		const shouldFilterOut = (uriString: string): boolean => {
			return AGENTS_PATH_REGEX.test(uriString);
		};

		it('should filter out .github/agents/agent/agent-instructions.md', () => {
			const uri = 'file:///q%3A/src/PowerQuery/Web/src/.github/agents/agent/agent-instructions.md';
			expect(shouldFilterOut(uri)).toBe(true);
		});

		it('should filter out .github/agents/agent/skills.md', () => {
			const uri = 'file:///q%3A/src/PowerQuery/Web/src/.github/agents/agent/skills.md';
			expect(shouldFilterOut(uri)).toBe(true);
		});

		it('should filter out .github/agents/orchestrator/instructions.md', () => {
			const uri = 'file:///q%3A/src/PowerQuery/Web/src/.github/agents/orchestrator/instructions.md';
			expect(shouldFilterOut(uri)).toBe(true);
		});

		it('should NOT filter out .github/instructions/my-instructions.md', () => {
			const uri = 'file:///q%3A/src/PowerQuery/Web/src/.github/instructions/my-instructions.md';
			expect(shouldFilterOut(uri)).toBe(false);
		});

		it('should NOT filter out .github/copilot-instructions.md', () => {
			const uri = 'file:///q%3A/src/PowerQuery/Web/src/.github/copilot-instructions.md';
			expect(shouldFilterOut(uri)).toBe(false);
		});

		it('should NOT filter out regular workspace files', () => {
			const uri = 'file:///q%3A/src/PowerQuery/Web/src/some-file.md';
			expect(shouldFilterOut(uri)).toBe(false);
		});
	});

	describe('URI.toString() format investigation', () => {
		// Let's test different URI formats that might come through
		it('should handle encoded colons in Windows paths', () => {
			// URI.toString() encodes : as %3A
			const uri = 'file:///q%3A/src/.github/agents/agent/test.md';
			expect(AGENTS_PATH_REGEX.test(uri)).toBe(true);
		});

		it('should handle non-encoded Windows paths', () => {
			const uri = 'file:///q:/src/.github/agents/agent/test.md';
			expect(AGENTS_PATH_REGEX.test(uri)).toBe(true);
		});

		it('should handle lowercase drive letters', () => {
			const uri = 'file:///q:/src/.github/agents/agent/test.md';
			expect(AGENTS_PATH_REGEX.test(uri)).toBe(true);
		});

		it('should handle uppercase drive letters', () => {
			const uri = 'file:///Q:/src/.github/agents/agent/test.md';
			expect(AGENTS_PATH_REGEX.test(uri)).toBe(true);
		});
	});
});
