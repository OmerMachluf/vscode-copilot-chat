# Session ID Analysis & Fix Plan

## Executive Summary

The multi-agent orchestration system broke when attempting to fix parent notification issues. The root cause is **confusion between multiple types of session/identity IDs** and when each should be used.

## The Different IDs in the System

| ID Type | Purpose | Format | Lifetime | Used By |
|---------|---------|--------|----------|---------|
| **agentId** | Agent role/type | `@architect`, `@agent`, `@orchestrator` | Static | Agent selection, instructions |
| **taskId** | Unique task identifier | `task-{uuid}` | Task lifecycle | Orchestrator plans, task tracking |
| **planId** | Unique plan identifier | `plan-{uuid}` | Plan lifecycle | Multi-task coordination |
| **workerId** | Worker instance identifier | `worker-{short-uuid}` OR chat sessionId | Worker lifecycle | Worker session instance |
| **sessionId** (VS Code Chat) | Chat conversation ID | UUID format: `{uuid}` | Persistent across restarts | VS Code chat UI, tool calls |
| **sessionUri** | VS Code session resource | `orchestrator:/{task.id}` | Task lifecycle | Tool invocation token |
| **subTaskId** | Subtask identifier | `subtask-{uuid}` | Subtask lifecycle | Subtask tracking |

## Critical Distinction: Chat Sessions vs Background Workers

### Chat-Based Workers (ClaudeCodeSession)
- **Created from**: Direct VS Code chat interactions
- **sessionId**: Real VS Code chat UUID (e.g., `879a9dbc-9ce4-4b0f-880d-8785c1a67272`)
- **workerId**: SHOULD BE the same as sessionId for persistence
- **Purpose**: Interactive chat conversations that persist across VS Code restarts
- **Tool routing**: Tools invoked in this worker's chat window need matching sessionId

### Background Workers (Orchestrator-Deployed)
- **Created from**: Orchestrator deploying plan tasks
- **sessionId**: Should be `undefined` (NOT a chat session)
- **workerId**: Generated ID like `worker-abc123`
- **Purpose**: Execute plan tasks, not tied to chat UI
- **Tool routing**: Tools route to worktree, not chat window

## The Problem That Was Tried to Be Fixed

**Original Issue**: Parents weren't being notified when subtasks completed.

**Why**: The worker ID used for routing messages was **changing** across redeployments:
```
1. Worker deployed with ID: worker-abc123
2. Subtask spawned, tries to notify parent: worker-abc123
3. Worker redeployed (e.g., VS Code restart)
4. New worker ID: worker-def456
5. Subtask completion messages still route to: worker-abc123 ❌ LOST!
```

## The Attempted Fix (And What Broke)

### Changes Made:
1. **orchestratorServiceV2.ts**:
   - ✅ Fixed toolInvocationToken to use `task.id` (correct!)
   - ❌ Changed to reuse `task.workerId` instead of `task.sessionId`
   - Added worker cleanup on redeploy

2. **subTaskManager.ts**:
   - ❌ Added UUID validation that filters out orchestrator workers
   - ❌ Only inherits sessionId if it matches UUID pattern
   - Result: Orchestrator subtasks get `sessionId = undefined`

3. **claudeA2AMcpServer.ts**:
   - ❌ Removed `sessionId: workerContext.workerId` from plan task creation

### What Broke:

#### 1. **Tool Execution Failure**
```
VS Code expects: toolInvocationToken.sessionId matches a registered chat session
What happened: sessionId = orchestrator:/task-{uuid}
VS Code says: "Tool called for unknown chat session" ❌
```

**Root Cause**: The toolInvocationToken.sessionId must match a session registered with VS Code's chat session provider. Using `orchestrator:/task-{uuid}` doesn't match any registered session.

#### 2. **Parent Notification Failure**
```
Subtask completes → tries to notify parent
Parent workerId changed (redeploy)
Message routing fails ❌
```

**Root Cause**: Worker IDs are not stable across redeployments, but the routing system expects them to be.

## Root Cause Analysis

The fundamental issue is **three competing requirements**:

1. **Tool UI Requirement**: `toolInvocationToken.sessionId` must match a registered VS Code chat session for tool bubbles to appear
2. **Message Routing Requirement**: Parent worker IDs must be stable so subtasks can deliver completion messages
3. **Persistence Requirement**: Sessions must survive VS Code restarts

## The Correct Architecture

### For ClaudeCodeSession (Chat-Based) Workers:

```typescript
// Task creation
task.sessionId = <VS Code chat UUID>  // e.g., "879a9dbc..."
task.workerId = undefined             // Will be set on deploy

// Worker creation (on deploy)
worker.id = task.sessionId            // Use chat UUID as worker ID
task.workerId = worker.id             // Store back on task

// Tool token
toolInvocationToken.sessionId = `orchestrator:/${task.id}`
toolInvocationToken.sessionResource = Uri(scheme: 'orchestrator', path: `/${task.id}`)

// Subtask routing
subtask.parentWorkerId = worker.id    // = chat UUID
```

**Key Points**:
- ✅ Worker ID = Chat Session ID (persistent)
- ✅ Tools route via task.id
- ✅ Subtasks route via worker.id (which is stable)
- ✅ survives VS Code restart (chat UUID doesn't change)

### For Orchestrator Background Workers:

```typescript
// Task creation
task.sessionId = undefined            // Not a chat session
task.workerId = undefined             // Will be set on deploy

// Worker creation (on deploy)
worker.id = `worker-{short-uuid}`     // Generated ID
task.workerId = worker.id             // Store on task for potential reuse

// Tool token
toolInvocationToken.sessionId = `orchestrator:/${task.id}`
toolInvocationToken.sessionResource = Uri(scheme: 'orchestrator', path: `/${task.id}`)

// Subtask routing
subtask.parentWorkerId = worker.id    // Generated ID
```

**Key Points**:
- ⚠️ Worker ID is NOT persistent (changes on redeploy)
- ✅ Tools still route via task.id
- ⚠️ Subtask routing breaks on redeploy (unfixable without sessionId)

## The Real Solution

There are TWO separate fixes needed:

### Fix 1: Tool Execution (CRITICAL)

**Problem**: Tool invocation token sessionId doesn't match registered sessions.

**Solution**: The `orchestrator` chat session provider must register sessions using **task.id**:

```typescript
// In orchestratorChatSessionContentProvider.ts
provideChatSessionContent(resource: vscode.Uri): vscode.ChatSession {
    // resource.path = "/task-{uuid}" from orchestrator:/{task.id}
    const taskId = resource.path.slice(1); // Remove leading /
    const task = orchestratorService.getTask(taskId);

    // Return chat session for this task
    return {
        history: buildHistoryFromTask(task),
        requestHandler: createTaskRequestHandler(task),
    };
}
```

**Status**: This should already be working if the provider is implemented correctly. Need to verify.

### Fix 2: Parent Notification (REQUIRES ARCHITECTURE CHANGE)

**Problem**: Worker IDs change on redeploy, breaking subtask → parent routing.

**Solution Option A - Persistent Worker IDs** (Recommended):

1. Store `task.workerId` persistently in orchestrator state
2. On redeploy, reuse the same worker ID:
   ```typescript
   // In deploy()
   const workerId = task.workerId ?? task.sessionId ?? generateWorkerId();
   task.workerId = workerId; // Store persistently

   const worker = new WorkerSession(..., workerId);
   ```

3. Update message routing to use task.workerId as destination:
   ```typescript
   // In parent completion service
   const parentWorkerId = task.workerId; // NOT task.sessionId
   routeMessageToWorker(parentWorkerId, completionMessage);
   ```

**Solution Option B - Task-Based Routing**:

Route messages to taskId instead of workerId:
```typescript
// Subtask completion
notifyParentTask(parentTaskId, completionMessage);

// Orchestrator routes to active worker for that task
const worker = getActiveWorkerForTask(parentTaskId);
worker.receiveMessage(completionMessage);
```

**Pros/Cons**:
- Option A: Simpler, preserves existing routing architecture
- Option B: More resilient to worker restarts, but requires refactoring routing layer

## Recommended Immediate Fix

### Step 1: Revert the Problematic Changes

```bash
# Revert the changes that broke tool execution
git checkout HEAD -- src/extension/orchestrator/subTaskManager.ts
git checkout HEAD -- src/extension/agents/claude/node/claudeA2AMcpServer.ts
```

### Step 2: Keep the Good Changes

The change to use `task.id` for toolInvocationToken is CORRECT - keep that:
```typescript
// In orchestratorServiceV2.ts (KEEP THIS)
const workerSessionUri = `orchestrator:/${task.id}`;  // ✅
const forgedToken = {
    sessionId: workerSessionUri,
    sessionResource: vscode.Uri.from({
        scheme: 'orchestrator',
        path: `/${task.id}`,
    }),
};
```

### Step 3: Implement Persistent Worker IDs

In `orchestratorServiceV2.ts deploy()`:
```typescript
// Determine worker ID (priority order):
// 1. Reuse existing workerId if task is being redeployed
// 2. Use sessionId for chat-based workers (ClaudeCodeSession)
// 3. Generate new ID for background workers
const workerId = task.workerId ?? task.sessionId ?? `worker-${generateUuid().substring(0, 8)}`;

// Store workerId on task for future redeploys
task.workerId = workerId;

// Create worker with stable ID
const worker = new WorkerSession(
    task.name,
    task.description,
    worktreePath,
    task.planId,
    baseBranch,
    agentId,
    composedInstructions.instructions,
    effectiveModelId,
    workerId, // ← Stable across redeploys
);

this._logService.info(`[Orchestrator:deploy] Worker created with stable ID: workerId=${workerId}, taskId=${task.id}, sessionId=${task.sessionId ?? 'none'}`);
```

### Step 4: Verify Orchestrator Chat Session Provider

Ensure `orchestratorChatSessionContentProvider.ts` correctly maps `task.id` to chat sessions:

```typescript
// This is what VS Code calls when tools are invoked
provideChatSessionContent(resource: vscode.Uri): vscode.ChatSession {
    const taskId = resource.path.slice(1); // "/task-abc" → "task-abc"
    const task = this.orchestratorService.getTask(taskId);

    if (!task) {
        throw new Error(`Unknown task ID: ${taskId}`);
    }

    const worker = this.orchestratorService.getWorkerSession(task.workerId);
    if (!worker) {
        throw new Error(`No active worker for task ${taskId}`);
    }

    return {
        history: this.buildHistory(worker),
        requestHandler: this.createHandler(worker),
    };
}
```

## Testing Plan

1. **Test Tool Execution**:
   ```
   - Deploy orchestrator task
   - Invoke tool (Read, Edit, etc.)
   - Verify tool bubble appears in UI ✅
   - Check logs for "Tool called for unknown chat session" ❌
   ```

2. **Test Parent Notification**:
   ```
   - Deploy parent task
   - Spawn subtask
   - Complete subtask
   - Verify parent receives completion message ✅
   - Redeploy parent worker (simulate restart)
   - Complete another subtask
   - Verify parent still receives message ✅
   ```

3. **Test Chat Session Persistence**:
   ```
   - Start chat session task
   - Restart VS Code
   - Resume same chat session
   - Verify workerId unchanged ✅
   - Spawn subtask
   - Verify routing works ✅
   ```

## Implementation Checklist

- [ ] Revert `subTaskManager.ts` changes
- [ ] Revert `claudeA2AMcpServer.ts` changes
- [ ] Keep `orchestratorServiceV2.ts` toolInvocationToken fix
- [ ] Implement persistent workerId logic in `deploy()`
- [ ] Add workerId field to WorkerTask interface
- [ ] Verify orchestratorChatSessionContentProvider implementation
- [ ] Add logging for workerId stability tracking
- [ ] Test tool execution
- [ ] Test parent notification
- [ ] Test chat session persistence
- [ ] Update PERSISTENT_SESSION_IDS.md with corrected architecture

## Long-Term Improvements

1. **Unified Session Registry**: Create a central service that manages the mapping:
   ```
   sessionId (VS Code chat UUID) → taskId → workerId → worker instance
   ```

2. **Explicit Resumption API**: Provide clear API for resuming sessions:
   ```typescript
   orchestrator.resumeSession(sessionId) → finds/redeploys worker with stable ID
   ```

3. **Health Monitoring Fix**: Update health monitor to use stable worker IDs:
   ```typescript
   healthMonitor.startMonitoring(task.workerId); // Not worker.id
   ```

4. **Documentation**: Create architecture decision record (ADR) documenting:
   - When to use sessionId vs workerId vs taskId
   - Routing guarantees and limitations
   - Persistence strategy

## Conclusion

The attempted fix was on the right track but made three mistakes:

1. ❌ Filtered out orchestrator background workers from having sessionId (correct intent, wrong execution)
2. ❌ Removed sessionId from plan task creation (broke routing)
3. ❌ Didn't implement stable workerId for background workers (root cause still exists)

The correct fix is:
1. ✅ Use `task.id` for tool invocation token (already done)
2. ✅ Use stable `task.workerId` for message routing (needs implementation)
3. ✅ Use `task.sessionId` for chat session tracking (keep existing)
4. ✅ Ensure orchestrator chat session provider maps `task.id` correctly (verify)

Once these are in place, the system will work correctly for both chat-based and background workers, with stable routing that survives restarts.
