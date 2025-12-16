/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileType } from 'vscode';
import { ClaudeCommandService, formatCommandsForPrompt } from '../claudeCommandService';
import { URI } from '../../../util/vs/base/common/uri';

// Mocked workspace folders - can be modified by tests
let mockWorkspaceFolders: { uri: URI }[] = [];

// Mock vscode
vi.mock('vscode', () => ({
	workspace: {
		get workspaceFolders() {
			return mockWorkspaceFolders;
		},
		createFileSystemWatcher: () => ({
			onDidCreate: () => ({ dispose: () => { } }),
			onDidChange: () => ({ dispose: () => { } }),
			onDidDelete: () => ({ dispose: () => { } }),
			dispose: () => { },
		}),
	},
	Uri: {
		file: (path: string) => URI.file(path),
		joinPath: (base: any, ...paths: string[]) => URI.joinPath(base, ...paths),
	},
	FileType: {
		File: 1,
		Directory: 2,
	},
}));

// Mock file system service
class MockFileSystemService {
	private files: Map<string, Uint8Array> = new Map();
	private directories: Map<string, [string, FileType][]> = new Map();

	async stat(uri: URI): Promise<{ type: number; mtime: number }> {
		const path = uri.toString();
		if (this.files.has(path)) {
			return { type: 1, mtime: Date.now() }; // FileType.File
		}
		if (this.directories.has(path)) {
			return { type: 2, mtime: Date.now() }; // FileType.Directory
		}
		throw new Error(`File not found: ${path}`);
	}

	async readFile(uri: URI): Promise<Uint8Array> {
		const path = uri.toString();
		const content = this.files.get(path);
		if (!content) {
			throw new Error(`File not found: ${path}`);
		}
		return content;
	}

	async readDirectory(uri: URI): Promise<[string, FileType][]> {
		const path = uri.toString();
		return this.directories.get(path) ?? [];
	}

	// Test helpers
	setFile(uri: URI, content: string): void {
		this.files.set(uri.toString(), new TextEncoder().encode(content));
	}

	setDirectory(uri: URI, entries: [string, FileType][]): void {
		this.directories.set(uri.toString(), entries);
	}

	clear(): void {
		this.files.clear();
		this.directories.clear();
	}
}

describe('ClaudeCommandService', () => {
	let service: ClaudeCommandService;
	let mockFs: MockFileSystemService;

	beforeEach(() => {
		mockFs = new MockFileSystemService();
		service = new ClaudeCommandService(mockFs as any);
		mockWorkspaceFolders = [];
	});

	describe('getAvailableCommands', () => {
		it('should return empty array when no workspace folders', async () => {
			const commands = await service.getAvailableCommands();
			expect(commands).toEqual([]);
		});

		it('should discover commands from .claude/commands directory', async () => {
			// Set up mock file system with commands directory
			const workspaceRoot = URI.file('/test/workspace');
			const commandsDir = URI.joinPath(workspaceRoot, '.claude', 'commands');

			// Set workspace folders
			mockWorkspaceFolders = [{ uri: workspaceRoot }];

			// Create the commands directory
			mockFs.setDirectory(commandsDir, [
				['agent.md', FileType.File],
				['architect.md', FileType.File],
				['custom-task.md', FileType.File],
			]);

			// Set up command files
			mockFs.setFile(
				URI.joinPath(commandsDir, 'agent.md'),
				`---
name: agent
description: Use the default agent
---
You are the default agent.`
			);

			mockFs.setFile(
				URI.joinPath(commandsDir, 'architect.md'),
				`---
name: architect
description: Use the architect agent for system design
---
You are the architect agent.`
			);

			mockFs.setFile(
				URI.joinPath(commandsDir, 'custom-task.md'),
				`Run a custom task for the project.`
			);

			const commands = await service.getAvailableCommands();
			expect(commands.length).toBe(3);
			expect(commands.map(c => c.name)).toContain('agent');
			expect(commands.map(c => c.name)).toContain('architect');
			expect(commands.map(c => c.name)).toContain('custom-task');

			// Check description parsing from frontmatter
			const architectCmd = commands.find(c => c.name === 'architect');
			expect(architectCmd?.description).toBe('Use the architect agent for system design');

			// Check description fallback for file without frontmatter
			const customCmd = commands.find(c => c.name === 'custom-task');
			expect(customCmd?.description).toBe('Run a custom task for the project.');
		});
	});

	describe('getCommand', () => {
		it('should return specific command by name', async () => {
			const workspaceRoot = URI.file('/test/workspace');
			const commandsDir = URI.joinPath(workspaceRoot, '.claude', 'commands');

			// Set workspace folders
			mockWorkspaceFolders = [{ uri: workspaceRoot }];

			mockFs.setDirectory(commandsDir, [
				['architect.md', FileType.File],
			]);

			mockFs.setFile(
				URI.joinPath(commandsDir, 'architect.md'),
				`---
description: Architecture planning agent
---
You plan architecture.`
			);

			const command = await service.getCommand('architect');
			expect(command).toBeDefined();
			expect(command?.name).toBe('architect');
			expect(command?.description).toBe('Architecture planning agent');
		});

		it('should return undefined for non-existent command', async () => {
			const command = await service.getCommand('non-existent');
			expect(command).toBeUndefined();
		});
	});

	describe('getCommandContent', () => {
		it('should return full content of command file', async () => {
			const workspaceRoot = URI.file('/test/workspace');
			const commandsDir = URI.joinPath(workspaceRoot, '.claude', 'commands');
			const content = `---
description: Test command
---
This is the full content of the command.`;

			// Set workspace folders
			mockWorkspaceFolders = [{ uri: workspaceRoot }];

			mockFs.setDirectory(commandsDir, [
				['test.md', FileType.File],
			]);

			mockFs.setFile(URI.joinPath(commandsDir, 'test.md'), content);

			const commandContent = await service.getCommandContent('test');
			expect(commandContent).toBe(content);
		});

		it('should return undefined for non-existent command', async () => {
			const content = await service.getCommandContent('non-existent');
			expect(content).toBeUndefined();
		});
	});

	describe('clearCache', () => {
		it('should clear cached commands', async () => {
			const workspaceRoot = URI.file('/test/workspace');
			const commandsDir = URI.joinPath(workspaceRoot, '.claude', 'commands');

			// Set workspace folders
			mockWorkspaceFolders = [{ uri: workspaceRoot }];

			mockFs.setDirectory(commandsDir, [
				['initial.md', FileType.File],
			]);

			mockFs.setFile(URI.joinPath(commandsDir, 'initial.md'), 'Initial command');

			// First call caches results
			let commands = await service.getAvailableCommands();
			expect(commands.length).toBe(1);

			// Add a new command
			mockFs.setDirectory(commandsDir, [
				['initial.md', FileType.File],
				['new-command.md', FileType.File],
			]);
			mockFs.setFile(URI.joinPath(commandsDir, 'new-command.md'), 'New command');

			// Without clearing cache, still returns old result
			commands = await service.getAvailableCommands();
			expect(commands.length).toBe(1);

			// Clear cache and get fresh results
			service.clearCache();
			commands = await service.getAvailableCommands();
			expect(commands.length).toBe(2);
		});
	});

	describe('formatCommandsForPrompt', () => {
		it('should format commands as markdown', () => {
			const commands = [
				{
					name: 'agent',
					description: 'Default agent',
					source: 'repo' as const,
					path: '/path/to/agent.md',
				},
				{
					name: 'architect',
					description: 'Architecture agent',
					source: 'repo' as const,
					path: '/path/to/architect.md',
				},
			];

			const result = formatCommandsForPrompt(commands);

			expect(result).toContain('## Available Commands');
			expect(result).toContain('/agent');
			expect(result).toContain('Default agent');
			expect(result).toContain('/architect');
			expect(result).toContain('Architecture agent');
		});
	});
});
