# Chat Response Streaming Architecture

This document explains how the GitHub Copilot Chat extension processes, parses, and streams AI responses to create an interactive chat experience in VS Code. It covers the response stream system, tool calling, thinking/reasoning display, and file path linkification.

## Table of Contents

1. [Overview](#overview)
2. [The Response Stream System](#the-response-stream-system)
3. [Response Part Types](#response-part-types)
4. [Streaming Process Flow](#streaming-process-flow)
5. [Tool Calling Loop](#tool-calling-loop)
6. [Parsing Model Responses](#parsing-model-responses)
7. [Linkification System](#linkification-system)
8. [Implementation Guide](#implementation-guide)

---

## Overview

The chat response system works by:

1. **Receiving streaming chunks** from the LLM (Language Model)
2. **Parsing each chunk** to detect different content types (text, thinking, tool calls)
3. **Transforming content** (e.g., linkifying file paths)
4. **Pushing typed "parts"** to VS Code's chat UI via a response stream

The key insight is that the response stream accepts different **part types**, and VS Code's chat UI renders each type differently (bubbles, collapsible sections, clickable links, tool cards, etc.).

---

## The Response Stream System

### Core Concept

VS Code provides a `ChatResponseStream` interface that extensions use to send response content. Instead of sending raw text, you send **typed parts** that VS Code renders appropriately.

### ChatResponseStream Interface

```typescript
interface ChatResponseStream {
    // Send markdown text (rendered as chat bubbles)
    markdown(value: string | MarkdownString): void;

    // Create clickable file/symbol links
    anchor(value: Uri | Location, title?: string): void;

    // Show thinking/reasoning in collapsible sections
    thinkingProgress(thinkingDelta: ThinkingDelta): void;

    // Show progress messages
    progress(value: string): void;

    // Show a file reference
    reference(value: Uri | Location): void;

    // Signal that a tool is about to be invoked
    prepareToolInvocation(toolName: string): void;

    // Show a button the user can click
    button(command: Command): void;

    // Show a file tree
    filetree(value: ChatResponseFileTree[], baseUri: Uri): void;

    // Show a confirmation dialog
    confirmation(title: string, message: string, data: any): void;

    // Push any response part type
    push(part: ChatResponsePart): void;

    // Apply text edits to a file
    textEdit(target: Uri, edits: TextEdit | TextEdit[]): void;
}
```

### Implementation: ChatResponseStreamImpl

The extension wraps the VS Code stream to add functionality like filtering, mapping, and finalization:

```typescript
/**
 * A ChatResponseStream that forwards all calls to a single callback.
 * This allows interception, transformation, and routing of response parts.
 */
export class ChatResponseStreamImpl implements ChatResponseStream {

    constructor(
        private readonly _push: (part: ExtendedChatResponsePart) => void,
        private readonly _clearToPreviousToolInvocation: (reason: ClearReason) => void,
        private readonly _finalize?: () => void | Promise<void>,
    ) { }

    markdown(value: string | MarkdownString): void {
        this._push(new ChatResponseMarkdownPart(value));
    }

    anchor(value: Uri | Location, title?: string): void {
        this._push(new ChatResponseAnchorPart(value, title));
    }

    thinkingProgress(thinkingDelta: ThinkingDelta): void {
        this._push(new ChatResponseThinkingProgressPart(
            thinkingDelta.text ?? '',
            thinkingDelta.id,
            thinkingDelta.metadata
        ));
    }

    prepareToolInvocation(toolName: string): void {
        this._push(new ChatPrepareToolInvocationPart(toolName));
    }

    push(part: ExtendedChatResponsePart): void {
        this._push(part);
    }

    async finalize(): Promise<void> {
        await this._finalize?.();
    }

    // Factory method to create a filtering wrapper
    static filter(
        stream: ChatResponseStream,
        callback: (part: ExtendedChatResponsePart) => boolean
    ): ChatResponseStreamImpl {
        return new ChatResponseStreamImpl(
            (value) => {
                if (callback(value)) {
                    stream.push(value);
                }
            },
            (reason) => stream.clearToPreviousToolInvocation(reason)
        );
    }

    // Factory method to create a transforming wrapper
    static map(
        stream: ChatResponseStream,
        callback: (part: ExtendedChatResponsePart) => ExtendedChatResponsePart | undefined
    ): ChatResponseStreamImpl {
        return new ChatResponseStreamImpl(
            (value) => {
                const result = callback(value);
                if (result) {
                    stream.push(result);
                }
            },
            (reason) => stream.clearToPreviousToolInvocation(reason)
        );
    }
}
```

---

## Response Part Types

Each part type renders differently in VS Code's chat UI:

### 1. ChatResponseMarkdownPart
Regular text content rendered as chat "bubbles."

```typescript
class ChatResponseMarkdownPart {
    constructor(value: string | MarkdownString);
}

// Usage
stream.push(new ChatResponseMarkdownPart("Here's my response..."));
// Or shorthand:
stream.markdown("Here's my response...");
```

### 2. ChatResponseThinkingProgressPart
Thinking/reasoning content shown in collapsible sections.

```typescript
class ChatResponseThinkingProgressPart {
    value: string | string[];
    id?: string;
    metadata?: { readonly [key: string]: any };

    constructor(
        value: string | string[],
        id?: string,
        metadata?: { readonly [key: string]: any }
    );
}

// Usage - Start thinking
stream.thinkingProgress({ text: "Analyzing the codebase...", id: "think-1" });

// Usage - End thinking (signal completion)
stream.thinkingProgress({
    text: "",
    id: "think-1",
    metadata: { vscodeReasoningDone: true }
});
```

### 3. ChatResponseAnchorPart
Clickable links to files, symbols, or locations.

```typescript
class ChatResponseAnchorPart {
    constructor(
        value: Uri | Location | SymbolInformation,
        title?: string
    );
}

// Usage
stream.anchor(Uri.file('/path/to/file.ts'), 'file.ts');
stream.anchor(new Location(uri, new Range(10, 0, 20, 0)), 'MyClass');
```

### 4. ChatPrepareToolInvocationPart
Signals that a tool is about to be called (shows pending tool card).

```typescript
class ChatPrepareToolInvocationPart {
    toolName: string;
    constructor(toolName: string);
}

// Usage
stream.prepareToolInvocation('read_file');
```

### 5. ChatToolInvocationPart
Shows a tool invocation with its status.

```typescript
class ChatToolInvocationPart {
    toolName: string;
    toolCallId: string;
    isError?: boolean;
    invocationMessage?: string | MarkdownString;
    pastTenseMessage?: string | MarkdownString;
    isConfirmed?: boolean;
    isComplete?: boolean;

    constructor(toolName: string, toolCallId: string, isError?: boolean);
}
```

### 6. ChatResponseProgressPart
Shows a progress spinner with a message.

```typescript
class ChatResponseProgressPart {
    value: string;
    constructor(value: string);
}

// Usage
stream.progress("Searching codebase...");
```

### 7. ChatResponseReferencePart
Shows a reference to a file or variable.

```typescript
class ChatResponseReferencePart {
    value: Uri | Location | { variableName: string; value?: Uri | Location };
    iconPath?: Uri | ThemeIcon;

    constructor(value: ..., iconPath?: ...);
}

// Usage
stream.reference(Uri.file('/path/to/file.ts'));
```

### 8. ChatResponseTextEditPart
Applies code edits to a file.

```typescript
class ChatResponseTextEditPart {
    uri: Uri;
    edits: TextEdit[];

    constructor(uri: Uri, edits: TextEdit | TextEdit[]);
}

// Usage
stream.textEdit(uri, new TextEdit(range, 'new code'));
```

---

## Streaming Process Flow

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User sends message                           │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    ChatParticipantRequestHandler                     │
│  - Sanitizes input                                                   │
│  - Selects intent                                                    │
│  - Creates conversation context                                      │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    DefaultIntentRequestHandler                       │
│  - Builds the prompt                                                 │
│  - Initializes tool calling loop                                     │
│  - Sets up stream processors                                         │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        ToolCallingLoop                               │
│  - Sends request to LLM                                              │
│  - Processes streaming response                                      │
│  - Handles tool calls                                                │
│  - Iterates until complete                                           │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Response Processors Chain                         │
│                                                                      │
│  ┌───────────────────┐    ┌───────────────────┐    ┌──────────────┐ │
│  │ PseudoStopStart   │ -> │ Linkification     │ -> │ CodeBlock    │ │
│  │ ResponseProcessor │    │ Stream            │    │ Processor    │ │
│  └───────────────────┘    └───────────────────┘    └──────────────┘ │
│                                                                      │
│  - Separates thinking from text                                      │
│  - Converts file paths to links                                      │
│  - Processes code blocks                                             │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        VS Code Chat UI                               │
│  - Renders markdown as bubbles                                       │
│  - Shows thinking in collapsible sections                            │
│  - Displays tool cards                                               │
│  - Creates clickable file links                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Streaming Response Processing

The LLM response comes as a stream of deltas. Each delta may contain:

```typescript
interface IResponseDelta {
    // Regular text content
    text?: string;

    // Thinking/reasoning content
    thinking?: {
        text?: string;
        id?: string;
        metadata?: Record<string, any>;
    };

    // Tool calls the model wants to make
    beginToolCalls?: Array<{
        name: string;
        id: string;
        arguments: string;
    }>;

    // Code citations
    ipCitations?: Array<{
        citations: { url: string; license: string; snippet: string };
    }>;

    // Code vulnerabilities
    codeVulnAnnotations?: Array<{
        details: { type: string; description: string };
    }>;

    // Retry signal (e.g., content filtered)
    retryReason?: string;
}
```

### Response Delta Processing

The `PseudoStopStartResponseProcessor` processes each delta:

```typescript
class PseudoStopStartResponseProcessor implements IResponseProcessor {
    private thinkingActive: boolean = false;

    async processResponse(
        context: IResponseProcessorContext,
        inputStream: AsyncIterable<IResponsePart>,
        outputStream: ChatResponseStream,
        token: CancellationToken
    ): Promise<void> {
        for await (const { delta } of inputStream) {
            if (token.isCancellationRequested) {
                return;
            }
            this.applyDelta(delta, outputStream);
        }
    }

    protected applyDeltaToProgress(delta: IResponseDelta, progress: ChatResponseStream) {
        // Handle thinking content
        if (delta.thinking) {
            // Don't send parts that are only encrypted content
            if (!isEncryptedThinkingDelta(delta.thinking) || delta.thinking.text) {
                progress.thinkingProgress(delta.thinking);
                this.thinkingActive = true;
            }
        } else if (this.thinkingActive) {
            // End thinking when we get non-thinking content
            progress.thinkingProgress({
                id: '',
                text: '',
                metadata: { vscodeReasoningDone: true, stopReason: delta.text ? 'text' : 'other' }
            });
            this.thinkingActive = false;
        }

        // Handle code citations
        this.reportCitations(delta, progress);

        // Handle vulnerabilities
        const vulnerabilities = delta.codeVulnAnnotations?.map(a => ({
            title: a.details.type,
            description: a.details.description
        }));

        if (vulnerabilities?.length) {
            progress.markdownWithVulnerabilities(delta.text ?? '', vulnerabilities);
        } else if (delta.text) {
            // Regular text content
            progress.markdown(delta.text);
        }

        // Handle tool calls
        if (delta.beginToolCalls?.length) {
            progress.prepareToolInvocation(
                getContributedToolName(delta.beginToolCalls[0].name)
            );
        }
    }

    private reportCitations(delta: IResponseDelta, progress: ChatResponseStream): void {
        const citations = delta.ipCitations;
        if (citations?.length) {
            citations.forEach(c => {
                const licenseLabel = c.citations.license === 'NOASSERTION'
                    ? 'unknown'
                    : c.citations.license;
                progress.codeCitation(
                    Uri.parse(c.citations.url),
                    licenseLabel,
                    c.citations.snippet
                );
            });
        }
    }
}
```

---

## Tool Calling Loop

The tool calling loop enables the agent to use tools iteratively until it has enough information to answer.

### Loop Structure

```typescript
abstract class ToolCallingLoop<TOptions extends IToolCallingLoopOptions> {
    private toolCallResults: Record<string, LanguageModelToolResult> = {};
    private toolCallRounds: IToolCallRound[] = [];

    /**
     * Main entry point - runs the tool calling loop until complete
     */
    async run(
        outputStream: ChatResponseStream | undefined,
        token: CancellationToken
    ): Promise<IToolCallLoopResult> {
        let iteration = 0;
        let lastResult: IToolCallSingleResult | undefined;

        while (true) {
            // Check if we've hit the tool call limit
            if (lastResult && iteration++ >= this.options.toolCallLimit) {
                lastResult = this.hitToolCallLimit(outputStream, lastResult);
                break;
            }

            try {
                // Run one iteration
                const result = await this.runOne(outputStream, iteration, token);
                lastResult = result;

                // Store the round
                this.toolCallRounds.push(result.round);

                // If no tool calls or not successful, we're done
                if (!result.round.toolCalls.length ||
                    result.response.type !== ChatFetchResponseType.Success) {
                    break;
                }
            } catch (e) {
                if (isCancellationError(e) && lastResult) {
                    break;
                }
                throw e;
            }
        }

        return {
            ...lastResult,
            toolCallRounds: this.toolCallRounds,
            toolCallResults: this.toolCallResults
        };
    }

    /**
     * Runs a single iteration of the loop
     */
    async runOne(
        outputStream: ChatResponseStream | undefined,
        iterationNumber: number,
        token: CancellationToken
    ): Promise<IToolCallSingleResult> {
        // 1. Get available tools
        const availableTools = await this.getAvailableTools(outputStream, token);

        // 2. Create prompt context
        const context = this.createPromptContext(availableTools, outputStream);

        // 3. Build the prompt (including any previous tool results)
        const buildPromptResult = await this.buildPrompt(context, outputStream, token);

        // 4. Set up response processing
        const toolCalls: IToolCall[] = [];
        let thinkingItem: ThinkingDataItem | undefined;

        // 5. Send request to LLM with streaming callback
        const fetchResult = await this.fetch({
            messages: buildPromptResult.messages,
            finishedCb: async (text, index, delta) => {
                // Capture tool calls from the response
                if (delta.copilotToolCalls) {
                    toolCalls.push(...delta.copilotToolCalls.map((call) => ({
                        ...call,
                        id: this.createInternalToolCallId(call.id),
                        arguments: call.arguments === '' ? '{}' : call.arguments
                    })));
                }

                // Capture thinking content
                if (delta.thinking) {
                    thinkingItem = ThinkingDataItem.createOrUpdate(
                        thinkingItem,
                        delta.thinking
                    );
                }
            },
            requestOptions: {
                tools: availableTools.map(tool => ({
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.inputSchema
                    },
                    type: 'function',
                })),
            },
        }, token);

        // 6. Return the result
        return {
            response: fetchResult,
            round: ToolCallRound.create({
                response: fetchResult.value,
                toolCalls,
                thinking: thinkingItem
            }),
            lastRequestMessages: buildPromptResult.messages,
            availableTools,
        };
    }

    /**
     * Creates the context for building prompts
     */
    protected createPromptContext(
        availableTools: LanguageModelToolInformation[],
        outputStream: ChatResponseStream | undefined
    ): IBuildPromptContext {
        const { request } = this.options;

        return {
            requestId: this.turn.id,
            query: this.turn.request.message,
            history: this.options.conversation.turns.slice(0, -1),
            toolCallResults: this.toolCallResults,  // Previous tool results
            toolCallRounds: this.toolCallRounds,    // Previous rounds
            request: this.options.request,
            stream: outputStream,
            conversation: this.options.conversation,
            tools: {
                toolReferences: request.toolReferences,
                toolInvocationToken: request.toolInvocationToken,
                availableTools
            },
        };
    }

    // Abstract methods that subclasses must implement
    protected abstract buildPrompt(
        context: IBuildPromptContext,
        progress: Progress<ChatResponseReferencePart | ChatResponseProgressPart>,
        token: CancellationToken
    ): Promise<IBuildPromptResult>;

    protected abstract getAvailableTools(
        outputStream: ChatResponseStream | undefined,
        token: CancellationToken
    ): Promise<LanguageModelToolInformation[]>;

    protected abstract fetch(
        options: ToolCallingLoopFetchOptions,
        token: CancellationToken
    ): Promise<ChatResponse>;
}
```

### Tool Result Handling

When tools are called, their results are captured and included in subsequent prompts:

```typescript
// In the prompt building phase, tool results are rendered
class ToolResultElement extends PromptElement {
    async render(state: void, sizing: PromptSizing) {
        const { toolResult, isCancelled } = await this.props.call(sizing);

        return (
            <ToolMessage toolCallId={this.props.toolCall.id}>
                <meta value={new ToolResultMetadata(
                    this.props.toolCall.id,
                    toolResult,
                    isCancelled
                )} />
                <ToolResult content={toolResult.content} />
            </ToolMessage>
        );
    }
}
```

---

## Parsing Model Responses

### FetchStreamSource

The LLM response is received as a stream. `FetchStreamSource` handles buffering and distribution:

```typescript
class FetchStreamSource {
    private buffer: IResponsePart[] = [];
    private resolvers: Array<(value: IteratorResult<IResponsePart>) => void> = [];

    /**
     * Called when new content arrives from the LLM
     */
    update(fullText: string, delta: IResponseDelta): void {
        const part: IResponsePart = { delta, text: fullText };

        // If someone is waiting for data, give it to them
        if (this.resolvers.length > 0) {
            const resolver = this.resolvers.shift()!;
            resolver({ value: part, done: false });
        } else {
            // Otherwise buffer it
            this.buffer.push(part);
        }
    }

    /**
     * Signal that the stream is complete
     */
    resolve(): void {
        for (const resolver of this.resolvers) {
            resolver({ value: undefined, done: true });
        }
        this.resolvers = [];
    }

    /**
     * Async iterator for consuming the stream
     */
    get stream(): AsyncIterable<IResponsePart> {
        return {
            [Symbol.asyncIterator]: () => ({
                next: (): Promise<IteratorResult<IResponsePart>> => {
                    // If we have buffered data, return it immediately
                    if (this.buffer.length > 0) {
                        return Promise.resolve({
                            value: this.buffer.shift()!,
                            done: false
                        });
                    }

                    // Otherwise wait for new data
                    return new Promise((resolve) => {
                        this.resolvers.push(resolve);
                    });
                }
            })
        };
    }
}
```

### Response Processing Pipeline

The response flows through multiple processors:

```typescript
// Set up the processing pipeline
const fetchStreamSource = new FetchStreamSource();

// Process response connects input stream to output stream via processors
const processResponsePromise = responseProcessor.processResponse(
    context,
    fetchStreamSource.stream,  // Input from LLM
    outputStream,              // Output to VS Code
    token
);

// Fetch from LLM, feeding into fetchStreamSource
const fetchResult = await this.fetch({
    messages: buildPromptResult.messages,
    finishedCb: async (text, index, delta) => {
        // Feed each delta into the stream source
        fetchStreamSource.update(text, delta);

        // Also extract tool calls, etc.
        if (delta.copilotToolCalls) {
            toolCalls.push(...delta.copilotToolCalls);
        }
    },
    // ...
}, token);

// Signal completion
fetchStreamSource.resolve();

// Wait for processing to finish
await processResponsePromise;
```

---

## Linkification System

The linkification system automatically converts file paths in text to clickable links.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ResponseStreamWithLinkification                   │
│                                                                      │
│  Wraps the output stream and intercepts markdown content             │
│                                                                      │
│  ┌─────────────────────┐                                             │
│  │   markdown("text")  │                                             │
│  └──────────┬──────────┘                                             │
│             │                                                        │
│             ▼                                                        │
│  ┌─────────────────────┐                                             │
│  │     Linkifier       │  Accumulates text, detects paths            │
│  └──────────┬──────────┘                                             │
│             │                                                        │
│             ▼                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    Contributed Linkifiers                        │ │
│  │  ┌───────────────────┐  ┌───────────────────────────────────┐   │ │
│  │  │ FilePathLinkifier │  │ (Other custom linkifiers)         │   │ │
│  │  └───────────────────┘  └───────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│             │                                                        │
│             ▼                                                        │
│  ┌─────────────────────┐                                             │
│  │   Output Parts      │  Strings become markdown, paths become      │
│  │                     │  anchor parts                               │
│  └─────────────────────┘                                             │
└─────────────────────────────────────────────────────────────────────┘
```

### LinkifyService

```typescript
interface ILinkifier {
    /**
     * Number of links that have been added
     */
    readonly totalAddedLinkCount: number;

    /**
     * Add new text to the linkifier.
     * Returns linkified text (may include previously buffered content).
     */
    append(newText: string, token: CancellationToken): Promise<LinkifiedText>;

    /**
     * Complete linkification. Returns any remaining buffered text.
     */
    flush(token: CancellationToken): Promise<LinkifiedText | undefined>;
}

interface IContributedLinkifier {
    linkify(
        text: string,
        context: LinkifierContext,
        token: CancellationToken
    ): Promise<LinkifiedText | undefined>;
}

class LinkifyService implements ILinkifyService {
    private readonly globalLinkifiers = new Set<IContributedLinkifierFactory>();

    constructor(
        fileSystem: IFileSystemService,
        workspaceService: IWorkspaceService,
        private readonly envService: IEnvService,
    ) {
        // Register the default file path linkifier
        this.registerGlobalLinkifier({
            create: () => new FilePathLinkifier(fileSystem, workspaceService)
        });
    }

    registerGlobalLinkifier(linkifier: IContributedLinkifierFactory): IDisposable {
        this.globalLinkifiers.add(linkifier);
        return {
            dispose: () => this.globalLinkifiers.delete(linkifier)
        };
    }

    createLinkifier(
        context: LinkifierContext,
        additionalLinkifiers?: readonly IContributedLinkifierFactory[],
    ): ILinkifier {
        const allLinkifiers = [
            ...(additionalLinkifiers || []),
            ...this.globalLinkifiers
        ].map(x => x.create());

        return new Linkifier(context, this.envService.uriScheme, allLinkifiers);
    }
}
```

### FilePathLinkifier

Detects and converts file paths to clickable links:

```typescript
// Regex to match different path formats
const pathMatchRe = new RegExp(
    [
        // [path/to/file.md](path/to/file.md) or [`path/to/file.md`](path/to/file.md)
        /\[(`?)(?<mdLinkText>[^`\]\)\n]+)\1\]\((?<mdLinkPath>[^`\s]+)\)/.source,

        // Inline code paths: `file.md`
        /(?<!\[)`(?<inlineCodePath>[^`\s]+)`(?!\])/.source,

        // Plain text paths: file.md
        /(?<![\[`()<])(?<plainTextPath>[^\s`*]+\.[^\s`*]+)(?![\]`])/.source
    ].join('|'),
    'gu'
);

class FilePathLinkifier implements IContributedLinkifier {
    constructor(
        private readonly fileSystem: IFileSystemService,
        private readonly workspaceService: IWorkspaceService,
    ) { }

    async linkify(
        text: string,
        context: LinkifierContext,
        token: CancellationToken
    ): Promise<LinkifiedText> {
        const parts: Array<Promise<LinkifiedPart> | LinkifiedPart> = [];
        let endLastMatch = 0;

        for (const match of text.matchAll(pathMatchRe)) {
            // Add text before the match
            const prefix = text.slice(endLastMatch, match.index);
            if (prefix) {
                parts.push(prefix);
            }

            const matched = match[0];

            // Extract the path from whichever capture group matched
            let pathText = match.groups?.['mdLinkPath']
                ?? match.groups?.['inlineCodePath']
                ?? match.groups?.['plainTextPath']
                ?? '';

            // Try to resolve the path to a URI
            parts.push(
                this.resolvePathText(pathText, context)
                    .then(uri => uri ? new LinkifyLocationAnchor(uri) : matched)
            );

            endLastMatch = match.index + matched.length;
        }

        // Add remaining text
        const suffix = text.slice(endLastMatch);
        if (suffix) {
            parts.push(suffix);
        }

        return { parts: coalesceParts(await Promise.all(parts)) };
    }

    private async resolvePathText(
        pathText: string,
        context: LinkifierContext
    ): Promise<Uri | undefined> {
        const workspaceFolders = this.workspaceService.getWorkspaceFolders();

        // Skip very short or special paths
        if (pathText.length < 2 ||
            ['../', '..\\', '/.', './', '\\.', '..'].includes(pathText)) {
            return;
        }

        // Handle absolute paths
        if (pathText.startsWith('/') || hasDriveLetter(pathText)) {
            try {
                const uri = await this.statAndNormalizeUri(Uri.file(pathText));
                if (uri) return uri;
            } catch { }
        }

        // Handle URI-like paths
        const scheme = pathText.match(/^([a-z]+):/i)?.[1];
        if (scheme) {
            try {
                const uri = Uri.parse(pathText);
                const statedUri = await this.statAndNormalizeUri(uri);
                if (statedUri) return statedUri;
            } catch { }
            return;
        }

        // Try relative to workspace folders
        for (const workspaceFolder of workspaceFolders) {
            const uri = await this.statAndNormalizeUri(
                Uri.joinPath(workspaceFolder, pathText)
            );
            if (uri) return uri;
        }

        // Fall back to checking references by filename
        const name = path.basename(pathText);
        return context.references
            .map(ref => /* extract URI from reference */)
            .find(refUri => basename(refUri) === name);
    }

    private async statAndNormalizeUri(uri: Uri): Promise<Uri | undefined> {
        try {
            const stat = await this.fileSystem.stat(uri);
            if (stat.type === FileType.Directory) {
                // Ensure directories have trailing slash for icon rendering
                return uri.path.endsWith('/')
                    ? uri
                    : uri.with({ path: `${uri.path}/` });
            }
            return uri;
        } catch {
            return undefined;
        }
    }
}
```

### ResponseStreamWithLinkification

Wraps the response stream to automatically linkify markdown content:

```typescript
class ResponseStreamWithLinkification implements ChatResponseStream {
    private readonly _linkifier: ILinkifier;
    private readonly _progress: ChatResponseStream;
    private sequencer: Promise<unknown> = Promise.resolve();

    constructor(
        context: LinkifierContext,
        progress: ChatResponseStream,
        additionalLinkifiers: readonly IContributedLinkifierFactory[],
        token: CancellationToken,
        linkifyService: ILinkifyService,
        workspaceService: IWorkspaceService,
    ) {
        this._linkifier = linkifyService.createLinkifier(context, additionalLinkifiers);
        this._progress = progress;
    }

    /**
     * Intercept markdown calls to linkify content
     */
    markdown(value: string | MarkdownString): ChatResponseStream {
        this.appendMarkdown(
            typeof value === 'string' ? new MarkdownString(value) : value
        );
        return this;
    }

    private async appendMarkdown(md: MarkdownString): Promise<void> {
        if (!md.value) return;

        // Queue the operation to maintain order
        this.enqueue(async () => {
            const output = await this._linkifier.append(md.value, this._token);
            if (this._token.isCancellationRequested) return;
            this.outputMarkdown(output);
        }, false);
    }

    /**
     * Convert linkified text to response parts
     */
    private outputMarkdown(textToApply: LinkifiedText) {
        for (const part of textToApply.parts) {
            if (typeof part === 'string') {
                if (!part.length) continue;

                const content = new MarkdownString(part);

                // Set base URI for relative paths
                const folder = this.workspaceService.getWorkspaceFolders()?.at(0);
                if (folder) {
                    content.baseUri = folder.path.endsWith('/')
                        ? folder
                        : folder.with({ path: folder.path + '/' });
                }

                this._progress.markdown(content);
            } else if (part instanceof LinkifySymbolAnchor) {
                // Symbol links
                const chatPart = new ChatResponseAnchorPart(part.symbolInformation);
                this._progress.push(chatPart);
            } else {
                // File/location links
                this._progress.anchor(part.value, part.title);
            }
        }
    }

    async finalize() {
        await this.enqueue(() => this.doFinalize(), false);
    }

    private async doFinalize() {
        const textToApply = await this._linkifier.flush(this._token);
        if (this._token.isCancellationRequested) return;
        if (textToApply) {
            this.outputMarkdown(textToApply);
        }
    }

    /**
     * Ensure operations happen in order
     */
    private enqueue<T>(f: () => T | Thenable<T>, flush: boolean) {
        if (flush) {
            this.sequencer = this.sequencer.then(() => this.doFinalize());
        }
        this.sequencer = this.sequencer.then(f);
        return this.sequencer as Promise<T>;
    }

    // Forward other methods directly
    anchor(value: Uri | Location, title?: string): ChatResponseStream {
        this.enqueue(() => this._progress.anchor(value, title), false);
        return this;
    }

    thinkingProgress(thinkingDelta: ThinkingDelta): ChatResponseStream {
        this.enqueue(() => this._progress.thinkingProgress(thinkingDelta), false);
        return this;
    }

    // ... other forwarded methods
}
```

### LinkifiedText Types

```typescript
/**
 * A clickable link to a file or location
 */
class LinkifyLocationAnchor {
    constructor(
        public readonly value: Uri | Location,
        public readonly title?: string
    ) { }
}

/**
 * A clickable link to a symbol
 */
class LinkifySymbolAnchor {
    constructor(
        public readonly symbolInformation: SymbolInformation,
        public readonly resolve?: (token: CancellationToken) => Promise<SymbolInformation>,
    ) { }
}

type LinkifiedPart = string | LinkifyLocationAnchor | LinkifySymbolAnchor;

interface LinkifiedText {
    readonly parts: readonly LinkifiedPart[];
}

/**
 * Coalesces adjacent string parts into a single string
 */
function coalesceParts(parts: readonly LinkifiedPart[]): LinkifiedPart[] {
    const out: LinkifiedPart[] = [];

    for (const part of parts) {
        const previous = out.at(-1);
        if (typeof part === 'string' && typeof previous === 'string') {
            out[out.length - 1] = previous + part;
        } else {
            out.push(part);
        }
    }

    return out;
}
```

---

## Implementation Guide

### Step 1: Set Up Response Stream Handling

Create a wrapper around the VS Code chat response stream:

```typescript
// 1. Create response stream wrapper
class MyResponseStream implements ChatResponseStream {
    constructor(private readonly baseStream: ChatResponseStream) {}

    markdown(value: string | MarkdownString): void {
        // Transform content before sending
        const transformed = this.transformMarkdown(value);
        this.baseStream.markdown(transformed);
    }

    // Implement other methods...
}
```

### Step 2: Implement Response Processing Pipeline

```typescript
// 2. Create a response processor
interface IResponseProcessor {
    processResponse(
        inputStream: AsyncIterable<IResponseDelta>,
        outputStream: ChatResponseStream,
        token: CancellationToken
    ): Promise<void>;
}

class MyResponseProcessor implements IResponseProcessor {
    async processResponse(
        inputStream: AsyncIterable<IResponseDelta>,
        outputStream: ChatResponseStream,
        token: CancellationToken
    ): Promise<void> {
        let thinkingActive = false;

        for await (const delta of inputStream) {
            if (token.isCancellationRequested) return;

            // Handle thinking
            if (delta.thinking) {
                outputStream.thinkingProgress(delta.thinking);
                thinkingActive = true;
            } else if (thinkingActive) {
                outputStream.thinkingProgress({
                    text: '',
                    metadata: { vscodeReasoningDone: true }
                });
                thinkingActive = false;
            }

            // Handle text
            if (delta.text) {
                outputStream.markdown(delta.text);
            }

            // Handle tool calls
            if (delta.beginToolCalls?.length) {
                outputStream.prepareToolInvocation(delta.beginToolCalls[0].name);
            }
        }
    }
}
```

### Step 3: Implement Tool Calling Loop

```typescript
// 3. Create a tool calling loop
class MyToolCallingLoop {
    async run(
        outputStream: ChatResponseStream,
        token: CancellationToken
    ): Promise<void> {
        const toolResults: Record<string, any> = {};

        while (true) {
            // Build prompt with tool results
            const messages = this.buildPrompt(toolResults);

            // Send to LLM
            const toolCalls: IToolCall[] = [];
            const response = await this.sendToLLM(messages, (delta) => {
                if (delta.toolCalls) {
                    toolCalls.push(...delta.toolCalls);
                }
            });

            // If no tool calls, we're done
            if (toolCalls.length === 0) {
                break;
            }

            // Execute tool calls
            for (const call of toolCalls) {
                outputStream.prepareToolInvocation(call.name);
                const result = await this.executeTool(call);
                toolResults[call.id] = result;
            }
        }
    }
}
```

### Step 4: Implement Linkification

```typescript
// 4. Create a linkifier
const FILE_PATH_REGEX = /`([^`\s]+\.[a-z]+)`/g;

class SimpleLinkifier {
    async linkify(text: string, workspaceFolders: Uri[]): Promise<LinkifiedText> {
        const parts: LinkifiedPart[] = [];
        let lastIndex = 0;

        for (const match of text.matchAll(FILE_PATH_REGEX)) {
            // Add text before match
            if (match.index! > lastIndex) {
                parts.push(text.slice(lastIndex, match.index));
            }

            const filePath = match[1];
            const resolved = await this.resolveFile(filePath, workspaceFolders);

            if (resolved) {
                parts.push(new LinkifyLocationAnchor(resolved, filePath));
            } else {
                parts.push(match[0]);
            }

            lastIndex = match.index! + match[0].length;
        }

        // Add remaining text
        if (lastIndex < text.length) {
            parts.push(text.slice(lastIndex));
        }

        return { parts };
    }

    private async resolveFile(
        filePath: string,
        workspaceFolders: Uri[]
    ): Promise<Uri | undefined> {
        for (const folder of workspaceFolders) {
            const uri = Uri.joinPath(folder, filePath);
            try {
                await workspace.fs.stat(uri);
                return uri;
            } catch { }
        }
        return undefined;
    }
}
```

### Step 5: Wire Everything Together

```typescript
// 5. Main request handler
async function handleChatRequest(
    request: ChatRequest,
    stream: ChatResponseStream,
    token: CancellationToken
): Promise<ChatResult> {
    // Create linkifying stream wrapper
    const linkifier = new SimpleLinkifier();
    const linkifyingStream = new LinkifyingStream(stream, linkifier);

    // Create response processor
    const processor = new MyResponseProcessor();

    // Create tool calling loop
    const loop = new MyToolCallingLoop(request, processor);

    // Run the loop
    await loop.run(linkifyingStream, token);

    // Finalize the stream
    await linkifyingStream.finalize();

    return { metadata: { success: true } };
}

// Register the chat participant
const participant = vscode.chat.createChatParticipant('my-agent', handleChatRequest);
```

---

## Summary

The chat response streaming architecture consists of:

1. **Response Stream** - Typed interface for sending different content types to VS Code
2. **Response Parts** - Different classes for markdown, thinking, anchors, tool invocations, etc.
3. **Streaming Pipeline** - Async processing of LLM response deltas
4. **Tool Calling Loop** - Iterative execution of tools until the model has enough information
5. **Linkification** - Automatic conversion of file paths to clickable links

Key principles:
- **Type-driven UI**: Different part types render differently in VS Code
- **Streaming**: Process and display content as it arrives, don't wait for completion
- **Composable**: Processors can be chained and wrapped
- **Extensible**: Custom linkifiers and processors can be added

This architecture enables the natural, interactive feel of the chat experience where you see thinking in collapsible sections, tool calls as cards, file paths as clickable links, and regular text as chat bubbles.
