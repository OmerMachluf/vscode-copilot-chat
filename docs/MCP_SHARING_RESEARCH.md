# MCP Sharing Research: Copilot to Claude SDK

## Executive Summary

This document details research findings on which MCP servers are available in the Copilot codebase and how to share them with the Claude Agent SDK.

## Current State

### MCPs Currently Used by Claude SDK

**Location**: `src/extension/agents/claude/node/claudeCodeAgent.ts:630-632`

```typescript
mcpServers: {
    'a2a-orchestration': a2aMcpServer  // Only this MCP today
}
```

The `a2a-orchestration` MCP is an in-process SDK server created via `createSdkMcpServer()` from `@anthropic-ai/claude-agent-sdk`.

### A2A MCP Server Tools (Already Available)

**File**: `src/extension/agents/claude/node/claudeA2AMcpServer.ts`

The A2A MCP server provides these tools:
1. **a2a_list_agents** - List available agents for subtask spawning
2. **a2a_spawn_subtask** - Spawn a subtask to another agent
3. **a2a_await_subtasks** - Wait for non-blocking subtasks
4. **a2a_subtask_complete** - Signal subtask completion
5. **a2a_spawn_parallel_subtasks** - Spawn multiple subtasks in parallel
6. **a2a_send_message_to_worker** - Send message to running worker
7. **orchestrator_save_plan** - Create orchestration plan
8. **orchestrator_add_plan_task** - Add task to plan
9. **orchestrator_list_workers** - List plans/tasks/workers
10. **orchestrator_cancel_task** - Cancel a task
11. **orchestrator_complete_task** - Mark task completed
12. **orchestrator_deploy_task** - Deploy task from plan
13. **orchestrator_retry_task** - Retry failed task
14. **document_symbols** - Get symbols in a document
15. **get_definitions** - Find symbol definitions
16. **find_implementations** - Find implementations
17. **find_references** - Find all references
18. **workspace_symbols** - Search workspace symbols
19. **a2a_poll_subtask_updates** - Poll for subtask updates
20. **a2a_notify_parent** - Send status to parent worker
21. **a2a_get_worker_status** - Get worker status

---

## MCPs Available in Copilot

### 1. GitHub MCP Server (RECOMMENDED TO SHARE)

**Files**:
- `src/extension/githubMcp/vscode-node/githubMcp.contribution.ts`
- `src/extension/githubMcp/common/githubMcpDefinitionProvider.ts`

**Description**: HTTP-based MCP server that provides GitHub API access via Copilot API proxy.

**Endpoint**: `https://api.githubcopilot.com/mcp/` (or GHE equivalent)

**Configuration**:
```typescript
{
    type: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    headers: {
        'Authorization': 'Bearer ${accessToken}',
        'X-MCP-Toolsets': 'toolsets,joined,by,comma',  // optional
        'X-MCP-Readonly': 'true',  // optional
        'X-MCP-Lockdown': 'true',  // optional
    }
}
```

**Features**:
- Configurable via `github.copilot.chat.mcp.toolsets` setting
- Supports readonly mode (`github.copilot.chat.mcp.readonly`)
- Supports lockdown mode (`github.copilot.chat.mcp.lockdown`)
- Requires permissive GitHub session authentication
- Works with both GitHub.com and GitHub Enterprise

**VS Code Registration**: Uses `lm.registerMcpServerDefinitionProvider('github', provider)`

### 2. Workspace MCP Servers (From .vscode/mcp.json)

**File**: `src/extension/agents/copilotcli/node/mcpHandler.ts`

**Description**: User-configured MCP servers from workspace `.vscode/mcp.json` file.

**Configuration Schema**:
```json
{
    "servers": {
        "my-server": {
            "type": "stdio",        // or "local", "http", "sse"
            "command": "node",
            "args": ["server.js"],
            "env": { "KEY": "value" },
            "cwd": "${workspaceFolder}",
            "tools": ["*"]          // or specific tool names
        }
    }
}
```

**Supported Types**:
- `stdio` / `local` - Local process via stdin/stdout
- `http` - Remote HTTP endpoint
- `sse` - Server-Sent Events

### 3. MCP Setup/Installation Commands

**Files**:
- `src/extension/mcp/vscode-node/commands.ts`
- `src/extension/mcp/vscode-node/nuget.ts`

**Description**: Commands for installing and configuring MCP servers from package registries.

**Package Types Supported**:
- `npm` - Node.js packages from npmjs.org
- `pip` - Python packages from PyPI
- `nuget` - .NET packages from NuGet.org
- `docker` - Docker images from Docker Hub

**Commands**:
- `github.copilot.chat.mcp.setup.check` - Check if MCP setup is supported
- `github.copilot.chat.mcp.setup.validatePackage` - Validate a package for MCP setup
- `github.copilot.chat.mcp.setup.flow` - Run agent-assisted MCP configuration

---

## Format Conversion Requirements

### Claude SDK MCP Types

The Claude Agent SDK expects MCP servers in one of these formats:

```typescript
// From @anthropic-ai/claude-agent-sdk (inferred from usage)
type McpServerConfig =
    | McpStdioServerConfig        // Stdio-based
    | McpSSEServerConfig          // SSE-based
    | McpHttpServerConfig         // HTTP-based
    | McpSdkServerConfigWithInstance;  // In-process SDK server
```

### In-Process SDK Server (Current Approach)

**Used for**: A2A Orchestration MCP

```typescript
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';

const mcpServer = createSdkMcpServer({
    name: 'server-name',
    tools: [
        tool('tool_name', 'description', zodSchema, async (args) => {
            return { content: [{ type: 'text', text: 'result' }] };
        }),
        // ...
    ]
});

// Add to options
const options = {
    mcpServers: {
        'server-name': mcpServer
    }
};
```

### HTTP/SSE Server Conversion

For the GitHub MCP server (HTTP-based), conversion would be:

```typescript
// From Copilot format (GitHubMcpDefinitionProvider)
{
    label: 'GitHub',
    uri: 'https://api.githubcopilot.com/mcp/',
    headers: { 'Authorization': 'Bearer token' },
    version: 'toolsets|readonly'
}

// To Claude SDK format (likely)
{
    type: 'http',  // or 'sse'
    url: 'https://api.githubcopilot.com/mcp/',
    headers: { 'Authorization': 'Bearer token' }
}
```

### Stdio Server Conversion

For workspace MCP servers:

```typescript
// From Copilot format (mcp.json)
{
    type: 'stdio',
    command: 'node',
    args: ['server.js'],
    env: { 'KEY': 'value' },
    cwd: '/workspace'
}

// To Claude SDK format (likely)
{
    type: 'stdio',
    command: 'node',
    args: ['server.js'],
    env: { 'KEY': 'value' },
    cwd: '/workspace'
}
```

---

## Recommendations

### Priority 1: Share GitHub MCP Server

**Why**: Provides access to GitHub API tools without duplication.

**Implementation**:
1. Get GitHub MCP definition from `GitHubMcpDefinitionProvider`
2. Resolve definition to get access token
3. Convert to Claude SDK HTTP server format
4. Add to `mcpServers` in Options

```typescript
async _buildSharedMcpServers(): Promise<Record<string, McpServerConfig>> {
    const servers: Record<string, McpServerConfig> = {};

    // 1. Add GitHub MCP if available and configured
    const githubMcp = await this._getGitHubMcpConfig();
    if (githubMcp) {
        servers['github'] = githubMcp;
    }

    return servers;
}

async _getGitHubMcpConfig(): Promise<McpServerConfig | undefined> {
    if (!this.configurationService.getConfig(ConfigKey.GitHubMcpEnabled)) {
        return undefined;
    }

    const provider = new GitHubMcpDefinitionProvider(
        this.configurationService,
        this.authenticationService,
        this.logService
    );

    const definitions = provider.provideMcpServerDefinitions();
    if (!definitions?.length) {
        return undefined;
    }

    // Resolve to get auth token
    const resolved = await provider.resolveMcpServerDefinition(
        definitions[0],
        CancellationToken.None
    );

    return {
        type: 'http',
        url: resolved.uri.toString(),
        headers: resolved.headers
    };
}
```

### Priority 2: Share Workspace MCP Servers

**Why**: Allows users to configure additional MCPs that work in both Copilot and Claude.

**Implementation**:
1. Use `CopilotCLIMCPHandler.loadMcpConfig()` to get configured servers
2. Filter out `github` (handled separately)
3. Convert stdio/http formats
4. Add to `mcpServers`

```typescript
async _getWorkspaceMcpServers(): Promise<Record<string, McpServerConfig>> {
    const mcpHandler = this.instantiationService.createInstance(CopilotCLIMCPHandler);
    const config = await mcpHandler.loadMcpConfig(this._workingDirectory);

    if (!config) {
        return {};
    }

    const servers: Record<string, McpServerConfig> = {};
    for (const [name, server] of Object.entries(config)) {
        if (name === 'github' && server.isDefaultServer) {
            continue;  // Handled by Priority 1
        }

        servers[name] = this._convertToClaudeSdkFormat(server);
    }

    return servers;
}

_convertToClaudeSdkFormat(server: MCPServerConfig): McpServerConfig {
    if (server.type === 'http' || server.type === 'sse') {
        return {
            type: server.type,
            url: server.url,
            headers: server.headers
        };
    }

    return {
        type: 'stdio',
        command: server.command,
        args: server.args,
        env: server.env,
        cwd: server.cwd
    };
}
```

### Priority 3: Consider MCP Setup Commands

**Why**: Could enable dynamic MCP discovery and configuration.

**Note**: Lower priority as these are installation commands, not runtime MCPs.

---

## Files to Modify

### For GitHub MCP Sharing:

```
src/extension/agents/claude/node/claudeCodeAgent.ts
├── Add method: _buildSharedMcpServers()
├── Add method: _getGitHubMcpConfig()
├── Modify: _startClaudeQuery() to include shared MCPs
└── Add dependency: GitHubMcpDefinitionProvider
```

### For Workspace MCP Sharing:

```
src/extension/agents/claude/node/claudeCodeAgent.ts
├── Add method: _getWorkspaceMcpServers()
├── Add method: _convertToClaudeSdkFormat()
└── Add dependency: ICopilotCLIMCPHandler
```

---

## Testing Considerations

1. **Authentication**: GitHub MCP requires permissive GitHub session - ensure token refresh works
2. **Toolset Filtering**: Verify X-MCP-Toolsets header is passed correctly
3. **Readonly/Lockdown**: Test that modes are respected
4. **Workspace Servers**: Test with various server types (stdio, http, sse)
5. **Error Handling**: Handle cases where MCP resolution fails

---

## Open Questions

1. **Claude SDK Type Definitions**: Need to verify exact MCP config types from SDK. The types `McpStdioServerConfig`, `McpSSEServerConfig`, `McpHttpServerConfig` are mentioned in the architecture plan but need verification from actual SDK.

2. **Authentication Token Lifecycle**: How does Claude SDK handle token refresh for HTTP MCPs?

3. **Tool Filtering**: Should we respect the `tools` array from workspace config, or let Claude SDK use all available tools?

4. **Default Server Flag**: Should we expose the `isDefaultServer` flag to Claude SDK for any purpose?

---

## Summary

| MCP Server | Type | Priority | Complexity | Notes |
|------------|------|----------|------------|-------|
| A2A Orchestration | In-process SDK | Already Done | N/A | 21 tools available |
| GitHub MCP | HTTP | High | Medium | Auth required |
| Workspace MCPs | Stdio/HTTP/SSE | Medium | Low | From mcp.json |
| MCP Setup Commands | VS Code Commands | Low | N/A | Installation only |

The recommended approach is to:
1. Keep `a2a-orchestration` as-is (in-process)
2. Add GitHub MCP as HTTP server (resolving auth dynamically)
3. Add workspace MCPs from `.vscode/mcp.json`
