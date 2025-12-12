# A2A Traceability & Contract Definition

> **Phase 1 deliverable** of the [Architecture Plan](../plans/ArchitecturePlan.md)
> Status: **DRAFT**
> Last updated: December 12, 2025

---

## 1. Overview

This document defines the canonical contracts for:

1. **A2A Communication Flows** — spawn / await / notify / complete
2. **Parent Session Identity** — who receives subtask messages
3. **Subtask Lifecycle Events** — states, transitions, payloads
4. **Observability Checklist** — correlation IDs, logging points, expected routing

It maps each contract element to the current implementation and calls out gaps that subsequent phases must address.

---

## 2. A2A Communication Flows

### 2.1 Tools Summary

| Tool | File | Purpose |
|------|------|---------|
| `a2a_spawn_subtask` | [a2aTools.ts](../src/extension/tools/node/a2aTools.ts) | Spawn single subtask (blocking or non-blocking) |
| `a2a_spawn_parallel_subtasks` | [a2aTools.ts](../src/extension/tools/node/a2aTools.ts) | Spawn multiple subtasks in parallel |
| `a2a_await_subtasks` | [a2aTools.ts](../src/extension/tools/node/a2aTools.ts) | Wait for non-blocking subtasks to complete |
| `a2a_notify_orchestrator` | [a2aTools.ts](../src/extension/tools/node/a2aTools.ts) | Send status/question/error to owner |
| `a2a_subtask_complete` | [a2aSubTaskCompleteTool.ts](../src/extension/tools/node/a2aSubTaskCompleteTool.ts) | Report subtask result to owner |

### 2.2 "Blocking Tool Output" vs "Queue-Routed Messages"

| Flow Type | Trigger | Delivery Mechanism | Current Behavior |
|-----------|---------|-------------------|------------------|
| **Blocking Tool Output** | `blocking: true` (default) in spawn | Tool invocation blocks; parent waits via `withProgress`; result returned directly in `LanguageModelToolResult` | ✅ Works — parent receives result synchronously |
| **Queue-Routed Message** | `blocking: false` in spawn, or `a2a_notify_orchestrator` / `a2a_subtask_complete` calls | Enqueued via `IOrchestratorQueueService.enqueueMessage()`; processed by registered owner handler | ⚠️ Partial — handler only registered during blocking path; non-blocking spawns have no persistent handler |

#### 2.2.1 Blocking Path Detail (spawn with `blocking: true`)

```
Parent Tool Invocation
        │
        ▼
┌──────────────────────────────┐
│ A2ASpawnSubTaskTool.invoke() │
│  • creates subtask           │
│  • registers owner handler   │◄────── transient handler via
│    for parent workerId       │        _queueService.registerOwnerHandler()
│  • calls executeSubTask()    │
│  • waits for result          │
└──────────────────────────────┘
        │
        ▼
    SubTaskManager.executeSubTask()
        │
        ▼
    AgentRunner.run() (child agent loop)
        │
        ├──▶ child calls a2a_notify_orchestrator
        │         └──▶ enqueues to owner handler
        │         └──▶ progress.report() in parent
        │
        └──▶ child calls a2a_subtask_complete
                  └──▶ updateStatus() + enqueue completion
                  └──▶ parent receives via handler
        │
        ▼
    Result returned to tool
        │
        ▼
    Parent agent continues
```

**Key observation:** The owner handler is disposed in `finally` block after subtask completes, so any late-arriving messages have no consumer.

#### 2.2.2 Non-Blocking Path Detail (spawn with `blocking: false`)

```
Parent Tool Invocation
        │
        ▼
┌──────────────────────────────┐
│ A2ASpawnSubTaskTool.invoke() │
│  • creates subtask           │
│  • starts execution in       │
│    background (fire & forget)│──────▶ executeSubTask() runs async
│  • returns immediately with  │
│    subtask ID                │
└──────────────────────────────┘
        │                               │
        ▼                               ▼
    Parent continues           Child agent loop
    (no handler registered!)      │
                                  ├──▶ child calls a2a_notify_orchestrator
                                  │         └──▶ enqueues message
                                  │         └──▶ NO HANDLER ❌
                                  │
                                  └──▶ child calls a2a_subtask_complete
                                            └──▶ updateStatus() + enqueue
                                            └──▶ NO HANDLER ❌
```

**Gap identified:** Non-blocking spawns need a **persistent owner handler** that outlives the spawn tool invocation.

#### 2.2.3 Await Path (`a2a_await_subtasks`)

```
Parent Tool Invocation
        │
        ▼
┌──────────────────────────────┐
│ A2AAwaitSubTasksTool.invoke()│
│  • registers owner handler   │◄────── transient handler for wait period
│  • polls SubTaskManager for  │
│    completion status         │
│  • collects queue messages   │
│  • returns aggregated result │
└──────────────────────────────┘
```

**Observation:** This provides a workaround for non-blocking spawns, but requires parent to explicitly poll. Messages that arrive **before** await is called are already in queue and will be delivered.

---

## 3. Parent Session Identity Contract

### 3.1 Schema: `IOwnerContext`

Defined in [orchestratorQueue.ts](../src/extension/orchestrator/orchestratorQueue.ts):

```typescript
export interface IOwnerContext {
  /** Type of owner */
  ownerType: 'orchestrator' | 'worker' | 'agent';

  /** Unique ID of the owner (worker ID, session ID, or 'orchestrator') */
  ownerId: string;

  /** Session URI for agent sessions (optional) */
  sessionUri?: string;
}
```

### 3.2 Identity Variants

| Scenario | `ownerType` | `ownerId` | `sessionUri` | Notes |
|----------|------------|-----------|--------------|-------|
| **Orchestrator-spawned worker** | `'worker'` | parent worker ID (e.g., `worker-abc123`) | undefined | Messages route to parent worker's handler |
| **Agent-spawned subtask** | `'worker'` | parent worker ID (e.g., `user-session-v3-subtask-xyz`) | undefined | Same routing as above |
| **User chat session (future)** | `'agent'` | chat session ID | `vscode-chat://...` | Not yet implemented — would allow direct user-chat subtasks |
| **Orchestrator itself** | `'orchestrator'` | `'orchestrator'` | undefined | Default when no owner specified |

### 3.3 Identity Propagation

```
                              IWorkerContext
                              (workerToolsService.ts)
                                     │
          ┌────────────────────────┬─┴────────────────────────┐
          │                        │                          │
    workerId              owner: IWorkerOwnerContext    spawnContext
    (string)              (optional)                    ('orchestrator'|'agent')
          │                        │
          │                        ▼
          │              ┌─────────────────────┐
          │              │ ownerType: string   │
          │              │ ownerId: string     │
          │              │ sessionUri?: string │
          │              └─────────────────────┘
          │
          ▼
    SubTaskManager.createSubTask()
          │
          │  owner = { ownerType: 'worker', ownerId: parentWorkerId }
          │
          ▼
    WorkerToolSet for child
          │
          │  IWorkerContext.owner = <inherited>
          │
          ▼
    A2A tools use _workerContext.owner for message routing
```

**Current code path** (from [subTaskManager.ts](../src/extension/orchestrator/subTaskManager.ts#L294)):

```typescript
toolSet = this._workerToolsService.createWorkerToolSet(
  `${subTask.parentWorkerId}-subtask-${subTask.id}`,
  subTask.worktreePath,
  subTask.planId,
  subTask.parentTaskId,
  subTask.depth,
  { ownerType: 'worker', ownerId: subTask.parentWorkerId }, // ◄── owner context
  inheritedSpawnContext
);
```

### 3.4 Gaps in Identity Model

| Gap | Description | Impact |
|-----|-------------|--------|
| **G1: No chat session identity** | User chat sessions don't have a stable session ID exposed to subtasks | Cannot spawn subtasks from user chat that report back to chat UI |
| **G2: Owner handler lifetime** | Owner handlers are registered transiently during blocking calls | Non-blocking subtasks cannot deliver messages reliably |
| **G3: No sessionUri usage** | `sessionUri` field exists but is never populated or used | Future parent-resume logic has no anchor |

---

## 4. Subtask Lifecycle Event Model

### 4.1 States

Defined in [orchestratorInterfaces.ts](../src/extension/orchestrator/orchestratorInterfaces.ts):

```typescript
type SubTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
```

### 4.2 State Transition Diagram

```
                          createSubTask()
                                │
                                ▼
                          ┌─────────┐
                          │ pending │
                          └────┬────┘
                               │ executeSubTask()
                               ▼
                          ┌─────────┐
              ┌───────────│ running │───────────┐
              │           └────┬────┘           │
              │                │                │
     cancelSubTask()    success path      error path
              │                │                │
              ▼                ▼                ▼
        ┌───────────┐   ┌───────────┐   ┌────────┐
        │ cancelled │   │ completed │   │ failed │
        └───────────┘   └───────────┘   └────────┘
```

### 4.3 Event Emitters (SubTaskManager)

| Event | Interface | Payload | Fired When |
|-------|-----------|---------|------------|
| `onDidChangeSubTask` | `Event<ISubTask>` | Full `ISubTask` object | Any status change |
| `onDidCompleteSubTask` | `Event<ISubTask>` | Full `ISubTask` object | Terminal states: completed, failed, cancelled |

### 4.4 Payload: `ISubTask`

```typescript
interface ISubTask {
  // Identity
  id: string;                    // Correlation ID (e.g., "subtask-abc12345")
  parentWorkerId: string;        // Who spawned this
  parentTaskId: string;          // Parent's task ID
  planId: string;                // Plan context

  // Execution context
  worktreePath: string;          // File system scope
  agentType: string;             // e.g., "@architect", "@reviewer"
  prompt: string;                // The instruction
  expectedOutput: string;        // What parent expects
  model?: string;                // Model override
  depth: number;                 // 0=main, 1=sub, 2=sub-sub
  targetFiles?: string[];        // For conflict detection

  // State
  status: SubTaskStatus;
  result?: ISubTaskResult;       // Populated on completion
  createdAt: number;             // Timestamp
  completedAt?: number;          // Timestamp (if terminal)

  // Permissions
  inheritedPermissions?: IOrchestratorPermissions;
}
```

### 4.5 Payload: `ISubTaskResult`

```typescript
interface ISubTaskResult {
  taskId: string;                // Correlation back to subtask
  status: 'success' | 'partial' | 'failed' | 'timeout';
  output: string;                // Agent response text
  outputFile?: string;           // Optional file reference
  metadata?: Record<string, unknown>;
  error?: string;                // Error message if failed
}
```

### 4.6 Queue Message Correlation

When subtask tools enqueue messages, they include correlation fields:

```typescript
// From a2aTools.ts and a2aSubTaskCompleteTool.ts
_queueService.enqueueMessage({
  id: generateUuid(),            // Message ID (for dedup)
  timestamp: Date.now(),
  priority: 'normal',

  // Correlation
  planId: this._workerContext.planId,
  taskId: subTaskId,             // ◄── correlates to ISubTask.id
  workerId: this._workerContext.workerId,
  worktreePath: this._workerContext.worktreePath,
  depth: this._workerContext.depth,

  // Routing
  owner: this._workerContext.owner,  // ◄── determines handler

  // Content
  type: 'completion' | 'status_update' | 'question' | 'error',
  content: <payload>
});
```

### 4.7 Gaps in Lifecycle Model

| Gap | Description | Impact |
|-----|-------------|--------|
| **G4: No fallback completion** | If child agent crashes or never calls `a2a_subtask_complete`, parent may never know | Stuck subtasks with no notification |
| **G5: Events not surfaced to UI** | `onDidChangeSubTask` / `onDidCompleteSubTask` are internal; no chat progress parts | Users see only notifications, not in-chat bubbles |
| **G6: No worktree stats in result** | `ISubTaskResult` doesn't include changed files / diff stats | Parent cannot show "3 files changed, +45/-12" |

---

## 5. Observability Checklist

### 5.1 Correlation IDs

| ID Type | Format | Source | Used For |
|---------|--------|--------|----------|
| `subTaskId` | `subtask-<uuid8>` | `SubTaskManager.createSubTask()` | Primary correlation across all events/messages |
| `workerId` | `<parentWorkerId>-subtask-<subTaskId>` | `SubTaskManager._executeSubTaskInternal()` | Worker tool set scoping |
| `messageId` | UUID v4 | `generateUuid()` | Queue deduplication |
| `planId` | inherited from parent | Worker context | Plan-level aggregation |
| `taskId` | varies (orchestrator task or subtask ID) | Context-dependent | Task-level tracking |

### 5.2 Logging Points (Current)

| Component | Log Tag | Level | What It Logs |
|-----------|---------|-------|--------------|
| `A2ASpawnSubTaskTool` | `[A2ASpawnSubTaskTool]` | info | Subtask creation, depth, blocking mode |
| `A2ASpawnSubTaskTool` | `[A2ASpawnSubTaskTool]` | debug | Received messages from subtask |
| `A2ASpawnSubTaskTool` | `[A2ASpawnSubTaskTool]` | error | Spawn failures, background task errors |
| `A2ASubTaskCompleteTool` | `[A2ASubTaskCompleteTool]` | info | Completion target (owner description) |
| `A2ASubTaskCompleteTool` | `[A2ASubTaskCompleteTool]` | error | Completion failures |
| `A2ANotifyOrchestratorTool` | `[A2ANotifyOrchestratorTool]` | info | Notification type and target |
| `SubTaskManager` | `[SubTaskManager]` | debug | Create, status update, cancel |
| `SubTaskManager` | `[SubTaskManager]` | warn | Emergency stop handling |
| `SubTaskManager` | `[SubTaskManager]` | info | Orchestrator task creation for UI |
| `OrchestratorQueueService` | console.error | error | Message processing errors |
| `WorkerToolSet` | `[WorkerToolSet]` | debug | Tool set creation, tool enable/disable |

### 5.3 Recommended Additional Logging Points

| Point | Log Tag | Level | Suggested Content |
|-------|---------|-------|-------------------|
| Owner handler registration | `[OrchestratorQueue]` | debug | `Registered handler for owner ${ownerId}` |
| Owner handler disposal | `[OrchestratorQueue]` | debug | `Disposed handler for owner ${ownerId}` |
| Message routing decision | `[OrchestratorQueue]` | debug | `Routing message ${id} to ${ownerType}:${ownerId}` |
| No handler found | `[OrchestratorQueue]` | warn | `No handler for owner ${ownerId}, message ${id} remains queued` |
| Subtask lifecycle transition | `[SubTaskManager]` | info | `Subtask ${id} transition: ${oldStatus} → ${newStatus}` |
| Parent wake-up trigger | `[SubTaskManager]` | info | `Triggering parent wake-up for ${parentWorkerId} on subtask ${id} completion` |

### 5.4 Expected Message Routing Behavior

| Message Type | Source | Expected Handler | Current Behavior |
|--------------|--------|-----------------|------------------|
| `status_update` | Child via `a2a_notify_orchestrator` | Owner handler (parent worker) | ✅ Delivered if handler registered |
| `question` | Child via `a2a_notify_orchestrator` | Owner handler (parent worker) | ✅ Delivered if handler registered |
| `completion` | Child via `a2a_subtask_complete` | Owner handler (parent worker) | ⚠️ Only works in blocking mode |
| `error` | Child via `a2a_notify_orchestrator` | Owner handler (parent worker) | ✅ Delivered if handler registered |
| Any message (no owner handler) | Any | Default handler (orchestrator) | ⚠️ Falls through to orchestrator if no owner handler |

---

## 6. Gap Summary & Phase 2+ Roadmap

### 6.1 Gaps Requiring Resolution

| ID | Gap | Severity | Addressed In |
|----|-----|----------|--------------|
| G1 | No chat session identity for user-chat subtasks | Medium | Phase 2 |
| G2 | Owner handler lifetime (non-blocking spawns) | **High** | Phase 2 |
| G3 | `sessionUri` unused | Low | Phase 2 |
| G4 | No fallback completion on agent crash | **High** | Phase 2 |
| G5 | Events not surfaced to chat UI | **High** | Phase 3 |
| G6 | No worktree stats in result | Medium | Phase 5 |

### 6.2 Implementation Notes for Phase 2

**Persistent Owner Handler** (addresses G2, G4):

1. When a parent session (worker or chat) starts, register a long-lived owner handler keyed by session ID.
2. Handler should persist across tool invocations within that session.
3. Handler should inject completion messages into parent's conversation as synthetic "user" messages.
4. On session disposal, unregister handler and clean up pending messages.

**Fallback Completion** (addresses G4):

1. In `SubTaskManager.executeSubTask()`, wrap execution in try/catch.
2. On any error (including timeout), synthesize a `failed` result.
3. Enqueue a completion message to owner even if child never called `a2a_subtask_complete`.
4. Fire `onDidCompleteSubTask` for UI/monitoring.

**Parent Wake-Up** (Phase 2 core):

1. When owner handler receives a `completion` message:
   - Format as synthetic user message with structured data
   - Inject into parent conversation
   - Trigger parent agent loop to continue

---

## 7. Appendix: Code References

### A. Key Files

| File | Purpose |
|------|---------|
| [a2aTools.ts](../src/extension/tools/node/a2aTools.ts) | Spawn, await, notify tools |
| [a2aSubTaskCompleteTool.ts](../src/extension/tools/node/a2aSubTaskCompleteTool.ts) | Completion tool |
| [subTaskManager.ts](../src/extension/orchestrator/subTaskManager.ts) | Lifecycle management |
| [orchestratorQueue.ts](../src/extension/orchestrator/orchestratorQueue.ts) | Message queue + routing |
| [workerToolsService.ts](../src/extension/orchestrator/workerToolsService.ts) | Worker context + tool scoping |
| [orchestratorInterfaces.ts](../src/extension/orchestrator/orchestratorInterfaces.ts) | Interface definitions |
| [safetyLimits.ts](../src/extension/orchestrator/safetyLimits.ts) | Depth limits, rate limits |

### B. Interface Quick Reference

```typescript
// Parent identity (orchestratorQueue.ts)
interface IOwnerContext {
  ownerType: 'orchestrator' | 'worker' | 'agent';
  ownerId: string;
  sessionUri?: string;
}

// Worker context (workerToolsService.ts)
interface IWorkerContext {
  workerId: string;
  worktreePath: string;
  planId?: string;
  taskId?: string;
  depth: number;
  owner?: IWorkerOwnerContext;
  spawnContext: 'orchestrator' | 'agent';
}

// Subtask (orchestratorInterfaces.ts)
interface ISubTask {
  id: string;
  parentWorkerId: string;
  parentTaskId: string;
  planId: string;
  worktreePath: string;
  agentType: string;
  prompt: string;
  expectedOutput: string;
  model?: string;
  depth: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: ISubTaskResult;
  targetFiles?: string[];
  createdAt: number;
  completedAt?: number;
}

// Result (orchestratorInterfaces.ts)
interface ISubTaskResult {
  taskId: string;
  status: 'success' | 'partial' | 'failed' | 'timeout';
  output: string;
  outputFile?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

// Queue message (orchestratorQueue.ts)
interface IOrchestratorQueueMessage {
  id: string;
  timestamp: number;
  priority: 'critical' | 'high' | 'normal' | 'low';
  planId: string;
  taskId: string;
  workerId: string;
  worktreePath: string;
  subTaskId?: string;
  depth?: number;
  owner?: IOwnerContext;
  type: 'status_update' | 'permission_request' | 'question' | 'completion' | 'error' | 'answer' | 'refinement' | 'retry_request';
  content: unknown;
}
```

---

## 8. Acceptance Criteria (Phase 1)

- [x] Document current A2A flows with blocking vs queue-routed distinction
- [x] Define `IOwnerContext` schema and identity propagation
- [x] Map subtask lifecycle states and events to `SubTaskManager`
- [x] Provide observability checklist with correlation IDs and logging points
- [x] Identify gaps (G1–G6) with severity and phase assignments
- [x] Provide implementation notes for Phase 2

---

## 9. Phase 3-5 Improvements (Implemented)

### 9.1 In-Chat Progress Bubbles (Phase 3)

The A2A spawn tools now display progress directly in the chat response stream instead of VS Code notification popups:

**Implementation:**
- **[SubtaskProgressService](../src/extension/orchestrator/subtaskProgressService.ts)**: Abstracts progress reporting between chat streams and fallback notifications
- Stream registration: `orchestratorChatSessionParticipant` registers its `ChatResponseStream` with the progress service
- Progress updates appear as `stream.progress()` calls in the parent's chat bubble

**Key Components:**
```typescript
// ISubtaskProgressService provides two modes:
// 1. Chat stream mode: Updates shown inline in chat
// 2. Fallback mode: VS Code notification popups

interface ISubtaskProgressService {
  registerStream(ownerId: string, stream: vscode.ChatResponseStream): IDisposable;
  createProgress(ownerId: string, options: ISubtaskProgressOptions): ISubtaskProgressHandle;
  createParallelRenderer(ownerId: string): ParallelSubtaskProgressRenderer;
}
```

### 9.2 Parent Wake-Up (Phase 2)

Parents now automatically wake up when subtasks complete:

**Implementation:**
- **[ParentCompletionService](../src/extension/orchestrator/parentCompletionService.ts)**: Persistent owner handlers that outlive tool invocations
- **[WorkerSessionWakeUpAdapter](../src/extension/orchestrator/parentCompletionService.ts)**: Injects completion messages as synthetic user messages

**Completion Payload:**
```typescript
interface IParentCompletionMessage {
  subTaskId: string;
  agentType: string;
  taskPrompt: string;
  response: string;
  worktreePath: string;
  status: 'success' | 'partial' | 'failed' | 'timeout';
  error?: string;
  timestamp: number;
  // Phase 5 additions:
  changedFilesCount?: number;
  insertions?: number;
  deletions?: number;
}
```

### 9.3 Depth Limits (Phase 4)

Subtask spawning now respects configurable depth limits:

| Spawn Context | Max Depth | Effect |
|---------------|-----------|--------|
| Orchestrator-deployed worker | 2 | Can spawn subtasks that spawn one more level |
| Standalone agent session | 1 | Can spawn subtasks, but those cannot spawn further |

**Configuration:**
```typescript
// ISafetyLimitsConfig
{
  maxSubtaskDepth: 2,                    // Orchestrator workers
  maxSubtaskDepthForAgentContext: 1,     // Standalone agents
  maxConcurrentSubtasks: 10,
  maxTotalSubtasksPerWorker: 50,
  // ...
}
```

### 9.4 Worktree Semantics (Phase 5)

**Dirty Workspace Policy:**
- **Fail-fast**: Worktree creation fails if the main workspace has uncommitted changes
- Error message instructs user to commit, stash, or discard changes

**Completion Payloads Include:**
- `worktreePath`: Full path to the subtask's worktree
- `changedFilesCount`: Number of files modified
- `insertions`: Lines added
- `deletions`: Lines removed

**Parent-Side Helpers:**
```typescript
// Get changed files list
getWorktreeChangedFiles(worktreePath: string): Promise<string[]>

// Open worktree in new VS Code window
openWorktreeInNewWindow(worktreePath: string, options?: { newWindow?: boolean }): Promise<void>

// Show diff for worktree changes
showWorktreeDiff(worktreePath: string): Promise<void>

// Interactive action menu
showWorktreeActionsMenu(worktreePath: string, branchName: string, diffStats?): Promise<IWorktreeAction | undefined>
```
