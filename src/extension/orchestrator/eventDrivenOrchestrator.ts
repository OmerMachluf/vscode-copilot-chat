/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../platform/log/common/logService';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { createDecorator } from '../../util/vs/platform/instantiation/common/instantiation';
import { IOrchestratorQueueMessage } from './orchestratorQueue';

/**
 * Trigger types for orchestrator LLM invocation.
 * These represent events that may require intelligent decision-making.
 */
export type OrchestratorTriggerType =
	| 'worker_question'
	| 'worker_error'
	| 'worker_completion'
	| 'subtask_complete'
	| 'approval_request';

/**
 * Context for orchestrator LLM invocation.
 * Provides all relevant information for the LLM to make a decision.
 */
export interface IOrchestratorInvocationContext {
	trigger: OrchestratorTriggerType;
	message: IOrchestratorQueueMessage;
	activePlanId?: string;
	workerStatuses?: Map<string, { status: string; taskName: string }>;
}

/**
 * Result of an orchestrator LLM decision.
 */
export interface IOrchestratorDecision {
	/** Action to take */
	action: 'respond' | 'retry' | 'cancel' | 'escalate' | 'approve' | 'deny' | 'continue';
	/** Response content (for 'respond' action) */
	response?: string;
	/** Reason for the decision */
	reason?: string;
}

/**
 * Service interface for event-driven orchestration.
 */
export const IEventDrivenOrchestratorService = createDecorator<IEventDrivenOrchestratorService>('eventDrivenOrchestratorService');

export interface IEventDrivenOrchestratorService {
	readonly _serviceBrand: undefined;

	/**
	 * Check if a message type requires LLM decision-making.
	 */
	requiresLLMDecision(messageType: IOrchestratorQueueMessage['type']): boolean;

	/**
	 * Build context for LLM invocation.
	 */
	buildContext(message: IOrchestratorQueueMessage): IOrchestratorInvocationContext;

	/**
	 * Build a prompt for the LLM based on the context.
	 */
	buildPrompt(context: IOrchestratorInvocationContext): string;

	/**
	 * Handle a message that requires LLM decision (called by orchestrator).
	 * This method is called by the orchestrator service when it receives a message
	 * that needs intelligent handling.
	 *
	 * @param message The incoming message
	 * @param invokeAgent Function to invoke the LLM agent
	 * @returns The decision made by the LLM
	 */
	handleWithLLM(
		message: IOrchestratorQueueMessage,
		invokeAgent: (prompt: string) => Promise<string>
	): Promise<IOrchestratorDecision>;
}

/**
 * Implementation of event-driven orchestration.
 *
 * This service determines when the orchestrator LLM should be invoked for
 * intelligent decision-making vs. when events can be handled programmatically.
 *
 * Message types that trigger LLM:
 * - `question`: Worker needs an answer to proceed
 * - `error`: Orchestrator decides retry/cancel/escalate
 * - `approval_request`: Worker needs permission for something
 *
 * Message types handled programmatically:
 * - `status_update`: Just update UI state
 * - `completion`: Update state and check dependencies
 * - `approval_response`: Route to the requester
 */
export class EventDrivenOrchestratorService extends Disposable implements IEventDrivenOrchestratorService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	/**
	 * Determine if a message type requires LLM decision-making.
	 */
	requiresLLMDecision(messageType: IOrchestratorQueueMessage['type']): boolean {
		switch (messageType) {
			case 'question':
			case 'error':
			case 'approval_request':
				return true;
			case 'status_update':
			case 'completion':
			case 'approval_response':
			case 'answer':
			case 'refinement':
			case 'retry_request':
				return false;
			default:
				return false;
		}
	}

	/**
	 * Build context for LLM invocation.
	 */
	buildContext(message: IOrchestratorQueueMessage): IOrchestratorInvocationContext {
		return {
			trigger: this._getTriggerType(message),
			message,
			activePlanId: message.planId,
		};
	}

	/**
	 * Map message type to trigger type.
	 */
	private _getTriggerType(message: IOrchestratorQueueMessage): OrchestratorTriggerType {
		switch (message.type) {
			case 'question':
				return 'worker_question';
			case 'error':
				return 'worker_error';
			case 'completion':
				return 'worker_completion';
			case 'approval_request':
				return 'approval_request';
			default:
				return 'worker_completion';
		}
	}

	/**
	 * Build a prompt for the LLM based on the context.
	 * The prompt provides all relevant information for the LLM to make a decision.
	 */
	buildPrompt(context: IOrchestratorInvocationContext): string {
		const lines: string[] = [];

		lines.push(`# Orchestrator Event: ${context.trigger}`);
		lines.push('');
		lines.push('You are the orchestrator agent managing multiple worker agents.');
		lines.push('A worker has sent you a message that requires your attention.');
		lines.push('');

		lines.push('## Incoming Message');
		lines.push(`- **Type:** ${context.message.type}`);
		lines.push(`- **From Worker:** ${context.message.workerId}`);
		lines.push(`- **Task ID:** ${context.message.taskId}`);
		lines.push(`- **Plan ID:** ${context.message.planId || 'None'}`);
		if (context.message.subTaskId) {
			lines.push(`- **SubTask ID:** ${context.message.subTaskId}`);
		}
		lines.push('');

		lines.push('## Message Content');
		const content = typeof context.message.content === 'string'
			? context.message.content
			: JSON.stringify(context.message.content, null, 2);
		lines.push('```');
		lines.push(content);
		lines.push('```');
		lines.push('');

		lines.push('## Your Action Required');
		switch (context.trigger) {
			case 'worker_question':
				lines.push('A worker has asked a question and is waiting for your response.');
				lines.push('Provide a helpful answer to help them continue their task.');
				lines.push('');
				lines.push('Respond with a clear, actionable answer. Keep it concise.');
				break;

			case 'worker_error':
				lines.push('A worker encountered an error and cannot continue.');
				lines.push('Decide what to do:');
				lines.push('- **RETRY**: If the error seems transient or fixable, suggest retrying');
				lines.push('- **CANCEL**: If the error is unrecoverable, cancel the task');
				lines.push('- **ESCALATE**: If you need user input, escalate to the user');
				lines.push('');
				lines.push('Analyze the error and provide your decision with reasoning.');
				break;

			case 'approval_request':
				lines.push('A worker is requesting approval for an action.');
				lines.push('Review the request and decide:');
				lines.push('- **APPROVE**: Allow the action to proceed');
				lines.push('- **DENY**: Reject the action with a reason');
				lines.push('');
				lines.push('Consider security implications and whether the action aligns with the task.');
				break;

			case 'worker_completion':
				lines.push('A worker has completed their task.');
				lines.push('Review the completion and determine if any follow-up is needed.');
				break;

			default:
				lines.push('Handle this event appropriately.');
		}

		lines.push('');
		lines.push('## Response Format');
		lines.push('Provide your response directly. For errors, start with RETRY:, CANCEL:, or ESCALATE:');
		lines.push('For approval requests, start with APPROVE: or DENY:');
		lines.push('For questions, just provide your answer directly.');

		return lines.join('\n');
	}

	/**
	 * Handle a message using LLM decision-making.
	 */
	async handleWithLLM(
		message: IOrchestratorQueueMessage,
		invokeAgent: (prompt: string) => Promise<string>
	): Promise<IOrchestratorDecision> {
		const context = this.buildContext(message);
		const prompt = this.buildPrompt(context);

		this._logService.info(`[EventDrivenOrchestrator] Invoking LLM for ${message.type} message from worker ${message.workerId}`);

		try {
			const response = await invokeAgent(prompt);
			return this._parseDecision(context.trigger, response);
		} catch (error) {
			this._logService.error(`[EventDrivenOrchestrator] LLM invocation failed:`, error);
			// Default to escalate on error
			return {
				action: 'escalate',
				reason: `LLM invocation failed: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	/**
	 * Parse the LLM response into a structured decision.
	 */
	private _parseDecision(trigger: OrchestratorTriggerType, response: string): IOrchestratorDecision {
		const trimmedResponse = response.trim();

		// For error events, look for explicit action prefixes
		if (trigger === 'worker_error') {
			if (trimmedResponse.startsWith('RETRY:')) {
				return {
					action: 'retry',
					response: trimmedResponse.slice(6).trim(),
					reason: 'LLM recommended retry',
				};
			}
			if (trimmedResponse.startsWith('CANCEL:')) {
				return {
					action: 'cancel',
					response: trimmedResponse.slice(7).trim(),
					reason: 'LLM recommended cancel',
				};
			}
			if (trimmedResponse.startsWith('ESCALATE:')) {
				return {
					action: 'escalate',
					response: trimmedResponse.slice(9).trim(),
					reason: 'LLM recommended escalation to user',
				};
			}
			// Default to escalate for errors without explicit prefix
			return {
				action: 'escalate',
				response: trimmedResponse,
				reason: 'No explicit action in LLM response',
			};
		}

		// For approval requests, look for APPROVE/DENY
		if (trigger === 'approval_request') {
			if (trimmedResponse.startsWith('APPROVE:')) {
				return {
					action: 'approve',
					response: trimmedResponse.slice(8).trim(),
					reason: 'LLM approved the request',
				};
			}
			if (trimmedResponse.startsWith('DENY:')) {
				return {
					action: 'deny',
					response: trimmedResponse.slice(5).trim(),
					reason: 'LLM denied the request',
				};
			}
			// Default to escalate if no clear decision
			return {
				action: 'escalate',
				response: trimmedResponse,
				reason: 'LLM did not provide clear approve/deny',
			};
		}

		// For questions, the response IS the answer
		if (trigger === 'worker_question') {
			return {
				action: 'respond',
				response: trimmedResponse,
			};
		}

		// Default case - continue with whatever the response says
		return {
			action: 'continue',
			response: trimmedResponse,
		};
	}
}
