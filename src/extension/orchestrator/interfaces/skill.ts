/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Skill - Domain-specific knowledge module that agents can reference on-demand.
 *
 * Skills differ from Instructions:
 * - Instructions: Always loaded, behavioral rules (e.g., "Use tabs not spaces")
 * - Skills: Explicitly referenced, domain knowledge (e.g., "Microservices patterns")
 *
 * Skills are loaded via:
 * - Explicit reference in prompt: `#skill:microservices`
 * - Agent definition's `useSkills` array
 */
export interface ISkill {
	/** Unique identifier for the skill (derived from filename) */
	id: string;
	/** Human-readable name from frontmatter */
	name: string;
	/** Description of what this skill provides */
	description: string;
	/** Keywords for discovery/search */
	keywords: string[];
	/** The markdown content of the skill (excluding frontmatter) */
	content: string;
	/** Source of the skill definition */
	source: 'builtin' | 'repo';
	/** Path to the skill file */
	path?: string;
	/** The agent ID this skill belongs to (optional, for agent-specific skills) */
	agentId?: string;
}

/**
 * Skill reference parsed from a prompt or agent definition.
 * Format: `#skill:name` or just `name` in useSkills array.
 */
export interface ISkillReference {
	/** The skill ID being referenced */
	skillId: string;
	/** The agent context (optional - for agent-specific skills) */
	agentId?: string;
}

/**
 * Result of skill discovery for an agent.
 */
export interface ISkillDiscoveryResult {
	/** Skills available from built-in sources */
	builtinSkills: ISkill[];
	/** Skills available from the repository */
	repoSkills: ISkill[];
	/** Agent-specific skills (from the agent's skills/ subdirectory) */
	agentSkills: ISkill[];
}

/**
 * YAML frontmatter schema for .skill.md files.
 */
export interface ISkillFrontmatter {
	/** Required: Human-readable name */
	name: string;
	/** Required: What this skill provides */
	description: string;
	/** Optional: Keywords for discovery/search */
	keywords?: string[];
}
