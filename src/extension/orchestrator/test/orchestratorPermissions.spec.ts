/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DisposableStore } from '../../../util/vs/base/common/lifecycle';
import { URI } from '../../../util/vs/base/common/uri';
import { OrchestratorPermissionService } from '../orchestratorPermissions';
import * as vscode from 'vscode';

// Mock vscode
vi.mock('vscode', () => ({
    workspace: {
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
        getConfiguration: vi.fn(),
        workspaceFolders: [],
    },
    Uri: {
        file: (path: string) => ({ fsPath: path, scheme: 'file', toString: () => `file://${path}` }),
        joinPath: (uri: any, ...pathSegments: string[]) => ({ fsPath: `${uri.fsPath}/${pathSegments.join('/')}`, scheme: 'file' }),
    }
}));

// Mock services
const createMockLogService = () => ({
    _serviceBrand: undefined,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn((msg) => console.error('MockLogService Error:', msg)),
    trace: vi.fn(),
});

const createMockFileSystemService = () => ({
    _serviceBrand: undefined,
    readFile: vi.fn(),
    readDirectory: vi.fn(),
    stat: vi.fn(),
    exists: vi.fn(),
    writeFile: vi.fn(),
    delete: vi.fn(),
    createDirectory: vi.fn(),
    copy: vi.fn(),
    rename: vi.fn(),
});

const createMockExtensionContext = () => ({
    extensionUri: URI.file('/extension'),
    subscriptions: [],
    workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
    },
    globalState: {
        get: vi.fn(),
        update: vi.fn(),
        setKeysForSync: vi.fn(),
    },
    secrets: {
        get: vi.fn(),
        store: vi.fn(),
        delete: vi.fn(),
        onDidChange: vi.fn(),
    },
    extensionMode: 1,
    asAbsolutePath: vi.fn(),
    storageUri: URI.file('/storage'),
    globalStorageUri: URI.file('/globalStorage'),
    logUri: URI.file('/log'),
    extension: {
        id: 'test.extension',
        extensionUri: URI.file('/extension'),
        packageJSON: {},
    },
});

describe('OrchestratorPermissionService', () => {
    let disposables: DisposableStore;
    let permissionService: OrchestratorPermissionService;
    let mockFileSystemService: ReturnType<typeof createMockFileSystemService>;
    let mockExtensionContext: ReturnType<typeof createMockExtensionContext>;
    let mockLogService: ReturnType<typeof createMockLogService>;

    const defaultPermissions = {
        auto_approve: ['default_approve'],
        ask_user: ['default_ask'],
        auto_deny: ['default_deny'],
        limits: {
            max_subtask_depth: 2,
            max_subtasks_per_worker: 10,
            max_parallel_subtasks: 5,
            subtask_spawn_rate_limit: 20
        }
    };

    beforeEach(() => {
        disposables = new DisposableStore();
        mockFileSystemService = createMockFileSystemService();
        mockExtensionContext = createMockExtensionContext();
        mockLogService = createMockLogService();

        // Mock default permissions file
        mockFileSystemService.readFile.mockImplementation(async (uri: any) => {
            if (uri.fsPath.includes('orchestrator-permissions.json')) {
                return new TextEncoder().encode(JSON.stringify(defaultPermissions));
            }
            throw new Error('File not found');
        });

        // Reset vscode mocks
        (vscode.workspace.getConfiguration as any).mockReturnValue({
            get: vi.fn().mockReturnValue(undefined)
        });
        (vscode.workspace as any).workspaceFolders = undefined;

        permissionService = new OrchestratorPermissionService(
            mockFileSystemService as any,
            mockExtensionContext as any,
            mockLogService as any
        );
        disposables.add(permissionService);
    });

    it('should load default permissions', async () => {
        const perms = await permissionService.loadPermissions();
        expect(perms.auto_approve).toContain('default_approve');
        expect(perms.limits.max_subtask_depth).toBe(2);
    });

    it('should load workspace overrides', async () => {
        // Mock workspace folder
        (vscode.workspace as any).workspaceFolders = [{ uri: URI.file('/workspace') }];

        // Mock workspace permissions file
        const workspaceContent = `---
auto_approve: ['workspace_approve']
limits:
  max_subtask_depth: 5
---
`;
        mockFileSystemService.readFile.mockImplementation(async (uri: any) => {
            // console.log('Mock readFile:', uri.fsPath);
            if (uri.fsPath.includes('orchestrator-permissions.json')) {
                return new TextEncoder().encode(JSON.stringify(defaultPermissions));
            }
            // Normalize slashes for comparison
            const normalizedPath = uri.fsPath.replace(/\\/g, '/');
            if (normalizedPath.includes('.github/agents/orchestrator/permissions.md')) {
                return new TextEncoder().encode(workspaceContent);
            }
            throw new Error(`File not found: ${uri.fsPath}`);
        });

        const perms = await permissionService.loadPermissions();
        expect(perms.auto_approve).toEqual(['workspace_approve']); // Replaced
        expect(perms.ask_user).toEqual(['default_ask']); // Inherited
        expect(perms.limits.max_subtask_depth).toBe(5); // Overridden
        expect(perms.limits.max_subtasks_per_worker).toBe(10); // Inherited
    });

    it('should load user settings overrides', async () => {
        // Mock user settings
        const getMock = vi.fn().mockReturnValue({
            auto_deny: ['user_deny'],
            limits: {
                max_parallel_subtasks: 1
            }
        });
        (vscode.workspace.getConfiguration as any).mockImplementation((section: string) => {
            if (section === 'github.copilot.orchestrator') {
                return { get: getMock };
            }
            return { get: vi.fn() };
        });

        const perms = await permissionService.loadPermissions();
        expect(perms.auto_deny).toEqual(['user_deny']); // Replaced
        expect(perms.limits.max_parallel_subtasks).toBe(1); // Overridden
        expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('github.copilot.orchestrator');
    });

    it('should evaluate permissions correctly', async () => {
        await permissionService.loadPermissions();
        
        expect(permissionService.evaluatePermission('default_approve')).toBe('auto_approve');
        expect(permissionService.evaluatePermission('default_ask')).toBe('ask_user');
        expect(permissionService.evaluatePermission('default_deny')).toBe('auto_deny');
        expect(permissionService.evaluatePermission('unknown_action')).toBe('ask_user');
    });

    it('should check limits correctly', async () => {
        await permissionService.loadPermissions();

        expect(permissionService.checkLimit('max_subtask_depth', 1)).toBe(true);
        expect(permissionService.checkLimit('max_subtask_depth', 2)).toBe(false); // < limit
        expect(permissionService.checkLimit('max_subtask_depth', 3)).toBe(false);
    });
});
