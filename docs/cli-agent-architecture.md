# CLI Agent Integration Architecture

**Status:** Draft
**Date:** December 3, 2025
**Task:** design-cli-agent-architecture

## Executive Summary

This document defines the architecture for integrating external CLI agents (GitHub Copilot CLI, OpenAI Codex CLI, Claude Code, Gemini CLI) as worker executors within the VS Code Copilot Chat orchestrator system. This enables the orchestrator to delegate tasks to specialized CLI agents while maintaining unified coordination, event handling, and user experience.

---

## Table of Contents

1. [Goals & Non-Goals](#goals--non-goals)
2. [Architecture Overview](#architecture-overview)
3. [Core Abstractions](#core-abstractions)
4. [CLI Agent Adapters](#cli-agent-adapters)
5. [Process Management](#process-management)
6. [Event Normalization](#event-normalization)
7. [Session Management](#session-management)
8. [Authentication](#authentication)
9. [Tool Permission Model](#tool-permission-model)
10. [Error Handling & Recovery](#error-handling--recovery)
11. [Implementation Plan](#implementation-plan)

---

## Goals & Non-Goals

### Goals

1. **Unified Worker Interface** - CLI agents appear as workers alongside the built-in VS Code agent
2. **Event-Driven Integration** - Stream events from CLI agents into the orchestrator event system
3. **Session Continuity** - Support multi-turn conversations with CLI agents across tasks
4. **Graceful Degradation** - Handle CLI agent unavailability without breaking workflows
5. **Configuration-Driven** - Users can configure which CLI agents are available and their settings

### Non-Goals

1. **Building CLI agents** - We integrate existing agents, not create new ones
2. **Cross-agent state sharing** - Each agent maintains its own context
3. **Real-time agent switching** - Mid-task agent changes not supported
4. **GUI for CLI agents** - They run headless; UI is through VS Code chat

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ORCHESTRATOR SERVICE                                 │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                      WORKER EXECUTOR REGISTRY                        │   │
│   │                                                                     │   │
│   │   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │   │
│   │   │  VSCode     │ │  Copilot    │ │   Codex     │ │   Claude    │   │   │
│   │   │  Agent      │ │    CLI      │ │    CLI      │ │    Code     │   │   │
│   │   │  Executor   │ │  Adapter    │ │  Adapter    │ │  Adapter    │   │   │
│   │   └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘   │   │
│   │          │               │               │               │          │   │
│   └──────────┼───────────────┼───────────────┼───────────────┼──────────┘   │
│              │               │               │               │              │
│              ▼               ▼               ▼               ▼              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    UNIFIED EVENT STREAM                             │   │
│   │                                                                     │   │
│   │   task.started | message | tool_call | file_change | completed      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
                                     ▼
                          ┌───────────────────┐
                          │   Worker Session  │
                          │   (Dashboard UI)  │
                          └───────────────────┘
```

### Key Design Decisions

1. **Adapter Pattern** - Each CLI agent has an adapter implementing `IWorkerExecutor`
2. **Process Isolation** - CLI agents run as child processes, not in-process
3. **Event Translation** - Agent-specific events normalized to common format
4. **Streaming First** - All agents must support streaming output (JSON preferred)

---

## Core Abstractions

### IWorkerExecutor Interface

```typescript
/**
 * Executor that can run agent tasks. Implementations include:
 * - VSCodeAgentExecutor (built-in, uses IAgentRunner)
 * - CLIAgentExecutor (external CLI agents)
 */
interface IWorkerExecutor {
  readonly id: string;
  readonly name: string;
  readonly type: 'vscode' | 'cli';

  /**
   * Check if this executor is available (CLI installed, authenticated, etc.)
   */
  isAvailable(): Promise<boolean>;

  /**
   * Execute a task, streaming events back
   */
  execute(options: ExecutorOptions): AsyncIterable<WorkerEvent>;

  /**
   * Send a follow-up message to an ongoing session
   */
  sendMessage(sessionId: string, message: string): Promise<void>;

  /**
   * Cancel an ongoing execution
   */
  cancel(sessionId: string): Promise<void>;

  /**
   * Clean up resources for a session
   */
  dispose(sessionId: string): Promise<void>;
}

interface ExecutorOptions {
  /** Unique session ID for multi-turn */
  sessionId: string;

  /** The task prompt/instruction */
  prompt: string;

  /** Working directory for the agent */
  workingDirectory: string;

  /** Additional directories to include */
  additionalDirectories?: string[];

  /** Tool permissions */
  permissions?: ToolPermissions;

  /** Maximum iterations/turns */
  maxTurns?: number;

  /** Timeout in milliseconds */
  timeout?: number;

  /** Resume from previous session */
  resumeSessionId?: string;
}
```

### WorkerEvent Types

```typescript
/**
 * Normalized events from any agent (VS Code or CLI)
 */
type WorkerEvent =
  | { type: 'started'; sessionId: string; timestamp: number }
  | { type: 'message'; content: string; partial?: boolean }
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; name: string; input: unknown; output?: unknown }
  | { type: 'file_read'; path: string }
  | { type: 'file_change'; path: string; diff?: string }
  | { type: 'command'; command: string; output?: string; exitCode?: number }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'approval_needed'; id: string; description: string; options: string[] }
  | { type: 'completed'; summary?: string }
  | { type: 'cancelled' };
```

### IWorkerExecutorRegistry

```typescript
interface IWorkerExecutorRegistry {
  /**
   * Register an executor
   */
  register(executor: IWorkerExecutor): void;

  /**
   * Get executor by ID
   */
  get(id: string): IWorkerExecutor | undefined;

  /**
   * Get all available executors
   */
  getAvailable(): Promise<IWorkerExecutor[]>;

  /**
   * Get executor for a specific agent type
   */
  getForAgent(agentId: string): IWorkerExecutor | undefined;
}
```

---

## CLI Agent Adapters

### Base CLI Adapter

```typescript
abstract class CLIAgentAdapter implements IWorkerExecutor {
  readonly type = 'cli' as const;

  protected abstract readonly command: string;
  protected abstract readonly executableName: string;

  constructor(
    protected readonly processManager: IProcessManager,
    protected readonly eventParser: IEventParser,
    protected readonly authProvider: ICLIAuthProvider,
  ) {}

  async isAvailable(): Promise<boolean> {
    // Check if CLI is installed
    const installed = await this.processManager.isInstalled(this.executableName);
    if (!installed) return false;

    // Check authentication
    return this.authProvider.isAuthenticated();
  }

  async *execute(options: ExecutorOptions): AsyncIterable<WorkerEvent> {
    const args = this.buildArgs(options);
    const process = this.processManager.spawn(this.command, args, {
      cwd: options.workingDirectory,
      env: await this.getEnvironment(),
    });

    yield { type: 'started', sessionId: options.sessionId, timestamp: Date.now() };

    for await (const line of process.stdout) {
      const event = this.eventParser.parse(line);
      if (event) yield event;
    }

    const exitCode = await process.wait();
    if (exitCode !== 0) {
      yield { type: 'error', message: `Process exited with code ${exitCode}`, recoverable: false };
    }

    yield { type: 'completed' };
  }

  protected abstract buildArgs(options: ExecutorOptions): string[];
  protected abstract getEnvironment(): Promise<Record<string, string>>;
}
```

### Copilot CLI Adapter

```typescript
class CopilotCLIAdapter extends CLIAgentAdapter {
  readonly id = 'copilot-cli';
  readonly name = 'GitHub Copilot CLI';
  protected readonly command = 'copilot';
  protected readonly executableName = 'copilot';

  protected buildArgs(options: ExecutorOptions): string[] {
    const args: string[] = ['-p', options.prompt];

    // Resume session if specified
    if (options.resumeSessionId) {
      args.unshift('--resume', options.resumeSessionId);
    }

    // Tool permissions
    if (options.permissions?.allowAll) {
      args.push('--allow-all-tools');
    } else if (options.permissions?.denied?.length) {
      for (const tool of options.permissions.denied) {
        args.push('--deny-tool', tool);
      }
    }

    return args;
  }

  protected async getEnvironment(): Promise<Record<string, string>> {
    return {
      ...process.env,
      // Copilot CLI uses GitHub OAuth, credentials in ~/.copilot
    };
  }
}
```

### Codex CLI Adapter

```typescript
class CodexCLIAdapter extends CLIAgentAdapter {
  readonly id = 'codex-cli';
  readonly name = 'OpenAI Codex CLI';
  protected readonly command = 'codex';
  protected readonly executableName = 'codex';

  protected buildArgs(options: ExecutorOptions): string[] {
    const args: string[] = [
      'exec',
      '--json',  // JSONL streaming output
      options.prompt,
    ];

    // Working directory
    args.push('--cd', options.workingDirectory);

    // Additional directories
    if (options.additionalDirectories?.length) {
      for (const dir of options.additionalDirectories) {
        args.push('--add-dir', dir);
      }
    }

    // Max turns
    if (options.maxTurns) {
      args.push('--max-turns', String(options.maxTurns));
    }

    // Permissions via sandbox mode
    if (options.permissions?.allowAll) {
      args.push('--full-auto');
    }

    // Resume
    if (options.resumeSessionId) {
      args.unshift('resume', '--last');
    }

    return args;
  }

  protected async getEnvironment(): Promise<Record<string, string>> {
    const apiKey = await this.authProvider.getCredential('OPENAI_API_KEY');
    return {
      ...process.env,
      OPENAI_API_KEY: apiKey || '',
    };
  }
}
```

### Claude Code Adapter

```typescript
class ClaudeCodeAdapter extends CLIAgentAdapter {
  readonly id = 'claude-code';
  readonly name = 'Claude Code';
  protected readonly command = 'claude';
  protected readonly executableName = 'claude';

  protected buildArgs(options: ExecutorOptions): string[] {
    const args: string[] = [
      '-p',  // Print mode (non-interactive)
      '--output-format', 'stream-json',  // Streaming JSON
      options.prompt,
    ];

    // Max turns
    if (options.maxTurns) {
      args.push('--max-turns', String(options.maxTurns));
    }

    // Tool permissions
    if (options.permissions?.allowed?.length) {
      args.push('--allowedTools', options.permissions.allowed.join(','));
    }
    if (options.permissions?.denied?.length) {
      args.push('--disallowedTools', options.permissions.denied.join(','));
    }
    if (options.permissions?.allowAll) {
      args.push('--dangerously-skip-permissions');
    }

    // Additional directories
    if (options.additionalDirectories?.length) {
      for (const dir of options.additionalDirectories) {
        args.push('--add-dir', dir);
      }
    }

    // Resume
    if (options.resumeSessionId) {
      args.unshift('-r', options.resumeSessionId);
    }

    return args;
  }

  protected async getEnvironment(): Promise<Record<string, string>> {
    // Claude Code supports multiple auth methods
    return {
      ...process.env,
      // OAuth handled by CLI's own login flow
    };
  }
}
```

### Gemini CLI Adapter

```typescript
class GeminiCLIAdapter extends CLIAgentAdapter {
  readonly id = 'gemini-cli';
  readonly name = 'Gemini CLI';
  protected readonly command = 'gemini';
  protected readonly executableName = 'gemini';

  protected buildArgs(options: ExecutorOptions): string[] {
    const args: string[] = [
      '-p', options.prompt,
      '--output-format', 'stream-json',
    ];

    // Additional directories
    if (options.additionalDirectories?.length) {
      args.push('--include-directories', options.additionalDirectories.join(','));
    }

    return args;
  }

  protected async getEnvironment(): Promise<Record<string, string>> {
    const apiKey = await this.authProvider.getCredential('GEMINI_API_KEY');
    return {
      ...process.env,
      GEMINI_API_KEY: apiKey || '',
    };
  }
}
```

---

## Process Management

### IProcessManager Interface

```typescript
interface IProcessManager {
  /**
   * Check if an executable is installed and accessible
   */
  isInstalled(executable: string): Promise<boolean>;

  /**
   * Spawn a child process with streaming I/O
   */
  spawn(command: string, args: string[], options: SpawnOptions): IManagedProcess;

  /**
   * Kill all processes for a session
   */
  killSession(sessionId: string): Promise<void>;
}

interface IManagedProcess {
  readonly pid: number;
  readonly stdout: AsyncIterable<string>;
  readonly stderr: AsyncIterable<string>;

  /**
   * Write to stdin
   */
  write(data: string): void;

  /**
   * Wait for process to exit
   */
  wait(): Promise<number>;

  /**
   * Kill the process
   */
  kill(signal?: NodeJS.Signals): void;
}

interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  sessionId?: string;
}
```

### Implementation Notes

```typescript
class ProcessManager implements IProcessManager {
  private readonly _processes = new Map<string, IManagedProcess[]>();

  async isInstalled(executable: string): Promise<boolean> {
    try {
      // Use 'which' on Unix, 'where' on Windows
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      await execPromise(`${cmd} ${executable}`);
      return true;
    } catch {
      return false;
    }
  }

  spawn(command: string, args: string[], options: SpawnOptions): IManagedProcess {
    const proc = cp.spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const managed = new ManagedProcess(proc);

    // Track by session
    if (options.sessionId) {
      const sessionProcs = this._processes.get(options.sessionId) || [];
      sessionProcs.push(managed);
      this._processes.set(options.sessionId, sessionProcs);
    }

    // Auto-kill on timeout
    if (options.timeout) {
      setTimeout(() => managed.kill('SIGTERM'), options.timeout);
    }

    return managed;
  }

  async killSession(sessionId: string): Promise<void> {
    const procs = this._processes.get(sessionId);
    if (procs) {
      for (const proc of procs) {
        proc.kill('SIGTERM');
      }
      this._processes.delete(sessionId);
    }
  }
}
```

---

## Event Normalization

Each CLI agent outputs events in different formats. We normalize them:

### IEventParser Interface

```typescript
interface IEventParser {
  /**
   * Parse a line of output into a WorkerEvent
   * Returns undefined if the line is not a recognized event
   */
  parse(line: string): WorkerEvent | undefined;
}
```

### Codex Event Parser

Codex outputs JSONL with specific event types:

```typescript
class CodexEventParser implements IEventParser {
  parse(line: string): WorkerEvent | undefined {
    try {
      const event = JSON.parse(line);

      switch (event.type) {
        case 'thread.started':
          return { type: 'started', sessionId: event.thread_id, timestamp: Date.now() };

        case 'item.updated':
          return this.parseItem(event.item);

        case 'turn.completed':
          return { type: 'completed', summary: event.summary };

        case 'turn.failed':
        case 'error':
          return { type: 'error', message: event.message, recoverable: event.type === 'turn.failed' };

        default:
          return undefined;
      }
    } catch {
      // Not JSON, might be plain text
      return { type: 'message', content: line };
    }
  }

  private parseItem(item: any): WorkerEvent | undefined {
    switch (item.type) {
      case 'agent_message':
        return { type: 'message', content: item.content, partial: !item.complete };

      case 'reasoning':
        return { type: 'thinking', content: item.content };

      case 'command_execution':
        return {
          type: 'command',
          command: item.command,
          output: item.output,
          exitCode: item.exit_code,
        };

      case 'file_change':
        return { type: 'file_change', path: item.path, diff: item.diff };

      case 'mcp_tool_call':
        return { type: 'tool_call', name: item.tool, input: item.input, output: item.output };

      default:
        return undefined;
    }
  }
}
```

### Claude Code Event Parser

```typescript
class ClaudeCodeEventParser implements IEventParser {
  parse(line: string): WorkerEvent | undefined {
    try {
      const event = JSON.parse(line);

      // Claude Code stream-json format
      switch (event.type) {
        case 'message':
          if (event.role === 'assistant') {
            return { type: 'message', content: event.content, partial: event.partial };
          }
          break;

        case 'tool_use':
          return { type: 'tool_call', name: event.name, input: event.input };

        case 'tool_result':
          return { type: 'tool_call', name: event.name, input: undefined, output: event.content };

        case 'error':
          return { type: 'error', message: event.message, recoverable: false };

        case 'done':
          return { type: 'completed' };
      }
    } catch {
      return { type: 'message', content: line };
    }
    return undefined;
  }
}
```

---

## Session Management

### CLI Session State

```typescript
interface CLISessionState {
  /** External session ID from CLI agent */
  externalSessionId?: string;

  /** Our internal session ID */
  sessionId: string;

  /** Which executor is handling this session */
  executorId: string;

  /** Working directory */
  workingDirectory: string;

  /** Conversation history (for agents without session support) */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;

  /** Last activity timestamp */
  lastActivityAt: number;
}
```

### Session Resume Strategy

Different agents have different session capabilities:

| Agent | Session Storage | Resume Method |
|-------|-----------------|---------------|
| Copilot CLI | `~/.copilot/sessions/` | `--resume <id>` or `--continue` |
| Codex CLI | `~/.codex/sessions/` | `resume <id>` or `resume --last` |
| Claude Code | Internal | `-r <id>` or `-c` |
| Gemini CLI | Checkpoints | Custom handling |

```typescript
class CLISessionManager {
  private readonly _sessions = new Map<string, CLISessionState>();

  async resumeSession(sessionId: string, executor: IWorkerExecutor): Promise<ExecutorOptions> {
    const state = this._sessions.get(sessionId);
    if (!state) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return {
      sessionId: state.sessionId,
      prompt: '', // Will be set by caller
      workingDirectory: state.workingDirectory,
      resumeSessionId: state.externalSessionId,
    };
  }

  updateSession(sessionId: string, externalId: string): void {
    const state = this._sessions.get(sessionId);
    if (state) {
      state.externalSessionId = externalId;
      state.lastActivityAt = Date.now();
    }
  }
}
```

---

## Authentication

### ICLIAuthProvider Interface

```typescript
interface ICLIAuthProvider {
  /**
   * Check if authenticated with the CLI agent
   */
  isAuthenticated(): Promise<boolean>;

  /**
   * Get a credential (API key, token, etc.)
   */
  getCredential(name: string): Promise<string | undefined>;

  /**
   * Trigger authentication flow
   */
  authenticate(): Promise<boolean>;
}
```

### Authentication Strategies

```typescript
/**
 * API Key based auth (Codex, Gemini)
 */
class APIKeyAuthProvider implements ICLIAuthProvider {
  constructor(
    private readonly secretStorage: vscode.SecretStorage,
    private readonly keyName: string,
    private readonly envVarName: string,
  ) {}

  async isAuthenticated(): Promise<boolean> {
    // Check env var first
    if (process.env[this.envVarName]) return true;

    // Then secret storage
    const stored = await this.secretStorage.get(this.keyName);
    return !!stored;
  }

  async getCredential(name: string): Promise<string | undefined> {
    if (name !== this.envVarName) return undefined;

    return process.env[this.envVarName] ||
      await this.secretStorage.get(this.keyName);
  }

  async authenticate(): Promise<boolean> {
    // Prompt user for API key
    const key = await vscode.window.showInputBox({
      prompt: `Enter your ${this.keyName}`,
      password: true,
    });

    if (key) {
      await this.secretStorage.store(this.keyName, key);
      return true;
    }
    return false;
  }
}

/**
 * OAuth based auth (Copilot CLI, Claude Code)
 */
class OAuthCLIAuthProvider implements ICLIAuthProvider {
  constructor(
    private readonly command: string,
    private readonly loginCommand: string,
  ) {}

  async isAuthenticated(): Promise<boolean> {
    // Try running a simple command to check auth
    try {
      await execPromise(`${this.command} --version`);
      return true;
    } catch {
      return false;
    }
  }

  async getCredential(): Promise<string | undefined> {
    // OAuth CLIs manage their own credentials
    return undefined;
  }

  async authenticate(): Promise<boolean> {
    // Run the login command in terminal
    const terminal = vscode.window.createTerminal(`${this.command} Login`);
    terminal.sendText(this.loginCommand);
    terminal.show();

    // Wait for user to complete
    const result = await vscode.window.showInformationMessage(
      `Complete the login in the terminal, then click "Done"`,
      'Done', 'Cancel'
    );

    return result === 'Done';
  }
}
```

---

## Tool Permission Model

### ToolPermissions Interface

```typescript
interface ToolPermissions {
  /** Allow all tools without prompting */
  allowAll?: boolean;

  /** Specific tools to allow */
  allowed?: string[];

  /** Specific tools to deny */
  denied?: string[];

  /** Sandbox mode (for Codex) */
  sandboxMode?: 'read-only' | 'full-auto' | 'danger-full-access';
}
```

### Permission Mapping

Each CLI agent has different permission models. We map our unified model:

```typescript
class PermissionMapper {
  mapToCopilotCLI(permissions: ToolPermissions): string[] {
    const args: string[] = [];

    if (permissions.allowAll) {
      args.push('--allow-all-tools');
    }

    if (permissions.allowed?.length) {
      for (const tool of permissions.allowed) {
        args.push('--allow-tool', this.mapToolName(tool, 'copilot'));
      }
    }

    if (permissions.denied?.length) {
      for (const tool of permissions.denied) {
        args.push('--deny-tool', this.mapToolName(tool, 'copilot'));
      }
    }

    return args;
  }

  mapToCodexCLI(permissions: ToolPermissions): string[] {
    const args: string[] = [];

    if (permissions.sandboxMode === 'danger-full-access') {
      args.push('--sandbox', 'danger-full-access');
    } else if (permissions.allowAll || permissions.sandboxMode === 'full-auto') {
      args.push('--full-auto');
    }
    // Codex doesn't support fine-grained tool control in exec mode

    return args;
  }

  mapToClaudeCode(permissions: ToolPermissions): string[] {
    const args: string[] = [];

    if (permissions.allowAll) {
      args.push('--dangerously-skip-permissions');
    }

    if (permissions.allowed?.length) {
      args.push('--allowedTools', permissions.allowed.join(','));
    }

    if (permissions.denied?.length) {
      args.push('--disallowedTools', permissions.denied.join(','));
    }

    return args;
  }

  private mapToolName(tool: string, target: 'copilot' | 'codex' | 'claude'): string {
    // Map generic tool names to agent-specific names
    const mapping: Record<string, Record<string, string>> = {
      'shell': { copilot: 'shell(*)', codex: 'Bash', claude: 'Bash' },
      'file_read': { copilot: 'read', codex: 'Read', claude: 'Read' },
      'file_write': { copilot: 'write', codex: 'Write', claude: 'Write' },
      'git': { copilot: 'shell(git)', codex: 'Bash', claude: 'Bash' },
    };

    return mapping[tool]?.[target] || tool;
  }
}
```

---

## Error Handling & Recovery

### Error Categories

```typescript
enum CLIErrorCategory {
  /** CLI not installed */
  NotInstalled = 'not_installed',

  /** Authentication failed */
  AuthFailed = 'auth_failed',

  /** Rate limited */
  RateLimited = 'rate_limited',

  /** Process crashed */
  ProcessCrash = 'process_crash',

  /** Timeout */
  Timeout = 'timeout',

  /** Network error */
  NetworkError = 'network_error',

  /** Unknown */
  Unknown = 'unknown',
}

interface CLIError {
  category: CLIErrorCategory;
  message: string;
  recoverable: boolean;
  retryAfter?: number;
}
```

### Recovery Strategies

```typescript
class CLIErrorHandler {
  async handle(error: CLIError, executor: IWorkerExecutor, options: ExecutorOptions): Promise<RecoveryAction> {
    switch (error.category) {
      case CLIErrorCategory.NotInstalled:
        return {
          action: 'fallback',
          fallbackExecutor: 'vscode-agent',
          message: `${executor.name} is not installed. Falling back to VS Code agent.`,
        };

      case CLIErrorCategory.AuthFailed:
        const authProvider = this.getAuthProvider(executor.id);
        const authenticated = await authProvider.authenticate();
        if (authenticated) {
          return { action: 'retry' };
        }
        return {
          action: 'fallback',
          fallbackExecutor: 'vscode-agent',
          message: `Authentication failed for ${executor.name}. Falling back to VS Code agent.`,
        };

      case CLIErrorCategory.RateLimited:
        return {
          action: 'retry',
          retryAfter: error.retryAfter || 60000,
          message: `Rate limited. Retrying in ${(error.retryAfter || 60000) / 1000}s...`,
        };

      case CLIErrorCategory.ProcessCrash:
      case CLIErrorCategory.Timeout:
        // Try once more, then fallback
        return {
          action: 'retry',
          maxRetries: 1,
          fallbackOnFailure: 'vscode-agent',
        };

      default:
        return {
          action: 'fail',
          message: error.message,
        };
    }
  }
}

type RecoveryAction =
  | { action: 'retry'; retryAfter?: number; maxRetries?: number; fallbackOnFailure?: string }
  | { action: 'fallback'; fallbackExecutor: string; message: string }
  | { action: 'fail'; message: string };
```

---

## Implementation Plan

### Phase 1: Core Infrastructure

**Files to create:**
- `src/extension/orchestrator/cli/processManager.ts`
- `src/extension/orchestrator/cli/eventParser.ts`
- `src/extension/orchestrator/cli/authProvider.ts`
- `src/extension/orchestrator/cli/types.ts`

**Deliverables:**
- [ ] IWorkerExecutor interface
- [ ] IProcessManager implementation
- [ ] Base CLIAgentAdapter class
- [ ] WorkerEvent type definitions

### Phase 2: CLI Adapters

**Files to create:**
- `src/extension/orchestrator/cli/adapters/copilotCLI.ts`
- `src/extension/orchestrator/cli/adapters/codexCLI.ts`
- `src/extension/orchestrator/cli/adapters/claudeCode.ts`
- `src/extension/orchestrator/cli/adapters/geminiCLI.ts`

**Deliverables:**
- [ ] Copilot CLI adapter + event parser
- [ ] Codex CLI adapter + event parser
- [ ] Claude Code adapter + event parser
- [ ] Gemini CLI adapter + event parser

### Phase 3: Integration

**Files to modify:**
- `src/extension/orchestrator/orchestratorServiceV2.ts`
- `src/extension/orchestrator/workerSession.ts`
- `src/extension/extension/vscode-node/services.ts`

**Deliverables:**
- [ ] WorkerExecutorRegistry service
- [ ] Orchestrator uses executor registry
- [ ] Worker sessions support CLI executors
- [ ] Configuration for available executors

### Phase 4: Authentication & Configuration

**Files to create:**
- `src/extension/orchestrator/cli/authProviders/*.ts`

**Files to modify:**
- `package.json` (settings schema)

**Deliverables:**
- [ ] Auth providers per CLI agent
- [ ] VS Code settings for CLI configuration
- [ ] Secret storage for API keys

### Phase 5: Dashboard Updates

**Files to modify:**
- `src/extension/orchestrator/dashboard/WorkerDashboardV2.ts`

**Deliverables:**
- [ ] Show executor type in worker cards
- [ ] CLI agent status indicators
- [ ] Auth status / login buttons

---

## Configuration Schema

```json
{
  "copilot.orchestrator.cliAgents": {
    "type": "object",
    "properties": {
      "copilotCLI": {
        "type": "object",
        "properties": {
          "enabled": { "type": "boolean", "default": true },
          "path": { "type": "string", "description": "Custom path to copilot executable" }
        }
      },
      "codexCLI": {
        "type": "object",
        "properties": {
          "enabled": { "type": "boolean", "default": false },
          "path": { "type": "string" }
        }
      },
      "claudeCode": {
        "type": "object",
        "properties": {
          "enabled": { "type": "boolean", "default": false },
          "path": { "type": "string" }
        }
      },
      "geminiCLI": {
        "type": "object",
        "properties": {
          "enabled": { "type": "boolean", "default": false },
          "path": { "type": "string" }
        }
      }
    }
  },
  "copilot.orchestrator.defaultExecutor": {
    "type": "string",
    "enum": ["vscode-agent", "copilot-cli", "codex-cli", "claude-code", "gemini-cli"],
    "default": "vscode-agent"
  }
}
```

---

## Success Criteria

1. **Core Infrastructure:** IWorkerExecutor abstraction works with both VS Code agent and CLI agents
2. **CLI Adapters:** At least 2 CLI agents (Copilot CLI + one other) fully integrated
3. **Event Streaming:** Events from CLI agents appear in worker dashboard in real-time
4. **Session Management:** Multi-turn conversations work across task executions
5. **Error Recovery:** Graceful fallback to VS Code agent when CLI unavailable
6. **Configuration:** Users can enable/disable CLI agents via settings

---

*End of CLI Agent Architecture Document*
