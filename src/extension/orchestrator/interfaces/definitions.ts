/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Type definitions for the Unified Commands Architecture.
 *
 * These types support sharing commands, agents, and skills between
 * GitHub Copilot Chat and Claude Agent SDK.
 */

/**
 * Source of a definition (where it was loaded from).
 */
export type DefinitionSource = 'builtin' | 'repo' | 'package';

/**
 * Command Definition - Represents a slash command.
 *
 * Commands can be defined as:
 * - Built-in: `assets/commands/*.command.md`
 * - Repository: `.github/commands/*.command.md`
 * - Package: Defined in `package.json` (legacy, read-only)
 *
 * The command content is injected as a prompt when the command is invoked.
 * Use `$ARGUMENTS` placeholder to insert user arguments.
 *
 * @example
 * ```yaml
 * ---
 * name: review-pr
 * description: Review a GitHub pull request for code quality issues
 * argumentHint: "[PR number, URL, or 'current' for current branch]"
 * agents: ['reviewer', 'agent']
 * ---
 *
 * ## PR Review Guidelines
 *
 * When reviewing: $ARGUMENTS
 * ```
 */
export interface CommandDefinition {
	/** Unique identifier (derived from filename, e.g., 'review-pr') */
	id: string;

	/** Human-readable name from frontmatter */
	name: string;

	/** Description of what this command does */
	description: string;

	/** Optional hint for command arguments (shown in UI) */
	argumentHint?: string;

	/** Which agents can use this command (default: all) */
	agents?: string[];

	/** The markdown content of the command (prompt to inject) */
	content: string;

	/** Where this command was loaded from */
	source: DefinitionSource;

	/** Path to the command file */
	path?: string;
}

/**
 * YAML frontmatter schema for .command.md files.
 */
export interface CommandFrontmatter {
	/** Required: Human-readable name */
	name: string;
	/** Required: What this command does */
	description: string;
	/** Optional: Hint for arguments */
	argumentHint?: string;
	/** Optional: Which agents can use this */
	agents?: string[];
}

/**
 * Agent Definition - Unified representation aligned with Claude SDK AgentDefinition.
 *
 * Agents can be defined as:
 * - Built-in: `assets/agents/*.agent.md`
 * - Repository: `.github/agents/{name}/{name}.agent.md` or `.github/agents/*.agent.md`
 *
 * @example
 * ```yaml
 * ---
 * name: architect
 * description: Designs technical implementation plans with file-level specificity
 * tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'Task']
 * disallowedTools: ['Bash', 'Write', 'Edit']
 * model: sonnet
 * hasArchitectureAccess: true
 * useSkills: ['design-patterns', 'api-design']
 * ---
 *
 * You are the Architect agent. Your role is to design implementation plans.
 * ```
 */
export interface AgentDefinitionUnified {
	/** Unique identifier (derived from filename, e.g., 'architect') */
	id: string;

	/** Human-readable name from frontmatter */
	name: string;

	/** Agent description (used in Claude SDK) */
	description: string;

	/** The agent's system prompt (markdown content after frontmatter) */
	prompt: string;

	/** Tools this agent can use (Claude SDK compatible) */
	tools?: string[];

	/** Tools this agent is NOT allowed to use (Claude SDK compatible) */
	disallowedTools?: string[];

	/** Model preference for this agent */
	model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';

	/** Skills to always load for this agent */
	useSkills?: string[];

	/** Whether this agent has access to architecture documents */
	hasArchitectureAccess?: boolean;

	/** Preferred backend for this agent */
	backend?: 'copilot' | 'claude';

	/** Claude slash command override */
	claudeSlashCommand?: string;

	/** Where this agent was loaded from */
	source: 'builtin' | 'repo';

	/** Path to the agent file */
	path?: string;
}

/**
 * YAML frontmatter schema for .agent.md files.
 */
export interface AgentFrontmatter {
	/** Required: Human-readable name */
	name: string;
	/** Required: What this agent does */
	description: string;
	/** Optional: Tools this agent can use */
	tools?: string[];
	/** Optional: Tools this agent cannot use */
	disallowedTools?: string[];
	/** Optional: Model preference */
	model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
	/** Optional: Skills to always load */
	useSkills?: string[];
	/** Optional: Access to architecture docs */
	hasArchitectureAccess?: boolean;
	/** Optional: Preferred backend */
	backend?: 'copilot' | 'claude';
	/** Optional: Claude slash command override */
	claudeSlashCommand?: string;
}

/**
 * Skill Metadata - Information about a skill WITHOUT its content.
 *
 * Skills are domain-specific knowledge modules that agents can load on-demand.
 * This interface only contains metadata for discovery; use `loadSkillContent()`
 * to retrieve the actual content.
 *
 * Skills can be defined as:
 * - Built-in: `assets/skills/*.skill.md` or `assets/agents/{agentId}/skills/*.skill.md`
 * - Repository: `.github/skills/*.skill.md` or `.github/agents/{agentId}/skills/*.skill.md`
 */
export interface SkillMetadata {
	/** Unique identifier (derived from filename) */
	id: string;

	/** Human-readable name from frontmatter */
	name: string;

	/** Description of what knowledge this skill provides */
	description: string;

	/** Keywords for discovery/search */
	keywords: string[];

	/** Where this skill was loaded from */
	source: 'builtin' | 'repo';

	/** Path to the skill file (for loading content later) */
	path?: string;

	/** The agent ID this skill belongs to (optional, for agent-specific skills) */
	agentId?: string;
}

/**
 * Claude SDK AgentDefinition type (compatible with @anthropic-ai/claude-code).
 *
 * This is the format expected by the Claude Code SDK's `Options.agents` property.
 */
export interface ClaudeSdkAgentDefinition {
	/** Agent description (shown to the model) */
	description: string;

	/** Tools this agent can use (optional) */
	tools?: string[];

	/** Tools this agent is NOT allowed to use (optional) */
	disallowedTools?: string[];

	/** The agent's system prompt */
	prompt: string;

	/** Model preference */
	model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
}
