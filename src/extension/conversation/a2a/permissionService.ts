/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import picomatch from 'picomatch';
import { isWindows } from '../../../util/vs/base/common/platform';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../platform/log/common/logService';
import { INotificationService } from '../../../platform/notification/common/notificationService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { createServiceIdentifier } from '../../../util/common/services';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import {
	AgentPermissionConfig,
	ApprovalRecord,
	ApprovalRule,
	ApprovalScope,
	DEFAULT_PERMISSION_CONFIG,
	isSensitiveOperation,
	isOperationAllowedByLevel,
	MutablePermissionStats,
	OperationCategory,
	PermissionCheckResult,
	PermissionLevel,
	PermissionRequest,
	PermissionStats,
} from './permissions';

/**
 * Configuration key constants for agent permissions.
 * These use the VS Code configuration system to allow user customization.
 */
export const A2A_CONFIG_KEYS = {
	PERMISSION_LEVEL: 'github.copilot.chat.agent.permissionLevel',
	PROMPT_FOR_SENSITIVE: 'github.copilot.chat.agent.promptForSensitiveOperations',
	ALLOW_OUTSIDE_WORKSPACE: 'github.copilot.chat.agent.allowOutsideWorkspace',
	TERMINAL_ENABLED: 'github.copilot.chat.agent.terminal.enabled',
	TERMINAL_REQUIRE_APPROVAL: 'github.copilot.chat.agent.terminal.requireApproval',
	DENIED_FILE_PATTERNS: 'github.copilot.chat.agent.files.deniedPatterns',
	AUTO_APPROVED_COMMANDS: 'github.copilot.chat.agent.terminal.autoApprovedCommands',
} as const;

export const IAgentPermissionService = createServiceIdentifier<IAgentPermissionService>('IAgentPermissionService');

/**
 * Events emitted by the permission service.
 */
export interface IPermissionEvent {
	readonly request: PermissionRequest;
	readonly result: PermissionCheckResult;
}

export interface IApprovalPromptEvent {
	readonly request: PermissionRequest;
	readonly approved: boolean;
	readonly scope: ApprovalScope;
}

/**
 * Service for managing agent operation permissions.
 */
export interface IAgentPermissionService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when a permission check is performed.
	 */
	readonly onPermissionCheck: Event<IPermissionEvent>;

	/**
	 * Event fired when user is prompted for approval.
	 */
	readonly onApprovalPrompt: Event<IApprovalPromptEvent>;

	/**
	 * Check if an operation is allowed.
	 * @param request The permission request to check
	 * @returns The result of the permission check
	 */
	checkPermission(request: PermissionRequest): Promise<PermissionCheckResult>;

	/**
	 * Request user approval for an operation.
	 * @param request The permission request to approve
	 * @returns Whether approval was granted
	 */
	requestApproval(request: PermissionRequest): Promise<boolean>;

	/**
	 * Get the current permission configuration.
	 */
	getConfig(): AgentPermissionConfig;

	/**
	 * Get statistics about permission usage.
	 */
	getStats(): PermissionStats;

	/**
	 * Get the audit log of approval decisions.
	 * @param limit Maximum number of records to return
	 */
	getAuditLog(limit?: number): readonly ApprovalRecord[];

	/**
	 * Add a permanent approval rule.
	 * @param rule The rule to add
	 */
	addApprovalRule(rule: Omit<ApprovalRule, 'id' | 'createdAt'>): void;

	/**
	 * Remove an approval rule.
	 * @param ruleId The ID of the rule to remove
	 */
	removeApprovalRule(ruleId: string): void;

	/**
	 * Get all approval rules.
	 */
	getApprovalRules(): readonly ApprovalRule[];

	/**
	 * Clear session-scoped approvals.
	 */
	clearSessionApprovals(): void;

	/**
	 * Reset statistics counters.
	 */
	resetStats(): void;
}

/**
 * Storage key for persisted approval rules.
 */
const APPROVAL_RULES_STORAGE_KEY = 'copilot.agent.approvalRules';
const AUDIT_LOG_STORAGE_KEY = 'copilot.agent.auditLog';
const MAX_AUDIT_LOG_SIZE = 1000;

/**
 * Implementation of the agent permission service.
 */
export class AgentPermissionService extends Disposable implements IAgentPermissionService {
	declare readonly _serviceBrand: undefined;

	private readonly _onPermissionCheck = this._register(new Emitter<IPermissionEvent>());
	readonly onPermissionCheck = this._onPermissionCheck.event;

	private readonly _onApprovalPrompt = this._register(new Emitter<IApprovalPromptEvent>());
	readonly onApprovalPrompt = this._onApprovalPrompt.event;

	private readonly _sessionApprovals = new Map<string, boolean>();
	private readonly _approvalRules: ApprovalRule[] = [];
	private readonly _auditLog: ApprovalRecord[] = [];

	private _stats: MutablePermissionStats = this._createEmptyStats();

	constructor(
		private readonly _extensionContext: vscode.ExtensionContext,
		private readonly _workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined,
		@IConfigurationService private readonly _configService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) {
		super();
		this._loadPersistedData();
	}

	/**
	 * Check if an operation is allowed based on current permission configuration.
	 */
	async checkPermission(request: PermissionRequest): Promise<PermissionCheckResult> {
		const config = this.getConfig();
		const permissionLevel = config.permissionLevel;

		// First check if the operation category is allowed by the permission level
		if (!isOperationAllowedByLevel(permissionLevel, request.category)) {
			const result: PermissionCheckResult = {
				allowed: false,
				reason: `Operation category '${request.category}' is not allowed with permission level '${permissionLevel}'`,
				permissionLevel,
			};
			this._recordCheck(request, result);
			return result;
		}

		// Check approval rules (deny rules take precedence)
		const ruleResult = this._checkApprovalRules(request);
		if (ruleResult !== undefined) {
			const result: PermissionCheckResult = {
				allowed: ruleResult,
				reason: ruleResult ? undefined : `Denied by approval rule`,
				previouslyApproved: ruleResult,
				permissionLevel,
			};
			this._recordCheck(request, result);
			return result;
		}

		// Check session approvals
		const sessionKey = this._getSessionKey(request);
		if (this._sessionApprovals.has(sessionKey)) {
			const approved = this._sessionApprovals.get(sessionKey)!;
			const result: PermissionCheckResult = {
				allowed: approved,
				reason: approved ? undefined : 'Previously denied in this session',
				previouslyApproved: approved,
				permissionLevel,
			};
			this._recordCheck(request, result);
			return result;
		}

		// Category-specific checks
		let result: PermissionCheckResult;
		switch (request.category) {
			case OperationCategory.FileRead:
			case OperationCategory.FileWrite:
			case OperationCategory.FileDelete:
				result = this._checkFileAccess(request, config);
				break;
			case OperationCategory.TerminalExecution:
				result = await this._checkTerminalAccess(request, config);
				break;
			default:
				// For other categories, check if sensitive and require approval
				if (isSensitiveOperation(request.category) && config.promptForSensitiveOperations) {
					const approved = await this.requestApproval(request);
					result = {
						allowed: approved,
						reason: approved ? undefined : 'User denied the operation',
						permissionLevel,
					};
				} else {
					result = {
						allowed: true,
						permissionLevel,
					};
				}
		}

		this._recordCheck(request, result);
		return result;
	}

	/**
	 * Request user approval for an operation.
	 */
	async requestApproval(request: PermissionRequest): Promise<boolean> {
		const message = this._formatApprovalMessage(request);
		const allowOnce = 'Allow';
		const allowAlways = 'Allow Always';
		const deny = 'Deny';
		const denyAlways = 'Deny Always';

		const response = await this._notificationService.showWarningMessage(
			message,
			allowOnce,
			allowAlways,
			deny,
			denyAlways
		);

		let approved = false;
		let scope = ApprovalScope.Session;

		switch (response) {
			case allowOnce:
				approved = true;
				scope = ApprovalScope.Session;
				break;
			case allowAlways:
				approved = true;
				scope = ApprovalScope.Global;
				this._addApprovalRuleFromRequest(request, true, ApprovalScope.Global);
				break;
			case denyAlways:
				approved = false;
				scope = ApprovalScope.Global;
				this._addApprovalRuleFromRequest(request, false, ApprovalScope.Global);
				break;
			case deny:
			default:
				approved = false;
				scope = ApprovalScope.Session;
		}

		// Store session approval
		const sessionKey = this._getSessionKey(request);
		this._sessionApprovals.set(sessionKey, approved);

		// Record in audit log
		this._addAuditRecord(request, approved, response as ApprovalRecord['userResponse']);

		// Fire event
		this._onApprovalPrompt.fire({ request, approved, scope });

		// Log telemetry
		this._logTelemetry('permission_approval', {
			category: request.category,
			operation: request.operation,
			approved: approved.toString(),
			scope,
		});

		return approved;
	}

	/**
	 * Get current permission configuration from settings.
	 */
	getConfig(): AgentPermissionConfig {
		// Use getNonExtensionConfig to get values from VS Code settings, or fall back to defaults
		const permissionLevel = this._configService.getNonExtensionConfig<PermissionLevel>(A2A_CONFIG_KEYS.PERMISSION_LEVEL)
			?? DEFAULT_PERMISSION_CONFIG.permissionLevel;
		const deniedPatterns = this._configService.getNonExtensionConfig<string[]>(A2A_CONFIG_KEYS.DENIED_FILE_PATTERNS)
			?? [...DEFAULT_PERMISSION_CONFIG.fileAccess.deniedPatterns];
		const allowOutsideWorkspace = this._configService.getNonExtensionConfig<boolean>(A2A_CONFIG_KEYS.ALLOW_OUTSIDE_WORKSPACE)
			?? DEFAULT_PERMISSION_CONFIG.fileAccess.allowOutsideWorkspace;
		const terminalEnabled = this._configService.getNonExtensionConfig<boolean>(A2A_CONFIG_KEYS.TERMINAL_ENABLED)
			?? DEFAULT_PERMISSION_CONFIG.terminalAccess.enabled;
		const autoApprovedCommands = this._configService.getNonExtensionConfig<string[]>(A2A_CONFIG_KEYS.AUTO_APPROVED_COMMANDS)
			?? [...DEFAULT_PERMISSION_CONFIG.terminalAccess.autoApprovedCommands];
		const terminalRequireApproval = this._configService.getNonExtensionConfig<boolean>(A2A_CONFIG_KEYS.TERMINAL_REQUIRE_APPROVAL)
			?? DEFAULT_PERMISSION_CONFIG.terminalAccess.requireApprovalForUnknown;
		const promptForSensitive = this._configService.getNonExtensionConfig<boolean>(A2A_CONFIG_KEYS.PROMPT_FOR_SENSITIVE)
			?? DEFAULT_PERMISSION_CONFIG.promptForSensitiveOperations;

		return {
			permissionLevel,
			fileAccess: {
				allowedPatterns: ['**/*'],
				deniedPatterns,
				allowOutsideWorkspace,
			},
			terminalAccess: {
				enabled: terminalEnabled,
				autoApprovedCommands,
				deniedCommands: DEFAULT_PERMISSION_CONFIG.terminalAccess.deniedCommands,
				requireApprovalForUnknown: terminalRequireApproval,
			},
			promptForSensitiveOperations: promptForSensitive,
		};
	}

	getStats(): PermissionStats {
		return { ...this._stats };
	}

	getAuditLog(limit?: number): readonly ApprovalRecord[] {
		if (limit === undefined) {
			return [...this._auditLog];
		}
		return this._auditLog.slice(-limit);
	}

	addApprovalRule(rule: Omit<ApprovalRule, 'id' | 'createdAt'>): void {
		const fullRule: ApprovalRule = {
			...rule,
			id: this._generateId(),
			createdAt: Date.now(),
		};
		this._approvalRules.push(fullRule);
		this._persistApprovalRules();
		this._logService.info(`Added approval rule: ${fullRule.id} for ${fullRule.category} (${fullRule.allow ? 'allow' : 'deny'})`);
	}

	removeApprovalRule(ruleId: string): void {
		const index = this._approvalRules.findIndex(r => r.id === ruleId);
		if (index !== -1) {
			this._approvalRules.splice(index, 1);
			this._persistApprovalRules();
			this._logService.info(`Removed approval rule: ${ruleId}`);
		}
	}

	getApprovalRules(): readonly ApprovalRule[] {
		return [...this._approvalRules];
	}

	clearSessionApprovals(): void {
		this._sessionApprovals.clear();
		this._logService.info('Cleared session approvals');
	}

	resetStats(): void {
		this._stats = this._createEmptyStats();
		this._logService.info('Reset permission statistics');
	}

	// Private methods

	private _checkFileAccess(request: PermissionRequest, config: AgentPermissionConfig): PermissionCheckResult {
		const target = request.target;
		if (!target) {
			return {
				allowed: true,
				permissionLevel: config.permissionLevel,
			};
		}

		const targetPath = typeof target === 'string' ? target : target.fsPath;

		// Check if outside workspace
		if (!config.fileAccess.allowOutsideWorkspace && this._workspaceFolders) {
			const isInWorkspace = this._workspaceFolders.some(folder => {
				const folderPath = folder.uri.fsPath;
				return targetPath.startsWith(folderPath);
			});

			if (!isInWorkspace) {
				return {
					allowed: false,
					reason: 'Access to files outside workspace is not allowed',
					permissionLevel: config.permissionLevel,
				};
			}
		}

		// Check denied patterns
		for (const pattern of config.fileAccess.deniedPatterns) {
			if (picomatch.isMatch(targetPath, pattern, { dot: true, windows: isWindows })) {
				return {
					allowed: false,
					reason: `File matches denied pattern: ${pattern}`,
					permissionLevel: config.permissionLevel,
				};
			}
		}

		// For delete operations, always require approval
		if (request.category === OperationCategory.FileDelete && config.promptForSensitiveOperations) {
			return {
				allowed: false,
				reason: 'File deletion requires explicit approval',
				permissionLevel: config.permissionLevel,
			};
		}

		return {
			allowed: true,
			permissionLevel: config.permissionLevel,
		};
	}

	private async _checkTerminalAccess(request: PermissionRequest, config: AgentPermissionConfig): Promise<PermissionCheckResult> {
		if (!config.terminalAccess.enabled) {
			return {
				allowed: false,
				reason: 'Terminal execution is disabled',
				permissionLevel: config.permissionLevel,
			};
		}

		const command = typeof request.target === 'string' ? request.target : '';

		// Check denied commands
		for (const deniedCmd of config.terminalAccess.deniedCommands) {
			if (command.toLowerCase().includes(deniedCmd.toLowerCase())) {
				return {
					allowed: false,
					reason: `Command matches denied pattern: ${deniedCmd}`,
					permissionLevel: config.permissionLevel,
				};
			}
		}

		// Check auto-approved commands
		const isAutoApproved = config.terminalAccess.autoApprovedCommands.some(approved => {
			return command.toLowerCase().startsWith(approved.toLowerCase());
		});

		if (isAutoApproved) {
			return {
				allowed: true,
				previouslyApproved: true,
				permissionLevel: config.permissionLevel,
			};
		}

		// Require approval for unknown commands
		if (config.terminalAccess.requireApprovalForUnknown) {
			const approved = await this.requestApproval(request);
			return {
				allowed: approved,
				reason: approved ? undefined : 'User denied terminal command',
				permissionLevel: config.permissionLevel,
			};
		}

		return {
			allowed: true,
			permissionLevel: config.permissionLevel,
		};
	}

	private _checkApprovalRules(request: PermissionRequest): boolean | undefined {
		const targetStr = typeof request.target === 'string' ? request.target : request.target?.toString() ?? '';

		// Check deny rules first
		for (const rule of this._approvalRules) {
			if (rule.category !== request.category) {
				continue;
			}
			if (rule.expiresAt && Date.now() > rule.expiresAt) {
				continue;
			}

			const matches = this._matchPattern(targetStr, rule.pattern, rule.category);
			if (matches) {
				if (!rule.allow) {
					return false;
				}
			}
		}

		// Then check allow rules
		for (const rule of this._approvalRules) {
			if (rule.category !== request.category) {
				continue;
			}
			if (rule.expiresAt && Date.now() > rule.expiresAt) {
				continue;
			}

			const matches = this._matchPattern(targetStr, rule.pattern, rule.category);
			if (matches && rule.allow) {
				return true;
			}
		}

		return undefined;
	}

	private _matchPattern(target: string, pattern: string, category: OperationCategory): boolean {
		// For file operations, use picomatch
		if ([OperationCategory.FileRead, OperationCategory.FileWrite, OperationCategory.FileDelete].includes(category)) {
			return picomatch.isMatch(target, pattern, { dot: true, windows: isWindows });
		}

		// For terminal commands, use startsWith or regex
		if (category === OperationCategory.TerminalExecution) {
			if (pattern.startsWith('/') && pattern.endsWith('/')) {
				try {
					const regex = new RegExp(pattern.slice(1, -1));
					return regex.test(target);
				} catch {
					return false;
				}
			}
			return target.toLowerCase().startsWith(pattern.toLowerCase());
		}

		// For other categories, use simple string matching
		return target.toLowerCase().includes(pattern.toLowerCase());
	}

	private _getSessionKey(request: PermissionRequest): string {
		const targetStr = typeof request.target === 'string' ? request.target : request.target?.toString() ?? '';
		return `${request.category}:${request.operation}:${targetStr}`;
	}

	private _formatApprovalMessage(request: PermissionRequest): string {
		const targetStr = typeof request.target === 'string' ? request.target : request.target?.toString() ?? 'unknown';
		
		switch (request.category) {
			case OperationCategory.FileDelete:
				return `Agent wants to delete file: ${targetStr}`;
			case OperationCategory.TerminalExecution:
				return `Agent wants to execute command: ${targetStr}`;
			case OperationCategory.ProcessSpawn:
				return `Agent wants to spawn process: ${targetStr}`;
			default:
				return `Agent wants to perform ${request.operation} on ${targetStr}`;
		}
	}

	private _addApprovalRuleFromRequest(request: PermissionRequest, allow: boolean, scope: ApprovalScope): void {
		const targetStr = typeof request.target === 'string' ? request.target : request.target?.toString() ?? '';
		
		this.addApprovalRule({
			category: request.category,
			pattern: targetStr,
			allow,
			scope,
		});
	}

	private _addAuditRecord(request: PermissionRequest, approved: boolean, userResponse?: ApprovalRecord['userResponse']): void {
		const record: ApprovalRecord = {
			id: this._generateId(),
			timestamp: Date.now(),
			request,
			approved,
			userResponse,
		};

		this._auditLog.push(record);

		// Trim audit log if too large
		if (this._auditLog.length > MAX_AUDIT_LOG_SIZE) {
			this._auditLog.splice(0, this._auditLog.length - MAX_AUDIT_LOG_SIZE);
		}

		this._persistAuditLog();
	}

	private _recordCheck(request: PermissionRequest, result: PermissionCheckResult): void {
		// Update stats
		this._stats.totalChecks++;
		if (result.allowed) {
			this._stats.allowedCount++;
		} else {
			this._stats.deniedCount++;
		}

		const categoryStats = (this._stats.byCategory as Record<OperationCategory, { allowed: number; denied: number; prompted: number }>)[request.category];
		if (categoryStats) {
			if (result.allowed) {
				categoryStats.allowed++;
			} else {
				categoryStats.denied++;
			}
		}

		// Fire event
		this._onPermissionCheck.fire({ request, result });

		// Log
		this._logService.debug(`Permission check: ${request.category}/${request.operation} -> ${result.allowed ? 'allowed' : 'denied'}`);
	}

	private _logTelemetry(eventName: string, properties: Record<string, string>): void {
		this._telemetryService.sendGHTelemetryEvent(eventName, properties);
	}

	private _generateId(): string {
		return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	private _createEmptyStats(): MutablePermissionStats {
		const byCategory = {} as Record<OperationCategory, { allowed: number; denied: number; prompted: number }>;
		for (const category of Object.values(OperationCategory)) {
			byCategory[category] = { allowed: 0, denied: 0, prompted: 0 };
		}

		return {
			totalChecks: 0,
			allowedCount: 0,
			deniedCount: 0,
			promptedCount: 0,
			byCategory,
		};
	}

	private _loadPersistedData(): void {
		try {
			// Load approval rules
			const storedRules = this._extensionContext.globalState.get<ApprovalRule[]>(APPROVAL_RULES_STORAGE_KEY);
			if (storedRules) {
				this._approvalRules.push(...storedRules);
			}

			// Load audit log
			const storedAudit = this._extensionContext.globalState.get<ApprovalRecord[]>(AUDIT_LOG_STORAGE_KEY);
			if (storedAudit) {
				this._auditLog.push(...storedAudit);
			}
		} catch (error) {
			this._logService.warn(`Failed to load persisted permission data: ${error}`);
		}
	}

	private _persistApprovalRules(): void {
		try {
			this._extensionContext.globalState.update(APPROVAL_RULES_STORAGE_KEY, this._approvalRules);
		} catch (error) {
			this._logService.warn(`Failed to persist approval rules: ${error}`);
		}
	}

	private _persistAuditLog(): void {
		try {
			this._extensionContext.globalState.update(AUDIT_LOG_STORAGE_KEY, this._auditLog);
		} catch (error) {
			this._logService.warn(`Failed to persist audit log: ${error}`);
		}
	}
}

/**
 * Null implementation for testing or when permissions are disabled.
 */
export class NullAgentPermissionService extends Disposable implements IAgentPermissionService {
	declare readonly _serviceBrand: undefined;

	private readonly _onPermissionCheck = this._register(new Emitter<IPermissionEvent>());
	readonly onPermissionCheck = this._onPermissionCheck.event;

	private readonly _onApprovalPrompt = this._register(new Emitter<IApprovalPromptEvent>());
	readonly onApprovalPrompt = this._onApprovalPrompt.event;

	async checkPermission(request: PermissionRequest): Promise<PermissionCheckResult> {
		return {
			allowed: true,
			permissionLevel: 'full-access',
		};
	}

	async requestApproval(request: PermissionRequest): Promise<boolean> {
		return true;
	}

	getConfig(): AgentPermissionConfig {
		return {
			...DEFAULT_PERMISSION_CONFIG,
			permissionLevel: 'full-access',
		};
	}

	getStats(): PermissionStats {
		return {
			totalChecks: 0,
			allowedCount: 0,
			deniedCount: 0,
			promptedCount: 0,
			byCategory: {} as PermissionStats['byCategory'],
		};
	}

	getAuditLog(): readonly ApprovalRecord[] {
		return [];
	}

	addApprovalRule(): void {
		// No-op
	}

	removeApprovalRule(): void {
		// No-op
	}

	getApprovalRules(): readonly ApprovalRule[] {
		return [];
	}

	clearSessionApprovals(): void {
		// No-op
	}

	resetStats(): void {
		// No-op
	}
}
