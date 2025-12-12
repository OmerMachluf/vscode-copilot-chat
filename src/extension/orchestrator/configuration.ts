/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Emitter } from '../../util/vs/base/common/event';
import { Disposable } from '../../util/vs/base/common/lifecycle';

export interface IAgentCapability {
	skills?: string[];
	allowedTools?: string[];
}

export type PermissionLevel = 'auto_approve' | 'ask_user' | 'deny';

export interface IOrchestratorPermissions {
	fileSystem?: {
		read?: PermissionLevel;
		write?: PermissionLevel;
		delete?: PermissionLevel;
	};
	terminal?: {
		execute?: PermissionLevel;
	};
	network?: {
		fetch?: PermissionLevel;
	};
	[key: string]: any;
}

export interface IOrchestratorLimits {
	maxSubtaskDepth: number;
	maxSubtasksPerWorker: number;
}

export interface IModelPreferences {
	default: string;
	byTaskType: {
		architecture?: string;
		implementation?: string;
		review?: string;
		testing?: string;
		[key: string]: string | undefined;
	};
	byAgent: {
		[agentId: string]: string;
	};
}

export interface IWorkspaceConfiguration {
	agentCapabilities: Record<string, IAgentCapability>;
	permissions: IOrchestratorPermissions;
	limits: IOrchestratorLimits;
	modelPreferences: IModelPreferences;
}

export interface ValidationResult {
	valid: boolean;
	errors: { path: string; message: string; suggestion?: string }[];
}

export class ConfigValidator {
	validateAgentCapability(config: unknown): ValidationResult {
		const errors: { path: string; message: string; suggestion?: string }[] = [];
		if (typeof config !== 'object' || config === null) {
			return { valid: false, errors: [{ path: 'root', message: 'Config must be an object' }] };
		}

		const cap = config as IAgentCapability;
		if (cap.skills && !Array.isArray(cap.skills)) {
			errors.push({ path: 'skills', message: 'Skills must be an array of strings' });
		}
		if (cap.allowedTools && !Array.isArray(cap.allowedTools)) {
			errors.push({ path: 'allowedTools', message: 'Allowed tools must be an array of strings' });
		}

		return { valid: errors.length === 0, errors };
	}

	validatePermissions(config: unknown): ValidationResult {
		const errors: { path: string; message: string; suggestion?: string }[] = [];
		if (typeof config !== 'object' || config === null) {
			return { valid: false, errors: [{ path: 'root', message: 'Permissions must be an object' }] };
		}

		const validLevels = ['auto_approve', 'ask_user', 'deny'];
		const validateLevel = (path: string, value: any) => {
			if (value && !validLevels.includes(value)) {
				errors.push({ path, message: `Invalid permission level: ${value}`, suggestion: `Must be one of: ${validLevels.join(', ')}` });
			}
		};

		const perms = config as any;
		if (perms.fileSystem) {
			validateLevel('fileSystem.read', perms.fileSystem.read);
			validateLevel('fileSystem.write', perms.fileSystem.write);
			validateLevel('fileSystem.delete', perms.fileSystem.delete);
		}
		if (perms.terminal) {
			validateLevel('terminal.execute', perms.terminal.execute);
		}
		if (perms.network) {
			validateLevel('network.fetch', perms.network.fetch);
		}

		return { valid: errors.length === 0, errors };
	}

	validateModelPreferences(config: unknown): ValidationResult {
		const errors: { path: string; message: string; suggestion?: string }[] = [];
		if (typeof config !== 'object' || config === null) {
			return { valid: false, errors: [{ path: 'root', message: 'Model preferences must be an object' }] };
		}

		const prefs = config as IModelPreferences;
		if (prefs.default && typeof prefs.default !== 'string') {
			errors.push({ path: 'default', message: 'Default model must be a string' });
		}
		if (prefs.byTaskType && typeof prefs.byTaskType !== 'object') {
			errors.push({ path: 'byTaskType', message: 'byTaskType must be an object' });
		}
		if (prefs.byAgent && typeof prefs.byAgent !== 'object') {
			errors.push({ path: 'byAgent', message: 'byAgent must be an object' });
		}

		return { valid: errors.length === 0, errors };
	}

	formatValidationError(result: ValidationResult): string {
		if (result.valid) {
			return 'Configuration is valid.';
		}
		return result.errors.map(e => `${e.path}: ${e.message} ${e.suggestion ? `(${e.suggestion})` : ''}`).join('\n');
	}
}

export class WorkspaceConfigLoader extends Disposable {
	private readonly _onDidChangeConfiguration = this._register(new Emitter<void>());
	readonly onDidChangeConfiguration = this._onDidChangeConfiguration.event;

	private _config: IWorkspaceConfiguration;

	constructor() {
		super();
		this._config = this._getDefaultConfig();
		this.watchForChanges();
		this.loadConfig(); // Initial load
	}

	private _getDefaultConfig(): IWorkspaceConfiguration {
		return {
			agentCapabilities: {},
			permissions: {
				fileSystem: { read: 'ask_user', write: 'ask_user', delete: 'ask_user' },
				terminal: { execute: 'ask_user' },
				network: { fetch: 'ask_user' }
			},
			limits: {
				maxSubtaskDepth: 2,
				maxSubtasksPerWorker: 10
			},
			modelPreferences: {
				default: 'claude-opus-4.5',
				byTaskType: {},
				byAgent: {}
			}
		};
	}

	getConfig(): IWorkspaceConfiguration {
		return this._config;
	}

	async loadConfig(): Promise<void> {
		const workspaceConfig = await this._loadWorkspaceConfig();
		const userConfig = this._loadUserConfig();

		// Merge: Defaults -> Workspace -> User
		this._config = this._mergeConfigs(this._getDefaultConfig(), workspaceConfig, userConfig);
		this._onDidChangeConfiguration.fire();
	}

	watchForChanges(): void {
		const watcher = vscode.workspace.createFileSystemWatcher('**/.github/agents/**');
		const changeListener = watcher.onDidChange(() => this.loadConfig());
		const createListener = watcher.onDidCreate(() => this.loadConfig());
		const deleteListener = watcher.onDidDelete(() => this.loadConfig());

		const settingsListener = vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('github.copilot')) {
				this.loadConfig();
			}
		});

		this._register(watcher);
		this._register(changeListener);
		this._register(createListener);
		this._register(deleteListener);
		this._register(settingsListener);
	}

	async loadAgentOverrides(): Promise<Partial<IAgentCapability>[]> {
		// Implementation for specific requirement
		// This might be redundant if loadConfig does everything, but keeping it for the interface requirement
		return [];
	}

	async loadPermissionOverrides(): Promise<Partial<IOrchestratorPermissions>> {
		// Implementation for specific requirement
		return {};
	}

	private async _loadWorkspaceConfig(): Promise<Partial<IWorkspaceConfiguration>> {
		const config: Partial<IWorkspaceConfiguration> = {
			agentCapabilities: {},
			permissions: {},
			limits: { maxSubtaskDepth: 2, maxSubtasksPerWorker: 10 }, // Default values for limits if not found
			modelPreferences: { default: '', byTaskType: {}, byAgent: {} }
		};

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) return config;

		for (const folder of workspaceFolders) {
			// Load Registry Overrides
			try {
				const registryOverridesUri = vscode.Uri.joinPath(folder.uri, '.github/agents/registry-overrides.md');
				await vscode.workspace.fs.readFile(registryOverridesUri);
				// Parse markdown/yaml to extract capabilities
				// Simplified parsing for now
				// TODO: Implement proper markdown parsing
			} catch (e) {
				// Ignore if file not found
			}

			// Load Permission Overrides
			try {
				const permissionsUri = vscode.Uri.joinPath(folder.uri, '.github/agents/orchestrator/permissions.md');
				await vscode.workspace.fs.readFile(permissionsUri);
				// Parse markdown/yaml
				// TODO: Implement proper markdown parsing
			} catch (e) {
				// Ignore
			}
		}

		return config;
	}

	private _loadUserConfig(): Partial<IWorkspaceConfiguration> {
		const config = vscode.workspace.getConfiguration('github.copilot');

		return {
			agentCapabilities: config.get('agents.capabilities'),
			permissions: config.get('orchestrator.permissions'),
			limits: config.get('orchestrator.limits'),
			modelPreferences: config.get('orchestrator.modelPreferences')
		};
	}

	private _mergeConfigs(...configs: (Partial<IWorkspaceConfiguration> | undefined)[]): IWorkspaceConfiguration {
		let result = this._getDefaultConfig();

		for (const config of configs) {
			if (!config) continue;

			if (config.agentCapabilities) {
				result.agentCapabilities = { ...result.agentCapabilities, ...config.agentCapabilities };
			}
			if (config.permissions) {
				result.permissions = this._mergePermissions(result.permissions, config.permissions);
			}
			if (config.limits) {
				result.limits = { ...result.limits, ...config.limits };
			}
			if (config.modelPreferences) {
				result.modelPreferences = this._mergeModelPreferences(result.modelPreferences, config.modelPreferences);
			}
		}

		return result;
	}

	private _mergePermissions(base: IOrchestratorPermissions, override: Partial<IOrchestratorPermissions>): IOrchestratorPermissions {
		const result = { ...base };
		if (override.fileSystem) result.fileSystem = { ...result.fileSystem, ...override.fileSystem };
		if (override.terminal) result.terminal = { ...result.terminal, ...override.terminal };
		if (override.network) result.network = { ...result.network, ...override.network };
		return result;
	}

	private _mergeModelPreferences(base: IModelPreferences, override: Partial<IModelPreferences>): IModelPreferences {
		const result = { ...base };
		if (override.default) result.default = override.default;
		if (override.byTaskType) result.byTaskType = { ...result.byTaskType, ...override.byTaskType };
		if (override.byAgent) result.byAgent = { ...result.byAgent, ...override.byAgent };
		return result;
	}
}
