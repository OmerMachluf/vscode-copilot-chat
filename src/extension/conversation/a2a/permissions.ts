/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from '../../../util/vs/base/common/uri';

/**
 * Permission levels for agent operations.
 * - `read-only`: Agent can only read files and information, no modifications allowed
 * - `read-write`: Agent can read and write files within allowed scope
 * - `full-access`: Agent has full access to all operations including terminal commands
 */
export type PermissionLevel = 'read-only' | 'read-write' | 'full-access';

/**
 * Categories of operations that can be permission-controlled.
 */
export enum OperationCategory {
	/** File system read operations */
	FileRead = 'file-read',
	/** File system write operations */
	FileWrite = 'file-write',
	/** File system delete operations */
	FileDelete = 'file-delete',
	/** Terminal command execution */
	TerminalExecution = 'terminal-execution',
	/** Web fetch operations */
	WebFetch = 'web-fetch',
	/** Process spawning */
	ProcessSpawn = 'process-spawn',
	/** Git operations */
	GitOperations = 'git-operations',
	/** Extension API access */
	ExtensionApi = 'extension-api',
}

/**
 * Result of a permission check.
 */
export interface PermissionCheckResult {
	/** Whether the operation is allowed */
	readonly allowed: boolean;
	/** Reason for denial if not allowed */
	readonly reason?: string;
	/** Whether approval was previously granted for this operation */
	readonly previouslyApproved?: boolean;
	/** The permission level that applies */
	readonly permissionLevel: PermissionLevel;
}

/**
 * Describes an operation that requires permission checking.
 */
export interface PermissionRequest {
	/** The category of operation */
	readonly category: OperationCategory;
	/** The specific operation being requested */
	readonly operation: string;
	/** The target of the operation (file path, URL, command, etc.) */
	readonly target?: string | URI;
	/** The agent or session requesting the permission */
	readonly requesterId: string;
	/** Additional context about the operation */
	readonly context?: Record<string, unknown>;
}

/**
 * Configuration for file and folder access restrictions.
 */
export interface FileAccessConfig {
	/** Glob patterns for files/folders that are allowed */
	readonly allowedPatterns: readonly string[];
	/** Glob patterns for files/folders that are denied (takes precedence) */
	readonly deniedPatterns: readonly string[];
	/** Whether to allow access outside workspace folders */
	readonly allowOutsideWorkspace: boolean;
}

/**
 * Configuration for terminal command execution.
 */
export interface TerminalAccessConfig {
	/** Whether terminal execution is allowed at all */
	readonly enabled: boolean;
	/** Commands that are always allowed (without approval) */
	readonly autoApprovedCommands: readonly string[];
	/** Commands that are always denied */
	readonly deniedCommands: readonly string[];
	/** Whether to require approval for commands not in auto-approved list */
	readonly requireApprovalForUnknown: boolean;
}

/**
 * User-configurable permission settings for agents.
 */
export interface AgentPermissionConfig {
	/** The overall permission level */
	readonly permissionLevel: PermissionLevel;
	/** File access restrictions */
	readonly fileAccess: FileAccessConfig;
	/** Terminal access restrictions */
	readonly terminalAccess: TerminalAccessConfig;
	/** Whether to prompt user for sensitive operations */
	readonly promptForSensitiveOperations: boolean;
	/** Maximum number of operations per session before re-approval */
	readonly maxOperationsPerSession?: number;
}

/**
 * Record of an approval decision for audit purposes.
 */
export interface ApprovalRecord {
	/** Unique identifier for the approval */
	readonly id: string;
	/** Timestamp of the approval */
	readonly timestamp: number;
	/** The permission request that was evaluated */
	readonly request: PermissionRequest;
	/** Whether approval was granted */
	readonly approved: boolean;
	/** The user's response if prompted */
	readonly userResponse?: 'allow' | 'allow-always' | 'deny' | 'deny-always';
	/** Any additional notes or context */
	readonly notes?: string;
}

/**
 * Scope for persisting approval decisions.
 */
export enum ApprovalScope {
	/** Approval only for this session */
	Session = 'session',
	/** Approval persisted at workspace level */
	Workspace = 'workspace',
	/** Approval persisted globally */
	Global = 'global',
}

/**
 * Represents a persisted approval rule.
 */
export interface ApprovalRule {
	/** Unique identifier for the rule */
	readonly id: string;
	/** The category this rule applies to */
	readonly category: OperationCategory;
	/** Pattern to match against operation targets (glob for files, regex for commands) */
	readonly pattern: string;
	/** Whether this is an allow or deny rule */
	readonly allow: boolean;
	/** The scope of this rule */
	readonly scope: ApprovalScope;
	/** Timestamp when the rule was created */
	readonly createdAt: number;
	/** Optional expiration timestamp */
	readonly expiresAt?: number;
}

/**
 * Statistics about permission usage for monitoring.
 */
export interface PermissionStats {
	/** Total number of permission checks */
	readonly totalChecks: number;
	/** Number of allowed operations */
	readonly allowedCount: number;
	/** Number of denied operations */
	readonly deniedCount: number;
	/** Number of operations that required user approval */
	readonly promptedCount: number;
	/** Breakdown by category */
	readonly byCategory: Readonly<Record<OperationCategory, {
		readonly allowed: number;
		readonly denied: number;
		readonly prompted: number;
	}>>;
}

/**
 * Internal mutable variant of PermissionStats for updating within the service.
 */
export interface MutablePermissionStats {
	totalChecks: number;
	allowedCount: number;
	deniedCount: number;
	promptedCount: number;
	byCategory: Record<OperationCategory, {
		allowed: number;
		denied: number;
		prompted: number;
	}>;
}

/**
 * Default permission configuration.
 */
export const DEFAULT_PERMISSION_CONFIG: AgentPermissionConfig = {
	permissionLevel: 'read-write',
	fileAccess: {
		allowedPatterns: ['**/*'],
		deniedPatterns: [
			'**/.env',
			'**/.env.*',
			'**/secrets/**',
			'**/*.pem',
			'**/*.key',
			'**/id_rsa*',
			'**/.ssh/**',
		],
		allowOutsideWorkspace: false,
	},
	terminalAccess: {
		enabled: true,
		autoApprovedCommands: [
			'git status',
			'git diff',
			'git log',
			'npm test',
			'npm run test',
			'npm run lint',
			'npm run build',
			'ls',
			'dir',
			'cat',
			'type',
			'pwd',
			'echo',
		],
		deniedCommands: [
			'rm -rf /',
			'rmdir /s /q c:',
			'format',
			'mkfs',
			'dd if=/dev/',
			':(){ :|:& };:',
		],
		requireApprovalForUnknown: true,
	},
	promptForSensitiveOperations: true,
	maxOperationsPerSession: undefined,
};

/**
 * List of operations considered sensitive and requiring explicit approval.
 */
export const SENSITIVE_OPERATIONS = [
	OperationCategory.FileDelete,
	OperationCategory.ProcessSpawn,
] as const;

/**
 * Check if an operation category is considered sensitive.
 */
export function isSensitiveOperation(category: OperationCategory): boolean {
	return (SENSITIVE_OPERATIONS as readonly OperationCategory[]).includes(category);
}

/**
 * Map permission level to allowed operation categories.
 */
export function getAllowedCategories(level: PermissionLevel): readonly OperationCategory[] {
	switch (level) {
		case 'read-only':
			return [OperationCategory.FileRead, OperationCategory.WebFetch];
		case 'read-write':
			return [
				OperationCategory.FileRead,
				OperationCategory.FileWrite,
				OperationCategory.WebFetch,
				OperationCategory.GitOperations,
			];
		case 'full-access':
			return Object.values(OperationCategory);
	}
}

/**
 * Check if a permission level allows a specific operation category.
 */
export function isOperationAllowedByLevel(level: PermissionLevel, category: OperationCategory): boolean {
	return getAllowedCategories(level).includes(category);
}
