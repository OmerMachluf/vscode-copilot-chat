/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as net from 'net';
import * as vscode from 'vscode';
import { ChatLocation } from '../../platform/chat/common/commonTypes';
import { Emitter } from '../../util/vs/base/common/event';
import { IInstantiationService } from '../../util/vs/platform/instantiation/common/instantiation';
import { Intent } from '../common/constants';
import { IIntentService } from '../intents/node/intentService';
import { ChatTelemetryBuilder } from '../prompt/node/chatParticipantTelemetry';

export async function activateWorker(context: vscode.ExtensionContext, instantiationService?: IInstantiationService) {
	console.log('Copilot Worker Activated!');

	// Debug logging
	try {
		const fs = require('fs');
		const path = require('path');
		const logPath = path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', 'worker_debug.log');
		fs.writeFileSync(logPath, `Worker activated at ${new Date().toISOString()}\nEnv PORT: ${process.env.COPILOT_ORCHESTRATOR_PORT}\n`);
	} catch (e) {
		console.error('Failed to write debug log', e);
	}

	const port = process.env.COPILOT_ORCHESTRATOR_PORT;
	if (!port) {
		console.error('COPILOT_ORCHESTRATOR_PORT not set');
		return;
	}

	const socket = net.createConnection(Number(port), '127.0.0.1');

	socket.on('connect', () => {
		console.log('Connected to Orchestrator');
		socket.write(JSON.stringify({ type: 'hello', message: 'Worker ready' }));
	});

	socket.on('data', (data) => {
		try {
			const msg = JSON.parse(data.toString());
			if (msg.type === 'shutdown') {
				console.log('Received shutdown signal');
				vscode.commands.executeCommand('workbench.action.closeWindow');
				return;
			}
			handleMessage(msg, socket, instantiationService);
		} catch (e) {
			console.error('Failed to parse message', e);
		}
	}); socket.on('error', (err) => {
		console.error('Socket error', err);
	});

	// Register command for the worker (human or AI) to send messages back
	context.subscriptions.push(vscode.commands.registerCommand('github.copilot.orchestrator.sendMessage', async (text?: string) => {
		if (!text) {
			text = await vscode.window.showInputBox({ prompt: 'Message to Orchestrator' });
		}
		if (text) {
			socket.write(JSON.stringify({ type: 'message', content: text }) + '\n');
		}
	}));

	// Register command to log thoughts
	context.subscriptions.push(vscode.commands.registerCommand('github.copilot.orchestrator.logThought', (text: string) => {
		if (text) {
			socket.write(JSON.stringify({ type: 'thought', content: text }) + '\n');
		}
	}));

	// Watch for file changes
	const watcher = vscode.workspace.createFileSystemWatcher('**/*');
	const sendChange = (changeType: string, uri: vscode.Uri) => {
		if (uri.fsPath.includes('.git') || uri.fsPath.includes('PLAN.md')) return;
		const relativePath = vscode.workspace.asRelativePath(uri);
		socket.write(JSON.stringify({ type: 'change', changeType, path: relativePath }) + '\n');
	};

	watcher.onDidChange(uri => sendChange('modified', uri));
	watcher.onDidCreate(uri => sendChange('created', uri));
	watcher.onDidDelete(uri => sendChange('deleted', uri));
	context.subscriptions.push(watcher);
}

class SocketChatResponseStream implements vscode.ChatResponseStream {
	constructor(private socket: net.Socket) { }

	markdown(value: string | vscode.MarkdownString): void {
		const content = typeof value === 'string' ? value : value.value;
		this.socket.write(JSON.stringify({ type: 'message', content }) + '\n');
	}

	anchor(value: vscode.Uri | vscode.Location): void { }
	button(command: vscode.Command): void { }
	filetree(value: vscode.ChatResponseFileTree[], baseUri: vscode.Uri): void { }
	progress(value: string): void {
		this.socket.write(JSON.stringify({ type: 'thought', content: value }) + '\n');
	}
	reference(value: vscode.Uri | vscode.Location): void { }
	push(part: vscode.ChatResponsePart): void {
		if ('value' in part && typeof part.value === 'string') { // Markdown
			this.markdown(part.value);
		}
	}
	text(value: string): void {
		this.markdown(value);
	}
	warning(value: string | vscode.MarkdownString): void {
		this.markdown(value);
	}
	error(value: string | vscode.MarkdownString): void {
		this.markdown(value);
	}
	confirmation(title: string, message: string, data: any, buttons?: string[] | undefined): void {
	}

	// Missing methods
	thinkingProgress(value: any): void { }
	textEdit(target: any, edits: any): void { }
	notebookEdit(target: any, edits: any): void { }
	externalEdit<T>(target: vscode.Uri | vscode.Uri[], callback: () => Thenable<T>): Thenable<T> {
		return callback();
	}

	markdownWithVulnerabilities(value: string | vscode.MarkdownString, vulnerabilities: any[]): void {
		this.markdown(value);
	}

	codeblockUri(value: vscode.Uri): void { }
	reference2(value: any): void { }
	codeCitation(value: any): void { }
	progress2(value: any): void { }
	fileTree(value: any, baseUri: any): void { }

	custom(value: any): void { }
	code(value: any): void { }
	command(value: any): void { }
	prepareToolInvocation(toolName: string): void { }
	clearToPreviousToolInvocation(reason: vscode.ChatResponseClearToPreviousToolInvocationReason): void { }
}

async function handleMessage(msg: any, socket: net.Socket, instantiationService?: IInstantiationService) {
	if (msg.type === 'chat') {
		vscode.window.showInformationMessage(`Orchestrator says: ${msg.message}`);
		socket.write(JSON.stringify({ type: 'ack', message: `Received: ${msg.message}` }));
	} else if (msg.type === 'task' && instantiationService) {
		try {
			const intentService = instantiationService.invokeFunction(accessor => accessor.get(IIntentService));
			const intent = intentService.getIntent(Intent.Agent, ChatLocation.Panel);

			if (intent) {
				const stream = new SocketChatResponseStream(socket);
				const tokenSource = new vscode.CancellationTokenSource();

				// Mock Conversation and Request
				// This is a best-effort mock. Real implementation requires more context.
				const conversation: any = {
					sessionId: 'worker-session',
					turns: []
				};

				const request: any = {
					prompt: msg.task,
					variables: {},
					references: [],
					toolReferences: [],
					location: ChatLocation.Panel,
					command: 'agent'
				};

				const chatTelemetry = instantiationService.createInstance(ChatTelemetryBuilder,
					Date.now(),
					conversation.sessionId,
					undefined, // documentContext
					true, // firstTurn
					request
				);

				// We need to call handleRequest.
				// Note: This might fail if the intent expects specific properties on the conversation or request.
				// But it's worth a try.

				if (typeof intent.handleRequest === 'function') {
					await intent.handleRequest(
						conversation,
						request,
						stream,
						tokenSource.token,
						undefined, // documentContext
						'agent',
						ChatLocation.Panel,
						chatTelemetry,
						new Emitter<boolean>().event
					);
				}
			}
		} catch (e) {
			socket.write(JSON.stringify({ type: 'error', error: String(e) }));
		}
	}
}
