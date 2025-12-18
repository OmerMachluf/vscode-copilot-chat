/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, beforeEach } from 'vitest';
import { MarkdownGenerator } from '../markdownGenerator';

describe('MarkdownGenerator', () => {
	let generator: MarkdownGenerator;

	beforeEach(() => {
		generator = new MarkdownGenerator();
	});

	describe('generateTable', () => {
		it('should generate a basic table', () => {
			const headers = ['Name', 'Type', 'Description'];
			const rows = [
				['foo', 'string', 'A foo value'],
				['bar', 'number', 'A bar value']
			];

			const result = generator.generateTable(headers, rows);

			expect(result).toContain('| Name | Type | Description |');
			expect(result).toContain('| foo | string | A foo value |');
			expect(result).toContain('| bar | number | A bar value |');
		});

		it('should handle alignment options', () => {
			const headers = ['Left', 'Center', 'Right'];
			const rows = [['a', 'b', 'c']];

			const result = generator.generateTable(headers, rows, ['left', 'center', 'right']);

			expect(result).toContain(':---');
			expect(result).toContain(':---:');
			expect(result).toContain('---:');
		});

		it('should return empty string for empty headers', () => {
			const result = generator.generateTable([], []);
			expect(result).toBe('');
		});

		it('should pad rows shorter than headers', () => {
			const headers = ['A', 'B', 'C'];
			const rows = [['1']];

			const result = generator.generateTable(headers, rows);

			expect(result).toContain('| 1 |  |  |');
		});
	});

	describe('generateList', () => {
		it('should generate an unordered list', () => {
			const items = ['Item 1', 'Item 2', 'Item 3'];

			const result = generator.generateList(items);

			expect(result).toBe('- Item 1\n- Item 2\n- Item 3');
		});

		it('should generate an ordered list', () => {
			const items = ['First', 'Second', 'Third'];

			const result = generator.generateList(items, true);

			expect(result).toBe('1. First\n2. Second\n3. Third');
		});

		it('should return empty string for empty items', () => {
			const result = generator.generateList([]);
			expect(result).toBe('');
		});

		it('should handle indentation', () => {
			const items = ['Nested'];

			const result = generator.generateList(items, false, 2);

			expect(result).toBe('    - Nested');
		});
	});

	describe('generateNestedList', () => {
		it('should generate nested lists', () => {
			const items = [
				{
					text: 'Parent 1',
					children: [
						{ text: 'Child 1' },
						{ text: 'Child 2' }
					]
				},
				{ text: 'Parent 2' }
			];

			const result = generator.generateNestedList(items);

			expect(result).toContain('- Parent 1');
			expect(result).toContain('  - Child 1');
			expect(result).toContain('  - Child 2');
			expect(result).toContain('- Parent 2');
		});
	});

	describe('generateCodeBlock', () => {
		it('should generate a code block with language', () => {
			const code = 'const x = 1;';

			const result = generator.generateCodeBlock(code, 'typescript');

			expect(result).toBe('```typescript\nconst x = 1;\n```');
		});

		it('should generate a code block without language', () => {
			const code = 'plain text';

			const result = generator.generateCodeBlock(code);

			expect(result).toBe('```\nplain text\n```');
		});
	});

	describe('generateMermaidBlock', () => {
		it('should generate a mermaid block', () => {
			const diagram = 'graph TD\n  A --> B';

			const result = generator.generateMermaidBlock(diagram);

			expect(result).toBe('```mermaid\ngraph TD\n  A --> B\n```');
		});
	});

	describe('generateDetails', () => {
		it('should generate a collapsible details section', () => {
			const result = generator.generateDetails('Click to expand', 'Hidden content');

			expect(result).toContain('<details>');
			expect(result).toContain('<summary>Click to expand</summary>');
			expect(result).toContain('Hidden content');
			expect(result).toContain('</details>');
		});

		it('should generate an open details section', () => {
			const result = generator.generateDetails('Open by default', 'Content', true);

			expect(result).toContain('<details open>');
		});
	});

	describe('generateLink', () => {
		it('should generate a basic link', () => {
			const result = generator.generateLink('Click here', 'https://example.com');

			expect(result).toBe('[Click here](https://example.com)');
		});

		it('should generate a link with title', () => {
			const result = generator.generateLink('Click', 'https://example.com', 'Example');

			expect(result).toBe('[Click](https://example.com "Example")');
		});
	});

	describe('generateBadge', () => {
		it('should generate a shields.io badge', () => {
			const result = generator.generateBadge('build', 'passing', 'green');

			expect(result).toContain('img.shields.io');
			expect(result).toContain('build');
			expect(result).toContain('passing');
			expect(result).toContain('green');
		});
	});

	describe('generateHeading', () => {
		it('should generate headings of different levels', () => {
			expect(generator.generateHeading('H1', 1)).toBe('# H1');
			expect(generator.generateHeading('H2', 2)).toBe('## H2');
			expect(generator.generateHeading('H3', 3)).toBe('### H3');
			expect(generator.generateHeading('H6', 6)).toBe('###### H6');
		});

		it('should clamp level to valid range', () => {
			expect(generator.generateHeading('Test', 0)).toBe('# Test');
			expect(generator.generateHeading('Test', 10)).toBe('###### Test');
		});
	});

	describe('generateBlockquote', () => {
		it('should generate a blockquote', () => {
			const result = generator.generateBlockquote('Quote text');

			expect(result).toBe('> Quote text');
		});

		it('should handle multi-line quotes', () => {
			const result = generator.generateBlockquote('Line 1\nLine 2');

			expect(result).toBe('> Line 1\n> Line 2');
		});
	});

	describe('generateCallout', () => {
		it('should generate a note callout', () => {
			const result = generator.generateCallout('note', 'This is a note');

			expect(result).toContain('[!NOTE]');
			expect(result).toContain('This is a note');
		});

		it('should generate a warning callout', () => {
			const result = generator.generateCallout('warning', 'Be careful!');

			expect(result).toContain('[!WARNING]');
		});
	});

	describe('escapeMarkdown', () => {
		it('should escape special characters', () => {
			const text = 'Hello *world* and [link]';

			const result = generator.escapeMarkdown(text);

			expect(result).toBe('Hello \\*world\\* and \\[link\\]');
		});
	});

	describe('generateInlineCode', () => {
		it('should generate inline code', () => {
			const result = generator.generateInlineCode('const x = 1');

			expect(result).toBe('`const x = 1`');
		});

		it('should handle code with backticks', () => {
			const result = generator.generateInlineCode('use `backticks`');

			expect(result).toBe('`` use `backticks` ``');
		});
	});

	describe('generateBold', () => {
		it('should generate bold text', () => {
			expect(generator.generateBold('text')).toBe('**text**');
		});
	});

	describe('generateItalic', () => {
		it('should generate italic text', () => {
			expect(generator.generateItalic('text')).toBe('*text*');
		});
	});

	describe('generateStrikethrough', () => {
		it('should generate strikethrough text', () => {
			expect(generator.generateStrikethrough('text')).toBe('~~text~~');
		});
	});

	describe('generateTaskList', () => {
		it('should generate a task list', () => {
			const items = [
				{ text: 'Done task', checked: true },
				{ text: 'Pending task', checked: false }
			];

			const result = generator.generateTaskList(items);

			expect(result).toContain('- [x] Done task');
			expect(result).toContain('- [ ] Pending task');
		});
	});

	describe('generateTableOfContents', () => {
		it('should generate TOC from sections', () => {
			const sections = [
				{ id: 'intro', title: 'Introduction', level: 2, order: 1, content: '' },
				{ id: 'details', title: 'Details', level: 2, order: 2, content: '' }
			];

			const result = generator.generateTableOfContents(sections);

			expect(result).toContain('## Table of Contents');
			expect(result).toContain('[Introduction](#introduction)');
			expect(result).toContain('[Details](#details)');
		});
	});

	describe('generateAnchor', () => {
		it('should create URL-safe anchors', () => {
			expect(generator.generateAnchor('Hello World')).toBe('hello-world');
			expect(generator.generateAnchor('Test & Demo')).toBe('test--demo');
			expect(generator.generateAnchor('CamelCase')).toBe('camelcase');
		});
	});

	describe('generateHorizontalRule', () => {
		it('should generate a horizontal rule', () => {
			expect(generator.generateHorizontalRule()).toBe('---');
		});
	});

	describe('generateStatsSummary', () => {
		it('should generate formatted stats', () => {
			const stats = {
				totalFiles: 100,
				totalLines: 5000
			};

			const result = generator.generateStatsSummary(stats);

			expect(result).toContain('**total Files**: 100');
			expect(result).toContain('**total Lines**: 5,000');
		});
	});

	describe('generateProgressBar', () => {
		it('should generate a text progress bar', () => {
			const result = generator.generateProgressBar(50);

			expect(result).toContain('50.0%');
			expect(result.length).toBeGreaterThan(10);
		});

		it('should handle 0%', () => {
			const result = generator.generateProgressBar(0);
			expect(result).toContain('0.0%');
		});

		it('should handle 100%', () => {
			const result = generator.generateProgressBar(100);
			expect(result).toContain('100.0%');
		});
	});

	describe('joinBlocks', () => {
		it('should join blocks with double newlines', () => {
			const result = generator.joinBlocks('Block 1', 'Block 2', 'Block 3');

			expect(result).toBe('Block 1\n\nBlock 2\n\nBlock 3');
		});

		it('should filter empty blocks', () => {
			const result = generator.joinBlocks('Block 1', '', '  ', 'Block 2');

			expect(result).toBe('Block 1\n\nBlock 2');
		});
	});
});
