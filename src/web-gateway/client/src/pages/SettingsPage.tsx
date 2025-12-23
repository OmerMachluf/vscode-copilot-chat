/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState, useCallback, useEffect } from 'react';
import { useConnectionStatus, useAuth } from '@/hooks';

interface SettingsSection {
	id: string;
	title: string;
	icon: React.ReactNode;
}

const sections: SettingsSection[] = [
	{
		id: 'connection',
		title: 'Connection',
		icon: (
			<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
			</svg>
		),
	},
	{
		id: 'appearance',
		title: 'Appearance',
		icon: (
			<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
			</svg>
		),
	},
	{
		id: 'keyboard',
		title: 'Keyboard Shortcuts',
		icon: (
			<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
			</svg>
		),
	},
	{
		id: 'about',
		title: 'About',
		icon: (
			<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
		),
	},
];

export function SettingsPage() {
	const [activeSection, setActiveSection] = useState('connection');
	const { status, refresh, isLoading: connectionLoading } = useConnectionStatus();
	const { logout } = useAuth();
	const [streamingEnabled, setStreamingEnabled] = useState(true);
	const [autoScroll, setAutoScroll] = useState(true);
	const [showTimestamps, setShowTimestamps] = useState(true);
	const [fontSize, setFontSize] = useState('medium');

	// Load settings from localStorage
	useEffect(() => {
		const savedSettings = localStorage.getItem('gateway-settings');
		if (savedSettings) {
			try {
				const settings = JSON.parse(savedSettings);
				setStreamingEnabled(settings.streamingEnabled ?? true);
				setAutoScroll(settings.autoScroll ?? true);
				setShowTimestamps(settings.showTimestamps ?? true);
				setFontSize(settings.fontSize ?? 'medium');
			} catch {
				// Ignore parse errors
			}
		}
	}, []);

	// Save settings to localStorage
	const saveSettings = useCallback(() => {
		const settings = {
			streamingEnabled,
			autoScroll,
			showTimestamps,
			fontSize,
		};
		localStorage.setItem('gateway-settings', JSON.stringify(settings));
	}, [streamingEnabled, autoScroll, showTimestamps, fontSize]);

	useEffect(() => {
		saveSettings();
	}, [saveSettings]);

	const renderConnectionSection = () => (
		<div className="space-y-6">
			<div>
				<h3 className="text-lg font-medium text-gray-900 mb-4">Connection Status</h3>
				<div className="bg-gray-50 rounded-lg p-4 space-y-3">
					<div className="flex items-center justify-between">
						<span className="text-sm text-gray-600">Gateway Status</span>
						<div className="flex items-center gap-2">
							<span className={`w-2 h-2 rounded-full ${status?.connected ? 'bg-green-500' : 'bg-red-500'}`} />
							<span className="text-sm font-medium">
								{status?.connected ? 'Connected' : 'Disconnected'}
							</span>
						</div>
					</div>
					{status?.vscodeVersion && (
						<div className="flex items-center justify-between">
							<span className="text-sm text-gray-600">VS Code Version</span>
							<span className="text-sm font-medium">{status.vscodeVersion}</span>
						</div>
					)}
					{status?.extensionVersion && (
						<div className="flex items-center justify-between">
							<span className="text-sm text-gray-600">Extension Version</span>
							<span className="text-sm font-medium">{status.extensionVersion}</span>
						</div>
					)}
				</div>
				<button
					onClick={refresh}
					disabled={connectionLoading}
					className="mt-4 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
				>
					{connectionLoading ? 'Refreshing...' : 'Refresh Status'}
				</button>
			</div>

			<div className="border-t pt-6">
				<h3 className="text-lg font-medium text-gray-900 mb-4">Chat Settings</h3>
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<div>
							<span className="text-sm font-medium text-gray-900">Streaming Responses</span>
							<p className="text-xs text-gray-500">Show responses as they are generated</p>
						</div>
						<button
							onClick={() => setStreamingEnabled(!streamingEnabled)}
							className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
								streamingEnabled ? 'bg-primary-600' : 'bg-gray-200'
							}`}
						>
							<span
								className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
									streamingEnabled ? 'translate-x-6' : 'translate-x-1'
								}`}
							/>
						</button>
					</div>
				</div>
			</div>
		</div>
	);

	const renderAppearanceSection = () => (
		<div className="space-y-6">
			<div>
				<h3 className="text-lg font-medium text-gray-900 mb-4">Display</h3>
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<div>
							<span className="text-sm font-medium text-gray-900">Auto-scroll</span>
							<p className="text-xs text-gray-500">Automatically scroll to new messages</p>
						</div>
						<button
							onClick={() => setAutoScroll(!autoScroll)}
							className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
								autoScroll ? 'bg-primary-600' : 'bg-gray-200'
							}`}
						>
							<span
								className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
									autoScroll ? 'translate-x-6' : 'translate-x-1'
								}`}
							/>
						</button>
					</div>

					<div className="flex items-center justify-between">
						<div>
							<span className="text-sm font-medium text-gray-900">Show Timestamps</span>
							<p className="text-xs text-gray-500">Display time for each message</p>
						</div>
						<button
							onClick={() => setShowTimestamps(!showTimestamps)}
							className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
								showTimestamps ? 'bg-primary-600' : 'bg-gray-200'
							}`}
						>
							<span
								className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
									showTimestamps ? 'translate-x-6' : 'translate-x-1'
								}`}
							/>
						</button>
					</div>

					<div>
						<span className="text-sm font-medium text-gray-900">Font Size</span>
						<p className="text-xs text-gray-500 mb-2">Adjust the text size in chat</p>
						<div className="flex gap-2">
							{['small', 'medium', 'large'].map((size) => (
								<button
									key={size}
									onClick={() => setFontSize(size)}
									className={`px-4 py-2 text-sm rounded-lg capitalize transition-colors ${
										fontSize === size
											? 'bg-primary-100 text-primary-700 font-medium'
											: 'bg-gray-100 text-gray-700 hover:bg-gray-200'
									}`}
								>
									{size}
								</button>
							))}
						</div>
					</div>
				</div>
			</div>
		</div>
	);

	const renderKeyboardSection = () => (
		<div className="space-y-6">
			<h3 className="text-lg font-medium text-gray-900 mb-4">Keyboard Shortcuts</h3>
			<div className="bg-gray-50 rounded-lg divide-y">
				{[
					{ action: 'Send message', shortcut: 'Enter' },
					{ action: 'New line', shortcut: 'Shift + Enter' },
					{ action: 'Cancel response', shortcut: 'Escape' },
					{ action: 'Clear chat', shortcut: 'Ctrl + L' },
					{ action: 'Focus input', shortcut: '/' },
				].map(({ action, shortcut }) => (
					<div key={action} className="flex items-center justify-between p-3">
						<span className="text-sm text-gray-600">{action}</span>
						<kbd className="px-2 py-1 text-xs font-mono bg-white border border-gray-200 rounded">
							{shortcut}
						</kbd>
					</div>
				))}
			</div>
		</div>
	);

	const renderAboutSection = () => (
		<div className="space-y-6">
			<div>
				<h3 className="text-lg font-medium text-gray-900 mb-4">About Copilot Gateway</h3>
				<div className="bg-gray-50 rounded-lg p-4 space-y-3">
					<div className="flex items-center justify-between">
						<span className="text-sm text-gray-600">Version</span>
						<span className="text-sm font-medium">0.1.0</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-sm text-gray-600">Build</span>
						<span className="text-sm font-medium">Development</span>
					</div>
				</div>
			</div>

			<div className="border-t pt-6">
				<h3 className="text-lg font-medium text-gray-900 mb-4">Account</h3>
				<button
					onClick={logout}
					className="px-4 py-2 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
				>
					Sign Out
				</button>
			</div>

			<div className="border-t pt-6">
				<h3 className="text-lg font-medium text-gray-900 mb-4">Links</h3>
				<div className="space-y-2">
					<a
						href="https://github.com/microsoft/vscode-copilot-chat"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700"
					>
						<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
							<path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
						</svg>
						GitHub Repository
					</a>
					<a
						href="https://code.visualstudio.com/docs/copilot/overview"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700"
					>
						<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
						</svg>
						Documentation
					</a>
				</div>
			</div>
		</div>
	);

	const renderContent = () => {
		switch (activeSection) {
			case 'connection':
				return renderConnectionSection();
			case 'appearance':
				return renderAppearanceSection();
			case 'keyboard':
				return renderKeyboardSection();
			case 'about':
				return renderAboutSection();
			default:
				return null;
		}
	};

	return (
		<div className="min-h-screen bg-gray-50 py-8 px-4">
			<div className="max-w-4xl mx-auto">
				<h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

				<div className="flex flex-col md:flex-row gap-6">
					{/* Sidebar */}
					<div className="md:w-56 flex-shrink-0">
						<nav className="space-y-1">
							{sections.map((section) => (
								<button
									key={section.id}
									onClick={() => setActiveSection(section.id)}
									className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
										activeSection === section.id
											? 'bg-primary-100 text-primary-700'
											: 'text-gray-600 hover:bg-gray-100'
									}`}
								>
									{section.icon}
									{section.title}
								</button>
							))}
						</nav>
					</div>

					{/* Content */}
					<div className="flex-1 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
						{renderContent()}
					</div>
				</div>
			</div>
		</div>
	);
}
