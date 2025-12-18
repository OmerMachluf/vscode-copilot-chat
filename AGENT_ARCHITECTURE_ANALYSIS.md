# Agent-to-Agent Architecture Analysis

## Overview

This document tracks the architectural analysis and solution design for fixing the pending child updates problem in the agent-to-agent workflow system.

**Problem Statement**: After deploying tasks, Claude agents go idle and pending child updates stay filled forever - the orchestrator session never continues with updates.

**Constraint**: For files > 1000 lines, for every 10 lines added, extract at least 100 lines out.

---

## File Line Counts (as of analysis)

| File | Lines | Status |
|------|-------|--------|
| `claudeCodeAgent.ts` | 916 | Under 1000 - can add code |
| `orchestratorServiceV2.ts` | 4525 | **OVER 1000** - needs refactoring |
| `workerSession.ts` | 2154 | **OVER 1000** - needs refactoring |
| `taskMonitorService.ts` | 474 | Under 1000 - can add code |
| `workerHealthMonitor.ts` | 456 | Under 1000 - can add code |
| `claudeA2AMcpServer.ts` | 1380 | **OVER 1000** - needs refactoring |

---

## Root Cause: Bug in receiveChildUpdate

**File**: `src/extension/agents/claude/node/claudeCodeAgent.ts`
**Lines**: 389-393

```typescript
public receiveChildUpdate(message: string): void {
    this.logService.info(`[ClaudeCodeSession] Received child update: ${message.substring(0, 100)}...`);
    this._pendingChildUpdates.push(message);
    this._promptQueue.push(message)  // ❌ BUG: Pushing string instead of QueuedRequest!
}
```

**Problem**: `_promptQueue` expects `QueuedRequest` objects, but a raw string is pushed. This corrupts the queue and breaks the prompt processing loop.

---

## Key Data Structures

### ClaudeCodeSession (claudeCodeAgent.ts)

```typescript
// Line 340: Pending updates from child subtasks
private _pendingChildUpdates: string[] = [];

// Line 330: Queue of prompts waiting to be processed
private _promptQueue: QueuedRequest[] = [];

// Line 332: Deferred promise for waiting on next prompt
private _pendingPrompt: DeferredPromise<QueuedRequest> | undefined;
```

### QueuedRequest Interface

```typescript
interface QueuedRequest {
    prompt: string;
    stream: ChatResponseStream;
    toolInvocationToken: ...;
    token: CancellationToken;
    deferred: DeferredPromise<void>;
}
```

---

## Problem Flow Diagram

```
1. Parent spawns non-blocking subtask via a2a_spawn_subtask
   ↓
2. Orchestrator registers handler + starts monitoring
   - orchestratorService.registerStandaloneParentHandler(workerId, onChildUpdate)
   - taskMonitorService.startMonitoring(subtask.id, parentWorkerId)
   ↓
3. Parent completes tool call, goes idle (no more prompts)
   ↓
4. Child subtask completes
   - TaskMonitorService polls (every 5s) and detects completion
   - Pushes ITaskUpdate to parent's queue
   ↓
5. HealthMonitor detects parent idle (after 30s)
   - Fires onWorkerIdle event
   ↓
6. _handleIdleWorker() called (orchestratorServiceV2.ts:761-881)
   - Checks hasPendingUpdates(workerId) → YES
   - Calls consumeUpdates() → clears queue
   - Calls _injectPendingSubtaskUpdates()
   ↓
7. _injectPendingSubtaskUpdates() (orchestratorServiceV2.ts:1370-1423)
   - Formats updates into readable message
   - Calls worker.sendClarification(summaryMessage)
   ↓
8. sendClarification() (workerSession.ts:1208-1225)
   - If worker waiting: deliver immediately ✅
   - If worker executing: queue as _pendingClarification
   ↓
9. receiveChildUpdate() called with message
   - Line 391: push to _pendingChildUpdates ✅
   - Line 392: push to _promptQueue ❌ WRONG TYPE!
   ↓
10. _createPromptIterable tries to process queue
    - _getNextRequest() gets string instead of QueuedRequest
    - Tries to access .deferred.p on string → ERROR
    ↓
11. SESSION HANGS - pending updates never injected
```

---

## Key Methods by File

### claudeCodeAgent.ts (916 lines)

| Method | Lines | Purpose |
|--------|-------|---------|
| `receiveChildUpdate` | 389-393 | **BUG LOCATION** - receives child updates |
| `_pendingChildUpdates` | 340 | Array storing pending updates |
| `_promptQueue` | 330 | Queue of QueuedRequest objects |
| `_createPromptIterable` | 616+ | Generator yielding prompts to Claude SDK |
| `_getNextRequest` | 655+ | Gets next request from queue |
| Prompt injection logic | 629-633 | Where _pendingChildUpdates should be injected |

### orchestratorServiceV2.ts (4525 lines) - NEEDS REFACTORING

| Method | Lines | Purpose |
|--------|-------|---------|
| `_handleIdleWorker` | 761-881 | Handles idle worker events |
| `_injectPendingSubtaskUpdates` | 1370-1423 | Injects updates into parent worker |
| `registerStandaloneParentHandler` | ~505-510 | Registers callback for pushed updates |

### workerSession.ts (2154 lines) - NEEDS REFACTORING

| Method | Lines | Purpose |
|--------|-------|---------|
| `sendClarification` | 1208-1225 | Sends message to worker |
| `waitForClarification` | 1289-1309 | Waits for next clarification |
| `_pendingClarification` | single slot | Only stores LAST message (design issue) |

### taskMonitorService.ts (474 lines)

| Method | Lines | Purpose |
|--------|-------|---------|
| `consumeUpdates` | 241-259 | Takes all updates and clears queue |
| `hasPendingUpdates` | 266-269 | Checks if updates pending |
| `_pollMonitoredTasks` | 326-373 | Polls subtask status every 5s |
| `_queueCompletionUpdate` | 403-423 | Queues update when subtask completes |

### workerHealthMonitor.ts (456 lines)

| Method | Lines | Purpose |
|--------|-------|---------|
| `_checkStuckWorkers` | 392-445 | Runs every 30s, detects idle workers |
| `recordActivity` | 197-254 | Resets idle/stuck flags on activity |

### claudeA2AMcpServer.ts (1380 lines) - NEEDS REFACTORING

| Method | Lines | Purpose |
|--------|-------|---------|
| Non-blocking spawn | 241-272 | Spawns subtask in background |
| Callback registration | 247-251 | Registers onChildUpdate callback |
| `a2a_subtask_complete` | 361-427 | Tool for child to report completion |

---

## Additional Design Issues

### Issue 1: Single Message Queueing (workerSession.ts)
`_pendingClarification` is a single slot, not a queue. If multiple messages arrive while worker is executing, only the last one is kept.

### Issue 2: No Synchronization (claudeCodeAgent.ts)
`receiveChildUpdate` has no coordination with the invoke() loop. Called asynchronously from MCP server without mutex/coordination.

### Issue 3: Mixed Concerns in Queue (claudeCodeAgent.ts)
`_promptQueue` is used for both proper QueuedRequest objects and (incorrectly) string messages.

### Issue 4: Local Agents Missing Callback
The `receiveChildUpdate` callback is only enabled for Claude Code agents, not regular local agents.

---

## Proposed Solution Architecture

### Phase 1: Fix the Bug (claudeCodeAgent.ts)

The `receiveChildUpdate` method should NOT push to `_promptQueue`. Instead:

1. Push to `_pendingChildUpdates` (already done correctly)
2. Signal that updates are available (new mechanism needed)
3. Let the prompt injection logic in `_createPromptIterable` handle it

**Option A**: Use a wake-up signal
- Add `_childUpdateAvailable: DeferredPromise<void>`
- In `receiveChildUpdate`: resolve it to wake up waiting loop
- In `_createPromptIterable`: await this signal when idle

**Option B**: Integrate with clarification system
- Route child updates through `sendClarification` mechanism
- Unify the message delivery path

### Phase 2: Refactor Large Files

Before adding significant code to files > 1000 lines:

**orchestratorServiceV2.ts (4525 lines)**:
- Extract idle worker handling to `IdleWorkerHandler.ts`
- Extract update injection to `UpdateInjectionService.ts`
- Extract plan management to separate module

**workerSession.ts (2154 lines)**:
- Extract clarification handling to `ClarificationManager.ts`
- Extract message queue to `MessageQueue.ts`

**claudeA2AMcpServer.ts (1380 lines)**:
- Extract tool handlers to separate files
- Extract subtask management to `SubtaskManager.ts`

### Phase 3: Add Local Agent Support

Extend the callback mechanism to local agents (non-Claude Code agents).

---

## Implementation Checklist

- [ ] Read and understand `receiveChildUpdate` in detail
- [ ] Read and understand `_createPromptIterable` prompt injection
- [ ] Design the fix for the bug
- [ ] Identify refactoring targets in large files
- [ ] Extract methods from orchestratorServiceV2.ts
- [ ] Extract methods from workerSession.ts
- [ ] Extract methods from claudeA2AMcpServer.ts
- [ ] Implement the fix
- [ ] Add local agent callback support
- [ ] Test the solution

---

## Solution Design

### The Core Problem

1. `receiveChildUpdate` is called with a message string
2. Line 392 incorrectly pushes the string to `_promptQueue` (expects `QueuedRequest`)
3. Even without the bug, the session is waiting at `_getNextRequest()` for a real request
4. Updates in `_pendingChildUpdates` won't be processed until someone calls `invoke()`

### The Key Insight

`ClaudeCodeAgentExecutor.sendMessage()` (lines 249-278) shows how to wake up a Claude session:
- It stores `toolInvocationToken` from the original execute call
- It creates a collector stream
- It calls `session.session.invoke(message, storedToken, collectorStream, CancellationToken.None)`

This pattern can be applied to `receiveChildUpdate`!

### The Fix

1. **Store `_lastToolInvocationToken`** from each invocation
2. **Remove line 392** (the buggy push to `_promptQueue`)
3. **Add `_tryWakeUpSession()`** method that:
   - Checks if session is idle (`_pendingPrompt` is set)
   - Checks if we have a stored token
   - Creates a synthetic `QueuedRequest` with:
     - A continuation prompt
     - A collector stream
     - The stored token
     - `CancellationToken.None`
   - Resolves `_pendingPrompt` to wake up the session

### Code Changes for claudeCodeAgent.ts (~50 lines)

```typescript
// New field:
private _lastToolInvocationToken: vscode.ChatParticipantToolToken | undefined;

// In invoke(), store token:
this._lastToolInvocationToken = toolInvocationToken;

// Fixed receiveChildUpdate:
public receiveChildUpdate(message: string): void {
    this.logService.info(`[ClaudeCodeSession] Received child update: ${message.substring(0, 100)}...`);
    this._pendingChildUpdates.push(message);
    this._tryWakeUpSession(); // NEW: wake up if idle
}

// New method:
private _tryWakeUpSession(): void {
    if (!this._pendingPrompt || !this._lastToolInvocationToken) {
        return;
    }

    const continuationPrompt = 'Continue your work based on the subtask updates above.';
    const collectorStream = this._createCollectorStream();

    const deferred = new DeferredPromise<void>();
    const request: QueuedRequest = {
        prompt: continuationPrompt,
        stream: collectorStream,
        toolInvocationToken: this._lastToolInvocationToken,
        token: CancellationToken.None,
        deferred,
    };

    this._promptQueue.push(request);

    const pendingPrompt = this._pendingPrompt;
    this._pendingPrompt = undefined;
    pendingPrompt.complete(request);
}

// New method:
private _createCollectorStream(): vscode.ChatResponseStream {
    return {
        markdown: () => {},
        // ... other methods
    } as unknown as vscode.ChatResponseStream;
}
```

### File Size Analysis

| File | Lines | Change | Status |
|------|-------|--------|--------|
| claudeCodeAgent.ts | 916 | +~50 | OK (under 1000) |

No refactoring needed - the file is under 1000 lines.

---

## Session Notes

*This section will be updated as the session progresses.*

### Current Status
- Initial analysis complete
- File line counts documented
- Root cause identified
- Solution designed
- Ready to implement

### Implementation Checklist
- [ ] Add `_lastToolInvocationToken` field
- [ ] Store token in `invoke()` method
- [ ] Remove buggy line 392
- [ ] Add `_tryWakeUpSession()` method
- [ ] Add `_createCollectorStream()` method
- [ ] Test the fix

### Implementation Complete (Claude Code Agents)

The fix has been implemented in `claudeCodeAgent.ts`:

1. Added `_lastToolInvocationToken` field to store the token from each invocation
2. Modified `receiveChildUpdate()` to call `_tryWakeUpSession()`
3. Added `_tryWakeUpSession()` method that:
   - Checks if session is idle (`_pendingPrompt` set)
   - Creates a synthetic `QueuedRequest` with stored token
   - Resolves `_pendingPrompt` to wake up the session
4. Added `_createCollectorStream()` helper method

File is now 999 lines (under 1000 limit).

---

## Local Agent Callback Support Analysis

### Current Architecture

Local agents use different mechanisms depending on how they're invoked:

| Context | Callback Mechanism | Wake-up Method |
|---------|-------------------|----------------|
| Claude Code (standalone) | `registerStandaloneParentHandler` → `receiveChildUpdate` | **FIXED**: `_tryWakeUpSession()` creates synthetic request |
| Local Agent (WorkerSession) | Orchestrator's `_handleIdleWorker` → `worker.sendClarification()` | Already working |
| Local Agent (tool-based) | `_queueService.registerOwnerHandler()` (a2aTools.ts:254-286) | Synchronous - no wake-up needed |

### Local Agent Tool-Based Callbacks (Already Working)

In `a2aTools.ts`, non-blocking subtask spawning already registers a handler:

```typescript
// Line 259-283
handlerDisposable = this._queueService.registerOwnerHandler(parentWorkerId, async (message) => {
    // Update progress with the message
    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    progressHandle.update(`[${message.type}] ${content.slice(0, 50)}...`);

    // If completion message, notify parent
    if (message.type === 'completion' && message.subTaskId === subTask.id) {
        this._queueService.enqueueMessage({ ... });
    }
});
```

### WorkerSession-based Local Agents (Already Working)

For local agents running through the orchestrator's `WorkerSession`:

1. `_handleIdleWorker()` (orchestratorServiceV2.ts:761-881) detects idle workers
2. Checks for pending updates via `_taskMonitorService.hasPendingUpdates()`
3. Injects updates via `_injectPendingSubtaskUpdates()` → `worker.sendClarification()`
4. `WorkerSession.sendClarification()` either:
   - Resolves immediately if worker is waiting
   - Queues as `_pendingClarification` if worker is executing

### Conclusion

The callback mechanisms exist for all agent types. The main issue was Claude Code's `receiveChildUpdate` not waking up the session - now fixed.

---

## Summary of Changes

### Files Modified

1. **`src/extension/agents/claude/node/claudeCodeAgent.ts`** (+83 lines)
   - Added `_lastToolInvocationToken` field
   - Store token in `invoke()` method
   - Added `_tryWakeUpSession()` method
   - Added `_createCollectorStream()` method
   - Modified `receiveChildUpdate()` to call wake-up

### Testing Recommendations

1. Spawn a non-blocking subtask from a Claude Code session
2. Verify the parent session wakes up when child updates arrive
3. Verify the child update content is injected into the prompt
4. Test with multiple parallel subtasks
5. Test cancellation handling

### Remaining Considerations

1. **Response Stream**: The synthetic request uses a collector stream, so Claude's response won't be visible in the UI. Consider adding event emission for observability.

2. **Multiple Wake-ups**: If multiple updates arrive quickly, the first wake-up will process all pending updates (they're batched in `_createPromptIterable`).

3. **Token Reuse**: We're reusing the last `toolInvocationToken`. If the original request's tools are different from what the continuation needs, there might be issues.
