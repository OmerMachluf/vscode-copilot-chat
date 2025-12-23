/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LanguageModelChat } from 'vscode';
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
 * Function type for selecting a language model.
 * Injected as a dependency to avoid direct vscode imports in node/ directory.
 */
export type ModelSelector = (agentType: string) => Promise<LanguageModelChat | undefined>;

/**
 * Handles POST /api/chat requests.
 * Streams agent responses back to the client using SSE.
 */
export async function handleChatRequest(
	req: IncomingMessage,
	res: ServerResponse,
	agentRunner: IAgentRunner,
	logService: ILogService,
	selectModel: ModelSelector,
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
 * Creates a route handler function bound to the given services.
 * @param agentRunner The agent runner service
 * @param logService The logging service
 * @param modelSelector Function to select a language model for a given agent type
 */
export function createChatRoute(
	agentRunner: IAgentRunner,
	logService: ILogService,
	modelSelector: ModelSelector,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
	return (req, res) => handleChatRequest(req, res, agentRunner, logService, modelSelector);
}
