/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SerializedChatPart, WorkerMessage, WorkerStatus } from '../../orchestrator/workerSession';

/**
 * Session ID utilities for orchestrator sessions
 */
export namespace OrchestratorSessionId {
	const SCHEME = 'orchestrator';

	/**
	 * Create a session URI from a task ID
	 */
	export function getResource(taskId: string): vscode.Uri {
		return vscode.Uri.from({
			scheme: SCHEME,
			path: `/${taskId}`,
		});
	}

	/**
	 * Parse a task ID from a session URI
	 */
	export function parse(resource: vscode.Uri): string {
		return resource.path.slice(1);
	}

	/**
	 * Check if a URI is an orchestrator session URI
	 */
	export function isOrchestratorSession(resource: vscode.Uri): boolean {
		return resource.scheme === SCHEME;
	}
}

/**
 * Convert WorkerStatus to ChatSessionStatus
 */
export function workerStatusToChatSessionStatus(status: WorkerStatus): vscode.ChatSessionStatus {
	switch (status) {
		case 'running':
		case 'waiting-approval':
		case 'paused':
			return vscode.ChatSessionStatus.InProgress;
		case 'completed':
		case 'idle':
			return vscode.ChatSessionStatus.Completed;
		case 'error':
			return vscode.ChatSessionStatus.Failed;
		default:
			return vscode.ChatSessionStatus.Completed;
	}
}

/**
 * Extended response part type that includes all possible parts
 */
type ExtendedResponsePart = vscode.ChatResponsePart | vscode.ChatToolInvocationPart | vscode.ChatResponseThinkingProgressPart;

/**
 * Convert a SerializedChatPart back to an actual ChatResponsePart
 */
export function serializedPartToChatResponsePart(part: SerializedChatPart): ExtendedResponsePart | undefined {
	switch (part.type) {
		case 'markdown':
			return new vscode.ChatResponseMarkdownPart(new vscode.MarkdownString(part.content ?? ''));

		case 'progress':
			return new vscode.ChatResponseProgressPart(part.progressMessage ?? '');

		case 'reference':
			if (part.uri) {
				const uri = vscode.Uri.parse(part.uri);
				if (part.range) {
					const range = new vscode.Range(
						part.range.startLine,
						part.range.startChar,
						part.range.endLine,
						part.range.endChar
					);
					return new vscode.ChatResponseAnchorPart(new vscode.Location(uri, range), part.content);
				}
				return new vscode.ChatResponseAnchorPart(uri, part.content);
			}
			return undefined;

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
					return new vscode.ChatResponseAnchorPart(new vscode.Location(uri, range), part.content);
				}
				return new vscode.ChatResponseAnchorPart(uri, part.content);
			}
			return undefined;

		case 'toolInvocation':
			if (part.toolName && part.toolCallId) {
				const toolPart = new vscode.ChatToolInvocationPart(part.toolName, part.toolCallId);
				toolPart.isComplete = part.isComplete ?? true;
				toolPart.isConfirmed = part.isConfirmed ?? true;
				toolPart.isError = part.isError ?? false;
				if (part.invocationMessage) {
					toolPart.invocationMessage = new vscode.MarkdownString(part.invocationMessage);
				}
				if (part.pastTenseMessage) {
					toolPart.pastTenseMessage = new vscode.MarkdownString(part.pastTenseMessage);
				}
				// Note: toolSpecificData requires specific shape, skip for now
				return toolPart;
			} else if (part.toolName) {
				// Just a prepareToolInvocation
				const toolPart = new vscode.ChatToolInvocationPart(part.toolName, part.toolName);
				toolPart.isComplete = false;
				toolPart.isConfirmed = false;
				return toolPart;
			}
			return undefined;

		case 'thinkingProgress':
			return new vscode.ChatResponseThinkingProgressPart(part.content ?? '');

		case 'warning':
			return new vscode.ChatResponseMarkdownPart(new vscode.MarkdownString(`⚠️ ${part.content ?? ''}`));

		case 'error':
			return new vscode.ChatResponseMarkdownPart(new vscode.MarkdownString(`❌ ${part.content ?? ''}`));

		case 'confirmation':
			// Confirmations can't be fully reconstructed, show as markdown
			const confirmText = `**${part.title ?? 'Confirmation'}**: ${part.content ?? ''}`;
			return new vscode.ChatResponseMarkdownPart(new vscode.MarkdownString(confirmText));

		default:
			return undefined;
	}
}

/**
 * Convert an array of SerializedChatParts to ChatResponseParts
 */
export function serializedPartsToChatResponseParts(parts: readonly SerializedChatPart[]): ExtendedResponsePart[] {
	const result: ExtendedResponsePart[] = [];
	for (const part of parts) {
		const converted = serializedPartToChatResponsePart(part);
		if (converted) {
			result.push(converted);
		}
	}
	return result;
}

/**
 * Convert WorkerMessages to chat history format
 * Uses rich parts when available for the full agent session experience
 */
export function workerMessagesToChatHistory(messages: readonly WorkerMessage[]): (vscode.ChatRequestTurn | vscode.ChatResponseTurn2)[] {
	const history: (vscode.ChatRequestTurn | vscode.ChatResponseTurn2)[] = [];

	let i = 0;
	while (i < messages.length) {
		const message = messages[i];

		if (message.role === 'user') {
			// Create a request turn
			const requestTurn = new vscode.ChatRequestTurn2(
				message.content,
				undefined, // command
				[], // references
				'orchestrator', // participant
				[], // toolReferences
				undefined, // editedFileEvents
				undefined // id
			);
			history.push(requestTurn);

			// Look for following assistant messages to create response turn
			// Use ExtendedResponsePart to support tool invocations and thinking progress
			const responseParts: ExtendedResponsePart[] = [];
			let j = i + 1;
			while (j < messages.length && messages[j].role !== 'user') {
				const responseMsg = messages[j];
				if (responseMsg.role === 'assistant') {
					// Use rich parts if available, otherwise fall back to plain content
					if (responseMsg.parts && responseMsg.parts.length > 0) {
						responseParts.push(...serializedPartsToChatResponseParts(responseMsg.parts));
					} else {
						responseParts.push(new vscode.ChatResponseMarkdownPart(new vscode.MarkdownString(responseMsg.content)));
					}
				} else if (responseMsg.role === 'system') {
					// System messages shown as progress-like markdown
					const md = new vscode.MarkdownString(`*${responseMsg.content}*`);
					responseParts.push(new vscode.ChatResponseMarkdownPart(md));
				} else if (responseMsg.role === 'tool') {
					// Tool messages can be represented as tool invocations
					if (responseMsg.toolName && responseMsg.toolCallId) {
						const toolPart = new vscode.ChatToolInvocationPart(responseMsg.toolName, responseMsg.toolCallId);
						toolPart.isComplete = true;
						toolPart.isConfirmed = true;
						toolPart.invocationMessage = new vscode.MarkdownString(responseMsg.toolName);
						responseParts.push(toolPart);
					}
				}
				j++;
			}

			if (responseParts.length > 0) {
				const responseTurn = new vscode.ChatResponseTurn2(
					responseParts as vscode.ChatResponsePart[],
					{}, // result
					'orchestrator' // participant
				);
				history.push(responseTurn);
			}

			i = j;
		} else {
			// Skip non-user messages that aren't part of a request-response pair
			i++;
		}
	}

	return history;
}

/**
 * Escape XML special characters for safe embedding
 */
export function escapeXml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/**
 * Format a timestamp for display
 */
export function formatTimestamp(timestamp: number): string {
	const date = new Date(timestamp);
	const now = new Date();
	const diff = now.getTime() - date.getTime();

	// Less than a minute
	if (diff < 60 * 1000) {
		return 'just now';
	}

	// Less than an hour
	if (diff < 60 * 60 * 1000) {
		const minutes = Math.floor(diff / (60 * 1000));
		return `${minutes}m ago`;
	}

	// Less than a day
	if (diff < 24 * 60 * 60 * 1000) {
		const hours = Math.floor(diff / (60 * 60 * 1000));
		return `${hours}h ago`;
	}

	// Format as date
	return date.toLocaleDateString();
}

/**
 * Get status icon for worker status
 */
export function getStatusIcon(status: WorkerStatus): string {
	switch (status) {
		case 'running':
			return '$(sync~spin)';
		case 'waiting-approval':
			return '$(question)';
		case 'paused':
			return '$(debug-pause)';
		case 'idle':
			return '$(check)';
		case 'completed':
			return '$(check-all)';
		case 'error':
			return '$(error)';
		default:
			return '$(circle-outline)';
	}
}

/**
 * Get human-readable status text
 */
export function getStatusText(status: WorkerStatus): string {
	switch (status) {
		case 'running':
			return 'Running';
		case 'waiting-approval':
			return 'Awaiting Approval';
		case 'paused':
			return 'Paused';
		case 'idle':
			return 'Idle';
		case 'completed':
			return 'Completed';
		case 'error':
			return 'Error';
		default:
			return status;
	}
}
