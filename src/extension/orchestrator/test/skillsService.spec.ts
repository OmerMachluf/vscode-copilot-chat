/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { SkillsService, formatSkillsForPrompt } from '../skillsService';
import { ISkill } from '../interfaces/skill';

suite('SkillsService', () => {
	suite('parseSkillReferences', () => {
		let service: SkillsService;

		setup(() => {
			// Create service with minimal mocks
			service = new SkillsService(
				{} as any, // fileSystemService
				{} as any  // extensionContext
			);
		});

		test('parses single skill reference', () => {
			const prompt = 'Please help with #skill:microservices patterns';
			const refs = service.parseSkillReferences(prompt);

			assert.strictEqual(refs.length, 1);
			assert.strictEqual(refs[0].skillId, 'microservices');
		});

		test('parses multiple skill references', () => {
			const prompt = 'Using #skill:microservices and #skill:design-patterns for this task';
			const refs = service.parseSkillReferences(prompt);

			assert.strictEqual(refs.length, 2);
			assert.strictEqual(refs[0].skillId, 'microservices');
			assert.strictEqual(refs[1].skillId, 'design-patterns');
		});

		test('returns empty array when no references', () => {
			const prompt = 'A prompt without any skill references';
			const refs = service.parseSkillReferences(prompt);

			assert.strictEqual(refs.length, 0);
		});

		test('handles skill IDs with underscores and hyphens', () => {
			const prompt = '#skill:my_custom-skill and #skill:another_one';
			const refs = service.parseSkillReferences(prompt);

			assert.strictEqual(refs.length, 2);
			assert.strictEqual(refs[0].skillId, 'my_custom-skill');
			assert.strictEqual(refs[1].skillId, 'another_one');
		});

		test('ignores invalid skill reference patterns', () => {
			const prompt = '#skill: (no name) and skill:nohash';
			const refs = service.parseSkillReferences(prompt);

			assert.strictEqual(refs.length, 0);
		});
	});

	suite('formatSkillsForPrompt', () => {
		test('returns empty string for empty skills array', () => {
			const result = formatSkillsForPrompt([]);
			assert.strictEqual(result, '');
		});

		test('formats single skill correctly', () => {
			const skills: ISkill[] = [
				{
					id: 'microservices',
					name: 'Microservices Patterns',
					description: 'Knowledge of microservices architecture patterns',
					keywords: ['microservice', 'api'],
					content: '# Microservices\n\nService communication patterns...',
					source: 'repo',
				},
			];

			const result = formatSkillsForPrompt(skills);

			assert.ok(result.includes('## Referenced Skills'));
			assert.ok(result.includes('### Microservices Patterns'));
			assert.ok(result.includes('*Knowledge of microservices architecture patterns*'));
			assert.ok(result.includes('Service communication patterns'));
		});

		test('formats multiple skills', () => {
			const skills: ISkill[] = [
				{
					id: 'skill1',
					name: 'Skill One',
					description: 'First skill',
					keywords: [],
					content: 'Content one',
					source: 'builtin',
				},
				{
					id: 'skill2',
					name: 'Skill Two',
					description: 'Second skill',
					keywords: [],
					content: 'Content two',
					source: 'repo',
				},
			];

			const result = formatSkillsForPrompt(skills);

			assert.ok(result.includes('### Skill One'));
			assert.ok(result.includes('### Skill Two'));
			assert.ok(result.includes('Content one'));
			assert.ok(result.includes('Content two'));
		});
	});
});

suite('Skill Interface', () => {
	test('skill object structure is valid', () => {
		const skill: ISkill = {
			id: 'test-skill',
			name: 'Test Skill',
			description: 'A test skill',
			keywords: ['test', 'example'],
			content: '# Test Content',
			source: 'repo',
			path: '/path/to/skill.md',
			agentId: 'architect',
		};

		assert.strictEqual(skill.id, 'test-skill');
		assert.strictEqual(skill.source, 'repo');
		assert.strictEqual(skill.agentId, 'architect');
	});
});
