/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../platform/log/common/logService';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable, IDisposable, toDisposable } from '../../../util/vs/base/common/lifecycle';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { createDecorator } from '../../../util/vs/platform/instantiation/common/instantiation';
import {
	IA2AMessage,
	IAgentIdentifier,
	ICompletionContent,
	ICreateMessageOptions,
	IMessageSubscription,
	IStatusUpdateContent,
	MessagePriority,
	MessageType,
} from './messageTypes';
import { IA2AMessageQueue } from './messageQueue';

export const IA2AMessageRouter = createDecorator<IA2AMessageRouter>('a2aMessageRouter');

/**
 * Routing rule for message dispatch.
 */
export interface IRoutingRule {
	/** Unique rule ID */
	readonly id: string;
	/** Rule name for debugging */
	readonly name: string;
	/** Message types this rule applies to */
	readonly messageTypes?: MessageType[];
	/** Source agent patterns (supports wildcards) */
	readonly sourcePattern?: string;
	/** Destination agent patterns (supports wildcards) */
	readonly destinationPattern?: string;
	/** Priority filter */
	readonly priorityFilter?: MessagePriority[];
	/** Plan ID filter */
	readonly planIdFilter?: string[];
	/** Action to take when rule matches */
	readonly action: 'route' | 'broadcast' | 'drop' | 'transform' | 'delay';
	/** Target agent ID for 'route' action */
	readonly targetAgentId?: string;
	/** Transform function for 'transform' action */
	readonly transform?: (message: IA2AMessage) => IA2AMessage;
	/** Delay in ms for 'delay' action */
	readonly delayMs?: number;
	/** Rule priority (higher = checked first) */
	readonly priority: number;
	/** Whether this rule is enabled */
	enabled: boolean;
}

/**
 * Route information for a message.
 */
export interface IMessageRoute {
	readonly messageId: string;
	readonly message: IA2AMessage;
	readonly source: IAgentIdentifier;
	readonly destination: IAgentIdentifier;
	readonly hops: IRouteHop[];
	readonly status: 'pending' | 'in_transit' | 'delivered' | 'failed';
	readonly createdAt: number;
	readonly completedAt?: number;
}

/**
 * A single hop in a message route.
 */
export interface IRouteHop {
	readonly agentId: string;
	readonly timestamp: number;
	readonly action: string;
	readonly duration?: number;
}

/**
 * Configuration for the message router.
 */
export interface IRouterConfig {
	/** Maximum hops before a message is considered unroutable */
	readonly maxHops: number;
	/** Enable route tracing for debugging */
	readonly traceRoutes: boolean;
	/** Default routing behavior for unmatched messages */
	readonly defaultAction: 'route' | 'drop';
	/** Enable broadcast to multiple subscribers */
	readonly enableBroadcast: boolean;
}

/**
 * Router metrics for monitoring.
 */
export interface IRouterMetrics {
	readonly totalRouted: number;
	readonly totalBroadcast: number;
	readonly totalDropped: number;
	readonly totalTransformed: number;
	readonly activeRules: number;
	readonly activeSubscriptions: number;
	readonly avgRoutingTime: number;
}

/**
 * Message router service interface for inter-agent communication.
 */
export interface IA2AMessageRouter {
	readonly _serviceBrand: undefined;

	/** Event fired when a message is routed */
	readonly onMessageRouted: Event<IMessageRoute>;
	/** Event fired when a message is broadcast */
	readonly onMessageBroadcast: Event<{ message: IA2AMessage; recipients: string[] }>;
	/** Event fired when a message is dropped */
	readonly onMessageDropped: Event<{ message: IA2AMessage; reason: string }>;

	/**
	 * Send a message through the router.
	 * The router will determine the appropriate destination(s) and queue the message.
	 */
	send(options: ICreateMessageOptions): IA2AMessage;

	/**
	 * Send a status update to a specific agent.
	 */
	sendStatusUpdate(
		sender: IAgentIdentifier,
		receiver: IAgentIdentifier,
		status: string,
		options?: {
			progress?: number;
			currentFiles?: string[];
			planId?: string;
			taskId?: string;
		}
	): IA2AMessage;

	/**
	 * Send a completion notification.
	 */
	sendCompletion(
		sender: IAgentIdentifier,
		receiver: IAgentIdentifier,
		success: boolean,
		output: string,
		options?: {
			error?: string;
			modifiedFiles?: string[];
			planId?: string;
			taskId?: string;
			subTaskId?: string;
		}
	): IA2AMessage;

	/**
	 * Broadcast a message to multiple recipients.
	 */
	broadcast(options: Omit<ICreateMessageOptions, 'receiver'>, recipientIds: string[]): IA2AMessage[];

	/**
	 * Subscribe to messages matching certain criteria.
	 */
	subscribe(subscription: Omit<IMessageSubscription, 'id'>): IDisposable;

	/**
	 * Add a routing rule.
	 */
	addRule(rule: Omit<IRoutingRule, 'id'>): string;

	/**
	 * Remove a routing rule.
	 */
	removeRule(ruleId: string): boolean;

	/**
	 * Enable or disable a routing rule.
	 */
	setRuleEnabled(ruleId: string, enabled: boolean): void;

	/**
	 * Get all active routing rules.
	 */
	getRules(): IRoutingRule[];

	/**
	 * Get route history for a message.
	 */
	getRoute(messageId: string): IMessageRoute | undefined;

	/**
	 * Get router metrics.
	 */
	getMetrics(): IRouterMetrics;

	/**
	 * Check if an agent is reachable (has a registered handler).
	 */
	isAgentReachable(agentId: string): boolean;

	/**
	 * Get all registered agent IDs.
	 */
	getRegisteredAgents(): string[];
}

/**
 * Default router configuration.
 */
const DEFAULT_ROUTER_CONFIG: IRouterConfig = {
	maxHops: 10,
	traceRoutes: true,
	defaultAction: 'route',
	enableBroadcast: true,
};

/**
 * Implementation of the message router.
 */
export class A2AMessageRouter extends Disposable implements IA2AMessageRouter {
	declare readonly _serviceBrand: undefined;

	private readonly _config: IRouterConfig;
	private readonly _rules = new Map<string, IRoutingRule>();
	private readonly _subscriptions = new Map<string, IMessageSubscription>();
	private readonly _routes = new Map<string, IMessageRoute>();
	private readonly _registeredAgents = new Set<string>();

	private _metrics = {
		totalRouted: 0,
		totalBroadcast: 0,
		totalDropped: 0,
		totalTransformed: 0,
		totalRoutingTime: 0,
		routingCount: 0,
	};

	private readonly _onMessageRouted = this._register(new Emitter<IMessageRoute>());
	public readonly onMessageRouted: Event<IMessageRoute> = this._onMessageRouted.event;

	private readonly _onMessageBroadcast = this._register(new Emitter<{ message: IA2AMessage; recipients: string[] }>());
	public readonly onMessageBroadcast: Event<{ message: IA2AMessage; recipients: string[] }> = this._onMessageBroadcast.event;

	private readonly _onMessageDropped = this._register(new Emitter<{ message: IA2AMessage; reason: string }>());
	public readonly onMessageDropped: Event<{ message: IA2AMessage; reason: string }> = this._onMessageDropped.event;

	constructor(
		@IA2AMessageQueue private readonly _messageQueue: IA2AMessageQueue,
		@ILogService private readonly _logService: ILogService,
		config?: Partial<IRouterConfig>,
	) {
		super();
		this._config = { ...DEFAULT_ROUTER_CONFIG, ...config };

		// Listen to queue events for route tracking
		this._register(this._messageQueue.onMessageDelivered(message => {
			this._updateRouteStatus(message.id, 'delivered');
		}));

		this._register(this._messageQueue.onMessageFailed(({ message }) => {
			this._updateRouteStatus(message.id, 'failed');
		}));

		this._logService.debug('[A2AMessageRouter] Service initialized');
	}

	send(options: ICreateMessageOptions): IA2AMessage {
		const startTime = Date.now();

		// Apply routing rules
		const processedOptions = this._applyRules(options);
		if (!processedOptions) {
			// Message was dropped by a rule
			return this._createDroppedMessage(options, 'Dropped by routing rule');
		}

		// Register sender and receiver as known agents
		this._registeredAgents.add(processedOptions.sender.id);
		this._registeredAgents.add(processedOptions.receiver.id);

		// Enqueue the message
		const message = this._messageQueue.enqueue(processedOptions);

		// Create route record
		if (this._config.traceRoutes) {
			const route: IMessageRoute = {
				messageId: message.id,
				message,
				source: message.sender,
				destination: message.receiver,
				hops: [{
					agentId: 'router',
					timestamp: Date.now(),
					action: 'enqueued',
				}],
				status: 'pending',
				createdAt: Date.now(),
			};
			this._routes.set(message.id, route);
		}

		// Update metrics
		this._metrics.totalRouted++;
		this._metrics.totalRoutingTime += Date.now() - startTime;
		this._metrics.routingCount++;

		this._logService.debug(`[A2AMessageRouter] Routed message ${message.id} from ${message.sender.id} to ${message.receiver.id}`);

		// Notify subscriptions
		this._notifySubscribers(message);

		return message;
	}

	sendStatusUpdate(
		sender: IAgentIdentifier,
		receiver: IAgentIdentifier,
		status: string,
		options?: {
			progress?: number;
			currentFiles?: string[];
			planId?: string;
			taskId?: string;
		}
	): IA2AMessage {
		const content: IStatusUpdateContent = {
			type: 'status_update',
			status,
			progress: options?.progress,
			currentFiles: options?.currentFiles,
		};

		return this.send({
			type: 'status_update',
			priority: 'normal',
			sender,
			receiver,
			content,
			planId: options?.planId,
			taskId: options?.taskId,
		});
	}

	sendCompletion(
		sender: IAgentIdentifier,
		receiver: IAgentIdentifier,
		success: boolean,
		output: string,
		options?: {
			error?: string;
			modifiedFiles?: string[];
			planId?: string;
			taskId?: string;
			subTaskId?: string;
		}
	): IA2AMessage {
		const content: ICompletionContent = {
			type: 'completion',
			success,
			output,
			error: options?.error,
			modifiedFiles: options?.modifiedFiles,
		};

		return this.send({
			type: 'completion',
			priority: 'high',
			sender,
			receiver,
			content,
			planId: options?.planId,
			taskId: options?.taskId,
			subTaskId: options?.subTaskId,
		});
	}

	broadcast(options: Omit<ICreateMessageOptions, 'receiver'>, recipientIds: string[]): IA2AMessage[] {
		if (!this._config.enableBroadcast) {
			this._logService.warn('[A2AMessageRouter] Broadcast is disabled');
			return [];
		}

		const messages: IA2AMessage[] = [];

		for (const recipientId of recipientIds) {
			const receiver: IAgentIdentifier = {
				type: 'agent',
				id: recipientId,
			};

			const message = this.send({
				...options,
				receiver,
			});

			messages.push(message);
		}

		this._metrics.totalBroadcast++;
		this._onMessageBroadcast.fire({
			message: messages[0], // Reference first message
			recipients: recipientIds,
		});

		this._logService.debug(`[A2AMessageRouter] Broadcast message to ${recipientIds.length} recipients`);

		return messages;
	}

	subscribe(subscription: Omit<IMessageSubscription, 'id'>): IDisposable {
		const id = generateUuid();
		const fullSubscription: IMessageSubscription = {
			...subscription,
			id,
		};

		this._subscriptions.set(id, fullSubscription);
		this._registeredAgents.add(subscription.subscriber.id);

		this._logService.debug(`[A2AMessageRouter] Added subscription ${id} for agent ${subscription.subscriber.id}`);

		return toDisposable(() => {
			this._subscriptions.delete(id);
			this._logService.debug(`[A2AMessageRouter] Removed subscription ${id}`);
		});
	}

	addRule(rule: Omit<IRoutingRule, 'id'>): string {
		const id = generateUuid();
		const fullRule: IRoutingRule = {
			...rule,
			id,
		};

		this._rules.set(id, fullRule);
		this._logService.debug(`[A2AMessageRouter] Added routing rule ${id}: ${rule.name}`);

		return id;
	}

	removeRule(ruleId: string): boolean {
		const removed = this._rules.delete(ruleId);
		if (removed) {
			this._logService.debug(`[A2AMessageRouter] Removed routing rule ${ruleId}`);
		}
		return removed;
	}

	setRuleEnabled(ruleId: string, enabled: boolean): void {
		const rule = this._rules.get(ruleId);
		if (rule) {
			rule.enabled = enabled;
			this._logService.debug(`[A2AMessageRouter] Rule ${ruleId} enabled: ${enabled}`);
		}
	}

	getRules(): IRoutingRule[] {
		return Array.from(this._rules.values());
	}

	getRoute(messageId: string): IMessageRoute | undefined {
		return this._routes.get(messageId);
	}

	getMetrics(): IRouterMetrics {
		return {
			totalRouted: this._metrics.totalRouted,
			totalBroadcast: this._metrics.totalBroadcast,
			totalDropped: this._metrics.totalDropped,
			totalTransformed: this._metrics.totalTransformed,
			activeRules: Array.from(this._rules.values()).filter(r => r.enabled).length,
			activeSubscriptions: this._subscriptions.size,
			avgRoutingTime: this._metrics.routingCount > 0
				? this._metrics.totalRoutingTime / this._metrics.routingCount
				: 0,
		};
	}

	isAgentReachable(agentId: string): boolean {
		return this._registeredAgents.has(agentId);
	}

	getRegisteredAgents(): string[] {
		return Array.from(this._registeredAgents);
	}

	private _applyRules(options: ICreateMessageOptions): ICreateMessageOptions | null {
		// Sort rules by priority (descending)
		const sortedRules = Array.from(this._rules.values())
			.filter(r => r.enabled)
			.sort((a, b) => b.priority - a.priority);

		let currentOptions = options;

		for (const rule of sortedRules) {
			if (!this._ruleMatches(rule, currentOptions)) {
				continue;
			}

			this._logService.debug(`[A2AMessageRouter] Rule ${rule.name} matched for message`);

			switch (rule.action) {
				case 'drop':
					this._metrics.totalDropped++;
					return null;

				case 'route':
					if (rule.targetAgentId) {
						currentOptions = {
							...currentOptions,
							receiver: {
								...currentOptions.receiver,
								id: rule.targetAgentId,
							},
						};
					}
					break;

				case 'transform':
					if (rule.transform) {
						const tempMessage = this._createTempMessage(currentOptions);
						const transformed = rule.transform(tempMessage);
						currentOptions = {
							...currentOptions,
							content: transformed.content,
							priority: transformed.priority,
						};
						this._metrics.totalTransformed++;
					}
					break;

				case 'delay':
					if (rule.delayMs) {
						currentOptions = {
							...currentOptions,
							deliveryOptions: {
								...currentOptions.deliveryOptions,
								timeout: (currentOptions.deliveryOptions?.timeout ?? 30000) + rule.delayMs,
							},
						};
					}
					break;

				case 'broadcast':
					// Broadcast is handled separately
					break;
			}
		}

		return currentOptions;
	}

	private _ruleMatches(rule: IRoutingRule, options: ICreateMessageOptions): boolean {
		// Check message type filter
		if (rule.messageTypes && rule.messageTypes.length > 0) {
			if (!rule.messageTypes.includes(options.type)) {
				return false;
			}
		}

		// Check source pattern
		if (rule.sourcePattern) {
			if (!this._matchPattern(rule.sourcePattern, options.sender.id)) {
				return false;
			}
		}

		// Check destination pattern
		if (rule.destinationPattern) {
			if (!this._matchPattern(rule.destinationPattern, options.receiver.id)) {
				return false;
			}
		}

		// Check priority filter
		if (rule.priorityFilter && rule.priorityFilter.length > 0) {
			const priority = options.priority ?? 'normal';
			if (!rule.priorityFilter.includes(priority)) {
				return false;
			}
		}

		// Check plan ID filter
		if (rule.planIdFilter && rule.planIdFilter.length > 0) {
			if (!options.planId || !rule.planIdFilter.includes(options.planId)) {
				return false;
			}
		}

		return true;
	}

	private _matchPattern(pattern: string, value: string): boolean {
		// Simple wildcard matching
		if (pattern === '*') {
			return true;
		}

		if (pattern.endsWith('*')) {
			const prefix = pattern.slice(0, -1);
			return value.startsWith(prefix);
		}

		if (pattern.startsWith('*')) {
			const suffix = pattern.slice(1);
			return value.endsWith(suffix);
		}

		return pattern === value;
	}

	private _createTempMessage(options: ICreateMessageOptions): IA2AMessage {
		return {
			id: 'temp',
			type: options.type,
			priority: options.priority ?? 'normal',
			status: 'pending',
			sender: options.sender,
			receiver: options.receiver,
			content: options.content,
			metadata: {
				createdAt: Date.now(),
				deliveryAttempts: 0,
			},
			deliveryOptions: options.deliveryOptions ?? {},
			planId: options.planId,
			taskId: options.taskId,
			subTaskId: options.subTaskId,
			depth: options.depth,
		};
	}

	private _createDroppedMessage(options: ICreateMessageOptions, reason: string): IA2AMessage {
		const message = this._createTempMessage(options);
		(message as { id: string }).id = generateUuid();
		(message as { status: string }).status = 'failed';

		this._onMessageDropped.fire({ message, reason });
		this._logService.debug(`[A2AMessageRouter] Dropped message: ${reason}`);

		return message;
	}

	private _notifySubscribers(message: IA2AMessage): void {
		for (const subscription of this._subscriptions.values()) {
			// Check if subscription matches
			if (subscription.messageTypes && subscription.messageTypes.length > 0) {
				if (!subscription.messageTypes.includes(message.type)) {
					continue;
				}
			}

			if (subscription.priorities && subscription.priorities.length > 0) {
				if (!subscription.priorities.includes(message.priority)) {
					continue;
				}
			}

			if (subscription.senderFilter && subscription.senderFilter.length > 0) {
				const senderMatches = subscription.senderFilter.some(
					s => s.id === message.sender.id
				);
				if (!senderMatches) {
					continue;
				}
			}

			if (subscription.planIdFilter && subscription.planIdFilter.length > 0) {
				if (!message.planId || !subscription.planIdFilter.includes(message.planId)) {
					continue;
				}
			}

			// Notify subscriber
			try {
				const result = subscription.callback(message);
				if (result instanceof Promise) {
					result.catch(err => {
						this._logService.error(`[A2AMessageRouter] Subscription callback error: ${err}`);
					});
				}
			} catch (err) {
				this._logService.error(`[A2AMessageRouter] Subscription callback error: ${err}`);
			}
		}
	}

	private _updateRouteStatus(messageId: string, status: 'delivered' | 'failed'): void {
		const route = this._routes.get(messageId);
		if (route) {
			(route as { status: string }).status = status;
			(route as { completedAt: number }).completedAt = Date.now();

			const lastHop = route.hops[route.hops.length - 1];
			if (lastHop) {
				(lastHop as { duration: number }).duration = Date.now() - lastHop.timestamp;
			}

			route.hops.push({
				agentId: route.destination.id,
				timestamp: Date.now(),
				action: status,
			});

			this._onMessageRouted.fire(route);
		}
	}
}
