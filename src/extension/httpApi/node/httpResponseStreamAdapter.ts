/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import type * as vscode from 'vscode';
import { ChatResponseReferencePartStatusKind } from '@vscode/prompt-tsx';
import type { ThemeIcon } from '../../../util/vs/base/common/themables';
import { URI } from '../../../util/vs/base/common/uri';
import {
	ChatPrepareToolInvocationPart,
	ChatResponseAnchorPart,
	ChatResponseClearToPreviousToolInvocationReason,
	ChatResponseCodeblockUriPart,
	ChatResponseCodeCitationPart,
	ChatResponseCommandButtonPart,
	ChatResponseConfirmationPart,
	ChatResponseFileTreePart,
	ChatResponseMarkdownPart,
	ChatResponseMarkdownWithVulnerabilitiesPart,
	ChatResponseNotebookEditPart,
	ChatResponseProgressPart,
	ChatResponseReferencePart,
	ChatResponseReferencePart2,
	ChatResponseTextEditPart,
	ChatResponseThinkingProgressPart,
	ChatResponseWarningPart,
	Location,
	MarkdownString,
	NotebookEdit,
	TextEdit,
	Uri
} from '../../../vscodeTypes';

/**
 * Types for SSE events sent over HTTP
 */
export type HttpStreamEventType =
	| 'part'           // Chat response part
	| 'clear'          // Clear to previous tool invocation
	| 'close'          // Stream closed
	| 'error'          // Error occurred
	| 'warning';       // Warning (e.g., unsupported feature)

/**
 * Serialized representation of a chat response part for HTTP transmission.
 * Based on SerializedChatPart from workerSession.ts but simplified for HTTP API.
 */
export interface HttpSerializedChatPart {
	readonly type: string;
	readonly content?: string | {
		readonly value: string;
		readonly isTrusted?: boolean | { readonly enabledCommands: readonly string[] };
		readonly supportThemeIcons?: boolean;
		readonly supportHtml?: boolean;
		readonly baseUri?: string;
	};
	readonly uri?: string;
	readonly range?: {
		readonly startLine: number;
		readonly startChar: number;
		readonly endLine: number;
		readonly endChar: number;
	};
	readonly title?: string;
	readonly message?: string;
	readonly progressMessage?: string;
	readonly command?: {
		readonly title: string;
		readonly command: string;
		readonly tooltip?: string;
		readonly arguments?: unknown[];
	};
	readonly treeItems?: readonly {
		readonly name: string;
		readonly children?: readonly { readonly name: string; readonly children?: unknown[] }[];
	}[];
	readonly baseUri?: string;
	readonly thinkingId?: string;
	readonly thinkingMetadata?: unknown;
	readonly variableName?: string;
	readonly iconPath?: string;
	readonly status?: {
		readonly description: string;
		readonly kind: number;
	};
	readonly vulnerabilities?: readonly {
		readonly title: string;
		readonly description: string;
	}[];
	readonly isEdit?: boolean;
	readonly license?: string;
	readonly snippet?: string;
	readonly edits?: unknown[];
	readonly isDone?: boolean;
	readonly buttons?: readonly string[];
	readonly data?: unknown;
	readonly toolName?: string;
}

/**
 * SSE event payload structure
 */
export interface HttpStreamEvent {
	readonly type: HttpStreamEventType;
	readonly part?: HttpSerializedChatPart;
	readonly reason?: ChatResponseClearToPreviousToolInvocationReason;
	readonly message?: string;
}

/**
 * Options for HttpResponseStreamAdapter
 */
export interface HttpResponseStreamAdapterOptions {
	/** Callback when the stream is closed (either by us or by client disconnect) */
	readonly onClose?: () => void;
}

/**
 * Adapter that bridges vscode.ChatResponseStream to HTTP SSE responses.
 * Serializes chat response parts to JSON and sends them as SSE events.
 */
export class HttpResponseStreamAdapter implements vscode.ChatResponseStream {
	private _isClosed = false;
	private readonly _onClose?: () => void;

	constructor(
		private readonly _response: http.ServerResponse,
		options?: HttpResponseStreamAdapterOptions
	) {
		this._onClose = options?.onClose;

		// Set up SSE headers
		this._response.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'X-Accel-Buffering': 'no', // Disable nginx buffering
		});

		// Handle client disconnect
		this._response.on('close', () => {
			if (!this._isClosed) {
				this._isClosed = true;
				this._onClose?.();
			}
		});
	}

	/**
	 * Whether the stream has been closed (either by close() or client disconnect)
	 */
	get isClosed(): boolean {
		return this._isClosed;
	}

	/**
	 * Close the stream, sending a close event and ending the response
	 */
	close(): void {
		if (this._isClosed) {
			return;
		}
		this._sendEvent({ type: 'close' });
		this._isClosed = true;
		this._response.end();
		this._onClose?.();
	}

	/**
	 * Send an SSE event to the client
	 */
	private _sendEvent(event: HttpStreamEvent): void {
		if (this._isClosed) {
			return;
		}
		try {
			const data = JSON.stringify(event);
			this._response.write(`data: ${data}\n\n`);
		} catch {
			// Client may have disconnected
		}
	}

	/**
	 * Send a chat response part as an SSE event
	 */
	private _sendPart(part: HttpSerializedChatPart): void {
		this._sendEvent({ type: 'part', part });
	}

	/**
	 * Send a warning message (for unsupported features like interactive buttons)
	 */
	private _sendWarning(message: string): void {
		this._sendEvent({ type: 'warning', message });
	}

	// === ChatResponseStream implementation ===

	markdown(value: string | MarkdownString): void {
		if (typeof value === 'string') {
			this._sendPart({ type: 'markdown', content: value });
		} else {
			this._sendPart({
				type: 'markdown',
				content: {
					value: value.value,
					isTrusted: value.isTrusted,
					supportThemeIcons: value.supportThemeIcons,
					supportHtml: value.supportHtml,
					baseUri: value.baseUri?.toString(),
				},
			});
		}
	}

	anchor(value: Uri | Location, title?: string): void {
		const isLocation = !URI.isUri(value) && 'uri' in value;
		const uri = isLocation ? (value as Location).uri : value as Uri;
		const range = isLocation ? (value as Location).range : undefined;

		this._sendPart({
			type: 'anchor',
			uri: uri.toString(),
			title,
			range: range ? {
				startLine: range.start.line,
				startChar: range.start.character,
				endLine: range.end.line,
				endChar: range.end.character,
			} : undefined,
		});
	}

	button(command: vscode.Command): void {
		// Interactive buttons cannot work over HTTP - send warning
		this._sendWarning(`Interactive button '${command.title}' (command: ${command.command}) cannot be executed over HTTP API`);
		// Still emit the part so clients know a button was shown
		this._sendPart({
			type: 'command',
			command: {
				title: command.title,
				command: command.command,
				tooltip: command.tooltip,
				arguments: command.arguments,
			},
		});
	}

	filetree(value: vscode.ChatResponseFileTree[], baseUri: Uri): void {
		interface SerializedFileTreeItem {
			name: string;
			children?: SerializedFileTreeItem[];
		}
		const serializeItem = (item: vscode.ChatResponseFileTree): SerializedFileTreeItem => ({
			name: item.name,
			children: item.children?.map(serializeItem),
		});
		this._sendPart({
			type: 'filetree',
			baseUri: baseUri.toString(),
			treeItems: value.map(serializeItem),
		});
	}

	progress(value: string): void {
		this._sendPart({
			type: 'progress',
			progressMessage: value,
		});
	}

	thinkingProgress(thinkingDelta: vscode.ThinkingDelta): void {
		const text = thinkingDelta.text;
		const content = Array.isArray(text) ? text.join('') : text;
		this._sendPart({
			type: 'thinkingProgress',
			content,
			thinkingId: thinkingDelta.id,
			thinkingMetadata: thinkingDelta.metadata,
		});
	}

	reference(value: Uri | Location | { variableName: string; value?: Uri | Location }, iconPath?: Uri | ThemeIcon | { light: Uri; dark: Uri }): void {
		let uri: string | undefined;
		let variableName: string | undefined;
		let rangeData: HttpSerializedChatPart['range'] | undefined;

		if (URI.isUri(value)) {
			uri = value.toString();
		} else if ('uri' in value) {
			uri = (value as Location).uri.toString();
			const range = (value as Location).range;
			if (range) {
				rangeData = {
					startLine: range.start.line,
					startChar: range.start.character,
					endLine: range.end.line,
					endChar: range.end.character,
				};
			}
		} else if ('variableName' in value) {
			variableName = value.variableName;
			if (URI.isUri(value.value)) {
				uri = value.value.toString();
			} else if (value.value && 'uri' in value.value) {
				uri = value.value.uri.toString();
			}
		}

		// Serialize iconPath - only handle Uri for simplicity
		let iconPathStr: string | undefined;
		if (URI.isUri(iconPath)) {
			iconPathStr = iconPath.toString();
		}

		this._sendPart({
			type: 'reference',
			uri,
			variableName,
			range: rangeData,
			iconPath: iconPathStr,
		});
	}

	reference2(
		value: Uri | Location | string | { variableName: string; value?: Uri | Location },
		iconPath?: Uri | ThemeIcon | { light: Uri; dark: Uri },
		options?: { status?: { description: string; kind: ChatResponseReferencePartStatusKind } }
	): void {
		let uri: string | undefined;
		let variableName: string | undefined;
		let rangeData: HttpSerializedChatPart['range'] | undefined;
		let content: string | undefined;

		if (typeof value === 'string') {
			content = value;
		} else if (URI.isUri(value)) {
			uri = value.toString();
		} else if ('uri' in value) {
			uri = (value as Location).uri.toString();
			const range = (value as Location).range;
			if (range) {
				rangeData = {
					startLine: range.start.line,
					startChar: range.start.character,
					endLine: range.end.line,
					endChar: range.end.character,
				};
			}
		} else if ('variableName' in value) {
			variableName = value.variableName;
			if (URI.isUri(value.value)) {
				uri = value.value.toString();
			} else if (value.value && 'uri' in value.value) {
				uri = value.value.uri.toString();
			}
		}

		let iconPathStr: string | undefined;
		if (URI.isUri(iconPath)) {
			iconPathStr = iconPath.toString();
		}

		this._sendPart({
			type: 'reference2',
			uri,
			content,
			variableName,
			range: rangeData,
			iconPath: iconPathStr,
			status: options?.status,
		});
	}

	textEdit(target: Uri, editsOrDone: TextEdit | TextEdit[] | true): void {
		if (editsOrDone === true) {
			this._sendPart({
				type: 'textEdit',
				uri: target.toString(),
				isDone: true,
			});
		} else {
			const edits = Array.isArray(editsOrDone) ? editsOrDone : [editsOrDone];
			this._sendPart({
				type: 'textEdit',
				uri: target.toString(),
				edits: edits.map(edit => ({
					range: {
						startLine: edit.range.start.line,
						startChar: edit.range.start.character,
						endLine: edit.range.end.line,
						endChar: edit.range.end.character,
					},
					newText: edit.newText,
				})),
			});
		}
	}

	notebookEdit(target: Uri, editsOrDone: NotebookEdit | NotebookEdit[] | true): void {
		if (editsOrDone === true) {
			this._sendPart({
				type: 'notebookEdit',
				uri: target.toString(),
				isDone: true,
			});
		} else {
			// Notebook edits are complex - just signal they occurred
			this._sendPart({
				type: 'notebookEdit',
				uri: target.toString(),
			});
		}
	}

	async externalEdit(target: Uri | Uri[], _callback: () => Thenable<unknown>): Promise<string> {
		// External edits require VS Code context - send warning
		const uris = Array.isArray(target) ? target : [target];
		this._sendWarning(`External edit cannot be performed over HTTP API. Target files: ${uris.map(u => u.toString()).join(', ')}`);
		return 'External edits not supported over HTTP API';
	}

	markdownWithVulnerabilities(value: string | MarkdownString, vulnerabilities: vscode.ChatVulnerability[]): void {
		const content = typeof value === 'string' ? value : value.value;
		this._sendPart({
			type: 'markdownWithVulnerabilities',
			content,
			vulnerabilities: vulnerabilities.map(v => ({
				title: v.title,
				description: v.description,
			})),
		});
	}

	codeblockUri(uri: Uri, isEdit?: boolean): void {
		this._sendPart({
			type: 'codeblockUri',
			uri: uri.toString(),
			isEdit,
		});
	}

	codeCitation(value: Uri, license: string, snippet: string): void {
		this._sendPart({
			type: 'codeCitation',
			uri: value.toString(),
			license,
			snippet,
		});
	}

	confirmation(title: string, message: string | MarkdownString, data: unknown, buttons?: string[]): void {
		// Interactive confirmations cannot work over HTTP - send warning
		this._sendWarning(`Interactive confirmation '${title}' cannot be used over HTTP API`);
		// Still emit the part so clients know a confirmation was shown
		const messageStr = typeof message === 'string' ? message : message.value;
		this._sendPart({
			type: 'confirmation',
			title,
			message: messageStr,
			buttons,
			data,
		});
	}

	warning(value: string | MarkdownString): void {
		const content = typeof value === 'string' ? value : value.value;
		this._sendPart({
			type: 'warning',
			content,
		});
	}

	push(part: vscode.ExtendedChatResponsePart): void {
		// Handle the various part types by delegating to specific methods
		// This is a catch-all that serializes parts based on their constructor

		if (part instanceof ChatResponseMarkdownPart) {
			this.markdown(part.value);
		} else if (part instanceof ChatResponseAnchorPart) {
			this.anchor(part.value);
		} else if (part instanceof ChatResponseProgressPart) {
			this.progress(part.value);
		} else if (part instanceof ChatResponseReferencePart) {
			this.reference(part.value as Uri | Location | { variableName: string; value?: Uri | Location });
		} else if (part instanceof ChatResponseReferencePart2) {
			this.reference2(part.value as Uri | Location | string | { variableName: string; value?: Uri | Location });
		} else if (part instanceof ChatResponseFileTreePart) {
			this.filetree(part.value, part.baseUri);
		} else if (part instanceof ChatResponseCommandButtonPart) {
			this.button(part.value);
		} else if (part instanceof ChatResponseWarningPart) {
			this.warning(part.value);
		} else if (part instanceof ChatResponseConfirmationPart) {
			this.confirmation(part.title, part.message, part.data, part.buttons);
		} else if (part instanceof ChatResponseTextEditPart) {
			if (part.isDone) {
				this.textEdit(part.uri, true);
			} else {
				this.textEdit(part.uri, part.edits);
			}
		} else if (part instanceof ChatResponseNotebookEditPart) {
			if (part.isDone) {
				this.notebookEdit(part.uri, true);
			} else {
				this.notebookEdit(part.uri, part.edits);
			}
		} else if (part instanceof ChatResponseCodeblockUriPart) {
			this.codeblockUri(part.value, part.isEdit);
		} else if (part instanceof ChatResponseCodeCitationPart) {
			this.codeCitation(part.value, part.license, part.snippet);
		} else if (part instanceof ChatResponseMarkdownWithVulnerabilitiesPart) {
			this.markdownWithVulnerabilities(part.value, part.vulnerabilities);
		} else if (part instanceof ChatResponseThinkingProgressPart) {
			this.thinkingProgress({
				text: Array.isArray(part.value) ? part.value : part.value,
				id: part.id ?? '',
				metadata: part.metadata,
			});
		} else if (part instanceof ChatPrepareToolInvocationPart) {
			this._sendPart({
				type: 'prepareToolInvocation',
				toolName: part.toolName,
			});
		} else {
			// Unknown part type - serialize what we can
			this._sendPart({
				type: 'unknown',
				content: JSON.stringify(part),
			});
		}
	}

	prepareToolInvocation(toolName: string): void {
		this._sendPart({
			type: 'prepareToolInvocation',
			toolName,
		});
	}

	clearToPreviousToolInvocation(reason: ChatResponseClearToPreviousToolInvocationReason): void {
		this._sendEvent({ type: 'clear', reason });
	}
}
