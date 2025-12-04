/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared utilities for orchestrator webviews
 */

/**
 * Generate a nonce for CSP-safe inline scripts
 */
export function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

/**
 * Format a timestamp as a relative time string
 */
export function formatRelativeTime(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (seconds < 60) {
		return 'just now';
	} else if (minutes < 60) {
		return `${minutes}m ago`;
	} else if (hours < 24) {
		return `${hours}h ago`;
	} else {
		return `${days}d ago`;
	}
}

/**
 * Format a timestamp as absolute time (HH:MM)
 */
export function formatTime(timestamp: number): string {
	const date = new Date(timestamp);
	return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Simple markdown to HTML conversion for chat messages.
 * Supports: bold, italic, code blocks, inline code, links, headers, lists
 */
export function renderMarkdown(text: string): string {
	let html = escapeHtml(text);

	// Code blocks (```lang\ncode\n```)
	html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
		const langClass = lang ? ` class="language-${lang}"` : '';
		return `<pre><code${langClass}>${code.trim()}</code></pre>`;
	});

	// Inline code (`code`)
	html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

	// Bold (**text** or __text__)
	html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

	// Italic (*text* or _text_)
	html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
	html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

	// Headers (# ## ###)
	html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
	html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
	html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

	// Unordered lists (- item)
	html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
	html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

	// Links [text](url)
	html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

	// Line breaks
	html = html.replace(/\n/g, '<br>');

	// Clean up extra <br> after block elements
	html = html.replace(/<\/(pre|ul|h2|h3|h4)><br>/g, '</$1>');

	return html;
}

/**
 * Get shared CSS variables and base styles for orchestrator webviews
 */
export function getBaseStyles(): string {
	return `
		:root {
			--vscode-font-family: var(--vscode-editor-font-family, 'Segoe UI', Tahoma, sans-serif);
			--vscode-font-size: var(--vscode-editor-font-size, 13px);
		}

		* {
			box-sizing: border-box;
		}

		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
			background: var(--vscode-sideBar-background);
			margin: 0;
			padding: 10px;
			line-height: 1.4;
		}

		/* Scrollbar styling */
		::-webkit-scrollbar {
			width: 8px;
			height: 8px;
		}
		::-webkit-scrollbar-track {
			background: transparent;
		}
		::-webkit-scrollbar-thumb {
			background: var(--vscode-scrollbarSlider-background);
			border-radius: 4px;
		}
		::-webkit-scrollbar-thumb:hover {
			background: var(--vscode-scrollbarSlider-hoverBackground);
		}

		/* Button styles */
		button {
			padding: 4px 10px;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			border-radius: 3px;
			cursor: pointer;
			font-size: 0.9em;
		}
		button:hover {
			background: var(--vscode-button-hoverBackground);
		}
		button.secondary {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}
		button.secondary:hover {
			background: var(--vscode-button-secondaryHoverBackground);
		}
		button.success {
			background: var(--vscode-testing-iconPassed);
			color: white;
		}
		button.danger {
			background: var(--vscode-errorForeground);
			color: white;
		}
		button:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}

		/* Input styles */
		input, textarea, select {
			padding: 6px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 3px;
			font-family: inherit;
			font-size: inherit;
		}
		input:focus, textarea:focus, select:focus {
			outline: 1px solid var(--vscode-focusBorder);
			border-color: var(--vscode-focusBorder);
		}
		textarea {
			resize: vertical;
			min-height: 60px;
		}

		/* Code styles */
		pre {
			background: var(--vscode-textCodeBlock-background);
			padding: 10px;
			border-radius: 4px;
			overflow-x: auto;
			margin: 8px 0;
		}
		code {
			font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
			font-size: 0.9em;
		}
		.inline-code {
			background: var(--vscode-textCodeBlock-background);
			padding: 2px 5px;
			border-radius: 3px;
		}

		/* Status badges */
		.badge {
			font-size: 0.75em;
			padding: 2px 6px;
			border-radius: 10px;
			text-transform: uppercase;
			font-weight: 500;
		}
		.badge.running { background: var(--vscode-charts-blue); color: white; }
		.badge.idle { background: var(--vscode-descriptionForeground); color: white; }
		.badge.waiting { background: var(--vscode-notificationsWarningIcon-foreground); color: black; }
		.badge.paused { background: var(--vscode-notificationsWarningIcon-foreground); color: black; }
		.badge.completed { background: var(--vscode-testing-iconPassed); color: white; }
		.badge.error { background: var(--vscode-errorForeground); color: white; }
		.badge.pending { background: var(--vscode-descriptionForeground); color: white; }
		.badge.staged { background: var(--vscode-gitDecoration-addedResourceForeground); color: white; }
		.badge.modified { background: var(--vscode-gitDecoration-modifiedResourceForeground); color: white; }
		.badge.untracked { background: var(--vscode-gitDecoration-untrackedResourceForeground); color: white; }

		/* Card styles */
		.card {
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-widget-border);
			border-radius: 4px;
			padding: 10px;
			margin-bottom: 10px;
		}

		/* Icon styles */
		.icon {
			display: inline-block;
			width: 16px;
			height: 16px;
			vertical-align: middle;
			margin-right: 4px;
		}

		/* Flex utilities */
		.flex { display: flex; }
		.flex-col { flex-direction: column; }
		.flex-row { flex-direction: row; }
		.flex-1 { flex: 1; }
		.items-center { align-items: center; }
		.justify-between { justify-content: space-between; }
		.gap-1 { gap: 4px; }
		.gap-2 { gap: 8px; }
		.gap-3 { gap: 12px; }

		/* Spacing utilities */
		.m-0 { margin: 0; }
		.mb-1 { margin-bottom: 4px; }
		.mb-2 { margin-bottom: 8px; }
		.mt-2 { margin-top: 8px; }
		.p-2 { padding: 8px; }

		/* Text utilities */
		.text-sm { font-size: 0.85em; }
		.text-muted { color: var(--vscode-descriptionForeground); }
		.text-center { text-align: center; }
		.font-mono { font-family: var(--vscode-editor-font-family, monospace); }
		.font-bold { font-weight: bold; }
		.truncate {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	`;
}

/**
 * Get the event delegation script for handling clicks via data-action attributes
 */
export function getEventDelegationScript(): string {
	return `
		// Event delegation for all data-action clicks
		document.addEventListener('click', function(event) {
			const target = event.target.closest('[data-action]');
			if (!target) return;

			const action = target.getAttribute('data-action');
			const workerId = target.getAttribute('data-worker-id');
			const taskId = target.getAttribute('data-task-id');
			const approvalId = target.getAttribute('data-approval-id');

			handleAction(action, { workerId, taskId, approvalId, target });
		});

		// Keyboard support for Enter on buttons
		document.addEventListener('keydown', function(event) {
			if (event.key === 'Enter') {
				const target = event.target.closest('[data-action]');
				if (target) {
					target.click();
				}
			}
		});
	`;
}
