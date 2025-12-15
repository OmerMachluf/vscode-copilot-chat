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
 * - UI components for status display and progress indicators
 * - Permission system for secure agent operations
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
	IStatusUpdateContent,
	MessagePriority,
	MessageStatus,
	MessageType,
	deserializeMessage,
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
	serializeMessage
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
	GitBranchInfo,
	GitExecOptions,
	GitOperationResult,
	GitWorktreeInfo,
	abortMerge,
	abortRebase,
	branchExists,
	checkout,
	clean,
	commit,
	createBranch,
	createWorktree,
	deleteBranch,
	deleteRemoteBranch,
	execGit,
	execGitOrThrow,
	fetch,
	getChangedFiles,
	getConflictedFiles,
	getCurrentBranch,
	getCurrentCommit,
	getDefaultBranch,
	getDiffStats,
	getFilesBetweenRefs,
	getLog,
	getMainRepoPath,
	getMergeBase,
	hasUncommittedChanges,
	isInMerge,
	isInRebase,
	isWorktree,
	listWorktrees,
	pruneWorktrees,
	pull,
	push,
	removeWorktree,
	reset,
	stageAllChanges,
	stash,
	stashPop
} from './gitOperations';

// Merge utilities - high-level merge operations with conflict detection
export {
	ConflictDetectionResult,
	MergeOptions,
	MergeResult,
	MergeStrategy,
	PreMergeCheckResult,
	WorktreeCleanupOptions,
	WorktreeCleanupResult,
	abortInProgressOperation,
	cleanupWorktree,
	detectConflicts,
	getMergeState,
	mergeBranches,
	mergeWorktreeAndCleanup,
	performPreMergeChecks,
	prepareWorktreeForMerge,
	resolveAllConflicts
} from './mergeUtils';

// UI components - status display
export {
	AgentStatusDisplay,
	AgentSessionStatus,
	IAgentSessionInfo,
	IAgentStatusDisplay,
	IAgentStatusChangeEvent,
	IApprovalNeededEvent,
	createSimpleStatusDisplay
} from './ui/statusDisplay';

// UI components - progress indicators
export {
	IProgressState,
	IProgressIndicatorOptions,
	IProgressUpdateEvent,
	IProgressCancelEvent,
	IAgentProgressIndicator,
	IProgressIndicatorService,
	AgentOperationType,
	ProgressIndicatorService,
	withProgress,
	createWorktreeProgress,
	getProgressIndicatorService
} from './ui/progressIndicator';

// UI components - control panel
export {
	IPendingApproval,
	IApprovalDecisionEvent,
	CONTROL_PANEL_COMMANDS,
	IAgentControlPanel,
	AgentControlPanel,
	getAgentControlPanel
} from './ui/controlPanel';

// Permissions - agent operation permission types and utilities
export {
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
	DEFAULT_PERMISSION_CONFIG,
	SENSITIVE_OPERATIONS,
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

// Hierarchical permission routing - routes permissions through parent hierarchy
export {
	HierarchicalPermissionRouter,
	IHierarchicalPermissionDecision,
	IHierarchicalPermissionRequest,
	IHierarchicalPermissionRouter,
	IParentAutoApprovalPolicy,
	IPermissionDecisionEvent,
	IPermissionRoutedEvent,
} from './hierarchicalPermissionRouter';
