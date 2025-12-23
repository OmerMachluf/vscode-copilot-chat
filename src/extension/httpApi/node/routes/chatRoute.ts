/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IncomingMessage, ServerResponse } from 'node:http';
import { CancellationTokenSource } from '../../../../util/vs/base/common/cancellation';
import { IAgentRunner, IAgentHistoryEntry } from '../../../orchestrator/orchestratorInterfaces';
import { HttpResponseStreamAdapter } from '../httpResponseStreamAdapter';
import { ILogService } from '../../../../platform/log/common/logService';
import { IModelSelector } from '../../common/modelSelector';

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
	/** Optional model ID to use (e.g., 'gpt-4o', 'claude-sonnet-4') */
	modelId?: string;
	/** Optional conversation history for context */
	history?: Array<{ role: 'user' | 'assistant'; content: string }>;
	/** Optional additional instructions for the agent */
	additionalInstructions?: string;
	/** Maximum tool call iterations (defaults to 100) */
	maxToolCallIterations?: number;
}

/**
 * In-memory session store for conversation history
 * In production, this should be backed by a persistent store
 */
const sessionStore = new Map<string, {
	history: IAgentHistoryEntry[];
	lastAccess: number;
}>();

/**
 * Session expiry time in milliseconds (30 minutes)
 */
const SESSION_EXPIRY_MS = 30 * 60 * 1000;

/**
 * Clean up expired sessions periodically
 */
function cleanupExpiredSessions(): void {
	const now = Date.now();
	for (const [sessionId, session] of sessionStore) {
		if (now - session.lastAccess > SESSION_EXPIRY_MS) {
			sessionStore.delete(sessionId);
		}
	}
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredSessions, 5 * 60 * 1000);

/**
 * Handles POST /api/chat requests.
 * Streams agent responses back to the client using SSE.
 */
export async function handleChatRequest(
	req: IncomingMessage,
	res: ServerResponse,
	agentRunner: IAgentRunner,
	logService: ILogService,
	modelSelector: IModelSelector,
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

	// Validate message is not empty after trimming
	const trimmedMessage = body.message.trim();
	if (!trimmedMessage) {
		res.statusCode = 400;
		res.setHeader('Content-Type', 'application/json');
		res.end(JSON.stringify({ error: 'Message cannot be empty' }));
		return;
	}

	const agentType = body.agentType || 'agent';
	const sessionId = body.sessionId || generateSessionId();
	const maxToolCallIterations = body.maxToolCallIterations || 100;

	logService.info(`[HttpApi] Chat request received: agentType=${agentType}, sessionId=${sessionId}, message length=${trimmedMessage.length}`);

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
		const model = await modelSelector.selectModel(agentType, body.modelId);
		if (!model) {
			streamAdapter.sendError('No language model available. Please ensure VS Code is properly configured with Copilot or another language model provider.');
			return;
		}

		// Get or create session history
		let sessionHistory: IAgentHistoryEntry[] = [];
		if (sessionStore.has(sessionId)) {
			const session = sessionStore.get(sessionId)!;
			session.lastAccess = Date.now();
			sessionHistory = session.history;
		}

		// Merge provided history with session history
		const combinedHistory: IAgentHistoryEntry[] = [
			...sessionHistory,
			...(body.history || []),
		];

		// Run the agent
		const result = await agentRunner.run(
			{
				prompt: trimmedMessage,
				sessionId,
				model,
				token: cts.token,
				maxToolCallIterations,
				additionalInstructions: body.additionalInstructions,
				history: combinedHistory,
			},
			streamAdapter,
		);

		// Update session history with this exchange
		const newHistory: IAgentHistoryEntry[] = [
			...combinedHistory,
			{ role: 'user' as const, content: trimmedMessage },
		];
		if (result.response) {
			newHistory.push({ role: 'assistant' as const, content: result.response });
		}
		sessionStore.set(sessionId, {
			history: newHistory,
			lastAccess: Date.now(),
		});

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
 * Generate a unique session ID
 */
function generateSessionId(): string {
	return `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
	modelSelector: IModelSelector,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
	return (req, res) => handleChatRequest(req, res, agentRunner, logService, modelSelector);
}

// ============================================================================
// Session Management API
// ============================================================================

/**
 * Information about a chat session
 */
export interface ChatSessionInfo {
	id: string;
	messageCount: number;
	lastAccess: number;
	createdAt: number;
}

/**
 * Get all active sessions
 */
export function getActiveSessions(): ChatSessionInfo[] {
	const sessions: ChatSessionInfo[] = [];
	for (const [id, session] of sessionStore) {
		sessions.push({
			id,
			messageCount: session.history.length,
			lastAccess: session.lastAccess,
			createdAt: session.history.length > 0 ? session.lastAccess - (session.history.length * 1000) : session.lastAccess,
		});
	}
	return sessions;
}

/**
 * Get a specific session by ID
 */
export function getSession(sessionId: string): { id: string; history: IAgentHistoryEntry[]; lastAccess: number } | undefined {
	const session = sessionStore.get(sessionId);
	if (!session) {
		return undefined;
	}
	return {
		id: sessionId,
		history: session.history,
		lastAccess: session.lastAccess,
	};
}

/**
 * Delete a session by ID
 */
export function deleteSession(sessionId: string): boolean {
	return sessionStore.delete(sessionId);
}

/**
 * Clear all sessions
 */
export function clearAllSessions(): number {
	const count = sessionStore.size;
	sessionStore.clear();
	return count;
}

/**
 * Create a new empty session
 */
export function createSession(sessionId?: string): string {
	const id = sessionId || generateSessionId();
	sessionStore.set(id, {
		history: [],
		lastAccess: Date.now(),
	});
	return id;
}
