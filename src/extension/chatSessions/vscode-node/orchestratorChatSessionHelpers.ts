/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	SerializedChatPart,
	SerializedMarkdownString,
	SerializedRange,
	SerializedIconPath,
	WorkerMessage,
	WorkerStatus
} from '../../orchestrator/workerSession';

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
type ExtendedResponsePart =
	| vscode.ChatResponsePart
	| vscode.ChatToolInvocationPart
	| vscode.ChatResponseThinkingProgressPart
	| vscode.ChatPrepareToolInvocationPart
	| vscode.ChatResponseTextEditPart
	| vscode.ChatResponseNotebookEditPart
	| vscode.ChatResponseConfirmationPart
	| vscode.ChatResponseCodeCitationPart
	| vscode.ChatResponseCodeblockUriPart
	| vscode.ChatResponseWarningPart
	| vscode.ChatResponseMovePart
	| vscode.ChatResponseMultiDiffPart
	| vscode.ChatResponsePullRequestPart
	| vscode.ChatResponseExtensionsPart
	| vscode.ChatResponseMarkdownWithVulnerabilitiesPart;

// ============================================================================
// Deserialization Helpers
// ============================================================================

/**
 * Convert a serialized MarkdownString back to vscode.MarkdownString
 */
function deserializeMarkdownString(content: string | SerializedMarkdownString | undefined): vscode.MarkdownString {
	if (!content) {
		return new vscode.MarkdownString('');
	}

	if (typeof content === 'string') {
		return new vscode.MarkdownString(content);
	}

	const md = new vscode.MarkdownString(content.value);
	if (content.isTrusted !== undefined) {
		md.isTrusted = content.isTrusted;
	}
	if (content.supportThemeIcons !== undefined) {
		md.supportThemeIcons = content.supportThemeIcons;
	}
	if (content.supportHtml !== undefined) {
		md.supportHtml = content.supportHtml;
	}
	if (content.baseUri) {
		md.baseUri = vscode.Uri.parse(content.baseUri);
	}
	return md;
}

/**
 * Get string value from content (handles both string and SerializedMarkdownString)
 */
function getContentString(content: string | SerializedMarkdownString | undefined): string {
	if (!content) {
		return '';
	}
	return typeof content === 'string' ? content : content.value;
}

/**
 * Convert a serialized range back to vscode.Range
 */
function deserializeRange(range: SerializedRange): vscode.Range {
	return new vscode.Range(
		range.startLine,
		range.startChar,
		range.endLine,
		range.endChar
	);
}

/**
 * Convert a serialized icon path to vscode icon path
 */
function deserializeIconPath(iconPath: SerializedIconPath | undefined): vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri } | undefined {
	if (!iconPath) {
		return undefined;
	}
	if (iconPath.themeIcon) {
		return new vscode.ThemeIcon(iconPath.themeIcon);
	}
	if (iconPath.light && iconPath.dark) {
		return {
			light: vscode.Uri.parse(iconPath.light),
			dark: vscode.Uri.parse(iconPath.dark)
		};
	}
	if (iconPath.light) {
		return vscode.Uri.parse(iconPath.light);
	}
	return undefined;
}

/**
 * Convert a serialized TextEdit to vscode.TextEdit
 */
function deserializeTextEdit(edit: { range: SerializedRange; newText: string }): vscode.TextEdit {
	return new vscode.TextEdit(deserializeRange(edit.range), edit.newText);
}

/**
 * Convert a SerializedChatPart back to an actual ChatResponsePart
 * Supports ALL VS Code chat part types for 100% UI fidelity
 */
export function serializedPartToChatResponsePart(part: SerializedChatPart): ExtendedResponsePart | undefined {
	switch (part.type) {
		// ========================================
		// Markdown Parts
		// ========================================
		case 'markdown':
			return new vscode.ChatResponseMarkdownPart(deserializeMarkdownString(part.content));

		case 'markdownWithVulnerabilities':
			if (part.vulnerabilities) {
				return new vscode.ChatResponseMarkdownWithVulnerabilitiesPart(
					deserializeMarkdownString(part.content),
					part.vulnerabilities as { title: string; description: string }[]
				);
			}
			return new vscode.ChatResponseMarkdownPart(deserializeMarkdownString(part.content));

		// ========================================
		// Progress Parts
		// ========================================
		case 'progress':
			return new vscode.ChatResponseProgressPart(part.progressMessage ?? getContentString(part.content));

		case 'thinkingProgress':
			return new vscode.ChatResponseThinkingProgressPart(
				getContentString(part.content),
				part.thinkingId,
				part.thinkingMetadata as { readonly [key: string]: unknown } | undefined
			);

		// ========================================
		// Reference/Anchor Parts
		// ========================================
		case 'reference': {
			const uri = part.uri ? vscode.Uri.parse(part.uri) : undefined;
			if (!uri) {
				return undefined;
			}
			let value: vscode.Uri | vscode.Location = uri;
			if (part.range) {
				value = new vscode.Location(uri, deserializeRange(part.range));
			}
			const refPart = new vscode.ChatResponseReferencePart(value);
			// Apply icon path if available
			const iconPath = deserializeIconPath(part.iconPath);
			if (iconPath) {
				(refPart as { iconPath?: typeof iconPath }).iconPath = iconPath;
			}
			return refPart;
		}

		case 'anchor': {
			const uri = part.uri ? vscode.Uri.parse(part.uri) : undefined;
			if (!uri) {
				return undefined;
			}
			if (part.range) {
				const location = new vscode.Location(uri, deserializeRange(part.range));
				return new vscode.ChatResponseAnchorPart(location, getContentString(part.content));
			}
			return new vscode.ChatResponseAnchorPart(uri, getContentString(part.content));
		}

		// ========================================
		// Tool Invocation Parts
		// ========================================
		case 'toolInvocation': {
			if (!part.toolName || !part.toolCallId) {
				return undefined;
			}
			const toolPart = new vscode.ChatToolInvocationPart(part.toolName, part.toolCallId);
			toolPart.isComplete = part.isComplete ?? true;
			toolPart.isConfirmed = part.isConfirmed ?? true;
			toolPart.isError = part.isError ?? false;

			if (part.invocationMessage) {
				toolPart.invocationMessage = deserializeMarkdownString(part.invocationMessage);
			}
			if (part.pastTenseMessage) {
				toolPart.pastTenseMessage = deserializeMarkdownString(part.pastTenseMessage);
			}
			if (part.originMessage) {
				toolPart.originMessage = deserializeMarkdownString(part.originMessage);
			}
			if (part.fromSubAgent !== undefined) {
				toolPart.fromSubAgent = part.fromSubAgent;
			}
			if (part.presentation && part.presentation !== 'default') {
				toolPart.presentation = part.presentation;
			}
			if (part.toolSpecificData) {
				toolPart.toolSpecificData = deserializeToolSpecificData(part.toolSpecificData);
			}
			return toolPart;
		}

		case 'prepareToolInvocation':
			if (part.toolName) {
				return new vscode.ChatPrepareToolInvocationPart(part.toolName);
			}
			return undefined;

		// ========================================
		// Confirmation Part
		// ========================================
		case 'confirmation': {
			const title = part.title ?? 'Confirmation';
			const message = deserializeMarkdownString(part.message ?? part.content);
			const buttons = part.buttons ? [...part.buttons] : undefined;
			return new vscode.ChatResponseConfirmationPart(title, message, part.data, buttons);
		}

		// ========================================
		// Warning Part
		// ========================================
		case 'warning':
			return new vscode.ChatResponseWarningPart(deserializeMarkdownString(part.content));

		// ========================================
		// File Tree Part
		// ========================================
		case 'filetree': {
			if (!part.treeItems || !part.baseUri) {
				return undefined;
			}
			const baseUri = vscode.Uri.parse(part.baseUri);
			const items = part.treeItems.map(function convertItem(item): vscode.ChatResponseFileTree {
				return {
					name: item.name,
					children: item.children?.map(convertItem)
				};
			});
			return new vscode.ChatResponseFileTreePart(items, baseUri);
		}

		// ========================================
		// Text Edit Part
		// ========================================
		case 'textEdit': {
			if (!part.uri || !part.edits) {
				return undefined;
			}
			const uri = vscode.Uri.parse(part.uri);
			const edits = part.edits.map(deserializeTextEdit);
			const editPart = new vscode.ChatResponseTextEditPart(uri, edits);
			if (part.isDone !== undefined) {
				editPart.isDone = part.isDone;
			}
			return editPart;
		}

		// ========================================
		// Notebook Edit Part
		// ========================================
		case 'notebookEdit': {
			if (!part.uri || !part.notebookEdits) {
				return undefined;
			}
			const uri = vscode.Uri.parse(part.uri);
			const edits = part.notebookEdits.map((edit): vscode.NotebookEdit => {
				if (edit.editType === 'replace' && edit.index !== undefined && edit.count !== undefined && edit.cells) {
					const range = new vscode.NotebookRange(edit.index, edit.index + edit.count);
					const cells = edit.cells.map(cell => new vscode.NotebookCellData(
						cell.kind === 'code' ? vscode.NotebookCellKind.Code : vscode.NotebookCellKind.Markup,
						cell.value,
						cell.languageId
					));
					return vscode.NotebookEdit.replaceCells(range, cells);
				} else if (edit.editType === 'metadata' && edit.index !== undefined && edit.metadata) {
					return vscode.NotebookEdit.updateCellMetadata(edit.index, edit.metadata);
				} else if (edit.editType === 'documentMetadata' && edit.metadata) {
					return vscode.NotebookEdit.updateNotebookMetadata(edit.metadata);
				}
				// Fallback: empty replace
				return vscode.NotebookEdit.replaceCells(new vscode.NotebookRange(0, 0), []);
			});
			const notebookEditPart = new vscode.ChatResponseNotebookEditPart(uri, edits);
			if (part.isDone !== undefined) {
				notebookEditPart.isDone = part.isDone;
			}
			return notebookEditPart;
		}

		// ========================================
		// Codeblock URI Part
		// ========================================
		case 'codeblockUri': {
			if (!part.codeblockUri) {
				return undefined;
			}
			const uri = vscode.Uri.parse(part.codeblockUri);
			return new vscode.ChatResponseCodeblockUriPart(uri, part.isEdit, part.undoStopId);
		}

		// ========================================
		// Code Citation Part
		// ========================================
		case 'codeCitation': {
			if (!part.citationValue || !part.license || !part.snippet) {
				return undefined;
			}
			return new vscode.ChatResponseCodeCitationPart(
				vscode.Uri.parse(part.citationValue),
				part.license,
				part.snippet
			);
		}

		// ========================================
		// Command Button Part
		// ========================================
		case 'command': {
			if (!part.command) {
				return undefined;
			}
			const command: vscode.Command = {
				title: part.command.title,
				command: part.command.command,
				tooltip: part.command.tooltip,
				arguments: part.command.arguments ? [...part.command.arguments] : undefined
			};
			return new vscode.ChatResponseCommandButtonPart(command);
		}

		// ========================================
		// Move Part
		// ========================================
		case 'move': {
			if (!part.moveUri || !part.moveRange) {
				return undefined;
			}
			const uri = vscode.Uri.parse(part.moveUri);
			const range = deserializeRange(part.moveRange);
			return new vscode.ChatResponseMovePart(uri, range);
		}

		// ========================================
		// Multi-Diff Part
		// ========================================
		case 'multiDiff': {
			if (!part.multiDiffResources) {
				return undefined;
			}
			const resources = part.multiDiffResources.map(r => ({
				originalUri: r.originalUri ? vscode.Uri.parse(r.originalUri) : undefined,
				modifiedUri: r.modifiedUri ? vscode.Uri.parse(r.modifiedUri) : undefined,
				goToFileUri: r.goToFileUri ? vscode.Uri.parse(r.goToFileUri) : undefined,
				added: r.added,
				removed: r.removed
			}));
			return new vscode.ChatResponseMultiDiffPart(resources, part.multiDiffTitle ?? '', part.multiDiffReadOnly);
		}

		// ========================================
		// Pull Request Part
		// ========================================
		case 'pullRequest': {
			// ChatResponsePullRequestPart requires all arguments: (uri, title, description, author, linkTag)
			const uri = part.prUri ? vscode.Uri.parse(part.prUri) : vscode.Uri.parse('');
			const title = part.prTitle ?? '';
			const description = part.prDescription ?? '';
			const author = part.prAuthor ?? '';
			const linkTag = part.prLinkTag ?? '';
			return new vscode.ChatResponsePullRequestPart(uri, title, description, author, linkTag);
		}

		// ========================================
		// Extensions Part
		// ========================================
		case 'extensions': {
			if (!part.extensions) {
				return undefined;
			}
			return new vscode.ChatResponseExtensionsPart([...part.extensions]);
		}

		// ========================================
		// Error (rendered as warning with error styling)
		// ========================================
		case 'error': {
			// VS Code doesn't have a dedicated error part, use warning
			const md = deserializeMarkdownString(part.content);
			return new vscode.ChatResponseWarningPart(md);
		}

		// ========================================
		// Unknown - skip
		// ========================================
		case 'unknown':
		default:
			return undefined;
	}
}

/**
 * Deserialize tool-specific data back to the format VS Code expects
 */
function deserializeToolSpecificData(data: unknown): vscode.ChatTerminalToolInvocationData | undefined {
	if (!data || typeof data !== 'object') {
		return undefined;
	}

	const d = data as Record<string, unknown>;
	if (d.kind === 'terminal') {
		// ChatTerminalToolInvocationData has commandLine as an object { original, userEdited?, toolEdited? }
		if ('commandLine' in d && typeof d.commandLine === 'string') {
			return {
				commandLine: {
					original: d.commandLine,
				},
				language: (d.language as string) ?? 'shellscript'
			};
		}
		if ('command' in d && typeof d.command === 'string') {
			return {
				commandLine: {
					original: d.command,
				},
				language: (d.language as string) ?? 'shellscript'
			};
		}
	}

	return undefined;
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
