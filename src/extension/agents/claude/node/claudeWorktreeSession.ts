/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../../util/common/services';
import { Disposable, DisposableMap, IDisposable } from '../../../../util/vs/base/common/lifecycle';
import { URI } from '../../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { ILanguageModelServerConfig } from '../../node/langModelServer';

/**
 * Interface for a Claude code session that can be used with worktrees.
 * This avoids circular dependency with claudeCodeAgent.ts.
 */
export interface IClaudeCodeSession extends IDisposable {
	readonly sessionId: string | undefined;
	invoke(
		prompt: string,
		toolInvocationToken: vscode.ChatParticipantToolToken,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<void>;
}

/**
 * Configuration for creating a worktree-scoped Claude session
 */
export interface IWorktreeSessionConfig {
	/** The absolute path to the worktree directory */
	readonly worktreePath: string;
	/** Language model server configuration */
	readonly serverConfig: ILanguageModelServerConfig;
	/** Optional session ID to resume */
	readonly sessionId?: string;
}

/**
 * Service identifier for the Claude Worktree Session Manager
 */
export const IClaudeWorktreeSessionManager = createServiceIdentifier<IClaudeWorktreeSessionManager>('IClaudeWorktreeSessionManager');

/**
 * Interface for managing worktree-scoped Claude sessions
 */
export interface IClaudeWorktreeSessionManager {
	readonly _serviceBrand: undefined;

	/**
	 * Gets or creates a session for the specified worktree path
	 */
	getOrCreateSession(worktreePath: string): Promise<ClaudeWorktreeSession>;

	/**
	 * Gets an existing session for a worktree path
	 */
	getSession(worktreePath: string): ClaudeWorktreeSession | undefined;

	/**
	 * Removes and disposes a worktree session
	 */
	removeSession(worktreePath: string): boolean;

	/**
	 * Gets all active worktree paths
	 */
	getActiveWorktreePaths(): readonly string[];
}

/**
 * Wraps a ClaudeCodeSession with worktree-specific context.
 * Ensures file operations are scoped to the worktree directory.
 */
export class ClaudeWorktreeSession extends Disposable {
	private _isActive = true;

	constructor(
		public readonly session: IClaudeCodeSession,
		public readonly worktreePath: string,
		private readonly _worktreeUri: URI
	) {
		super();

		// Register cleanup when session is disposed
		this._register(session);
	}

	/**
	 * Gets the session ID from the underlying Claude session
	 */
	public get sessionId(): string | undefined {
		return this.session.sessionId;
	}

	/**
	 * Gets the worktree path as a URI
	 */
	public get worktreeUri(): URI {
		return this._worktreeUri;
	}

	/**
	 * Checks if the session is still active
	 */
	public get isActive(): boolean {
		return this._isActive && !this._store.isDisposed;
	}

	/**
	 * Validates that a file path is within the worktree boundary
	 */
	public isPathWithinBoundary(filePath: string): boolean {
		const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
		const normalizedWorktree = this.worktreePath.replace(/\\/g, '/').toLowerCase();
		return normalizedPath.startsWith(normalizedWorktree);
	}

	/**
	 * Validates that a URI is within the worktree boundary
	 */
	public isUriWithinBoundary(uri: URI): boolean {
		return this.isPathWithinBoundary(uri.fsPath);
	}

	/**
	 * Marks the session as inactive (e.g., when worktree is removed)
	 */
	public markInactive(): void {
		this._isActive = false;
	}

	public override dispose(): void {
		this._isActive = false;
		super.dispose();
	}
}

/**
 * Interface for a factory that creates worktree sessions.
 * The actual implementation lives in claudeCodeAgent.ts to avoid circular dependencies.
 */
export interface IWorktreeSessionFactory {
	createSession(config: IWorktreeSessionConfig): ClaudeWorktreeSession;
}

/**
 * Manages multiple worktree-scoped Claude sessions.
 * Provides session lifecycle management and lookup by worktree path.
 */
export class ClaudeWorktreeSessionManager extends Disposable implements IClaudeWorktreeSessionManager {
	declare readonly _serviceBrand: undefined;

	private readonly _sessions = this._register(new DisposableMap<string, ClaudeWorktreeSession>());
	private _sessionFactory: IWorktreeSessionFactory | undefined;
	private _serverConfigResolver: (() => Promise<ILanguageModelServerConfig>) | undefined;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super();
	}

	/**
	 * Sets the factory for creating worktree sessions.
	 * This should be called during initialization with a factory from claudeCodeAgent.ts.
	 */
	public setSessionFactory(factory: IWorktreeSessionFactory): void {
		this._sessionFactory = factory;
	}

	/**
	 * Sets the resolver for getting server configuration.
	 * This should be called during initialization.
	 */
	public setServerConfigResolver(resolver: () => Promise<ILanguageModelServerConfig>): void {
		this._serverConfigResolver = resolver;
	}

	/**
	 * Gets or creates a session for the specified worktree path
	 */
	public async getOrCreateSession(worktreePath: string): Promise<ClaudeWorktreeSession> {
		const normalizedPath = this._normalizeWorktreePath(worktreePath);

		// Check for existing active session
		const existing = this._sessions.get(normalizedPath);
		if (existing && existing.isActive) {
			return existing;
		}

		// Require factory to be set
		if (!this._sessionFactory) {
			throw new Error('Session factory not set. Call setSessionFactory first.');
		}

		// Require server config resolver
		if (!this._serverConfigResolver) {
			throw new Error('Server config resolver not set. Call setServerConfigResolver first.');
		}

		const serverConfig = await this._serverConfigResolver();

		const config: IWorktreeSessionConfig = {
			worktreePath,
			serverConfig,
		};

		const session = this._sessionFactory.createSession(config);
		this._sessions.set(normalizedPath, session);

		return session;
	}

	/**
	 * Gets an existing session for a worktree path
	 */
	public getSession(worktreePath: string): ClaudeWorktreeSession | undefined {
		const normalizedPath = this._normalizeWorktreePath(worktreePath);
		const session = this._sessions.get(normalizedPath);
		return session?.isActive ? session : undefined;
	}

	/**
	 * Removes and disposes a worktree session
	 */
	public removeSession(worktreePath: string): boolean {
		const normalizedPath = this._normalizeWorktreePath(worktreePath);
		const session = this._sessions.get(normalizedPath);

		if (session) {
			this._sessions.deleteAndDispose(normalizedPath);
			return true;
		}

		return false;
	}

	/**
	 * Gets all active worktree paths with sessions
	 */
	public getActiveWorktreePaths(): readonly string[] {
		const paths: string[] = [];
		for (const [path, session] of this._sessions) {
			if (session.isActive) {
				paths.push(path);
			}
		}
		return paths;
	}

	/**
	 * Normalizes a worktree path for use as a map key
	 */
	private _normalizeWorktreePath(path: string): string {
		return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
	}
}
