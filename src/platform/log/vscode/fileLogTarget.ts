/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogTarget, LogLevel } from '../common/logService';

/**
 * Log target that writes all logs to a file for debugging orchestration issues.
 * Creates a timestamped log file in the extension's storage directory.
 * Uses VS Code's workspace.fs API for cross-platform compatibility (web + node).
 */
export class FileLogTarget implements ILogTarget {
	private readonly _logFileUri: vscode.Uri;
	private readonly _logFilePath: string;
	private readonly _sessionId: string;
	private _buffer: string[] = [];
	private _flushTimer: ReturnType<typeof setTimeout> | undefined;
	private _isDisposed = false;
	private _initPromise: Promise<void>;

	constructor(extensionContext: vscode.ExtensionContext) {
		// Create logs directory path in extension storage
		const logsDir = vscode.Uri.joinPath(extensionContext.globalStorageUri, 'orchestrator-logs');

		// Create timestamped log file
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		this._logFileUri = vscode.Uri.joinPath(logsDir, `orchestrator-${timestamp}.log`);
		this._logFilePath = this._logFileUri.fsPath;
		this._sessionId = timestamp.slice(0, 19); // Just date and time for brevity

		// Log the file path to console so user knows where to find it
		console.log(`[FileLogTarget] Logging to: ${this._logFilePath}`);

		// Initialize asynchronously - create directory and write header
		this._initPromise = this._initialize(logsDir);
	}

	private async _initialize(logsDir: vscode.Uri): Promise<void> {
		try {
			// Create logs directory
			await vscode.workspace.fs.createDirectory(logsDir);

			// Write session header
			const header = [
				'',
				'='.repeat(80),
				`ORCHESTRATOR LOG SESSION: ${this._sessionId}`,
				`Started: ${new Date().toISOString()}`,
				`Log file: ${this._logFilePath}`,
				'='.repeat(80),
				'',
			].join('\n');

			await vscode.workspace.fs.writeFile(this._logFileUri, new TextEncoder().encode(header));
		} catch (error) {
			console.error(`[FileLogTarget] Failed to initialize log file: ${error}`);
		}
	}

	logIt(level: LogLevel, metadataStr: string, ...extra: any[]) {
		if (this._isDisposed) {
			return;
		}

		const timestamp = new Date().toISOString();
		const levelStr = LogLevel[level].toUpperCase().padEnd(7);

		// Format the log line
		let logLine = `[${timestamp}] [${levelStr}] ${metadataStr}`;

		// Add extra data if present (single line, no pretty-print)
		if (extra.length > 0) {
			const extraStr = extra.map(e => {
				if (typeof e === 'object') {
					try {
						return JSON.stringify(e);
					} catch {
						return String(e);
					}
				}
				return String(e);
			}).join(' ');
			logLine += ` | ${extraStr}`;
		}

		// Buffer the log line
		this._buffer.push(logLine);

		// Schedule a flush if not already scheduled
		if (!this._flushTimer) {
			this._flushTimer = setTimeout(() => this._flush(), 100);
		}
	}

	private async _flush(): Promise<void> {
		this._flushTimer = undefined;

		if (this._buffer.length === 0 || this._isDisposed) {
			return;
		}

		// Wait for initialization to complete
		await this._initPromise;

		// Take current buffer contents
		const lines = this._buffer;
		this._buffer = [];

		try {
			// Read existing content
			let existingContent = '';
			try {
				const existingData = await vscode.workspace.fs.readFile(this._logFileUri);
				existingContent = new TextDecoder().decode(existingData);
			} catch {
				// File may not exist yet, that's ok
			}

			// Append new lines
			const newContent = existingContent + lines.join('\n') + '\n';
			await vscode.workspace.fs.writeFile(this._logFileUri, new TextEncoder().encode(newContent));
		} catch (error) {
			console.error(`[FileLogTarget] Failed to write to log file: ${error}`);
			// Put lines back in buffer to try again
			this._buffer = [...lines, ...this._buffer];
		}
	}

	show(): void {
		// Could open the log file in VS Code, but for now just log the path
		console.log(`[FileLogTarget] Log file: ${this._logFilePath}`);
	}

	/**
	 * Get the path to the current log file
	 */
	getLogFilePath(): string {
		return this._logFilePath;
	}

	/**
	 * Close the write stream (call on extension deactivation)
	 */
	async dispose(): Promise<void> {
		this._isDisposed = true;

		if (this._flushTimer) {
			clearTimeout(this._flushTimer);
			this._flushTimer = undefined;
		}

		// Write final session footer
		this._buffer.push('');
		this._buffer.push('='.repeat(80));
		this._buffer.push(`SESSION ENDED: ${new Date().toISOString()}`);
		this._buffer.push('='.repeat(80));

		// Final flush
		await this._flush();
	}
}

/**
 * Singleton instance for access to file path from other parts of the codebase
 */
let _fileLogTargetInstance: FileLogTarget | undefined;

export function getFileLogTarget(): FileLogTarget | undefined {
	return _fileLogTargetInstance;
}

export function setFileLogTarget(instance: FileLogTarget): void {
	_fileLogTargetInstance = instance;
}
