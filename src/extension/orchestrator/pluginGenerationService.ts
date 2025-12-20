/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { createDecorator } from '../../util/vs/platform/instantiation/common/instantiation';
import { IFileSystemService } from '../../platform/filesystem/common/fileSystemService';
import { ILogService } from '../../platform/log/common/logService';
import { URI } from '../../util/vs/base/common/uri';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { IUnifiedDefinitionService } from './unifiedDefinitionService';
import { IAgentInstructionService } from './agentInstructionService';

/**
 * Plugin directory path for Claude SDK
 * Structure:
 * - .plugins/copilot/.claude-plugin/plugin.json
 * - .plugins/copilot/agents/{category}/{agent-name}.md
 * - .plugins/copilot/commands/{command-name}.md
 * - .plugins/copilot/skills/{skill-id}/SKILL.md
 */
export const PLUGIN_DIR = '.plugins/copilot';
export const PLUGIN_METADATA_DIR = '.plugins/copilot/.claude-plugin';
export const PLUGIN_JSON_FILENAME = 'plugin.json';
export const PLUGIN_AGENTS_DIR = '.plugins/copilot/agents';
export const PLUGIN_COMMANDS_DIR = '.plugins/copilot/commands';
export const PLUGIN_SKILLS_DIR = '.plugins/copilot/skills';

/**
 * Plugin version - increment when plugin structure changes
 */
export const PLUGIN_VERSION = '1.0.0';

/**
 * Agent categories for folder organization
 */
export const AGENT_CATEGORY_BUILTIN = 'builtin';
export const AGENT_CATEGORY_REPO = 'repo';

/**
 * Generation result
 */
export interface PluginGenerationResult {
	success: boolean;
	pluginPath: string;
	generatedFiles: string[];
	error?: string;
}

/**
 * Service identifier for plugin generation
 */
export const IPluginGenerationService = createDecorator<IPluginGenerationService>('pluginGenerationService');

/**
 * Service for generating Claude SDK plugin from unified definitions
 */
export interface IPluginGenerationService {
	readonly _serviceBrand: undefined;

	/**
	 * Generate the plugin structure
	 */
	generatePlugin(): Promise<PluginGenerationResult>;

	/**
	 * Get the plugin path for use in SDK options
	 */
	getPluginPath(): string | undefined;

	/**
	 * Force regeneration of plugin
	 */
	regenerate(): Promise<PluginGenerationResult>;
}

export class PluginGenerationService extends Disposable implements IPluginGenerationService {
	declare readonly _serviceBrand: undefined;

	private _pluginPath: string | undefined;

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@ILogService private readonly logService: ILogService,
		@IUnifiedDefinitionService private readonly unifiedDefinitionService: IUnifiedDefinitionService,
		@IAgentInstructionService private readonly agentInstructionService: IAgentInstructionService
	) {
		super();
	}

	async generatePlugin(): Promise<PluginGenerationResult> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return {
				success: false,
				pluginPath: '',
				generatedFiles: [],
				error: 'No workspace folder found'
			};
		}

		const generatedFiles: string[] = [];

		try {
			const workspaceRoot = workspaceFolders[0].uri;

			// Create plugin directory structure
			const pluginDir = URI.joinPath(workspaceRoot, PLUGIN_DIR);
			await this.fileSystemService.createDirectory(pluginDir);

			const metadataDir = URI.joinPath(workspaceRoot, PLUGIN_METADATA_DIR);
			await this.fileSystemService.createDirectory(metadataDir);

			const agentsDir = URI.joinPath(workspaceRoot, PLUGIN_AGENTS_DIR);
			await this.fileSystemService.createDirectory(agentsDir);

			const commandsDir = URI.joinPath(workspaceRoot, PLUGIN_COMMANDS_DIR);
			await this.fileSystemService.createDirectory(commandsDir);

			const skillsDir = URI.joinPath(workspaceRoot, PLUGIN_SKILLS_DIR);
			await this.fileSystemService.createDirectory(skillsDir);

			// Create agent category subdirectories
			const builtinAgentsDir = URI.joinPath(agentsDir, AGENT_CATEGORY_BUILTIN);
			await this.fileSystemService.createDirectory(builtinAgentsDir);

			const repoAgentsDir = URI.joinPath(agentsDir, AGENT_CATEGORY_REPO);
			await this.fileSystemService.createDirectory(repoAgentsDir);

			// Discover all definitions
			const agents = await this.unifiedDefinitionService.discoverAgents();
			const commands = await this.unifiedDefinitionService.discoverCommands();
			const skills = await this.unifiedDefinitionService.discoverSkills();

			this.logService.info(`[PluginGenerationService] Discovered ${agents.length} agents, ${commands.length} commands, ${skills.length} skills`);

			// Generate agents
			for (const agent of agents) {
				const agentContent = await this._generateAgentFile(agent);
				const category = agent.source === 'builtin' ? AGENT_CATEGORY_BUILTIN : AGENT_CATEGORY_REPO;
				const agentPath = URI.joinPath(agentsDir, category, `${agent.id}.md`);
				await this._writeFile(agentPath, agentContent);
				generatedFiles.push(agentPath.toString());
			}

			// Generate commands
			for (const command of commands) {
				const commandContent = this._generateCommandFile(command);
				const commandPath = URI.joinPath(commandsDir, `${command.id}.md`);
				await this._writeFile(commandPath, commandContent);
				generatedFiles.push(commandPath.toString());
			}

			// Generate skills
			for (const skill of skills) {
				const skillDir = URI.joinPath(skillsDir, skill.id);
				await this.fileSystemService.createDirectory(skillDir);
				const skillContent = await this._generateSkillFile(skill);
				const skillPath = URI.joinPath(skillDir, 'SKILL.md');
				await this._writeFile(skillPath, skillContent);
				generatedFiles.push(skillPath.toString());
			}

			// Generate plugin.json
			const pluginJsonContent = this._generatePluginJson(agents.length, commands.length, skills.length);
			const pluginJsonPath = URI.joinPath(metadataDir, PLUGIN_JSON_FILENAME);
			await this._writeFile(pluginJsonPath, pluginJsonContent);
			generatedFiles.push(pluginJsonPath.toString());

			// Store plugin path for SDK options
			this._pluginPath = pluginDir.fsPath;

			this.logService.info(`[PluginGenerationService] ✅ Generated plugin at ${this._pluginPath} with ${generatedFiles.length} files`);

			return {
				success: true,
				pluginPath: this._pluginPath,
				generatedFiles
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logService.error(`[PluginGenerationService] Failed to generate plugin: ${errorMessage}`);
			return {
				success: false,
				pluginPath: '',
				generatedFiles,
				error: errorMessage
			};
		}
	}

	getPluginPath(): string | undefined {
		return this._pluginPath;
	}

	async regenerate(): Promise<PluginGenerationResult> {
		this.logService.info('[PluginGenerationService] Regenerating plugin...');
		return this.generatePlugin();
	}

	/**
	 * Generate an agent file with YAML frontmatter + prompt content + custom instructions
	 */
	private async _generateAgentFile(agent: any): Promise<string> {
		const lines: string[] = ['---'];

		// Add frontmatter
		lines.push(`name: ${agent.id}`);
		lines.push(`description: ${this._escapeYamlString(agent.description)}`);

		if (agent.tools && agent.tools.length > 0) {
			const toolsStr = agent.tools.map((t: string) => `'${t}'`).join(', ');
			lines.push(`tools: [${toolsStr}]`);
		}

		if (agent.hasArchitectureAccess) {
			lines.push(`hasArchitectureAccess: true`);
		}

		lines.push('---');
		lines.push('');

		// Add agent prompt content
		if (agent.prompt) {
			lines.push(agent.prompt);
			lines.push('');
		}

		// Append custom instructions from AgentInstructionService
		try {
			const instructions = await this.agentInstructionService.loadInstructions(agent.id);
			if (instructions.instructions && instructions.instructions.length > 0) {
				lines.push('## Custom Instructions');
				lines.push('');
				for (const instruction of instructions.instructions) {
					lines.push(instruction);
					lines.push('');
				}
			}
		} catch {
			// No custom instructions available
		}

		return lines.join('\n');
	}

	/**
	 * Generate a command file with YAML frontmatter + prompt content
	 */
	private _generateCommandFile(command: any): string {
		const lines: string[] = ['---'];

		lines.push(`name: ${command.id}`);
		lines.push(`description: ${this._escapeYamlString(command.description)}`);

		if (command.argumentHint) {
			lines.push(`argument-hint: "${command.argumentHint}"`);
		}

		lines.push('---');
		lines.push('');

		// Add command content
		if (command.content) {
			lines.push(command.content);
		}

		return lines.join('\n');
	}

	/**
	 * Generate a skill file with YAML frontmatter + skill content
	 */
	private async _generateSkillFile(skill: any): Promise<string> {
		const lines: string[] = ['---'];

		lines.push(`name: ${skill.id}`);
		lines.push(`description: ${this._escapeYamlString(skill.description)}`);

		if (skill.keywords && skill.keywords.length > 0) {
			const keywordsStr = skill.keywords.map((k: string) => `'${k}'`).join(', ');
			lines.push(`keywords: [${keywordsStr}]`);
		}

		lines.push('---');
		lines.push('');

		// Load skill content
		try {
			const content = await this.unifiedDefinitionService.loadSkillContent(skill.id);
			if (content) {
				lines.push(content);
			}
		} catch {
			// No content available
		}

		return lines.join('\n');
	}

	/**
	 * Generate plugin.json metadata file
	 */
	private _generatePluginJson(agentCount: number, commandCount: number, skillCount: number): string {
		const metadata = {
			name: 'copilot-unified',
			version: PLUGIN_VERSION,
			description: `Unified Copilot plugin with ${agentCount} agents, ${commandCount} commands, and ${skillCount} skills from GitHub Copilot extension`,
			author: {
				name: 'GitHub Copilot',
				email: 'copilot@github.com'
			},
			keywords: [
				'copilot',
				'github',
				'ai-powered',
				'unified'
			]
		};

		return JSON.stringify(metadata, null, 2);
	}

	/**
	 * Escape special characters in YAML strings
	 */
	private _escapeYamlString(str: string): string {
		if (str.includes(':') || str.includes('#') || str.includes('\n') || str.includes('"') || str.includes("'")) {
			return `"${str.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
		}
		return str;
	}

	private async _writeFile(uri: URI, content: string): Promise<void> {
		const buffer = new TextEncoder().encode(content);
		await this.fileSystemService.writeFile(uri, buffer);
	}
}
