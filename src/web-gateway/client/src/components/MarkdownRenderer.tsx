/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { memo, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Components } from 'react-markdown';

export interface MarkdownRendererProps {
	content: string;
	className?: string;
}

interface CodeBlockProps {
	language: string;
	code: string;
}

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			console.error('Failed to copy:', err);
		}
	}, [text]);

	return (
		<button
			onClick={handleCopy}
			className="absolute top-2 right-2 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
			title="Copy code"
		>
			{copied ? (
				<span className="flex items-center gap-1">
					<svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
					</svg>
					Copied
				</span>
			) : (
				<span className="flex items-center gap-1">
					<svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
					</svg>
					Copy
				</span>
			)}
		</button>
	);
}

function CodeBlock({ language, code }: CodeBlockProps) {
	return (
		<div className="relative group my-3">
			<div className="flex items-center justify-between bg-gray-800 px-3 py-1.5 rounded-t text-xs text-gray-400">
				<span>{language || 'code'}</span>
			</div>
			<div className="relative">
				<CopyButton text={code} />
				<SyntaxHighlighter
					style={oneDark}
					language={language || 'text'}
					PreTag="div"
					customStyle={{
						margin: 0,
						borderTopLeftRadius: 0,
						borderTopRightRadius: 0,
						fontSize: '0.875rem',
					}}
					codeTagProps={{
						style: {
							fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
						},
					}}
				>
					{code}
				</SyntaxHighlighter>
			</div>
		</div>
	);
}

const InlineCode = memo(function InlineCode({ children }: { children: React.ReactNode }) {
	return (
		<code className="px-1.5 py-0.5 bg-gray-100 text-gray-800 rounded text-sm font-mono">
			{children}
		</code>
	);
});

/**
 * Markdown renderer with syntax highlighting and GFM support.
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({
	content,
	className = '',
}: MarkdownRendererProps) {
	const components: Components = {
		code({ className: codeClassName, children }) {
			const match = /language-(\w+)/.exec(codeClassName || '');
			const isInline = !match && !codeClassName;

			if (isInline) {
				return <InlineCode>{children}</InlineCode>;
			}

			const code = String(children).replace(/\n$/, '');
			const language = match ? match[1] : '';

			return <CodeBlock language={language} code={code} />;
		},
		pre({ children }) {
			// Return children directly since code blocks handle their own wrapping
			return <>{children}</>;
		},
		a({ href, children }) {
			return (
				<a
					href={href}
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary-600 hover:text-primary-700 underline"
				>
					{children}
				</a>
			);
		},
		p({ children }) {
			return <p className="my-2 leading-relaxed">{children}</p>;
		},
		ul({ children }) {
			return <ul className="my-2 ml-4 list-disc space-y-1">{children}</ul>;
		},
		ol({ children }) {
			return <ol className="my-2 ml-4 list-decimal space-y-1">{children}</ol>;
		},
		li({ children }) {
			return <li className="leading-relaxed">{children}</li>;
		},
		h1({ children }) {
			return <h1 className="text-xl font-bold mt-4 mb-2">{children}</h1>;
		},
		h2({ children }) {
			return <h2 className="text-lg font-bold mt-3 mb-2">{children}</h2>;
		},
		h3({ children }) {
			return <h3 className="text-base font-bold mt-3 mb-1">{children}</h3>;
		},
		h4({ children }) {
			return <h4 className="text-sm font-bold mt-2 mb-1">{children}</h4>;
		},
		blockquote({ children }) {
			return (
				<blockquote className="border-l-4 border-gray-300 pl-4 my-2 text-gray-600 italic">
					{children}
				</blockquote>
			);
		},
		hr() {
			return <hr className="my-4 border-gray-200" />;
		},
		table({ children }) {
			return (
				<div className="my-3 overflow-x-auto">
					<table className="min-w-full divide-y divide-gray-200 border border-gray-200 rounded">
						{children}
					</table>
				</div>
			);
		},
		thead({ children }) {
			return <thead className="bg-gray-50">{children}</thead>;
		},
		th({ children }) {
			return (
				<th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
					{children}
				</th>
			);
		},
		td({ children }) {
			return (
				<td className="px-3 py-2 text-sm text-gray-900 border-t border-gray-200">
					{children}
				</td>
			);
		},
		strong({ children }) {
			return <strong className="font-semibold">{children}</strong>;
		},
		em({ children }) {
			return <em className="italic">{children}</em>;
		},
	};

	return (
		<div className={`prose prose-sm max-w-none ${className}`}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
				{content}
			</ReactMarkdown>
		</div>
	);
});
