# Agent Sessions System - Technical Knowledge Base

> **Document Version:** 1.0
> **Last Updated:** December 7, 2025
> **Status:** Reference Documentation

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture](#system-architecture)
3. [Session Types Overview](#session-types-overview)
4. [Claude Code Sessions](#claude-code-sessions)
5. [Copilot CLI Sessions](#copilot-cli-sessions)
6. [Copilot Cloud Sessions](#copilot-cloud-sessions)
7. [Core Patterns & Interfaces](#core-patterns--interfaces)
8. [Service Registration & Dependency Injection](#service-registration--dependency-injection)
9. [Git Worktree Integration](#git-worktree-integration)
10. [Terminal Integration](#terminal-integration)
11. [Permission & Approval System](#permission--approval-system)
12. [Session Persistence](#session-persistence)
13. [Key Data Models](#key-data-models)
14. [Activation Paths](#activation-paths)
15. [File Reference](#file-reference)

---

## Executive Summary

The Agent Sessions system enables **multiple parallel AI chat sessions** within VS Code Copilot Chat. It provides:

- Multiple session types: Claude Code, Copilot CLI, and Copilot Cloud
- Session isolation via git worktrees
- Persistent session state across VS Code restarts
- Terminal integration for CLI-based agents
- Cross-session PR integration for cloud sessions

### Key Benefits

| Benefit | Description |
|---------|-------------|
| **Parallel Sessions** | Multiple AI agents can work simultaneously |
| **Session Persistence** | Sessions survive VS Code restarts |
| **Isolation** | Worktree-based isolation prevents conflicts |
| **Cloud Delegation** | Delegate work to GitHub's cloud agent |
| **Model Selection** | Per-session model choice |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VS CODE CHAT UI                                    │
│                    (Chat Panel, Session Selector)                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
        ┌───────────────────┐           ┌───────────────────────┐
        │  ChatSessionsContrib         │  VS Code Chat API     │
        │  (chatSessions.ts)│           │  registerChatSession* │
        │                   │           │  createChatParticipant│
        └───────────────────┘           └───────────────────────┘
                    │
      ┌─────────────┼─────────────┬─────────────────────────┐
      ▼             ▼             ▼                         ▼
┌───────────┐ ┌───────────┐ ┌───────────────┐  ┌───────────────────┐
│Claude Code│ │Copilot CLI│ │Copilot Cloud │  │ Model Selection   │
│ Sessions  │ │ Sessions  │ │  Sessions     │  │ Per-Session       │
│           │ │           │ │               │  │                   │
│claude-code│ │ copilotcli│ │copilot-cloud- │  │ Claude Sonnet     │
│           │ │           │ │    agent      │  │ GPT-4o, etc.      │
└───────────┘ └───────────┘ └───────────────┘  └───────────────────┘
      │             │               │
      ▼             ▼               ▼
┌───────────┐ ┌───────────┐ ┌───────────────┐
│ Claude    │ │ Copilot   │ │ GitHub Cloud  │
│ CLI SDK  │ │ CLI SDK   │ │ Agent API     │
│ (local)   │ │ (local)   │ │ (remote)      │
└───────────┘ └───────────┘ └───────────────┘
```

---

## Session Types Overview

The system supports three distinct session types, each with its own:
- **ItemProvider** - Lists available sessions
- **ContentProvider** - Provides session content/history
- **ChatParticipant** - Handles chat requests

| Session Type | Scheme | Agent Backend | Storage |
|--------------|--------|---------------|---------|
| Claude Code | `claude-code` | Claude CLI SDK (local) | `~/.claude/projects/*.jsonl` |
| Copilot CLI | `copilotcli` | Copilot CLI SDK (local) | `~/.copilot/session-state/*.jsonl` |
| Copilot Cloud | `copilot-cloud-agent` | GitHub Cloud API (remote) | GitHub Sessions API |

---

## Claude Code Sessions

### Architecture

Claude Code sessions use the Anthropic Claude Code SDK to run Claude locally.

```
┌─────────────────────────────────────────────────────────┐
│                 ClaudeAgentManager                       │
│              (claudeCodeAgent.ts)                        │
│                                                         │
│  ┌─────────────────────────────────────────────────────┐ │
│  │         ClaudeCodeSession (per session)            │ │
│  │  - Query generator (async iterable)                │ │
│  │  - Prompt queue                                    │ │
│  │  - Tool permission handling                        │ │
│  │  - Edit tracking                                   │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│             LanguageModelServer                          │
│  - Local proxy server for ANTHROPIC_BASE_URL            │
│  - Auth token injection                                 │
└─────────────────────────────────────────────────────────┘
```

### Key Components

**ClaudeAgentManager** (`claudeCodeAgent.ts`)
- Manages multiple Claude sessions
- Creates/reuses sessions based on session ID
- Handles language model server lifecycle

**ClaudeCodeSession** (`claudeCodeAgent.ts`)
- Individual session state
- Async prompt queue for request serialization
- Tool permission hooks (PreToolUse, PostToolUse)
- External edit tracking

**ClaudeCodeSessionService** (`claudeCodeSessionService.ts`)
- Loads sessions from disk (`~/.claude/projects/<slug>/*.jsonl`)
- Builds message chains from JSONL files
- Extracts summaries and metadata

### Session Loading

```typescript
// Sessions stored in: ~/.claude/projects/<workspace-slug>/
// Files: *.jsonl (one per conversation)

interface IClaudeCodeSession {
  id: string;
  summary?: string;
  messages: SDKMessage[];
  modifiedTime: Date;
}
```

---

## Copilot CLI Sessions

### Architecture

Copilot CLI uses GitHub's Copilot SDK for local agent execution.

```
┌──────────────────────────────────────────────────────────┐
│              CopilotCLISessionService                     │
│            (copilotcliSessionService.ts)                  │
│                                                          │
│  ┌──────────────────────┐  ┌──────────────────────────┐  │
│  │ CLISessionManager    │  │ Session File Watcher     │  │
│  │ (SDK)                │  │ (~/.copilot/session-state)│  │
│  └──────────────────────┘  └──────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────┐
│              CopilotCLISession                            │
│            (copilotcliSession.ts)                         │
│                                                          │
│  - SDK Session wrapper                                   │
│  - Event handlers (assistant.message, tool.*, etc.)      │
│  - Permission request handling                           │
│  - Edit tracking for file modifications                  │
└──────────────────────────────────────────────────────────┘
```

### Key Components

**CopilotCLISessionService** (`copilotcliSessionService.ts`)
- Session lifecycle management
- Reference counting for session reuse
- Automatic session disposal after timeout (5 min)
- File watcher for session directory changes

**CopilotCLISession** (`copilotcliSession.ts`)
- Wraps SDK Session
- Event-based message handling
- Permission handler attachment
- Chat history building from events

**CopilotCLIWorktreeManager** (`copilotCLIChatSessionsContribution.ts`)
- Creates/manages git worktrees for session isolation
- Persists worktree mappings to global state
- Branch naming: `copilot-cli-session/<session-id>`

### Permission System

```typescript
interface PermissionRequest {
  kind: 'read' | 'write';
  path?: string;           // For read
  fileName?: string;       // For write
  content?: string;        // File content
}

// Auto-approval rules:
// 1. Reads within workspace/working directory
// 2. Writes to working directory (when isolation enabled)
// 3. Writes to workspace files (unless protected)
```

---

## Copilot Cloud Sessions

### Architecture

Cloud sessions delegate work to GitHub's cloud-based coding agent.

```
┌──────────────────────────────────────────────────────────┐
│           CopilotCloudSessionsProvider                    │
│         (copilotCloudSessionsProvider.ts)                 │
│                                                          │
│  - Chat participant implementation                       │
│  - Session item provider                                 │
│  - Session content provider                              │
│  - PR integration                                        │
└──────────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────┐
│               GitHub API Integration                      │
│              (via IOctoKitService)                        │
│                                                          │
│  - getCopilotSessionsForPR()                             │
│  - getSessionLogs()                                      │
│  - postCopilotAgentJob()                                 │
│  - addPullRequestComment()                               │
└──────────────────────────────────────────────────────────┘
```

### Key Features

**Cloud Delegation Flow:**
1. User confirms delegation via `stream.confirmation()`
2. Check for uncommitted changes
3. Create remote agent job via GitHub API
4. Poll for job to have PR information
5. Stream session logs in real-time
6. Display PR card when complete

**Follow-up Comments:**
- Adds `@copilot <message>` comment to PR
- Waits for new session to start
- Streams progress as it happens

**Custom Agents:**
- Supports custom agents from repository
- Agent selection via `optionGroups` in session options

---

## Core Patterns & Interfaces

### Three-Provider Pattern

Each session type implements three interfaces:

```typescript
// 1. Item Provider - Lists sessions
interface vscode.ChatSessionItemProvider {
  onDidChangeChatSessionItems: Event<void>;
  provideChatSessionItems(token: CancellationToken): Promise<ChatSessionItem[]>;
}

// 2. Content Provider - Provides session content
interface vscode.ChatSessionContentProvider {
  provideChatSessionContent(
    resource: Uri,
    token: CancellationToken
  ): Promise<ChatSession>;

  // Optional provider options
  provideChatSessionProviderOptions?(token: CancellationToken): Promise<ChatSessionProviderOptions>;
}

// 3. Chat Participant - Handles requests
// Created via vscode.chat.createChatParticipant()
type ChatRequestHandler = (
  request: ChatRequest,
  context: ChatContext,
  stream: ChatResponseStream,
  token: CancellationToken
) => Promise<ChatResult>;
```

### ChatSession Interface

```typescript
interface vscode.ChatSession {
  history: (ChatRequestTurn2 | ChatResponseTurn2)[];
  options?: Record<string, string>;  // e.g., { agents: 'custom-agent-id' }
  activeResponseCallback?: (stream: ChatResponseStream, token: CancellationToken) => Thenable<void>;
  requestHandler?: ChatRequestHandler;
}
```

### ChatSessionItem Interface

```typescript
interface vscode.ChatSessionItem {
  resource: Uri;           // Session identifier
  label: string;           // Display name
  status?: ChatSessionStatus;
  description?: MarkdownString;
  tooltip?: MarkdownString;
  timing?: {
    startTime: number;
  };
  statistics?: {
    files?: number;
    insertions?: number;
    deletions?: number;
  };
}
```

---

## Service Registration & Dependency Injection

### ChatSessionsContrib Registration

The main contribution class registers all session types:

```typescript
// src/extension/chatSessions/vscode-node/chatSessions.ts

export class ChatSessionsContrib extends Disposable implements IExtensionContribution {
  readonly id = 'chatSessions';

  constructor(
    @IInstantiationService instantiationService: IInstantiationService,
    @ILogService logService: ILogService,
    @IOctoKitService octoKitService: IOctoKitService,
  ) {
    // 1. Register Claude Code sessions
    const claudeAgentInstaService = instantiationService.createChild(
      new ServiceCollection(
        [IClaudeCodeSessionService, new SyncDescriptor(ClaudeCodeSessionService)],
        [IClaudeCodeSdkService, new SyncDescriptor(ClaudeCodeSdkService)],
        [ILanguageModelServer, new SyncDescriptor(LanguageModelServer)],
      ));

    // Register providers...
    vscode.chat.registerChatSessionItemProvider('claude-code', sessionItemProvider);
    vscode.chat.registerChatSessionContentProvider('claude-code', contentProvider, participant);

    // 2. Register Copilot CLI sessions
    const copilotcliAgentInstaService = instantiationService.createChild(
      new ServiceCollection(
        [ICopilotCLISessionService, new SyncDescriptor(CopilotCLISessionService)],
        [ICopilotCLIModels, new SyncDescriptor(CopilotCLIModels)],
        [ICopilotCLISDK, new SyncDescriptor(CopilotCLISDK)],
        // ...
      ));

    // 3. Register Copilot Cloud sessions
    vscode.chat.registerChatSessionItemProvider(CopilotCloudSessionsProvider.TYPE, cloudProvider);
    vscode.chat.registerChatSessionContentProvider(
      CopilotCloudSessionsProvider.TYPE,
      cloudProvider,
      cloudProvider.chatParticipant,
      { supportsInterruptions: true }
    );
  }
}
```

### Service Collection Pattern

Each session type gets its own child instantiation service with specific service bindings:

```typescript
// Claude Code services
[IClaudeCodeSessionService, new SyncDescriptor(ClaudeCodeSessionService)]
[IClaudeCodeSdkService, new SyncDescriptor(ClaudeCodeSdkService)]
[ILanguageModelServer, new SyncDescriptor(LanguageModelServer)]

// Copilot CLI services
[ICopilotCLISessionService, new SyncDescriptor(CopilotCLISessionService)]
[ICopilotCLIModels, new SyncDescriptor(CopilotCLIModels)]
[ICopilotCLISDK, new SyncDescriptor(CopilotCLISDK)]
[ICopilotCLITerminalIntegration, new SyncDescriptor(CopilotCLITerminalIntegration)]
[ICopilotCLIMCPHandler, new SyncDescriptor(CopilotCLIMCPHandler)]

// Copilot Cloud services
[IOctoKitService, new SyncDescriptor(OctoKitService)]
[IPullRequestFileChangesService, new SyncDescriptor(PullRequestFileChangesService)]
```

---

## Git Worktree Integration

### CopilotCLIWorktreeManager

Manages git worktrees for session isolation:

```typescript
class CopilotCLIWorktreeManager {
  private _storedWorktrees: Map<string, SessionWorktreeInfo>;

  // Create worktree for session
  async getWorktreeForSession(
    sessionId: string,
    shouldCreate?: boolean
  ): Promise<SessionWorktreeInfo | undefined>;

  // Remove worktree when session ends
  async removeWorktree(sessionId: string): Promise<void>;

  // Persist to global state
  private _saveWorktreeMappings(): void;
  private _loadWorktreeMappings(): void;
}

interface SessionWorktreeInfo {
  sessionId: string;
  worktreePath: string;
  branchName: string;
  repoPath: string;
}
```

### Worktree Creation Flow

```
1. User starts session with "isolation" enabled
2. CopilotCLIWorktreeManager.getWorktreeForSession()
3. Create branch: copilot-cli-session/<session-id>
4. Create worktree: <repo>/../.worktrees/<session-id>
5. Configure session workingDirectory to worktree path
6. All file operations scoped to worktree
7. On completion: stage changes, commit, optionally push
```

---

## Terminal Integration

### CopilotCLITerminalIntegration

Enables CLI sessions in VS Code terminal:

```typescript
interface ICopilotCLITerminalIntegration {
  openTerminal(name: string, cliArgs?: string[]): Promise<void>;
}
```

**Shell Support:**
- zsh
- bash
- PowerShell (pwsh)
- Command Prompt (cmd)

**Integration Features:**
- Shell integration detection
- Python environment activation
- Custom shell scripts for cross-platform support
- GitHub token injection via environment variables

### Terminal Scripts

```
Windows:
  copilot.bat → PowerShell script → copilotCLIShim.ps1

macOS/Linux:
  copilot (shell script) → copilotCLIShim.js
```

---

## Permission & Approval System

### Copilot CLI Permissions

```typescript
type PermissionHandler = (
  permissionRequest: PermissionRequest,
  token: CancellationToken,
) => Promise<boolean>;

interface PermissionRequest {
  kind: 'read' | 'write';
  path?: string;       // Read: file path
  fileName?: string;   // Write: target file
  content?: string;    // Write: file content
}
```

### Auto-Approval Rules

| Scenario | Auto-Approve |
|----------|--------------|
| Read file in workspace | ✅ |
| Read file in working directory | ✅ |
| Read file outside workspace | ❌ |
| Write to worktree (isolation mode) | ✅ |
| Write to workspace (non-protected) | ✅ |
| Write protected file (.env, secrets) | ❌ |

### Claude Code Permissions

Uses `canUseTool` callback:

```typescript
canUseTool: async (name, input) => {
  // Auto-approve file edits to allowed files
  if (toolName in ['Edit', 'Write', 'MultiEdit']) {
    if (await isFileOkForTool(URI.file(input.file_path))) {
      return { behavior: 'allow', updatedInput: input };
    }
  }

  // Otherwise, show confirmation dialog
  const result = await toolsService.invokeTool(ToolName.CoreConfirmationTool, ...);
  return result === 'yes'
    ? { behavior: 'allow', updatedInput: input }
    : { behavior: 'deny', message: 'User declined' };
}
```

---

## Session Persistence

### Claude Code Sessions

**Storage Location:** `~/.claude/projects/<workspace-slug>/*.jsonl`

**Loading Process:**
1. Scan for JSONL files in project directory
2. Parse each file for message chains
3. Find leaf nodes (messages with no children)
4. Build message chain from each leaf to root
5. Extract summary from first assistant message

```typescript
interface IClaudeCodeSession {
  id: string;
  summary?: string;
  messages: SDKMessage[];
  modifiedTime: Date;
}

type SDKMessage = SDKUserMessage | SDKAssistantMessage | SDKResultMessage;
```

### Copilot CLI Sessions

**Storage Location:** `~/.copilot/session-state/*.jsonl`

**Management:**
- `CLISessionManager` (SDK) handles persistence
- Service watches directory for changes
- Sessions auto-dispose after 5 minutes of inactivity
- Reference counting prevents premature disposal

```typescript
interface ICopilotCLISessionItem {
  readonly id: string;
  readonly label: string;
  readonly timestamp: Date;
  readonly status?: ChatSessionStatus;
}
```

### Copilot Cloud Sessions

**Storage:** GitHub Sessions API

**Caching:**
- Local cache of session → PR mapping
- Background refresh every 5 minutes
- Refresh on authentication changes

---

## Key Data Models

### ChatSessionStatus

```typescript
enum ChatSessionStatus {
  InProgress = 0,
  Completed = 1,
  Failed = 2,
}
```

### ChatRequestTurn2 / ChatResponseTurn2

```typescript
class ChatRequestTurn2 {
  constructor(
    prompt: string,
    participant: ChatParticipantIdentifier | undefined,
    references: ChatPromptReference[],
    command: string,
    attachments: readonly ChatPromptAttachment[],
    toolInvocationToken: ChatParticipantToolToken | undefined
  );
}

class ChatResponseTurn2 {
  constructor(
    parts: ChatResponsePart[],
    result: ChatResult,
    participant: string
  );
}
```

### Tool Invocation Parts

```typescript
// Tool execution tracking
class ChatToolInvocationPart {
  toolCallId: string;
  toolName: string;
  input: unknown;
  isConfirmed?: boolean;
}

// Thinking/reasoning progress
class ChatResponseThinkingProgressPart {
  thinkingPart: string;
  title: string;
  options?: { vscodeReasoningDone?: boolean };
}
```

---

## Activation Paths

### How Sessions Are Activated

1. **Extension Activation**
   - `ChatSessionsContrib` registered as contribution
   - Service collections created for each session type
   - Providers registered with VS Code Chat API

2. **Session List Population**
   - User opens Chat Session panel
   - `provideChatSessionItems()` called for each session type
   - Sessions loaded from disk/API

3. **Session Selection**
   - User selects session from list
   - `provideChatSessionContent()` called
   - History built from stored messages
   - `activeResponseCallback` set for in-progress sessions

4. **Chat Request**
   - User sends message in session
   - Chat participant handler invoked
   - Session wrapper handles SDK communication
   - Response streamed back to UI

### Registration Chain

```
Extension Activation
    │
    ▼
ChatSessionsContrib constructor
    │
    ├──► registerChatSessionItemProvider('claude-code', ...)
    ├──► registerChatSessionContentProvider('claude-code', ...)
    │
    ├──► registerChatSessionItemProvider('copilotcli', ...)
    ├──► registerChatSessionContentProvider('copilotcli', ...)
    │
    ├──► registerChatSessionItemProvider('copilot-cloud-agent', ...)
    └──► registerChatSessionContentProvider('copilot-cloud-agent', ...)
```

---

## File Reference

### Core Files

| Component | File Path |
|-----------|-----------|
| Main Contribution | `src/extension/chatSessions/vscode-node/chatSessions.ts` |

### Claude Code Sessions

| Component | File Path |
|-----------|-----------|
| Agent Manager | `src/extension/agents/claude/node/claudeCodeAgent.ts` |
| Session Service | `src/extension/agents/claude/node/claudeCodeSessionService.ts` |
| SDK Service | `src/extension/agents/claude/node/claudeCodeSdkService.ts` |
| Item Provider | `src/extension/chatSessions/vscode-node/claudeChatSessionItemProvider.ts` |
| Content Provider | `src/extension/chatSessions/vscode-node/claudeChatSessionContentProvider.ts` |
| Participant | `src/extension/chatSessions/vscode-node/claudeChatSessionParticipant.ts` |
| Tools | `src/extension/agents/claude/common/claudeTools.ts` |

### Copilot CLI Sessions

| Component | File Path |
|-----------|-----------|
| Contribution | `src/extension/chatSessions/vscode-node/copilotCLIChatSessionsContribution.ts` |
| Session Service | `src/extension/agents/copilotcli/node/copilotcliSessionService.ts` |
| Session Wrapper | `src/extension/agents/copilotcli/node/copilotcliSession.ts` |
| SDK Service | `src/extension/agents/copilotcli/node/copilotCli.ts` |
| Terminal Integration | `src/extension/chatSessions/vscode-node/copilotCLITerminalIntegration.ts` |
| Tool Formatter | `src/extension/agents/copilotcli/node/copilotcliToolInvocationFormatter.ts` |
| Permission Helpers | `src/extension/agents/copilotcli/node/permissionHelpers.ts` |
| MCP Handler | `src/extension/agents/copilotcli/node/mcpHandler.ts` |

### Copilot Cloud Sessions

| Component | File Path |
|-----------|-----------|
| Provider | `src/extension/chatSessions/vscode-node/copilotCloudSessionsProvider.ts` |
| Content Builder | `src/extension/chatSessions/vscode-node/copilotCloudSessionContentBuilder.ts` |
| PR Content Provider | `src/extension/chatSessions/vscode-node/prContentProvider.ts` |
| File Changes Service | `src/extension/chatSessions/vscode-node/pullRequestFileChangesService.ts` |

### Shared Infrastructure

| Component | File Path |
|-----------|-----------|
| External Edit Tracker | `src/extension/agents/common/externalEditTracker.ts` |
| Language Model Server | `src/extension/agents/node/langModelServer.ts` |

---

## Commands Reference

### Claude Code Commands

| Command | Description |
|---------|-------------|
| `github.copilot.claude.sessions.refresh` | Refresh Claude session list |

### Copilot CLI Commands

| Command | Description |
|---------|-------------|
| `github.copilot.cli.sessions.refresh` | Refresh CLI session list |
| `github.copilot.cli.sessions.delete` | Delete selected session |
| `github.copilot.cli.sessions.openInTerminal` | Open session in terminal |

### Copilot Cloud Commands

| Command | Description |
|---------|-------------|
| `github.copilot.cloud.sessions.refresh` | Refresh cloud session list |
| `github.copilot.cloud.sessions.openInBrowser` | Open session in browser |
| `github.copilot.cloud.sessions.proxy.closeChatSessionPullRequest` | Close session's PR |

---

*End of Knowledge Base Document*
