/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState, useCallback, memo } from 'react';
import type { ChatSession } from '@/hooks';

export interface SessionManagerProps {
	sessions: ChatSession[];
	currentSessionId: string | null;
	isLoading: boolean;
	onCreateSession: () => Promise<void>;
	onSwitchSession: (sessionId: string) => void;
	onDeleteSession: (sessionId: string) => Promise<void>;
	onClose: () => void;
}

interface SessionItemProps {
	session: ChatSession;
	isActive: boolean;
	onSelect: () => void;
	onDelete: () => void;
	isDeleting: boolean;
}

const SessionItem = memo(function SessionItem({
	session,
	isActive,
	onSelect,
	onDelete,
	isDeleting,
}: SessionItemProps) {
	const formatDate = (dateStr: string) => {
		const date = new Date(dateStr);
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		if (days < 7) return `${days}d ago`;
		return date.toLocaleDateString();
	};

	const getStatusColor = (status: string) => {
		switch (status) {
			case 'active':
				return 'bg-green-500';
			case 'idle':
				return 'bg-yellow-500';
			case 'error':
				return 'bg-red-500';
			default:
				return 'bg-gray-400';
		}
	};

	return (
		<div
			className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
				isActive
					? 'bg-primary-50 border border-primary-200'
					: 'hover:bg-gray-50 border border-transparent'
			}`}
			onClick={onSelect}
		>
			<div className="flex items-center gap-3 min-w-0">
				<div className={`w-2 h-2 rounded-full ${getStatusColor(session.status)}`} />
				<div className="min-w-0">
					<div className="text-sm font-medium text-gray-900 truncate">
						Session {session.id.slice(0, 8)}
					</div>
					<div className="text-xs text-gray-500">
						{formatDate(session.lastActivityAt)}
						{session.messageCount !== undefined && (
							<span className="ml-2">{session.messageCount} messages</span>
						)}
					</div>
				</div>
			</div>
			<button
				onClick={(e) => {
					e.stopPropagation();
					onDelete();
				}}
				disabled={isDeleting}
				className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-all disabled:opacity-50"
				title="Delete session"
			>
				{isDeleting ? (
					<svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
						<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
					</svg>
				) : (
					<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
					</svg>
				)}
			</button>
		</div>
	);
});

export const SessionManager = memo(function SessionManager({
	sessions,
	currentSessionId,
	isLoading,
	onCreateSession,
	onSwitchSession,
	onDeleteSession,
	onClose,
}: SessionManagerProps) {
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [isCreating, setIsCreating] = useState(false);

	const handleCreate = useCallback(async () => {
		setIsCreating(true);
		try {
			await onCreateSession();
		} finally {
			setIsCreating(false);
		}
	}, [onCreateSession]);

	const handleDelete = useCallback(async (sessionId: string) => {
		setDeletingId(sessionId);
		try {
			await onDeleteSession(sessionId);
		} finally {
			setDeletingId(null);
		}
	}, [onDeleteSession]);

	return (
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
			<div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b">
					<h2 className="text-lg font-semibold text-gray-900">Chat Sessions</h2>
					<button
						onClick={onClose}
						className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
					>
						<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				{/* New Session Button */}
				<div className="px-4 py-3 border-b">
					<button
						onClick={handleCreate}
						disabled={isCreating}
						className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
					>
						{isCreating ? (
							<>
								<svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
									<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
									<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
								</svg>
								Creating...
							</>
						) : (
							<>
								<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
								</svg>
								New Session
							</>
						)}
					</button>
				</div>

				{/* Sessions List */}
				<div className="flex-1 overflow-y-auto px-4 py-2">
					{isLoading ? (
						<div className="flex items-center justify-center py-8">
							<svg className="w-6 h-6 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
								<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
								<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
							</svg>
						</div>
					) : sessions.length === 0 ? (
						<div className="text-center py-8">
							<div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
								<svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
								</svg>
							</div>
							<p className="text-gray-500 text-sm">No sessions yet</p>
							<p className="text-gray-400 text-xs mt-1">Create a new session to get started</p>
						</div>
					) : (
						<div className="space-y-1">
							{sessions.map((session) => (
								<SessionItem
									key={session.id}
									session={session}
									isActive={session.id === currentSessionId}
									onSelect={() => {
										onSwitchSession(session.id);
										onClose();
									}}
									onDelete={() => handleDelete(session.id)}
									isDeleting={deletingId === session.id}
								/>
							))}
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="px-4 py-3 border-t bg-gray-50 rounded-b-xl">
					<p className="text-xs text-gray-500 text-center">
						{sessions.length} session{sessions.length !== 1 ? 's' : ''} available
					</p>
				</div>
			</div>
		</div>
	);
});
