# Persistent Session IDs for Orchestration

## Problem Statement

Previously, orchestration state was tied to ephemeral worker IDs that were generated on deployment:
- Workers had IDs like `worker-abc123` generated at runtime
- If a worker died or VS Code restarted, the worker ID changed
- Child tasks couldn't reconnect to their parent
- Users couldn't resume orchestration from the same chat conversation

## Solution: VS Code Chat Session ID as Persistent Identifier

The VS Code chat conversation already has a stable, persistent session ID that survives restarts. We use this session ID for **ClaudeCodeSession workers only** - these are workers directly tied to VS Code chat conversations.

## CRITICAL DISTINCTION

**sessionId should ONLY be used as workerId for ClaudeCodeSession workers** (workers created from VS Code chat that ARE actual chat sessions).

**Orchestrator background workers** (tasks created by orchestrator agents or through plans) are NOT chat sessions and should NOT use sessionId as workerId. They use generated worker IDs instead.

### Why This Matters

When tools are invoked by a worker, VS Code's tool system looks up the worker's ID as a chat session. If the worker ID is not a registered chat session, VS Code throws "Tool called for unknown chat session" errors.

## Architecture Changes

### 1. WorkerTask Tracks Session ID

**File:** `orchestratorServiceV2.ts`

```typescript
export interface WorkerTask {
    // ... existing fields
    /**
     * Persistent session ID from VS Code chat conversation.
     * This ID survives VS Code restarts and allows resuming orchestration
     * with the same session even if workers are redeployed.
     */
    readonly sessionId?: string;
}
```

Tasks can now be associated with a persistent chat session.

### 2. WorkerSession Accepts Session ID

**File:** `workerSession.ts`

```typescript
constructor(
    name: string,
    task: string,
    worktreePath: string,
    planId?: string,
    baseBranch?: string,
    agentId?: string,
    agentInstructions?: string[],
    modelId?: string,
    workerId?: string, // ← NEW: Optional workerId
) {
    // Use provided workerId (typically from sessionId) or generate a new one
    this._id = workerId ?? `worker-${generateUuid().substring(0, 8)}`;
}
```

When deploying a task with a sessionId, the orchestrator passes it as the workerId:

```typescript
// In orchestratorServiceV2.ts deploy()
const worker = new WorkerSession(
    task.name,
    task.description,
    worktreePath,
    task.planId,
    baseBranch,
    agentId,
    composedInstructions.instructions,
    effectiveModelId,
    task.sessionId, // ← Use sessionId as persistent worker ID
);
```

### 3. A2A Tools Use Session ID

**File:** `claudeA2AMcpServer.ts`

The A2A MCP server now accepts a `sessionId` parameter and uses it as the worker ID:

```typescript
export interface IA2AMcpServerDependencies {
    // ... existing deps
    /**
     * Persistent session ID from VS Code chat conversation.
     * When provided, this ID is used as the worker identity, allowing
     * orchestration to persist across VS Code restarts.
     */
    sessionId?: string;
}

function getDefaultWorkerContext(
    workspaceRoot: string | undefined,
    sessionId: string | undefined
): IWorkerContext {
    // Use sessionId as workerId for persistent identity
    const workerId = sessionId ?? `claude-standalone-${Date.now()}`;

    return {
        _serviceBrand: undefined,
        workerId,
        worktreePath: workspaceRoot!,
        depth: 0,
        spawnContext: 'agent' as SpawnContext,
    };
}
```

**File:** `claudeCodeAgent.ts`

ClaudeCodeSession passes its sessionId to the A2A tools:

```typescript
return createA2AMcpServer({
    subTaskManager: this.subTaskManager,
    // ... other deps
    sessionId: this.sessionId, // ← Pass persistent session ID
    onChildUpdate: (message: string) => this.receiveChildUpdate(message),
});
```

### 4. Orchestrator Session Lookup Methods

**File:** `orchestratorServiceV2.ts`

New methods to find and resume tasks by session ID:

```typescript
/**
 * Find tasks associated with a persistent session ID.
 */
public getTasksBySessionId(sessionId: string): readonly WorkerTask[] {
    return this._tasks.filter(t => t.sessionId === sessionId);
}

/**
 * Get the active (running or pending) task for a session ID.
 * Useful for resuming a session after VS Code restart.
 */
public getActiveTaskForSession(sessionId: string): WorkerTask | undefined {
    return this._tasks.find(t =>
        t.sessionId === sessionId &&
        (t.status === 'running' || t.status === 'pending' || t.status === 'queued')
    );
}
```

### 5. Creating Tasks with Session ID

When creating tasks through the orchestrator, pass the sessionId:

```typescript
// Example: SessionManager creating a web session
const taskOptions: CreateTaskOptions = {
    name: options.name ?? `Web Session ${sessionId}`,
    agent: agentType,
    sessionId, // ← Link task to persistent session ID
};

const task = orchestratorService.addTask(
    `Interactive session started`,
    taskOptions
);
```

## How It Works: Before and After

### Before (Broken)

```
VS Code Chat (sessionId: "879a9dbc...")
  ↓
orchestrator.addTask() → Task without sessionId
  ↓
orchestrator.deploy() → WorkerSession(id: "worker-abc123")
  ↓
A2A tools create context with: "claude-standalone-1766336260656"
  ↓
Child workers send updates to: "claude-standalone-1766336260656"

[VS Code restarts]

VS Code Chat (SAME sessionId: "879a9dbc...")
  ↓
orchestrator.deploy() → NEW WorkerSession(id: "worker-def456")  ❌
  ↓
Child workers still trying to reach: "claude-standalone-1766336260656"  ❌
  ↓
LOST CONNECTION - Updates never delivered
```

### After (Fixed)

```
VS Code Chat (sessionId: "879a9dbc...")
  ↓
orchestrator.addTask(..., { sessionId: "879a9dbc..." })
  ↓
orchestrator.deploy() → WorkerSession(id: "879a9dbc...")  ✅
  ↓
A2A tools use: "879a9dbc..." as workerId
  ↓
Child workers send updates to: "879a9dbc..."  ✅
  ↓
Owner handler registered for: "879a9dbc..."  ✅

[VS Code restarts]

VS Code Chat (SAME sessionId: "879a9dbc...")
  ↓
orchestrator.getActiveTaskForSession("879a9dbc...")  ✅ Finds existing task
  ↓
orchestrator.deploy(existingTaskId)
  ↓
WorkerSession REUSES SAME ID: "879a9dbc..."  ✅
  ↓
Child workers reconnect to: "879a9dbc..."  ✅
  ↓
Updates delivered successfully!  ✅
```

## Usage Examples

### Example 1: Resuming After VS Code Restart

```typescript
// User's claudeSessionId from VS Code chat
const sessionId = "879a9dbc-9ce4-4b0f-880d-8785c1a67272";

// Check if there's an existing active task for this session
const existingTask = orchestrator.getActiveTaskForSession(sessionId);

if (existingTask) {
    // Resume existing task
    console.log(`Resuming task ${existingTask.id} for session ${sessionId}`);
    await orchestrator.deploy(existingTask.id);
} else {
    // Create new task for this session
    const task = orchestrator.addTask("New feature implementation", {
        name: "Implement feature",
        agent: "@agent",
        sessionId, // ← Pass the persistent session ID
    });
    await orchestrator.deploy(task.id);
}
```

### Example 2: Child Workers Sending Updates

When a child worker reports completion, it uses the parent's sessionId:

```typescript
// Child worker's A2A tool
await a2a_reportCompletion({
    status: "success",
    output: "Task completed successfully"
});

// This routes to parent's sessionId (e.g., "879a9dbc...")
// Parent's ClaudeCodeSession receives the update via owner handler
// Even if parent was redeployed, sessionId remains the same!
```

### Example 3: Web Gateway Sessions

```typescript
// SessionManager creating a persistent web session
const sessionId = `websession-${generateUuid().substring(0, 8)}`;

const taskOptions: CreateTaskOptions = {
    name: `Web Session ${sessionId}`,
    agent: '@agent',
    sessionId, // ← Link to session
};

const task = orchestratorService.addTask(
    'Interactive session',
    taskOptions
);

// Deploy will use sessionId as worker ID
const worker = await orchestratorService.deploy(task.id);
// worker.id === sessionId  ✅
```

## Benefits

1. **Session Persistence**: Chat sessions survive VS Code restarts
2. **Reliable Updates**: Child tasks always route to correct parent
3. **No Orphaned Workers**: Workers can be killed and redeployed with same ID
4. **Clear Debugging**: Session ID traces through entire orchestration chain
5. **Backward Compatible**: Generates ephemeral IDs when sessionId not provided

## Migration Notes

- Existing tasks without sessionId continue to work with generated worker IDs
- New tasks should always include sessionId when possible
- SessionManager automatically includes sessionId for web sessions
- ClaudeCodeSession automatically passes sessionId to A2A tools

## Logging

Look for these log messages to trace session IDs:

```
[Orchestrator:deploy] Creating WorkerSession: taskId=task-123, sessionId=879a9dbc..., worktreePath=...
[Orchestrator:deploy] WorkerSession created: workerId=879a9dbc..., taskId=task-123, usedSessionId=true
[ClaudeCodeSession] Creating A2A MCP server | hasWorkerContext=false, sessionId=879a9dbc...
[ORCH-DEBUG][QueueService] Routing message to owner handler | messageId=..., ownerId=879a9dbc..., type=status_update
```

## Future Improvements

1. **Session Registry Service**: Central service to map sessionId ↔ workerId
2. **Session Resumption API**: Explicit API for resuming suspended sessions
3. **Session Metadata**: Store additional context with each session
4. **Cross-Device Sessions**: Share session IDs across multiple VS Code instances
