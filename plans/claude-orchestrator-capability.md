# Claude Code as Orchestrator - Implementation Plan

**Date:** 2025-12-16
**Status:** Ready for Implementation
**Type:** Enhancement
**Estimated Effort:** 7-8 days

## Executive Summary

This document details how to enable Claude Code to act as a full orchestrator capable of spawning and coordinating subtasks.

**Key Finding:** The Claude Agent SDK provides `createSdkMcpServer()` which creates an **in-process MCP server**. Tool handlers execute in the same Node.js process as our VS Code extension, giving them direct access to all services (SubTaskManager, SafetyLimitsService, etc.) via closure/DI. This makes the implementation straightforward.

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         VS Code Extension                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │              OrchestratorServiceV2 (Copilot-based)              │   │
│  │                                                                  │   │
│  │  • Plans tasks, manages dependencies                            │   │
│  │  • Creates worktrees via git                                    │   │
│  │  • Spawns WorkerSessions                                        │   │
│  │  • Routes messages between workers                              │   │
│  │  • Manages task completion and merging                          │   │
│  └──────────────────────────┬──────────────────────────────────────┘   │
│                             │                                           │
│              ┌──────────────┴──────────────┐                           │
│              ▼                              ▼                           │
│  ┌─────────────────────────┐   ┌─────────────────────────┐            │
│  │  CopilotAgentExecutor   │   │  ClaudeCodeAgentExecutor │            │
│  │                         │   │                          │            │
│  │  Tools Available:       │   │  Tools Available:        │            │
│  │  • a2a_spawn_subtask    │   │  • /architect            │            │
│  │  • a2a_spawn_parallel   │   │  • /review               │            │
│  │  • a2a_await_subtasks   │   │  • Claude SDK tools      │            │
│  │  • a2a_notify_orch...   │   │    (Bash, Read, Edit...) │            │
│  │  • orchestrator_*       │   │                          │            │
│  │  • All Copilot tools    │   │  Missing:                │            │
│  │                         │   │  • a2a_spawn_subtask ❌   │            │
│  │                         │   │  • orchestrator_* ❌      │            │
│  └─────────────────────────┘   └─────────────────────────┘            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Gap Analysis

### What Claude Code Currently Has

| Capability | Status | Implementation |
|------------|--------|----------------|
| Task execution | ✅ | `ClaudeCodeSession` via Claude Agent SDK |
| Worktree-scoped sessions | ✅ | `ClaudeWorktreeSession` wrapper |
| Slash commands | ✅ | `/architect`, `/review`, custom via config |
| File operations | ✅ | Read, Edit, Write, Glob, Grep via SDK |
| Terminal commands | ✅ | Bash tool via SDK |
| Permission system | ✅ | `canUseTool()` callback |
| Hook system | ✅ | Pre/Post tool use hooks |

### What Claude Code Is Missing for Orchestration

| Capability | Gap | Complexity |
|------------|-----|------------|
| Spawn subtasks | No `a2a_spawn_subtask` tool | High |
| Parallel subtasks | No `a2a_spawn_parallel_subtasks` tool | High |
| Await subtasks | No `a2a_await_subtasks` tool | Medium |
| List agents | No `a2a_list_specialists` tool | Low |
| Notify orchestrator | No `a2a_notify_orchestrator` tool | Low |
| Pull subtask changes | No `a2a_pull_subtask_changes` tool | Medium |
| Complete subtask | No `a2a_subtask_complete` tool | Medium |

## Implementation Approach: In-Process MCP Server

The Claude Agent SDK provides `createSdkMcpServer()` which allows us to define custom tools that run **in the same process** as our VS Code extension. This is the bridge.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Claude Agent SDK Session                             │
│                                                                         │
│  Options: {                                                            │
│    mcpServers: {                                                       │
│      "a2a": createSdkMcpServer({    ◄── IN-PROCESS MCP SERVER         │
│        name: "a2a-orchestration",                                      │
│        tools: [                                                        │
│          a2a_spawn_subtask,         ◄── Calls SubTaskManager          │
│          a2a_list_agents,           ◄── Calls AgentDiscoveryService   │
│          a2a_await_subtasks,        ◄── Calls TaskMonitorService      │
│          a2a_subtask_complete,      ◄── Commits & signals completion  │
│        ]                                                               │
│      })                                                                │
│    }                                                                   │
│  }                                                                     │
│                                                                         │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ Tool handlers execute in same process
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              VS Code Extension Services (Direct Access)                 │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │
│  │ SubTaskManager  │  │ AgentDiscovery  │  │ SafetyLimits    │        │
│  │                 │  │ Service         │  │ Service         │        │
│  │ • createSubTask │  │ • getAvailable  │  │ • checkDepth    │        │
│  │ • executeSubTask│  │   Agents()      │  │ • checkRate     │        │
│  │ • checkConflicts│  │ • getAgent()    │  │ • checkCycle    │        │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘        │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │
│  │ TaskMonitor     │  │ Orchestrator    │  │ WorkerContext   │        │
│  │ Service         │  │ QueueService    │  │                 │        │
│  │                 │  │                 │  │ • workerId      │        │
│  │ • startMonitor  │  │ • enqueueMsg    │  │ • depth         │        │
│  │ • pollStatus    │  │ • notifyParent  │  │ • spawnContext  │        │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### SDK Extension Point (from `@anthropic-ai/claude-agent-sdk/sdk.d.ts`)

```typescript
// Lines 525-543: Define tools with handlers that run in-process
type SdkMcpToolDefinition<Schema> = {
    name: string;
    description: string;
    inputSchema: Schema;  // Zod schema for validation
    handler: (args, extra) => Promise<CallToolResult>;  // Runs in extension process
};

// Create MCP server - tools execute in same Node.js process
export declare function createSdkMcpServer(options: {
    name: string;
    tools?: Array<SdkMcpToolDefinition<any>>;
}): McpSdkServerConfigWithInstance;

// Attach to Claude session via Options
export type Options = {
    mcpServers?: Record<string, McpServerConfig>;  // Line 584
    // ...
};
```

---

## Detailed Implementation

### Phase 1: Create A2A MCP Server Factory

**File:** `src/extension/agents/claude/node/claudeA2AMcpServer.ts` (new)

This factory creates the in-process MCP server with all A2A tools.

```typescript
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { ISubTaskManager, ISubTaskCreateOptions } from '../../../orchestrator/orchestratorInterfaces';
import { IAgentDiscoveryService } from '../../../orchestrator/agentDiscoveryService';
import { ISafetyLimitsService } from '../../../orchestrator/safetyLimits';
import { IWorkerContext } from '../../../orchestrator/workerToolsService';
import { ITaskMonitorService } from '../../../orchestrator/taskMonitorService';

export interface IA2AMcpServerDependencies {
  subTaskManager: ISubTaskManager;
  agentDiscoveryService: IAgentDiscoveryService;
  safetyLimitsService: ISafetyLimitsService;
  taskMonitorService: ITaskMonitorService;
  workerContext: IWorkerContext;
}

export function createA2AMcpServer(deps: IA2AMcpServerDependencies) {
  return createSdkMcpServer({
    name: 'a2a-orchestration',
    tools: [
      // Tool definitions below...
    ]
  });
}
```

### Phase 1.1: `a2a_spawn_subtask` Tool

```typescript
tool(
  'a2a_spawn_subtask',
  'Spawn a subtask to delegate work to another agent. The subtask runs in an isolated worktree.',
  {
    agentType: z.string().describe('Agent to execute (@architect, @reviewer, or custom)'),
    prompt: z.string().describe('Task instruction for the agent'),
    expectedOutput: z.string().describe('Description of expected output'),
    targetFiles: z.array(z.string()).optional().describe('Files to be modified'),
    blocking: z.boolean().default(true).describe('Wait for completion'),
    model: z.string().optional().describe('Model override'),
  },
  async (args) => {
    const { subTaskManager, workerContext, safetyLimitsService } = deps;

    // Check depth limit
    const maxDepth = safetyLimitsService.getMaxDepthForContext(workerContext.spawnContext);
    if (workerContext.depth >= maxDepth) {
      return {
        content: [{ type: 'text', text: `ERROR: Maximum depth ${maxDepth} reached. Cannot spawn subtask.` }]
      };
    }

    // Create subtask
    const options: ISubTaskCreateOptions = {
      parentWorkerId: workerContext.workerId,
      parentTaskId: workerContext.taskId ?? workerContext.workerId,
      planId: workerContext.planId ?? 'claude-session',
      worktreePath: workerContext.worktreePath,
      agentType: args.agentType,
      prompt: args.prompt,
      expectedOutput: args.expectedOutput,
      targetFiles: args.targetFiles,
      model: args.model,
      currentDepth: workerContext.depth,
      spawnContext: workerContext.spawnContext,
    };

    const subtask = subTaskManager.createSubTask(options);

    if (args.blocking) {
      const result = await subTaskManager.executeSubTask(subtask.id, CancellationToken.None);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    } else {
      // Non-blocking: return task ID for later polling
      return {
        content: [{ type: 'text', text: JSON.stringify({ taskId: subtask.id, status: 'spawned' }) }]
      };
    }
  }
)
```

### Phase 1.2: `a2a_list_agents` Tool

```typescript
tool(
  'a2a_list_agents',
  'List available agents that can be spawned as subtasks',
  {
    filter: z.enum(['all', 'specialists', 'custom']).default('all'),
  },
  async (args) => {
    const { agentDiscoveryService } = deps;
    const agents = await agentDiscoveryService.getAvailableAgents();

    const filtered = args.filter === 'all'
      ? agents
      : args.filter === 'custom'
        ? agents.filter(a => a.source === 'repo')
        : agents.filter(a => a.source === 'builtin' && a.id !== 'agent');

    const formatted = filtered.map(a => ({
      id: a.id,
      name: a.name,
      description: a.description,
      backend: a.backend ?? 'copilot',
      tools: a.tools,
    }));

    return {
      content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }]
    };
  }
)
```

### Phase 1.3: `a2a_await_subtasks` Tool

```typescript
tool(
  'a2a_await_subtasks',
  'Wait for previously spawned non-blocking subtasks to complete',
  {
    taskIds: z.array(z.string()).describe('Task IDs to wait for'),
    timeout: z.number().default(300000).describe('Max wait time in ms'),
  },
  async (args) => {
    const { subTaskManager } = deps;
    const results: ISubTaskResult[] = [];

    for (const taskId of args.taskIds) {
      const subtask = subTaskManager.getSubTask(taskId);
      if (!subtask) {
        results.push({ taskId, status: 'failed', output: '', error: 'Task not found' });
        continue;
      }

      // Poll until complete or timeout
      const startTime = Date.now();
      while (subtask.status === 'pending' || subtask.status === 'running') {
        if (Date.now() - startTime > args.timeout) {
          results.push({ taskId, status: 'timeout', output: '' });
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (subtask.result) {
        results.push(subtask.result);
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
    };
  }
)
```

### Phase 1.4: `a2a_subtask_complete` Tool

```typescript
tool(
  'a2a_subtask_complete',
  'Signal that subtask work is complete. MUST include commitMessage to save changes.',
  {
    commitMessage: z.string().describe('REQUIRED: Git commit message for changes'),
    output: z.string().describe('Summary of work completed'),
    status: z.enum(['success', 'partial', 'failed']).default('success'),
  },
  async (args) => {
    const { subTaskManager, workerContext } = deps;

    if (!args.commitMessage || args.commitMessage.trim().length === 0) {
      return {
        content: [{ type: 'text', text: 'ERROR: commitMessage is REQUIRED. Changes will be LOST without it.' }]
      };
    }

    // Update subtask status
    subTaskManager.updateStatus(workerContext.taskId!, args.status === 'success' ? 'completed' : 'failed', {
      taskId: workerContext.taskId!,
      status: args.status,
      output: args.output,
      metadata: { commitMessage: args.commitMessage }
    });

    return {
      content: [{ type: 'text', text: `Subtask completed with status: ${args.status}` }]
    };
  }
)
```

---

### Phase 2: Wire MCP Server into ClaudeCodeSession

**File:** `src/extension/agents/claude/node/claudeCodeAgent.ts`

Update `ClaudeCodeSession` to inject dependencies and create the A2A MCP server.

#### 2.1 Add Dependencies to Constructor

```typescript
export class ClaudeCodeSession extends Disposable {
  constructor(
    private readonly serverConfig: ILanguageModelServerConfig,
    public sessionId: string | undefined,
    @ILogService private readonly logService: ILogService,
    // ... existing deps ...

    // NEW: A2A dependencies
    @ISubTaskManager private readonly subTaskManager: ISubTaskManager,
    @IAgentDiscoveryService private readonly agentDiscoveryService: IAgentDiscoveryService,
    @ISafetyLimitsService private readonly safetyLimitsService: ISafetyLimitsService,
    @ITaskMonitorService private readonly taskMonitorService: ITaskMonitorService,
  ) {
    super();
  }
```

#### 2.2 Create MCP Server in `_startSession()`

```typescript
private async _startSession(token: vscode.CancellationToken): Promise<void> {
  // Create A2A MCP server with injected dependencies
  const a2aMcpServer = createA2AMcpServer({
    subTaskManager: this.subTaskManager,
    agentDiscoveryService: this.agentDiscoveryService,
    safetyLimitsService: this.safetyLimitsService,
    taskMonitorService: this.taskMonitorService,
    workerContext: this._workerContext,  // Set when session is created for a worktree
  });

  const options: Options = {
    cwd: this.workspaceService.getWorkspaceFolders().at(0)?.fsPath,
    abortController: this._abortController,
    // ... existing options ...

    // NEW: Attach A2A MCP server
    mcpServers: {
      'a2a': a2aMcpServer
    },

    hooks: {
      PreToolUse: [
        // ... existing hooks ...
      ],
      PostToolUse: [
        // ... existing hooks ...
      ],
    },
    // ... rest of options ...
  };
}
```

#### 2.3 Add Worker Context Property

```typescript
export class ClaudeCodeSession extends Disposable {
  private _workerContext: IWorkerContext | undefined;

  /**
   * Set worker context for A2A operations.
   * Call this before starting the session when executing in a worktree context.
   */
  public setWorkerContext(context: IWorkerContext): void {
    this._workerContext = context;
  }
}
```

---

### Phase 3: Pass Worker Context from Executor

**File:** `src/extension/orchestrator/executors/claudeCodeAgentExecutor.ts`

Update executor to create and pass worker context when spawning Claude sessions.

```typescript
async execute(params: AgentExecuteParams, stream?: vscode.ChatResponseStream): Promise<AgentExecuteResult> {
  const { taskId, prompt, worktreePath, agentType, token } = params;

  // Create worker context for A2A operations
  const workerContext: IWorkerContext = {
    _serviceBrand: undefined,
    workerId: taskId,
    worktreePath: worktreePath,
    taskId: taskId,
    planId: params.planId,
    depth: params.depth ?? 0,
    spawnContext: params.spawnContext ?? 'agent',
    owner: params.parentWorkerId ? {
      ownerType: 'worker',
      ownerId: params.parentWorkerId
    } : undefined
  };

  // Get or create session
  const session = await this._claudeAgentManager.getOrCreateWorktreeSession(worktreePath);

  // Set worker context for A2A tools
  session.session.setWorkerContext(workerContext);

  // ... rest of execution
}
```

**Note:** Services like `ISubTaskManager`, `IAgentDiscoveryService`, etc. are already registered globally in `services.ts` and will be injected into `ClaudeCodeSession` via the instantiation service.

---

### Phase 4: Safety & Testing

Safety is **already handled** by the existing `SubTaskManager` and `SafetyLimitsService`. The MCP tool handlers simply call these services, which enforce:

| Constraint | Service | Enforcement |
|------------|---------|-------------|
| Depth limits | `SafetyLimitsService` | `getMaxDepthForContext()` - max 2 for orchestrator, max 1 for agent |
| Rate limits | `SafetyLimitsService` | 100 spawns/minute per worker |
| Total limits | `SafetyLimitsService` | 100 subtasks per worker lifetime |
| Parallel limits | `SafetyLimitsService` | 20 concurrent subtasks max |
| Cycle detection | `SubTaskManager` | Tracks (workerId, agentType, promptHash) tuples |

**Testing requirements:**
- Unit tests for each MCP tool handler
- Integration test: Claude spawns a Copilot subtask
- Integration test: Claude spawns another Claude subtask
- Integration test: Verify depth limits are enforced
- Integration test: Verify rate limits are enforced

---

## Effort Estimation (Revised)

| Phase | Component | Estimated Effort |
|-------|-----------|------------------|
| 1 | Create `claudeA2AMcpServer.ts` with 4 tools | 2-3 days |
| 2 | Wire MCP server into `ClaudeCodeSession` | 1 day |
| 3 | Pass worker context from `ClaudeCodeAgentExecutor` | 0.5 days |
| 4 | Testing & integration | 2-3 days |
| - | Documentation updates | 0.5 days |
| **Total** | | **~7-8 days** |

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| SDK MCP server timeout (>60s for long subtasks) | Medium | Medium | Set `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` env var |
| Worker context not available when standalone | Low | Low | Provide sensible defaults in tool handlers |
| Cross-backend subtask routing | Medium | Medium | Use existing `BackendSelectionService` |

---

## Decision

**Approach: In-Process MCP Server**

This approach leverages the SDK's built-in extensibility:
- `createSdkMcpServer()` creates tools that run in our process
- Tool handlers have direct access to all extension services via closure
- Reuses all existing safety infrastructure (SubTaskManager, SafetyLimits)
- No external HTTP servers or IPC needed
- Consistent behavior across backends

---

## Next Steps

1. **Create `claudeA2AMcpServer.ts`** - Start with `a2a_list_agents` as simplest POC
2. **Wire into ClaudeCodeSession** - Add mcpServers to Options
3. **Test depth limiting** - Verify safety limits work end-to-end
4. **Document A2A capabilities** - Update docs/a2a-configuration.md

---

## References

### Files to Create

| File | Purpose |
|------|---------|
| `src/extension/agents/claude/node/claudeA2AMcpServer.ts` | **NEW** - A2A MCP server factory with tool definitions |

### Existing Files to Modify

| File | Purpose |
|------|---------|
| `src/extension/agents/claude/node/claudeCodeAgent.ts` | Add MCP server to Options, add setWorkerContext() |
| `src/extension/orchestrator/executors/claudeCodeAgentExecutor.ts` | Create and pass worker context |

### Reference Files (Read-only)

| File | Purpose |
|------|---------|
| `src/extension/tools/node/a2aTools.ts` | Existing A2A tool implementations (pattern reference) |
| `src/extension/orchestrator/subTaskManager.ts` | Subtask lifecycle management |
| `src/extension/orchestrator/safetyLimits.ts` | Safety enforcement |
| `src/extension/orchestrator/workerToolsService.ts` | Worker context definitions |
| `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` | SDK types for MCP server |

### Key Interfaces

- `ISubTaskManager` - `orchestratorInterfaces.ts:134`
- `ISubTaskCreateOptions` - `orchestratorInterfaces.ts:195`
- `ISafetyLimitsConfig` - `safetyLimits.ts:25`
- `IWorkerContext` - `workerToolsService.ts:97`
- `createSdkMcpServer` - `@anthropic-ai/claude-agent-sdk/sdk.d.ts:543`
- `tool` (MCP tool helper) - `@anthropic-ai/claude-agent-sdk/sdk.d.ts:531`
