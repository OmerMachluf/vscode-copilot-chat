/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	A2A_CONFIG_KEYS,
	AgentPermissionService,
	NullAgentPermissionService,
} from '../permissionService';
import {
	ApprovalScope,
	DEFAULT_PERMISSION_CONFIG,
	OperationCategory,
	PermissionRequest,
} from '../permissions';

// Mock dependencies
class MockConfigurationService {
	private _values: Map<string, unknown> = new Map();

	getNonExtensionConfig<T>(key: string): T | undefined {
		return this._values.get(key) as T | undefined;
	}

	setValue(key: string, value: unknown): void {
		this._values.set(key, value);
	}

	clear(): void {
		this._values.clear();
	}
}

class MockLogService {
	debug = vi.fn();
	info = vi.fn();
	warn = vi.fn();
	error = vi.fn();
	trace = vi.fn();
}

class MockNotificationService {
	showWarningMessage = vi.fn().mockResolvedValue(undefined);
	showInformationMessage = vi.fn().mockResolvedValue(undefined);
	showErrorMessage = vi.fn().mockResolvedValue(undefined);
}

class MockTelemetryService {
	sendGHTelemetryEvent = vi.fn();
}

class MockExtensionContext {
	globalState = {
		get: vi.fn().mockReturnValue(undefined),
		update: vi.fn().mockResolvedValue(undefined),
		keys: vi.fn().mockReturnValue([]),
	};
	workspaceState = {
		get: vi.fn().mockReturnValue(undefined),
		update: vi.fn().mockResolvedValue(undefined),
		keys: vi.fn().mockReturnValue([]),
	};
}

// Mock picomatch for file pattern matching
vi.mock('picomatch', () => ({
	default: {
		isMatch: vi.fn((path: string, pattern: string) => {
			// Simple pattern matching for tests
			if (pattern === '**/*') {
				return true;
			}
			if (pattern.includes('**/.env') && path.includes('.env')) {
				return true;
			}
			if (pattern.includes('**/secrets/**') && path.includes('secrets')) {
				return true;
			}
			if (pattern.includes('**/*.pem') && path.endsWith('.pem')) {
				return true;
			}
			if (pattern.includes('**/*.key') && path.endsWith('.key')) {
				return true;
			}
			return false;
		}),
	},
}));

describe('permissionService', () => {
	describe('A2A_CONFIG_KEYS', () => {
		it('should define all configuration keys', () => {
			expect(A2A_CONFIG_KEYS.PERMISSION_LEVEL).toBe('github.copilot.chat.agent.permissionLevel');
			expect(A2A_CONFIG_KEYS.PROMPT_FOR_SENSITIVE).toBe('github.copilot.chat.agent.promptForSensitiveOperations');
			expect(A2A_CONFIG_KEYS.ALLOW_OUTSIDE_WORKSPACE).toBe('github.copilot.chat.agent.allowOutsideWorkspace');
			expect(A2A_CONFIG_KEYS.TERMINAL_ENABLED).toBe('github.copilot.chat.agent.terminal.enabled');
			expect(A2A_CONFIG_KEYS.TERMINAL_REQUIRE_APPROVAL).toBe('github.copilot.chat.agent.terminal.requireApproval');
			expect(A2A_CONFIG_KEYS.DENIED_FILE_PATTERNS).toBe('github.copilot.chat.agent.files.deniedPatterns');
			expect(A2A_CONFIG_KEYS.AUTO_APPROVED_COMMANDS).toBe('github.copilot.chat.agent.terminal.autoApprovedCommands');
		});
	});

	describe('AgentPermissionService', () => {
		let service: AgentPermissionService;
		let configService: MockConfigurationService;
		let logService: MockLogService;
		let notificationService: MockNotificationService;
		let telemetryService: MockTelemetryService;
		let extensionContext: MockExtensionContext;
		let workspaceFolders: Array<{ uri: { fsPath: string } }>;

		beforeEach(() => {
			configService = new MockConfigurationService();
			logService = new MockLogService();
			notificationService = new MockNotificationService();
			telemetryService = new MockTelemetryService();
			extensionContext = new MockExtensionContext();
			workspaceFolders = [
				{ uri: { fsPath: '/workspace/project' } },
			];

			service = new (AgentPermissionService as any)(
				extensionContext,
				workspaceFolders,
				configService,
				logService,
				notificationService,
				telemetryService,
			);
		});

		afterEach(() => {
			service.dispose();
			vi.clearAllMocks();
			configService.clear();
		});

		describe('getConfig', () => {
			it('should return default config when no settings are configured', () => {
				const config = service.getConfig();

				expect(config.permissionLevel).toBe(DEFAULT_PERMISSION_CONFIG.permissionLevel);
				expect(config.promptForSensitiveOperations).toBe(DEFAULT_PERMISSION_CONFIG.promptForSensitiveOperations);
				expect(config.fileAccess.allowOutsideWorkspace).toBe(DEFAULT_PERMISSION_CONFIG.fileAccess.allowOutsideWorkspace);
				expect(config.terminalAccess.enabled).toBe(DEFAULT_PERMISSION_CONFIG.terminalAccess.enabled);
			});

			it('should respect custom permission level setting', () => {
				configService.setValue(A2A_CONFIG_KEYS.PERMISSION_LEVEL, 'full-access');

				const config = service.getConfig();
				expect(config.permissionLevel).toBe('full-access');
			});

			it('should respect custom terminal enabled setting', () => {
				configService.setValue(A2A_CONFIG_KEYS.TERMINAL_ENABLED, false);

				const config = service.getConfig();
				expect(config.terminalAccess.enabled).toBe(false);
			});

			it('should respect custom prompt for sensitive setting', () => {
				configService.setValue(A2A_CONFIG_KEYS.PROMPT_FOR_SENSITIVE, false);

				const config = service.getConfig();
				expect(config.promptForSensitiveOperations).toBe(false);
			});
		});

		describe('checkPermission', () => {
			it('should deny operation not allowed by permission level', async () => {
				configService.setValue(A2A_CONFIG_KEYS.PERMISSION_LEVEL, 'read-only');

				const request: PermissionRequest = {
					category: OperationCategory.FileWrite,
					operation: 'write',
					target: '/workspace/project/file.txt',
					requesterId: 'agent-1',
				};

				const result = await service.checkPermission(request);

				expect(result.allowed).toBe(false);
				expect(result.reason).toContain('not allowed with permission level');
			});

			it('should allow operation within permission level', async () => {
				configService.setValue(A2A_CONFIG_KEYS.PERMISSION_LEVEL, 'read-write');

				const request: PermissionRequest = {
					category: OperationCategory.FileRead,
					operation: 'read',
					target: '/workspace/project/file.txt',
					requesterId: 'agent-1',
				};

				const result = await service.checkPermission(request);

				expect(result.allowed).toBe(true);
			});

			it('should fire onPermissionCheck event', async () => {
				const handler = vi.fn();
				service.onPermissionCheck(handler);

				const request: PermissionRequest = {
					category: OperationCategory.FileRead,
					operation: 'read',
					target: '/workspace/project/file.txt',
					requesterId: 'agent-1',
				};

				await service.checkPermission(request);

				expect(handler).toHaveBeenCalledTimes(1);
				expect(handler).toHaveBeenCalledWith(expect.objectContaining({
					request: expect.objectContaining({ category: OperationCategory.FileRead }),
					result: expect.objectContaining({ allowed: expect.any(Boolean) }),
				}));
			});

			it('should update statistics on permission check', async () => {
				const request: PermissionRequest = {
					category: OperationCategory.FileRead,
					operation: 'read',
					target: '/workspace/project/file.txt',
					requesterId: 'agent-1',
				};

				await service.checkPermission(request);

				const stats = service.getStats();
				expect(stats.totalChecks).toBe(1);
			});
		});

		describe('requestApproval', () => {
			it('should return false when user denies', async () => {
				notificationService.showWarningMessage.mockResolvedValue('Deny');

				const request: PermissionRequest = {
					category: OperationCategory.FileDelete,
					operation: 'delete',
					target: '/workspace/project/file.txt',
					requesterId: 'agent-1',
				};

				const approved = await service.requestApproval(request);

				expect(approved).toBe(false);
			});

			it('should return true when user allows', async () => {
				notificationService.showWarningMessage.mockResolvedValue('Allow');

				const request: PermissionRequest = {
					category: OperationCategory.TerminalExecution,
					operation: 'execute',
					target: 'npm run custom',
					requesterId: 'agent-1',
				};

				const approved = await service.requestApproval(request);

				expect(approved).toBe(true);
			});

			it('should fire onApprovalPrompt event', async () => {
				const handler = vi.fn();
				service.onApprovalPrompt(handler);
				notificationService.showWarningMessage.mockResolvedValue('Allow');

				const request: PermissionRequest = {
					category: OperationCategory.ProcessSpawn,
					operation: 'spawn',
					target: 'node script.js',
					requesterId: 'agent-1',
				};

				await service.requestApproval(request);

				expect(handler).toHaveBeenCalledTimes(1);
				expect(handler).toHaveBeenCalledWith(expect.objectContaining({
					request: expect.objectContaining({ category: OperationCategory.ProcessSpawn }),
					approved: true,
				}));
			});

			it('should create approval rule when user selects Allow Always', async () => {
				notificationService.showWarningMessage.mockResolvedValue('Allow Always');

				const request: PermissionRequest = {
					category: OperationCategory.TerminalExecution,
					operation: 'execute',
					target: 'npm run build',
					requesterId: 'agent-1',
				};

				await service.requestApproval(request);

				const rules = service.getApprovalRules();
				expect(rules.length).toBeGreaterThan(0);
				expect(rules.some(r => r.allow === true)).toBe(true);
			});

			it('should create denial rule when user selects Deny Always', async () => {
				notificationService.showWarningMessage.mockResolvedValue('Deny Always');

				const request: PermissionRequest = {
					category: OperationCategory.TerminalExecution,
					operation: 'execute',
					target: 'rm -rf',
					requesterId: 'agent-1',
				};

				await service.requestApproval(request);

				const rules = service.getApprovalRules();
				expect(rules.length).toBeGreaterThan(0);
				expect(rules.some(r => r.allow === false)).toBe(true);
			});

			it('should send telemetry event', async () => {
				notificationService.showWarningMessage.mockResolvedValue('Allow');

				const request: PermissionRequest = {
					category: OperationCategory.FileDelete,
					operation: 'delete',
					target: '/file.txt',
					requesterId: 'agent-1',
				};

				await service.requestApproval(request);

				expect(telemetryService.sendGHTelemetryEvent).toHaveBeenCalledWith(
					'permission_approval',
					expect.objectContaining({
						category: OperationCategory.FileDelete,
						approved: 'true',
					}),
				);
			});
		});

		describe('getStats', () => {
			it('should return initial empty stats', () => {
				const stats = service.getStats();

				expect(stats.totalChecks).toBe(0);
				expect(stats.allowedCount).toBe(0);
				expect(stats.deniedCount).toBe(0);
				expect(stats.promptedCount).toBe(0);
			});

			it('should track allowed operations', async () => {
				const request: PermissionRequest = {
					category: OperationCategory.FileRead,
					operation: 'read',
					target: '/workspace/project/file.txt',
					requesterId: 'agent-1',
				};

				await service.checkPermission(request);

				const stats = service.getStats();
				expect(stats.totalChecks).toBe(1);
				expect(stats.allowedCount).toBe(1);
			});

			it('should track denied operations', async () => {
				configService.setValue(A2A_CONFIG_KEYS.PERMISSION_LEVEL, 'read-only');

				const request: PermissionRequest = {
					category: OperationCategory.FileWrite,
					operation: 'write',
					target: '/workspace/project/file.txt',
					requesterId: 'agent-1',
				};

				await service.checkPermission(request);

				const stats = service.getStats();
				expect(stats.totalChecks).toBe(1);
				expect(stats.deniedCount).toBe(1);
			});
		});

		describe('resetStats', () => {
			it('should reset all statistics', async () => {
				const request: PermissionRequest = {
					category: OperationCategory.FileRead,
					operation: 'read',
					target: '/workspace/project/file.txt',
					requesterId: 'agent-1',
				};

				await service.checkPermission(request);
				expect(service.getStats().totalChecks).toBe(1);

				service.resetStats();

				const stats = service.getStats();
				expect(stats.totalChecks).toBe(0);
				expect(stats.allowedCount).toBe(0);
				expect(stats.deniedCount).toBe(0);
			});
		});

		describe('getAuditLog', () => {
			it('should return empty log initially', () => {
				const log = service.getAuditLog();
				expect(log).toHaveLength(0);
			});

			it('should record approval decisions', async () => {
				notificationService.showWarningMessage.mockResolvedValue('Allow');

				const request: PermissionRequest = {
					category: OperationCategory.ProcessSpawn,
					operation: 'spawn',
					target: 'node script.js',
					requesterId: 'agent-1',
				};

				await service.requestApproval(request);

				const log = service.getAuditLog();
				expect(log.length).toBeGreaterThan(0);
				expect(log[0].approved).toBe(true);
			});

			it('should respect limit parameter', async () => {
				notificationService.showWarningMessage.mockResolvedValue('Allow');

				// Create multiple approval requests
				for (let i = 0; i < 5; i++) {
					await service.requestApproval({
						category: OperationCategory.ProcessSpawn,
						operation: 'spawn',
						target: `process-${i}`,
						requesterId: 'agent-1',
					});
				}

				const limited = service.getAuditLog(2);
				expect(limited).toHaveLength(2);
			});
		});

		describe('approval rules', () => {
			it('should add approval rule', () => {
				service.addApprovalRule({
					category: OperationCategory.TerminalExecution,
					pattern: 'npm run *',
					allow: true,
					scope: ApprovalScope.Workspace,
				});

				const rules = service.getApprovalRules();
				expect(rules).toHaveLength(1);
				expect(rules[0].category).toBe(OperationCategory.TerminalExecution);
				expect(rules[0].pattern).toBe('npm run *');
				expect(rules[0].allow).toBe(true);
			});

			it('should generate unique IDs for rules', () => {
				service.addApprovalRule({
					category: OperationCategory.TerminalExecution,
					pattern: 'pattern1',
					allow: true,
					scope: ApprovalScope.Session,
				});

				service.addApprovalRule({
					category: OperationCategory.TerminalExecution,
					pattern: 'pattern2',
					allow: false,
					scope: ApprovalScope.Session,
				});

				const rules = service.getApprovalRules();
				expect(rules[0].id).not.toBe(rules[1].id);
			});

			it('should remove approval rule by ID', () => {
				service.addApprovalRule({
					category: OperationCategory.FileRead,
					pattern: 'test-pattern',
					allow: true,
					scope: ApprovalScope.Global,
				});

				const rules = service.getApprovalRules();
				expect(rules).toHaveLength(1);

				service.removeApprovalRule(rules[0].id);

				expect(service.getApprovalRules()).toHaveLength(0);
			});

			it('should not throw when removing non-existent rule', () => {
				expect(() => {
					service.removeApprovalRule('non-existent-id');
				}).not.toThrow();
			});
		});

		describe('clearSessionApprovals', () => {
			it('should clear session-level approvals', async () => {
				notificationService.showWarningMessage.mockResolvedValue('Allow');

				const request: PermissionRequest = {
					category: OperationCategory.ProcessSpawn,
					operation: 'spawn',
					target: 'test-process',
					requesterId: 'agent-1',
				};

				// This should store a session approval
				await service.requestApproval(request);

				service.clearSessionApprovals();

				// Log should confirm session was cleared
				expect(logService.info).toHaveBeenCalledWith('Cleared session approvals');
			});
		});

		describe('file access checks', () => {
			it('should allow access to files without target specified', async () => {
				const request: PermissionRequest = {
					category: OperationCategory.FileRead,
					operation: 'read',
					requesterId: 'agent-1',
				};

				const result = await service.checkPermission(request);
				expect(result.allowed).toBe(true);
			});
		});

		describe('terminal access checks', () => {
			it('should deny terminal execution when disabled', async () => {
				configService.setValue(A2A_CONFIG_KEYS.PERMISSION_LEVEL, 'full-access');
				configService.setValue(A2A_CONFIG_KEYS.TERMINAL_ENABLED, false);

				const request: PermissionRequest = {
					category: OperationCategory.TerminalExecution,
					operation: 'execute',
					target: 'npm test',
					requesterId: 'agent-1',
				};

				const result = await service.checkPermission(request);
				expect(result.allowed).toBe(false);
				expect(result.reason).toContain('Terminal execution is disabled');
			});
		});

		describe('dispose', () => {
			it('should dispose without errors', () => {
				expect(() => {
					service.dispose();
				}).not.toThrow();
			});

			it('should be idempotent', () => {
				service.dispose();
				expect(() => {
					service.dispose();
				}).not.toThrow();
			});
		});
	});

	describe('NullAgentPermissionService', () => {
		let nullService: NullAgentPermissionService;

		beforeEach(() => {
			nullService = new NullAgentPermissionService();
		});

		afterEach(() => {
			nullService.dispose();
		});

		describe('checkPermission', () => {
			it('should always allow operations', async () => {
				const request: PermissionRequest = {
					category: OperationCategory.FileDelete,
					operation: 'delete',
					target: '/some/file',
					requesterId: 'agent-1',
				};

				const result = await nullService.checkPermission(request);

				expect(result.allowed).toBe(true);
				expect(result.permissionLevel).toBe('full-access');
			});
		});

		describe('requestApproval', () => {
			it('should always return true', async () => {
				const request: PermissionRequest = {
					category: OperationCategory.ProcessSpawn,
					operation: 'spawn',
					target: 'dangerous-process',
					requesterId: 'agent-1',
				};

				const approved = await nullService.requestApproval(request);
				expect(approved).toBe(true);
			});
		});

		describe('getConfig', () => {
			it('should return full-access config', () => {
				const config = nullService.getConfig();
				expect(config.permissionLevel).toBe('full-access');
			});
		});

		describe('getStats', () => {
			it('should return empty stats', () => {
				const stats = nullService.getStats();
				expect(stats.totalChecks).toBe(0);
				expect(stats.allowedCount).toBe(0);
				expect(stats.deniedCount).toBe(0);
			});
		});

		describe('getAuditLog', () => {
			it('should return empty array', () => {
				const log = nullService.getAuditLog();
				expect(log).toHaveLength(0);
			});
		});

		describe('getApprovalRules', () => {
			it('should return empty array', () => {
				const rules = nullService.getApprovalRules();
				expect(rules).toHaveLength(0);
			});
		});

		describe('addApprovalRule', () => {
			it('should be a no-op', () => {
				nullService.addApprovalRule({
					category: OperationCategory.FileRead,
					pattern: 'test',
					allow: true,
					scope: ApprovalScope.Session,
				});

				expect(nullService.getApprovalRules()).toHaveLength(0);
			});
		});

		describe('removeApprovalRule', () => {
			it('should be a no-op', () => {
				expect(() => {
					nullService.removeApprovalRule('some-id');
				}).not.toThrow();
			});
		});

		describe('clearSessionApprovals', () => {
			it('should be a no-op', () => {
				expect(() => {
					nullService.clearSessionApprovals();
				}).not.toThrow();
			});
		});

		describe('resetStats', () => {
			it('should be a no-op', () => {
				expect(() => {
					nullService.resetStats();
				}).not.toThrow();
			});
		});

		describe('events', () => {
			it('should have onPermissionCheck event', () => {
				expect(nullService.onPermissionCheck).toBeDefined();
			});

			it('should have onApprovalPrompt event', () => {
				expect(nullService.onApprovalPrompt).toBeDefined();
			});
		});
	});
});
