/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../platform/log/common/logService';
import { createServiceIdentifier } from '../../util/common/services';
import { Emitter, Event } from '../../util/vs/base/common/event';
import { Disposable, IDisposable, toDisposable } from '../../util/vs/base/common/lifecycle';
import { ISubTask, ISubTaskResult } from './orchestratorInterfaces';
import { ISubTaskManager } from './subTaskManager';

export const ISubtaskProgressService = createServiceIdentifier<ISubtaskProgressService>('subtaskProgressService');

/**
 * Represents a subtask progress item that can be updated.
 */
export interface ISubtaskProgressItem {
	/** Unique ID for this progress item */
	readonly id: string;
	/** The subtask being tracked */
	readonly subtaskId: string;
	/** Agent type running the subtask */
	readonly agentType: string;
	/** Current status */
	status: 'running' | 'completed' | 'failed' | 'cancelled';
	/** Progress message */
	message: string;
	/** Result when completed */
	result?: ISubTaskResult;
}

/**
 * Progress callback that can be called to update status.
 */
export type ProgressCallback = (item: ISubtaskProgressItem) => void;

/**
 * Options for creating subtask progress.
 */
export interface ISubtaskProgressOptions {
	/** The subtask ID */
	subtaskId: string;
	/** Agent type */
	agentType: string;
	/** Initial message */
	message: string;
	/** Chat response stream (if available) */
	stream?: vscode.ChatResponseStream;
}

/**
 * Service for managing subtask progress UI.
 *
 * This service abstracts progress reporting, providing:
 * 1. In-chat progress "bubbles" when a chat stream is available
 * 2. VS Code notification progress when no stream is available
 *
 * The service listens to SubTaskManager lifecycle events and automatically
 * updates progress items when subtasks complete/fail.
 */
export interface ISubtaskProgressService {
	readonly _serviceBrand: undefined;

	/**
	 * Create a progress item for a subtask.
	 * Returns a handle that can be used to update the progress.
	 */
	createProgress(options: ISubtaskProgressOptions): ISubtaskProgressHandle;

	/**
	 * Register a chat stream to receive progress updates.
	 * Progress items created after this call will use the stream for in-chat bubbles.
	 * @param ownerId The owner ID (worker ID or session ID)
	 * @param stream The chat response stream
	 */
	registerStream(ownerId: string, stream: vscode.ChatResponseStream): IDisposable;

	/**
	 * Get the registered stream for an owner, if any.
	 */
	getStream(ownerId: string): vscode.ChatResponseStream | undefined;

	/**
	 * Event fired when a progress item is created.
	 */
	readonly onProgressCreated: Event<ISubtaskProgressItem>;

	/**
	 * Event fired when a progress item is updated.
	 */
	readonly onProgressUpdated: Event<ISubtaskProgressItem>;
}

/**
 * Handle for managing a single progress item.
 */
export interface ISubtaskProgressHandle extends IDisposable {
	/** The progress item */
	readonly item: ISubtaskProgressItem;
	/** Update the progress message */
	update(message: string): void;
	/** Mark as completed with result */
	complete(result: ISubTaskResult): void;
	/** Mark as failed with error */
	fail(error: string): void;
}

/**
 * Implementation of subtask progress service.
 */
export class SubtaskProgressService extends Disposable implements ISubtaskProgressService {
	readonly _serviceBrand: undefined;

	/** Map of ownerId -> stream */
	private readonly _streams = new Map<string, vscode.ChatResponseStream>();

	/** Map of subtaskId -> progress item */
	private readonly _progressItems = new Map<string, ISubtaskProgressItem>();

	/** Map of subtaskId -> notification progress disposable */
	private readonly _notificationProgress = new Map<string, IDisposable>();

	private readonly _onProgressCreated = this._register(new Emitter<ISubtaskProgressItem>());
	readonly onProgressCreated = this._onProgressCreated.event;

	private readonly _onProgressUpdated = this._register(new Emitter<ISubtaskProgressItem>());
	readonly onProgressUpdated = this._onProgressUpdated.event;

	constructor(
		@ISubTaskManager private readonly _subTaskManager: ISubTaskManager,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Listen to subtask completions to auto-update progress
		this._register(this._subTaskManager.onDidCompleteSubTask(subTask => {
			this._handleSubTaskCompletion(subTask);
		}));

		// Listen to subtask status changes
		this._register(this._subTaskManager.onDidChangeSubTask(subTask => {
			this._handleSubTaskChange(subTask);
		}));
	}

	registerStream(ownerId: string, stream: vscode.ChatResponseStream): IDisposable {
		this._logService.info(`[SubtaskProgressService] registerStream called for ownerId='${ownerId}'`);
		this._streams.set(ownerId, stream);
		this._logService.info(`[SubtaskProgressService] Stream registered. Total streams: ${this._streams.size}`);

		return toDisposable(() => {
			if (this._streams.get(ownerId) === stream) {
				this._logService.info(`[SubtaskProgressService] Unregistering stream for ownerId='${ownerId}'`);
				this._streams.delete(ownerId);
			}
		});
	}

	getStream(ownerId: string): vscode.ChatResponseStream | undefined {
		const stream = this._streams.get(ownerId);
		this._logService.info(`[SubtaskProgressService] getStream('${ownerId}'): ${stream ? 'FOUND' : 'NOT FOUND'}`);
		if (!stream) {
			this._logService.info(`[SubtaskProgressService] Available stream ownerIds: [${Array.from(this._streams.keys()).join(', ')}]`);
		}
		return stream;
	}

	createProgress(options: ISubtaskProgressOptions): ISubtaskProgressHandle {
		const { subtaskId, agentType, message, stream } = options;
		this._logService.info(`[SubtaskProgressService] createProgress called: subtaskId=${subtaskId}, agentType=${agentType}, stream=${stream ? 'PROVIDED' : 'NOT PROVIDED'}`);

		const item: ISubtaskProgressItem = {
			id: subtaskId,
			subtaskId,
			agentType,
			status: 'running',
			message,
		};

		this._progressItems.set(subtaskId, item);
		this._onProgressCreated.fire(item);

		// Try to use chat stream progress if available
		const effectiveStream = stream ?? this._findStreamForSubtask(subtaskId);
		this._logService.info(`[SubtaskProgressService] Effective stream: ${effectiveStream ? 'FOUND' : 'NOT FOUND'}`);

		if (effectiveStream) {
			// Use in-chat progress bubble
			this._createChatProgress(effectiveStream, item);
		} else {
			// Fall back to notification progress
			this._createNotificationProgress(item);
		}

		this._logService.info(`[SubtaskProgressService] Created progress for subtask ${subtaskId} (${agentType})`);

		const handle: ISubtaskProgressHandle = {
			item,
			update: (newMessage: string) => {
				item.message = newMessage;
				this._onProgressUpdated.fire(item);
			},
			complete: (result: ISubTaskResult) => {
				this._logService.info(`[SubtaskProgressService] Progress complete for subtask ${subtaskId}: status=${result.status}`);
				item.status = result.status === 'success' ? 'completed' : 'failed';
				item.message = result.status === 'success' ? 'Completed' : (result.error ?? 'Failed');
				item.result = result;
				this._onProgressUpdated.fire(item);
				this._cleanupProgress(subtaskId);
			},
			fail: (error: string) => {
				this._logService.info(`[SubtaskProgressService] Progress failed for subtask ${subtaskId}: ${error}`);
				item.status = 'failed';
				item.message = error;
				this._onProgressUpdated.fire(item);
				this._cleanupProgress(subtaskId);
			},
			dispose: () => {
				this._cleanupProgress(subtaskId);
			},
		};

		return handle;
	}

	private _findStreamForSubtask(subtaskId: string): vscode.ChatResponseStream | undefined {
		this._logService.info(`[SubtaskProgressService] _findStreamForSubtask called for ${subtaskId}`);
		// Look up the subtask to find its parent
		const subTask = this._subTaskManager.getSubTask(subtaskId);
		this._logService.info(`[SubtaskProgressService] SubTask found: ${subTask ? 'YES' : 'NO'}, parentWorkerId=${subTask?.parentWorkerId}`);
		if (subTask?.parentWorkerId) {
			const stream = this._streams.get(subTask.parentWorkerId);
			this._logService.info(`[SubtaskProgressService] Stream for parentWorkerId '${subTask.parentWorkerId}': ${stream ? 'FOUND' : 'NOT FOUND'}`);
			return stream;
		}
		return undefined;
	}

	private _createChatProgress(stream: vscode.ChatResponseStream, item: ISubtaskProgressItem): void {
		// Use the chat stream's progress method with a callback for completion
		const statusIcon = item.status === 'running' ? '🔄' : item.status === 'completed' ? '✅' : '❌';
		const progressMessage = `${statusIcon} **${item.agentType}** subtask: ${item.message}`;

		// For initial creation, just show the progress message
		// The task callback pattern is for blocking operations, but our subtasks are async
		stream.progress(progressMessage);

		this._logService.debug(`[SubtaskProgressService] Created chat progress for ${item.subtaskId}`);
	}

	private _createNotificationProgress(item: ISubtaskProgressItem): void {
		// NO-OP: We intentionally do NOT create VS Code notification progress.
		// Notifications are intrusive and the user has requested no notifications.
		//
		// Progress tracking still works - items are tracked in _progressItems,
		// events are fired, and results are returned when complete.
		// The parent agent will receive the results via the tool return value.
		//
		// If the user opens an orchestrator session, the chat UI will show
		// the buffered progress via WorkerResponseStream replay.
		this._logService.debug(`[SubtaskProgressService] Skipping notification progress for subtask ${item.subtaskId} (${item.agentType}) - progress tracked internally only`);
	}

	private _cleanupProgress(subtaskId: string): void {
		this._progressItems.delete(subtaskId);

		const notificationDisposable = this._notificationProgress.get(subtaskId);
		if (notificationDisposable) {
			notificationDisposable.dispose();
			this._notificationProgress.delete(subtaskId);
		}
	}

	private _handleSubTaskCompletion(subTask: ISubTask): void {
		const item = this._progressItems.get(subTask.id);
		if (!item) {
			return;
		}

		// Update status based on subtask status
		item.status = subTask.status === 'completed' ? 'completed' :
			subTask.status === 'cancelled' ? 'cancelled' : 'failed';
		item.result = subTask.result;
		item.message = subTask.status === 'completed' ? 'Completed successfully' :
			(subTask.result?.error ?? `Status: ${subTask.status}`);

		this._onProgressUpdated.fire(item);

		// Update chat progress if we have a stream
		const stream = this._findStreamForSubtask(subTask.id);
		if (stream) {
			const statusIcon = item.status === 'completed' ? '✅' : item.status === 'cancelled' ? '⚠️' : '❌';
			stream.progress(`${statusIcon} **${item.agentType}** subtask ${item.status}: ${item.message}`);
		}

		this._cleanupProgress(subTask.id);
	}

	private _handleSubTaskChange(subTask: ISubTask): void {
		const item = this._progressItems.get(subTask.id);
		if (!item) {
			return;
		}

		// Only update for status changes while running
		if (subTask.status === 'running' && item.status === 'running') {
			// Status changed while running (e.g., progress update)
			// Could update message here if needed
		}
	}
}

/**
 * Renderer for subtask progress in parallel spawn scenarios.
 * Creates a group of progress items and manages their lifecycle.
 */
export class ParallelSubtaskProgressRenderer {
	private readonly _handles: ISubtaskProgressHandle[] = [];
	private readonly _subtaskIds: string[] = [];

	constructor(
		private readonly _progressService: ISubtaskProgressService,
		private readonly _stream: vscode.ChatResponseStream | undefined,
		private readonly _logService: ILogService,
	) { }

	/**
	 * Add a subtask to track.
	 */
	addSubtask(subtaskId: string, agentType: string): ISubtaskProgressHandle {
		const handle = this._progressService.createProgress({
			subtaskId,
			agentType,
			message: 'Starting...',
			stream: this._stream,
		});

		this._handles.push(handle);
		this._subtaskIds.push(subtaskId);

		return handle;
	}

	/**
	 * Report summary progress.
	 */
	reportSummary(): void {
		const completed = this._handles.filter(h => h.item.status === 'completed').length;
		const failed = this._handles.filter(h => h.item.status === 'failed').length;
		const total = this._handles.length;

		if (this._stream) {
			this._stream.progress(
				`📊 Parallel subtasks: ${completed}/${total} completed` +
				(failed > 0 ? `, ${failed} failed` : '')
			);
		}

		this._logService.debug(`[ParallelSubtaskProgressRenderer] Summary: ${completed}/${total} completed, ${failed} failed`);
	}

	/**
	 * Dispose all progress handles.
	 */
	dispose(): void {
		for (const handle of this._handles) {
			handle.dispose();
		}
		this._handles.length = 0;
		this._subtaskIds.length = 0;
	}
}
