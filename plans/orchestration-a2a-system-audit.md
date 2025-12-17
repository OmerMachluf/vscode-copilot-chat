# Orchestration & A2A System Audit and Fixes

## Overview

This plan addresses 7 critical issues identified in the orchestration and a2a systems, focusing on robustness, correct behavior, and proper state machine operation.

## Problem Statement

The orchestration and a2a systems have several interrelated issues:

1. **Unclear separation** between orchestrator tasks and a2a subtasks
2. **Incorrect worktree path detection** (using VS Code installation directory)
3. **Claude Code executor not using correct worktree**
4. **Tool duplication** between orchestrator and a2a
5. **Unclear orchestrator-agent coordination** (blocking, notification robustness)
6. **Tasks finishing immediately** (possible recent regression)
7. **Overall system robustness** - not behaving like a calibrated state machine

## Technical Approach

### Issue 1: Orchestrator vs A2A Tool Separation

**Current State:**
- A2A subtasks call `orchestratorService.deploy()` internally (`subTaskManager.ts:521`)
- Both systems share the same worker deployment infrastructure
- Tool overlap: `A2ASendMessageToWorker` and `OrchestratorSendToWorker` are identical

**Finding:** This coupling is intentional - a2a uses orchestrator for deployment but adds hierarchical parent-child relationships.

**Recommendation:**
- **Keep the shared deployment** - it works
- **Merge duplicate tools** - `sendMessageToWorker` should be one tool
- **Clarify naming** in UI:
  - Orchestrator tasks: Show task name from plan (e.g., "Implementing auth system")
  - A2A subtasks: Show specialist name (e.g., "Subtask: @architect")

**Files to modify:**
- `src/extension/tools/node/a2aTools.ts:1412-1464` - Remove `A2ASendMessageToWorkerTool` or make it delegate
- `src/extension/tools/common/toolNames.ts` - Consider merging tool names

---

### Issue 2: Incorrect Worktree Path Detection

**Root Cause:** `claudeCodeAgent.ts:467-468`
```typescript
const mainWorkspace = this.workspaceService.getWorkspaceFolders().at(0)?.fsPath;
const workingDirectory = this._worktreePath || this._workerContext?.worktreePath || mainWorkspace;
```

**Problem Chain:**
1. `getWorkspaceFolders()` returns empty array if no workspace open
2. `.at(0)?.fsPath` returns `undefined`
3. All fallbacks fail
4. Claude SDK defaults to its own installation directory (`C:\Program Files\Microsoft VS Code`)

**Fix:**
```typescript
// claudeCodeAgent.ts
private async _startSession(token: vscode.CancellationToken): Promise<void> {
    const mainWorkspace = this.workspaceService.getWorkspaceFolders().at(0)?.fsPath;
    const workingDirectory = this._worktreePath
        || this._workerContext?.worktreePath
        || mainWorkspace;

    // CRITICAL: Validate working directory exists and is not VS Code installation
    if (!workingDirectory || workingDirectory.includes('Microsoft VS Code')) {
        throw new Error(
            `Invalid working directory: ${workingDirectory}. ` +
            `Please open a workspace folder before running Claude tasks.`
        );
    }

    this.logService.info(`[ClaudeCodeSession] Using working directory: ${workingDirectory}`);
    // ... rest of method
}
```

**Files to modify:**
- `src/extension/agents/claude/node/claudeCodeAgent.ts:467-470`

---

### Issue 3: Claude Code Executor Worktree Path

**Root Cause:** `claudeCodeAgentExecutor.ts:86`
```typescript
const session = await this._claudeAgentManager.getOrCreateWorktreeSession(worktreePath);
```

**Problem:** If `worktreePath` from `AgentExecuteParams` is undefined/invalid, session starts in wrong directory.

**Fix:** Validate worktree path in executor before creating session:

```typescript
// claudeCodeAgentExecutor.ts
async execute(params: AgentExecuteParams, stream?: vscode.ChatResponseStream): Promise<AgentExecuteResult> {
    const { taskId, prompt, worktreePath, agentType, token, workerContext, toolInvocationToken } = params;

    // CRITICAL: Validate worktree path
    if (!worktreePath) {
        return {
            status: 'failed',
            output: '',
            error: 'No worktree path provided for Claude executor',
        };
    }

    // Validate path exists and is accessible
    const fs = await import('fs/promises');
    try {
        await fs.access(worktreePath);
    } catch {
        return {
            status: 'failed',
            output: '',
            error: `Worktree path does not exist: ${worktreePath}`,
        };
    }

    this._logService.info(`[ClaudeCodeAgentExecutor] Executing in worktree: ${worktreePath}`);
    // ... rest of method
}
```

**Files to modify:**
- `src/extension/orchestrator/executors/claudeCodeAgentExecutor.ts:62-70`

---

### Issue 4: Tool Consolidation

**Current duplicate tools:**
| Orchestrator | A2A | Recommendation |
|--------------|-----|----------------|
| `orchestrator_sendToWorker` | `a2a_send_message_to_worker` | **Merge** into single `sendMessageToWorker` |
| `orchestrator_awaitWorkers` | `a2a_await_subtasks` | Keep separate (different semantics) |
| `orchestrator_listAgents` | `a2a_list_specialists` | Keep separate (different use cases) |

**Tools to consider removing:**
- `orchestrator_addPlanTask` - Only useful during plan creation, could be internal

**Files to modify:**
- `src/extension/tools/node/a2aTools.ts` - Delegate `A2ASendMessageToWorker` to shared implementation
- `src/extension/tools/node/orchestratorTools.ts` - Extract `sendMessageToWorker` to shared utility

---

### Issue 5: Orchestrator-Agent Coordination Analysis

**Current Flow:**
```
orchestrator_savePlan()
    → OrchestratorService.savePlan()
    → For each ready task: deploy()
        → Creates WorkerSession
        → Calls AgentExecutor.execute()
        → Worker runs with A2A tools available
```

**Is it blocking?**
- `orchestrator_awaitWorkers` puts orchestrator in sleep mode (no LLM calls)
- Wakes on: status change, escalation interval (5min), or timeout (30min)
- This is **semi-blocking** - orchestrator yields control but monitors

**Notification System Robustness:**
- Messages route via `OrchestratorQueueService`
- Owner-based routing works correctly
- **Issues found:**
  1. No message TTL - old messages persist indefinitely
  2. No dead letter queue - failed handler = lost message
  3. Race condition: handler registration async (`setTimeout`), could miss early messages

**Fixes:**
```typescript
// orchestratorQueue.ts
interface IOrchestratorQueueMessage {
    // ... existing fields
    createdAt: number;  // Add timestamp
    retryCount: number; // Add retry tracking
}

// Add TTL check in _processNextMessage
private async _processNextMessage(): Promise<void> {
    const message = this._pendingQueue.dequeue();
    if (!message) return;

    // TTL check - discard messages older than 1 hour
    const TTL_MS = 60 * 60 * 1000;
    if (Date.now() - message.createdAt > TTL_MS) {
        this._logService.warn(`[Queue] Discarding stale message: ${message.id}`);
        return;
    }

    // ... existing processing
}
```

**Files to modify:**
- `src/extension/orchestrator/orchestratorQueue.ts:30-50` - Add TTL and retry fields
- `src/extension/orchestrator/orchestratorQueue.ts:130-160` - Add TTL check

---

### Issue 6: Tasks Finishing Immediately

**Investigation:** From logs in `botherme.txt`:
```
11:37:41.674 [info] Deploy task task-402: model=claude-opus-4.5, worktreePath=C:\Program Files\Microsoft VS Code
```

**Root Cause:** The worktree path is VS Code's installation directory, not the actual workspace. This causes:
1. Claude SDK starts in wrong directory
2. Can't find project files
3. Completes immediately with no work done

**This is the SAME issue as #2/#3** - fixing worktree detection fixes this.

**Additional Check:** The `toolInvocationToken` is critical. From `claudeCodeAgentExecutor.ts:129-133`:
```typescript
// CRITICAL: Pass the real toolInvocationToken from the orchestrator, not a mock.
// Without a valid token, tool confirmations fail and the session completes immediately.
await session.session.invoke(
    fullPrompt,
    toolInvocationToken!,  // <-- Must be valid
    responseStream,
    token
);
```

**Verify:** Ensure `toolInvocationToken` is properly passed through the entire chain.

---

### Issue 7: State Machine Robustness

**Current State Machine Analysis:**

States: `pending | running | completed | failed | cancelled`

**Problems:**
1. Multiple code paths update status independently
2. No atomic transitions with locks
3. Defensive checks exist for "shouldn't happen" states (e.g., `subTaskManager.ts:446-456`)
4. WorkerSession and SubTask both have status - can diverge

**Recommended State Machine Pattern:**

```typescript
// New file: src/extension/orchestrator/stateMachine.ts

type TaskState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

interface StateTransition {
    from: TaskState[];
    to: TaskState;
}

const VALID_TRANSITIONS: StateTransition[] = [
    { from: ['pending'], to: 'running' },
    { from: ['running'], to: 'completed' },
    { from: ['running'], to: 'failed' },
    { from: ['pending', 'running'], to: 'cancelled' },
];

class TaskStateMachine {
    private _state: TaskState = 'pending';
    private readonly _lock = new Mutex();

    async transition(to: TaskState): Promise<boolean> {
        return this._lock.runExclusive(() => {
            const valid = VALID_TRANSITIONS.some(
                t => t.from.includes(this._state) && t.to === to
            );
            if (!valid) {
                console.warn(`Invalid transition: ${this._state} -> ${to}`);
                return false;
            }
            this._state = to;
            return true;
        });
    }
}
```

**Key Changes:**
1. Single source of truth for task status
2. Atomic transitions with mutex
3. Validate all state transitions
4. Log invalid transition attempts

**Files to modify:**
- New file: `src/extension/orchestrator/taskStateMachine.ts`
- `src/extension/orchestrator/subTaskManager.ts` - Use state machine
- `src/extension/orchestrator/workerSession.ts` - Use state machine

---

## Implementation Phases

### Phase 1: Critical Fixes (Immediate)

**Tasks:**
1. [ ] Fix worktree path validation in `claudeCodeAgent.ts:467-470`
2. [ ] Add worktree path validation in `claudeCodeAgentExecutor.ts:62-70`
3. [ ] Add logging to trace worktree path through the entire chain
4. [ ] Verify `toolInvocationToken` is properly passed

**Success criteria:**
- Tasks no longer start in VS Code installation directory
- Clear error messages when worktree is invalid

### Phase 2: Tool Consolidation (Short-term)

**Tasks:**
1. [ ] Merge `sendMessageToWorker` into single implementation
2. [ ] Update tool registration to use merged tool
3. [ ] Update tests

**Success criteria:**
- No duplicate tools
- Existing functionality preserved

### Phase 3: State Machine Robustness (Short-term)

**Tasks:**
1. [ ] Create `TaskStateMachine` class
2. [ ] Integrate into `SubTaskManager`
3. [ ] Integrate into `WorkerSession`
4. [ ] Add state transition logging
5. [ ] Remove defensive "shouldn't happen" checks (they become assertions)

**Success criteria:**
- Single source of truth for task status
- Invalid transitions are logged and prevented
- No state divergence between WorkerSession and SubTask

### Phase 4: Message Queue Hardening (Medium-term)

**Tasks:**
1. [ ] Add message TTL
2. [ ] Add retry count and exponential backoff
3. [ ] Fix handler registration race condition
4. [ ] Add dead letter queue for failed messages
5. [ ] Add queue monitoring/observability

**Success criteria:**
- Stale messages automatically discarded
- Failed handlers don't lose messages
- Early messages not missed during handler registration

---

## Acceptance Criteria

### Functional Requirements

- [ ] Claude tasks execute in correct workspace directory
- [ ] Task names displayed correctly (plan task name vs specialist name)
- [ ] Messages route correctly between orchestrator, workers, and subtasks
- [ ] State transitions are atomic and validated

### Non-Functional Requirements

- [ ] No state divergence between WorkerSession and SubTask
- [ ] Clear logging of worktree path at each step
- [ ] Error messages explain what went wrong and how to fix

### Quality Gates

- [ ] All existing tests pass
- [ ] New tests for state machine transitions
- [ ] Manual testing of orchestrator → worker → subtask flow

---

## Risk Analysis

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing orchestration flows | High | Incremental changes with feature flags |
| State machine migration complexity | Medium | Parallel implementation, gradual migration |
| Tool merge breaking existing prompts | Low | Tool name aliases during transition |

---

## References

### Internal References
- `src/extension/agents/claude/node/claudeCodeAgent.ts:467-470` - Worktree path determination
- `src/extension/orchestrator/executors/claudeCodeAgentExecutor.ts:62-70` - Executor params
- `src/extension/orchestrator/orchestratorQueue.ts` - Message routing
- `src/extension/orchestrator/subTaskManager.ts` - Subtask state management
- `src/extension/tools/node/a2aTools.ts` - A2A tool implementations
- `src/extension/tools/node/orchestratorTools.ts` - Orchestrator tool implementations

### Logs Analysis
- `botherme.txt:74` - Shows worktree incorrectly set to `C:\Program Files\Microsoft VS Code`
- `botherme.txt:97-104` - Shows message queue working but routing to `ownerId: "none"`
