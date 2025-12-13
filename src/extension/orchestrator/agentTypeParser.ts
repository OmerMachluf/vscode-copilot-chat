/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Agent Type Parser
 *
 * Parses agent type strings into structured ParsedAgentType objects for routing
 * to the appropriate backend executor.
 *
 * Supported formats:
 * - `@agent`, `@architect`, `@reviewer` → Copilot backend
 * - `claude:agent`, `claude:architect` → Claude Code backend
 * - `cli:agent` → CLI backend (future)
 * - `cloud:agent` → Cloud backend (future)
 */

// ============================================================================
// Agent Backend Types
// ============================================================================

/**
 * Supported agent backend types.
 */
export type AgentBackendType = 'copilot' | 'claude' | 'cli' | 'cloud';

/**
 * Well-known agent names that have special handling.
 */
export type WellKnownAgentName = 'agent' | 'architect' | 'reviewer' | 'planner';

/**
 * Mapping from agent names to Claude slash commands.
 */
const CLAUDE_SLASH_COMMANDS: Record<string, string> = {
	'architect': '/architect',
	'reviewer': '/review',
	'planner': '/plan',
};

// ============================================================================
// Parsed Agent Type
// ============================================================================

/**
 * Parsed representation of an agent type string.
 */
export interface ParsedAgentType {
	/** The backend that will execute this agent type */
	readonly backend: AgentBackendType;
	/** The name of the agent (e.g., 'agent', 'architect', 'reviewer') */
	readonly agentName: string;
	/** For Claude backend, the slash command to use (e.g., '/architect') */
	readonly slashCommand?: string;
	/** The original agent type string */
	readonly rawType: string;
	/** Optional model override specified in the agent type */
	readonly modelOverride?: string;
}

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parses an agent type string into its structured components.
 *
 * Parsing rules:
 * - `claude:architect`  → { backend: 'claude', agentName: 'architect', slashCommand: '/architect' }
 * - `claude:agent`      → { backend: 'claude', agentName: 'agent' }
 * - `@architect`        → { backend: 'copilot', agentName: 'architect' }
 * - `@agent`            → { backend: 'copilot', agentName: 'agent' }
 * - `cli:agent`         → { backend: 'cli', agentName: 'agent' }
 * - `cloud:agent`       → { backend: 'cloud', agentName: 'agent' }
 *
 * @param agentType - The agent type string to parse
 * @param modelOverride - Optional model override to include in the result
 * @returns Parsed agent type information
 */
export function parseAgentType(agentType: string, modelOverride?: string): ParsedAgentType {
	if (!agentType || typeof agentType !== 'string') {
		throw new AgentTypeParseError('Agent type must be a non-empty string', agentType);
	}

	const trimmed = agentType.trim();

	// Check for backend:agent format (e.g., "claude:architect", "cli:agent")
	const colonIndex = trimmed.indexOf(':');
	if (colonIndex !== -1) {
		return parseBackendPrefixedType(trimmed, colonIndex, modelOverride);
	}

	// Check for @ prefixed agents (e.g., "@agent", "@architect")
	if (trimmed.startsWith('@')) {
		return parseCopilotType(trimmed, modelOverride);
	}

	// Bare agent name - default to copilot backend
	return parseCopilotType(`@${trimmed}`, modelOverride);
}

/**
 * Parses a backend:agent format string.
 */
function parseBackendPrefixedType(
	agentType: string,
	colonIndex: number,
	modelOverride?: string
): ParsedAgentType {
	const backendStr = agentType.substring(0, colonIndex).toLowerCase();
	const agentName = agentType.substring(colonIndex + 1).toLowerCase();

	if (!agentName) {
		throw new AgentTypeParseError(
			`Agent name is required after backend prefix '${backendStr}:'`,
			agentType
		);
	}

	const backend = validateBackendType(backendStr, agentType);

	// For Claude backend, determine if there's a slash command
	let slashCommand: string | undefined;
	if (backend === 'claude') {
		slashCommand = CLAUDE_SLASH_COMMANDS[agentName];
	}

	return {
		backend,
		agentName,
		slashCommand,
		rawType: agentType,
		modelOverride,
	};
}

/**
 * Parses an @ prefixed agent type (Copilot backend).
 */
function parseCopilotType(agentType: string, modelOverride?: string): ParsedAgentType {
	// Strip the @ prefix
	const agentName = agentType.substring(1).toLowerCase();

	if (!agentName) {
		throw new AgentTypeParseError(
			'Agent name is required after @ prefix',
			agentType
		);
	}

	return {
		backend: 'copilot',
		agentName,
		rawType: agentType,
		modelOverride,
	};
}

/**
 * Validates that a string is a known backend type.
 */
function validateBackendType(backendStr: string, originalType: string): AgentBackendType {
	const validBackends: AgentBackendType[] = ['copilot', 'claude', 'cli', 'cloud'];

	if (!validBackends.includes(backendStr as AgentBackendType)) {
		throw new AgentTypeParseError(
			`Unknown backend type '${backendStr}'. Valid backends: ${validBackends.join(', ')}`,
			originalType
		);
	}

	return backendStr as AgentBackendType;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Checks if an agent type string represents a Copilot backend agent.
 */
export function isCopilotAgentType(agentType: string): boolean {
	if (!agentType) {
		return false;
	}
	const trimmed = agentType.trim();
	// @ prefix means Copilot
	if (trimmed.startsWith('@')) {
		return true;
	}
	// Explicit copilot: prefix
	if (trimmed.toLowerCase().startsWith('copilot:')) {
		return true;
	}
	// No prefix and no colon means default (Copilot)
	return !trimmed.includes(':');
}

/**
 * Checks if an agent type string represents a Claude backend agent.
 */
export function isClaudeAgentType(agentType: string): boolean {
	if (!agentType) {
		return false;
	}
	return agentType.trim().toLowerCase().startsWith('claude:');
}

/**
 * Checks if an agent type string represents a CLI backend agent.
 */
export function isCliAgentType(agentType: string): boolean {
	if (!agentType) {
		return false;
	}
	return agentType.trim().toLowerCase().startsWith('cli:');
}

/**
 * Checks if an agent type string represents a cloud backend agent.
 */
export function isCloudAgentType(agentType: string): boolean {
	if (!agentType) {
		return false;
	}
	return agentType.trim().toLowerCase().startsWith('cloud:');
}

/**
 * Gets the backend type from an agent type string without full parsing.
 * Returns 'copilot' as the default for unrecognized formats.
 */
export function getBackendType(agentType: string): AgentBackendType {
	if (!agentType) {
		return 'copilot';
	}

	const trimmed = agentType.trim().toLowerCase();

	if (trimmed.startsWith('claude:')) {
		return 'claude';
	}
	if (trimmed.startsWith('cli:')) {
		return 'cli';
	}
	if (trimmed.startsWith('cloud:')) {
		return 'cloud';
	}

	return 'copilot';
}

/**
 * Normalizes an agent name by stripping prefixes and lowercasing.
 * Used for consistent agent name handling across the system.
 *
 * @example
 * normalizeAgentName('@architect') // 'architect'
 * normalizeAgentName('claude:agent') // 'agent'
 * normalizeAgentName('Agent') // 'agent'
 */
export function normalizeAgentName(agentType: string): string {
	if (!agentType) {
		return 'agent';
	}

	const trimmed = agentType.trim();

	// Handle backend:agent format
	const colonIndex = trimmed.indexOf(':');
	if (colonIndex !== -1) {
		return trimmed.substring(colonIndex + 1).toLowerCase();
	}

	// Handle @ prefix
	if (trimmed.startsWith('@')) {
		return trimmed.substring(1).toLowerCase();
	}

	return trimmed.toLowerCase();
}

/**
 * Creates an agent type string from components.
 *
 * @example
 * createAgentTypeString('copilot', 'architect') // '@architect'
 * createAgentTypeString('claude', 'agent') // 'claude:agent'
 */
export function createAgentTypeString(backend: AgentBackendType, agentName: string): string {
	if (backend === 'copilot') {
		return `@${agentName}`;
	}
	return `${backend}:${agentName}`;
}

/**
 * Gets the slash command for a Claude agent, if applicable.
 */
export function getClaudeSlashCommand(agentName: string): string | undefined {
	return CLAUDE_SLASH_COMMANDS[agentName.toLowerCase()];
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown when agent type parsing fails.
 */
export class AgentTypeParseError extends Error {
	constructor(
		message: string,
		public readonly agentType: string
	) {
		super(message);
		this.name = 'AgentTypeParseError';
	}
}
