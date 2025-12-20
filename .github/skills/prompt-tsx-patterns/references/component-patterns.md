# Real Component Patterns from vscode-copilot-chat

This document shows actual patterns used in this codebase's prompt components.

## Pattern 1: Simple System + User Message

From early prompts in the codebase:

```typescript
class BasicPrompt extends PromptElement<BasicPromptProps> {
  render() {
    return (
      <>
        <SystemMessage priority={1000}>
          You are GitHub Copilot, an AI coding assistant.<br />
          Follow the user's instructions carefully.<br />
        </SystemMessage>

        <UserMessage priority={900}>
          {this.props.userQuery}
        </UserMessage>
      </>
    );
  }
}
```

**Pattern**: Two-tier priority (system at 1000, user at 900)

## Pattern 2: History Integration

```typescript
class PromptWithHistory extends PromptElement<HistoryPromptProps> {
  render() {
    return (
      <>
        <SystemMessage priority={1000}>
          {this.props.systemInstructions}<br />
        </SystemMessage>

        {/* History fills available space */}
        <History
          priority={700}
          flexGrow={1}
          flexReserve="/5"
          older={0}    // Include all older messages
          newer={80}   // Recent messages get priority 80
        />

        {/* Current query always included */}
        <UserMessage priority={900}>
          {this.props.currentQuery}
        </UserMessage>
      </>
    );
  }
}
```

**Pattern**: History with flexGrow fills space between system and user messages

## Pattern 3: File Context

```typescript
class FileContextPrompt extends PromptElement<FileContextProps> {
  render() {
    return (
      <>
        <SystemMessage priority={1000}>
          The user has attached files for context.<br />
        </SystemMessage>

        <FileContext
          priority={600}
          flexGrow={2}
          files={this.props.files}
        />

        <UserMessage priority={900}>
          {this.props.query}
        </UserMessage>
      </>
    );
  }
}
```

**Pattern**: File context at priority 600, below history (700) but above background info

## Pattern 4: Tool Results

```typescript
class ToolResultPrompt extends PromptElement<ToolResultProps> {
  render() {
    return (
      <>
        <SystemMessage priority={1000}>
          Tool results:<br />
        </SystemMessage>

        {this.props.toolResults.map((result, index) => {
          const KeepWith = useKeepWith();
          return (
            <>
              <KeepWith priority={860}>
                <ToolCallRequest call={result.call} />
              </KeepWith>
              <KeepWith priority={850}>
                <ToolCallResponse result={result.response} />
              </KeepWith>
            </>
          );
        })}

        <UserMessage priority={900}>
          {this.props.followUpQuery}
        </UserMessage>
      </>
    );
  }
}
```

**Pattern**: Tool results use KeepWith to stay together, priority between history and user message

## Pattern 5: Large Documentation

```typescript
class DocumentationPrompt extends PromptElement<DocsProps> {
  render() {
    return (
      <>
        <SystemMessage priority={1000}>
          Reference documentation:<br />
        </SystemMessage>

        {/* Large content with intelligent truncation */}
        <TextChunk
          breakOn="\n\n"  // Break on paragraph boundaries
          priority={100}   // Low priority - prune first
        >
          {this.props.documentation}
        </TextChunk>

        <UserMessage priority={900}>
          {this.props.query}
        </UserMessage>
      </>
    );
  }
}
```

**Pattern**: TextChunk with low priority for optional background info

## Pattern 6: Structured Content with Tags

```typescript
class StructuredPrompt extends PromptElement<StructuredProps> {
  render() {
    return (
      <>
        <SystemMessage priority={1000}>
          Analyzing codebase structure<br />
        </SystemMessage>

        <Tag name="codebase" attrs={{ language: this.props.language }}>
          <Tag name="files" attrs={{ count: this.props.files.length }}>
            {this.props.files.map(f => f.path).join('\n')}
          </Tag>
          <Tag name="dependencies">
            {JSON.stringify(this.props.dependencies)}
          </Tag>
        </Tag>

        <UserMessage priority={900}>
          {this.props.query}
        </UserMessage>
      </>
    );
  }
}
```

**Pattern**: Nested Tags for hierarchical structured data

## Pattern 7: Conditional Content

```typescript
class ConditionalPrompt extends PromptElement<ConditionalProps> {
  render() {
    return (
      <>
        <SystemMessage priority={1000}>
          {this.props.agentInstructions}<br />
        </SystemMessage>

        {/* Include history only if available */}
        {this.props.history.length > 0 && (
          <History
            priority={700}
            flexGrow={1}
            messages={this.props.history}
          />
        )}

        {/* Include files only if user attached them */}
        {this.props.files && this.props.files.length > 0 && (
          <FileContext priority={600} files={this.props.files} />
        )}

        <UserMessage priority={900}>
          {this.props.query}
        </UserMessage>
      </>
    );
  }
}
```

**Pattern**: Conditional rendering based on props
