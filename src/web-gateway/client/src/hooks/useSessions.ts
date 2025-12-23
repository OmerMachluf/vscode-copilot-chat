/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/api';

export type SessionStatus = 'active' | 'idle' | 'disconnected' | 'error';

export interface ChatSession {
	id: string;
	createdAt: string;
	lastActivityAt: string;
	status: SessionStatus;
	messageCount?: number;
	metadata?: Record<string, unknown>;
}

export interface UseSessionsResult {
	/** List of available sessions */
	sessions: ChatSession[];
	/** Currently active session ID */
	currentSessionId: string | null;
	/** Whether sessions are being loaded */
	isLoading: boolean;
	/** Error message if any */
	error: string | null;
	/** Create a new session */
	createSession: (metadata?: Record<string, unknown>) => Promise<ChatSession>;
	/** Switch to a different session */
	switchSession: (sessionId: string) => void;
	/** Delete a session */
	deleteSession: (sessionId: string) => Promise<void>;
	/** Refresh sessions list */
	refreshSessions: () => Promise<void>;
}

/**
 * Hook for managing chat sessions.
 */
export function useSessions(): UseSessionsResult {
	const [sessions, setSessions] = useState<ChatSession[]>([]);
	const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchSessions = useCallback(async () => {
		try {
			setIsLoading(true);
			setError(null);
			const response = await apiClient.get<{ sessions: ChatSession[] }>('/api/sessions');
			setSessions(response.sessions || []);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to fetch sessions';
			setError(message);
		} finally {
			setIsLoading(false);
		}
	}, []);

	const createSession = useCallback(async (metadata?: Record<string, unknown>): Promise<ChatSession> => {
		try {
			setError(null);
			const session = await apiClient.post<ChatSession>('/api/sessions', { metadata });
			setSessions(prev => [session, ...prev]);
			setCurrentSessionId(session.id);
			return session;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to create session';
			setError(message);
			throw err;
		}
	}, []);

	const switchSession = useCallback((sessionId: string) => {
		const session = sessions.find(s => s.id === sessionId);
		if (session) {
			setCurrentSessionId(sessionId);
		}
	}, [sessions]);

	const deleteSession = useCallback(async (sessionId: string) => {
		try {
			setError(null);
			await apiClient.delete(`/api/sessions/${sessionId}`);
			setSessions(prev => prev.filter(s => s.id !== sessionId));
			if (currentSessionId === sessionId) {
				setCurrentSessionId(null);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to delete session';
			setError(message);
			throw err;
		}
	}, [currentSessionId]);

	useEffect(() => {
		fetchSessions();
	}, [fetchSessions]);

	return {
		sessions,
		currentSessionId,
		isLoading,
		error,
		createSession,
		switchSession,
		deleteSession,
		refreshSessions: fetchSessions,
	};
}
