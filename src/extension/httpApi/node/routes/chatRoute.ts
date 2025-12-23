/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IncomingMessage, ServerResponse } from 'node:http';
import type * as vscode from 'vscode';
import { CancellationTokenSource } from '../../../../util/vs/base/common/cancellation';
import { IAgentRunner } from '../../../orchestrator/orchestratorInterfaces';
import { HttpResponseStreamAdapter } from '../httpResponseStreamAdapter';
import { ILogService } from '../../../../platform/log/common/logService';

/**
 * Request body for the /api/chat endpoint.
 */
export interface ChatRequestBody {
	/** The user's message to send to the agent */
	message: string;
	/** The agent type to use (defaults to 'agent') */
	agentType?: string;
	/** Optional session ID for conversation continuity */
	sessionId?: string;
}

/**
 * Handles POST /api/chat requests.
 * Streams agent responses back to the client using SSE.
 */
export async function handleChatRequest(
	req: IncomingMessage,
	res: ServerResponse,
	agentRunner: IAgentRunner,
	logService: ILogService,
): Promise<void> {
	// Only accept POST requests
	if (req.method !== 'POST') {
		res.statusCode = 405;
		res.setHeader('Content-Type', 'application/json');
		res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
		return;
	}

	// Parse request body
	let body: ChatRequestBody;
	try {
		body = await parseRequestBody(req);
	} catch {
		res.statusCode = 400;
		res.setHeader('Content-Type', 'application/json');
		res.end(JSON.stringify({ error: 'Invalid JSON body' }));
		return;
	}

	// Validate required fields
	if (!body.message || typeof body.message !== 'string') {
		res.statusCode = 400;
		res.setHeader('Content-Type', 'application/json');
		res.end(JSON.stringify({ error: 'Missing required field: message' }));
		return;
	}

	const agentType = body.agentType || 'agent';
	const sessionId = body.sessionId;

	logService.info(`[HttpApi] Chat request received: agentType=${agentType}, message length=${body.message.length}`);

	// Create SSE stream adapter
	const streamAdapter = new HttpResponseStreamAdapter(res);

	// Create cancellation token that can be triggered when client disconnects
	const cts = new CancellationTokenSource();
	req.on('close', () => {
		logService.info('[HttpApi] Client disconnected, cancelling request');
		cts.cancel();
	});

	try {
		// Get a language model for the agent
		const model = await selectModel(agentType);
		if (!model) {
			streamAdapter.sendError('No language model available');
			return;
		}

		// Run the agent
		const result = await agentRunner.run(
			{
				prompt: body.message,
				sessionId,
				model,
				token: cts.token,
				maxToolCallIterations: 100,
			},
			streamAdapter,
		);

		// Send completion event
		if (!streamAdapter.isClosed) {
			if (result.success) {
				streamAdapter.complete(result.response);
			} else {
				streamAdapter.sendError(result.error || 'Agent execution failed');
			}
		}
	} catch (error) {
		logService.error(error instanceof Error ? error : new Error(String(error)), '[HttpApi] Chat request failed');
		if (!streamAdapter.isClosed) {
			streamAdapter.sendError(error instanceof Error ? error.message : String(error));
		}
	} finally {
		cts.dispose();
	}
}

/**
 * Parse the request body as JSON.
 */
async function parseRequestBody(req: IncomingMessage): Promise<ChatRequestBody> {
	return new Promise((resolve, reject) => {
		let data = '';
		req.on('data', (chunk) => {
			data += chunk;
		});
		req.on('end', () => {
			try {
				resolve(JSON.parse(data));
			} catch (e) {
				reject(e);
			}
		});
		req.on('error', reject);
	});
}

/**
 * Select an appropriate language model for the agent.
 * Tries copilot models first, then falls back to any available model.
 */
async function selectModel(_agentType: string): Promise<vscode.LanguageModelChat | undefined> {
	// Try to get copilot models first (preferred)
	let models = await vscode.lm.selectChatModels({ vendor: 'copilot' });

	// Try specific model families based on agent type
	if (models.length === 0) {
		models = await vscode.lm.selectChatModels({ family: 'gpt-4' });
	}

	// Fall back to any available model
	if (models.length === 0) {
		models = await vscode.lm.selectChatModels();
	}

	return models[0];
}

/**
 * Creates a route handler function bound to the given services.
 */
export function createChatRoute(
	agentRunner: IAgentRunner,
	logService: ILogService,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
	return (req, res) => handleChatRequest(req, res, agentRunner, logService);
}
