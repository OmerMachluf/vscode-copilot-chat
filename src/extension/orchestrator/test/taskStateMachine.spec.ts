/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { describe, it, beforeEach, vi } from 'vitest';
import { createTaskStateMachine, isValidTaskState, TaskStateMachine } from '../taskStateMachine';

describe('TaskStateMachine', () => {
	let stateMachine: TaskStateMachine;
	let mockLogger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		mockLogger = {
			info: vi.fn(),
			warn: vi.fn(),
		};
		stateMachine = createTaskStateMachine('test-task-1', mockLogger);
	});

	describe('initial state', () => {
		it('should start in pending state', () => {
			assert.strictEqual(stateMachine.state, 'pending');
		});

		it('should have empty history', () => {
			assert.strictEqual(stateMachine.history.length, 0);
		});

		it('should not be terminal', () => {
			assert.strictEqual(stateMachine.isTerminal(), false);
		});

		it('should not be active', () => {
			assert.strictEqual(stateMachine.isActive(), false);
		});
	});

	describe('valid transitions from pending', () => {
		it('should allow transition to queued', () => {
			const result = stateMachine.transition('queued');
			assert.strictEqual(result, true);
			assert.strictEqual(stateMachine.state, 'queued');
		});

		it('should allow transition to running', () => {
			const result = stateMachine.transition('running');
			assert.strictEqual(result, true);
			assert.strictEqual(stateMachine.state, 'running');
		});

		it('should allow transition to cancelled', () => {
			const result = stateMachine.transition('cancelled');
			assert.strictEqual(result, true);
			assert.strictEqual(stateMachine.state, 'cancelled');
		});

		it('should not allow transition to completed', () => {
			const result = stateMachine.transition('completed');
			assert.strictEqual(result, false);
			assert.strictEqual(stateMachine.state, 'pending');
		});

		it('should not allow transition to failed', () => {
			const result = stateMachine.transition('failed');
			assert.strictEqual(result, false);
			assert.strictEqual(stateMachine.state, 'pending');
		});
	});

	describe('valid transitions from running', () => {
		beforeEach(() => {
			stateMachine.transition('running');
		});

		it('should allow transition to completed', () => {
			const result = stateMachine.transition('completed');
			assert.strictEqual(result, true);
			assert.strictEqual(stateMachine.state, 'completed');
		});

		it('should allow transition to failed', () => {
			const result = stateMachine.transition('failed');
			assert.strictEqual(result, true);
			assert.strictEqual(stateMachine.state, 'failed');
		});

		it('should allow transition to cancelled', () => {
			const result = stateMachine.transition('cancelled');
			assert.strictEqual(result, true);
			assert.strictEqual(stateMachine.state, 'cancelled');
		});

		it('should not allow transition back to pending', () => {
			const result = stateMachine.transition('pending');
			assert.strictEqual(result, false);
			assert.strictEqual(stateMachine.state, 'running');
		});
	});

	describe('terminal states', () => {
		it('should be terminal after completing', () => {
			stateMachine.transition('running');
			stateMachine.transition('completed');
			assert.strictEqual(stateMachine.isTerminal(), true);
		});

		it('should be terminal after failing', () => {
			stateMachine.transition('running');
			stateMachine.transition('failed');
			assert.strictEqual(stateMachine.isTerminal(), true);
		});

		it('should be terminal after cancelling', () => {
			stateMachine.transition('cancelled');
			assert.strictEqual(stateMachine.isTerminal(), true);
		});
	});

	describe('recovery transitions', () => {
		it('should allow transition from failed to pending', () => {
			stateMachine.transition('running');
			stateMachine.transition('failed');
			const result = stateMachine.transition('pending');
			assert.strictEqual(result, true);
			assert.strictEqual(stateMachine.state, 'pending');
		});

		it('should allow transition from cancelled to pending', () => {
			stateMachine.transition('cancelled');
			const result = stateMachine.transition('pending');
			assert.strictEqual(result, true);
			assert.strictEqual(stateMachine.state, 'pending');
		});
	});

	describe('history tracking', () => {
		it('should record transitions in history', () => {
			stateMachine.transition('running');
			stateMachine.transition('completed');

			assert.strictEqual(stateMachine.history.length, 2);
			assert.strictEqual(stateMachine.history[0].from, 'pending');
			assert.strictEqual(stateMachine.history[0].to, 'running');
			assert.strictEqual(stateMachine.history[1].from, 'running');
			assert.strictEqual(stateMachine.history[1].to, 'completed');
		});

		it('should include reason in history', () => {
			stateMachine.transition('running');
			stateMachine.transition('failed', 'Network timeout');

			assert.strictEqual(stateMachine.history[1].reason, 'Network timeout');
		});

		it('should not record failed transitions', () => {
			stateMachine.transition('completed'); // Invalid from pending
			assert.strictEqual(stateMachine.history.length, 0);
		});
	});

	describe('no-op transitions', () => {
		it('should allow transition to same state', () => {
			const result = stateMachine.transition('pending');
			assert.strictEqual(result, true);
			assert.strictEqual(stateMachine.state, 'pending');
			// No history entry for no-op
			assert.strictEqual(stateMachine.history.length, 0);
		});
	});

	describe('forceState', () => {
		it('should force state regardless of validity', () => {
			stateMachine.forceState('completed', 'Testing force state');
			assert.strictEqual(stateMachine.state, 'completed');
		});

		it('should record forced transition in history', () => {
			stateMachine.forceState('completed', 'Testing force state');
			assert.strictEqual(stateMachine.history.length, 1);
			assert.ok(stateMachine.history[0].reason?.includes('FORCED'));
		});

		it('should log warning for forced transitions', () => {
			stateMachine.forceState('completed', 'Testing force state');
			assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
		});
	});

	describe('canTransition', () => {
		it('should return true for valid transitions', () => {
			assert.strictEqual(stateMachine.canTransition('running'), true);
		});

		it('should return false for invalid transitions', () => {
			assert.strictEqual(stateMachine.canTransition('completed'), false);
		});
	});

	describe('isActive', () => {
		it('should be active when running', () => {
			stateMachine.transition('running');
			assert.strictEqual(stateMachine.isActive(), true);
		});

		it('should be active when queued', () => {
			stateMachine.transition('queued');
			assert.strictEqual(stateMachine.isActive(), true);
		});

		it('should not be active when pending', () => {
			assert.strictEqual(stateMachine.isActive(), false);
		});

		it('should not be active when completed', () => {
			stateMachine.transition('running');
			stateMachine.transition('completed');
			assert.strictEqual(stateMachine.isActive(), false);
		});
	});

	describe('logging', () => {
		it('should log successful transitions', () => {
			stateMachine.transition('running');
			assert.strictEqual(mockLogger.info.mock.calls.length, 1);
		});

		it('should log invalid transitions', () => {
			stateMachine.transition('completed'); // Invalid
			assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
		});
	});
});

describe('isValidTaskState', () => {
	it('should return true for valid states', () => {
		assert.strictEqual(isValidTaskState('pending'), true);
		assert.strictEqual(isValidTaskState('queued'), true);
		assert.strictEqual(isValidTaskState('running'), true);
		assert.strictEqual(isValidTaskState('completed'), true);
		assert.strictEqual(isValidTaskState('failed'), true);
		assert.strictEqual(isValidTaskState('cancelled'), true);
	});

	it('should return false for invalid states', () => {
		assert.strictEqual(isValidTaskState('invalid'), false);
		assert.strictEqual(isValidTaskState(''), false);
		assert.strictEqual(isValidTaskState('PENDING'), false);
	});
});
