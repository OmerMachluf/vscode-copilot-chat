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
	IStatusUpdateContent, MessagePriority,
	MessageStatus,
	MessageType, deserializeMessage, isApprovalRequestContent,
	isApprovalResponseContent,
	isCancellationContent,
	isCompletionContent,
	isErrorContent,
	isHeartbeatContent,
	isQuestionContent,
	isRefinementContent,
	isRetryRequestContent,
	isStatusUpdateContent, serializeMessage
} from './messageTypes';

// Message queue
export {
	A2AMessageQueue,
	IA2AMessageQueue,
	IMessageQueueConfig,
	IMessageQueueMetrics,
	MessageHandler
} from './messageQueue';

// Message router
export {
	A2AMessageRouter,
	IA2AMessageRouter,
	IMessageRoute,
	IRouteHop,
	IRouterConfig,
	IRouterMetrics,
	IRoutingRule
} from './messageRouter';

// Git operations - low-level git command execution
export {
	GitBranchInfo, GitExecOptions,
	// Types
	GitOperationResult, GitWorktreeInfo,
	// Merge/rebase state
	abortMerge,
	abortRebase, branchExists, checkout, clean, commit, createBranch, createWorktree, deleteBranch,
	deleteRemoteBranch,
	// Core operations
	execGit,
	execGitOrThrow,
	// Remote operations
	fetch, getChangedFiles, getConflictedFiles,
	// Branch operations
	getCurrentBranch,
	getCurrentCommit,
	getDefaultBranch, getDiffStats,
	getFilesBetweenRefs, getLog, getMainRepoPath, getMergeBase,
	// Change tracking
	hasUncommittedChanges, isInMerge,
	isInRebase, isWorktree,
	// Worktree operations
	listWorktrees, pruneWorktrees, pull,
	push, removeWorktree,
	// Utility operations
	reset,
	// Staging and committing
	stageAllChanges, stash,
	stashPop
} from './gitOperations';

// Merge utilities - high-level merge operations with conflict detection
export {
	ConflictDetectionResult, MergeOptions, MergeResult,
	// Types
	MergeStrategy, PreMergeCheckResult, WorktreeCleanupOptions, WorktreeCleanupResult, abortInProgressOperation,
	// Cleanup operations
	cleanupWorktree,
	// Conflict detection
	detectConflicts,
	// State inspection
	getMergeState,
	// Merge operations
	mergeBranches,
	mergeWorktreeAndCleanup, performPreMergeChecks, prepareWorktreeForMerge,
	// Conflict resolution
	resolveAllConflicts
} from './mergeUtils';

// Permissions - agent operation permission types and utilities
export {
	// Types
	AgentPermissionConfig,
	ApprovalRecord,
	ApprovalRule,
	ApprovalScope,
	FileAccessConfig,
	MutablePermissionStats,
	OperationCategory,
	PermissionCheckResult,
	PermissionLevel,
	PermissionRequest,
	PermissionStats,
	TerminalAccessConfig,
	// Constants
	DEFAULT_PERMISSION_CONFIG,
	SENSITIVE_OPERATIONS,
	// Functions
	getAllowedCategories,
	isOperationAllowedByLevel,
	isSensitiveOperation,
} from './permissions';

// Permission service - agent permission management
export {
	A2A_CONFIG_KEYS,
	AgentPermissionService,
	IAgentPermissionService,
	IApprovalPromptEvent,
	IPermissionEvent,
	NullAgentPermissionService,
} from './permissionService';

