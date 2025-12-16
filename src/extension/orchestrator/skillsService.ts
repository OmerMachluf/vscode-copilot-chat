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
import { ISkill, ISkillDiscoveryResult, ISkillFrontmatter, ISkillReference } from './interfaces/skill';

export const ISkillsService = createDecorator<ISkillsService>('skillsService');

/**
 * Service for discovering and loading skills.
 *
 * Skills are domain-specific knowledge modules that agents can reference on-demand.
 * Unlike instructions (which are always loaded), skills are only loaded when explicitly referenced.
 *
 * Skill files are located at:
 * - Built-in: assets/agents/{agentId}/skills/*.skill.md
 * - Repo: .github/agents/{agentId}/skills/*.skill.md
 * - Global: .github/skills/*.skill.md
 */
export interface ISkillsService {
	readonly _serviceBrand: undefined;

	/**
	 * Discover all available skills for an agent.
	 * @param agentId The agent ID to discover skills for
	 * @returns Discovery result with categorized skills
	 */
	discoverSkills(agentId: string): Promise<ISkillDiscoveryResult>;

	/**
	 * Get a specific skill by ID.
	 * @param agentId The agent context (for agent-specific skills)
	 * @param skillId The skill ID to retrieve
	 * @returns The skill if found, undefined otherwise
	 */
	getSkill(agentId: string, skillId: string): Promise<ISkill | undefined>;

	/**
	 * Get multiple skills by their references.
	 * @param agentId The agent context
	 * @param refs Array of skill IDs to retrieve
	 * @returns Array of found skills (missing skills are silently skipped)
	 */
	getSkillsByReference(agentId: string, refs: string[]): Promise<ISkill[]>;

	/**
	 * Parse skill references from a prompt string.
	 * Extracts `#skill:name` references from the prompt.
	 * @param prompt The prompt text to parse
	 * @returns Array of parsed skill references
	 */
	parseSkillReferences(prompt: string): ISkillReference[];

	/**
	 * Load skills for an agent based on both prompt references and agent definition.
	 * @param agentId The agent ID
	 * @param prompt The prompt text (for `#skill:name` references)
	 * @param useSkills Skills specified in agent definition
	 * @returns Combined array of loaded skills (deduplicated)
	 */
	loadSkillsForAgent(agentId: string, prompt: string, useSkills?: string[]): Promise<ISkill[]>;

	/**
	 * Clear the skill cache.
	 * Call this when workspace folders change or skills are modified.
	 */
	clearCache(): void;
}

export class SkillsService implements ISkillsService {
	declare readonly _serviceBrand: undefined;

	private readonly _skillCache = new Map<string, ISkill>();
	private readonly _discoveryCache = new Map<string, ISkillDiscoveryResult>();
	private _cacheTimestamp = 0;
	private readonly _cacheTtlMs = 30000; // 30 seconds

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IVSCodeExtensionContext private readonly extensionContext: IVSCodeExtensionContext
	) { }

	async discoverSkills(agentId: string): Promise<ISkillDiscoveryResult> {
		// Check cache
		const now = Date.now();
		const cacheKey = `discovery:${agentId}`;
		const cached = this._discoveryCache.get(cacheKey);
		if (cached && (now - this._cacheTimestamp) < this._cacheTtlMs) {
			return cached;
		}

		const result: ISkillDiscoveryResult = {
			builtinSkills: [],
			repoSkills: [],
			agentSkills: [],
		};

		// 1. Discover built-in skills from extension assets
		result.builtinSkills = await this._discoverBuiltinSkills(agentId);

		// 2. Discover global repo skills from .github/skills/
		result.repoSkills = await this._discoverGlobalRepoSkills();

		// 3. Discover agent-specific skills from .github/agents/{agentId}/skills/
		result.agentSkills = await this._discoverAgentRepoSkills(agentId);

		// Cache results
		this._discoveryCache.set(cacheKey, result);
		this._cacheTimestamp = now;

		return result;
	}

	async getSkill(agentId: string, skillId: string): Promise<ISkill | undefined> {
		const normalizedId = skillId.toLowerCase();
		const cacheKey = `${agentId}:${normalizedId}`;

		// Check cache first
		if (this._skillCache.has(cacheKey)) {
			return this._skillCache.get(cacheKey);
		}

		// Discover skills and search
		const discovery = await this.discoverSkills(agentId);
		const allSkills = [
			...discovery.agentSkills,  // Agent-specific takes priority
			...discovery.repoSkills,   // Then repo-global
			...discovery.builtinSkills, // Then built-in
		];

		const skill = allSkills.find(s => s.id.toLowerCase() === normalizedId);
		if (skill) {
			this._skillCache.set(cacheKey, skill);
		}

		return skill;
	}

	async getSkillsByReference(agentId: string, refs: string[]): Promise<ISkill[]> {
		const skills: ISkill[] = [];
		const seen = new Set<string>();

		for (const ref of refs) {
			const normalizedRef = ref.toLowerCase();
			if (seen.has(normalizedRef)) {
				continue;
			}
			seen.add(normalizedRef);

			const skill = await this.getSkill(agentId, ref);
			if (skill) {
				skills.push(skill);
			}
		}

		return skills;
	}

	parseSkillReferences(prompt: string): ISkillReference[] {
		const references: ISkillReference[] = [];
		// Match #skill:name pattern
		const regex = /#skill:([a-zA-Z0-9_-]+)/g;
		let match;

		while ((match = regex.exec(prompt)) !== null) {
			references.push({
				skillId: match[1],
			});
		}

		return references;
	}

	async loadSkillsForAgent(agentId: string, prompt: string, useSkills?: string[]): Promise<ISkill[]> {
		const skillIds = new Set<string>();

		// 1. Parse skill references from prompt
		const promptRefs = this.parseSkillReferences(prompt);
		for (const ref of promptRefs) {
			skillIds.add(ref.skillId);
		}

		// 2. Add skills from agent definition's useSkills array
		if (useSkills) {
			for (const skillId of useSkills) {
				skillIds.add(skillId);
			}
		}

		// 3. Load all referenced skills
		return this.getSkillsByReference(agentId, Array.from(skillIds));
	}

	clearCache(): void {
		this._skillCache.clear();
		this._discoveryCache.clear();
		this._cacheTimestamp = 0;
	}

	// ============================================================================
	// Private Discovery Methods
	// ============================================================================

	private async _discoverBuiltinSkills(agentId: string): Promise<ISkill[]> {
		const skills: ISkill[] = [];

		try {
			// Check for agent-specific built-in skills: assets/agents/{agentId}/skills/
			const skillsDir = URI.joinPath(
				this.extensionContext.extensionUri,
				'assets',
				'agents',
				agentId,
				'skills'
			);

			const skillFiles = await this._readSkillFilesInDir(skillsDir);
			for (const { content, path } of skillFiles) {
				const skill = this._parseSkillFile(content, 'builtin', path, agentId);
				if (skill) {
					skills.push(skill);
				}
			}
		} catch {
			// Skills directory doesn't exist - that's OK
		}

		return skills;
	}

	private async _discoverGlobalRepoSkills(): Promise<ISkill[]> {
		const skills: ISkill[] = [];
		const workspaceFolders = vscode.workspace.workspaceFolders;

		if (!workspaceFolders?.length) {
			return skills;
		}

		for (const folder of workspaceFolders) {
			try {
				const skillsDir = URI.joinPath(folder.uri, '.github', 'skills');
				const skillFiles = await this._readSkillFilesInDir(skillsDir);

				for (const { content, path } of skillFiles) {
					const skill = this._parseSkillFile(content, 'repo', path);
					if (skill) {
						skills.push(skill);
					}
				}
			} catch {
				// .github/skills folder doesn't exist
			}
		}

		return skills;
	}

	private async _discoverAgentRepoSkills(agentId: string): Promise<ISkill[]> {
		const skills: ISkill[] = [];
		const workspaceFolders = vscode.workspace.workspaceFolders;

		if (!workspaceFolders?.length) {
			return skills;
		}

		for (const folder of workspaceFolders) {
			try {
				const skillsDir = URI.joinPath(folder.uri, '.github', 'agents', agentId, 'skills');
				const skillFiles = await this._readSkillFilesInDir(skillsDir);

				for (const { content, path } of skillFiles) {
					const skill = this._parseSkillFile(content, 'repo', path, agentId);
					if (skill) {
						skills.push(skill);
					}
				}
			} catch {
				// .github/agents/{agentId}/skills folder doesn't exist
			}
		}

		return skills;
	}

	// ============================================================================
	// Private Helper Methods
	// ============================================================================

	private async _readSkillFilesInDir(dirUri: URI): Promise<Array<{ content: string; path: string }>> {
		const results: Array<{ content: string; path: string }> = [];

		try {
			const stat = await this.fileSystemService.stat(dirUri);
			if (stat.type !== FileType.Directory) {
				return results;
			}

			const entries = await this.fileSystemService.readDirectory(dirUri);

			for (const [name, type] of entries) {
				if (type === FileType.File && name.endsWith('.skill.md')) {
					const fileUri = URI.joinPath(dirUri, name);
					const content = await this._readFileAsString(fileUri);
					if (content) {
						results.push({ content, path: fileUri.toString() });
					}
				}
			}
		} catch {
			// Directory doesn't exist
		}

		return results;
	}

	private _parseSkillFile(
		content: string,
		source: 'builtin' | 'repo',
		path?: string,
		agentId?: string
	): ISkill | undefined {
		// Parse YAML frontmatter
		const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
		if (!frontmatterMatch) {
			return undefined;
		}

		const frontmatterText = frontmatterMatch[1];
		const markdownContent = content.substring(frontmatterMatch[0].length).trim();

		// Parse frontmatter fields
		const frontmatter = this._parseFrontmatter(frontmatterText);
		if (!frontmatter.name || !frontmatter.description) {
			return undefined;
		}

		// Derive skill ID from name or path
		const id = this._deriveSkillId(frontmatter.name, path);

		return {
			id,
			name: frontmatter.name,
			description: frontmatter.description,
			keywords: frontmatter.keywords ?? [],
			content: markdownContent,
			source,
			path,
			agentId,
		};
	}

	private _parseFrontmatter(text: string): Partial<ISkillFrontmatter> {
		const result: Partial<ISkillFrontmatter> = {};

		// Parse name
		const nameMatch = text.match(/^name:\s*(.+)$/m);
		if (nameMatch) {
			result.name = nameMatch[1].trim().replace(/^["']|["']$/g, '');
		}

		// Parse description
		const descMatch = text.match(/^description:\s*(.+)$/m);
		if (descMatch) {
			result.description = descMatch[1].trim().replace(/^["']|["']$/g, '');
		}

		// Parse keywords array
		const keywordsMatch = text.match(/^keywords:\s*\[([^\]]*)\]/m);
		if (keywordsMatch) {
			result.keywords = keywordsMatch[1]
				.split(',')
				.map(k => k.trim().replace(/^["']|["']$/g, ''))
				.filter(k => k.length > 0);
		} else {
			// Try YAML list format
			const keywordsListMatch = text.match(/^keywords:\s*\n((?:\s*-\s*.+\n?)+)/m);
			if (keywordsListMatch) {
				result.keywords = keywordsListMatch[1]
					.split('\n')
					.map(line => line.replace(/^\s*-\s*/, '').trim().replace(/^["']|["']$/g, ''))
					.filter(k => k.length > 0);
			}
		}

		return result;
	}

	private _deriveSkillId(name: string, path?: string): string {
		// Try to derive from path first (filename without .skill.md)
		if (path) {
			const filename = path.split('/').pop() || path.split('\\').pop();
			if (filename) {
				const id = filename.replace('.skill.md', '').toLowerCase();
				if (id) {
					return id;
				}
			}
		}

		// Fall back to name-based ID
		return name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
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
 * Format skills as a string for inclusion in agent prompts.
 */
export function formatSkillsForPrompt(skills: ISkill[]): string {
	if (skills.length === 0) {
		return '';
	}

	const sections: string[] = [
		'## Referenced Skills\n',
		'The following skills have been loaded to provide domain knowledge:\n',
	];

	for (const skill of skills) {
		sections.push(`### ${skill.name}`);
		sections.push(`*${skill.description}*\n`);
		sections.push(skill.content);
		sections.push('');
	}

	return sections.join('\n');
}
