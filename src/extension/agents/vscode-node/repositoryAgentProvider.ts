/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { FileType } from '../../../platform/filesystem/common/fileTypes';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { URI } from '../../../util/vs/base/common/uri';

const AgentFileExtension = '.agent.md';

/**
 * Provides custom agents discovered from the repository's .github/agents/ directory.
 * These agents appear in VS Code's agent picker without needing package.json declarations.
 */
export class RepositoryAgentProvider extends Disposable implements vscode.CustomAgentsProvider {

	private readonly _onDidChangeCustomAgents = this._register(new vscode.EventEmitter<void>());
	readonly onDidChangeCustomAgents = this._onDidChangeCustomAgents.event;

	private agentsCache: vscode.CustomAgentResource[] | undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IFileSystemService private readonly fileSystem: IFileSystemService,
	) {
		super();

		// Set up file watcher to refresh when agents change
		this.setupFileWatcher();

		// Initial scan
		this.refreshAgents().catch(error => {
			this.logService.error(`[RepositoryAgentProvider] Error in initial scan: ${error}`);
		});
	}

	private setupFileWatcher(): void {
		// Watch .github/agents directory for changes
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders?.length) {
			return;
		}

		for (const folder of workspaceFolders) {
			const agentsPattern = new vscode.RelativePattern(folder, '.github/agents/**/*.agent.md');
			const watcher = vscode.workspace.createFileSystemWatcher(agentsPattern);

			this._register(watcher.onDidCreate(() => this.onAgentsChanged()));
			this._register(watcher.onDidChange(() => this.onAgentsChanged()));
			this._register(watcher.onDidDelete(() => this.onAgentsChanged()));
			this._register(watcher);
		}
	}

	private onAgentsChanged(): void {
		this.logService.info('[RepositoryAgentProvider] Agent files changed, refreshing...');
		this.agentsCache = undefined; // Clear cache
		this._onDidChangeCustomAgents.fire(); // Notify VS Code to refresh
	}

	async provideCustomAgents(
		_options: vscode.CustomAgentQueryOptions,
		_token: vscode.CancellationToken
	): Promise<vscode.CustomAgentResource[]> {
		// Return cached agents if available
		if (this.agentsCache) {
			return this.agentsCache;
		}

		// Scan and cache
		await this.refreshAgents();
		return this.agentsCache || [];
	}

	private async refreshAgents(): Promise<void> {
		try {
			const agents: vscode.CustomAgentResource[] = [];
			const workspaceFolders = vscode.workspace.workspaceFolders;

			if (!workspaceFolders?.length) {
				this.logService.info('[RepositoryAgentProvider] No workspace folders found');
				this.agentsCache = agents;
				return;
			}

			for (const folder of workspaceFolders) {
				const agentsDir = URI.joinPath(folder.uri, '.github', 'agents');
				await this.scanAgentsDirectory(agentsDir, agents);
			}

			this.logService.info(`[RepositoryAgentProvider] Discovered ${agents.length} repository agents: ${agents.map(a => a.name).join(', ')}`);
			this.agentsCache = agents;
		} catch (error) {
			this.logService.error(`[RepositoryAgentProvider] Error refreshing agents: ${error}`);
			this.agentsCache = [];
		}
	}

	private async scanAgentsDirectory(agentsDir: URI, agents: vscode.CustomAgentResource[]): Promise<void> {
		try {
			const stat = await this.fileSystem.stat(agentsDir);
			if (stat.type !== FileType.Directory) {
				return;
			}

			const entries = await this.fileSystem.readDirectory(agentsDir);

			for (const [name, type] of entries) {
				if (type === FileType.Directory) {
					// Scan subdirectory for {name}.agent.md
					const subdir = URI.joinPath(agentsDir, name);
					await this.scanAgentSubdirectory(subdir, agents);
				} else if (type === FileType.File && name.endsWith(AgentFileExtension)) {
					// Direct file: .github/agents/*.agent.md
					const fileUri = URI.joinPath(agentsDir, name);
					const agent = await this.parseAgentFile(fileUri);
					if (agent) {
						agents.push(agent);
					}
				}
			}
		} catch (error) {
			// .github/agents folder doesn't exist or other error
			this.logService.trace(`[RepositoryAgentProvider] Agents directory ${agentsDir.fsPath} not accessible: ${error}`);
		}
	}

	private async scanAgentSubdirectory(subdir: URI, agents: vscode.CustomAgentResource[]): Promise<void> {
		try {
			const entries = await this.fileSystem.readDirectory(subdir);

			for (const [name, type] of entries) {
				if (type === FileType.File && name.endsWith(AgentFileExtension)) {
					const fileUri = URI.joinPath(subdir, name);
					const agent = await this.parseAgentFile(fileUri);
					if (agent) {
						agents.push(agent);
					}
				}
			}
		} catch (error) {
			this.logService.trace(`[RepositoryAgentProvider] Subdirectory ${subdir.fsPath} not accessible: ${error}`);
		}
	}

	private async parseAgentFile(fileUri: URI): Promise<vscode.CustomAgentResource | null> {
		try {
			const content = await this.fileSystem.readFile(fileUri);
			const text = new TextDecoder().decode(content);

			// Parse YAML frontmatter
			const frontmatterMatch = text.match(/^---\s*\n([\s\S]*?)\n---/);
			if (!frontmatterMatch) {
				this.logService.warn(`[RepositoryAgentProvider] No frontmatter found in ${fileUri.fsPath}`);
				return null;
			}

			const frontmatter = frontmatterMatch[1];
			const nameMatch = frontmatter.match(/name:\s*(.+)/);
			const descMatch = frontmatter.match(/description:\s*(.+)/);

			if (!nameMatch) {
				this.logService.warn(`[RepositoryAgentProvider] No name in frontmatter of ${fileUri.fsPath}`);
				return null;
			}

			const name = nameMatch[1].trim();
			const description = descMatch ? descMatch[1].trim() : '';

			return {
				name,
				description,
				uri: vscode.Uri.file(fileUri.fsPath),
			};
		} catch (error) {
			this.logService.error(`[RepositoryAgentProvider] Error parsing ${fileUri.fsPath}: ${error}`);
			return null;
		}
	}
}
