/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IVSCodeExtensionContext } from '../../platform/extContext/common/extensionContext';
import { IFileSystemService } from '../../platform/filesystem/common/fileSystemService';
import { URI } from '../../util/vs/base/common/uri';
import { createDecorator } from '../../util/vs/platform/instantiation/common/instantiation';
import { Emitter, Event } from '../../util/vs/base/common/event';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { ILogService } from '../../platform/log/common/logService';

export const IOrchestratorPermissionService = createDecorator<IOrchestratorPermissionService>('orchestratorPermissionService');

export interface IOrchestratorPermissions {
	auto_approve: string[];
	ask_user: string[];
	auto_deny: string[];
	limits: {
		max_subtask_depth: number;  // default: 2
		max_subtasks_per_worker: number;  // default: 10
		max_parallel_subtasks: number;  // default: 5
		subtask_spawn_rate_limit: number;  // default: 20/min
	};
}

export interface IPermissionRequest {
	id: string;
	requesterId: string;  // worker or sub-task ID
	requesterType: 'worker' | 'subtask';
	action: string;
	resource?: string;
	context: Record<string, unknown>;
	escalationPath: string[];  // [subtask, parent, orchestrator]
	timeout: number;  // ms
	defaultAction: 'approve' | 'deny';
	createdAt: number;
}

export interface IPermissionResponse {
	requestId: string;
	approved: boolean;
	clarification?: string;
	respondedBy: 'inherited' | 'parent' | 'orchestrator' | 'user';
}

export type PermissionDecision = 'auto_approve' | 'ask_user' | 'auto_deny';

export interface IOrchestratorPermissionService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when permissions are updated (reloaded from disk or settings changed)
	 */
	readonly onDidChangePermissions: Event<void>;

	/**
	 * Load permissions from all sources (defaults -> workspace -> settings)
	 */
	loadPermissions(): Promise<IOrchestratorPermissions>;

	/**
	 * Evaluate permission for a specific action
	 */
	evaluatePermission(action: string, context?: Record<string, unknown>): PermissionDecision;

	/**
	 * Check if a numerical limit is within bounds
	 */
	checkLimit(limitType: keyof IOrchestratorPermissions['limits'], currentValue: number): boolean;

	/**
	 * Get the current effective permissions
	 */
	getPermissions(): IOrchestratorPermissions;
}

export class OrchestratorPermissionService extends Disposable implements IOrchestratorPermissionService {
	declare readonly _serviceBrand: undefined;

	private _permissions: IOrchestratorPermissions | undefined;
	private readonly _onDidChangePermissions = this._register(new Emitter<void>());
	readonly onDidChangePermissions = this._onDidChangePermissions.event;

	private readonly _defaultPermissionsPath = 'assets/agents/orchestrator-permissions.json';
	private readonly _workspacePermissionsPath = '.github/agents/orchestrator/permissions.md';

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IVSCodeExtensionContext private readonly extensionContext: IVSCodeExtensionContext,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._register(vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('github.copilot.orchestrator.permissions')) {
				this.loadPermissions();
			}
		}));
	}

	getPermissions(): IOrchestratorPermissions {
		if (!this._permissions) {
			// Return safe defaults if not loaded yet
			return this._getSafeDefaults();
		}
		return this._permissions;
	}

	async loadPermissions(): Promise<IOrchestratorPermissions> {
		try {
			// 1. Load extension defaults
			let permissions = await this._loadDefaults();

			// 2. Load workspace overrides
			const workspaceOverrides = await this._loadWorkspaceOverrides();
			if (workspaceOverrides) {
				permissions = this._mergePermissions(permissions, workspaceOverrides);
			}

			// 3. Load user settings overrides
			const userOverrides = this._loadUserOverrides();
			if (userOverrides) {
				permissions = this._mergePermissions(permissions, userOverrides);
			}

			this._permissions = permissions;
			this._onDidChangePermissions.fire();
			return permissions;
		} catch (error) {
			this.logService.error(`[OrchestratorPermissionService] Failed to load permissions: ${error}`);
			return this._getSafeDefaults();
		}
	}

	evaluatePermission(action: string, context?: Record<string, unknown>): PermissionDecision {
		const perms = this.getPermissions();

		if (perms.auto_deny.includes(action)) {
			return 'auto_deny';
		}
		if (perms.auto_approve.includes(action)) {
			return 'auto_approve';
		}
		if (perms.ask_user.includes(action)) {
			return 'ask_user';
		}

		// Default to ask_user for unknown actions
		return 'ask_user';
	}

	checkLimit(limitType: keyof IOrchestratorPermissions['limits'], currentValue: number): boolean {
		const perms = this.getPermissions();
		const limit = perms.limits[limitType];
		
		if (limit === undefined) {
			this.logService.warn(`[OrchestratorPermissionService] Unknown limit type: ${limitType}`);
			return true; // Fail open if limit unknown? Or fail closed? Assuming open for now as it might be a new limit.
		}

		return currentValue < limit;
	}

	private async _loadDefaults(): Promise<IOrchestratorPermissions> {
		try {
			const uri = URI.joinPath(this.extensionContext.extensionUri, this._defaultPermissionsPath);
			const content = await this.fileSystemService.readFile(uri);
			const jsonContent = new TextDecoder().decode(content);
			return JSON.parse(jsonContent);
		} catch (error) {
			this.logService.error(`[OrchestratorPermissionService] Failed to load default permissions: ${error}`);
			return this._getSafeDefaults();
		}
	}

	private async _loadWorkspaceOverrides(): Promise<Partial<IOrchestratorPermissions> | undefined> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders?.length) {
			return undefined;
		}

		// Check each workspace folder
		for (const folder of workspaceFolders) {
			const uri = URI.joinPath(folder.uri, this._workspacePermissionsPath);
			try {
				const content = await this.fileSystemService.readFile(uri);
				const stringContent = new TextDecoder().decode(content);
				return this._parseMarkdownPermissions(stringContent);
			} catch {
				// File doesn't exist in this folder, continue
			}
		}

		return undefined;
	}

	private _parseMarkdownPermissions(content: string): Partial<IOrchestratorPermissions> | undefined {
		// Parse YAML frontmatter
		const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
		if (!frontmatterMatch) {
			return undefined;
		}

		const frontmatter = frontmatterMatch[1];
		const result: any = {};

		// Simple YAML parsing for lists and limits
		// Note: This is a basic parser. For production, a proper YAML parser is recommended.
		// However, following the pattern in agentInstructionService.ts, we'll do manual parsing.

		// Parse lists
		const parseList = (key: string) => {
			const match = frontmatter.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, 'm'));
			if (match) {
				return match[1]
					.split(',')
					.map(s => s.trim().replace(/['"]/g, ''))
					.filter(s => s.length > 0);
			}
			return undefined;
		};

		const autoApprove = parseList('auto_approve');
		if (autoApprove) result.auto_approve = autoApprove;

		const askUser = parseList('ask_user');
		if (askUser) result.ask_user = askUser;

		const autoDeny = parseList('auto_deny');
		if (autoDeny) result.auto_deny = autoDeny;

		// Parse limits
		// Looking for:
		// limits:
		//   max_subtask_depth: 2
		const limitsMatch = frontmatter.match(/^limits:\s*\n((?:\s+.*\n?)*)/m);
		if (limitsMatch) {
			const limitsBlock = limitsMatch[1];
			const limits: any = {};
			
			const parseLimit = (key: string) => {
				const match = limitsBlock.match(new RegExp(`^\\s+${key}:\\s*(\\d+)`, 'm'));
				if (match) {
					return parseInt(match[1], 10);
				}
				return undefined;
			};

			const maxDepth = parseLimit('max_subtask_depth');
			if (maxDepth !== undefined) limits.max_subtask_depth = maxDepth;

			const maxPerWorker = parseLimit('max_subtasks_per_worker');
			if (maxPerWorker !== undefined) limits.max_subtasks_per_worker = maxPerWorker;

			const maxParallel = parseLimit('max_parallel_subtasks');
			if (maxParallel !== undefined) limits.max_parallel_subtasks = maxParallel;

			const spawnRate = parseLimit('subtask_spawn_rate_limit');
			if (spawnRate !== undefined) limits.subtask_spawn_rate_limit = spawnRate;

			if (Object.keys(limits).length > 0) {
				result.limits = limits;
			}
		}

		return result;
	}

	private _loadUserOverrides(): Partial<IOrchestratorPermissions> | undefined {
		const config = vscode.workspace.getConfiguration('github.copilot.orchestrator');
		const permissions = config.get<Partial<IOrchestratorPermissions>>('permissions');
		return permissions;
	}

	private _mergePermissions(base: IOrchestratorPermissions, overrides: Partial<IOrchestratorPermissions>): IOrchestratorPermissions {
		const result = { ...base };
		
		// Deep merge limits
		if (overrides.limits) {
			result.limits = { ...base.limits, ...overrides.limits };
		}

		// Replace lists if provided (not merge, to allow removing items by overriding the list)
		if (overrides.auto_approve) result.auto_approve = overrides.auto_approve;
		if (overrides.ask_user) result.ask_user = overrides.ask_user;
		if (overrides.auto_deny) result.auto_deny = overrides.auto_deny;

		return result;
	}

	private _getSafeDefaults(): IOrchestratorPermissions {
		return {
			auto_approve: [],
			ask_user: [],
			auto_deny: [],
			limits: {
				max_subtask_depth: 2,
				max_subtasks_per_worker: 10,
				max_parallel_subtasks: 5,
				subtask_spawn_rate_limit: 20
			}
		};
	}
}
