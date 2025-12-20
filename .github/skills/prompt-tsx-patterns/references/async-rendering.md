# Async Rendering Patterns

Examples of async rendering in prompt-tsx components from this codebase.

## Basic Async Render

```typescript
class FileReadPrompt extends PromptElement<FileReadProps> {
  async render() {
    // Read file asynchronously
    const content = await this.readFile(this.props.filePath);

    return (
      <>
        <SystemMessage priority={1000}>
          File contents:<br />
        </SystemMessage>
        <TextChunk breakOnWhitespace priority={500}>
          {content}
        </TextChunk>
      </>
    );
  }

  private async readFile(path: string): Promise<string> {
    const fs = this.props.fileSystem;
    return await fs.readFile(path, 'utf-8');
  }
}
```

## Multiple Async Operations

```typescript
class MultiAsyncPrompt extends PromptElement<MultiAsyncProps> {
  async render() {
    // Parallel async operations
    const [fileContent, metadata, relatedFiles] = await Promise.all([
      this.readFile(this.props.filePath),
      this.getMetadata(this.props.filePath),
      this.findRelatedFiles(this.props.filePath)
    ]);

    return (
      <>
        <SystemMessage priority={1000}>
          File: {this.props.filePath}<br />
          Size: {metadata.size} bytes<br />
          Modified: {metadata.modified}<br />
          Related files: {relatedFiles.length}<br />
        </SystemMessage>

        <TextChunk breakOnWhitespace priority={500}>
          {fileContent}
        </TextChunk>

        {relatedFiles.length > 0 && (
          <Tag name="related-files">
            {relatedFiles.join('\n')}
          </Tag>
        )}
      </>
    );
  }
}
```

## Conditional Async Loading

```typescript
class ConditionalAsyncPrompt extends PromptElement<ConditionalAsyncProps> {
  async render() {
    // Only load if needed
    const needsHistory = this.props.includeHistory;
    const history = needsHistory
      ? await this.loadHistory(this.props.sessionId)
      : [];

    return (
      <>
        <SystemMessage priority={1000}>
          Session context<br />
        </SystemMessage>

        {history.length > 0 && (
          <History priority={700} messages={history} />
        )}

        <UserMessage priority={900}>
          {this.props.query}
        </UserMessage>
      </>
    );
  }

  private async loadHistory(sessionId: string): Promise<Message[]> {
    // Implementation
  }
}
```

## Error Handling in Async Render

```typescript
class SafeAsyncPrompt extends PromptElement<SafeAsyncProps> {
  async render() {
    let fileContent: string;

    try {
      fileContent = await this.readFile(this.props.filePath);
    } catch (error) {
      // Graceful degradation
      fileContent = `Error reading file: ${error.message}`;
    }

    return (
      <>
        <SystemMessage priority={1000}>
          Attempted to read: {this.props.filePath}<br />
        </SystemMessage>
        <TextChunk priority={500}>
          {fileContent}
        </TextChunk>
      </>
    );
  }
}
```

## Caching Async Results

```typescript
class CachedAsyncPrompt extends PromptElement<CachedAsyncProps> {
  private cache = new Map<string, string>();

  async render() {
    const cacheKey = this.props.filePath;

    // Check cache first
    if (!this.cache.has(cacheKey)) {
      const content = await this.readFile(this.props.filePath);
      this.cache.set(cacheKey, content);
    }

    const content = this.cache.get(cacheKey)!;

    return (
      <>
        <SystemMessage priority={1000}>
          File (cached): {this.props.filePath}<br />
        </SystemMessage>
        <TextChunk priority={500}>
          {content}
        </TextChunk>
      </>
    );
  }
}
```

## Async with PromptSizing

```typescript
class SizingAwareAsyncPrompt extends PromptElement<SizingAwareProps> {
  async render(sizing: PromptSizing): Promise<PromptPiece> {
    // Adjust content based on token budget
    const tokenBudget = sizing.tokenBudget;
    const estimatedFileSize = await this.estimateFileSize(this.props.filePath);

    let content: string;
    if (estimatedFileSize > tokenBudget) {
      // Load summary instead of full file
      content = await this.generateSummary(this.props.filePath);
    } else {
      content = await this.readFile(this.props.filePath);
    }

    return (
      <>
        <SystemMessage priority={1000}>
          File content (budget: {tokenBudget} tokens)<br />
        </SystemMessage>
        <TextChunk breakOnWhitespace priority={500}>
          {content}
        </TextChunk>
      </>
    );
  }
}
```

## Common Patterns

### 1. Always await before returning JSX

```typescript
// ❌ WRONG - Returns Promise, not content
async render() {
  const data = this.fetchData();
  return <>{data}</>;  // data is Promise!
}

// ✅ CORRECT - Await before using
async render() {
  const data = await this.fetchData();
  return <>{data}</>;
}
```

### 2. Use Promise.all for parallel operations

```typescript
// ❌ SLOW - Sequential
async render() {
  const file1 = await this.read(path1);
  const file2 = await this.read(path2);
  const file3 = await this.read(path3);
  // Total time: time1 + time2 + time3
}

// ✅ FAST - Parallel
async render() {
  const [file1, file2, file3] = await Promise.all([
    this.read(path1),
    this.read(path2),
    this.read(path3)
  ]);
  // Total time: max(time1, time2, time3)
}
```

### 3. Handle errors gracefully

```typescript
async render() {
  try {
    const data = await this.riskyOperation();
    return <>{data}</>;
  } catch (error) {
    // Provide fallback content
    return (
      <SystemMessage priority={1000}>
        Operation failed: {error.message}<br />
      </SystemMessage>
    );
  }
}
```
