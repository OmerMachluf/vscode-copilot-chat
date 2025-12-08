/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IAgentDiscoveryService } from '../../orchestrator/agentDiscoveryService';
import { IOrchestratorService } from '../../orchestrator/orchestratorServiceV2';
import { SerializedChatPart } from '../../orchestrator/workerSession';
import {
	OrchestratorSessionId,
	serializedPartToChatResponsePart,
	workerMessagesToChatHistory,
} from './orchestratorChatSessionHelpers';

const MODELS_OPTION_ID = 'model';
const AGENTS_OPTION_ID = 'agent';

// Track model and agent selections per session
const _sessionModel: Map<string, vscode.ChatSessionProviderOptionItem | undefined> = new Map();
const _sessionAgent: Map<string, vscode.ChatSessionProviderOptionItem | undefined> = new Map();

/**
 * Provides content for orchestrator sessions.
 * Converts WorkerSession state to VS Code chat session format.
 */
export class OrchestratorChatSessionContentProvider implements vscode.ChatSessionContentProvider {
	private readonly _onDidChangeChatSessionProviderOptions = new vscode.EventEmitter<void>();
	public readonly onDidChangeChatSessionProviderOptions = this._onDidChangeChatSessionProviderOptions.event;

	constructor(
		private readonly orchestratorService: IOrchestratorService,
		private readonly agentDiscoveryService: IAgentDiscoveryService,
	) { }

	/**
	 * Provide session content for display in chat UI
	 */
	async provideChatSessionContent(resource: vscode.Uri, token: vscode.CancellationToken): Promise<vscode.ChatSession> {
		console.log('OrchestratorChatSessionContentProvider: provideChatSessionContent called for', resource.toString());
		const sessionId = OrchestratorSessionId.parse(resource);

		// Find the worker - the sessionId could be a taskId OR a workerId
		const tasks = this.orchestratorService.getTasks();
		let task = tasks.find(t => t.id === sessionId);
		let workerId: string | undefined = task?.workerId;

		// If not found as task, try looking up directly as worker ID
		if (!workerId) {
			const workerState = this.orchestratorService.getWorkerState(sessionId);
			if (workerState) {
				workerId = sessionId;
				// Try to find associated task
				task = tasks.find(t => t.workerId === sessionId);
			}
		}

		if (!workerId) {
			// No worker yet - return empty session
			console.log('OrchestratorChatSessionContentProvider: No worker found for session', sessionId);
			return {
				history: [],
				options: {
					[AGENTS_OPTION_ID]: 'agent', // Default agent
					[MODELS_OPTION_ID]: 'gpt-4' // Default model placeholder
				},
				activeResponseCallback: undefined,
				requestHandler: undefined,
			};
		}

		const workerState = this.orchestratorService.getWorkerState(workerId);
		if (!workerState) {
			return {
				history: [],
				options: {
					[AGENTS_OPTION_ID]: 'agent',
					[MODELS_OPTION_ID]: 'gpt-4'
				},
				activeResponseCallback: undefined,
				requestHandler: undefined,
			};
		}

		// Convert worker messages to chat history
		const history = workerMessagesToChatHistory(workerState.messages);

		// Build options - use user's selection, or fall back to worker's actual values, then task's assigned values
		const selectedModel = _sessionModel.get(sessionId);
		const selectedAgent = _sessionAgent.get(sessionId);

		const options: Record<string, string> = {};

		// Model: user selection > worker's model > task's assigned model > default
		if (selectedModel) {
			options[MODELS_OPTION_ID] = selectedModel.id;
		} else if (workerState.modelId) {
			options[MODELS_OPTION_ID] = workerState.modelId;
		} else if (task?.modelId) {
			options[MODELS_OPTION_ID] = task.modelId;
		} else {
			// Try to get current model from orchestrator service
			const currentModel = this.orchestratorService.getWorkerModel?.(workerId!);
			options[MODELS_OPTION_ID] = currentModel || 'Default Model';
		}

		// Agent: user selection > worker's agent > task's assigned agent > default
		if (selectedAgent) {
			options[AGENTS_OPTION_ID] = selectedAgent.id;
		} else if (workerState.agentId) {
			options[AGENTS_OPTION_ID] = workerState.agentId;
		} else if (task?.agent) {
			options[AGENTS_OPTION_ID] = task.agent.replace(/^@/, '').toLowerCase();
		} else {
			// Try to get current agent from orchestrator service
			const currentAgent = this.orchestratorService.getWorkerAgent?.(workerId!);
			options[AGENTS_OPTION_ID] = currentAgent || 'agent';
		}

		// Determine if session is actively running
		const isActive = workerState.status === 'running';

		// Create active response callback if session is running
		let activeResponseCallback: ((stream: vscode.ChatResponseStream, token: vscode.CancellationToken) => Thenable<void>) | undefined;

		if (isActive) {
			activeResponseCallback = async (stream: vscode.ChatResponseStream, callbackToken: vscode.CancellationToken) => {
				// CRITICAL: Attach the REAL VS Code stream to the worker
				// This makes the worker write directly to VS Code's rendering pipeline
				// giving us the EXACT SAME UI as local agent sessions
				const workerSession = this.orchestratorService.getWorkerSession?.(workerId!);
				if (workerSession) {
					const streamDisposable = workerSession.attachStream(stream);
					// Wait for worker to finish
					await this._waitForWorkerIdle(workerId!, callbackToken);
					streamDisposable.dispose();
				} else {
					// Fallback to old streaming method if worker session not available
					await this._streamWorkerUpdates(workerId!, stream, callbackToken);
				}
			};
		}

		return {
			history,
			options,
			activeResponseCallback,
			requestHandler: undefined, // Set by participant
		};
	}

	/**
	 * Wait for worker to finish its current response
	 */
	private async _waitForWorkerIdle(workerId: string, token: vscode.CancellationToken): Promise<void> {
		return new Promise<void>((resolve) => {
			const checkStatus = () => {
				const state = this.orchestratorService.getWorkerState(workerId);
				return !state || state.status === 'idle' || state.status === 'completed' || state.status === 'error';
			};

			if (checkStatus()) {
				resolve();
				return;
			}

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

	/**
	 * Provide options for session configuration
	 */
	async provideChatSessionProviderOptions(token: vscode.CancellationToken): Promise<vscode.ChatSessionProviderOptions> {
		console.log('OrchestratorChatSessionContentProvider: provideChatSessionProviderOptions called');

		// Get available language models
		let languageModels: vscode.LanguageModelChat[] = [];
		try {
			languageModels = await vscode.lm.selectChatModels({});
			console.log(`OrchestratorChatSessionContentProvider: Found ${languageModels.length} models`);
		} catch (err) {
			console.error('OrchestratorChatSessionContentProvider: Error selecting chat models', err);
		}

		const modelItems: vscode.ChatSessionProviderOptionItem[] = languageModels.map(model => ({
			id: model.id,
			name: model.name || model.id,
		}));

		// Ensure we have at least one model (fallback)
		if (modelItems.length === 0) {
			modelItems.push({ id: 'gpt-4', name: 'GPT-4 (Default)' });
		}

		// Discover available agents
		let agents: any[] = [];
		try {
			agents = await this.agentDiscoveryService.getAvailableAgents();
			console.log(`OrchestratorChatSessionContentProvider: Found ${agents.length} agents`);
		} catch (err) {
			console.error('OrchestratorChatSessionContentProvider: Error getting agents', err);
		}

		const agentItems: vscode.ChatSessionProviderOptionItem[] = agents.map(agent => ({
			id: agent.id,
			name: agent.name,
		}));

		// Add default agent if not present
		if (!agentItems.find(a => a.id === 'agent')) {
			agentItems.unshift({ id: 'agent', name: '@agent (Default)' });
		}

		const options = {
			optionGroups: [
				{
					id: MODELS_OPTION_ID,
					name: 'Model',
					description: 'Select the language model to use',
					items: modelItems,
				},
				{
					id: AGENTS_OPTION_ID,
					name: 'Agent',
					description: 'Select the agent to use for this session',
					items: agentItems,
				},
			],
		};

		console.log('OrchestratorChatSessionContentProvider: Returning options', JSON.stringify(options));
		return options;
	}

	/**
	 * Handle option changes for a session
	 */
	async provideHandleOptionsChange(
		resource: vscode.Uri,
		updates: ReadonlyArray<vscode.ChatSessionOptionUpdate>,
		token: vscode.CancellationToken
	): Promise<void> {
		const sessionId = OrchestratorSessionId.parse(resource);

		// Find the worker for this session
		const tasks = this.orchestratorService.getTasks();
		let task = tasks.find(t => t.id === sessionId);
		let workerId = task?.workerId;
		if (!workerId) {
			const workerState = this.orchestratorService.getWorkerState(sessionId);
			if (workerState) {
				workerId = sessionId;
			}
		}

		for (const update of updates) {
			if (update.optionId === MODELS_OPTION_ID) {
				if (typeof update.value === 'undefined') {
					_sessionModel.delete(sessionId);
				} else {
					_sessionModel.set(sessionId, { id: update.value, name: update.value });
					// Apply model change to worker if it exists
					if (workerId) {
						this.orchestratorService.setWorkerModel?.(workerId, update.value);
					}
				}
			} else if (update.optionId === AGENTS_OPTION_ID) {
				if (typeof update.value === 'undefined') {
					_sessionAgent.delete(sessionId);
				} else {
					_sessionAgent.set(sessionId, { id: update.value, name: update.value });
					// Apply agent change to worker if it exists
					if (workerId) {
						await this.orchestratorService.setWorkerAgent?.(workerId, update.value);
					}
				}
			}
		}
	}

	/**
	 * Stream worker updates to the chat response stream
	 * Uses real-time stream events from WorkerSession for instant updates
	 */
	private async _streamWorkerUpdates(
		workerId: string,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<void> {
		return new Promise<void>((resolve) => {
			// Get the worker session to subscribe to events
			const workerSession = this.orchestratorService.getWorkerSession?.(workerId);

			if (!workerSession) {
				// Fall back to polling if we can't get the session
				this._streamWorkerUpdatesByPolling(workerId, stream, token).then(resolve);
				return;
			}

			const disposables: vscode.Disposable[] = [];

			// Subscribe to real-time stream parts
			disposables.push(workerSession.onStreamPart((part: SerializedChatPart) => {
				if (token.isCancellationRequested) {
					return;
				}
				this._streamPart(stream, part);
			}));

			// Subscribe to stream end
			disposables.push(workerSession.onStreamEnd(() => {
				// Stream ended - clean up and resolve
				disposables.forEach(d => d.dispose());
				resolve();
			}));

			// Subscribe to worker completion
			disposables.push(workerSession.onDidComplete(() => {
				disposables.forEach(d => d.dispose());
				resolve();
			}));

			// Subscribe to worker stop
			disposables.push(workerSession.onDidStop(() => {
				disposables.forEach(d => d.dispose());
				resolve();
			}));

			// Handle cancellation
			token.onCancellationRequested(() => {
				disposables.forEach(d => d.dispose());
				resolve();
			});

			// Also check status periodically in case events are missed
			const checkInterval = setInterval(() => {
				const state = this.orchestratorService.getWorkerState(workerId);
				if (!state || state.status !== 'running') {
					clearInterval(checkInterval);
					disposables.forEach(d => d.dispose());
					resolve();
				}
			}, 1000);

			disposables.push({ dispose: () => clearInterval(checkInterval) });
		});
	}

	/**
	 * Fallback: Stream worker updates by polling (used when event subscription unavailable)
	 */
	private async _streamWorkerUpdatesByPolling(
		workerId: string,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<void> {
		return new Promise<void>((resolve) => {
			const workerState = this.orchestratorService.getWorkerState(workerId);
			if (!workerState) {
				resolve();
				return;
			}

			let lastMessageCount = workerState.messages.length;
			let lastPartIndex = 0;

			const getLastMessageParts = (): readonly SerializedChatPart[] | undefined => {
				const state = this.orchestratorService.getWorkerState(workerId);
				if (!state || state.messages.length === 0) {
					return undefined;
				}
				const lastMsg = state.messages[state.messages.length - 1];
				return lastMsg.role === 'assistant' ? lastMsg.parts : undefined;
			};

			const interval = setInterval(() => {
				if (token.isCancellationRequested) {
					clearInterval(interval);
					resolve();
					return;
				}

				const currentState = this.orchestratorService.getWorkerState(workerId);
				if (!currentState) {
					clearInterval(interval);
					resolve();
					return;
				}

				if (currentState.messages.length > lastMessageCount) {
					for (let i = lastMessageCount; i < currentState.messages.length; i++) {
						const msg = currentState.messages[i];
						if (msg.role === 'assistant') {
							if (msg.parts && msg.parts.length > 0) {
								this._streamParts(stream, msg.parts);
							} else {
								stream.markdown(msg.content);
							}
						} else if (msg.role === 'system') {
							stream.progress(msg.content);
						} else if (msg.role === 'tool' && msg.toolName) {
							stream.prepareToolInvocation(msg.toolName);
						}
					}
					lastMessageCount = currentState.messages.length;
					const parts = getLastMessageParts();
					lastPartIndex = parts?.length ?? 0;
				} else {
					const parts = getLastMessageParts();
					if (parts && parts.length > lastPartIndex) {
						const newParts = parts.slice(lastPartIndex);
						this._streamParts(stream, newParts);
						lastPartIndex = parts.length;
					}
				}

				if (currentState.status !== 'running') {
					clearInterval(interval);
					resolve();
				}
			}, 50);  // Fast polling for responsive streaming

			token.onCancellationRequested(() => {
				clearInterval(interval);
				resolve();
			});
		});
	}

	/**
	 * Stream a single serialized part to the response stream
	 */
	private _streamPart(stream: vscode.ChatResponseStream, part: SerializedChatPart): void {
		switch (part.type) {
			case 'markdown':
				if (part.content) {
					stream.markdown(part.content);
				}
				break;

			case 'progress':
				if (part.progressMessage) {
					stream.progress(part.progressMessage);
				}
				break;

			case 'reference':
			case 'anchor':
				if (part.uri) {
					const uri = vscode.Uri.parse(part.uri);
					if (part.range) {
						const range = new vscode.Range(
							part.range.startLine,
							part.range.startChar,
							part.range.endLine,
							part.range.endChar
						);
						stream.reference(new vscode.Location(uri, range));
					} else {
						stream.reference(uri);
					}
				}
				break;

			case 'toolInvocation':
				if (part.toolName) {
					const converted = serializedPartToChatResponsePart(part);
					if (converted) {
						stream.push(converted as vscode.ChatResponsePart);
					}
				}
				break;

			case 'thinkingProgress':
				if (part.content) {
					const thinkingPart = new vscode.ChatResponseThinkingProgressPart(part.content);
					stream.push(thinkingPart as unknown as vscode.ChatResponsePart);
				}
				break;

			case 'warning':
				if (part.content) {
					stream.markdown(`⚠️ ${part.content}`);
				}
				break;

			case 'error':
				if (part.content) {
					stream.markdown(`❌ ${part.content}`);
				}
				break;

			case 'confirmation':
				if (part.title || part.content) {
					stream.markdown(`**${part.title ?? 'Confirmation'}**: ${part.content ?? ''}`);
				}
				break;

			case 'filetree':
				// FileTree needs special handling
				if (part.uri && part.content) {
					try {
						const treeData = JSON.parse(part.content);
						stream.filetree(treeData, vscode.Uri.parse(part.uri));
					} catch {
						stream.markdown(`[File tree: ${part.uri}]`);
					}
				}
				break;

			default:
				// For unknown types, try generic conversion or show as markdown
				if (part.content) {
					stream.markdown(part.content);
				}
				break;
		}
	}

	/**
	 * Stream multiple parts to the response stream
	 */
	private _streamParts(stream: vscode.ChatResponseStream, parts: readonly SerializedChatPart[]): void {
		for (const part of parts) {
			this._streamPart(stream, part);
		}
	}

	/**
	 * Get the selected model for a session
	 */
	getSelectedModel(taskId: string): string | undefined {
		return _sessionModel.get(taskId)?.id;
	}

	/**
	 * Get the selected agent for a session
	 */
	getSelectedAgent(taskId: string): string | undefined {
		return _sessionAgent.get(taskId)?.id;
	}
}
