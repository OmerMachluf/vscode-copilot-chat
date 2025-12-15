/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from 'vscode';
import { IInstantiationService } from '../../util/vs/platform/instantiation/common/instantiation';
import { IClaudeMigrationService, MigrationStatus } from './claudeMigrationService';

/**
 * Command ID for regenerating Claude configuration files
 */
export const REGENERATE_CLAUDE_CONFIG_COMMAND = 'github.copilot.orchestrator.regenerateClaudeConfig';

/**
 * Registers VS Code commands for Claude migration functionality
 */
export class ClaudeMigrationCommands extends Disposable {
	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super(() => this.dispose());
		this.registerCommands();
	}

	private registerCommands(): void {
		// Register command for manual re-migration
		const regenerateCommand = vscode.commands.registerCommand(
			REGENERATE_CLAUDE_CONFIG_COMMAND,
			async () => {
				try {
					const migrationService = this.instantiationService.invokeFunction(
						accessor => accessor.get(IClaudeMigrationService)
					);

					await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: 'Regenerating Claude Configuration...',
							cancellable: true
						},
						async (progress, _token) => {
							progress.report({ message: 'Gathering agent definitions...' });

							const result = await migrationService.regenerate();

							if (result.status === MigrationStatus.Completed) {
								const fileList = result.generatedFiles
									.map(uri => vscode.workspace.asRelativePath(uri))
									.join(', ');

								vscode.window.showInformationMessage(
									`Claude configuration regenerated successfully. Generated files: ${fileList}`
								);
							} else if (result.status === MigrationStatus.Failed) {
								vscode.window.showErrorMessage(
									`Failed to regenerate Claude configuration: ${result.error || 'Unknown error'}`
								);
							} else if (result.status === MigrationStatus.NotNeeded) {
								vscode.window.showInformationMessage(
									'No workspace folder found. Claude configuration cannot be generated.'
								);
							}
						}
					);
				} catch (error) {
					vscode.window.showErrorMessage(
						`Error regenerating Claude configuration: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
		);

		// Add to disposables
		this._disposables.push(regenerateCommand);
	}

	private _disposables: vscode.Disposable[] = [];

	override dispose(): void {
		for (const disposable of this._disposables) {
			disposable.dispose();
		}
		this._disposables = [];
	}
}

/**
 * Activates the Claude migration commands
 */
export function activateClaudeMigrationCommands(
	context: vscode.ExtensionContext,
	instantiationService: IInstantiationService
): void {
	const commands = instantiationService.createInstance(ClaudeMigrationCommands);
	context.subscriptions.push(commands);
}
