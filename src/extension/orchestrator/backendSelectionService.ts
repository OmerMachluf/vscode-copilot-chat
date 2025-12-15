/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { createDecorator } from '../../util/vs/platform/instantiation/common/instantiation';
import { IFileSystemService } from '../../platform/filesystem/common/fileSystemService';
import { IConfigurationService } from '../../platform/configuration/common/configurationService';
import { URI } from '../../util/vs/base/common/uri';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { AgentBackendType } from './agentTypeParser';
import * as YAML from 'yaml';

// Re-export AgentBackendType for convenience
export { AgentBackendType };

/**
 * Extended backend types for selection purposes.
 * Includes backends that may not be fully implemented yet.
 */
export type ExtendedBackendType = AgentBackendType | 'openai' | 'custom';

/**
 * Result of backend selection with metadata
 */
export interface BackendSelectionResult {
	readonly backend: AgentBackendType;
	readonly model?: string;
	readonly source: 'user-request' | 'repo-config' | 'extension-default';
}

/**
 * Schema for .github/agents/config.yaml
 */
export interface AgentConfigYaml {
	readonly version: number;
	readonly defaults?: {
		readonly backend?: AgentBackendType;
		readonly model?: string;
	};
	readonly agents?: {
		readonly [agentId: string]: {
			readonly backend?: AgentBackendType;
			readonly model?: string;
			readonly description?: string;
		};
	};
}

/**
 * Service identifier for backend selection
 */
export const IBackendSelectionService = createDecorator<IBackendSelectionService>('backendSelectionService');

/**
 * Service for selecting agent backends with 3-level precedence:
 * 1. User Request (highest priority) - explicit hints in prompt
 * 2. Repo Config - .github/agents/config.yaml
 * 3. Extension Defaults - VS Code settings
 */
export interface IBackendSelectionService {
	readonly _serviceBrand: undefined;

	/**
	 * Select the backend for a given prompt and agent
	 */
	selectBackend(prompt: string, agentId: string): Promise<BackendSelectionResult>;

	/**
	 * Get the default backend for an agent
	 */
	getDefaultBackend(agentId: string): Promise<BackendSelectionResult>;

	/**
	 * Get the cached agent config
	 */
	getAgentConfig(): Promise<AgentConfigYaml | undefined>;

	/**
	 * Refresh the cached agent config
	 */
	refreshAgentConfig(): Promise<void>;
}

/**
 * Patterns for detecting backend hints in user prompts
 */
const BACKEND_HINT_PATTERNS: Array<{ pattern: RegExp; backend: AgentBackendType }> = [
	{ pattern: /\bclaude:(\w+)/i, backend: 'claude' },
	{ pattern: /\bcopilot:(\w+)/i, backend: 'copilot' },
	{ pattern: /\bopenai:(\w+)/i, backend: 'copilot' },
	{ pattern: /\buse\s+claude\b/i, backend: 'claude' },
	{ pattern: /\bwith\s+claude\b/i, backend: 'claude' },
	{ pattern: /\busing\s+claude\b/i, backend: 'claude' },
	{ pattern: /\buse\s+copilot\b/i, backend: 'copilot' },
	{ pattern: /\bwith\s+copilot\b/i, backend: 'copilot' },
	{ pattern: /\busing\s+copilot\b/i, backend: 'copilot' },
	{ pattern: /\buse\s+openai\b/i, backend: 'copilot' },
	{ pattern: /\bwith\s+openai\b/i, backend: 'copilot' },
	{ pattern: /\busing\s+openai\b/i, backend: 'copilot' },
	{ pattern: /\bclaude[-\s]?4\b/i, backend: 'claude' },
	{ pattern: /\bclaude[-\s]?sonnet\b/i, backend: 'claude' },
	{ pattern: /\bclaude[-\s]?opus\b/i, backend: 'claude' },
	{ pattern: /\bgpt[-\s]?4\b/i, backend: 'copilot' },
	{ pattern: /\bgpt[-\s]?o1\b/i, backend: 'copilot' },
];

export const BACKEND_SETTING_KEY = 'github.copilot.orchestrator.defaultBackend';
export const DEFAULT_BACKEND: AgentBackendType = 'copilot';
export const AGENT_CONFIG_PATH = '.github/agents/config.yaml';

export class BackendSelectionService extends Disposable implements IBackendSelectionService {
	declare readonly _serviceBrand: undefined;

	private _cachedConfig: AgentConfigYaml | undefined;
	private _configCacheTime: number = 0;
	private readonly _configCacheDuration = 30000;

	constructor(
		@IFileSystemService private readonly _fileSystemService: IFileSystemService,
		@IConfigurationService private readonly _configurationService: IConfigurationService
	) {
		super();
	}

	async selectBackend(prompt: string, agentId: string): Promise<BackendSelectionResult> {
		const userBackend = this._parseBackendFromPrompt(prompt);
		if (userBackend) {
			return { backend: userBackend, source: 'user-request' };
		}
		return this.getDefaultBackend(agentId);
	}

	async getDefaultBackend(agentId: string): Promise<BackendSelectionResult> {
		const repoConfig = await this.getAgentConfig();
		if (repoConfig) {
			const agentConfig = repoConfig.agents?.[agentId];
			if (agentConfig?.backend) {
				return { backend: agentConfig.backend, model: agentConfig.model, source: 'repo-config' };
			}
			if (repoConfig.defaults?.backend) {
				return { backend: repoConfig.defaults.backend, model: repoConfig.defaults.model, source: 'repo-config' };
			}
		}

		const settingValue = this._configurationService.getNonExtensionConfig<AgentBackendType>(BACKEND_SETTING_KEY);
		if (settingValue && this._isValidBackend(settingValue)) {
			return { backend: settingValue, source: 'extension-default' };
		}

		return { backend: DEFAULT_BACKEND, source: 'extension-default' };
	}

	async getAgentConfig(): Promise<AgentConfigYaml | undefined> {
		const now = Date.now();
		if (this._cachedConfig && (now - this._configCacheTime) < this._configCacheDuration) {
			return this._cachedConfig;
		}
		await this.refreshAgentConfig();
		return this._cachedConfig;
	}

	async refreshAgentConfig(): Promise<void> {
		this._cachedConfig = undefined;
		this._configCacheTime = Date.now();

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return;
		}

		for (const folder of workspaceFolders) {
			const configUri = URI.joinPath(folder.uri, AGENT_CONFIG_PATH);
			try {
				const exists = await this._exists(configUri);
				if (exists) {
					const content = await this._fileSystemService.readFile(configUri);
					const contentString = new TextDecoder().decode(content);
					const parsed = YAML.parse(contentString) as AgentConfigYaml;
					if (this._isValidConfig(parsed)) {
						this._cachedConfig = parsed;
						return;
					}
				}
			} catch {
				// Continue to next folder
			}
		}
	}

	private _parseBackendFromPrompt(prompt: string): AgentBackendType | undefined {
		for (const { pattern, backend } of BACKEND_HINT_PATTERNS) {
			if (pattern.test(prompt)) {
				return backend;
			}
		}
		return undefined;
	}

	private _isValidBackend(value: string): value is AgentBackendType {
		return ['copilot', 'claude', 'cli', 'cloud'].includes(value);
	}

	private _isValidConfig(config: unknown): config is AgentConfigYaml {
		if (!config || typeof config !== 'object') {
			return false;
		}
		const c = config as AgentConfigYaml;
		if (typeof c.version !== 'number') {
			return false;
		}
		if (c.defaults && typeof c.defaults !== 'object') {
			return false;
		}
		if (c.agents && typeof c.agents !== 'object') {
			return false;
		}
		return true;
	}

	private async _exists(uri: URI): Promise<boolean> {
		try {
			await this._fileSystemService.stat(uri);
			return true;
		} catch {
			return false;
		}
	}
}
