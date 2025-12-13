/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Message types and protocols
export {
	deserializeMessage,
	IA2AMessage,
	IA2AMessageContent,
	IA2AMessageContentBase,
	IAgentIdentifier,
	IApprovalRequestContent,
	IApprovalResponseContent,
	ICancellationContent,
	ICompletionContent,
	ICreateMessageOptions,
	IErrorContent,
	IHeartbeatContent,
	IMessageAcknowledgment,
	IMessageDeliveryOptions,
	IMessageMetadata,
	IMessageSubscription,
	IQuestionContent,
	IRefinementContent,
	IRetryRequestContent,
	ISerializedA2AMessage,
	IStatusUpdateContent,
	isApprovalRequestContent,
	isApprovalResponseContent,
	isCancellationContent,
	isCompletionContent,
	isErrorContent,
	isHeartbeatContent,
	isQuestionContent,
	isRefinementContent,
	isRetryRequestContent,
	isStatusUpdateContent,
	MessagePriority,
	MessageStatus,
	MessageType,
	serializeMessage,
} from './messageTypes';

// Message queue
export {
	A2AMessageQueue,
	IA2AMessageQueue,
	IMessageQueueConfig,
	IMessageQueueMetrics,
	MessageHandler,
} from './messageQueue';

// Message router
export {
	A2AMessageRouter,
	IA2AMessageRouter,
	IMessageRoute,
	IRouteHop,
	IRouterConfig,
	IRouterMetrics,
	IRoutingRule,
} from './messageRouter';
