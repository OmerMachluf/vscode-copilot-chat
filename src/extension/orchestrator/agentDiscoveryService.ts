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
import { IAgentInstructionService } from './agentInstructionService';

export const IAgentDiscoveryService = createDecorator<IAgentDiscoveryService>('agentDiscoveryService');

/**
 * Information about an available agent
 */
export interface AgentInfo {
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
	/** Optional capabilities/skills this agent has */
	capabilities?: string[];
	/** The folder path for repo agents, or asset path for builtins */
	path?: string;
}

export interface IAgentDiscoveryService {
	readonly _serviceBrand: undefined;

	/**
	 * Get all available agents (built-in + repo-defined).
	 * Results are cached until clearCache() is called.
	 */
	getAvailableAgents(): Promise<AgentInfo[]>;

	/**
	 * Get a specific agent by ID.
	 */
	getAgent(agentId: string): Promise<AgentInfo | undefined>;

	/**
	 * Get built-in agents from extension assets.
	 */
	getBuiltinAgents(): Promise<AgentInfo[]>;

	/**
	 * Get repo-defined agents from workspace.
	 */
	getRepoAgents(): Promise<AgentInfo[]>;

	/**
	 * Clear the cached agent list.
	 * Call this when workspace folders change.
	 */
	clearCache(): void;
}

/**
 * Built-in agents that are always available
 */
const BUILTIN_AGENTS: AgentInfo[] = [
	{
		id: 'agent',
		name: 'Agent',
		description: 'Default Copilot agent for implementing code changes',
		tools: ['search', 'fetch', 'edit', 'create', 'delete', 'run'],
		source: 'builtin',
		capabilities: ['code-generation', 'refactoring', 'bug-fixing'],
	},
	{
		id: 'ask',
		name: 'Ask',
		description: 'Q&A mode for answering questions about code',
		tools: ['search', 'fetch'],
		source: 'builtin',
		capabilities: ['explanation', 'documentation'],
	},
	{
		id: 'edit',
		name: 'Edit',
		description: 'Direct editing mode for making targeted changes',
		tools: ['edit'],
		source: 'builtin',
		capabilities: ['targeted-edits'],
	},
];

export class AgentDiscoveryService implements IAgentDiscoveryService {
	declare readonly _serviceBrand: undefined;

	private _cachedAgents: AgentInfo[] | undefined;
	private _cacheTimestamp = 0;
	private readonly _cacheTtlMs = 30000; // 30 seconds

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IAgentInstructionService private readonly agentInstructionService: IAgentInstructionService,
		@IVSCodeExtensionContext private readonly extensionContext: IVSCodeExtensionContext
	) { }

	async getAvailableAgents(): Promise<AgentInfo[]> {
		// Check cache
		const now = Date.now();
		if (this._cachedAgents && (now - this._cacheTimestamp) < this._cacheTtlMs) {
			return this._cachedAgents;
		}

		const agents: AgentInfo[] = [];

		// Get built-in agents
		const builtinAgents = await this.getBuiltinAgents();
		agents.push(...builtinAgents);

		// Get repo agents
		const repoAgents = await this.getRepoAgents();
		agents.push(...repoAgents);

		// Deduplicate by ID (repo agents override built-in)
		const deduped = new Map<string, AgentInfo>();
		for (const agent of agents) {
			const existing = deduped.get(agent.id);
			if (!existing || agent.source === 'repo') {
				deduped.set(agent.id, agent);
			}
		}

		this._cachedAgents = Array.from(deduped.values());
		this._cacheTimestamp = now;

		return this._cachedAgents;
	}

	async getAgent(agentId: string): Promise<AgentInfo | undefined> {
		const agents = await this.getAvailableAgents();
		return agents.find(a => a.id === agentId);
	}

	async getBuiltinAgents(): Promise<AgentInfo[]> {
		const agents: AgentInfo[] = [...BUILTIN_AGENTS];

		// Try to load additional agents from assets/agents/
		try {
			const agentsDir = URI.joinPath(this.extensionContext.extensionUri, 'assets', 'agents');
			const entries = await this.fileSystemService.readDirectory(agentsDir);

			for (const [name, type] of entries) {
				if (type === FileType.File && name.endsWith('.agent.md')) {
					const agentId = name.replace('.agent.md', '').toLowerCase();

					// Skip if already in builtin list
					if (BUILTIN_AGENTS.some(a => a.id === agentId)) {
						continue;
					}

					const fileUri = URI.joinPath(agentsDir, name);
					const content = await this._readFileAsString(fileUri);
					if (content) {
						const parsed = this.agentInstructionService.parseAgentDefinition(content, 'builtin');
						if (parsed) {
							agents.push({
								id: parsed.id,
								name: parsed.name,
								description: parsed.description,
								tools: parsed.tools,
								source: 'builtin',
								path: fileUri.toString(),
							});
						}
					}
				}
			}
		} catch {
			// Assets folder might not exist in some environments
		}

		return agents;
	}

	async getRepoAgents(): Promise<AgentInfo[]> {
		const agents: AgentInfo[] = [];
		const workspaceFolders = vscode.workspace.workspaceFolders;

		if (!workspaceFolders?.length) {
			return agents;
		}

		for (const folder of workspaceFolders) {
			const agentsDir = URI.joinPath(folder.uri, '.github', 'agents');

			try {
				// Check if the directory exists before trying to read it
				const stat = await this.fileSystemService.stat(agentsDir);
				if (stat.type !== FileType.Directory) {
					continue;
				}

				const entries = await this.fileSystemService.readDirectory(agentsDir);

				for (const [name, type] of entries) {
					if (type === FileType.Directory) {
						// Look for {name}.agent.md inside the folder
						const agentFile = URI.joinPath(agentsDir, name, `${name}.agent.md`);
						const content = await this._readFileAsString(agentFile);

						if (content) {
							const parsed = this.agentInstructionService.parseAgentDefinition(content, 'repo');
							if (parsed) {
								agents.push({
									id: parsed.id,
									name: parsed.name,
									description: parsed.description,
									tools: parsed.tools,
									source: 'repo',
									path: agentFile.toString(),
								});
							}
						}
					}
				}
			} catch {
				// .github/agents folder might not exist
			}
		}

		return agents;
	}

	clearCache(): void {
		this._cachedAgents = undefined;
		this._cacheTimestamp = 0;
	}

	private async _readFileAsString(uri: URI): Promise<string | undefined> {
		try {
			const buffer = await this.fileSystemService.readFile(uri);
			return new TextDecoder().decode(buffer);
		} catch {
			return undefined;
		}
	}
}

/**
 * Format agents as a string for use in prompts
 */
export function formatAgentsForPrompt(agents: AgentInfo[]): string {
	const lines: string[] = ['## Available Agents\n'];

	for (const agent of agents) {
		lines.push(`### @${agent.id} - ${agent.name}`);
		lines.push(`- **Description:** ${agent.description}`);
		lines.push(`- **Source:** ${agent.source}`);
		if (agent.tools.length > 0) {
			lines.push(`- **Tools:** ${agent.tools.join(', ')}`);
		}
		if (agent.capabilities?.length) {
			lines.push(`- **Capabilities:** ${agent.capabilities.join(', ')}`);
		}
		lines.push('');
	}

	return lines.join('\n');
}
