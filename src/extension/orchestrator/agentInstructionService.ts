/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IVSCodeExtensionContext } from '../../platform/extContext/common/extensionContext';
import { IFileSystemService } from '../../platform/filesystem/common/fileSystemService';
import { FileType } from '../../platform/filesystem/common/fileTypes';
import { URI } from '../../util/vs/base/common/uri';
import { createDecorator } from '../../util/vs/platform/instantiation/common/instantiation';
import { ISkillsService, formatSkillsForPrompt } from './skillsService';
import { IUnifiedDefinitionService } from './unifiedDefinitionService';

export const IAgentInstructionService = createDecorator<IAgentInstructionService>('agentInstructionService');

/**
 * Parsed agent definition from an agent.md file
 */
export interface AgentDefinition {
	/** Agent ID (e.g., 'planner', 'architect') */
	id: string;
	/** Human-readable name */
	name: string;
	/** Agent description */
	description: string;
	/** Tools this agent can use */
	tools: string[];
	/** Source of the agent definition */
	source: 'builtin' | 'repo';
	/** Full instruction content (including frontmatter) */
	content: string;
	/** Whether this agent has access to architecture documents */
	hasArchitectureAccess?: boolean;
	/** Skills to always load for this agent */
	useSkills?: string[];
	/** Preferred backend for this agent */
	backend?: 'copilot' | 'claude';
	/** Claude slash command override */
	claudeSlashCommand?: string;
}

/**
 * Composed instructions for an agent
 */
export interface ComposedInstructions {
	/** Agent ID */
	agentId: string;
	/** All instruction contents in order of application */
	instructions: string[];
	/** Files that were loaded */
	files: string[];
	/** Architecture documents (only for agents with hasArchitectureAccess) */
	architectureDocs?: string[];
	/** Architecture document files that were loaded */
	architectureFiles?: string[];
}

export interface IAgentInstructionService {
	readonly _serviceBrand: undefined;

	/**
	 * Load and compose all instructions for an agent.
	 * Instructions are loaded in order (later overrides earlier):
	 * 1. Built-in default (assets/agents/{agent}.agent.md)
	 * 2. Global workspace instructions (.github/instructions/*instructions*.md)
	 * 3. Agent-specific workspace instructions (.github/agents/{agent}/*instructions*.md)
	 *
	 * Note: Only files with 'instructions' in their name are loaded automatically.
	 * Other files (skills, knowledge bases) can be referenced and read on-demand.
	 */
	loadInstructions(agentId: string): Promise<ComposedInstructions>;

	/**
	 * Get global instructions that apply to all agents.
	 * Loads from .github/instructions/*.md
	 */
	getGlobalInstructions(): Promise<string[]>;

	/**
	 * Get agent-specific instructions from the workspace.
	 * Loads from .github/agents/{agentId}/*instructions*.md
	 * Only files with 'instructions' in their name are loaded automatically.
	 * Other files in the agent folder can be read on-demand by other instructions.
	 */
	getAgentInstructions(agentId: string): Promise<string[]>;

	/**
	 * Get the built-in default instructions for an agent.
	 * Loads from extension assets/agents/{agentId}.agent.md
	 */
	getBuiltinAgentInstructions(agentId: string): Promise<string | undefined>;

	/**
	 * Parse an agent definition file (.agent.md) to extract metadata.
	 */
	parseAgentDefinition(content: string, source: 'builtin' | 'repo'): AgentDefinition | undefined;

	/**
	 * Get a formatted skill catalog for inclusion in agent prompts.
	 * This tells agents what skills are available to load via the loadSkill tool.
	 * @returns Formatted markdown listing available skills with descriptions
	 */
	getSkillCatalog(): Promise<string>;

	/**
	 * Get architecture documents for an agent.
	 * Only returns documents if the agent has hasArchitectureAccess: true.
	 * @param agentId The agent ID
	 * @param hasArchitectureAccess Whether the agent has access to architecture docs
	 * @returns Architecture document contents and file paths
	 */
	getArchitectureDocs(agentId: string, hasArchitectureAccess: boolean): Promise<{ docs: string[]; files: string[] }>;
}

export class AgentInstructionService implements IAgentInstructionService {
	declare readonly _serviceBrand: undefined;

	private readonly _instructionCache = new Map<string, ComposedInstructions>();
	private readonly _agentDefinitionCache = new Map<string, AgentDefinition>();

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IVSCodeExtensionContext private readonly extensionContext: IVSCodeExtensionContext,
		@ISkillsService private readonly skillsService: ISkillsService,
		@IUnifiedDefinitionService private readonly unifiedDefinitionService: IUnifiedDefinitionService
	) { }

	async loadInstructions(agentId: string): Promise<ComposedInstructions> {
		// Check cache first
		const cached = this._instructionCache.get(agentId);
		if (cached) {
			return cached;
		}

		const instructions: string[] = [];
		const files: string[] = [];

		// 1. Load built-in default instructions
		const builtinInstructions = await this.getBuiltinAgentInstructions(agentId);
		if (builtinInstructions) {
			instructions.push(builtinInstructions);
			files.push(`[builtin] assets/agents/${agentId}.agent.md`);
		}

		// 2. Load global workspace instructions
		const globalInstructions = await this.getGlobalInstructions();
		for (let i = 0; i < globalInstructions.length; i++) {
			instructions.push(globalInstructions[i]);
			files.push(`.github/instructions/${i}.md`);
		}

		// 3. Load agent-specific workspace instructions
		const agentInstructions = await this.getAgentInstructions(agentId);
		for (let i = 0; i < agentInstructions.length; i++) {
			instructions.push(agentInstructions[i]);
			files.push(`.github/agents/${agentId}/${i}.md`);
		}

		// 4. Get agent definition for skill and architecture access settings
		const agentDef = await this._getAgentDefinition(agentId);

		// 5. Load skills from agent's useSkills array
		const skillsContent: string[] = [];
		const skillFiles: string[] = [];
		if (agentDef?.useSkills && agentDef.useSkills.length > 0) {
			const skills = await this.skillsService.getSkillsByReference(agentId, agentDef.useSkills);
			if (skills.length > 0) {
				const formattedSkills = formatSkillsForPrompt(skills);
				skillsContent.push(formattedSkills);
				for (const skill of skills) {
					skillFiles.push(skill.path || `[skill] ${skill.id}`);
				}
			}
		}

		// 6. Load architecture documents if agent has access
		const architectureDocs: string[] = [];
		const architectureFiles: string[] = [];
		if (agentDef?.hasArchitectureAccess) {
			const archResult = await this.getArchitectureDocs(agentId, true);
			architectureDocs.push(...archResult.docs);
			architectureFiles.push(...archResult.files);
		}

		// 7. Add skill catalog so agents know what skills are available to load
		const skillCatalog = await this.getSkillCatalog();
		if (skillCatalog) {
			skillsContent.push(skillCatalog);
			skillFiles.push('[skill-catalog]');
		}

		const result: ComposedInstructions = {
			agentId,
			instructions: [...instructions, ...skillsContent],
			files: [...files, ...skillFiles],
			architectureDocs: architectureDocs.length > 0 ? architectureDocs : undefined,
			architectureFiles: architectureFiles.length > 0 ? architectureFiles : undefined,
		};

		this._instructionCache.set(agentId, result);
		return result;
	}

	/**
	 * Get agent definition, checking both builtin and repo sources
	 */
	private async _getAgentDefinition(agentId: string): Promise<AgentDefinition | undefined> {
		// Check cache
		const cached = this._agentDefinitionCache.get(agentId);
		if (cached) {
			return cached;
		}

		// Try builtin first
		const builtinContent = await this.getBuiltinAgentInstructions(agentId);
		if (builtinContent) {
			const parsed = this.parseAgentDefinition(builtinContent, 'builtin');
			if (parsed) {
				this._agentDefinitionCache.set(agentId, parsed);
				return parsed;
			}
		}

		// Try repo agents
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders?.length) {
			for (const folder of workspaceFolders) {
				const agentFile = URI.joinPath(folder.uri, '.github', 'agents', agentId, `${agentId}.agent.md`);
				const content = await this._readFileAsString(agentFile);
				if (content) {
					const parsed = this.parseAgentDefinition(content, 'repo');
					if (parsed) {
						this._agentDefinitionCache.set(agentId, parsed);
						return parsed;
					}
				}
			}
		}

		return undefined;
	}

	async getGlobalInstructions(): Promise<string[]> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders?.length) {
			return [];
		}

		const instructions: string[] = [];

		for (const folder of workspaceFolders) {
			const instructionsDir = URI.joinPath(folder.uri, '.github', 'instructions');
			const mdFiles = await this._readMarkdownFilesInDir(instructionsDir);
			instructions.push(...mdFiles);
		}

		return instructions;
	}

	async getAgentInstructions(agentId: string): Promise<string[]> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders?.length) {
			return [];
		}

		const instructions: string[] = [];

		for (const folder of workspaceFolders) {
			const agentDir = URI.joinPath(folder.uri, '.github', 'agents', agentId);
			const mdFiles = await this._readMarkdownFilesInDir(agentDir);
			instructions.push(...mdFiles);
		}

		return instructions;
	}

	async getBuiltinAgentInstructions(agentId: string): Promise<string | undefined> {
		// Try different naming conventions
		const possibleNames = [
			`${agentId}.agent.md`,
			`${this._capitalizeFirst(agentId)}.agent.md`
		];

		for (const name of possibleNames) {
			const agentFile = URI.joinPath(this.extensionContext.extensionUri, 'assets', 'agents', name);
			try {
				const content = await this._readFileAsString(agentFile);
				if (content) {
					return content;
				}
			} catch {
				// File doesn't exist, try next
			}
		}

		return undefined;
	}

	parseAgentDefinition(content: string, source: 'builtin' | 'repo'): AgentDefinition | undefined {
		// Parse YAML frontmatter from markdown
		const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
		if (!frontmatterMatch) {
			return undefined;
		}

		const frontmatter = frontmatterMatch[1];
		const def: Partial<AgentDefinition> = {
			source,
			content
		};

		// Parse simple YAML fields
		const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
		if (nameMatch) {
			def.name = nameMatch[1].trim();
			def.id = def.name.toLowerCase();
		}

		const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
		if (descMatch) {
			def.description = descMatch[1].trim();
		}

		const toolsMatch = frontmatter.match(/^tools:\s*\[([^\]]*)\]/m);
		if (toolsMatch) {
			def.tools = toolsMatch[1]
				.split(',')
				.map(t => t.trim().replace(/['"]/g, ''))
				.filter(t => t.length > 0);
		} else {
			def.tools = [];
		}

		// Parse hasArchitectureAccess (boolean)
		const archAccessMatch = frontmatter.match(/^hasArchitectureAccess:\s*(true|false)$/m);
		if (archAccessMatch) {
			def.hasArchitectureAccess = archAccessMatch[1] === 'true';
		}

		// Parse useSkills array
		const useSkillsMatch = frontmatter.match(/^useSkills:\s*\[([^\]]*)\]/m);
		if (useSkillsMatch) {
			def.useSkills = useSkillsMatch[1]
				.split(',')
				.map(s => s.trim().replace(/['"]/g, ''))
				.filter(s => s.length > 0);
		}

		// Parse backend preference
		const backendMatch = frontmatter.match(/^backend:\s*(copilot|claude)$/m);
		if (backendMatch) {
			def.backend = backendMatch[1] as 'copilot' | 'claude';
		}

		// Parse Claude slash command override
		const slashCmdMatch = frontmatter.match(/^claudeSlashCommand:\s*(.+)$/m);
		if (slashCmdMatch) {
			def.claudeSlashCommand = slashCmdMatch[1].trim();
		}

		if (!def.id || !def.name) {
			return undefined;
		}

		return def as AgentDefinition;
	}

	async getArchitectureDocs(agentId: string, hasArchitectureAccess: boolean): Promise<{ docs: string[]; files: string[] }> {
		// Only return architecture docs for agents with access
		if (!hasArchitectureAccess) {
			return { docs: [], files: [] };
		}

		const docs: string[] = [];
		const files: string[] = [];

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders?.length) {
			return { docs, files };
		}

		for (const folder of workspaceFolders) {
			// Look for architecture docs in multiple locations:
			// 1. Agent-specific: .github/agents/{agentId}/architecture/
			// 2. Global architecture: .github/agents/architecture/ (shared)

			const agentArchDir = URI.joinPath(folder.uri, '.github', 'agents', agentId, 'architecture');
			const agentArchDocs = await this._readArchitectureFilesInDir(agentArchDir);
			for (const { content, path } of agentArchDocs) {
				docs.push(content);
				files.push(path);
			}

			// Also check other agents' architecture dirs that might be shared
			// (e.g., architect's architecture docs should be accessible to repository-researcher)
			if (agentId !== 'architect') {
				const architectArchDir = URI.joinPath(folder.uri, '.github', 'agents', 'architect', 'architecture');
				const sharedArchDocs = await this._readArchitectureFilesInDir(architectArchDir);
				for (const { content, path } of sharedArchDocs) {
					// Avoid duplicates
					if (!files.includes(path)) {
						docs.push(content);
						files.push(path);
					}
				}
			}
		}

		return { docs, files };
	}

	/**
	 * Get a formatted skill catalog for inclusion in agent prompts.
	 * This lists all available skills that can be loaded via the loadSkill tool.
	 */
	async getSkillCatalog(): Promise<string> {
		const skills = await this.unifiedDefinitionService.discoverSkills();

		if (skills.length === 0) {
			return '';
		}

		const lines: string[] = [
			'## Available Skills',
			'',
			'Use the `loadSkill` tool to load domain-specific knowledge on-demand:',
			'```',
			'loadSkill({ skillId: "skill-name" })',
			'```',
			'',
			'| Skill ID | Description |',
			'|----------|-------------|',
		];

		for (const skill of skills) {
			const description = skill.description || 'No description available';
			lines.push(`| ${skill.id} | ${description} |`);
		}

		lines.push('');

		return lines.join('\n');
	}

	/**
	 * Clear the instruction cache
	 */
	clearCache(): void {
		this._instructionCache.clear();
	}

	private async _readMarkdownFilesInDir(dirUri: URI): Promise<string[]> {
		try {
			const entries = await this.fileSystemService.readDirectory(dirUri);
			const mdFiles = entries
				.filter(([name, type]) => type === FileType.File && name.endsWith('.md') && name.includes('instructions'))
				.sort(([a], [b]) => a.localeCompare(b)); // Sort alphabetically for consistent ordering

			const contents: string[] = [];
			for (const [name] of mdFiles) {
				const fileUri = URI.joinPath(dirUri, name);
				const content = await this._readFileAsString(fileUri);
				if (content) {
					contents.push(content);
				}
			}

			return contents;
		} catch {
			// Directory doesn't exist
			return [];
		}
	}

	private async _readArchitectureFilesInDir(dirUri: URI): Promise<Array<{ content: string; path: string }>> {
		const results: Array<{ content: string; path: string }> = [];

		try {
			const entries = await this.fileSystemService.readDirectory(dirUri);
			const archFiles = entries
				.filter(([name, type]) => type === FileType.File && name.endsWith('.architecture.md'))
				.sort(([a], [b]) => a.localeCompare(b));

			for (const [name] of archFiles) {
				const fileUri = URI.joinPath(dirUri, name);
				const content = await this._readFileAsString(fileUri);
				if (content) {
					results.push({ content, path: fileUri.toString() });
				}
			}
		} catch {
			// Directory doesn't exist
		}

		return results;
	}

	private async _readFileAsString(uri: URI): Promise<string | undefined> {
		try {
			const buffer = await this.fileSystemService.readFile(uri);
			return new TextDecoder().decode(buffer);
		} catch {
			return undefined;
		}
	}

	private _capitalizeFirst(str: string): string {
		if (!str) {
			return str;
		}
		return str.charAt(0).toUpperCase() + str.slice(1);
	}
}
