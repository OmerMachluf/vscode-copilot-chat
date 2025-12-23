/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';

/**
 * Represents a workspace folder in the API response
 */
export interface WorkspaceFolderInfo {
	readonly uri: string;
	readonly name: string;
	readonly index: number;
}

/**
 * Represents the current workspace state
 */
export interface WorkspaceState {
	readonly name: string | undefined;
	readonly workspaceFile: string | undefined;
	readonly folders: readonly WorkspaceFolderInfo[];
}

/**
 * Represents a recent folder entry
 */
export interface RecentFolderInfo {
	readonly uri: string;
	readonly label?: string;
}

/**
 * Request body for opening a workspace
 */
export interface OpenWorkspaceRequest {
	readonly folder: string;
	readonly newWindow?: boolean;
}

/**
 * Response for open workspace operation
 */
export interface OpenWorkspaceResponse {
	readonly success: boolean;
	readonly message: string;
}

export const IWorkspacesRouteService = createServiceIdentifier<IWorkspacesRouteService>('IWorkspacesRouteService');

/**
 * Service interface for workspace-related HTTP API routes
 */
export interface IWorkspacesRouteService {
	readonly _serviceBrand: undefined;

	/**
	 * GET /api/workspaces
	 * Returns the current workspace state including all open workspace folders
	 */
	getWorkspaces(): WorkspaceState;

	/**
	 * GET /api/workspaces/recent
	 * Returns recently opened folders
	 */
	getRecentWorkspaces(): Promise<RecentFolderInfo[]>;

	/**
	 * POST /api/workspaces
	 * Opens a workspace folder
	 */
	openWorkspace(request: OpenWorkspaceRequest): Promise<OpenWorkspaceResponse>;
}

/**
 * Implementation of the workspaces route service
 * Integrates with VS Code workspace APIs to provide workspace management
 */
export class WorkspacesRouteService implements IWorkspacesRouteService {

	declare _serviceBrand: undefined;

	/**
	 * Gets the current workspace state including all open folders
	 */
	getWorkspaces(): WorkspaceState {
		const folders = vscode.workspace.workspaceFolders ?? [];

		const folderInfos: WorkspaceFolderInfo[] = folders.map(folder => ({
			uri: folder.uri.toString(),
			name: folder.name,
			index: folder.index
		}));

		return {
			name: vscode.workspace.name,
			workspaceFile: vscode.workspace.workspaceFile?.toString(),
			folders: folderInfos
		};
	}

	/**
	 * Gets recently opened workspaces using VS Code's recent files API
	 */
	async getRecentWorkspaces(): Promise<RecentFolderInfo[]> {
		// Use the vscode.executeCommand to get recent files
		// The 'workbench.action.openRecent' provides access to recent entries
		// but we use '_workbench.getRecentlyOpened' internal command for programmatic access
		try {
			const recentlyOpened = await vscode.commands.executeCommand<{
				workspaces: Array<{ folderUri?: vscode.Uri; workspace?: { configPath: vscode.Uri }; label?: string }>;
			}>('_workbench.getRecentlyOpened');

			if (!recentlyOpened?.workspaces) {
				return [];
			}

			return recentlyOpened.workspaces
				.filter(entry => entry.folderUri || entry.workspace?.configPath)
				.map(entry => ({
					uri: (entry.folderUri ?? entry.workspace?.configPath)?.toString() ?? '',
					label: entry.label
				}))
				.filter(entry => entry.uri.length > 0);
		} catch {
			// Fallback: return empty array if command not available
			return [];
		}
	}

	/**
	 * Opens a workspace folder
	 * @param request The request containing the folder URI to open
	 */
	async openWorkspace(request: OpenWorkspaceRequest): Promise<OpenWorkspaceResponse> {
		if (!request.folder) {
			return {
				success: false,
				message: 'Folder path is required'
			};
		}

		try {
			const folderUri = vscode.Uri.parse(request.folder);

			// Check if the folder exists using the file system
			try {
				const stat = await vscode.workspace.fs.stat(folderUri);
				if (stat.type !== vscode.FileType.Directory) {
					return {
						success: false,
						message: 'Path is not a directory'
					};
				}
			} catch {
				return {
					success: false,
					message: 'Folder does not exist or is not accessible'
				};
			}

			// Use vscode.openFolder command to open the workspace
			// The second parameter controls whether to open in a new window
			await vscode.commands.executeCommand(
				'vscode.openFolder',
				folderUri,
				{ forceNewWindow: request.newWindow ?? false }
			);

			return {
				success: true,
				message: `Opening workspace: ${request.folder}`
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
			return {
				success: false,
				message: `Failed to open workspace: ${errorMessage}`
			};
		}
	}
}
