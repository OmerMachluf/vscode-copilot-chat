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
import {
	AgentDefinitionUnified,
	AgentFrontmatter,
	ClaudeSdkAgentDefinition,
	CommandDefinition,
	CommandFrontmatter,
	DefinitionSource,
	SkillMetadata,
} from './interfaces/definitions';

export const IUnifiedDefinitionService = createDecorator<IUnifiedDefinitionService>('unifiedDefinitionService');

/**
 * Unified Definition Service - Discovers and manages commands, agents, and skills.
 *
 * This service provides a single point of access for all definition types,
 * enabling sharing between GitHub Copilot Chat and Claude Agent SDK.
 *
 * Discovery Locations:
 * - Built-in: `assets/commands/`, `assets/agents/`, `assets/skills/`
 * - Repository: `.github/commands/`, `.github/agents/`, `.github/skills/`
 *
 * Priority: Repository definitions override built-in definitions with the same ID.
 */
export interface IUnifiedDefinitionService {
	readonly _serviceBrand: undefined;

	// =========================================================================
	// Commands
	// =========================================================================

	/**
	 * Discover all available commands.
	 * Results are cached with a 30-second TTL.
	 */
	discoverCommands(): Promise<CommandDefinition[]>;

	/**
	 * Get a specific command by ID.
	 * @param commandId The command ID (e.g., 'review-pr')
	 */
	getCommand(commandId: string): Promise<CommandDefinition | undefined>;

	// =========================================================================
	// Agents
	// =========================================================================

	/**
	 * Discover all available agents in unified format.
	 * Results are cached with a 30-second TTL.
	 */
	discoverAgents(): Promise<AgentDefinitionUnified[]>;

	/**
	 * Get a specific agent by ID.
	 * @param agentId The agent ID (e.g., 'architect')
	 */
	getAgent(agentId: string): Promise<AgentDefinitionUnified | undefined>;

	// =========================================================================
	// Skills (Metadata Only)
	// =========================================================================

	/**
	 * Discover all available skills (metadata only, no content).
	 * Results are cached with a 30-second TTL.
	 */
	discoverSkills(): Promise<SkillMetadata[]>;

	/**
	 * Load the content of a specific skill.
	 * @param skillId The skill ID
	 * @returns The skill content (markdown) or undefined if not found
	 */
	loadSkillContent(skillId: string): Promise<string | undefined>;


	// =========================================================================
	// Claude SDK Integration
	// =========================================================================

	/**
	 * Build agent definitions in Claude SDK format.
	 * Converts internal AgentDefinitionUnified to Claude SDK's AgentDefinition type.
	 * @returns Record of agent ID to Claude SDK AgentDefinition
	 */
	buildClaudeSdkAgents(): Promise<Record<string, ClaudeSdkAgentDefinition>>;

	// =========================================================================
	// Cache Management
	// =========================================================================

	/**
	 * Clear all cached definitions.
	 * Call this when workspace folders change or files are modified.
	 */
	clearCache(): void;
}

/**
 * Implementation of IUnifiedDefinitionService.
 */
export class UnifiedDefinitionService implements IUnifiedDefinitionService {
	declare readonly _serviceBrand: undefined;

	// Cache storage
	private _commandCache: CommandDefinition[] | undefined;
	private _agentCache: AgentDefinitionUnified[] | undefined;
	private _skillMetadataCache: SkillMetadata[] | undefined;
	private _skillContentCache = new Map<string, string>();
	private _cacheTimestamp = 0;
	private readonly _cacheTtlMs = 30000; // 30 seconds

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IVSCodeExtensionContext private readonly extensionContext: IVSCodeExtensionContext
	) { }

	// =========================================================================
	// Commands
	// =========================================================================

	async discoverCommands(): Promise<CommandDefinition[]> {
		// Check cache
		if (this._isCacheValid() && this._commandCache) {
			return this._commandCache;
		}

		const commands: CommandDefinition[] = [];

		// 1. Discover built-in commands
		const builtinCommands = await this._discoverBuiltinCommands();
		commands.push(...builtinCommands);

		// 2. Discover repo commands (higher priority, can override built-in)
		const repoCommands = await this._discoverRepoCommands();
		commands.push(...repoCommands);

		// Deduplicate by ID (repo overrides built-in)
		this._commandCache = this._deduplicateById(commands);
		this._updateCacheTimestamp();

		return this._commandCache;
	}

	async getCommand(commandId: string): Promise<CommandDefinition | undefined> {
		const commands = await this.discoverCommands();
		return commands.find(c => c.id.toLowerCase() === commandId.toLowerCase());
	}

	private async _discoverBuiltinCommands(): Promise<CommandDefinition[]> {
		const commands: CommandDefinition[] = [];

		try {
			const commandsDir = URI.joinPath(this.extensionContext.extensionUri, 'assets', 'commands');
			const entries = await this.fileSystemService.readDirectory(commandsDir);

			for (const [name, type] of entries) {
				if (type === FileType.File && name.endsWith('.command.md')) {
					const fileUri = URI.joinPath(commandsDir, name);
					const content = await this._readFileAsString(fileUri);
					if (content) {
						const command = this._parseCommandFile(content, 'builtin', fileUri.toString());
						if (command) {
							commands.push(command);
						}
					}
				}
			}
		} catch {
			// Assets folder might not exist in some environments
		}

		return commands;
	}

	private async _discoverRepoCommands(): Promise<CommandDefinition[]> {
		const commands: CommandDefinition[] = [];
		const workspaceFolders = vscode.workspace.workspaceFolders;

		if (!workspaceFolders?.length) {
			return commands;
		}

		for (const folder of workspaceFolders) {
			try {
				const commandsDir = URI.joinPath(folder.uri, '.github', 'commands');
				const stat = await this.fileSystemService.stat(commandsDir);
				if (stat.type !== FileType.Directory) {
					continue;
				}

				const entries = await this.fileSystemService.readDirectory(commandsDir);

				for (const [name, type] of entries) {
					if (type === FileType.File && name.endsWith('.command.md')) {
						const fileUri = URI.joinPath(commandsDir, name);
						const content = await this._readFileAsString(fileUri);
						if (content) {
							const command = this._parseCommandFile(content, 'repo', fileUri.toString());
							if (command) {
								commands.push(command);
							}
						}
					}
				}
			} catch {
				// .github/commands folder doesn't exist
			}
		}

		return commands;
	}

	private _parseCommandFile(content: string, source: DefinitionSource, path: string): CommandDefinition | undefined {
		// Parse YAML frontmatter
		const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
		if (!frontmatterMatch) {
			return undefined;
		}

		const frontmatterText = frontmatterMatch[1];
		const markdownContent = content.substring(frontmatterMatch[0].length).trim();

		// Parse frontmatter fields
		const frontmatter = this._parseCommandFrontmatter(frontmatterText);
		if (!frontmatter.name || !frontmatter.description) {
			return undefined;
		}

		// Derive command ID from filename
		const id = this._deriveIdFromPath(path, '.command.md');

		return {
			id,
			name: frontmatter.name,
			description: frontmatter.description,
			argumentHint: frontmatter.argumentHint,
			agents: frontmatter.agents,
			content: markdownContent,
			source,
			path,
		};
	}

	private _parseCommandFrontmatter(text: string): Partial<CommandFrontmatter> {
		const result: Partial<CommandFrontmatter> = {};

		// Parse name
		const nameMatch = text.match(/^name:\s*(.+)$/m);
		if (nameMatch) {
			result.name = this._stripQuotes(nameMatch[1].trim());
		}

		// Parse description
		const descMatch = text.match(/^description:\s*(.+)$/m);
		if (descMatch) {
			result.description = this._stripQuotes(descMatch[1].trim());
		}

		// Parse argumentHint
		const argHintMatch = text.match(/^argumentHint:\s*(.+)$/m);
		if (argHintMatch) {
			result.argumentHint = this._stripQuotes(argHintMatch[1].trim());
		}

		// Parse agents array
		const agentsMatch = text.match(/^agents:\s*\[([^\]]*)\]/m);
		if (agentsMatch) {
			result.agents = this._parseArrayField(agentsMatch[1]);
		}

		return result;
	}

	// =========================================================================
	// Agents
	// =========================================================================

	async discoverAgents(): Promise<AgentDefinitionUnified[]> {
		// Check cache
		if (this._isCacheValid() && this._agentCache) {
			return this._agentCache;
		}

		const agents: AgentDefinitionUnified[] = [];

		// 1. Discover built-in agents
		const builtinAgents = await this._discoverBuiltinAgents();
		agents.push(...builtinAgents);

		// 2. Discover repo agents (higher priority, can override built-in)
		const repoAgents = await this._discoverRepoAgents();
		agents.push(...repoAgents);

		// Deduplicate by ID (repo overrides built-in)
		this._agentCache = this._deduplicateById(agents);
		this._updateCacheTimestamp();

		return this._agentCache;
	}

	async getAgent(agentId: string): Promise<AgentDefinitionUnified | undefined> {
		const agents = await this.discoverAgents();
		return agents.find(a => a.id.toLowerCase() === agentId.toLowerCase());
	}

	private async _discoverBuiltinAgents(): Promise<AgentDefinitionUnified[]> {
		const agents: AgentDefinitionUnified[] = [];

		try {
			const agentsDir = URI.joinPath(this.extensionContext.extensionUri, 'assets', 'agents');
			const entries = await this.fileSystemService.readDirectory(agentsDir);

			for (const [name, type] of entries) {
				if (type === FileType.File && name.endsWith('.agent.md')) {
					const fileUri = URI.joinPath(agentsDir, name);
					const content = await this._readFileAsString(fileUri);
					if (content) {
						const agent = this._parseAgentFile(content, 'builtin', fileUri.toString());
						if (agent) {
							agents.push(agent);
						}
					}
				}
			}
		} catch {
			// Assets folder might not exist
		}

		return agents;
	}

	private async _discoverRepoAgents(): Promise<AgentDefinitionUnified[]> {
		const agents: AgentDefinitionUnified[] = [];
		const workspaceFolders = vscode.workspace.workspaceFolders;

		if (!workspaceFolders?.length) {
			return agents;
		}

		for (const folder of workspaceFolders) {
			// Scan .github/agents/ directory
			const agentsDir = URI.joinPath(folder.uri, '.github', 'agents');
			await this._scanAgentsDirectory(agentsDir, agents);
		}

		return agents;
	}

	private async _scanAgentsDirectory(agentsDir: URI, agents: AgentDefinitionUnified[]): Promise<void> {
		try {
			const stat = await this.fileSystemService.stat(agentsDir);
			if (stat.type !== FileType.Directory) {
				return;
			}

			const entries = await this.fileSystemService.readDirectory(agentsDir);

			for (const [name, type] of entries) {
				if (type === FileType.Directory) {
					// Legacy format: .github/agents/{name}/{name}.agent.md
					const agentFile = URI.joinPath(agentsDir, name, `${name}.agent.md`);
					const content = await this._readFileAsString(agentFile);
					if (content) {
						const agent = this._parseAgentFile(content, 'repo', agentFile.toString());
						if (agent) {
							agents.push(agent);
						}
					}
				} else if (type === FileType.File && name.endsWith('.agent.md')) {
					// New format: .github/agents/*.agent.md
					const fileUri = URI.joinPath(agentsDir, name);
					const content = await this._readFileAsString(fileUri);
					if (content) {
						const agent = this._parseAgentFile(content, 'repo', fileUri.toString());
						if (agent) {
							agents.push(agent);
						}
					}
				}
			}
		} catch {
			// .github/agents folder doesn't exist
		}
	}

	private _parseAgentFile(content: string, source: 'builtin' | 'repo', path: string): AgentDefinitionUnified | undefined {
		// Parse YAML frontmatter
		const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
		if (!frontmatterMatch) {
			return undefined;
		}

		const frontmatterText = frontmatterMatch[1];
		const promptContent = content.substring(frontmatterMatch[0].length).trim();

		// Parse frontmatter fields
		const frontmatter = this._parseAgentFrontmatter(frontmatterText);
		if (!frontmatter.name || !frontmatter.description) {
			return undefined;
		}

		// Derive agent ID from filename
		const id = this._deriveIdFromPath(path, '.agent.md');

		return {
			id,
			name: frontmatter.name,
			description: frontmatter.description,
			prompt: promptContent,
			tools: frontmatter.tools,
			disallowedTools: frontmatter.disallowedTools,
			model: frontmatter.model,
			useSkills: frontmatter.useSkills,
			hasArchitectureAccess: frontmatter.hasArchitectureAccess,
			backend: frontmatter.backend,
			claudeSlashCommand: frontmatter.claudeSlashCommand,
			source,
			path,
		};
	}

	private _parseAgentFrontmatter(text: string): Partial<AgentFrontmatter> {
		const result: Partial<AgentFrontmatter> = {};

		// Parse name
		const nameMatch = text.match(/^name:\s*(.+)$/m);
		if (nameMatch) {
			result.name = this._stripQuotes(nameMatch[1].trim());
		}

		// Parse description
		const descMatch = text.match(/^description:\s*(.+)$/m);
		if (descMatch) {
			result.description = this._stripQuotes(descMatch[1].trim());
		}

		// Parse tools array
		const toolsMatch = text.match(/^tools:\s*\[([^\]]*)\]/m);
		if (toolsMatch) {
			result.tools = this._parseArrayField(toolsMatch[1]);
		}

		// Parse disallowedTools array
		const disallowedMatch = text.match(/^disallowedTools:\s*\[([^\]]*)\]/m);
		if (disallowedMatch) {
			result.disallowedTools = this._parseArrayField(disallowedMatch[1]);
		}

		// Parse model
		const modelMatch = text.match(/^model:\s*(sonnet|opus|haiku|inherit)$/m);
		if (modelMatch) {
			result.model = modelMatch[1] as 'sonnet' | 'opus' | 'haiku' | 'inherit';
		}

		// Parse useSkills array
		const skillsMatch = text.match(/^useSkills:\s*\[([^\]]*)\]/m);
		if (skillsMatch) {
			result.useSkills = this._parseArrayField(skillsMatch[1]);
		}

		// Parse hasArchitectureAccess
		const archAccessMatch = text.match(/^hasArchitectureAccess:\s*(true|false)$/m);
		if (archAccessMatch) {
			result.hasArchitectureAccess = archAccessMatch[1] === 'true';
		}

		// Parse backend
		const backendMatch = text.match(/^backend:\s*(copilot|claude)$/m);
		if (backendMatch) {
			result.backend = backendMatch[1] as 'copilot' | 'claude';
		}

		// Parse claudeSlashCommand
		const slashCmdMatch = text.match(/^claudeSlashCommand:\s*(.+)$/m);
		if (slashCmdMatch) {
			result.claudeSlashCommand = this._stripQuotes(slashCmdMatch[1].trim());
		}

		return result;
	}

	// =========================================================================
	// Skills (Metadata Only)
	// =========================================================================

	async discoverSkills(): Promise<SkillMetadata[]> {
		// Check cache
		if (this._isCacheValid() && this._skillMetadataCache) {
			return this._skillMetadataCache;
		}

		const skills: SkillMetadata[] = [];

		// 1. Discover built-in skills
		const builtinSkills = await this._discoverBuiltinSkills();
		skills.push(...builtinSkills);

		// 2. Discover repo skills (higher priority, can override built-in)
		const repoSkills = await this._discoverRepoSkills();
		skills.push(...repoSkills);

		// Deduplicate by ID (repo overrides built-in)
		this._skillMetadataCache = this._deduplicateById(skills);
		this._updateCacheTimestamp();

		return this._skillMetadataCache;
	}

	async loadSkillContent(skillId: string): Promise<string | undefined> {
		const normalizedId = skillId.toLowerCase();

		// Check content cache
		if (this._skillContentCache.has(normalizedId)) {
			return this._skillContentCache.get(normalizedId);
		}

		// Find skill metadata
		const skills = await this.discoverSkills();
		const skill = skills.find(s => s.id.toLowerCase() === normalizedId);
		if (!skill?.path) {
			return undefined;
		}

		// Load content from file
		try {
			const content = await this._readFileAsString(URI.parse(skill.path));
			if (content) {
				// Extract content after frontmatter
				const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
				if (frontmatterMatch) {
					const skillContent = content.substring(frontmatterMatch[0].length).trim();
					this._skillContentCache.set(normalizedId, skillContent);
					return skillContent;
				}
			}
		} catch {
			// File read failed
		}

		return undefined;
	}

	private async _discoverBuiltinSkills(): Promise<SkillMetadata[]> {
		const skills: SkillMetadata[] = [];

		try {
			// Check for global built-in skills: assets/skills/
			const skillsDir = URI.joinPath(this.extensionContext.extensionUri, 'assets', 'skills');
			await this._scanSkillsDirectory(skillsDir, skills, 'builtin');
		} catch {
			// Skills directory doesn't exist
		}

		return skills;
	}

	private async _discoverRepoSkills(): Promise<SkillMetadata[]> {
		const skills: SkillMetadata[] = [];
		const workspaceFolders = vscode.workspace.workspaceFolders;

		if (!workspaceFolders?.length) {
			return skills;
		}

		for (const folder of workspaceFolders) {
			try {
				// Global repo skills: .github/skills/
				const skillsDir = URI.joinPath(folder.uri, '.github', 'skills');
				await this._scanSkillsDirectory(skillsDir, skills, 'repo');
			} catch {
				// .github/skills folder doesn't exist
			}
		}

		return skills;
	}

	private async _scanSkillsDirectory(skillsDir: URI, skills: SkillMetadata[], source: 'builtin' | 'repo'): Promise<void> {
		try {
			const stat = await this.fileSystemService.stat(skillsDir);
			if (stat.type !== FileType.Directory) {
				return;
			}

			const entries = await this.fileSystemService.readDirectory(skillsDir);

			for (const [name, type] of entries) {
				if (type === FileType.File && name.endsWith('.skill.md')) {
					const fileUri = URI.joinPath(skillsDir, name);
					const content = await this._readFileAsString(fileUri);
					if (content) {
						const skill = this._parseSkillMetadata(content, source, fileUri.toString());
						if (skill) {
							skills.push(skill);
						}
					}
				}
			}
		} catch {
			// Skills directory doesn't exist
		}
	}

	private _parseSkillMetadata(content: string, source: 'builtin' | 'repo', path: string): SkillMetadata | undefined {
		// Parse YAML frontmatter
		const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
		if (!frontmatterMatch) {
			return undefined;
		}

		const frontmatterText = frontmatterMatch[1];

		// Parse frontmatter fields
		let name: string | undefined;
		let description: string | undefined;
		let keywords: string[] = [];

		// Parse name
		const nameMatch = frontmatterText.match(/^name:\s*(.+)$/m);
		if (nameMatch) {
			name = this._stripQuotes(nameMatch[1].trim());
		}

		// Parse description
		const descMatch = frontmatterText.match(/^description:\s*(.+)$/m);
		if (descMatch) {
			description = this._stripQuotes(descMatch[1].trim());
		}

		// Parse keywords array
		const keywordsMatch = frontmatterText.match(/^keywords:\s*\[([^\]]*)\]/m);
		if (keywordsMatch) {
			keywords = this._parseArrayField(keywordsMatch[1]);
		} else {
			// Try YAML list format
			const keywordsListMatch = frontmatterText.match(/^keywords:\s*\n((?:\s*-\s*.+\n?)+)/m);
			if (keywordsListMatch) {
				keywords = keywordsListMatch[1]
					.split('\n')
					.map(line => line.replace(/^\s*-\s*/, '').trim())
					.map(k => this._stripQuotes(k))
					.filter(k => k.length > 0);
			}
		}

		if (!name || !description) {
			return undefined;
		}

		// Derive skill ID from filename
		const id = this._deriveIdFromPath(path, '.skill.md');

		return {
			id,
			name,
			description,
			keywords,
			source,
			path,
		};
	}

	// =========================================================================
	// Claude SDK Integration
	// =========================================================================

	async buildClaudeSdkAgents(): Promise<Record<string, ClaudeSdkAgentDefinition>> {
		const agents = await this.discoverAgents();
		const result: Record<string, ClaudeSdkAgentDefinition> = {};

		for (const agent of agents) {
			result[agent.id] = {
				description: agent.description,
				tools: agent.tools,
				disallowedTools: agent.disallowedTools,
				prompt: agent.prompt,
				model: agent.model,
			};
		}

		return result;
	}

	// =========================================================================
	// Cache Management
	// =========================================================================

	clearCache(): void {
		this._commandCache = undefined;
		this._agentCache = undefined;
		this._skillMetadataCache = undefined;
		this._skillContentCache.clear();
		this._cacheTimestamp = 0;
	}

	private _isCacheValid(): boolean {
		return (Date.now() - this._cacheTimestamp) < this._cacheTtlMs;
	}

	private _updateCacheTimestamp(): void {
		this._cacheTimestamp = Date.now();
	}

	// =========================================================================
	// Private Helpers
	// =========================================================================

	private async _readFileAsString(uri: URI): Promise<string | undefined> {
		try {
			const buffer = await this.fileSystemService.readFile(uri);
			return new TextDecoder().decode(buffer);
		} catch {
			return undefined;
		}
	}

	private _deriveIdFromPath(path: string, suffix: string): string {
		// Extract filename without suffix
		const parts = path.replace(/\\/g, '/').split('/');
		const filename = parts.pop() || '';
		return filename.replace(suffix, '').toLowerCase();
	}

	private _stripQuotes(value: string): string {
		return value.replace(/^["']|["']$/g, '');
	}

	private _parseArrayField(arrayContent: string): string[] {
		return arrayContent
			.split(',')
			.map(s => s.trim())
			.map(s => this._stripQuotes(s))
			.filter(s => s.length > 0);
	}

	private _deduplicateById<T extends { id: string; source: 'builtin' | 'repo' | DefinitionSource }>(items: T[]): T[] {
		const deduped = new Map<string, T>();
		for (const item of items) {
			const normalizedId = item.id.toLowerCase();
			const existing = deduped.get(normalizedId);
			// Repo definitions override built-in/package
			if (!existing || item.source === 'repo') {
				deduped.set(normalizedId, item);
			}
		}
		return Array.from(deduped.values());
	}
}

/**
 * Format skill metadata as a string for inclusion in agent prompts.
 * This provides a table of available skills that agents can load on-demand.
 */
export function formatSkillsMetadataForPrompt(skills: SkillMetadata[]): string {
	if (skills.length === 0) {
		return '';
	}

	const lines: string[] = [
		'## Available Skills\n',
		'You have access to domain-specific knowledge via skills. Use the loadSkill tool to load any of these:\n',
		'| Skill | Description |',
		'|-------|-------------|',
	];

	for (const skill of skills) {
		lines.push(`| ${skill.id} | ${skill.description} |`);
	}

	lines.push('');
	lines.push('Example: loadSkill({ skillId: "' + (skills[0]?.id || 'skill-name') + '" })');
	lines.push('');

	return lines.join('\n');
}
