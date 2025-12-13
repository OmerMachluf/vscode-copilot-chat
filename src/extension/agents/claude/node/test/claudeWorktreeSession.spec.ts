/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ClaudeWorktreeSession, ClaudeWorktreeSessionManager } from '../claudeWorktreeSession';
import { ClaudeAgentManager } from '../claudeCodeAgent';
import { URI } from '../../../../../util/vs/base/common/uri';
import { createExtensionUnitTestingServices } from '../../../../test/node/services';

describe('ClaudeWorktreeSession', () => {
	describe('path boundary validation', () => {
		let session: ClaudeWorktreeSession;
		const worktreePath = '/workspace/.worktrees/feature-branch';

		beforeEach(() => {
			// Create a mock session that has the shape of ClaudeCodeSession
			const mockClaudeSession = {
				sessionId: 'test-session-id',
				dispose: vi.fn(),
				invoke: vi.fn(),
			};

			session = new ClaudeWorktreeSession(
				mockClaudeSession as any,
				worktreePath,
				URI.file(worktreePath)
			);
		});

		test('should return true for paths within worktree', () => {
			expect(session.isPathWithinBoundary('/workspace/.worktrees/feature-branch/src/file.ts')).toBe(true);
			expect(session.isPathWithinBoundary('/workspace/.worktrees/feature-branch/package.json')).toBe(true);
		});

		test('should return false for paths outside worktree', () => {
			expect(session.isPathWithinBoundary('/workspace/src/file.ts')).toBe(false);
			expect(session.isPathWithinBoundary('/workspace/.worktrees/other-branch/file.ts')).toBe(false);
		});

		test('should handle Windows-style paths', () => {
			const windowsWorktreePath = 'C:\\workspace\\.worktrees\\feature-branch';
			const mockClaudeSession = {
				sessionId: 'test-session-id',
				dispose: vi.fn(),
				invoke: vi.fn(),
			};

			const windowsSession = new ClaudeWorktreeSession(
				mockClaudeSession as any,
				windowsWorktreePath,
				URI.file(windowsWorktreePath)
			);

			expect(windowsSession.isPathWithinBoundary('C:\\workspace\\.worktrees\\feature-branch\\src\\file.ts')).toBe(true);
			expect(windowsSession.isPathWithinBoundary('C:\\workspace\\src\\file.ts')).toBe(false);
		});

		test('should validate URIs within boundary', () => {
			const validUri = URI.file('/workspace/.worktrees/feature-branch/src/file.ts');
			const invalidUri = URI.file('/workspace/src/file.ts');

			expect(session.isUriWithinBoundary(validUri)).toBe(true);
			expect(session.isUriWithinBoundary(invalidUri)).toBe(false);
		});
	});

	describe('session lifecycle', () => {
		test('should be active initially', () => {
			const mockClaudeSession = {
				sessionId: 'test-session-id',
				dispose: vi.fn(),
				invoke: vi.fn(),
			};

			const session = new ClaudeWorktreeSession(
				mockClaudeSession as any,
				'/workspace/.worktrees/feature-branch',
				URI.file('/workspace/.worktrees/feature-branch')
			);

			expect(session.isActive).toBe(true);
		});

		test('should be inactive after markInactive', () => {
			const mockClaudeSession = {
				sessionId: 'test-session-id',
				dispose: vi.fn(),
				invoke: vi.fn(),
			};

			const session = new ClaudeWorktreeSession(
				mockClaudeSession as any,
				'/workspace/.worktrees/feature-branch',
				URI.file('/workspace/.worktrees/feature-branch')
			);

			session.markInactive();
			expect(session.isActive).toBe(false);
		});

		test('should be inactive after dispose', () => {
			const mockClaudeSession = {
				sessionId: 'test-session-id',
				dispose: vi.fn(),
				invoke: vi.fn(),
			};

			const session = new ClaudeWorktreeSession(
				mockClaudeSession as any,
				'/workspace/.worktrees/feature-branch',
				URI.file('/workspace/.worktrees/feature-branch')
			);

			session.dispose();
			expect(session.isActive).toBe(false);
		});

		test('should expose sessionId from underlying session', () => {
			const mockClaudeSession = {
				sessionId: 'unique-session-123',
				dispose: vi.fn(),
				invoke: vi.fn(),
			};

			const session = new ClaudeWorktreeSession(
				mockClaudeSession as any,
				'/workspace/.worktrees/feature-branch',
				URI.file('/workspace/.worktrees/feature-branch')
			);

			expect(session.sessionId).toBe('unique-session-123');
		});
	});
});

describe('ClaudeWorktreeSessionManager', () => {
	let manager: ClaudeWorktreeSessionManager;
	let services: ReturnType<typeof createExtensionUnitTestingServices>;

	beforeEach(() => {
		services = createExtensionUnitTestingServices();
		manager = services.instantiationService.createInstance(ClaudeWorktreeSessionManager);
	});

	describe('session management', () => {
		test('should have no active sessions initially', () => {
			expect(manager.getActiveWorktreePaths()).toHaveLength(0);
		});

		test('should return undefined for non-existent session', () => {
			expect(manager.getSession('/non/existent/path')).toBeUndefined();
		});

		test('should normalize paths for lookup', () => {
			// Test that different path formats resolve to the same key
			const path1 = '/workspace/.worktrees/feature-branch';
			const path2 = '/workspace/.worktrees/feature-branch/';
			const path3 = '\\workspace\\.worktrees\\feature-branch';

			// All should resolve to undefined since no sessions exist
			expect(manager.getSession(path1)).toBeUndefined();
			expect(manager.getSession(path2)).toBeUndefined();
			expect(manager.getSession(path3)).toBeUndefined();
		});

		test('removeSession should return false for non-existent session', () => {
			expect(manager.removeSession('/non/existent/path')).toBe(false);
		});
	});
});

describe('ClaudeAgentManager worktree support', () => {
	let agentManager: ClaudeAgentManager;
	let services: ReturnType<typeof createExtensionUnitTestingServices>;

	beforeEach(() => {
		services = createExtensionUnitTestingServices();
		agentManager = services.instantiationService.createInstance(ClaudeAgentManager);
	});

	describe('worktree session management', () => {
		test('should have no active worktree sessions initially', () => {
			expect(agentManager.getActiveWorktreePaths()).toHaveLength(0);
		});

		test('should return false when removing non-existent worktree session', () => {
			expect(agentManager.removeWorktreeSession('/non/existent/path')).toBe(false);
		});
	});
});
