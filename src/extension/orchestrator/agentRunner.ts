/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ChatLocation } from '../../platform/chat/common/commonTypes';
import { CancellationToken } from '../../util/vs/base/common/cancellation';
import { Event } from '../../util/vs/base/common/event';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { generateUuid } from '../../util/vs/base/common/uuid';
import { createDecorator, IInstantiationService } from '../../util/vs/platform/instantiation/common/instantiation';
import { Intent } from '../common/constants';
import { IIntentService } from '../intents/node/intentService';
import { Conversation, Turn, TurnStatus } from '../prompt/common/conversation';
import { ChatTelemetryBuilder } from '../prompt/node/chatParticipantTelemetry';
import { DefaultIntentRequestHandler, IDefaultIntentRequestHandlerOptions } from '../prompt/node/defaultIntentRequestHandler';
import { getContributedToolName } from '../tools/common/toolNames';
import { IToolsService } from '../tools/common/toolsService';
import { WorkerToolSet } from './workerToolsService';
import { injectSubTaskResultsIntoContext } from './injectSubTaskResults';
import { SubTaskResultAggregator } from './subTaskAggregator';
import { IAgentHistoryEntry, IAgentRunner, IAgentRunOptions, IAgentRunResult, ISubTaskManager } from './orchestratorInterfaces';
export { IAgentHistoryEntry, IAgentRunner, IAgentRunOptions, IAgentRunResult };

/**
 * Implementation of the agent runner service
 */
export class AgentRunnerService extends Disposable implements IAgentRunner {
	readonly _serviceBrand: undefined;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IToolsService private readonly _toolsService: IToolsService,
		@IIntentService private readonly _intentService: IIntentService,
	) {
		super();
	}

	async run(options: IAgentRunOptions, stream: vscode.ChatResponseStream): Promise<IAgentRunResult> {
		const {
			prompt,
			sessionId = generateUuid(),
			model,
			suggestedFiles,
			additionalInstructions,
			token,
			onPaused = Event.None,
			maxToolCallIterations = 200,
			workerToolSet,
			worktreePath,
			history,
		} = options;

		// Determine the effective worktree path (from workerToolSet or legacy option)
		const effectiveWorktreePath = workerToolSet?.worktreePath ?? worktreePath;

		// Determine which instantiation service and tools service to use
		// If a workerToolSet is provided, use its scoped services for proper worktree isolation
		const instantiationService = workerToolSet?.scopedInstantiationService ?? this._instantiationService;
		const toolsService: IToolsService = workerToolSet ?? this._toolsService;

		try {
			// Build final prompt with any additional instructions and worktree context
			// Order: worktree context -> additional instructions -> task prompt
			const promptParts: string[] = [];

			// Prepend worktree instructions if operating in a worktree
			// This ensures tools use absolute paths in the worktree directory
			if (effectiveWorktreePath) {
				promptParts.push(`IMPORTANT: You are working in a git worktree located at: ${effectiveWorktreePath}
All file operations (create, edit, read) MUST use absolute paths within this worktree directory.
When using tools like create_file, replace_string_in_file, read_file, etc., always use the full absolute path starting with "${effectiveWorktreePath}".
Do NOT use paths relative to any other workspace folder.`);
			}

			// Add any additional instructions
			if (additionalInstructions) {
				promptParts.push(additionalInstructions);
			}

			// Add the actual task prompt
			promptParts.push(prompt);

			const finalPrompt = promptParts.join('\n\n');

			// Create a synthetic ChatRequest with all tools enabled
			const request = this._createRequest(finalPrompt, model, toolsService, suggestedFiles, effectiveWorktreePath);

			// Get the agent intent at Agent location (for headless/orchestrator execution)
			const intent = this._intentService.getIntent(Intent.Agent, ChatLocation.Agent);
			if (!intent) {
				return {
					success: false,
					error: 'Agent intent not available',
				};
			}

			// Build turns from history + current request
			const turns: Turn[] = [];

			// Add history turns if provided
			if (history && history.length > 0) {
				// Process history in pairs (user message followed by assistant response)
				let i = 0;
				while (i < history.length) {
					const entry = history[i];
					if (entry.role === 'user') {
						// Create a turn for this user message
						const historyTurnId = generateUuid();
						const historyRequest = this._createRequest(entry.content, model, toolsService, undefined, effectiveWorktreePath);
						const historyTurn = Turn.fromRequest(historyTurnId, historyRequest);

						// Look for the following assistant response
						if (i + 1 < history.length && history[i + 1].role === 'assistant') {
							const assistantContent = history[i + 1].content;
							historyTurn.setResponse(
								TurnStatus.Success,
								{ type: 'model', message: assistantContent },
								generateUuid(),
								{ metadata: {} }
							);
							i += 2; // Skip both user and assistant
						} else {
							// User message without response, still include it
							i++;
						}
						turns.push(historyTurn);
					} else {
						// Skip orphan assistant messages (shouldn't happen in well-formed history)
						i++;
					}
				}
			}

			// Create the current turn from the request
			const turnId = generateUuid();
			const turn = Turn.fromRequest(turnId, request);
			turns.push(turn);

			// Create conversation with all turns (history + current)
			const conversation = new Conversation(sessionId, turns);

			// Determine if this is the first turn (for telemetry)
			const isFirstTurn = turns.length === 1;

			// Create telemetry builder using the (possibly scoped) instantiation service
			const chatTelemetry = instantiationService.createInstance(
				ChatTelemetryBuilder,
				Date.now(),
				sessionId,
				undefined, // documentContext
				isFirstTurn,
				request
			);

			// Handler options for agent mode
			const handlerOptions: IDefaultIntentRequestHandlerOptions = {
				maxToolCallIterations,
				temperature: 0,
				overrideRequestLocation: ChatLocation.Agent,
				hideRateLimitTimeEstimate: true,
			};

			// Use the intent's handleRequest if available, otherwise use DefaultIntentRequestHandler
			let result: vscode.ChatResult;
			if (typeof intent.handleRequest === 'function') {
				result = await intent.handleRequest(
					conversation,
					request,
					stream,
					token,
					undefined, // documentContext
					'copilot',
					ChatLocation.Agent,
					chatTelemetry,
					onPaused
				);
			} else {
				// Create handler using the (possibly scoped) instantiation service
				// This ensures all tools created by the handler use the scoped workspace
				const handler = instantiationService.createInstance(
					DefaultIntentRequestHandler,
					intent,
					conversation,
					request,
					stream,
					token,
					undefined, // documentContext
					ChatLocation.Agent,
					chatTelemetry,
					handlerOptions,
					onPaused,
					'copilot', // agentName - orchestrator agents use 'copilot' as the agent name
				);
				result = await handler.getResult();
			}

			// Inject sub-task results if applicable
			if (result.metadata && Array.isArray((result.metadata as any).subTaskIds)) {
				try {
					const aggregator = new SubTaskResultAggregator();
					const subTaskManager = this._instantiationService.invokeFunction(accessor => accessor.get(ISubTaskManager));
					await injectSubTaskResultsIntoContext(result.metadata, (result.metadata as any).subTaskIds, subTaskManager, aggregator);
				} catch (e) {
					// eslint-disable-next-line no-console
					console.warn('Failed to inject sub-task results:', e);
				}
			}

			return {
				success: !result.errorDetails,
				error: result.errorDetails?.message,
				response: turn.responseMessage?.message,
				metadata: result.metadata as Record<string, unknown>,
			};

		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Creates a synthetic ChatRequest for programmatic agent execution.
	 * This populates all required fields and enables all available tools.
	 * If worktreePath is provided, file operations will target that directory.
	 */
	private _createRequest(
		prompt: string,
		model: vscode.LanguageModelChat,
		toolsService: IToolsService,
		suggestedFiles?: string[],
		worktreePath?: string
	): vscode.ChatRequest {
		const sessionId = generateUuid();
		// Use worktreePath if provided, otherwise fall back to main workspace
		const workspaceFolder = worktreePath
			? vscode.Uri.file(worktreePath)
			: vscode.workspace.workspaceFolders?.[0]?.uri;

		// Build file references from suggested files
		const references: vscode.ChatPromptReference[] = [];
		if (suggestedFiles && workspaceFolder) {
			const path = require('path');
			for (const filePath of suggestedFiles) {
				const fileUri = path.isAbsolute(filePath)
					? vscode.Uri.file(filePath)
					: vscode.Uri.joinPath(workspaceFolder, filePath);

				references.push({
					id: 'vscode.file',
					name: path.basename(filePath),
					value: fileUri,
				});
			}
		}

		// If we have a worktree, add it as a reference so the agent knows the context
		if (worktreePath) {
			references.push({
				id: 'vscode.folder',
				name: 'Worktree',
				value: vscode.Uri.file(worktreePath),
			});
		}

		// Enable all available tools from the provided tools service
		// This uses the worker's scoped tools when a workerToolSet is provided
		const toolsMap = new Map<string, boolean>();
		for (const tool of toolsService.tools) {
			toolsMap.set(getContributedToolName(tool.name), true);
		}

		return {
			prompt,
			command: undefined,
			references,
			toolReferences: [],
			variables: {},
			id: generateUuid(),
			sessionId,
			model,
			tools: toolsMap,
			location: vscode.ChatLocation.Panel,
			attempt: 0,
			enableCommandDetection: false,
			justification: undefined,
			acceptedConfirmationData: undefined,
			editedFileEvents: undefined,
			isParticipantDetected: false,
			toolInvocationToken: undefined as never,
		} as unknown as vscode.ChatRequest;
	}

	/**
	 * Summarize conversation context for a model switch.
	 * Uses the current model to generate a summary that can be passed to a new model.
	 * This is particularly useful when switching to a model with a smaller context window.
	 */
	async summarizeContextForModelSwitch(
		currentHistory: IAgentHistoryEntry[],
		targetModel: string,
		currentModel: vscode.LanguageModelChat
	): Promise<string> {
		if (currentHistory.length === 0) {
			return '';
		}

		// Build a summary prompt
		const historyText = currentHistory.map(entry => {
			const role = entry.role === 'user' ? 'User' : 'Assistant';
			return `${role}: ${entry.content}`;
		}).join('\n\n');

		const summaryPrompt = `You are helping to summarize a conversation for a model switch.
The conversation will continue with a different AI model (${targetModel}).
Please provide a concise summary of the key points from this conversation:

1. What was the original task/request?
2. What has been accomplished so far?
3. What is the current state?
4. What are the next steps or pending items?

Here is the conversation history:

${historyText}

Please provide a clear, structured summary that preserves the essential context needed to continue the task.`;

		try {
			// Use the current model to generate the summary
			const messages = [
				vscode.LanguageModelChatMessage.User(summaryPrompt)
			];

			const response = await currentModel.sendRequest(messages, {});

			// Collect the response
			let summary = '';
			for await (const chunk of response.text) {
				summary += chunk;
			}

			return summary.trim();
		} catch (error) {
			// If summarization fails, return a basic summary
			const fallbackSummary: string[] = [
				'## Context Summary (auto-generated)',
				'',
				`Previous messages: ${currentHistory.length}`,
			];

			// Extract key info from history
			const userMessages = currentHistory.filter(e => e.role === 'user');
			if (userMessages.length > 0) {
				fallbackSummary.push('');
				fallbackSummary.push('### Recent User Requests');
				for (const msg of userMessages.slice(-3)) {
					const truncated = msg.content.length > 200
						? msg.content.substring(0, 200) + '...'
						: msg.content;
					fallbackSummary.push(`- ${truncated}`);
				}
			}

			return fallbackSummary.join('\n');
		}
	}
}
