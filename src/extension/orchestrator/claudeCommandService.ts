/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IFileSystemService } from '../../platform/filesystem/common/fileSystemService';
import { FileType } from '../../platform/filesystem/common/fileTypes';
import { Emitter, Event } from '../../util/vs/base/common/event';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { URI } from '../../util/vs/base/common/uri';
import { createDecorator } from '../../util/vs/platform/instantiation/common/instantiation';

export const IClaudeCommandService = createDecorator<IClaudeCommandService>('claudeCommandService');

/**
 * Information about a Claude Code command
 */
export interface ClaudeCommandInfo {
	/** Command name (e.g., 'agent', 'architect') */
	name: string;
	/** Human-readable description from frontmatter */
	description: string;
	/** Source of the command definition */
	source: 'builtin' | 'repo';
	/** Full path to the command file */
	path: string;
	/** Full content of the command file (for passing to Claude) */
	content?: string;
}

export interface IClaudeCommandService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when commands change (file added/removed/modified)
	 */
	readonly onDidChangeCommands: Event<void>;

	/**
	 * Get all available Claude commands.
	 * Results are cached until files change.
	 */
	getAvailableCommands(): Promise<ClaudeCommandInfo[]>;

	/**
	 * Get a specific command by name.
	 */
	getCommand(commandName: string): Promise<ClaudeCommandInfo | undefined>;

	/**
	 * Get the full content of a command file.
	 */
	getCommandContent(commandName: string): Promise<string | undefined>;

	/**
	 * Clear the cached command list.
	 */
	clearCache(): void;

	/**
	 * Initialize file watchers for the .claude/commands directory.
	 */
	initialize(): void;
}

const CLAUDE_COMMANDS_DIR = '.claude/commands';

export class ClaudeCommandService extends Disposable implements IClaudeCommandService {
	declare readonly _serviceBrand: undefined;

	private _cachedCommands: ClaudeCommandInfo[] | undefined;
	private _cacheTimestamp = 0;
	private readonly _cacheTtlMs = 30000; // 30 seconds
	private _fileWatcher: vscode.FileSystemWatcher | undefined;

	private readonly _onDidChangeCommands = this._register(new Emitter<void>());
	public readonly onDidChangeCommands: Event<void> = this._onDidChangeCommands.event;

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
	) {
		super();
	}

	initialize(): void {
		// Set up file watcher for .claude/commands directory
		const pattern = `**/${CLAUDE_COMMANDS_DIR}/**/*.md`;
		this._fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

		const triggerRefresh = () => {
			this.clearCache();
			this._onDidChangeCommands.fire();
		};

		this._fileWatcher.onDidCreate(triggerRefresh);
		this._fileWatcher.onDidChange(triggerRefresh);
		this._fileWatcher.onDidDelete(triggerRefresh);

		this._register(this._fileWatcher);
	}

	async getAvailableCommands(): Promise<ClaudeCommandInfo[]> {
		// Check cache
		const now = Date.now();
		if (this._cachedCommands && (now - this._cacheTimestamp) < this._cacheTtlMs) {
			return this._cachedCommands;
		}

		const commands: ClaudeCommandInfo[] = [];
		const workspaceFolders = vscode.workspace.workspaceFolders;

		if (!workspaceFolders?.length) {
			return commands;
		}

		for (const folder of workspaceFolders) {
			const commandsDir = URI.joinPath(folder.uri, CLAUDE_COMMANDS_DIR);

			try {
				// Check if the directory exists
				const stat = await this.fileSystemService.stat(commandsDir);
				if (stat.type !== FileType.Directory) {
					continue;
				}

				const entries = await this.fileSystemService.readDirectory(commandsDir);

				for (const [name, type] of entries) {
					if (type === FileType.File && name.endsWith('.md')) {
						const commandName = name.replace('.md', '');
						const filePath = URI.joinPath(commandsDir, name);
						const content = await this._readFileAsString(filePath);

						if (content) {
							const parsed = this._parseCommandFile(content);
							commands.push({
								name: commandName,
								description: parsed.description || `Use the /${commandName} command`,
								source: 'repo',
								path: filePath.toString(),
								content,
							});
						}
					}
				}
			} catch {
				// .claude/commands folder might not exist
			}
		}

		this._cachedCommands = commands;
		this._cacheTimestamp = now;

		return this._cachedCommands;
	}

	async getCommand(commandName: string): Promise<ClaudeCommandInfo | undefined> {
		const commands = await this.getAvailableCommands();
		return commands.find(c => c.name === commandName);
	}

	async getCommandContent(commandName: string): Promise<string | undefined> {
		const command = await this.getCommand(commandName);
		if (!command) {
			return undefined;
		}

		// If we have cached content, return it
		if (command.content) {
			return command.content;
		}

		// Otherwise read the file
		return this._readFileAsString(URI.parse(command.path));
	}

	clearCache(): void {
		this._cachedCommands = undefined;
		this._cacheTimestamp = 0;
	}

	/**
	 * Parse a command markdown file to extract frontmatter description
	 */
	private _parseCommandFile(content: string): { description?: string } {
		// Check for YAML frontmatter
		const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
		if (!frontmatterMatch) {
			// Try to extract description from first line or first sentence
			const firstLine = content.trim().split('\n')[0];
			if (firstLine && !firstLine.startsWith('#')) {
				return { description: firstLine.substring(0, 100) };
			}
			return {};
		}

		const frontmatter = frontmatterMatch[1];

		// Simple YAML parsing for description field
		const descMatch = frontmatter.match(/description:\s*(.+)/);
		if (descMatch) {
			return { description: descMatch[1].trim() };
		}

		return {};
	}

	private async _readFileAsString(uri: URI): Promise<string | undefined> {
		try {
			const buffer = await this.fileSystemService.readFile(uri);
			return new TextDecoder().decode(buffer);
		} catch {
			return undefined;
		}
	}
}

/**
 * Format commands for display in autocomplete or help
 */
export function formatCommandsForPrompt(commands: ClaudeCommandInfo[]): string {
	const lines: string[] = ['## Available Commands\n'];

	for (const command of commands) {
		lines.push(`### /${command.name}`);
		lines.push(`- **Description:** ${command.description}`);
		lines.push(`- **Source:** ${command.source}`);
		lines.push('');
	}

	return lines.join('\n');
}
