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
}

export class AgentInstructionService implements IAgentInstructionService {
	declare readonly _serviceBrand: undefined;

	private readonly _instructionCache = new Map<string, ComposedInstructions>();

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IVSCodeExtensionContext private readonly extensionContext: IVSCodeExtensionContext
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

		const result: ComposedInstructions = {
			agentId,
			instructions,
			files
		};

		this._instructionCache.set(agentId, result);
		return result;
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

		if (!def.id || !def.name) {
			return undefined;
		}

		return def as AgentDefinition;
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
