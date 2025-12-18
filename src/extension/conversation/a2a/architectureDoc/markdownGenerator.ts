/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Markdown generation utilities for architecture documentation.
 *
 * This module provides functions for generating markdown content including
 * tables, lists, code blocks, diagrams, and other formatted elements.
 */

import { IDocumentSection, IMarkdownGenerator } from './architectureTypes';

// ============================================================================
// Markdown Generator Implementation
// ============================================================================

/**
 * Implementation of the markdown generator service.
 */
export class MarkdownGenerator implements IMarkdownGenerator {

	/**
	 * Generate a markdown table.
	 * @param headers Table headers
	 * @param rows Table rows
	 * @param alignment Column alignments (default: left)
	 * @returns Markdown table string
	 */
	generateTable(
		headers: string[],
		rows: string[][],
		alignment?: ('left' | 'center' | 'right')[]
	): string {
		if (headers.length === 0) {
			return '';
		}

		const alignments = alignment ?? headers.map(() => 'left');
		const lines: string[] = [];

		// Header row
		lines.push('| ' + headers.map(h => this.escapeMarkdown(h)).join(' | ') + ' |');

		// Separator row with alignment
		const separators = alignments.map(a => {
			switch (a) {
				case 'center': return ':---:';
				case 'right': return '---:';
				default: return ':---';
			}
		});
		lines.push('| ' + separators.join(' | ') + ' |');

		// Data rows
		for (const row of rows) {
			const cells = row.map(cell => this.escapeMarkdown(cell));
			// Pad with empty cells if row is shorter than headers
			while (cells.length < headers.length) {
				cells.push('');
			}
			lines.push('| ' + cells.slice(0, headers.length).join(' | ') + ' |');
		}

		return lines.join('\n');
	}

	/**
	 * Generate a markdown list.
	 * @param items List items
	 * @param ordered Whether list is ordered (numbered)
	 * @param indent Indentation level
	 * @returns Markdown list string
	 */
	generateList(items: string[], ordered = false, indent = 0): string {
		if (items.length === 0) {
			return '';
		}

		const prefix = '  '.repeat(indent);
		const lines: string[] = [];

		for (let i = 0; i < items.length; i++) {
			const marker = ordered ? `${i + 1}.` : '-';
			lines.push(`${prefix}${marker} ${items[i]}`);
		}

		return lines.join('\n');
	}

	/**
	 * Generate a nested markdown list.
	 * @param items Nested list items
	 * @param ordered Whether list is ordered
	 * @returns Markdown list string
	 */
	generateNestedList(
		items: Array<{ text: string; children?: Array<{ text: string; children?: Array<{ text: string }> }> }>,
		ordered = false
	): string {
		const lines: string[] = [];

		const addItems = (
			itemList: Array<{ text: string; children?: Array<{ text: string; children?: Array<{ text: string }> }> }>,
			level: number
		) => {
			const prefix = '  '.repeat(level);
			for (let i = 0; i < itemList.length; i++) {
				const item = itemList[i];
				const marker = ordered ? `${i + 1}.` : '-';
				lines.push(`${prefix}${marker} ${item.text}`);
				if (item.children && item.children.length > 0) {
					addItems(item.children, level + 1);
				}
			}
		};

		addItems(items, 0);
		return lines.join('\n');
	}

	/**
	 * Generate a markdown code block.
	 * @param code Code content
	 * @param language Language for syntax highlighting
	 * @returns Markdown code block string
	 */
	generateCodeBlock(code: string, language = ''): string {
		return '```' + language + '\n' + code + '\n```';
	}

	/**
	 * Generate a mermaid diagram block.
	 * @param diagram Mermaid diagram code
	 * @returns Markdown mermaid block string
	 */
	generateMermaidBlock(diagram: string): string {
		return '```mermaid\n' + diagram + '\n```';
	}

	/**
	 * Generate a collapsible details section.
	 * @param summary Summary text (always visible)
	 * @param content Content when expanded
	 * @param open Whether section starts open
	 * @returns HTML details element string
	 */
	generateDetails(summary: string, content: string, open = false): string {
		const openAttr = open ? ' open' : '';
		return `<details${openAttr}>\n<summary>${summary}</summary>\n\n${content}\n\n</details>`;
	}

	/**
	 * Generate a markdown link.
	 * @param text Link text
	 * @param url Link URL
	 * @param title Optional title attribute
	 * @returns Markdown link string
	 */
	generateLink(text: string, url: string, title?: string): string {
		if (title) {
			return `[${text}](${url} "${title}")`;
		}
		return `[${text}](${url})`;
	}

	/**
	 * Generate a markdown image.
	 * @param alt Alt text
	 * @param url Image URL
	 * @param title Optional title
	 * @returns Markdown image string
	 */
	generateImage(alt: string, url: string, title?: string): string {
		if (title) {
			return `![${alt}](${url} "${title}")`;
		}
		return `![${alt}](${url})`;
	}

	/**
	 * Generate a shields.io badge.
	 * @param label Badge label
	 * @param message Badge message
	 * @param color Badge color
	 * @returns Markdown badge image
	 */
	generateBadge(label: string, message: string, color = 'blue'): string {
		const encodedLabel = encodeURIComponent(label.replace(/-/g, '--').replace(/_/g, '__'));
		const encodedMessage = encodeURIComponent(message.replace(/-/g, '--').replace(/_/g, '__'));
		const url = `https://img.shields.io/badge/${encodedLabel}-${encodedMessage}-${color}`;
		return `![${label}: ${message}](${url})`;
	}

	/**
	 * Generate table of contents from sections.
	 * @param sections Document sections
	 * @param maxDepth Maximum depth to include (default: 3)
	 * @returns Markdown TOC string
	 */
	generateTableOfContents(sections: IDocumentSection[], maxDepth = 3): string {
		const lines: string[] = ['## Table of Contents', ''];

		const addSection = (section: IDocumentSection, depth: number): void => {
			if (depth > maxDepth) {
				return;
			}

			const indent = '  '.repeat(depth - 1);
			const anchor = this.generateAnchor(section.title);
			lines.push(`${indent}- [${section.title}](#${anchor})`);

			if (section.subsections) {
				for (const subsection of section.subsections) {
					addSection(subsection, depth + 1);
				}
			}
		};

		for (const section of sections) {
			addSection(section, 1);
		}

		return lines.join('\n');
	}

	/**
	 * Generate an anchor-safe slug from text.
	 * @param text Text to convert
	 * @returns Anchor-safe slug
	 */
	generateAnchor(text: string): string {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, '')
			.replace(/\s+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '');
	}

	/**
	 * Generate a heading.
	 * @param text Heading text
	 * @param level Heading level (1-6)
	 * @returns Markdown heading string
	 */
	generateHeading(text: string, level: number): string {
		const safeLevel = Math.max(1, Math.min(6, level));
		return '#'.repeat(safeLevel) + ' ' + text;
	}

	/**
	 * Generate a blockquote.
	 * @param text Quote text
	 * @returns Markdown blockquote string
	 */
	generateBlockquote(text: string): string {
		return text.split('\n').map(line => '> ' + line).join('\n');
	}

	/**
	 * Generate a callout/admonition.
	 * @param type Callout type (note, tip, warning, caution, important)
	 * @param content Callout content
	 * @param title Optional custom title
	 * @returns Markdown callout string (GitHub-flavored)
	 */
	generateCallout(
		type: 'note' | 'tip' | 'warning' | 'caution' | 'important',
		content: string,
		title?: string
	): string {
		const typeMap = {
			note: 'NOTE',
			tip: 'TIP',
			warning: 'WARNING',
			caution: 'CAUTION',
			important: 'IMPORTANT'
		};

		const header = title ? `> [!${typeMap[type]}] ${title}` : `> [!${typeMap[type]}]`;
		const body = content.split('\n').map(line => '> ' + line).join('\n');

		return header + '\n' + body;
	}

	/**
	 * Generate a horizontal rule.
	 * @returns Markdown horizontal rule
	 */
	generateHorizontalRule(): string {
		return '---';
	}

	/**
	 * Escape markdown special characters.
	 * @param text Text to escape
	 * @returns Escaped text
	 */
	escapeMarkdown(text: string): string {
		return text.replace(/([\\`*_{}[\]()#+\-.!|])/g, '\\$1');
	}

	/**
	 * Generate inline code.
	 * @param code Code text
	 * @returns Markdown inline code
	 */
	generateInlineCode(code: string): string {
		// Handle backticks in code
		if (code.includes('`')) {
			return '`` ' + code + ' ``';
		}
		return '`' + code + '`';
	}

	/**
	 * Generate bold text.
	 * @param text Text to bold
	 * @returns Markdown bold text
	 */
	generateBold(text: string): string {
		return '**' + text + '**';
	}

	/**
	 * Generate italic text.
	 * @param text Text to italicize
	 * @returns Markdown italic text
	 */
	generateItalic(text: string): string {
		return '*' + text + '*';
	}

	/**
	 * Generate strikethrough text.
	 * @param text Text to strike through
	 * @returns Markdown strikethrough text
	 */
	generateStrikethrough(text: string): string {
		return '~~' + text + '~~';
	}

	/**
	 * Generate a task list.
	 * @param items Array of items with checked state
	 * @returns Markdown task list
	 */
	generateTaskList(items: Array<{ text: string; checked: boolean }>): string {
		return items.map(item => {
			const checkbox = item.checked ? '[x]' : '[ ]';
			return `- ${checkbox} ${item.text}`;
		}).join('\n');
	}

	/**
	 * Generate a definition list (using bold terms).
	 * @param definitions Array of term-definition pairs
	 * @returns Markdown definition list
	 */
	generateDefinitionList(definitions: Array<{ term: string; definition: string }>): string {
		return definitions.map(d => {
			return `**${d.term}**\n: ${d.definition}`;
		}).join('\n\n');
	}

	/**
	 * Generate a file tree representation.
	 * @param tree Tree structure
	 * @param prefix Current prefix for indentation
	 * @returns ASCII/Unicode file tree
	 */
	generateFileTree(
		tree: Array<{ name: string; type: 'file' | 'directory'; children?: Array<{ name: string; type: 'file' | 'directory'; children?: unknown[] }> }>,
		prefix = ''
	): string {
		const lines: string[] = [];

		for (let i = 0; i < tree.length; i++) {
			const item = tree[i];
			const isLast = i === tree.length - 1;
			const connector = isLast ? '└── ' : '├── ';
			const childPrefix = isLast ? '    ' : '│   ';

			const icon = item.type === 'directory' ? '📁 ' : '📄 ';
			lines.push(prefix + connector + icon + item.name);

			if (item.children && item.children.length > 0) {
				lines.push(this.generateFileTree(
					item.children as Array<{ name: string; type: 'file' | 'directory'; children?: Array<{ name: string; type: 'file' | 'directory'; children?: unknown[] }> }>,
					prefix + childPrefix
				));
			}
		}

		return lines.join('\n');
	}

	/**
	 * Generate a statistics summary.
	 * @param stats Object with stat names and values
	 * @returns Formatted statistics
	 */
	generateStatsSummary(stats: Record<string, number | string>): string {
		const items = Object.entries(stats).map(([key, value]) => {
			const formattedKey = key.replace(/([A-Z])/g, ' $1').trim();
			const formattedValue = typeof value === 'number' ? value.toLocaleString() : value;
			return `- **${formattedKey}**: ${formattedValue}`;
		});
		return items.join('\n');
	}

	/**
	 * Generate a progress bar (text-based).
	 * @param percentage Progress percentage (0-100)
	 * @param width Bar width in characters
	 * @returns Text progress bar
	 */
	generateProgressBar(percentage: number, width = 20): string {
		const filled = Math.round((percentage / 100) * width);
		const empty = width - filled;
		const bar = '█'.repeat(filled) + '░'.repeat(empty);
		return `${bar} ${percentage.toFixed(1)}%`;
	}

	/**
	 * Join multiple markdown blocks with proper spacing.
	 * @param blocks Markdown content blocks
	 * @returns Joined markdown with proper spacing
	 */
	joinBlocks(...blocks: string[]): string {
		return blocks.filter(b => b.trim()).join('\n\n');
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Default markdown generator instance.
 */
export const markdownGenerator = new MarkdownGenerator();
