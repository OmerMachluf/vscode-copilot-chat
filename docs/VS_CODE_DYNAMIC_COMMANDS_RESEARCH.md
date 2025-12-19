# VS Code Dynamic Commands API Research

## Executive Summary

VS Code's Chat API does **not** support dynamically adding slash commands after a chat participant is registered. Commands must be declared in `package.json` at build time.

**Recommended Approach**: Use a fallback pattern where the request handler intercepts unrecognized commands from the prompt text and processes them dynamically.

---

## Research Findings

### 1. Current Command Registration

Commands are defined statically in `package.json`:

```json
{
  "chatParticipants": [
    {
      "id": "github.copilot.default",
      "name": "copilot",
      "commands": [
        { "name": "explain", "description": "Explain this code" },
        { "name": "fix", "description": "Fix this code" }
      ]
    }
  ]
}
```

### 2. Proposed APIs Analyzed

**File**: `src/extension/vscode.proposed.chatParticipantAdditions.d.ts`
- Extends `ChatParticipant` with event handling (`onDidPerformAction`)
- Adds `participantVariableProvider` for custom variables
- Adds response stream extensions
- **No dynamic command registration API**

**File**: `src/extension/vscode.proposed.chatParticipantPrivate.d.ts`
- Provides `createDynamicChatParticipant()` for creating participants at runtime
- Provides `registerCustomAgentsProvider()` for custom agent files
- **No dynamic slash command API**

### 3. CustomAgentsProvider Interface

```typescript
interface CustomAgentsProvider {
  readonly onDidChangeCustomAgents?: Event<void>;
  provideCustomAgents(options: CustomAgentQueryOptions, token: CancellationToken): ProviderResult<CustomAgentResource[]>;
}

interface CustomAgentResource {
  readonly name: string;
  readonly description: string;
  readonly uri: Uri;
  readonly isEditable?: boolean;
}
```

This allows providing custom **agents** dynamically (from `.agent.md` files), but not slash commands.

---

## Fallback Implementation Strategy

### Pattern: Request Handler Command Interception

Since dynamic command registration is not possible, we intercept commands in the request handler:

```typescript
async handleRequest(request: ChatRequest, context: ChatContext, stream: ChatResponseStream) {
  // Check if user typed an unrecognized command
  const commandMatch = request.prompt.match(/^\/(\w+)(?:\s+(.*))?$/);

  if (commandMatch) {
    const [, commandId, args] = commandMatch;

    // Look up command in UnifiedDefinitionService
    const command = await this.unifiedDefinitionService.getCommand(commandId);

    if (command) {
      // Inject command content as system prompt
      const augmentedPrompt = command.content.replace('$ARGUMENTS', args || '');

      // Continue with augmented prompt
      return this.processWithInjectedCommand(augmentedPrompt, request, context, stream);
    }
  }

  // Normal request processing
  return this.processNormalRequest(request, context, stream);
}
```

### Key Implementation Points

1. **Command Detection**: Parse `request.prompt` for `/commandname` pattern
2. **Command Lookup**: Use `IUnifiedDefinitionService.getCommand(commandId)`
3. **Content Injection**: Replace `$ARGUMENTS` placeholder with user input
4. **Prompt Augmentation**: Inject command content before normal processing

### UI Considerations

- Commands from `.github/commands/` won't appear in VS Code's command palette autocomplete
- Users must know the command name in advance, or we can provide a `/help` command
- Consider adding a custom completion provider for command suggestions

---

## Files to Modify

### Primary Handler
`src/extension/prompt/node/chatParticipantRequestHandler.ts`

```typescript
// Add command interception at start of handleRequest
private async _tryHandleDynamicCommand(
  request: ChatRequest,
  context: ChatContext,
  stream: ChatResponseStream
): Promise<boolean> {
  const commandMatch = request.prompt.match(/^\/(\w+)(?:\s+(.*))?$/);
  if (!commandMatch) return false;

  const [, commandId, args] = commandMatch;
  const command = await this.unifiedDefinitionService.getCommand(commandId);

  if (!command) return false;

  // Command found - inject content
  const augmentedPrompt = command.content.replace('$ARGUMENTS', args || '');
  // ... process with augmented prompt
  return true;
}
```

### Registration (for discoverability)
`src/extension/conversation/vscode-node/chatParticipants.ts`

Consider implementing a `ChatParticipantCompletionItemProvider` to suggest available commands.

---

## Alternative Approaches (Not Recommended)

### 1. Rebuild Extension on Command Change
- Re-generate `package.json` chatParticipants section
- Force extension reload
- **Why not**: Disruptive UX, requires restart

### 2. Use Agent Instead of Command
- Register as custom agent via `CustomAgentsProvider`
- **Why not**: Different UX pattern, agents vs commands

### 3. Symbolic Links in assets/
- Symlink repo commands to assets/commands/
- Include in build
- **Why not**: Build-time only, not truly dynamic

---

## Conclusion

The fallback approach (command interception in request handler) is the correct solution. It:
- Requires no VS Code API changes
- Works with existing `UnifiedDefinitionService`
- Supports dynamic command loading from repo
- Is consistent with how Claude Code handles slash commands

Implementation complexity: **Low**
Performance impact: **Minimal** (single regex match + cache lookup)
