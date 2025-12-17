/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../util/vs/base/common/event';

/**
 * Valid states for tasks and subtasks in the orchestration system.
 */
export type TaskState = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Represents a state transition with the reason for the transition.
 */
export interface IStateTransition {
	readonly from: TaskState;
	readonly to: TaskState;
	readonly timestamp: number;
	readonly reason?: string;
}

/**
 * Valid state transitions for the task state machine.
 * This enforces a strict state model to prevent invalid transitions.
 */
const VALID_TRANSITIONS: ReadonlyArray<{ from: TaskState[]; to: TaskState }> = [
	// Initial transitions
	{ from: ['pending'], to: 'queued' },
	{ from: ['pending', 'queued'], to: 'running' },

	// Terminal transitions
	{ from: ['running'], to: 'completed' },
	{ from: ['running'], to: 'failed' },
	{ from: ['pending', 'queued', 'running'], to: 'cancelled' },

	// Recovery transitions (for retry scenarios)
	{ from: ['failed', 'cancelled'], to: 'pending' },
];

/**
 * A state machine for managing task/subtask states with strict transition validation.
 *
 * This class ensures:
 * - Only valid state transitions are allowed
 * - All transitions are logged for debugging
 * - Invalid transitions are rejected with clear error messages
 * - State history is preserved for debugging
 *
 * Usage:
 * ```typescript
 * const sm = new TaskStateMachine('task-123', logService);
 * sm.transition('running'); // OK
 * sm.transition('completed'); // OK
 * sm.transition('running'); // ERROR: Invalid transition completed -> running
 * ```
 */
export class TaskStateMachine {
	private _state: TaskState = 'pending';
	private readonly _history: IStateTransition[] = [];
	private readonly _onDidChangeState = new Emitter<IStateTransition>();

	/**
	 * Event fired when state changes successfully.
	 */
	public readonly onDidChangeState: Event<IStateTransition> = this._onDidChangeState.event;

	constructor(
		private readonly _taskId: string,
		private readonly _logger?: { info: (msg: string) => void; warn: (msg: string) => void }
	) { }

	/**
	 * Gets the current state.
	 */
	public get state(): TaskState {
		return this._state;
	}

	/**
	 * Gets the full state transition history.
	 */
	public get history(): ReadonlyArray<IStateTransition> {
		return this._history;
	}

	/**
	 * Checks if a transition to the target state is valid from the current state.
	 */
	public canTransition(to: TaskState): boolean {
		return VALID_TRANSITIONS.some(t => t.from.includes(this._state) && t.to === to);
	}

	/**
	 * Attempts to transition to a new state.
	 *
	 * @param to The target state
	 * @param reason Optional reason for the transition (for debugging)
	 * @returns true if transition succeeded, false if rejected
	 */
	public transition(to: TaskState, reason?: string): boolean {
		const from = this._state;

		// No-op if already in target state
		if (from === to) {
			this._logger?.info(`[TaskStateMachine] Task ${this._taskId}: Already in state '${to}'`);
			return true;
		}

		// Validate transition
		if (!this.canTransition(to)) {
			this._logger?.warn(
				`[TaskStateMachine] Task ${this._taskId}: INVALID transition '${from}' -> '${to}'` +
				(reason ? ` (reason: ${reason})` : '')
			);
			return false;
		}

		// Perform transition
		this._state = to;
		const transition: IStateTransition = {
			from,
			to,
			timestamp: Date.now(),
			reason,
		};
		this._history.push(transition);

		this._logger?.info(
			`[TaskStateMachine] Task ${this._taskId}: '${from}' -> '${to}'` +
			(reason ? ` (${reason})` : '')
		);

		this._onDidChangeState.fire(transition);
		return true;
	}

	/**
	 * Forces a state change without validation.
	 * USE WITH CAUTION - only for recovery scenarios.
	 *
	 * @param to The target state
	 * @param reason Required reason for the forced transition
	 */
	public forceState(to: TaskState, reason: string): void {
		const from = this._state;
		this._state = to;

		const transition: IStateTransition = {
			from,
			to,
			timestamp: Date.now(),
			reason: `FORCED: ${reason}`,
		};
		this._history.push(transition);

		this._logger?.warn(
			`[TaskStateMachine] Task ${this._taskId}: FORCED '${from}' -> '${to}' (${reason})`
		);

		this._onDidChangeState.fire(transition);
	}

	/**
	 * Checks if the task is in a terminal state (completed, failed, or cancelled).
	 */
	public isTerminal(): boolean {
		return this._state === 'completed' || this._state === 'failed' || this._state === 'cancelled';
	}

	/**
	 * Checks if the task is actively running.
	 */
	public isActive(): boolean {
		return this._state === 'running' || this._state === 'queued';
	}

	/**
	 * Gets a string representation for debugging.
	 */
	public toString(): string {
		return `TaskStateMachine(${this._taskId}): ${this._state} [${this._history.length} transitions]`;
	}

	/**
	 * Disposes of the state machine resources.
	 */
	public dispose(): void {
		this._onDidChangeState.dispose();
	}
}

/**
 * Factory function for creating state machines with optional logging.
 */
export function createTaskStateMachine(
	taskId: string,
	logService?: { info: (msg: string) => void; warn: (msg: string) => void }
): TaskStateMachine {
	return new TaskStateMachine(taskId, logService);
}

/**
 * Validates that a state string is a valid TaskState.
 */
export function isValidTaskState(state: string): state is TaskState {
	return ['pending', 'queued', 'running', 'completed', 'failed', 'cancelled'].includes(state);
}
