/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as http from 'http';
import { HttpResponseStreamAdapter, type HttpStreamEvent } from '../httpResponseStreamAdapter';
import {
	ChatResponseMarkdownPart,
	ChatResponseProgressPart,
	ChatResponseWarningPart,
	ChatResponseClearToPreviousToolInvocationReason,
	MarkdownString,
	Range,
	Position,
	TextEdit,
	Uri,
	Location,
} from '../../../../vscodeTypes';

/**
 * Mock HTTP ServerResponse for testing SSE output
 */
class MockServerResponse {
	public writtenData: string[] = [];
	public headers: Record<string, string> = {};
	public statusCode: number = 0;
	public ended = false;
	private _closeHandlers: (() => void)[] = [];

	writeHead(statusCode: number, headers: Record<string, string>): void {
		this.statusCode = statusCode;
		this.headers = headers;
	}

	write(data: string): boolean {
		this.writtenData.push(data);
		return true;
	}

	end(): void {
		this.ended = true;
	}

	on(event: string, handler: () => void): void {
		if (event === 'close') {
			this._closeHandlers.push(handler);
		}
	}

	// Test helper: simulate client disconnect
	simulateClose(): void {
		for (const handler of this._closeHandlers) {
			handler();
		}
	}

	// Test helper: parse all written SSE events
	getEvents(): HttpStreamEvent[] {
		return this.writtenData
			.filter(data => data.startsWith('data: '))
			.map(data => {
				const jsonStr = data.replace('data: ', '').replace('\n\n', '');
				return JSON.parse(jsonStr) as HttpStreamEvent;
			});
	}

	// Test helper: get events of a specific type
	getEventsOfType(type: string): HttpStreamEvent[] {
		return this.getEvents().filter(e => e.type === type);
	}
}

describe('HttpResponseStreamAdapter', () => {
	let mockResponse: MockServerResponse;
	let adapter: HttpResponseStreamAdapter;

	beforeEach(() => {
		mockResponse = new MockServerResponse();
		adapter = new HttpResponseStreamAdapter(mockResponse as unknown as http.ServerResponse);
	});

	describe('constructor and SSE setup', () => {
		it('should set SSE headers on construction', () => {
			expect(mockResponse.statusCode).toBe(200);
			expect(mockResponse.headers['Content-Type']).toBe('text/event-stream');
			expect(mockResponse.headers['Cache-Control']).toBe('no-cache');
			expect(mockResponse.headers['Connection']).toBe('keep-alive');
		});

		it('should not be closed initially', () => {
			expect(adapter.isClosed).toBe(false);
		});
	});

	describe('close()', () => {
		it('should send close event and end response', () => {
			adapter.close();

			const events = mockResponse.getEventsOfType('close');
			expect(events).toHaveLength(1);
			expect(mockResponse.ended).toBe(true);
			expect(adapter.isClosed).toBe(true);
		});

		it('should be idempotent', () => {
			adapter.close();
			adapter.close();

			const events = mockResponse.getEventsOfType('close');
			expect(events).toHaveLength(1);
		});

		it('should call onClose callback', () => {
			const onClose = vi.fn();
			const adapterWithCallback = new HttpResponseStreamAdapter(
				mockResponse as unknown as http.ServerResponse,
				{ onClose }
			);

			adapterWithCallback.close();

			expect(onClose).toHaveBeenCalledTimes(1);
		});
	});

	describe('client disconnect handling', () => {
		it('should set isClosed on client disconnect', () => {
			mockResponse.simulateClose();

			expect(adapter.isClosed).toBe(true);
		});

		it('should call onClose callback on client disconnect', () => {
			const onClose = vi.fn();
			const adapterWithCallback = new HttpResponseStreamAdapter(
				mockResponse as unknown as http.ServerResponse,
				{ onClose }
			);

			mockResponse.simulateClose();

			expect(onClose).toHaveBeenCalledTimes(1);
		});

		it('should not write after client disconnect', () => {
			mockResponse.simulateClose();

			adapter.markdown('test');

			// Should have no data events (only whatever happened before close)
			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(0);
		});
	});

	describe('markdown()', () => {
		it('should send string markdown as SSE part event', () => {
			adapter.markdown('Hello, world!');

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			expect(events[0].part?.type).toBe('markdown');
			expect(events[0].part?.content).toBe('Hello, world!');
		});

		it('should serialize MarkdownString with all properties', () => {
			const md = new MarkdownString('**bold**');
			md.isTrusted = true;
			md.supportThemeIcons = true;

			adapter.markdown(md);

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			const content = events[0].part?.content as { value: string; isTrusted: boolean };
			expect(content.value).toBe('**bold**');
			expect(content.isTrusted).toBe(true);
		});
	});

	describe('progress()', () => {
		it('should send progress as SSE part event', () => {
			adapter.progress('Loading...');

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			expect(events[0].part?.type).toBe('progress');
			expect(events[0].part?.progressMessage).toBe('Loading...');
		});
	});

	describe('anchor()', () => {
		it('should serialize Uri anchor', () => {
			const uri = Uri.file('/path/to/file.ts');

			adapter.anchor(uri, 'file.ts');

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			expect(events[0].part?.type).toBe('anchor');
			expect(events[0].part?.uri).toContain('file.ts');
			expect(events[0].part?.title).toBe('file.ts');
		});

		it('should serialize Location anchor with range', () => {
			const uri = Uri.file('/path/to/file.ts');
			const range = new Range(new Position(10, 5), new Position(10, 15));
			const location = new Location(uri, range);

			adapter.anchor(location);

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			expect(events[0].part?.range).toEqual({
				startLine: 10,
				startChar: 5,
				endLine: 10,
				endChar: 15,
			});
		});
	});

	describe('reference()', () => {
		it('should serialize Uri reference', () => {
			const uri = Uri.file('/path/to/file.ts');

			adapter.reference(uri);

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			expect(events[0].part?.type).toBe('reference');
			expect(events[0].part?.uri).toContain('file.ts');
		});

		it('should serialize variableName reference', () => {
			adapter.reference({ variableName: 'myVar' });

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			expect(events[0].part?.variableName).toBe('myVar');
		});
	});

	describe('button()', () => {
		it('should send warning for interactive button', () => {
			adapter.button({
				title: 'Click Me',
				command: 'my.command',
			});

			const warnings = mockResponse.getEventsOfType('warning');
			expect(warnings).toHaveLength(1);
			expect(warnings[0].message).toContain('Click Me');
			expect(warnings[0].message).toContain('my.command');
		});

		it('should still emit command part after warning', () => {
			adapter.button({
				title: 'Click Me',
				command: 'my.command',
			});

			const parts = mockResponse.getEventsOfType('part');
			expect(parts).toHaveLength(1);
			expect(parts[0].part?.type).toBe('command');
			expect(parts[0].part?.command?.title).toBe('Click Me');
		});
	});

	describe('filetree()', () => {
		it('should serialize file tree with nested children', () => {
			const baseUri = Uri.file('/project');
			const tree = [
				{
					name: 'src',
					children: [
						{ name: 'index.ts' },
						{ name: 'utils.ts' },
					],
				},
				{ name: 'package.json' },
			];

			adapter.filetree(tree, baseUri);

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			expect(events[0].part?.type).toBe('filetree');
			expect(events[0].part?.treeItems).toHaveLength(2);
			expect(events[0].part?.treeItems?.[0].name).toBe('src');
			expect(events[0].part?.treeItems?.[0].children).toHaveLength(2);
		});
	});

	describe('warning()', () => {
		it('should send warning as part event', () => {
			adapter.warning('Something went wrong');

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			expect(events[0].part?.type).toBe('warning');
			expect(events[0].part?.content).toBe('Something went wrong');
		});
	});

	describe('confirmation()', () => {
		it('should send warning for interactive confirmation', () => {
			adapter.confirmation('Confirm Action', 'Are you sure?', { id: 123 }, ['Yes', 'No']);

			const warnings = mockResponse.getEventsOfType('warning');
			expect(warnings).toHaveLength(1);
			expect(warnings[0].message).toContain('Confirm Action');
		});

		it('should emit confirmation part with all data', () => {
			adapter.confirmation('Confirm Action', 'Are you sure?', { id: 123 }, ['Yes', 'No']);

			const parts = mockResponse.getEventsOfType('part');
			expect(parts).toHaveLength(1);
			expect(parts[0].part?.type).toBe('confirmation');
			expect(parts[0].part?.title).toBe('Confirm Action');
			expect(parts[0].part?.message).toBe('Are you sure?');
			expect(parts[0].part?.buttons).toEqual(['Yes', 'No']);
		});
	});

	describe('textEdit()', () => {
		it('should serialize text edits with range', () => {
			const uri = Uri.file('/path/to/file.ts');
			const edit = new TextEdit(new Range(new Position(5, 0), new Position(5, 10)), 'new text');

			adapter.textEdit(uri, [edit]);

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			expect(events[0].part?.type).toBe('textEdit');
			expect(events[0].part?.edits).toHaveLength(1);
		});

		it('should handle isDone=true', () => {
			const uri = Uri.file('/path/to/file.ts');

			adapter.textEdit(uri, true);

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			expect(events[0].part?.isDone).toBe(true);
		});
	});

	describe('thinkingProgress()', () => {
		it('should serialize thinking progress with id and metadata', () => {
			adapter.thinkingProgress({
				text: 'Analyzing code...',
				id: 'think-123',
				metadata: { step: 1 },
			});

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			expect(events[0].part?.type).toBe('thinkingProgress');
			expect(events[0].part?.content).toBe('Analyzing code...');
			expect(events[0].part?.thinkingId).toBe('think-123');
		});
	});

	describe('codeblockUri()', () => {
		it('should serialize codeblock uri with isEdit flag', () => {
			const uri = Uri.file('/path/to/file.ts');

			adapter.codeblockUri(uri, true);

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			expect(events[0].part?.type).toBe('codeblockUri');
			expect(events[0].part?.isEdit).toBe(true);
		});
	});

	describe('codeCitation()', () => {
		it('should serialize code citation', () => {
			const uri = Uri.parse('https://github.com/example');

			adapter.codeCitation(uri, 'MIT', 'function example() {}');

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			expect(events[0].part?.type).toBe('codeCitation');
			expect(events[0].part?.license).toBe('MIT');
			expect(events[0].part?.snippet).toBe('function example() {}');
		});
	});

	describe('prepareToolInvocation()', () => {
		it('should send prepareToolInvocation part', () => {
			adapter.prepareToolInvocation('my_tool');

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			expect(events[0].part?.type).toBe('prepareToolInvocation');
			expect(events[0].part?.toolName).toBe('my_tool');
		});
	});

	describe('clearToPreviousToolInvocation()', () => {
		it('should send clear event with reason', () => {
			adapter.clearToPreviousToolInvocation(ChatResponseClearToPreviousToolInvocationReason.FilteredContentRetry);

			const events = mockResponse.getEventsOfType('clear');
			expect(events).toHaveLength(1);
			expect(events[0].reason).toBe(ChatResponseClearToPreviousToolInvocationReason.FilteredContentRetry);
		});
	});

	describe('push()', () => {
		it('should handle ChatResponseMarkdownPart', () => {
			const part = new ChatResponseMarkdownPart('Hello');

			adapter.push(part);

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			expect(events[0].part?.type).toBe('markdown');
		});

		it('should handle ChatResponseProgressPart', () => {
			const part = new ChatResponseProgressPart('Loading...');

			adapter.push(part);

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			expect(events[0].part?.type).toBe('progress');
		});

		it('should handle ChatResponseWarningPart', () => {
			const part = new ChatResponseWarningPart('Warning!');

			adapter.push(part);

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			expect(events[0].part?.type).toBe('warning');
		});

		it('should handle unknown part types gracefully', () => {
			const unknownPart = { someField: 'value' } as any;

			adapter.push(unknownPart);

			const events = mockResponse.getEventsOfType('part');
			expect(events).toHaveLength(1);
			expect(events[0].part?.type).toBe('unknown');
		});
	});

	describe('SSE format', () => {
		it('should format events correctly with data: prefix and double newline', () => {
			adapter.markdown('test');

			expect(mockResponse.writtenData).toHaveLength(1);
			expect(mockResponse.writtenData[0]).toMatch(/^data: \{.*\}\n\n$/);
		});

		it('should produce valid JSON in SSE events', () => {
			adapter.markdown('test');

			const jsonStr = mockResponse.writtenData[0].replace('data: ', '').replace('\n\n', '');
			expect(() => JSON.parse(jsonStr)).not.toThrow();
		});
	});
});
