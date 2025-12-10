/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DisposableStore } from '../../../util/vs/base/common/lifecycle';
import { WorkspaceConfigLoader, ConfigValidator } from '../configuration';
import * as vscode from 'vscode';

// Mock vscode
vi.mock('vscode', () => ({
    workspace: {
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
        getConfiguration: vi.fn(),
        workspaceFolders: [],
        createFileSystemWatcher: vi.fn(() => ({
            onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
            onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
            onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
            dispose: vi.fn()
        })),
        fs: {
            readFile: vi.fn()
        }
    },
    Uri: {
        file: (path: string) => ({ fsPath: path, scheme: 'file', toString: () => `file://${path}` }),
        joinPath: (uri: any, ...pathSegments: string[]) => ({ fsPath: `${uri.fsPath}/${pathSegments.join('/')}`, scheme: 'file' }),
    }
}));

describe('WorkspaceConfigLoader', () => {
    let disposables: DisposableStore;
    let configLoader: WorkspaceConfigLoader;

    beforeEach(() => {
        disposables = new DisposableStore();
        
        // Reset mocks
        (vscode.workspace.getConfiguration as any).mockReturnValue({
            get: vi.fn().mockReturnValue(undefined)
        });
        (vscode.workspace as any).workspaceFolders = undefined;
        (vscode.workspace.fs.readFile as any).mockRejectedValue(new Error('File not found'));

        configLoader = new WorkspaceConfigLoader();
        disposables.add(configLoader);
    });

    it('should load default configuration', async () => {
        await configLoader.loadConfig();
        const config = configLoader.getConfig();
        
        expect(config.permissions.fileSystem?.read).toBe('ask_user');
        expect(config.limits.maxSubtaskDepth).toBe(2);
        expect(config.modelPreferences.default).toBe('gpt-4o');
    });

    it('should load user settings overrides', async () => {
        const getMock = vi.fn((key: string) => {
            if (key === 'orchestrator.permissions') return { fileSystem: { read: 'auto_approve' } };
            if (key === 'orchestrator.limits') return { maxSubtaskDepth: 5 };
            return undefined;
        });

        (vscode.workspace.getConfiguration as any).mockReturnValue({ get: getMock });

        await configLoader.loadConfig();
        const config = configLoader.getConfig();

        expect(config.permissions.fileSystem?.read).toBe('auto_approve');
        expect(config.limits.maxSubtaskDepth).toBe(5);
    });

    it('should merge permissions correctly', async () => {
        const getMock = vi.fn((key: string) => {
            if (key === 'orchestrator.permissions') return { 
                fileSystem: { write: 'deny' },
                network: { fetch: 'auto_approve' }
            };
            return undefined;
        });

        (vscode.workspace.getConfiguration as any).mockReturnValue({ get: getMock });

        await configLoader.loadConfig();
        const config = configLoader.getConfig();

        // Default
        expect(config.permissions.fileSystem?.read).toBe('ask_user');
        // Overridden
        expect(config.permissions.fileSystem?.write).toBe('deny');
        // New
        expect(config.permissions.network?.fetch).toBe('auto_approve');
    });
});

describe('ConfigValidator', () => {
    let validator: ConfigValidator;

    beforeEach(() => {
        validator = new ConfigValidator();
    });

    it('should validate valid permissions', () => {
        const result = validator.validatePermissions({
            fileSystem: { read: 'auto_approve' }
        });
        expect(result.valid).toBe(true);
    });

    it('should fail on invalid permission level', () => {
        const result = validator.validatePermissions({
            fileSystem: { read: 'invalid_level' }
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain('Invalid permission level');
    });

    it('should validate valid agent capabilities', () => {
        const result = validator.validateAgentCapability({
            skills: ['skill1'],
            allowedTools: ['tool1']
        });
        expect(result.valid).toBe(true);
    });

    it('should fail on invalid agent capabilities', () => {
        const result = validator.validateAgentCapability({
            skills: 'not_an_array'
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain('Skills must be an array');
    });

    it('should validate valid model preferences', () => {
        const result = validator.validateModelPreferences({
            default: 'gpt-4',
            byTaskType: { architecture: 'o1' },
            byAgent: { architect: 'o1' }
        });
        expect(result.valid).toBe(true);
    });

    it('should fail on invalid model preferences', () => {
        const result = validator.validateModelPreferences({
            default: 123
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain('Default model must be a string');
    });
});
