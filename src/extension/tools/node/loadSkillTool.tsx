/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IUnifiedDefinitionService } from '../../orchestrator/unifiedDefinitionService';
import { ToolName } from '../common/toolNames';
import { ToolRegistry } from '../common/toolsRegistry';
import { checkCancellation } from './toolUtils';

/**
 * Input schema for the LoadSkill tool.
 */
interface ILoadSkillInput {
	/**
	 * The skill ID to load (e.g., 'rest-api-design').
	 */
	readonly skillId: string;
}

/**
 * Tool that allows agents to load domain-specific skill content on-demand.
 *
 * Skills are defined in `.skill.md` files and provide specialized knowledge
 * that agents can use when needed. This tool loads the content of a specific
 * skill and returns it as markdown.
 *
 * Usage:
 * - Input: `{ skillId: "skill-name" }`
 * - Output: The skill content (markdown) or an error message with available skills
 *
 * Skills are discovered from:
 * - Built-in: `assets/skills/*.skill.md`
 * - Repository: `.github/skills/*.skill.md`
 */
class LoadSkillTool implements vscode.LanguageModelTool<ILoadSkillInput> {
	static readonly toolName = ToolName.LoadSkill;

	constructor(
		@IUnifiedDefinitionService private readonly unifiedDefinitionService: IUnifiedDefinitionService
	) { }

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<ILoadSkillInput>,
		token: vscode.CancellationToken
	): Promise<vscode.LanguageModelToolResult> {
		const { skillId } = options.input;

		if (!skillId || typeof skillId !== 'string') {
			return this._createErrorResult('Error: skillId is required');
		}

		checkCancellation(token);

		// Try to load the skill content
		const content = await this.unifiedDefinitionService.loadSkillContent(skillId);

		if (content) {
			checkCancellation(token);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(content)
			]);
		}

		// Skill not found - return available skills
		checkCancellation(token);
		return this._createSkillNotFoundResult(skillId);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<ILoadSkillInput>,
		_token: vscode.CancellationToken
	): Promise<vscode.PreparedToolInvocation> {
		return {
			invocationMessage: `Loading skill: ${options.input.skillId}`,
		};
	}

	private _createErrorResult(message: string): vscode.LanguageModelToolResult {
		return new LanguageModelToolResult([
			new LanguageModelTextPart(message)
		]);
	}

	private async _createSkillNotFoundResult(requestedSkillId: string): Promise<vscode.LanguageModelToolResult> {
		// Get available skills for helpful error message
		const skills = await this.unifiedDefinitionService.discoverSkills();

		const lines: string[] = [
			`Error: Skill "${requestedSkillId}" not found.`,
			'',
		];

		if (skills.length > 0) {
			lines.push('Available skills:');
			lines.push('');
			lines.push('| Skill ID | Description |');
			lines.push('|----------|-------------|');
			for (const skill of skills) {
				lines.push(`| ${skill.id} | ${skill.description} |`);
			}
		} else {
			lines.push('No skills are currently available.');
			lines.push('');
			lines.push('Skills can be defined in:');
			lines.push('- Built-in: `assets/skills/*.skill.md`');
			lines.push('- Repository: `.github/skills/*.skill.md`');
		}

		return new LanguageModelToolResult([
			new LanguageModelTextPart(lines.join('\n'))
		]);
	}
}

ToolRegistry.registerTool(LoadSkillTool);
