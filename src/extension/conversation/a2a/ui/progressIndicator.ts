/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Emitter, Event } from '../../../../util/vs/base/common/event';
import { Disposable, IDisposable } from '../../../../util/vs/base/common/lifecycle';

/**
 * Progress indicator state.
 */
export interface IProgressState {
/** Current progress (0-100) */
readonly progress: number;
/** Current step description */
readonly message: string;
/** Whether the operation is cancellable */
readonly cancellable: boolean;
/** Whether the operation is indeterminate (unknown progress) */
readonly indeterminate: boolean;
}

/**
 * Options for creating a progress indicator.
 */
export interface IProgressIndicatorOptions {
/** Title for the progress notification */
readonly title: string;
/** Location of the progress indicator */
readonly location: vscode.ProgressLocation;
/** Whether the operation is cancellable */
readonly cancellable?: boolean;
/** Initial message */
readonly initialMessage?: string;
}

/**
 * Event fired when progress is updated.
 */
export interface IProgressUpdateEvent {
readonly indicatorId: string;
readonly progress: number;
readonly message: string;
}

/**
 * Event fired when progress is cancelled.
 */
export interface IProgressCancelEvent {
readonly indicatorId: string;
readonly reason: string;
}

/**
 * Service identifier for IAgentProgressIndicator.
 */
export const IAgentProgressIndicator = Symbol('IAgentProgressIndicator');

/**
 * Progress indicator for long-running agent operations.
 */
export interface IAgentProgressIndicator extends IDisposable {
/** Unique identifier for this indicator */
readonly id: string;

/** Event fired when progress is updated */
readonly onProgressUpdate: Event<IProgressUpdateEvent>;

/** Event fired when progress is cancelled */
readonly onProgressCancel: Event<IProgressCancelEvent>;

/** Current state of the progress indicator */
readonly state: IProgressState;

/**
 * Report progress update.
 * @param progress Progress value (0-100) or undefined for indeterminate
 * @param message Optional message describing current step
 */
report(progress?: number, message?: string): void;

/**
 * Mark the operation as complete.
 */
complete(): void;

/**
 * Cancel the operation.
 * @param reason Reason for cancellation
 */
cancel(reason?: string): void;

/**
 * Check if the operation was cancelled.
 */
isCancelled(): boolean;
}

/**
 * Service for managing multiple progress indicators.
 */
export interface IProgressIndicatorService extends IDisposable {
/**
 * Event fired when any progress is updated.
 */
readonly onAnyProgressUpdate: Event<IProgressUpdateEvent>;

/**
 * Event fired when any progress is cancelled.
 */
readonly onAnyProgressCancel: Event<IProgressCancelEvent>;

/**
 * Create a new progress indicator.
 */
create(options: IProgressIndicatorOptions): IAgentProgressIndicator;

/**
 * Create a progress indicator for an agent operation.
 */
createForAgent(
sessionId: string,
operationType: AgentOperationType,
options?: Partial<IProgressIndicatorOptions>
): IAgentProgressIndicator;

/**
 * Get an existing progress indicator by ID.
 */
get(indicatorId: string): IAgentProgressIndicator | undefined;

/**
 * Get all active progress indicators.
 */
getActive(): readonly IAgentProgressIndicator[];

/**
 * Cancel all progress indicators.
 */
cancelAll(reason?: string): void;
}

/**
 * Types of agent operations that show progress.
 */
export type AgentOperationType =
| 'worktree_create'
| 'worktree_merge'
| 'worktree_cleanup'
| 'agent_execution'
| 'file_analysis'
| 'code_generation'
| 'permission_check'
| 'approval_wait';

/**
 * Default titles for agent operation types.
 */
const OPERATION_TITLES: Record<AgentOperationType, string> = {
worktree_create: 'Creating worktree...',
worktree_merge: 'Merging changes...',
worktree_cleanup: 'Cleaning up worktree...',
agent_execution: 'Agent executing task...',
file_analysis: 'Analyzing files...',
code_generation: 'Generating code...',
permission_check: 'Checking permissions...',
approval_wait: 'Waiting for approval...',
};

/**
 * Default locations for agent operation types.
 */
const OPERATION_LOCATIONS: Record<AgentOperationType, vscode.ProgressLocation> = {
worktree_create: vscode.ProgressLocation.Notification,
worktree_merge: vscode.ProgressLocation.Notification,
worktree_cleanup: vscode.ProgressLocation.Notification,
agent_execution: vscode.ProgressLocation.Notification,
file_analysis: vscode.ProgressLocation.Window,
code_generation: vscode.ProgressLocation.Window,
permission_check: vscode.ProgressLocation.Window,
approval_wait: vscode.ProgressLocation.Notification,
};

/**
 * Implementation of a progress indicator.
 */
class AgentProgressIndicator extends Disposable implements IAgentProgressIndicator {
private _state: IProgressState;
private _cancelled = false;
private _completed = false;
private _vscodeProgress?: vscode.Progress<{ message?: string; increment?: number }>;
private _resolveProgress?: () => void;

private readonly _onProgressUpdate = this._register(new Emitter<IProgressUpdateEvent>());
public readonly onProgressUpdate = this._onProgressUpdate.event;

private readonly _onProgressCancel = this._register(new Emitter<IProgressCancelEvent>());
public readonly onProgressCancel = this._onProgressCancel.event;

constructor(
public readonly id: string,
private readonly _options: IProgressIndicatorOptions,
) {
super();

this._state = {
progress: 0,
message: _options.initialMessage ?? '',
cancellable: _options.cancellable ?? false,
indeterminate: true,
};

this._startProgress();
}

get state(): IProgressState {
return this._state;
}

private _startProgress(): void {
vscode.window.withProgress(
{
location: this._options.location,
title: this._options.title,
cancellable: this._options.cancellable ?? false,
},
async (progress, token) => {
this._vscodeProgress = progress;

// Handle cancellation from VS Code UI
if (this._options.cancellable) {
token.onCancellationRequested(() => {
this.cancel('Cancelled by user');
});
}

// Report initial message
if (this._options.initialMessage) {
progress.report({ message: this._options.initialMessage });
}

// Wait until complete or cancelled
return new Promise<void>((resolve) => {
this._resolveProgress = resolve;
});
}
);
}

report(progress?: number, message?: string): void {
if (this._cancelled || this._completed) {
return;
}

const previousProgress = this._state.progress;
const increment = progress !== undefined
? progress - previousProgress
: undefined;

this._state = {
...this._state,
progress: progress ?? this._state.progress,
message: message ?? this._state.message,
indeterminate: progress === undefined,
};

// Report to VS Code progress
if (this._vscodeProgress) {
this._vscodeProgress.report({
message,
increment: increment !== undefined ? increment : undefined,
});
}

// Fire event
this._onProgressUpdate.fire({
indicatorId: this.id,
progress: this._state.progress,
message: this._state.message,
});
}

complete(): void {
if (this._cancelled || this._completed) {
return;
}

this._completed = true;
this._state = {
...this._state,
progress: 100,
message: 'Complete',
};

// Resolve the progress promise
if (this._resolveProgress) {
this._resolveProgress();
}

// Fire final update
this._onProgressUpdate.fire({
indicatorId: this.id,
progress: 100,
message: 'Complete',
});
}

cancel(reason?: string): void {
if (this._cancelled || this._completed) {
return;
}

this._cancelled = true;
const cancelReason = reason ?? 'Cancelled';

// Resolve the progress promise
if (this._resolveProgress) {
this._resolveProgress();
}

// Fire cancel event
this._onProgressCancel.fire({
indicatorId: this.id,
reason: cancelReason,
});
}

isCancelled(): boolean {
return this._cancelled;
}

override dispose(): void {
// Complete if not already done
if (!this._cancelled && !this._completed) {
this.complete();
}
super.dispose();
}
}

/**
 * Implementation of the progress indicator service.
 */
export class ProgressIndicatorService extends Disposable implements IProgressIndicatorService {
private readonly _indicators = new Map<string, AgentProgressIndicator>();
private _idCounter = 0;

private readonly _onAnyProgressUpdate = this._register(new Emitter<IProgressUpdateEvent>());
public readonly onAnyProgressUpdate = this._onAnyProgressUpdate.event;

private readonly _onAnyProgressCancel = this._register(new Emitter<IProgressCancelEvent>());
public readonly onAnyProgressCancel = this._onAnyProgressCancel.event;

create(options: IProgressIndicatorOptions): IAgentProgressIndicator {
const id = this._generateId();
const indicator = new AgentProgressIndicator(id, options);

// Forward events
this._register(indicator.onProgressUpdate(e => this._onAnyProgressUpdate.fire(e)));
this._register(indicator.onProgressCancel(e => {
this._onAnyProgressCancel.fire(e);
this._indicators.delete(id);
}));

// Remove when complete
this._register(indicator.onProgressUpdate(e => {
if (e.progress >= 100) {
this._indicators.delete(id);
}
}));

this._indicators.set(id, indicator);
return indicator;
}

createForAgent(
sessionId: string,
operationType: AgentOperationType,
options?: Partial<IProgressIndicatorOptions>
): IAgentProgressIndicator {
const defaultTitle = OPERATION_TITLES[operationType];
const defaultLocation = OPERATION_LOCATIONS[operationType];

return this.create({
title: options?.title ?? defaultTitle,
location: options?.location ?? defaultLocation,
cancellable: options?.cancellable ?? (operationType !== 'approval_wait'),
initialMessage: options?.initialMessage,
});
}

get(indicatorId: string): IAgentProgressIndicator | undefined {
return this._indicators.get(indicatorId);
}

getActive(): readonly IAgentProgressIndicator[] {
return Array.from(this._indicators.values()).filter(i => !i.isCancelled());
}

cancelAll(reason?: string): void {
const cancelReason = reason ?? 'All operations cancelled';
for (const indicator of this._indicators.values()) {
indicator.cancel(cancelReason);
}
this._indicators.clear();
}

private _generateId(): string {
return `progress-${++this._idCounter}-${Date.now()}`;
}
}

/**
 * Helper to create a simple progress indicator with automatic completion.
 */
export async function withProgress<T>(
title: string,
task: (progress: IAgentProgressIndicator) => Promise<T>,
options?: Partial<IProgressIndicatorOptions>
): Promise<T> {
const service = new ProgressIndicatorService();

try {
const indicator = service.create({
title,
location: options?.location ?? vscode.ProgressLocation.Notification,
cancellable: options?.cancellable,
initialMessage: options?.initialMessage,
});

try {
const result = await task(indicator);
indicator.complete();
return result;
} catch (error) {
indicator.cancel(error instanceof Error ? error.message : String(error));
throw error;
}
} finally {
service.dispose();
}
}

/**
 * Helper to create a progress indicator for worktree operations.
 */
export function createWorktreeProgress(
operation: 'create' | 'merge' | 'cleanup',
branchName?: string
): IAgentProgressIndicator {
const service = new ProgressIndicatorService();
const operationType: AgentOperationType = `worktree_${operation}`;
const message = branchName ? `${OPERATION_TITLES[operationType]} (${branchName})` : OPERATION_TITLES[operationType];

return service.createForAgent('worktree', operationType, {
title: message,
cancellable: operation !== 'cleanup',
});
}

/**
 * Create a singleton progress indicator service.
 */
let _progressService: ProgressIndicatorService | undefined;

export function getProgressIndicatorService(): IProgressIndicatorService {
if (!_progressService) {
_progressService = new ProgressIndicatorService();
}
return _progressService;
}
