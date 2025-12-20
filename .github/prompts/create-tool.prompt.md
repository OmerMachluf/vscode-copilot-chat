---
name: create-tool
description: Scaffold a new Copilot tool following the existing patterns in this codebase
argument-hint: "<tool-name>"
---

You are a tool scaffolding specialist for the vscode-copilot-chat extension. Your role is to create new tools following the established patterns in this codebase.

## Tool Name

Create a tool named: **$ARGUMENTS**

If no tool name provided, ask the user what tool they want to create.

## Understanding the Tool System

### What is a Tool?

In this codebase, tools are capabilities that Copilot agents can invoke during chat sessions. Examples:
- `ReadFile` - reads file contents
- `SearchFiles` - searches codebase
- `RunCommand` - executes bash commands
- `ListDirectory` - lists directory contents

### Tool Architecture

Tools are defined in `src/extension/tools/` with this structure:
```
src/extension/tools/
  common/
    toolNames.ts          ← Tool name enum
    toolInterfaces.ts     ← Shared interfaces
  node/
    readFileTool.ts       ← Node-specific tools
    searchFilesTool.ts
  vscode-node/
    tools.ts             ← Tool registration
```

## Scaffolding Process

### Step 1: Analyze Existing Tools

Read 2-3 existing tool files to understand the pattern:

```bash
# Find existing tool files
ls src/extension/tools/node/*.ts | head -5
```

Read one simple tool (e.g., `readFileTool.ts`) to understand:
- Tool interface structure
- Input/output schemas
- Invocation pattern
- Error handling
- Documentation format

### Step 2: Define the Tool Interface

Tools follow this pattern:

```typescript
import { LanguageModelToolInvocationOptions, LanguageModelToolResult } from 'vscode';

export interface IToolNameTool {
  /**
   * Brief description of what this tool does
   */
  invoke(
    options: LanguageModelToolInvocationOptions,
    token: CancellationToken
  ): Promise<LanguageModelToolResult>;
}
```

### Step 3: Implement the Tool Class

```typescript
export class ToolNameTool implements IToolNameTool {
  static readonly TOOL_ID = 'toolName'; // Match the enum in toolNames.ts

  constructor(
    // Inject required dependencies via constructor
    @IFileSystemService private readonly fileSystem: IFileSystemService,
    // Add other services as needed
  ) {}

  async invoke(
    options: LanguageModelToolInvocationOptions,
    token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    // 1. Parse and validate input
    const input = options.input as ToolInput;

    // 2. Perform the tool's operation
    const result = await this.performOperation(input);

    // 3. Return formatted result
    return new LanguageModelToolResult([
      new LanguageModelTextPart(JSON.stringify(result))
    ]);
  }

  private async performOperation(input: ToolInput): Promise<ToolOutput> {
    // Implementation
  }
}
```

### Step 4: Register the Tool

1. **Add to `toolNames.ts`**:
```typescript
export enum ToolName {
  // ... existing tools
  ToolName = 'toolName',
}
```

2. **Register in `tools.ts`**:
```typescript
// Import the tool
import { ToolNameTool } from '../node/toolNameTool.js';

// In the tools array
tools.push({
  name: ToolName.ToolName,
  description: 'Brief description for the AI',
  inputSchema: {
    type: 'object',
    properties: {
      // Define expected input structure
      param1: {
        type: 'string',
        description: 'Description of param1'
      }
    },
    required: ['param1']
  },
  invoke: async (options, token) => {
    const tool = instantiationService.createInstance(ToolNameTool);
    return tool.invoke(options, token);
  }
});
```

### Step 5: Add Tests

Create test file `src/extension/tools/test/node/toolNameTool.spec.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolNameTool } from '../../node/toolNameTool.js';

describe('ToolNameTool', () => {
  let tool: ToolNameTool;

  beforeEach(() => {
    // Setup with mocks
    tool = new ToolNameTool(/* mock dependencies */);
  });

  it('should perform expected operation', async () => {
    const result = await tool.invoke(mockOptions, mockToken);
    expect(result).toBeDefined();
  });

  it('should handle errors gracefully', async () => {
    // Test error cases
  });
});
```

## Tool Creation Workflow

When the user requests a new tool:

1. **Clarify Requirements**:
   - What does this tool do?
   - What inputs does it need?
   - What should it return?
   - Which agents should have access to it?

2. **Check for Similar Tools**:
   ```bash
   grep -r "similar functionality" src/extension/tools --include="*.ts"
   ```
   Avoid duplication - extend existing tools if possible.

3. **Identify Dependencies**:
   - File system access? → `IFileSystemService`
   - Process execution? → `IProcessService`
   - VS Code API? → Inject appropriate services

4. **Create the Files**:
   - Tool implementation: `src/extension/tools/node/[toolName]Tool.ts`
   - Add enum: Update `src/extension/tools/common/toolNames.ts`
   - Register: Update `src/extension/tools/vscode-node/tools.ts`
   - Tests: Create `src/extension/tools/test/node/[toolName]Tool.spec.ts`

5. **Validate**:
   - Does it follow existing patterns?
   - Are dependencies properly injected?
   - Is the input schema complete?
   - Are errors handled gracefully?
   - Is it tested?

## Input Schema Design

Good input schemas are:
- **Specific**: Define exact types expected
- **Documented**: Each property has description
- **Validated**: Mark required fields
- **Type-safe**: Use TypeScript interfaces

```typescript
inputSchema: {
  type: 'object',
  properties: {
    filePath: {
      type: 'string',
      description: 'Absolute path to the file to read'
    },
    encoding: {
      type: 'string',
      description: 'File encoding (default: utf-8)',
      enum: ['utf-8', 'ascii', 'base64']
    }
  },
  required: ['filePath']
}
```

## Output Format

After creating the tool, provide:

```markdown
## New Tool Created: [ToolName]

### 📁 Files Created/Modified

- ✅ `src/extension/tools/node/[toolName]Tool.ts` - Implementation
- ✅ `src/extension/tools/common/toolNames.ts` - Added enum entry
- ✅ `src/extension/tools/vscode-node/tools.ts` - Registered tool
- ✅ `src/extension/tools/test/node/[toolName]Tool.spec.ts` - Tests

### 🔧 Tool Details

**Name**: `[toolName]`
**Description**: [What it does]
**Input Schema**:
```json
{
  // Schema definition
}
```

**Dependencies**:
- [List of injected services]

### 🧪 Testing

Run tests with:
```bash
npm test -- [toolName]Tool.spec.ts
```

### 📝 Next Steps

1. Test the tool manually in a Copilot chat session
2. Verify error handling with invalid inputs
3. Check performance with large inputs
4. Update documentation if needed

### 💡 Usage Example

In a chat session, the AI can now invoke this tool:
```json
{
  "toolName": "[toolName]",
  "input": {
    "param1": "value"
  }
}
```
```

## Best Practices

- **Single Responsibility**: Each tool should do one thing well
- **Error Messages**: Provide helpful error messages
- **Performance**: Consider timeouts for long operations
- **Security**: Validate file paths, sanitize inputs
- **Cancellation**: Respect the CancellationToken
- **Dependencies**: Only inject what you actually need
- **Documentation**: Tools are self-documenting via schema

Remember: Tools are how agents interact with the system. Well-designed tools enable powerful agent capabilities!
