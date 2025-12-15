/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { DisposableStore } from '../../../util/vs/base/common/lifecycle';
import { URI } from '../../../util/vs/base/common/uri';
import * as vscode from 'vscode';
import {
	BackendSelectionService,
	DEFAULT_BACKEND,
	AgentConfigYaml,
} from '../backendSelectionService';

// Mock vscode
vi.mock('vscode', () => ({
	workspace: {
		workspaceFolders: [],
	},
}));

// Mock services
const createMockFileSystemService = () => ({
	_serviceBrand: undefined,
	readFile: vi.fn(),
	readDirectory: vi.fn(),
	stat: vi.fn(),
	writeFile: vi.fn(),
	delete: vi.fn(),
	createDirectory: vi.fn(),
	copy: vi.fn(),
	rename: vi.fn(),
});

const createMockConfigurationService = () => ({
	_serviceBrand: undefined,
	getNonExtensionConfig: vi.fn(),
	onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
});

// Helper to create a valid config YAML buffer
function createConfigYaml(config: AgentConfigYaml): Uint8Array {
	const yaml = `version: ${config.version}
${config.defaults ? `defaults:
  backend: ${config.defaults.backend}
${config.defaults.model ? `  model: ${config.defaults.model}` : ''}` : ''}
${config.agents ? `agents:
${Object.entries(config.agents).map(([key, value]) => `  ${key}:
    backend: ${value.backend}
${value.model ? `    model: ${value.model}` : ''}`).join('\n')}` : ''}`;
	return new TextEncoder().encode(yaml);
}

describe('BackendSelectionService', () => {
	let disposables: DisposableStore;
	let service: BackendSelectionService;
	let mockFileSystemService: ReturnType<typeof createMockFileSystemService>;
	let mockConfigurationService: ReturnType<typeof createMockConfigurationService>;

	beforeEach(() => {
		disposables = new DisposableStore();
		mockFileSystemService = createMockFileSystemService();
		mockConfigurationService = createMockConfigurationService();

		// Default: no workspace folders
		(vscode.workspace as any).workspaceFolders = [];

		// Default: setting not configured
		mockConfigurationService.getNonExtensionConfig.mockReturnValue(undefined);

		service = new BackendSelectionService(
			mockFileSystemService as any,
			mockConfigurationService as any
		);
		disposables.add(service);
	});

	afterEach(() => {
		disposables.dispose();
	});

	describe('3-level precedence', () => {
		describe('Level 1: User Request (highest priority)', () => {
			it('should detect "use claude" in prompt', async () => {
				const result = await service.selectBackend('Please use claude for this task', 'agent');
				expect(result.backend).toBe('claude');
				expect(result.source).toBe('user-request');
			});

			it('should detect "with claude" in prompt', async () => {
				const result = await service.selectBackend('Implement this feature with claude', 'agent');
				expect(result.backend).toBe('claude');
				expect(result.source).toBe('user-request');
			});

			it('should detect "using claude" in prompt', async () => {
				const result = await service.selectBackend('Build using claude sonnet', 'agent');
				expect(result.backend).toBe('claude');
				expect(result.source).toBe('user-request');
			});

			it('should detect "claude:agent" prefix', async () => {
				const result = await service.selectBackend('claude:architect analyze this', 'agent');
				expect(result.backend).toBe('claude');
				expect(result.source).toBe('user-request');
			});

			it('should detect "copilot:agent" prefix', async () => {
				const result = await service.selectBackend('copilot:agent implement this', 'agent');
				expect(result.backend).toBe('copilot');
				expect(result.source).toBe('user-request');
			});

			it('should detect claude model mentions (claude-4)', async () => {
				const result = await service.selectBackend('Use claude-4 sonnet for best results', 'agent');
				expect(result.backend).toBe('claude');
				expect(result.source).toBe('user-request');
			});

			it('should detect gpt-4 mentions and route to copilot backend', async () => {
				const result = await service.selectBackend('Run this with gpt-4', 'agent');
				expect(result.backend).toBe('copilot');
				expect(result.source).toBe('user-request');
			});

			it('should be case insensitive', async () => {
				const result = await service.selectBackend('USE CLAUDE for this', 'agent');
				expect(result.backend).toBe('claude');
				expect(result.source).toBe('user-request');
			});

			it('should override repo config when user specifies backend', async () => {
				// Setup repo config with copilot as default
				const workspaceFolder = URI.file('/workspace');
				(vscode.workspace as any).workspaceFolders = [{ uri: workspaceFolder }];
				mockFileSystemService.stat.mockResolvedValue({ type: 1 });
				mockFileSystemService.readFile.mockResolvedValue(createConfigYaml({
					version: 1,
					defaults: { backend: 'copilot' }
				}));

				// User explicitly requests claude
				const result = await service.selectBackend('Use claude for this', 'agent');
				expect(result.backend).toBe('claude');
				expect(result.source).toBe('user-request');
			});
		});

		describe('Level 2: Repo Config (.github/agents/config.yaml)', () => {
			beforeEach(() => {
				const workspaceFolder = URI.file('/workspace');
				(vscode.workspace as any).workspaceFolders = [{ uri: workspaceFolder }];
			});

			it('should use agent-specific config from repo', async () => {
				mockFileSystemService.stat.mockResolvedValue({ type: 1 });
				mockFileSystemService.readFile.mockResolvedValue(createConfigYaml({
					version: 1,
					agents: {
						architect: { backend: 'claude', model: 'claude-4-sonnet' }
					}
				}));

				const result = await service.selectBackend('Design a new feature', 'architect');
				expect(result.backend).toBe('claude');
				expect(result.model).toBe('claude-4-sonnet');
				expect(result.source).toBe('repo-config');
			});

			it('should use repo defaults when agent not configured', async () => {
				mockFileSystemService.stat.mockResolvedValue({ type: 1 });
				mockFileSystemService.readFile.mockResolvedValue(createConfigYaml({
					version: 1,
					defaults: { backend: 'claude' }
				}));

				const result = await service.selectBackend('Implement something', 'agent');
				expect(result.backend).toBe('claude');
				expect(result.source).toBe('repo-config');
			});

			it('should prefer agent-specific config over defaults', async () => {
				mockFileSystemService.stat.mockResolvedValue({ type: 1 });
				mockFileSystemService.readFile.mockResolvedValue(createConfigYaml({
					version: 1,
					defaults: { backend: 'copilot' },
					agents: {
						architect: { backend: 'claude' }
					}
				}));

				const result = await service.selectBackend('Design this', 'architect');
				expect(result.backend).toBe('claude');
				expect(result.source).toBe('repo-config');

				// Different agent falls back to defaults
				const result2 = await service.selectBackend('Implement this', 'agent');
				expect(result2.backend).toBe('copilot');
				expect(result2.source).toBe('repo-config');
			});

			it('should handle missing config file gracefully', async () => {
				mockFileSystemService.stat.mockRejectedValue(new Error('File not found'));

				const result = await service.selectBackend('Do something', 'agent');
				expect(result.backend).toBe(DEFAULT_BACKEND);
				expect(result.source).toBe('extension-default');
			});

			it('should handle invalid YAML gracefully', async () => {
				mockFileSystemService.stat.mockResolvedValue({ type: 1 });
				mockFileSystemService.readFile.mockRejectedValue(new Error('Parse error'));

				const result = await service.selectBackend('Do something', 'agent');
				expect(result.backend).toBe(DEFAULT_BACKEND);
				expect(result.source).toBe('extension-default');
			});
		});

		describe('Level 3: Extension Defaults (VS Code settings)', () => {
			it('should use VS Code setting when no repo config exists', async () => {
				mockConfigurationService.getNonExtensionConfig.mockReturnValue('claude');

				const result = await service.selectBackend('Do something', 'agent');
				expect(result.backend).toBe('claude');
				expect(result.source).toBe('extension-default');
			});

			it('should fallback to copilot when setting is invalid', async () => {
				mockConfigurationService.getNonExtensionConfig.mockReturnValue('invalid-backend');

				const result = await service.selectBackend('Do something', 'agent');
				expect(result.backend).toBe(DEFAULT_BACKEND);
				expect(result.source).toBe('extension-default');
			});

			it('should fallback to copilot when setting is not configured', async () => {
				mockConfigurationService.getNonExtensionConfig.mockReturnValue(undefined);

				const result = await service.selectBackend('Do something', 'agent');
				expect(result.backend).toBe(DEFAULT_BACKEND);
				expect(result.source).toBe('extension-default');
			});
		});
	});

	describe('getDefaultBackend', () => {
		it('should skip user prompt parsing', async () => {
			// Even if the prompt would have user hints, getDefaultBackend ignores them
			const workspaceFolder = URI.file('/workspace');
			(vscode.workspace as any).workspaceFolders = [{ uri: workspaceFolder }];
			mockFileSystemService.stat.mockResolvedValue({ type: 1 });
			mockFileSystemService.readFile.mockResolvedValue(createConfigYaml({
				version: 1,
				defaults: { backend: 'copilot' }
			}));

			const result = await service.getDefaultBackend('architect');
			expect(result.backend).toBe('copilot');
			expect(result.source).toBe('repo-config');
		});
	});

	describe('config caching', () => {
		it('should cache config and not re-read within cache duration', async () => {
			const workspaceFolder = URI.file('/workspace');
			(vscode.workspace as any).workspaceFolders = [{ uri: workspaceFolder }];
			mockFileSystemService.stat.mockResolvedValue({ type: 1 });
			mockFileSystemService.readFile.mockResolvedValue(createConfigYaml({
				version: 1,
				defaults: { backend: 'claude' }
			}));

			// First call reads the file
			await service.selectBackend('test', 'agent');
			expect(mockFileSystemService.readFile).toHaveBeenCalledTimes(1);

			// Second call uses cache
			await service.selectBackend('test2', 'agent');
			expect(mockFileSystemService.readFile).toHaveBeenCalledTimes(1);
		});

		it('should refresh config on explicit refresh call', async () => {
			const workspaceFolder = URI.file('/workspace');
			(vscode.workspace as any).workspaceFolders = [{ uri: workspaceFolder }];
			mockFileSystemService.stat.mockResolvedValue({ type: 1 });
			mockFileSystemService.readFile.mockResolvedValue(createConfigYaml({
				version: 1,
				defaults: { backend: 'claude' }
			}));

			// First call reads the file
			await service.selectBackend('test', 'agent');
			expect(mockFileSystemService.readFile).toHaveBeenCalledTimes(1);

			// Refresh forces re-read
			await service.refreshAgentConfig();
			expect(mockFileSystemService.readFile).toHaveBeenCalledTimes(2);
		});
	});

	describe('config validation', () => {
		it('should reject config without version', async () => {
			const workspaceFolder = URI.file('/workspace');
			(vscode.workspace as any).workspaceFolders = [{ uri: workspaceFolder }];
			mockFileSystemService.stat.mockResolvedValue({ type: 1 });
			mockFileSystemService.readFile.mockResolvedValue(new TextEncoder().encode(`
defaults:
  backend: claude
`));

			const result = await service.selectBackend('test', 'agent');
			expect(result.backend).toBe(DEFAULT_BACKEND);
			expect(result.source).toBe('extension-default');
		});

		it('should accept valid config with all fields', async () => {
			const workspaceFolder = URI.file('/workspace');
			(vscode.workspace as any).workspaceFolders = [{ uri: workspaceFolder }];
			mockFileSystemService.stat.mockResolvedValue({ type: 1 });
			mockFileSystemService.readFile.mockResolvedValue(createConfigYaml({
				version: 1,
				defaults: { backend: 'copilot', model: 'gpt-4' },
				agents: {
					architect: { backend: 'claude', model: 'claude-4-sonnet', description: 'Architecture agent' },
					reviewer: { backend: 'copilot', model: 'gpt-4' }
				}
			}));

			const config = await service.getAgentConfig();
			expect(config).toBeDefined();
			expect(config?.version).toBe(1);
			expect(config?.defaults?.backend).toBe('copilot');
			expect(config?.agents?.architect?.backend).toBe('claude');
		});
	});
});
