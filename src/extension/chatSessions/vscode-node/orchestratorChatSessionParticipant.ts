/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { Disposable, DisposableStore } from '../../../util/vs/base/common/lifecycle';
import { IOrchestratorService } from '../../orchestrator/orchestratorServiceV2';
import { ISubtaskProgressService } from '../../orchestrator/subtaskProgressService';
import { OrchestratorSessionId } from './orchestratorChatSessionHelpers';

/**
 * Chat participant that handles requests for orchestrator worker sessions.
 * Routes chat requests to the existing WorkerSession via OrchestratorService.
 */
export class OrchestratorChatSessionParticipant extends Disposable {
	constructor(
		@IOrchestratorService private readonly orchestratorService: IOrchestratorService,
		@ISubtaskProgressService private readonly subtaskProgressService: ISubtaskProgressService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
	) {
		super();
	}

	/**
	 * Create the request handler for this participant
	 */
	createHandler(): vscode.ChatExtendedRequestHandler {
		return this.handleRequest.bind(this);
	}

	private async handleRequest(
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<vscode.ChatResult | void> {
		const { chatSessionContext } = context;
		const disposables = new DisposableStore();

		try {
			/* __GDPR__
				"orchestrator.session.chat.invoke" : {
					"owner": "metrond",
					"comment": "Event sent when an orchestrator session chat request is made.",
					"hasChatSessionItem": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Invoked with a chat session item." },
					"isUntitled": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Indicates if the chat session is untitled." }
				}
			*/
			this.telemetryService.sendMSFTTelemetryEvent('orchestrator.session.chat.invoke', {
				hasChatSessionItem: String(!!chatSessionContext?.chatSessionItem),
				isUntitled: String(chatSessionContext?.isUntitled),
			});

			if (!chatSessionContext) {
				stream.markdown(vscode.l10n.t('Orchestrator sessions require a session context. Please select a worker session from the sessions panel.'));
				return {};
			}

			const { resource } = chatSessionContext.chatSessionItem;
			const sessionId = OrchestratorSessionId.parse(resource);

			// Find the task and worker - sessionId could be taskId or workerId
			const tasks = this.orchestratorService.getTasks();
			let task = tasks.find(t => t.id === sessionId);
			let workerId = task?.workerId;

			// If not found as task, try looking up directly as worker ID
			if (!workerId) {
				const workerState = this.orchestratorService.getWorkerState(sessionId);
				if (workerState) {
					workerId = sessionId;
					// Try to find associated task
					task = tasks.find(t => t.workerId === sessionId);
				}
			}

			if (!task && !workerId) {
				stream.markdown(vscode.l10n.t('Session not found: {0}. Please select a valid orchestrator session.', sessionId));
				return {};
			}

			// Get worker state
			const workerState = workerId ? this.orchestratorService.getWorkerState(workerId) : undefined;

			if (!workerId || !workerState) {
				// No worker - this shouldn't happen if session exists
				stream.markdown(vscode.l10n.t('No active worker found for this session. The task may not have been deployed yet.'));
				return {};
			}

			// CRITICAL: Attach the REAL VS Code stream to the worker session
			// This makes the worker write directly to VS Code's rendering pipeline
			// giving us the EXACT SAME UI as local agent sessions
			const workerSession = this.orchestratorService.getWorkerSession(workerId);
			if (workerSession) {
				disposables.add(workerSession.attachStream(stream));

				// Register the stream with the subtask progress service
				// This enables in-chat progress bubbles for A2A subtasks
				disposables.add(this.subtaskProgressService.registerStream(workerId, stream));

				// CRITICAL: Pass the toolInvocationToken to the worker
				// This enables inline tool confirmations instead of modal dialogs
				// The token comes from this real VS Code ChatRequest
				workerSession.setToolInvocationToken(request.toolInvocationToken);
			}

			// Handle cancellation - interrupt the worker when user clicks stop
			disposables.add(token.onCancellationRequested(() => {
				this.orchestratorService.interruptWorker(workerId);
			}));

			// Send the message to the existing worker via orchestrator service
			// This integrates with the worker's existing message loop
			this.orchestratorService.sendMessageToWorker(workerId, request.prompt);

			// Wait for the worker to finish responding
			await this._waitForWorkerIdle(workerId, token);

			return {};

		} finally {
			disposables.dispose();
		}
	}

	/**
	 * Wait for the worker to finish its current response.
	 * This method properly handles the race between sending a message and
	 * the worker starting to process it.
	 */
	private async _waitForWorkerIdle(
		workerId: string,
		token: vscode.CancellationToken
	): Promise<void> {
		return new Promise<void>((resolve) => {
			let hasSeenRunning = false;

			const checkStatus = () => {
				const state = this.orchestratorService.getWorkerState(workerId);
				if (!state) {
					return true; // Worker gone, stop waiting
				}

				// Track if we've ever seen the worker running
				if (state.status === 'running') {
					hasSeenRunning = true;
				}

				// Only resolve to idle/completed/error if we've seen running first
				// This prevents returning immediately when worker is still idle
				// but hasn't processed the message yet
				if (state.status === 'idle' || state.status === 'completed' || state.status === 'error') {
					return hasSeenRunning;
				}

				return false;
			};

			// Don't check immediately - give the worker a chance to start
			// Poll for status changes
			const interval = setInterval(() => {
				if (token.isCancellationRequested || checkStatus()) {
					clearInterval(interval);
					resolve();
				}
			}, 100);

			token.onCancellationRequested(() => {
				clearInterval(interval);
				resolve();
			});
		});
	}
}

/**
 * Registration helper for the orchestrator chat session participant
 */
export function registerOrchestratorChatParticipant(
	participant: OrchestratorChatSessionParticipant,
	disposables: DisposableStore
): vscode.Disposable {
	const chatParticipant = vscode.chat.createChatParticipant(
		'orchestrator',
		participant.createHandler()
	);

	chatParticipant.iconPath = new vscode.ThemeIcon('symbol-namespace');

	disposables.add(chatParticipant);
	return chatParticipant;
}
