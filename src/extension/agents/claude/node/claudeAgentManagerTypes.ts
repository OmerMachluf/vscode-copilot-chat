/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../../util/common/services';
import { ClaudeWorktreeSession } from './claudeWorktreeSession';

/**
 * Service identifier for the Claude Agent Manager
 */
export const IClaudeAgentManager = createServiceIdentifier<IClaudeAgentManager>('IClaudeAgentManager');

/**
 * Interface for the Claude Agent Manager
 */
export interface IClaudeAgentManager {
	readonly _serviceBrand: undefined;

	/**
	 * Handles a chat request, optionally within a specific worktree context
	 */
	handleRequest(
		claudeSessionId: string | undefined,
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
		worktreePath?: string
	): Promise<vscode.ChatResult & { claudeSessionId?: string }>;

	/**
	 * Gets or creates a session for the specified worktree path
	 * If no worktree path is provided, returns the main workspace session
	 */
	getOrCreateWorktreeSession(worktreePath: string): Promise<ClaudeWorktreeSession>;

	/**
	 * Removes and cleans up a worktree session
	 */
	removeWorktreeSession(worktreePath: string): boolean;

	/**
	 * Gets all active worktree paths with sessions
	 */
	getActiveWorktreePaths(): readonly string[];
}
