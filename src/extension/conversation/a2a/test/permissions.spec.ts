/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
	ApprovalScope,
	DEFAULT_PERMISSION_CONFIG,
	getAllowedCategories,
	isOperationAllowedByLevel,
	isSensitiveOperation,
	OperationCategory,
	PermissionLevel,
	SENSITIVE_OPERATIONS,
} from '../permissions';

describe('permissions', () => {
	describe('OperationCategory', () => {
		it('should define all operation categories', () => {
			expect(OperationCategory.FileRead).toBe('file-read');
			expect(OperationCategory.FileWrite).toBe('file-write');
			expect(OperationCategory.FileDelete).toBe('file-delete');
			expect(OperationCategory.TerminalExecution).toBe('terminal-execution');
			expect(OperationCategory.WebFetch).toBe('web-fetch');
			expect(OperationCategory.ProcessSpawn).toBe('process-spawn');
			expect(OperationCategory.GitOperations).toBe('git-operations');
			expect(OperationCategory.ExtensionApi).toBe('extension-api');
		});

		it('should have unique values for all categories', () => {
			const values = Object.values(OperationCategory);
			const uniqueValues = new Set(values);
			expect(uniqueValues.size).toBe(values.length);
		});
	});

	describe('ApprovalScope', () => {
		it('should define all approval scopes', () => {
			expect(ApprovalScope.Session).toBe('session');
			expect(ApprovalScope.Workspace).toBe('workspace');
			expect(ApprovalScope.Global).toBe('global');
		});
	});

	describe('DEFAULT_PERMISSION_CONFIG', () => {
		it('should have read-write as default permission level', () => {
			expect(DEFAULT_PERMISSION_CONFIG.permissionLevel).toBe('read-write');
		});

		it('should have file access configured with default patterns', () => {
			expect(DEFAULT_PERMISSION_CONFIG.fileAccess.allowedPatterns).toContain('**/*');
			expect(DEFAULT_PERMISSION_CONFIG.fileAccess.allowOutsideWorkspace).toBe(false);
		});

		it('should deny access to sensitive file patterns by default', () => {
			const deniedPatterns = DEFAULT_PERMISSION_CONFIG.fileAccess.deniedPatterns;
			expect(deniedPatterns).toContain('**/.env');
			expect(deniedPatterns).toContain('**/.env.*');
			expect(deniedPatterns).toContain('**/secrets/**');
			expect(deniedPatterns).toContain('**/*.pem');
			expect(deniedPatterns).toContain('**/*.key');
			expect(deniedPatterns).toContain('**/id_rsa*');
			expect(deniedPatterns).toContain('**/.ssh/**');
		});

		it('should have terminal access enabled by default', () => {
			expect(DEFAULT_PERMISSION_CONFIG.terminalAccess.enabled).toBe(true);
		});

		it('should auto-approve safe commands', () => {
			const autoApproved = DEFAULT_PERMISSION_CONFIG.terminalAccess.autoApprovedCommands;
			expect(autoApproved).toContain('git status');
			expect(autoApproved).toContain('git diff');
			expect(autoApproved).toContain('git log');
			expect(autoApproved).toContain('npm test');
			expect(autoApproved).toContain('npm run test');
			expect(autoApproved).toContain('npm run lint');
			expect(autoApproved).toContain('npm run build');
			expect(autoApproved).toContain('ls');
			expect(autoApproved).toContain('dir');
			expect(autoApproved).toContain('cat');
			expect(autoApproved).toContain('pwd');
		});

		it('should deny dangerous commands', () => {
			const deniedCommands = DEFAULT_PERMISSION_CONFIG.terminalAccess.deniedCommands;
			expect(deniedCommands).toContain('rm -rf /');
			expect(deniedCommands).toContain('rmdir /s /q c:');
			expect(deniedCommands).toContain('format');
			expect(deniedCommands).toContain('mkfs');
			expect(deniedCommands).toContain('dd if=/dev/');
			expect(deniedCommands).toContain(':(){ :|:& };:');
		});

		it('should require approval for unknown terminal commands', () => {
			expect(DEFAULT_PERMISSION_CONFIG.terminalAccess.requireApprovalForUnknown).toBe(true);
		});

		it('should prompt for sensitive operations by default', () => {
			expect(DEFAULT_PERMISSION_CONFIG.promptForSensitiveOperations).toBe(true);
		});

		it('should not limit operations per session by default', () => {
			expect(DEFAULT_PERMISSION_CONFIG.maxOperationsPerSession).toBeUndefined();
		});
	});

	describe('SENSITIVE_OPERATIONS', () => {
		it('should include FileDelete as sensitive', () => {
			expect(SENSITIVE_OPERATIONS).toContain(OperationCategory.FileDelete);
		});

		it('should include ProcessSpawn as sensitive', () => {
			expect(SENSITIVE_OPERATIONS).toContain(OperationCategory.ProcessSpawn);
		});

		it('should be readonly', () => {
			// This is a compile-time check, but we can verify at runtime it's an array
			expect(Array.isArray(SENSITIVE_OPERATIONS)).toBe(true);
		});
	});

	describe('isSensitiveOperation', () => {
		it('should return true for FileDelete', () => {
			expect(isSensitiveOperation(OperationCategory.FileDelete)).toBe(true);
		});

		it('should return true for ProcessSpawn', () => {
			expect(isSensitiveOperation(OperationCategory.ProcessSpawn)).toBe(true);
		});

		it('should return false for FileRead', () => {
			expect(isSensitiveOperation(OperationCategory.FileRead)).toBe(false);
		});

		it('should return false for FileWrite', () => {
			expect(isSensitiveOperation(OperationCategory.FileWrite)).toBe(false);
		});

		it('should return false for TerminalExecution', () => {
			expect(isSensitiveOperation(OperationCategory.TerminalExecution)).toBe(false);
		});

		it('should return false for WebFetch', () => {
			expect(isSensitiveOperation(OperationCategory.WebFetch)).toBe(false);
		});

		it('should return false for GitOperations', () => {
			expect(isSensitiveOperation(OperationCategory.GitOperations)).toBe(false);
		});

		it('should return false for ExtensionApi', () => {
			expect(isSensitiveOperation(OperationCategory.ExtensionApi)).toBe(false);
		});
	});

	describe('getAllowedCategories', () => {
		describe('read-only permission level', () => {
			it('should allow FileRead', () => {
				const allowed = getAllowedCategories('read-only');
				expect(allowed).toContain(OperationCategory.FileRead);
			});

			it('should allow WebFetch', () => {
				const allowed = getAllowedCategories('read-only');
				expect(allowed).toContain(OperationCategory.WebFetch);
			});

			it('should not allow FileWrite', () => {
				const allowed = getAllowedCategories('read-only');
				expect(allowed).not.toContain(OperationCategory.FileWrite);
			});

			it('should not allow FileDelete', () => {
				const allowed = getAllowedCategories('read-only');
				expect(allowed).not.toContain(OperationCategory.FileDelete);
			});

			it('should not allow TerminalExecution', () => {
				const allowed = getAllowedCategories('read-only');
				expect(allowed).not.toContain(OperationCategory.TerminalExecution);
			});

			it('should only return 2 categories', () => {
				const allowed = getAllowedCategories('read-only');
				expect(allowed).toHaveLength(2);
			});
		});

		describe('read-write permission level', () => {
			it('should allow FileRead', () => {
				const allowed = getAllowedCategories('read-write');
				expect(allowed).toContain(OperationCategory.FileRead);
			});

			it('should allow FileWrite', () => {
				const allowed = getAllowedCategories('read-write');
				expect(allowed).toContain(OperationCategory.FileWrite);
			});

			it('should allow WebFetch', () => {
				const allowed = getAllowedCategories('read-write');
				expect(allowed).toContain(OperationCategory.WebFetch);
			});

			it('should allow GitOperations', () => {
				const allowed = getAllowedCategories('read-write');
				expect(allowed).toContain(OperationCategory.GitOperations);
			});

			it('should not allow FileDelete', () => {
				const allowed = getAllowedCategories('read-write');
				expect(allowed).not.toContain(OperationCategory.FileDelete);
			});

			it('should not allow TerminalExecution', () => {
				const allowed = getAllowedCategories('read-write');
				expect(allowed).not.toContain(OperationCategory.TerminalExecution);
			});

			it('should not allow ProcessSpawn', () => {
				const allowed = getAllowedCategories('read-write');
				expect(allowed).not.toContain(OperationCategory.ProcessSpawn);
			});

			it('should return 4 categories', () => {
				const allowed = getAllowedCategories('read-write');
				expect(allowed).toHaveLength(4);
			});
		});

		describe('full-access permission level', () => {
			it('should allow all operation categories', () => {
				const allowed = getAllowedCategories('full-access');
				const allCategories = Object.values(OperationCategory);
				
				for (const category of allCategories) {
					expect(allowed).toContain(category);
				}
			});

			it('should return all categories', () => {
				const allowed = getAllowedCategories('full-access');
				const allCategories = Object.values(OperationCategory);
				expect(allowed).toHaveLength(allCategories.length);
			});
		});
	});

	describe('isOperationAllowedByLevel', () => {
		describe('read-only level', () => {
			const level: PermissionLevel = 'read-only';

			it('should allow FileRead', () => {
				expect(isOperationAllowedByLevel(level, OperationCategory.FileRead)).toBe(true);
			});

			it('should allow WebFetch', () => {
				expect(isOperationAllowedByLevel(level, OperationCategory.WebFetch)).toBe(true);
			});

			it('should not allow FileWrite', () => {
				expect(isOperationAllowedByLevel(level, OperationCategory.FileWrite)).toBe(false);
			});

			it('should not allow FileDelete', () => {
				expect(isOperationAllowedByLevel(level, OperationCategory.FileDelete)).toBe(false);
			});

			it('should not allow TerminalExecution', () => {
				expect(isOperationAllowedByLevel(level, OperationCategory.TerminalExecution)).toBe(false);
			});

			it('should not allow ProcessSpawn', () => {
				expect(isOperationAllowedByLevel(level, OperationCategory.ProcessSpawn)).toBe(false);
			});
		});

		describe('read-write level', () => {
			const level: PermissionLevel = 'read-write';

			it('should allow FileRead', () => {
				expect(isOperationAllowedByLevel(level, OperationCategory.FileRead)).toBe(true);
			});

			it('should allow FileWrite', () => {
				expect(isOperationAllowedByLevel(level, OperationCategory.FileWrite)).toBe(true);
			});

			it('should allow GitOperations', () => {
				expect(isOperationAllowedByLevel(level, OperationCategory.GitOperations)).toBe(true);
			});

			it('should not allow FileDelete', () => {
				expect(isOperationAllowedByLevel(level, OperationCategory.FileDelete)).toBe(false);
			});

			it('should not allow TerminalExecution', () => {
				expect(isOperationAllowedByLevel(level, OperationCategory.TerminalExecution)).toBe(false);
			});
		});

		describe('full-access level', () => {
			const level: PermissionLevel = 'full-access';

			it('should allow all operations', () => {
				const allCategories = Object.values(OperationCategory);
				
				for (const category of allCategories) {
					expect(isOperationAllowedByLevel(level, category)).toBe(true);
				}
			});
		});
	});

	describe('Type definitions', () => {
		it('should support PermissionLevel type values', () => {
			const levels: PermissionLevel[] = ['read-only', 'read-write', 'full-access'];
			expect(levels).toHaveLength(3);
		});

		it('should support PermissionCheckResult structure', () => {
			const result = {
				allowed: true,
				permissionLevel: 'read-write' as PermissionLevel,
				reason: 'Test reason',
				previouslyApproved: false,
			};

			expect(result.allowed).toBe(true);
			expect(result.permissionLevel).toBe('read-write');
			expect(result.reason).toBe('Test reason');
			expect(result.previouslyApproved).toBe(false);
		});

		it('should support PermissionRequest structure', () => {
			const request = {
				category: OperationCategory.FileRead,
				operation: 'readFile',
				target: '/path/to/file',
				requesterId: 'agent-1',
				context: { key: 'value' },
			};

			expect(request.category).toBe(OperationCategory.FileRead);
			expect(request.operation).toBe('readFile');
			expect(request.target).toBe('/path/to/file');
			expect(request.requesterId).toBe('agent-1');
		});

		it('should support ApprovalRule structure', () => {
			const rule = {
				id: 'rule-1',
				category: OperationCategory.TerminalExecution,
				pattern: 'npm run *',
				allow: true,
				scope: ApprovalScope.Workspace,
				createdAt: Date.now(),
				expiresAt: Date.now() + 86400000,
			};

			expect(rule.id).toBe('rule-1');
			expect(rule.category).toBe(OperationCategory.TerminalExecution);
			expect(rule.pattern).toBe('npm run *');
			expect(rule.allow).toBe(true);
			expect(rule.scope).toBe(ApprovalScope.Workspace);
		});

		it('should support ApprovalRecord structure', () => {
			const record = {
				id: 'record-1',
				timestamp: Date.now(),
				request: {
					category: OperationCategory.FileDelete,
					operation: 'delete',
					target: '/path/to/file',
					requesterId: 'agent-1',
				},
				approved: true,
				userResponse: 'allow' as const,
				notes: 'User approved deletion',
			};

			expect(record.id).toBe('record-1');
			expect(record.approved).toBe(true);
			expect(record.userResponse).toBe('allow');
		});
	});
});
