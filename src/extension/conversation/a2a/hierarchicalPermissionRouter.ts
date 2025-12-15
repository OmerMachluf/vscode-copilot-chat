/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { ILogService } from '../../../platform/log/common/logService';
import { createServiceIdentifier } from '../../../util/common/services';
import { IWorkerContext, IWorkerOwnerContext } from '../../orchestrator/workerToolsService';
import { IOrchestratorQueueService, IOrchestratorQueueMessage } from '../../orchestrator/orchestratorQueue';
import { generateUuid } from '../../../util/vs/base/common/uuid';

/**
 * Permission request that can be routed through hierarchy.
 */
export interface IHierarchicalPermissionRequest {
	/** Unique request ID */
	id: string;
	/** Worker ID that originated the request */
	originWorkerId: string;
	/** Worker depth level */
	originDepth: number;
	/** The permission kind (read, write, shell, mcp, etc.) */
	kind: string;
	/** The action being requested */
	action: string;
	/** Target resource (file path, command, etc.) */
	target?: string;
	/** Additional context for the parent to make decisions */
	context: Record<string, unknown>;
	/** Whether this is a sensitive operation */
	isSensitive: boolean;
	/** Timeout for response (ms) */
	timeout: number;
	/** Timestamp when created */
	createdAt: number;
}

/**
 * Decision made by a parent in the hierarchy.
 */
export interface IHierarchicalPermissionDecision {
	/** The request ID */
	requestId: string;
	/** The decision */
	decision: 'approve' | 'deny' | 'escalate';
	/** Who made the decision */
	decidedBy: 'parent' | 'orchestrator' | 'user' | 'auto-policy';
	/** Reason for the decision */
	reason?: string;
	/** Whether to remember this decision for similar requests */
	remember?: 'session' | 'always' | 'never';
}

/**
 * Auto-approval policy for parent agents.
 */
export interface IParentAutoApprovalPolicy {
	/** File patterns that are safe to auto-approve for read */
	safeReadPatterns: string[];
	/** File patterns that are safe to auto-approve for write (within worktree) */
	safeWritePatternsInWorktree: string[];
	/** Commands that are safe to auto-approve */
	safeCommands: string[];
	/** Maximum file size for auto-approve (bytes) */
	maxAutoApproveFileSize?: number;
}

/**
 * Default auto-approval policy for parent agents.
 */
const DEFAULT_PARENT_POLICY: IParentAutoApprovalPolicy = {
	safeReadPatterns: [
		'**/*.ts', '**/*.js', '**/*.json', '**/*.md', '**/*.txt',
		'**/*.yaml', '**/*.yml', '**/*.toml', '**/*.css', '**/*.scss',
		'**/*.html', '**/*.xml', '**/*.svg', '**/package.json',
		'**/tsconfig.json', '**/*.config.js', '**/*.config.ts',
	],
	safeWritePatternsInWorktree: [
		'**/*.ts', '**/*.js', '**/*.json', '**/*.md', '**/*.txt',
		'**/*.yaml', '**/*.yml', '**/*.css', '**/*.scss', '**/*.html',
	],
	safeCommands: [
		'git status', 'git diff', 'git log', 'git show', 'git branch',
		'npm test', 'npm run test', 'npm run build', 'npm run lint',
		'yarn test', 'yarn build', 'yarn lint',
		'pnpm test', 'pnpm build', 'pnpm lint',
		'tsc --noEmit', 'eslint', 'prettier',
	],
};

export const IHierarchicalPermissionRouter = createServiceIdentifier<IHierarchicalPermissionRouter>('IHierarchicalPermissionRouter');

/**
 * Events emitted by the permission router.
 */
export interface IPermissionRoutedEvent {
	request: IHierarchicalPermissionRequest;
	routedTo: 'parent' | 'orchestrator' | 'user';
}

export interface IPermissionDecisionEvent {
	request: IHierarchicalPermissionRequest;
	decision: IHierarchicalPermissionDecision;
}

/**
 * Service for routing permission requests through the agent hierarchy.
 */
export interface IHierarchicalPermissionRouter {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when a permission is routed.
	 */
	readonly onPermissionRouted: Event<IPermissionRoutedEvent>;

	/**
	 * Event fired when a decision is made.
	 */
	readonly onPermissionDecided: Event<IPermissionDecisionEvent>;

	/**
	 * Route a permission request through the hierarchy.
	 * @param request The permission request
	 * @param workerContext Context of the requesting worker
	 * @param fallbackToUser Callback to escalate to user if needed
	 * @param token Cancellation token
	 * @returns The decision
	 */
	routePermission(
		request: Omit<IHierarchicalPermissionRequest, 'id' | 'createdAt'>,
		workerContext: IWorkerContext,
		fallbackToUser: () => Promise<boolean>,
		token: CancellationToken
	): Promise<IHierarchicalPermissionDecision>;

	/**
	 * Handle a permission request as a parent agent.
	 * This is called when the orchestrator or parent worker receives a permission request.
	 * @param request The permission request from child
	 * @param policy Auto-approval policy to apply
	 * @returns Decision to approve, deny, or escalate
	 */
	handleAsParent(
		request: IHierarchicalPermissionRequest,
		policy?: IParentAutoApprovalPolicy
	): IHierarchicalPermissionDecision;

	/**
	 * Register a custom handler for permission requests received as a parent.
	 * @param handler The handler function
	 * @returns Disposable to unregister
	 */
	registerParentHandler(
		handler: (request: IHierarchicalPermissionRequest) => Promise<IHierarchicalPermissionDecision | undefined>
	): { dispose: () => void };

	/**
	 * Get pending permission requests for a specific parent.
	 * @param parentId The parent worker/orchestrator ID
	 */
	getPendingRequests(parentId: string): IHierarchicalPermissionRequest[];
}

/**
 * Implementation of hierarchical permission routing.
 */
export class HierarchicalPermissionRouter extends Disposable implements IHierarchicalPermissionRouter {
	declare readonly _serviceBrand: undefined;

	private readonly _onPermissionRouted = this._register(new Emitter<IPermissionRoutedEvent>());
	readonly onPermissionRouted = this._onPermissionRouted.event;

	private readonly _onPermissionDecided = this._register(new Emitter<IPermissionDecisionEvent>());
	readonly onPermissionDecided = this._onPermissionDecided.event;

	/** Pending requests awaiting parent response, keyed by request ID */
	private readonly _pendingRequests = new Map<string, {
		request: IHierarchicalPermissionRequest;
		parentId: string;
		resolve: (decision: IHierarchicalPermissionDecision) => void;
		timeoutHandle: ReturnType<typeof setTimeout>;
	}>();

	/** Custom parent handlers */
	private readonly _parentHandlers: Array<(request: IHierarchicalPermissionRequest) => Promise<IHierarchicalPermissionDecision | undefined>> = [];

	/** Session approvals remembered by parent */
	private readonly _sessionApprovals = new Map<string, 'approve' | 'deny'>();

	constructor(
		@IOrchestratorQueueService private readonly _queueService: IOrchestratorQueueService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Listen for permission responses from queue
		this._register(this._queueService.onMessageEnqueued((msg: IOrchestratorQueueMessage) => {
			if (msg.type === 'permission_response') {
				this._handlePermissionResponse(msg);
			}
		}));
	}

	async routePermission(
		requestData: Omit<IHierarchicalPermissionRequest, 'id' | 'createdAt'>,
		workerContext: IWorkerContext,
		fallbackToUser: () => Promise<boolean>,
		token: CancellationToken
	): Promise<IHierarchicalPermissionDecision> {
		const request: IHierarchicalPermissionRequest = {
			...requestData,
			id: generateUuid(),
			createdAt: Date.now(),
		};

		// Check session approvals first
		const sessionKey = this._getSessionKey(request);
		const sessionDecision = this._sessionApprovals.get(sessionKey);
		if (sessionDecision) {
			return {
				requestId: request.id,
				decision: sessionDecision,
				decidedBy: 'parent',
				reason: 'Previously approved in this session',
			};
		}

		// Determine routing based on hierarchy
		const owner = workerContext.owner;

		// If no parent (top-level agent), go directly to user
		if (!owner) {
			this._logService.debug(`[HierarchicalPermissionRouter] No parent for worker ${workerContext.workerId}, routing to user`);
			this._onPermissionRouted.fire({ request, routedTo: 'user' });
			const userApproved = await fallbackToUser();
			const decision: IHierarchicalPermissionDecision = {
				requestId: request.id,
				decision: userApproved ? 'approve' : 'deny',
				decidedBy: 'user',
			};
			this._onPermissionDecided.fire({ request, decision });
			return decision;
		}

		// Route to parent
		this._logService.debug(`[HierarchicalPermissionRouter] Routing permission to parent ${owner.ownerId} for worker ${workerContext.workerId}`);

		// First, try auto-approval based on policy
		const autoDecision = this.handleAsParent(request, DEFAULT_PARENT_POLICY);
		if (autoDecision.decision !== 'escalate') {
			this._onPermissionDecided.fire({ request, decision: autoDecision });
			if (autoDecision.remember === 'session') {
				this._sessionApprovals.set(sessionKey, autoDecision.decision);
			}
			return autoDecision;
		}

		// Send to parent via queue for manual decision
		this._onPermissionRouted.fire({ request, routedTo: owner.ownerType === 'orchestrator' ? 'orchestrator' : 'parent' });

		const parentDecision = await this._routeToParent(request, owner, fallbackToUser, token);
		this._onPermissionDecided.fire({ request, decision: parentDecision });

		if (parentDecision.remember === 'session' && parentDecision.decision !== 'escalate') {
			this._sessionApprovals.set(sessionKey, parentDecision.decision);
		}

		return parentDecision;
	}

	handleAsParent(
		request: IHierarchicalPermissionRequest,
		policy: IParentAutoApprovalPolicy = DEFAULT_PARENT_POLICY
	): IHierarchicalPermissionDecision {
		const target = request.target || '';

		// Note: Custom handlers are async and used for queue-based decisions
		// This method is sync and uses policy-based auto-approval only
		// Custom handlers are invoked via _routeToParent for async decisions

		// Read operations - check against safe patterns
		if (request.kind === 'read') {
			if (this._matchesAnyPattern(target, policy.safeReadPatterns)) {
				return {
					requestId: request.id,
					decision: 'approve',
					decidedBy: 'auto-policy',
					reason: 'Matches safe read pattern',
					remember: 'session',
				};
			}
		}

		// Write operations - only auto-approve within worktree and matching safe patterns
		if (request.kind === 'write') {
			const isInWorktree = request.context.isInWorktree as boolean | undefined;
			if (isInWorktree && this._matchesAnyPattern(target, policy.safeWritePatternsInWorktree)) {
				return {
					requestId: request.id,
					decision: 'approve',
					decidedBy: 'auto-policy',
					reason: 'Matches safe write pattern within worktree',
					remember: 'session',
				};
			}
		}

		// Shell commands - check against safe commands
		if (request.kind === 'shell') {
			const command = target.toLowerCase();
			if (policy.safeCommands.some(safe => command.startsWith(safe.toLowerCase()))) {
				return {
					requestId: request.id,
					decision: 'approve',
					decidedBy: 'auto-policy',
					reason: 'Matches safe command pattern',
					remember: 'session',
				};
			}
		}

		// If sensitive operation, escalate to user
		if (request.isSensitive) {
			return {
				requestId: request.id,
				decision: 'escalate',
				decidedBy: 'parent',
				reason: 'Sensitive operation requires user approval',
			};
		}

		// Default: escalate
		return {
			requestId: request.id,
			decision: 'escalate',
			decidedBy: 'parent',
			reason: 'No auto-approval policy matched',
		};
	}

	registerParentHandler(
		handler: (request: IHierarchicalPermissionRequest) => Promise<IHierarchicalPermissionDecision | undefined>
	): { dispose: () => void } {
		this._parentHandlers.push(handler);
		return {
			dispose: () => {
				const idx = this._parentHandlers.indexOf(handler);
				if (idx >= 0) {
					this._parentHandlers.splice(idx, 1);
				}
			},
		};
	}

	getPendingRequests(parentId: string): IHierarchicalPermissionRequest[] {
		return Array.from(this._pendingRequests.values())
			.filter(p => p.parentId === parentId)
			.map(p => p.request);
	}

	private async _routeToParent(
		request: IHierarchicalPermissionRequest,
		owner: IWorkerOwnerContext,
		fallbackToUser: () => Promise<boolean>,
		token: CancellationToken
	): Promise<IHierarchicalPermissionDecision> {
		return new Promise<IHierarchicalPermissionDecision>((resolve) => {
			// Set up timeout
			const timeoutHandle = setTimeout(() => {
				this._pendingRequests.delete(request.id);
				this._logService.debug(`[HierarchicalPermissionRouter] Permission request ${request.id} timed out, escalating to user`);
				// Timeout - escalate to user
				fallbackToUser().then(approved => {
					resolve({
						requestId: request.id,
						decision: approved ? 'approve' : 'deny',
						decidedBy: 'user',
						reason: 'Parent did not respond in time',
					});
				});
			}, request.timeout);

			// Track pending request
			this._pendingRequests.set(request.id, {
				request,
				parentId: owner.ownerId,
				resolve: (decision) => {
					clearTimeout(timeoutHandle);
					this._pendingRequests.delete(request.id);

					// If parent escalated, go to user
					if (decision.decision === 'escalate') {
						fallbackToUser().then(approved => {
							resolve({
								requestId: request.id,
								decision: approved ? 'approve' : 'deny',
								decidedBy: 'user',
								reason: 'Parent escalated to user',
							});
						});
					} else {
						resolve(decision);
					}
				},
				timeoutHandle,
			});

			// Send request to parent via queue
			this._queueService.enqueueMessage({
				id: generateUuid(),
				timestamp: Date.now(),
				priority: 'high',
				planId: request.context.planId as string || '',
				taskId: request.context.taskId as string || '',
				workerId: request.originWorkerId,
				worktreePath: request.context.worktreePath as string || '',
				type: 'permission_request',
				content: {
					permissionRequestId: request.id,
					kind: request.kind,
					action: request.action,
					target: request.target,
					context: request.context,
					isSensitive: request.isSensitive,
					originWorkerId: request.originWorkerId,
					originDepth: request.originDepth,
				},
			});

			// Handle cancellation
			token.onCancellationRequested(() => {
				const pending = this._pendingRequests.get(request.id);
				if (pending) {
					clearTimeout(pending.timeoutHandle);
					this._pendingRequests.delete(request.id);
					resolve({
						requestId: request.id,
						decision: 'deny',
						decidedBy: 'parent',
						reason: 'Request cancelled',
					});
				}
			});
		});
	}

	private _handlePermissionResponse(msg: IOrchestratorQueueMessage): void {
		const content = msg.content as {
			permissionRequestId: string;
			decision: 'approve' | 'deny' | 'escalate';
			reason?: string;
			remember?: 'session' | 'always' | 'never';
		};

		const pending = this._pendingRequests.get(content.permissionRequestId);
		if (pending) {
			this._logService.debug(`[HierarchicalPermissionRouter] Received decision for request ${content.permissionRequestId}: ${content.decision}`);
			pending.resolve({
				requestId: content.permissionRequestId,
				decision: content.decision,
				decidedBy: msg.workerId === 'orchestrator' ? 'orchestrator' : 'parent',
				reason: content.reason,
				remember: content.remember,
			});
		}
	}

	private _getSessionKey(request: IHierarchicalPermissionRequest): string {
		return `${request.kind}:${request.action}:${request.target || ''}`;
	}

	private _matchesAnyPattern(path: string, patterns: string[]): boolean {
		// Simple glob matching - for production, use a proper glob library
		for (const pattern of patterns) {
			if (pattern === '**/*') {
				return true;
			}
			if (pattern.startsWith('**/')) {
				const suffix = pattern.slice(3);
				if (suffix.startsWith('*.')) {
					// Extension match
					const ext = suffix.slice(1);
					if (path.endsWith(ext)) {
						return true;
					}
				} else if (path.endsWith(suffix) || path.includes('/' + suffix) || path.includes('\\' + suffix)) {
					return true;
				}
			}
			if (path === pattern || path.endsWith('/' + pattern) || path.endsWith('\\' + pattern)) {
				return true;
			}
		}
		return false;
	}
}
