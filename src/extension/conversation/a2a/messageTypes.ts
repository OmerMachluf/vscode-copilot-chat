/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Message priority levels for the inter-agent messaging system.
 * Higher priority messages are processed first.
 */
export type MessagePriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * Types of messages that can be sent between agents.
 */
export type MessageType =
	| 'status_update'      // Progress updates from worker to parent
	| 'question'           // Worker asking parent for clarification
	| 'completion'         // Worker signaling task completion
	| 'error'              // Error notification
	| 'approval_request'   // Request for approval from parent
	| 'approval_response'  // Response to an approval request
	| 'refinement'         // Request to refine/improve previous work
	| 'retry_request'      // Request to retry a failed operation
	| 'heartbeat'          // Keep-alive message for long-running tasks
	| 'cancellation';      // Request to cancel a task

/**
 * Status of a message in the queue.
 */
export type MessageStatus = 'pending' | 'delivered' | 'acknowledged' | 'failed' | 'expired';

/**
 * Identifies the sender or receiver of a message.
 */
export interface IAgentIdentifier {
	/** Type of agent: orchestrator, worker, or standalone agent */
	readonly type: 'orchestrator' | 'worker' | 'agent';
	/** Unique identifier for the agent instance */
	readonly id: string;
	/** Optional session URI for VS Code chat sessions */
	readonly sessionUri?: string;
	/** Worktree path for the agent (if applicable) */
	readonly worktreePath?: string;
}

/**
 * Delivery options for a message.
 */
export interface IMessageDeliveryOptions {
	/** Timeout in milliseconds for message delivery (default: 30000) */
	readonly timeout?: number;
	/** Number of retry attempts if delivery fails (default: 3) */
	readonly retryCount?: number;
	/** Whether to wait for acknowledgment (default: false) */
	readonly requireAck?: boolean;
	/** TTL (time-to-live) in milliseconds after which message expires (default: 300000 = 5 min) */
	readonly ttl?: number;
}

/**
 * Metadata attached to a message for tracking and debugging.
 */
export interface IMessageMetadata {
	/** Unix timestamp when the message was created */
	readonly createdAt: number;
	/** Unix timestamp when the message was delivered (if delivered) */
	readonly deliveredAt?: number;
	/** Unix timestamp when the message was acknowledged (if acknowledged) */
	readonly acknowledgedAt?: number;
	/** Number of delivery attempts made */
	readonly deliveryAttempts: number;
	/** Error message if delivery failed */
	readonly lastError?: string;
	/** Correlation ID for request-response patterns */
	readonly correlationId?: string;
	/** Trace ID for distributed tracing */
	readonly traceId?: string;
}

/**
 * Core message structure for inter-agent communication.
 */
export interface IA2AMessage {
	/** Unique message identifier */
	readonly id: string;
	/** Message type */
	readonly type: MessageType;
	/** Message priority */
	readonly priority: MessagePriority;
	/** Current status of the message */
	status: MessageStatus;
	/** Sender information */
	readonly sender: IAgentIdentifier;
	/** Receiver information */
	readonly receiver: IAgentIdentifier;
	/** Message content (type varies based on message type) */
	readonly content: IA2AMessageContent;
	/** Message metadata */
	readonly metadata: IMessageMetadata;
	/** Delivery options */
	readonly deliveryOptions: IMessageDeliveryOptions;
	/** Plan ID this message belongs to (for orchestrated workflows) */
	readonly planId?: string;
	/** Task ID this message relates to */
	readonly taskId?: string;
	/** Sub-task ID (if message is from/to a sub-task) */
	readonly subTaskId?: string;
	/** Depth in the task hierarchy */
	readonly depth?: number;
}

/**
 * Base interface for message content.
 */
export interface IA2AMessageContentBase {
	/** Human-readable summary of the message */
	readonly summary?: string;
}

/**
 * Status update message content.
 */
export interface IStatusUpdateContent extends IA2AMessageContentBase {
	readonly type: 'status_update';
	/** Current progress (0-100) */
	readonly progress?: number;
	/** Current status description */
	readonly status: string;
	/** Files being worked on */
	readonly currentFiles?: string[];
	/** Estimated time remaining in milliseconds */
	readonly estimatedTimeRemaining?: number;
}

/**
 * Question message content.
 */
export interface IQuestionContent extends IA2AMessageContentBase {
	readonly type: 'question';
	/** The question text */
	readonly question: string;
	/** Suggested options/answers */
	readonly options?: string[];
	/** Whether this question is blocking the task */
	readonly blocking: boolean;
	/** Context for the question */
	readonly context?: Record<string, unknown>;
}

/**
 * Completion message content.
 */
export interface ICompletionContent extends IA2AMessageContentBase {
	readonly type: 'completion';
	/** Whether the task completed successfully */
	readonly success: boolean;
	/** Task output/result */
	readonly output: string;
	/** Error message if failed */
	readonly error?: string;
	/** Files modified during the task */
	readonly modifiedFiles?: string[];
	/** Additional result metadata */
	readonly resultMetadata?: Record<string, unknown>;
}

/**
 * Error message content.
 */
export interface IErrorContent extends IA2AMessageContentBase {
	readonly type: 'error';
	/** Error code */
	readonly code: string;
	/** Error message */
	readonly message: string;
	/** Stack trace (if available) */
	readonly stack?: string;
	/** Whether the error is recoverable */
	readonly recoverable: boolean;
	/** Suggested remediation steps */
	readonly remediation?: string[];
}

/**
 * Approval request message content.
 */
export interface IApprovalRequestContent extends IA2AMessageContentBase {
	readonly type: 'approval_request';
	/** Unique ID for this approval request */
	readonly approvalId: string;
	/** Action being requested */
	readonly action: string;
	/** Description of why approval is needed */
	readonly description: string;
	/** Risk level of the action */
	readonly riskLevel: 'low' | 'medium' | 'high' | 'critical';
	/** Resources affected by the action */
	readonly affectedResources?: string[];
	/** Timeout for the approval request */
	readonly timeout?: number;
}

/**
 * Approval response message content.
 */
export interface IApprovalResponseContent extends IA2AMessageContentBase {
	readonly type: 'approval_response';
	/** ID of the approval request being responded to */
	readonly approvalId: string;
	/** Whether approved or denied */
	readonly approved: boolean;
	/** Reason for the decision */
	readonly reason?: string;
	/** Any conditions attached to the approval */
	readonly conditions?: string[];
}

/**
 * Refinement request message content.
 */
export interface IRefinementContent extends IA2AMessageContentBase {
	readonly type: 'refinement';
	/** Original output that needs refinement */
	readonly originalOutput: string;
	/** Feedback on what to improve */
	readonly feedback: string;
	/** Specific areas to focus on */
	readonly focusAreas?: string[];
}

/**
 * Retry request message content.
 */
export interface IRetryRequestContent extends IA2AMessageContentBase {
	readonly type: 'retry_request';
	/** ID of the failed task/message */
	readonly failedId: string;
	/** Reason for retry */
	readonly reason: string;
	/** Modified parameters for the retry */
	readonly modifiedParams?: Record<string, unknown>;
}

/**
 * Heartbeat message content.
 */
export interface IHeartbeatContent extends IA2AMessageContentBase {
	readonly type: 'heartbeat';
	/** Current agent status */
	readonly agentStatus: 'active' | 'idle' | 'busy';
	/** Current memory usage (if available) */
	readonly memoryUsage?: number;
	/** Number of pending tasks */
	readonly pendingTasks?: number;
}

/**
 * Cancellation message content.
 */
export interface ICancellationContent extends IA2AMessageContentBase {
	readonly type: 'cancellation';
	/** ID of the task to cancel */
	readonly targetTaskId: string;
	/** Reason for cancellation */
	readonly reason: string;
	/** Whether to force cancel (skip cleanup) */
	readonly force: boolean;
}

/**
 * Union type for all message content types.
 */
export type IA2AMessageContent =
	| IStatusUpdateContent
	| IQuestionContent
	| ICompletionContent
	| IErrorContent
	| IApprovalRequestContent
	| IApprovalResponseContent
	| IRefinementContent
	| IRetryRequestContent
	| IHeartbeatContent
	| ICancellationContent;

/**
 * Options for creating a new message.
 */
export interface ICreateMessageOptions {
	readonly type: MessageType;
	readonly priority?: MessagePriority;
	readonly sender: IAgentIdentifier;
	readonly receiver: IAgentIdentifier;
	readonly content: IA2AMessageContent;
	readonly planId?: string;
	readonly taskId?: string;
	readonly subTaskId?: string;
	readonly depth?: number;
	readonly deliveryOptions?: Partial<IMessageDeliveryOptions>;
	readonly correlationId?: string;
	readonly traceId?: string;
}

/**
 * Acknowledgment for a received message.
 */
export interface IMessageAcknowledgment {
	readonly messageId: string;
	readonly acknowledgedAt: number;
	readonly acknowledgedBy: IAgentIdentifier;
	readonly success: boolean;
	readonly error?: string;
}

/**
 * Subscription to messages matching certain criteria.
 */
export interface IMessageSubscription {
	/** Unique subscription ID */
	readonly id: string;
	/** Agent subscribing to messages */
	readonly subscriber: IAgentIdentifier;
	/** Message types to subscribe to */
	readonly messageTypes?: MessageType[];
	/** Only receive messages with these priorities */
	readonly priorities?: MessagePriority[];
	/** Only receive messages from these senders */
	readonly senderFilter?: IAgentIdentifier[];
	/** Only receive messages for these plan IDs */
	readonly planIdFilter?: string[];
	/** Callback for received messages */
	readonly callback: (message: IA2AMessage) => void | Promise<void>;
}

/**
 * Serialized message format for persistence and cross-process communication.
 */
export interface ISerializedA2AMessage {
	readonly id: string;
	readonly type: MessageType;
	readonly priority: MessagePriority;
	readonly status: MessageStatus;
	readonly sender: IAgentIdentifier;
	readonly receiver: IAgentIdentifier;
	readonly content: unknown;
	readonly metadata: IMessageMetadata;
	readonly deliveryOptions: IMessageDeliveryOptions;
	readonly planId?: string;
	readonly taskId?: string;
	readonly subTaskId?: string;
	readonly depth?: number;
}

/**
 * Convert a message to its serialized form.
 */
export function serializeMessage(message: IA2AMessage): ISerializedA2AMessage {
	return {
		id: message.id,
		type: message.type,
		priority: message.priority,
		status: message.status,
		sender: message.sender,
		receiver: message.receiver,
		content: message.content,
		metadata: message.metadata,
		deliveryOptions: message.deliveryOptions,
		planId: message.planId,
		taskId: message.taskId,
		subTaskId: message.subTaskId,
		depth: message.depth,
	};
}

/**
 * Deserialize a message from its serialized form.
 */
export function deserializeMessage(serialized: ISerializedA2AMessage): IA2AMessage {
	return {
		id: serialized.id,
		type: serialized.type,
		priority: serialized.priority,
		status: serialized.status as MessageStatus,
		sender: serialized.sender,
		receiver: serialized.receiver,
		content: serialized.content as IA2AMessageContent,
		metadata: serialized.metadata,
		deliveryOptions: serialized.deliveryOptions,
		planId: serialized.planId,
		taskId: serialized.taskId,
		subTaskId: serialized.subTaskId,
		depth: serialized.depth,
	};
}

/**
 * Type guard for status update content.
 */
export function isStatusUpdateContent(content: IA2AMessageContent): content is IStatusUpdateContent {
	return content.type === 'status_update';
}

/**
 * Type guard for question content.
 */
export function isQuestionContent(content: IA2AMessageContent): content is IQuestionContent {
	return content.type === 'question';
}

/**
 * Type guard for completion content.
 */
export function isCompletionContent(content: IA2AMessageContent): content is ICompletionContent {
	return content.type === 'completion';
}

/**
 * Type guard for error content.
 */
export function isErrorContent(content: IA2AMessageContent): content is IErrorContent {
	return content.type === 'error';
}

/**
 * Type guard for approval request content.
 */
export function isApprovalRequestContent(content: IA2AMessageContent): content is IApprovalRequestContent {
	return content.type === 'approval_request';
}

/**
 * Type guard for approval response content.
 */
export function isApprovalResponseContent(content: IA2AMessageContent): content is IApprovalResponseContent {
	return content.type === 'approval_response';
}

/**
 * Type guard for refinement content.
 */
export function isRefinementContent(content: IA2AMessageContent): content is IRefinementContent {
	return content.type === 'refinement';
}

/**
 * Type guard for retry request content.
 */
export function isRetryRequestContent(content: IA2AMessageContent): content is IRetryRequestContent {
	return content.type === 'retry_request';
}

/**
 * Type guard for heartbeat content.
 */
export function isHeartbeatContent(content: IA2AMessageContent): content is IHeartbeatContent {
	return content.type === 'heartbeat';
}

/**
 * Type guard for cancellation content.
 */
export function isCancellationContent(content: IA2AMessageContent): content is ICancellationContent {
	return content.type === 'cancellation';
}
