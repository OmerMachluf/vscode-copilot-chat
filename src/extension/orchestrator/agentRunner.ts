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
import { Conversation, Turn } from '../prompt/common/conversation';
import { ChatTelemetryBuilder } from '../prompt/node/chatParticipantTelemetry';
import { DefaultIntentRequestHandler, IDefaultIntentRequestHandlerOptions } from '../prompt/node/defaultIntentRequestHandler';
import { getContributedToolName } from '../tools/common/toolNames';
import { IToolsService } from '../tools/common/toolsService';
import { WorkerToolSet } from './workerToolsService';

export const IAgentRunner = createDecorator<IAgentRunner>('agentRunner');

/**
 * Options for running an agent task programmatically
 */
export interface IAgentRunOptions {
	/** The prompt/instruction for the agent */
	prompt: string;

	/** Optional session ID for conversation continuity */
	sessionId?: string;

	/** The language model to use */
	model: vscode.LanguageModelChat;

	/** Suggested files to include as context */
	suggestedFiles?: string[];

	/** Additional context instructions */
	additionalInstructions?: string;

	/** Cancellation token */
	token: CancellationToken;

	/** Event fired when the agent should pause/resume */
	onPaused?: Event<boolean>;

	/** Maximum tool call iterations (defaults to 200 for agent mode) */
	maxToolCallIterations?: number;

	/**
	 * Worker tool set for scoped tool access.
	 * When provided, uses the worker's scoped instantiation service and tools.
	 * This ensures tools operate within the worker's worktree.
	 */
	workerToolSet?: WorkerToolSet;

	/**
	 * @deprecated Use workerToolSet instead for proper tool scoping.
	 * Worktree path for file operations (if different from main workspace).
	 * Only used for prompt context when workerToolSet is not provided.
	 */
	worktreePath?: string;

	/** Callback invoked when a message is added to the conversation */
	onMessageAdded?: (message: { role: 'user' | 'assistant' | 'tool'; content: string }) => void;
}

/**
 * Result from running an agent task
 */
export interface IAgentRunResult {
	/** Whether the task completed successfully */
	success: boolean;

	/** Error message if failed */
	error?: string;

	/** The response text from the agent */
	response?: string;

	/** Metadata from the chat result */
	metadata?: Record<string, unknown>;
}

/**
 * Service for running agent tasks programmatically without requiring a ChatRequest.
 * This abstracts away the VS Code chat UI concerns and provides a clean API for
 * executing agent tasks with full tool capabilities.
 */
export interface IAgentRunner {
	readonly _serviceBrand: undefined;

	/**
	 * Run an agent task with the given options.
	 * Returns the result of the agent execution.
	 */
	run(options: IAgentRunOptions, stream: vscode.ChatResponseStream): Promise<IAgentRunResult>;
}

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

			// Create conversation with a single turn
			const turnId = generateUuid();
			const turn = Turn.fromRequest(turnId, request);
			const conversation = new Conversation(sessionId, [turn]);

			// Create telemetry builder using the (possibly scoped) instantiation service
			const chatTelemetry = instantiationService.createInstance(
				ChatTelemetryBuilder,
				Date.now(),
				sessionId,
				undefined, // documentContext
				true, // isFirstTurn
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
					onPaused
				);
				result = await handler.getResult();
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
}
