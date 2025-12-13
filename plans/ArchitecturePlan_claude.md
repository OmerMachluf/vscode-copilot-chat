# Architecture Plan: Multi-Agent Type Support for A2A & Orchestrator

## Document Information
- **Author**: Architect Agent
- **Date**: December 13, 2025
- **Status**: Draft - Pending Approval
- **Target**: Claude Code Agent Integration (Phase 1 of Multi-Agent Support)

---

## 1. Executive Summary

This plan extends the Agent-to-Agent (A2A) framework and Orchestrator to support multiple agent backend types. The first integration target is **Claude Code** agents, with the architecture designed to accommodate future backends (Background Agents, Cloud Agents, CLI Agents).

### Current State
- A2A spawns sub-agents exclusively via Copilot's `AgentRunner`
- Orchestrator deploys workers using only the default Copilot agent
- Claude Code exists as a standalone session manager without worktree or A2A integration
- No abstraction layer for pluggable agent backends

### Target State
- Unified `IAgentExecutor` abstraction supporting multiple backends
- Agent type routing based on prefixes (`claude:`, `@`, etc.)
- Claude Code sessions running in isolated worktrees
- Inter-agent messaging bridge for cross-backend communication
- Seamless merge integration when Claude Code tasks complete

---

## 2. Problem Statement

### 2.1 Business Need
Users want flexibility in choosing which AI backend executes specific tasks. Claude Code offers different capabilities (slash commands like `/architect`, persistent sessions) that complement Copilot's strengths.

### 2.2 Technical Gap
The current architecture tightly couples task execution to a single agent type:

```
┌─────────────────────────────────────────────────────────────┐
│  CURRENT: Single Agent Path                                 │
├─────────────────────────────────────────────────────────────┤
│  A2A Tools → SubTaskManager → AgentRunner → Copilot Only   │
│  Orchestrator → deploy() → AgentRunner → Copilot Only      │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Requirements
1. **R1**: Support Claude Code as an alternative agent backend
2. **R2**: Maintain full worktree isolation for Claude Code tasks
3. **R3**: Enable inter-agent messaging (Copilot ↔ Claude Code)
4. **R4**: Support Claude Code slash commands (`/architect`, `/review`)
5. **R5**: Integrate with existing merge/commit infrastructure
6. **R6**: Design for extensibility (future agent types)

---

## 3. Proposed Solution

### 3.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PROPOSED ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐     ┌──────────────────────────────────────────────┐ │
│  │  A2A Tools   │────▶│           Agent Type Router                  │ │
│  └──────────────┘     │  ┌─────────────────────────────────────────┐ │ │
│                       │  │ Parse: "claude:agent" → Claude backend  │ │ │
│  ┌──────────────┐     │  │ Parse: "@architect"  → Copilot backend  │ │ │
│  │ Orchestrator │────▶│  │ Parse: "cli:agent"   → CLI backend      │ │ │
│  └──────────────┘     │  └─────────────────────────────────────────┘ │ │
│                       └──────────────────────────────────────────────┘ │
│                                        │                               │
│                                        ▼                               │
│                       ┌──────────────────────────────────────────────┐ │
│                       │         IAgentExecutor Interface             │ │
│                       │  ┌────────────────────────────────────────┐  │ │
│                       │  │ execute(task, worktreePath, options)   │  │ │
│                       │  │ sendMessage(workerId, message)         │  │ │
│                       │  │ cancel(workerId)                       │  │ │
│                       │  │ getStatus(workerId)                    │  │ │
│                       │  └────────────────────────────────────────┘  │ │
│                       └──────────────────────────────────────────────┘ │
│                                        │                               │
│              ┌─────────────────────────┼─────────────────────────┐     │
│              ▼                         ▼                         ▼     │
│  ┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐│
│  │ CopilotExecutor   │   │ ClaudeCodeExecutor│   │ Future Executors  ││
│  │ (AgentRunner)     │   │ (ClaudeAgentMgr)  │   │ (CLI, Cloud, etc) ││
│  └───────────────────┘   └───────────────────┘   └───────────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Component Design

#### 3.2.1 Agent Type Parser
Parses agent type strings into backend routing information.

```typescript
// New: src/extension/orchestrator/agentTypeParser.ts

interface ParsedAgentType {
  backend: 'copilot' | 'claude' | 'cli' | 'cloud';
  agentName: string;           // e.g., "architect", "agent", "reviewer"
  slashCommand?: string;       // e.g., "/architect" for Claude
  rawType: string;             // Original string
}

// Parsing rules:
// "claude:architect"  → { backend: 'claude', agentName: 'architect', slashCommand: '/architect' }
// "claude:agent"      → { backend: 'claude', agentName: 'agent' }
// "@architect"        → { backend: 'copilot', agentName: 'architect' }
// "@agent"            → { backend: 'copilot', agentName: 'agent' }
// "cli:agent"         → { backend: 'cli', agentName: 'agent' }
```

#### 3.2.2 Agent Executor Interface

```typescript
// New: src/extension/orchestrator/agentExecutor.ts

interface IAgentExecutor {
  readonly backendType: AgentBackendType;

  /**
   * Execute a task in the specified worktree
   */
  execute(params: AgentExecuteParams): Promise<AgentExecuteResult>;

  /**
   * Send a message to a running worker
   */
  sendMessage(workerId: string, message: string): Promise<void>;

  /**
   * Cancel a running worker
   */
  cancel(workerId: string): Promise<void>;

  /**
   * Get status of a worker
   */
  getStatus(workerId: string): AgentWorkerStatus;

  /**
   * Check if this executor supports the given agent type
   */
  supports(parsedType: ParsedAgentType): boolean;
}

interface AgentExecuteParams {
  taskId: string;
  prompt: string;
  worktreePath: string;
  agentType: ParsedAgentType;
  parentWorkerId?: string;
  expectedOutput?: string;
  targetFiles?: string[];
  options?: AgentExecuteOptions;
}

interface AgentExecuteResult {
  status: 'success' | 'partial' | 'failed';
  output: string;
  filesChanged?: string[];
  error?: string;
  metadata?: Record<string, unknown>;
}
```

#### 3.2.3 Claude Code Executor

```typescript
// New: src/extension/orchestrator/executors/claudeCodeAgentExecutor.ts

class ClaudeCodeAgentExecutor implements IAgentExecutor {
  readonly backendType = 'claude';

  private readonly _claudeManager: ClaudeAgentManager;
  private readonly _activeSessions: Map<string, ClaudeCodeSession>;

  async execute(params: AgentExecuteParams): Promise<AgentExecuteResult> {
    // 1. Create/reuse Claude session for worktree
    const session = await this._getOrCreateSession(params.worktreePath);

    // 2. Build prompt with slash command if specified
    const fullPrompt = this._buildPrompt(params);

    // 3. Execute via Claude SDK
    const result = await session.query(fullPrompt);

    // 4. Parse result and return
    return this._parseResult(result);
  }

  private _buildPrompt(params: AgentExecuteParams): string {
    const slashCommand = params.agentType.slashCommand || '';
    return `${slashCommand} ${params.prompt}`.trim();
  }
}
```

#### 3.2.4 Executor Registry

```typescript
// New: src/extension/orchestrator/agentExecutorRegistry.ts

class AgentExecutorRegistry {
  private readonly _executors: Map<AgentBackendType, IAgentExecutor>;

  register(executor: IAgentExecutor): void;

  getExecutor(parsedType: ParsedAgentType): IAgentExecutor {
    const executor = this._executors.get(parsedType.backend);
    if (!executor?.supports(parsedType)) {
      throw new Error(`No executor found for agent type: ${parsedType.rawType}`);
    }
    return executor;
  }
}
```

---

## 4. Implementation Phases

### Phase 1: Agent Executor Abstraction Layer
**Duration**: 2-3 days | **Risk**: Low | **Dependencies**: None

| Task | Files | Description |
|------|-------|-------------|
| 1.1 | `src/extension/orchestrator/agentExecutor.ts` | Define `IAgentExecutor` interface |
| 1.2 | `src/extension/orchestrator/agentExecutorRegistry.ts` | Create executor registry |
| 1.3 | `src/extension/orchestrator/executors/copilotAgentExecutor.ts` | Wrap existing `AgentRunner` |
| 1.4 | `src/extension/orchestrator/agentExecutor.test.ts` | Unit tests for abstraction |

**Acceptance Criteria**:
- [ ] Existing Copilot execution works through new abstraction
- [ ] No behavioral changes to current A2A/Orchestrator flows
- [ ] Unit tests pass for executor interface

---

### Phase 2: Agent Type Parser & Routing
**Duration**: 1-2 days | **Risk**: Low | **Dependencies**: Phase 1

| Task | Files | Description |
|------|-------|-------------|
| 2.1 | `src/extension/orchestrator/agentTypeParser.ts` | Implement type parser |
| 2.2 | `src/extension/tools/node/a2aTools.ts` | Update spawn tools to use parser |
| 2.3 | `src/extension/orchestrator/orchestratorServiceV2.ts` | Update deploy to use parser |
| 2.4 | `src/extension/orchestrator/agentTypeParser.test.ts` | Parser unit tests |

**Agent Type Syntax**:
```
copilot (default):  @agent, @architect, @reviewer
claude code:        claude:agent, claude:architect, claude:reviewer
future cli:         cli:agent
future cloud:       cloud:agent
```

**Acceptance Criteria**:
- [ ] Parser correctly identifies all agent type patterns
- [ ] Existing `@agent` syntax routes to Copilot executor
- [ ] Unknown types produce clear error messages

---

### Phase 3: Claude Code Worktree Support
**Duration**: 2-3 days | **Risk**: Medium | **Dependencies**: None (parallel with Phase 1-2)

| Task | Files | Description |
|------|-------|-------------|
| 3.1 | `src/extension/agents/claude/node/claudeCodeAgent.ts` | Add worktree-aware session creation |
| 3.2 | `src/extension/agents/claude/node/claudeCodeSessionService.ts` | Support sessions per worktree |
| 3.3 | `src/extension/agents/claude/node/claudeWorktreeSession.ts` | New session wrapper for worktrees |

**Key Changes to ClaudeAgentManager**:

```typescript
// Modified: claudeCodeAgent.ts

class ClaudeAgentManager {
  // Existing: main workspace session
  private _mainSession: ClaudeCodeSession | undefined;

  // New: worktree sessions keyed by path
  private readonly _worktreeSessions: Map<string, ClaudeCodeSession>;

  async getOrCreateSession(worktreePath?: string): Promise<ClaudeCodeSession> {
    if (!worktreePath) {
      return this._getMainSession();
    }

    let session = this._worktreeSessions.get(worktreePath);
    if (!session) {
      session = await this._createWorktreeSession(worktreePath);
      this._worktreeSessions.set(worktreePath, session);
    }
    return session;
  }

  private async _createWorktreeSession(worktreePath: string): Promise<ClaudeCodeSession> {
    // Create session with cwd set to worktree
    return new ClaudeCodeSession({
      cwd: worktreePath,
      // Inherit tool permissions from parent
      canUseTool: this._options.canUseTool,
    });
  }
}
```

**Acceptance Criteria**:
- [ ] Claude Code can create sessions scoped to worktree paths
- [ ] Sessions are properly cleaned up when worktree is removed
- [ ] File operations in session respect worktree boundaries

---

### Phase 4: Claude Code Agent Executor
**Duration**: 3-4 days | **Risk**: Medium | **Dependencies**: Phase 1, 3

| Task | Files | Description |
|------|-------|-------------|
| 4.1 | `src/extension/orchestrator/executors/claudeCodeAgentExecutor.ts` | Implement Claude executor |
| 4.2 | `src/extension/orchestrator/executors/claudeCodeAgentExecutor.test.ts` | Unit tests |
| 4.3 | Register executor in `agentExecutorRegistry.ts` | Wire up executor |

**Executor Implementation**:

```typescript
// New: claudeCodeAgentExecutor.ts

class ClaudeCodeAgentExecutor implements IAgentExecutor {
  readonly backendType = 'claude';

  constructor(
    @IClaudeAgentManager private readonly _claudeManager: ClaudeAgentManager,
    @ILogService private readonly _log: ILogService,
  ) {}

  supports(parsedType: ParsedAgentType): boolean {
    return parsedType.backend === 'claude';
  }

  async execute(params: AgentExecuteParams): Promise<AgentExecuteResult> {
    const { taskId, prompt, worktreePath, agentType } = params;

    this._log.info(`[ClaudeExecutor] Starting task ${taskId} in ${worktreePath}`);

    // Get session for this worktree
    const session = await this._claudeManager.getOrCreateSession(worktreePath);

    // Build prompt with optional slash command
    const fullPrompt = agentType.slashCommand
      ? `${agentType.slashCommand} ${prompt}`
      : prompt;

    try {
      // Execute query
      const messages: ClaudeMessage[] = [];
      for await (const msg of session.query(fullPrompt)) {
        messages.push(msg);
        // Stream progress if needed
      }

      // Parse final result
      return this._parseMessages(messages);

    } catch (error) {
      return {
        status: 'failed',
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async sendMessage(workerId: string, message: string): Promise<void> {
    const session = this._activeSessions.get(workerId);
    if (!session) {
      throw new Error(`No active session for worker ${workerId}`);
    }
    // Send follow-up message to Claude session
    await session.query(message);
  }

  async cancel(workerId: string): Promise<void> {
    const session = this._activeSessions.get(workerId);
    if (session) {
      await session.abort();
      this._activeSessions.delete(workerId);
    }
  }
}
```

**Acceptance Criteria**:
- [ ] Claude Code executor successfully runs tasks in worktrees
- [ ] Slash commands are properly forwarded
- [ ] Errors are caught and returned in result

---

### Phase 5: Inter-Agent Messaging Bridge
**Duration**: 2-3 days | **Risk**: Medium | **Dependencies**: Phase 4

| Task | Files | Description |
|------|-------|-------------|
| 5.1 | `src/extension/orchestrator/agentMessageBridge.ts` | Create messaging bridge |
| 5.2 | Update `a2aTools.ts` | Route messages through bridge |
| 5.3 | Update `orchestratorServiceV2.ts` | Support cross-backend messaging |

**Message Bridge Design**:

```typescript
// New: agentMessageBridge.ts

class AgentMessageBridge {
  private readonly _workerBackends: Map<string, AgentBackendType>;

  async sendMessage(
    fromWorkerId: string,
    toWorkerId: string,
    message: string,
  ): Promise<void> {
    const toBackend = this._workerBackends.get(toWorkerId);
    const executor = this._registry.getExecutorByBackend(toBackend);
    await executor.sendMessage(toWorkerId, message);
  }

  registerWorker(workerId: string, backend: AgentBackendType): void {
    this._workerBackends.set(workerId, backend);
  }
}
```

**Acceptance Criteria**:
- [ ] Copilot agent can send message to Claude Code worker
- [ ] Claude Code worker can notify parent orchestrator
- [ ] Messages are properly queued if recipient is busy

---

### Phase 6: Result Handling & Merge Integration
**Duration**: 2 days | **Risk**: Low | **Dependencies**: Phase 4

| Task | Files | Description |
|------|-------|-------------|
| 6.1 | `src/extension/orchestrator/orchestratorServiceV2.ts` | Handle Claude executor results |
| 6.2 | `src/extension/orchestrator/subTaskManager.ts` | Integrate with merge flow |
| 6.3 | Existing merge infrastructure | Verify compatibility |

**Result Flow**:
```
Claude Executor → AgentExecuteResult → SubTaskManager.completeSubTask()
                                              ↓
                                     Existing merge flow:
                                     - git add/commit in worktree
                                     - git merge to parent branch
                                     - cleanup worktree
```

**Acceptance Criteria**:
- [ ] Claude Code task completion triggers merge flow
- [ ] Commit messages are properly attributed
- [ ] Worktree cleanup works for Claude sessions

---

### Phase 7: Orchestrator UI Integration
**Duration**: 2 days | **Risk**: Low | **Dependencies**: Phase 4, 6

| Task | Files | Description |
|------|-------|-------------|
| 7.1 | `src/extension/orchestrator/orchestratorTreeProvider.ts` | Show backend type in tree |
| 7.2 | `src/extension/orchestrator/orchestratorWebviewProvider.ts` | Update webview for multi-backend |
| 7.3 | Update worker status display | Show which backend is running |

**UI Changes**:
- Worker nodes show backend icon (Copilot vs Claude)
- Task configuration allows backend selection
- Status messages indicate which backend is executing

**Acceptance Criteria**:
- [ ] Tree view shows agent backend type
- [ ] Users can specify backend when adding tasks
- [ ] Status updates reflect correct backend

---

### Phase 8: Permission & Safety Model
**Duration**: 2-3 days | **Risk**: Medium | **Dependencies**: Phase 4

| Task | Files | Description |
|------|-------|-------------|
| 8.1 | `src/extension/orchestrator/agentPermissions.ts` | Unified permission model |
| 8.2 | Bridge A2A permissions to Claude `canUseTool` | Permission translation |
| 8.3 | Worktree boundary enforcement | Prevent operations outside worktree |

**Permission Model**:

```typescript
// New: agentPermissions.ts

interface AgentPermissions {
  canReadFiles: boolean;
  canWriteFiles: boolean;
  canExecuteCommands: boolean;
  canAccessNetwork: boolean;
  allowedPaths: string[];  // Worktree + allowed external paths
}

// Translate to Claude's permission model
function toClaudePermissions(perms: AgentPermissions): ClaudeToolPermissions {
  return {
    canUseTool: (tool: string) => {
      if (tool === 'Read' && !perms.canReadFiles) return false;
      if (tool === 'Write' && !perms.canWriteFiles) return false;
      if (tool === 'Bash' && !perms.canExecuteCommands) return false;
      return true;
    },
  };
}
```

**Acceptance Criteria**:
- [ ] Claude Code respects worktree path boundaries
- [ ] A2A permission flags translate to Claude tool permissions
- [ ] Security audit passes for multi-backend execution

---

### Phase 9: Testing & Hardening
**Duration**: 3-4 days | **Risk**: Low | **Dependencies**: All phases

| Task | Files | Description |
|------|-------|-------------|
| 9.1 | Integration tests | End-to-end multi-backend scenarios |
| 9.2 | Simulation tests | `.stest.ts` scenarios for Claude backend |
| 9.3 | Error handling | Edge cases and failure modes |
| 9.4 | Performance testing | Concurrent multi-backend execution |

**Test Scenarios**:
1. Spawn Claude Code task from Copilot orchestrator
2. Mixed parallel execution (2 Copilot + 1 Claude)
3. Claude task with slash command
4. Inter-agent message from Copilot to Claude
5. Claude task completion and merge
6. Claude task failure and recovery
7. Session cleanup on worktree removal

**Acceptance Criteria**:
- [ ] All test scenarios pass
- [ ] No memory leaks in long-running scenarios
- [ ] Graceful degradation when Claude unavailable

---

### Phase 10: Documentation
**Duration**: 1-2 days | **Risk**: Low | **Dependencies**: Phase 9

| Task | Files | Description |
|------|-------|-------------|
| 10.1 | `docs/multi-agent-architecture.md` | Architecture documentation |
| 10.2 | `docs/orchestrator-readme.md` | Update with multi-backend info |
| 10.3 | `docs/claude-code-integration.md` | Claude-specific documentation |
| 10.4 | Code comments | JSDoc for new interfaces |

---

## 5. File Reference

### 5.1 New Files to Create

| File | Purpose |
|------|---------|
| `src/extension/orchestrator/agentExecutor.ts` | `IAgentExecutor` interface definition |
| `src/extension/orchestrator/agentExecutorRegistry.ts` | Executor registration and lookup |
| `src/extension/orchestrator/agentTypeParser.ts` | Agent type string parsing |
| `src/extension/orchestrator/agentMessageBridge.ts` | Cross-backend messaging |
| `src/extension/orchestrator/agentPermissions.ts` | Unified permission model |
| `src/extension/orchestrator/executors/copilotAgentExecutor.ts` | Copilot executor wrapper |
| `src/extension/orchestrator/executors/claudeCodeAgentExecutor.ts` | Claude Code executor |
| `src/extension/agents/claude/node/claudeWorktreeSession.ts` | Worktree-scoped session |
| `test/orchestrator/multiBackend.test.ts` | Multi-backend integration tests |

### 5.2 Files to Modify

| File | Changes |
|------|---------|
| `src/extension/tools/node/a2aTools.ts` | Use executor registry for spawning |
| `src/extension/orchestrator/orchestratorServiceV2.ts` | Use executor registry for deployment |
| `src/extension/orchestrator/subTaskManager.ts` | Route through executor abstraction |
| `src/extension/agents/claude/node/claudeCodeAgent.ts` | Add worktree session management |
| `src/extension/agents/claude/node/claudeCodeSessionService.ts` | Support per-worktree sessions |
| `src/extension/orchestrator/orchestratorTreeProvider.ts` | Show backend type in UI |

---

## 6. Technical Considerations

### 6.1 Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Executor interface over inheritance | Allows independent evolution of each backend |
| Type string parsing over enums | Extensible for future backends without code changes |
| Per-worktree sessions | Isolation and proper cleanup on task completion |
| Message bridge pattern | Decouples backends from direct knowledge of each other |

### 6.2 Performance Considerations

- **Session pooling**: Consider reusing Claude sessions for sequential tasks in same worktree
- **Parallel execution**: Multiple Claude sessions can run concurrently
- **Memory**: Claude SDK sessions may hold conversation history; clear on task completion

### 6.3 Security Considerations

- **Worktree sandboxing**: Claude must not access files outside worktree
- **Tool permissions**: Map A2A permission model to Claude's `canUseTool`
- **Secret handling**: Claude sessions should not expose workspace secrets

### 6.4 Compatibility

- **VS Code version**: No new VS Code API dependencies
- **Claude SDK version**: Target `@anthropic-ai/claude-agent-sdk` latest stable
- **Breaking changes**: None for existing A2A/Orchestrator users

---

## 7. Success Metrics

| Metric | Target |
|--------|--------|
| Claude tasks execute successfully | > 95% success rate |
| Merge integration works | 100% compatibility |
| No regression in Copilot execution | Zero failures in existing tests |
| Cross-backend messaging | < 100ms latency |
| Memory usage | < 50MB per additional Claude session |

---

## 8. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Claude SDK API changes | Medium | High | Pin SDK version, abstract SDK interactions |
| Session memory leaks | Medium | Medium | Explicit cleanup, memory monitoring |
| Permission model mismatch | Low | High | Thorough mapping, fail-closed security |
| Performance degradation | Low | Medium | Benchmarking, session pooling |
| User confusion (multiple backends) | Medium | Low | Clear UI indicators, documentation |

---

## 9. Open Questions for Review

1. **Slash Command Mapping**: Should `claude:architect` invoke Claude's built-in `/architect` command, or should we inject our own architect instructions?

2. **Session Lifecycle**: Should Claude sessions be pooled and reused across tasks in the same worktree, or should each task get a fresh session?

3. **Future Backends**: Should we stub out CLI/Cloud executor interfaces now, or defer until those backends are ready?

4. **Permission Inheritance**: Should Claude Code tasks inherit full A2A permissions, or should we require explicit permission grants per backend?

5. **Error Recovery**: When a Claude task fails mid-execution, should we offer "retry with Copilot" as a fallback?

---

## 10. Example Workflow

### Mixed Backend Execution

```yaml
Plan: "Implement Feature X"
Tasks:
  - id: design
    agent: "claude:architect"  # Uses Claude's /architect
    prompt: "Design the database schema for feature X"

  - id: implement-api
    agent: "@agent"            # Uses Copilot
    prompt: "Implement the REST API based on design"
    depends_on: [design]

  - id: implement-ui
    agent: "claude:agent"      # Uses Claude Code
    prompt: "Implement the React UI components"
    depends_on: [design]

  - id: review
    agent: "@reviewer"         # Uses Copilot reviewer
    prompt: "Review all changes"
    depends_on: [implement-api, implement-ui]
```

**Execution Flow**:
1. Orchestrator parses agent types
2. `design` task routed to Claude executor with `/architect` prefix
3. On completion, `implement-api` and `implement-ui` deploy in parallel
4. `implement-api` → Copilot executor in worktree A
5. `implement-ui` → Claude executor in worktree B
6. Both complete and merge to main branch
7. `review` task deploys to Copilot reviewer

---

## 11. Approval

- [ ] **Technical Lead**: Architecture review approved
- [ ] **Security Review**: Permission model approved
- [ ] **Product Owner**: Scope and timeline approved

---

## Appendix A: Agent Type Grammar

```ebnf
agent_type     = copilot_type | claude_type | cli_type | cloud_type
copilot_type   = "@" agent_name
claude_type    = "claude:" agent_name
cli_type       = "cli:" agent_name
cloud_type     = "cloud:" agent_name
agent_name     = "agent" | "architect" | "reviewer" | "planner" | custom_name
custom_name    = [a-zA-Z][a-zA-Z0-9_-]*
```

---

## Appendix B: Interface Definitions

```typescript
// Complete interface definitions for reference

type AgentBackendType = 'copilot' | 'claude' | 'cli' | 'cloud';

interface ParsedAgentType {
  backend: AgentBackendType;
  agentName: string;
  slashCommand?: string;
  rawType: string;
}

interface IAgentExecutor {
  readonly backendType: AgentBackendType;
  execute(params: AgentExecuteParams): Promise<AgentExecuteResult>;
  sendMessage(workerId: string, message: string): Promise<void>;
  cancel(workerId: string): Promise<void>;
  getStatus(workerId: string): AgentWorkerStatus;
  supports(parsedType: ParsedAgentType): boolean;
}

interface AgentExecuteParams {
  taskId: string;
  prompt: string;
  worktreePath: string;
  agentType: ParsedAgentType;
  parentWorkerId?: string;
  expectedOutput?: string;
  targetFiles?: string[];
  options?: {
    timeout?: number;
    maxTokens?: number;
    temperature?: number;
  };
}

interface AgentExecuteResult {
  status: 'success' | 'partial' | 'failed';
  output: string;
  filesChanged?: string[];
  error?: string;
  metadata?: Record<string, unknown>;
}

type AgentWorkerStatus =
  | { state: 'idle' }
  | { state: 'running'; startTime: number }
  | { state: 'completed'; result: AgentExecuteResult }
  | { state: 'failed'; error: string };
```

---

*End of Architecture Plan*
