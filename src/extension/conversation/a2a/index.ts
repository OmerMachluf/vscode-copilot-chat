/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Agent-to-Agent (A2A) utilities for multi-agent workflows.
 *
 * This module provides:
 * - Message types and protocols for inter-agent communication
 * - Message queue with priority support
 * - Message routing between agents
 * - Git operations for worktree management
 * - Merge utilities with conflict detection
 * - Support for multiple merge strategies (merge, squash, rebase)
 */

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

// Git operations - low-level git command execution
export {
	// Types
	GitOperationResult,
	GitExecOptions,
	GitBranchInfo,
	GitWorktreeInfo,

	// Core operations
	execGit,
	execGitOrThrow,

	// Branch operations
	getCurrentBranch,
	getCurrentCommit,
	getDefaultBranch,
	branchExists,
	createBranch,
	checkout,
	deleteBranch,
	deleteRemoteBranch,

	// Change tracking
	hasUncommittedChanges,
	getChangedFiles,
	getDiffStats,
	getFilesBetweenRefs,

	// Staging and committing
	stageAllChanges,
	commit,

	// Remote operations
	fetch,
	pull,
	push,
	getMergeBase,

	// Worktree operations
	listWorktrees,
	createWorktree,
	removeWorktree,
	pruneWorktrees,
	getMainRepoPath,
	isWorktree,

	// Merge/rebase state
	abortMerge,
	abortRebase,
	isInMerge,
	isInRebase,
	getConflictedFiles,

	// Utility operations
	reset,
	clean,
	stash,
	stashPop,
	getLog,
} from './gitOperations';

// Merge utilities - high-level merge operations with conflict detection
export {
	// Types
	MergeStrategy,
	MergeResult,
	MergeOptions,
	WorktreeCleanupResult,
	WorktreeCleanupOptions,
	ConflictDetectionResult,
	PreMergeCheckResult,

	// Conflict detection
	detectConflicts,
	performPreMergeChecks,

	// Merge operations
	mergeBranches,
	mergeWorktreeAndCleanup,

	// Cleanup operations
	cleanupWorktree,
	abortInProgressOperation,

	// Conflict resolution
	resolveAllConflicts,

	// State inspection
	getMergeState,
	prepareWorktreeForMerge,
} from './mergeUtils';
