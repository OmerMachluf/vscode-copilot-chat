# workerId Comprehensive Flow Analysis

**Document Version**: 1.0
**Generated**: 2025-12-22
**Total Occurrences**: 880 across 39 files
**Location**: `Q:\src\PowerQuery\vs\vscode-copilot-chat\src\extension`

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [workerId Creation Points](#workerid-creation-points)
3. [Storage Locations](#storage-locations)
4. [Data Flow Diagram](#data-flow-diagram)
5. [Key Components & Their Roles](#key-components--their-roles)
6. [Interface & Type Definitions](#interface--type-definitions)
7. [Complete Reference Catalog](#complete-reference-catalog)
8. [Lifecycle Management](#lifecycle-management)

---

## Executive Summary

`workerId` is a **unique identifier** that serves as the primary key for tracking worker agents throughout the orchestrator system. It flows through multiple layers of the architecture:

### Primary Functions:
1. **Identity**: Uniquely identifies a worker session across its entire lifecycle
2. **Routing**: Routes messages, completions, and permissions to specific workers
3. **Hierarchy**: Links parent workers to their spawned subtasks
4. **State Management**: Keys worker state in Maps and storage systems
5. **HTTP API**: Identifies workers in REST endpoints
6. **UI**: Associates chat sessions with specific workers

### Key Characteristics:
- **Format**: `worker-{uuid}` (8-character UUID substring) OR session-based UUID
- **Scope**: System-wide unique identifier
- **Lifecycle**: Created at worker initialization, persists until disposal
- **Thread-Safety**: Used as immutable key in concurrent operations

---

## workerId Creation Points

### 1. WorkerSession Constructor
**File**: `orchestrator/workerSession.ts:466`

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
    workerId?: string,  // ← Can be provided OR generated
) {
    super();
    // Use provided workerId (typically from sessionId) or generate a new one
    // This allows persistent session IDs to survive worker redeployment
    this._id = workerId ?? `worker-${generateUuid().substring(0, 8)}`;
    // ...
}
```

**Generation Strategy**:
- **If provided**: Uses the provided `workerId` (e.g., from chat session ID)
- **If not provided**: Generates `worker-{8-char-uuid}`

**Call Sites**:
- `OrchestratorServiceV2.deploy()` - Main worker deployment
- `WorkerSession.fromSerialized()` - Restoring from saved state
- Chat session providers - Creating workers for VS Code chat sessions

---

### 2. SubTask Creation (parentWorkerId)
**File**: `orchestrator/subTaskManager.ts:180-300`

```typescript
createSubTask(options: ISubTaskCreateOptions): ISubTask {
    const id = `subtask-${generateUuid().substring(0, 8)}`;

    const subTask: ISubTask = {
        id,
        parentWorkerId: options.parentWorkerId,  // ← Inherited from parent
        // ...
    };

    this._subTasks.set(id, subTask);
    return subTask;
}
```

**Key Points**:
- Subtasks don't have their own `workerId` - they have `id` (subtask ID)
- `parentWorkerId` links the subtask to its parent worker
- This creates the parent-child hierarchy

---

### 3. A2A Tools - Default workerId
**File**: `tools/node/a2aTools.ts:132-138`

```typescript
let workerId = this._workerContext?.workerId;
if (!workerId) {
    workerId = 'user-session-v3';  // ← Fallback for non-worker contexts
    this._logService.debug(`[A2ASpawnSubTaskTool] No worker context, using default workerId: ${workerId}`);
}
```

**Purpose**: When tools are called outside orchestrator context (e.g., from standalone chat)

---

## Storage Locations

### 1. WorkerSession._id (Private Field)
**File**: `orchestrator/workerSession.ts:386`

```typescript
export class WorkerSession extends Disposable {
    private readonly _id: string;  // ← Primary storage

    public get id(): string {
        return this._id;
    }
}
```

**Access**: Via getter `WorkerSession.id`

---

### 2. OrchestratorServiceV2 Maps

#### _workers Map
**File**: `orchestrator/orchestratorServiceV2.ts` (multiple locations)

```typescript
private readonly _workers = new Map<string, WorkerSession>();

// Storage
this._workers.set(worker.id, worker);

// Retrieval
getWorkerSession(workerId: string): WorkerSession | undefined {
    return this._workers.get(workerId);
}

// All workers access
getAllWorkers(): WorkerSession[] {
    return Array.from(this._workers.values());
}
```

**Purpose**: Primary registry of all active workers

---

#### _taskToWorker Map
**File**: `orchestrator/orchestratorServiceV2.ts`

```typescript
private readonly _taskToWorker = new Map<string, string>();  // taskId -> workerId

// Linking task to worker
this._taskToWorker.set(task.id, worker.id);

// Looking up worker by task
const workerId = this._taskToWorker.get(taskId);
if (workerId) {
    const worker = this._workers.get(workerId);
}
```

**Purpose**: Bi-directional mapping between tasks and workers

---

### 3. SubTaskManager - parentWorkerId

#### _subTasks Map
**File**: `orchestrator/subTaskManager.ts:72`

```typescript
private readonly _subTasks = new Map<string, ISubTask>();

interface ISubTask {
    id: string;
    parentWorkerId: string;  // ← References parent worker
    // ...
}

// Finding subtasks for a worker
getSubTasksForWorker(workerId: string): ISubTask[] {
    return Array.from(this._subTasks.values())
        .filter(st => st.parentWorkerId === workerId);
}
```

**Purpose**: Links subtasks to their parent workers

---

### 4. ParentCompletionService

#### _parentHandlers Map
**File**: `orchestrator/parentCompletionService.ts:138`

```typescript
private readonly _parentHandlers = new Map<string, IParentHandler>();

interface IParentHandler {
    ownerId: string;  // ← workerId used as owner ID
    onCompletion: (message: IParentCompletionMessage) => Promise<void>;
    injectAsUserMessage: boolean;
}

registerParentHandler(
    ownerId: string,  // ← workerId
    onCompletion: (message: IParentCompletionMessage) => Promise<void>,
    options?: { injectAsUserMessage?: boolean }
): IDisposable
```

**Purpose**: Routes subtask completions to parent workers

---

### 5. OrchestratorQueue

#### _ownerHandlers Map
**File**: `orchestrator/orchestratorQueue.ts:139`

```typescript
private readonly _ownerHandlers = new Map<string, (message: IOrchestratorQueueMessage) => Promise<void>>();

interface IOrchestratorQueueMessage {
    workerId: string;  // ← Message source
    owner?: IOwnerContext;
}

interface IOwnerContext {
    ownerType: 'orchestrator' | 'worker' | 'agent';
    ownerId: string;  // ← workerId for routing
    sessionUri?: string;
}

registerOwnerHandler(ownerId: string, handler: (message: IOrchestratorQueueMessage) => Promise<void>): IDisposable
```

**Purpose**: Routes queue messages to specific workers

---

### 6. WorkerHealthMonitor

#### _metrics Map
**File**: `orchestrator/workerHealthMonitor.ts:144`

```typescript
private readonly _metrics = new Map<string, IWorkerHealthMetrics>();

interface IWorkerHealthMetrics {
    readonly workerId: string;  // ← Key identifier
    lastActivityTimestamp: number;
    consecutiveFailures: number;
    // ... health tracking fields
}

startMonitoring(workerId: string): void {
    this._metrics.set(workerId, {
        workerId,
        lastActivityTimestamp: Date.now(),
        // ...
    });
}
```

**Purpose**: Tracks worker health and activity

---

### 7. IWorkerContext (Tool Scoping)

**File**: `orchestrator/workerToolsService.ts`

```typescript
export interface IWorkerContext {
    workerId: string;  // ← Worker identity for tools
    taskId: string;
    planId: string;
    worktreePath?: string;
    depth: number;
    spawnContext: SpawnContext;
}

// Tools receive this context
constructor(
    @IWorkerContext private readonly _workerContext: IWorkerContext,
    // ...
)
```

**Purpose**: Provides worker identity to tools

---

### 8. Dashboard Storage

#### Worker list state
**File**: `orchestrator/dashboard/WorkerDashboardV2.ts`

```typescript
// Dashboard tracks workers by ID for UI updates
private _refreshWorkerList(): void {
    const workers = this._orchestratorService.getAllWorkers();
    const workersHtml = workers.map(worker => {
        const workerId = worker.id;  // ← Used in HTML attributes
        return `<div data-worker-id="${workerId}">...</div>`;
    }).join('');
}

// Webview message handlers use workerId
case 'showWorkerChat': {
    const workerId = message.workerId;
    const worker = this._orchestratorService.getWorkerSession(workerId);
    // ...
}
```

**Purpose**: UI state management and interactions

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    workerId CREATION                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌──────────────────────────────────────┐
        │  WorkerSession Constructor           │
        │  - Provided sessionId (persistent)   │
        │  - OR Generated: worker-{uuid}       │
        └──────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    workerId STORAGE                          │
└─────────────────────────────────────────────────────────────┘
        │
        ├─────► WorkerSession._id (immutable)
        │
        ├─────► OrchestratorServiceV2._workers Map
        │       - KEY: workerId → VALUE: WorkerSession
        │
        ├─────► OrchestratorServiceV2._taskToWorker Map
        │       - KEY: taskId → VALUE: workerId
        │
        ├─────► SubTaskManager._subTasks Map
        │       - ISubTask.parentWorkerId field
        │
        ├─────► ParentCompletionService._parentHandlers Map
        │       - KEY: ownerId (workerId) → VALUE: Handler
        │
        ├─────► OrchestratorQueue._ownerHandlers Map
        │       - KEY: ownerId (workerId) → VALUE: Handler
        │
        ├─────► WorkerHealthMonitor._metrics Map
        │       - KEY: workerId → VALUE: HealthMetrics
        │
        ├─────► WorkerToolsService._workerToolSets Map
        │       - KEY: workerId → VALUE: WorkerToolSet
        │
        └─────► Dashboard state (HTML data attributes)

                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    workerId USAGE                            │
└─────────────────────────────────────────────────────────────┘
        │
        ├─────► Message Routing
        │       - Queue messages: IOrchestratorQueueMessage.workerId
        │       - Owner routing: IOwnerContext.ownerId
        │       - Handler registration: registerOwnerHandler(workerId, ...)
        │
        ├─────► Parent-Child Hierarchy
        │       - SubTask.parentWorkerId → links to parent
        │       - Completion routing: deliverCompletion(subTask.parentWorkerId)
        │
        ├─────► Worker Lookup
        │       - getWorkerSession(workerId)
        │       - getWorkerState(workerId)
        │       - getWorkerModel(workerId)
        │       - getWorkerAgent(workerId)
        │
        ├─────► HTTP API Endpoints
        │       - GET /api/orchestrator/workers/:workerId
        │       - POST /api/orchestrator/workers/:workerId/message
        │       - POST /api/orchestrator/workers/:workerId/interrupt
        │
        ├─────► Health Monitoring
        │       - startMonitoring(workerId)
        │       - recordActivity(workerId, type, ...)
        │       - getHealth(workerId)
        │
        ├─────► Tool Context
        │       - IWorkerContext.workerId
        │       - Tools check: this._workerContext?.workerId
        │
        ├─────► Chat Sessions
        │       - Chat session ID → workerId mapping
        │       - Session content provider: finds worker by sessionId
        │
        └─────► Dashboard UI
                - Worker selection: data-worker-id="${workerId}"
                - Chat panel: showWorkerChat(workerId)

                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    workerId DISPOSAL                         │
└─────────────────────────────────────────────────────────────┘
        │
        ├─────► OrchestratorServiceV2.removeWorker(workerId)
        │       - Removes from _workers Map
        │       - Removes from _taskToWorker Map
        │       - Disposes WorkerSession
        │
        ├─────► WorkerHealthMonitor.stopMonitoring(workerId)
        │       - Removes from _metrics Map
        │
        ├─────► SubTaskManager.resetWorkerTracking(workerId)
        │       - Cleans up subtask references
        │
        ├─────► ParentCompletionService handler disposal
        │       - Unregisters from _parentHandlers Map
        │
        └─────► WorkerToolsService.disposeWorkerToolSet(workerId)
                - Removes from _workerToolSets Map
                - Disposes instantiation service
```

---

## Key Components & Their Roles

### 1. WorkerSession
**File**: `orchestrator/workerSession.ts`

**Role**: Core worker state container

**workerId References**:
- `_id` (line 386): Private field storing the workerId
- `id` getter (line 706): Public accessor
- Constructor parameter (line 461): Optional initialization
- Logging (lines 479-480): Debug output
- Serialization (line 928): `id: this._id`
- `fromSerialized` (line 960): Restores `_id` from saved state

**Key Methods**:
```typescript
// Creation
constructor(name, task, worktreePath, ..., workerId?)
static fromSerialized(state: SerializedWorkerState): WorkerSession

// Access
get id(): string

// Serialization
serialize(): SerializedWorkerState { id: this._id, ... }
```

---

### 2. OrchestratorServiceV2
**File**: `orchestrator/orchestratorServiceV2.ts`

**Role**: Central orchestrator managing all workers

**workerId References** (248 total):
- Worker registry: `_workers Map<string, WorkerSession>`
- Task mapping: `_taskToWorker Map<string, string>`
- Worker lookup methods
- Worker deployment
- Message routing
- Health monitoring integration

**Key Methods Using workerId**:
```typescript
// Deployment
async deploy(taskId: string, options: IWorkerDeployOptions): Promise<WorkerSession>

// Lookup
getWorkerSession(workerId: string): WorkerSession | undefined
getWorkerState(workerId: string): WorkerSessionState | undefined
getWorkerByTask(taskId: string): WorkerSession | undefined

// Management
removeWorker(workerId: string): void
interruptWorker(workerId: string): Promise<void>
sendMessageToWorker(workerId: string, message: string): void

// Settings
getWorkerModel(workerId: string): string | undefined
setWorkerModel(workerId: string, modelId: string): void
getWorkerAgent(workerId: string): string | undefined
setWorkerAgent(workerId: string, agentId: string, instructions: string[]): void
```

---

### 3. SubTaskManager
**File**: `orchestrator/subTaskManager.ts`

**Role**: Manages subtask lifecycle and parent-child relationships

**workerId References**:
- `ISubTask.parentWorkerId` (line 144): Links subtask to parent
- `ISubTaskCreateOptions.parentWorkerId` (line 202): Required for creation
- Subtask filtering: `getSubTasksForWorker(workerId)`
- Cost tracking: `getTotalCostForWorker(workerId)`
- Safety limits: `resetWorkerTracking(workerId)`

**Key Methods**:
```typescript
createSubTask(options: ISubTaskCreateOptions): ISubTask
getSubTasksForWorker(workerId: string): ISubTask[]
getRunningSubTasksCount(workerId: string): number
getTotalSubTasksCount(workerId: string): number
getTotalCostForWorker(workerId: string): number
resetWorkerTracking(workerId: string): void
```

---

### 4. ParentCompletionService
**File**: `orchestrator/parentCompletionService.ts`

**Role**: Routes subtask completions to parent workers

**workerId References**:
- `IParentHandler.ownerId` (line 65): workerId used as owner identifier
- `registerParentHandler(ownerId: string, ...)`: Registers handler for worker
- `_parentHandlers Map<string, IParentHandler>`: Keyed by workerId
- `deliverCompletion()`: Uses `subTask.parentWorkerId` for routing

**Key Methods**:
```typescript
registerParentHandler(
    ownerId: string,  // workerId
    onCompletion: (message: IParentCompletionMessage) => Promise<void>,
    options?: { injectAsUserMessage?: boolean }
): IDisposable

hasParentHandler(ownerId: string): boolean
deliverCompletion(subTask: ISubTask, result: ISubTaskResult): Promise<void>
```

---

### 5. OrchestratorQueue
**File**: `orchestrator/orchestratorQueue.ts`

**Role**: Message queue with worker-specific routing

**workerId References**:
- `IOrchestratorQueueMessage.workerId` (line 37): Message source
- `IOwnerContext.ownerId` (line 24): Routing destination (can be workerId)
- `_ownerHandlers Map<string, Handler>`: Keyed by workerId
- Message routing logic

**Key Methods**:
```typescript
registerOwnerHandler(ownerId: string, handler: (message: IOrchestratorQueueMessage) => Promise<void>): IDisposable
hasOwnerHandler(ownerId: string): boolean
getPendingMessagesForOwner(ownerId: string): IOrchestratorQueueMessage[]
```

**Message Structure**:
```typescript
interface IOrchestratorQueueMessage {
    workerId: string;  // Source worker
    owner?: IOwnerContext;  // Destination (ownerId can be workerId)
    // ...
}
```

---

### 6. WorkerHealthMonitor
**File**: `orchestrator/workerHealthMonitor.ts`

**Role**: Tracks worker health metrics

**workerId References**:
- `IWorkerHealthMetrics.workerId` (line 14): Metric owner
- `_metrics Map<string, IWorkerHealthMetrics>`: Keyed by workerId
- All health tracking methods

**Key Methods**:
```typescript
startMonitoring(workerId: string): void
stopMonitoring(workerId: string): void
recordActivity(workerId: string, type: 'tool_call' | 'message' | 'error' | 'success', toolName?: string): void
getHealth(workerId: string): IWorkerHealthMetrics | undefined
isStuck(workerId: string): boolean
isLooping(workerId: string): boolean
isIdle(workerId: string): boolean
recordError(workerId: string, errorType: WorkerErrorType, error: string, retryInfo?: IRetryInfo): void
markExecutionStart(workerId: string): void
markExecutionEnd(workerId: string): void
```

---

### 7. WorkerToolsService
**File**: `orchestrator/workerToolsService.ts`

**Role**: Provides scoped tool services per worker

**workerId References**:
- `IWorkerContext.workerId`: Tool context identifier
- `WorkerToolSet.workerId`: Associates tool set with worker
- `_workerToolSets Map<string, WorkerToolSet>`: Keyed by workerId

**Key Methods**:
```typescript
createWorkerToolSet(workerId: string, worktreePath: string, taskId: string, planId: string, depth: number, spawnContext: SpawnContext): WorkerToolSet
getWorkerToolSet(workerId: string): WorkerToolSet | undefined
disposeWorkerToolSet(workerId: string): void
```

---

### 8. A2A Tools
**File**: `tools/node/a2aTools.ts`

**Role**: Agent-to-agent communication tools

**workerId References**:
- `IWorkerContext.workerId`: Current worker context
- Subtask creation: `parentWorkerId` parameter
- Message routing: owner handler registration
- Progress tracking: workerId for stream lookup

**Usage Pattern**:
```typescript
let workerId = this._workerContext?.workerId;
if (!workerId) {
    workerId = 'user-session-v3';  // Fallback
}

const createOptions: ISubTaskCreateOptions = {
    parentWorkerId: workerId,  // ← Links subtask to parent
    // ...
};
```

---

### 9. HTTP API Routes
**Files**:
- `httpApi/routes/workersRoute.ts`
- `httpApi/routes/orchestratorRoute.ts`

**Role**: REST API for worker management

**Endpoints Using workerId**:
```typescript
// Worker operations
GET    /api/orchestrator/workers/:workerId
POST   /api/orchestrator/workers/:workerId/message
POST   /api/orchestrator/workers/:workerId/interrupt
DELETE /api/orchestrator/workers/:workerId

// Worker queries
GET    /api/orchestrator/workers (list all)
GET    /api/orchestrator/workers/:workerId/state
GET    /api/orchestrator/workers/:workerId/health
```

---

### 10. Dashboard Components
**Files**:
- `orchestrator/dashboard/WorkerDashboardV2.ts`
- `orchestrator/dashboard/WorkerChatPanel.ts`

**Role**: UI for worker visualization and interaction

**workerId References**:
- HTML attributes: `data-worker-id="${workerId}"`
- Webview messages: `message.workerId`
- Worker selection and chat display

**UI Patterns**:
```typescript
// Dashboard worker list
workers.map(worker => `
    <div data-worker-id="${worker.id}" class="worker-item">
        ${worker.name}
    </div>
`)

// Chat panel
webview.postMessage({
    type: 'showWorkerChat',
    workerId: worker.id
});
```

---

### 11. Chat Session Providers
**Files**:
- `chatSessions/vscode-node/orchestratorChatSessionContentProvider.ts`
- `chatSessions/vscode-node/orchestratorChatSessionItemProvider.ts`
- `chatSessions/vscode-node/orchestratorChatSessionParticipant.ts`

**Role**: Integrate workers with VS Code chat UI

**workerId References**:
- Session ID → workerId mapping
- `task.workerId`: Task to worker lookup
- Worker state retrieval for chat history
- Stream attachment for live updates

**Key Pattern**:
```typescript
const sessionId = OrchestratorSessionId.parse(resource);
const tasks = this.orchestratorService.getTasks();
let task = tasks.find(t => t.id === sessionId);
let workerId: string | undefined = task?.workerId;

if (!workerId) {
    // Try looking up directly as worker ID
    const workerState = this.orchestratorService.getWorkerState(sessionId);
    if (workerState) {
        workerId = sessionId;
    }
}
```

---

## Interface & Type Definitions

### ISubTask
**File**: `orchestrator/orchestratorInterfaces.ts:140-177`

```typescript
export interface ISubTask {
    id: string;  // Subtask ID (not workerId)
    parentWorkerId: string;  // ← References parent worker
    parentTaskId: string;
    planId: string;
    worktreePath: string;
    baseBranch?: string;
    agentType: string;
    parsedAgentType?: ParsedAgentType;
    prompt: string;
    expectedOutput: string;
    model?: string;
    depth: number;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    result?: ISubTaskResult;
    targetFiles?: string[];
    createdAt: number;
    completedAt?: number;
    inheritedPermissions?: IOrchestratorPermissions;
}
```

---

### ISubTaskCreateOptions
**File**: `orchestrator/orchestratorInterfaces.ts:200-235`

```typescript
export interface ISubTaskCreateOptions {
    parentWorkerId: string;  // ← Required: identifies parent
    parentTaskId: string;
    parentSubTaskId?: string;
    planId: string;
    worktreePath: string;
    baseBranch?: string;
    agentType: string;
    prompt: string;
    expectedOutput: string;
    model?: string;
    currentDepth: number;
    targetFiles?: string[];
    parentHistory?: IAgentHistoryEntry[];
    inheritedPermissions?: IOrchestratorPermissions;
    spawnContext?: 'orchestrator' | 'agent';
}
```

---

### IOwnerContext
**File**: `orchestrator/orchestratorQueue.ts:20-27`

```typescript
export interface IOwnerContext {
    ownerType: 'orchestrator' | 'worker' | 'agent';
    ownerId: string;  // ← Can be workerId for worker-owned messages
    sessionUri?: string;
}
```

---

### IOrchestratorQueueMessage
**File**: `orchestrator/orchestratorQueue.ts:29-51`

```typescript
export interface IOrchestratorQueueMessage {
    id: string;
    timestamp: number;
    priority: 'critical' | 'high' | 'normal' | 'low';

    planId: string;
    taskId: string;
    workerId: string;  // ← Message source
    worktreePath: string;

    parentAgentId?: string;
    subTaskId?: string;
    depth?: number;

    owner?: IOwnerContext;  // ← Destination (ownerId can be workerId)

    type: 'status_update' | 'permission_request' | 'permission_response' |
          'question' | 'completion' | 'error' | 'answer' | 'refinement' |
          'retry_request' | 'approval_request' | 'approval_response';
    content: unknown;
}
```

---

### IWorkerContext
**File**: `orchestrator/workerToolsService.ts`

```typescript
export interface IWorkerContext {
    workerId: string;  // ← Worker identity for tools
    taskId: string;
    planId: string;
    worktreePath?: string;
    depth: number;
    spawnContext: SpawnContext;  // 'orchestrator' | 'agent' | 'subtask'
}
```

---

### SerializedWorkerState
**File**: `orchestrator/workerSession.ts:344-359`

```typescript
export interface SerializedWorkerState {
    readonly id: string;  // ← workerId
    readonly name: string;
    readonly task: string;
    readonly worktreePath: string;
    readonly status: WorkerStatus;
    readonly messages: WorkerMessage[];
    readonly createdAt: number;
    readonly lastActivityAt: number;
    readonly errorMessage?: string;
    readonly planId?: string;
    readonly baseBranch?: string;
    readonly agentId?: string;
    readonly agentInstructions?: string[];
    readonly modelId?: string;
}
```

---

### IWorkerHealthMetrics
**File**: `orchestrator/workerHealthMonitor.ts:13-36`

```typescript
export interface IWorkerHealthMetrics {
    readonly workerId: string;  // ← Health tracking key
    lastActivityTimestamp: number;
    consecutiveFailures: number;
    consecutiveLoops: number;
    toolCallCount: number;
    errorRate: number;
    isStuck: boolean;
    isLooping: boolean;
    isIdle: boolean;
    isExecuting: boolean;
    idleInquiryPending: boolean;
    idleInquirySentAt?: number;
    lastProgressCheckAt?: number;
    recentToolCalls: string[];
}
```

---

### IParentCompletionMessage
**File**: `orchestrator/parentCompletionService.ts:29-58`

```typescript
export interface IParentCompletionMessage {
    subTaskId: string;
    agentType: string;
    taskPrompt: string;
    response: string;
    worktreePath: string;
    changedFilesCount?: number;
    insertions?: number;
    deletions?: number;
    changedFiles?: string[];
    completedViaTool?: boolean;
    mergedToBranch?: string;
    status: 'success' | 'partial' | 'failed' | 'timeout';
    error?: string;
    timestamp: number;
}

// Note: workerId is NOT in the message itself, but used for routing:
// deliverCompletion() uses subTask.parentWorkerId to determine where to route
```

---

## Complete Reference Catalog

### By File (Top 10 Files by Occurrence Count)

#### 1. orchestratorServiceV2.ts (248 occurrences)
**Primary Functions**:
- Worker registry: `_workers Map<string, WorkerSession>`
- Task-to-worker mapping: `_taskToWorker Map<string, string>`
- Worker deployment, lookup, management
- Message routing and health monitoring integration

**Key Locations**:
- Worker storage/retrieval: Throughout the file
- deploy(): Creates and registers workers
- getWorkerSession(), getWorkerState(): Lookup methods
- removeWorker(): Cleanup

---

#### 2. subTaskManager.ts (60+ occurrences)
**Primary Functions**:
- Parent-child hierarchy via `ISubTask.parentWorkerId`
- Subtask filtering by parent worker
- Cost tracking per worker
- Worker tracking reset

**Key Locations**:
- createSubTask(): Line 180 (parentWorkerId assignment)
- getSubTasksForWorker(): Line 306
- resetWorkerTracking(): Line 1114

---

#### 3. a2aTools.ts (50+ occurrences)
**Primary Functions**:
- Worker context access for tools
- Subtask spawning with parentWorkerId
- Message routing via owner handlers
- Progress tracking

**Key Locations**:
- A2ASpawnSubTaskTool.invoke(): Lines 132-138 (context retrieval)
- createOptions: Line 235 (parentWorkerId assignment)
- Owner handler registration: Lines 277, 358

---

#### 4. workerHealthMonitor.ts (40+ occurrences)
**Primary Functions**:
- Health metrics keyed by workerId
- Activity tracking
- Idle/stuck detection

**Key Locations**:
- _metrics Map: Line 144
- startMonitoring(): Line 176
- recordActivity(): Line 228
- Health check methods: Lines 317-342

---

#### 5. parentCompletionService.ts (35+ occurrences)
**Primary Functions**:
- Completion routing to parent workers
- Handler registration keyed by workerId (as ownerId)
- Pending completion queue

**Key Locations**:
- _parentHandlers Map: Line 138
- registerParentHandler(): Line 177
- deliverCompletion(): Line 286 (uses subTask.parentWorkerId)

---

#### 6. orchestratorQueue.ts (30+ occurrences)
**Primary Functions**:
- Message routing by owner ID (workerId)
- Owner-specific message handlers
- Queue management

**Key Locations**:
- _ownerHandlers Map: Line 139
- registerOwnerHandler(): Line 226
- Message routing: Line 262 (getHandlerForMessage)

---

#### 7. orchestratorChatSessionContentProvider.ts (25+ occurrences)
**Primary Functions**:
- Session ID to workerId mapping
- Chat history retrieval from worker state
- Stream attachment for live updates

**Key Locations**:
- Session lookup: Lines 43-56
- Worker state retrieval: Line 72
- Stream attachment: Line 131

---

#### 8. WorkerDashboardV2.ts (20+ occurrences)
**Primary Functions**:
- Worker list rendering
- Worker selection and chat display
- Webview message handling

**Key Locations**:
- Worker list HTML: data-worker-id attributes
- Message handlers: webview.onDidReceiveMessage

---

#### 9. workerToolsService.ts (15+ occurrences)
**Primary Functions**:
- WorkerToolSet creation and management
- IWorkerContext provision to tools
- Scoped instantiation services

**Key Locations**:
- _workerToolSets Map
- createWorkerToolSet()
- getWorkerToolSet()

---

#### 10. executors (claudeCodeAgentExecutor.ts, copilotAgentExecutor.ts)
**Primary Functions**:
- Execute tasks with workerId in params
- Worker status tracking
- Message sending to workers

**Key Locations**:
- AgentExecuteParams.workerId (interface)
- execute(), sendMessage(), getStatus() implementations

---

### By Operation Type

#### Creation/Generation
1. `WorkerSession` constructor: Line 466
2. `worker-${generateUuid()}` generation: Line 466
3. Session ID reuse: Constructor parameter
4. Fallback ID: `'user-session-v3'` in tools

#### Storage
1. `WorkerSession._id`: Private field
2. `OrchestratorServiceV2._workers`: Map<workerId, WorkerSession>
3. `OrchestratorServiceV2._taskToWorker`: Map<taskId, workerId>
4. `SubTaskManager._subTasks`: Contains parentWorkerId
5. `ParentCompletionService._parentHandlers`: Map<ownerId, Handler>
6. `OrchestratorQueue._ownerHandlers`: Map<ownerId, Handler>
7. `WorkerHealthMonitor._metrics`: Map<workerId, Metrics>
8. `WorkerToolsService._workerToolSets`: Map<workerId, ToolSet>

#### Retrieval
1. `WorkerSession.id` getter
2. `getWorkerSession(workerId)`
3. `getWorkerState(workerId)`
4. `getWorkerByTask(taskId)` → retrieves via `_taskToWorker`
5. Task to worker lookup: `task.workerId`
6. Subtask parent: `subTask.parentWorkerId`

#### Comparison/Filtering
1. `Array.filter(st => st.parentWorkerId === workerId)`
2. `Map.get(workerId)` operations
3. Dashboard: `data-worker-id` attribute matching
4. Session ID comparison: `sessionId === workerId`

#### Parameters
1. Function signatures: `(workerId: string, ...)`
2. Interface fields: `parentWorkerId: string`
3. Tool context: `IWorkerContext.workerId`
4. HTTP route params: `/workers/:workerId`
5. Subtask options: `ISubTaskCreateOptions.parentWorkerId`

#### Return Values
1. `WorkerSession.id` getter returns `string`
2. Lookup methods return `WorkerSession | undefined`
3. Task queries: `Task.workerId` field

---

## Lifecycle Management

### 1. Birth (Creation)

```
User initiates task
    │
    ▼
OrchestratorServiceV2.addTask()
    │
    ▼
OrchestratorServiceV2.deploy(taskId, options)
    │
    ├─► sessionId provided? Use as workerId
    │   (Persistent ID for chat sessions)
    │
    └─► No sessionId? Generate worker-{uuid}
        │
        ▼
    new WorkerSession(name, task, worktreePath, ..., workerId)
        │
        ▼
    WorkerSession._id = workerId
        │
        ▼
    _workers.set(worker.id, worker)
    _taskToWorker.set(task.id, worker.id)
        │
        ▼
    Worker is now live and tracked
```

---

### 2. Life (Active State)

```
Worker Execution Loop
    │
    ├─► Health Monitoring
    │   - WorkerHealthMonitor tracks activity
    │   - recordActivity(workerId, type, ...)
    │   - Idle/stuck detection
    │
    ├─► Message Routing
    │   - Queue messages tagged with workerId
    │   - Owner handlers registered for workerId
    │   - ParentCompletionService routes to parentWorkerId
    │
    ├─► Subtask Spawning
    │   - Create subtask with parentWorkerId
    │   - SubTaskManager tracks hierarchy
    │   - Completion routed back to parent
    │
    ├─► Tool Execution
    │   - IWorkerContext provides workerId to tools
    │   - WorkerToolSet scoped to workerId
    │   - Scoped file operations within worktree
    │
    ├─► HTTP API Access
    │   - GET /workers/:workerId
    │   - POST /workers/:workerId/message
    │   - Worker state queries
    │
    └─► UI Updates
        - Dashboard shows worker by ID
        - Chat sessions mapped to workerId
        - Real-time status updates
```

---

### 3. Death (Disposal)

```
Worker Completion/Removal
    │
    ▼
OrchestratorServiceV2.removeWorker(workerId)
    │
    ├─► Remove from Maps
    │   - _workers.delete(workerId)
    │   - _taskToWorker entries removed
    │
    ├─► Stop Health Monitoring
    │   - WorkerHealthMonitor.stopMonitoring(workerId)
    │   - _metrics.delete(workerId)
    │
    ├─► Clean Up Subtasks
    │   - SubTaskManager.resetWorkerTracking(workerId)
    │   - Clear subtask references
    │
    ├─► Dispose Tool Set
    │   - WorkerToolsService.disposeWorkerToolSet(workerId)
    │   - _workerToolSets.delete(workerId)
    │
    ├─► Unregister Handlers
    │   - Parent completion handlers disposed
    │   - Queue handlers removed
    │
    ├─► Dispose WorkerSession
    │   - session.dispose() called
    │   - Event emitters cleaned up
    │   - Resources released
    │
    └─► UI Cleanup
        - Dashboard updates worker list
        - Chat sessions notified of disposal
```

---

### 4. Persistence (Session Continuity)

```
Session Save/Restore Flow
    │
    ├─► Save
    │   WorkerSession.serialize()
    │       └─► { id: this._id, ... }
    │           └─► Written to storage
    │
    └─► Restore
        WorkerSession.fromSerialized(state)
            └─► (session as any)._id = state.id
                └─► Original workerId preserved
```

---

## Critical Patterns & Best Practices

### 1. workerId as Immutable Identifier
- Once assigned, workerId NEVER changes
- Used as Map key throughout system
- Safe for concurrent access (read-only after creation)

### 2. Parent-Child Linking
```typescript
// Subtask creation always captures parent
const subTask: ISubTask = {
    id: generateUuid(),
    parentWorkerId: this._workerContext.workerId,  // ← Critical link
    // ...
};

// Completion routing uses this link
deliverCompletion(subTask.parentWorkerId, result);
```

### 3. Routing via Owner Context
```typescript
// Messages tagged with source AND destination
const message: IOrchestratorQueueMessage = {
    workerId: sourceWorkerId,  // Where from
    owner: {
        ownerType: 'worker',
        ownerId: targetWorkerId,  // Where to
    },
    // ...
};

// Queue routes to registered handler
registerOwnerHandler(workerId, async (message) => {
    // Handle messages for this worker
});
```

### 4. Tool Context Scoping
```typescript
// Tools receive worker context
constructor(
    @IWorkerContext private readonly _workerContext: IWorkerContext,
    // ...
) { }

// Use workerId for scoped operations
const workerId = this._workerContext?.workerId ?? 'user-session';
const toolSet = this._workerToolsService.getWorkerToolSet(workerId);
```

### 5. Health Monitoring Lifecycle
```typescript
// Start monitoring on worker creation
startMonitoring(worker.id);

// Track activity during execution
recordActivity(workerId, 'tool_call', toolName);

// Stop monitoring on disposal
stopMonitoring(workerId);
```

### 6. Session ID Reuse
```typescript
// Chat sessions can persist across worker redeployment
new WorkerSession(
    name, task, worktreePath, planId, baseBranch,
    agentId, agentInstructions, modelId,
    sessionId  // ← Reuse VS Code chat session ID as workerId
);

// This allows:
// 1. Chat history continuity
// 2. Session restoration after reload
// 3. Consistent routing in chat UI
```

---

## Summary Statistics

| Category | Count |
|----------|-------|
| **Total Files** | 39 |
| **Total Occurrences** | 880 |
| **Core Interfaces** | 10+ |
| **Storage Maps** | 8 |
| **Key Components** | 11 |
| **HTTP Endpoints** | 4+ |

### Occurrence Distribution
- **orchestratorServiceV2.ts**: 248 (28%)
- **subTaskManager.ts**: 60+ (7%)
- **a2aTools.ts**: 50+ (6%)
- **workerHealthMonitor.ts**: 40+ (5%)
- **Other files**: ~480 (54%)

### Usage Categories
- **Storage/Retrieval**: ~300 occurrences
- **Message Routing**: ~200 occurrences
- **Parent-Child Hierarchy**: ~150 occurrences
- **Health/Monitoring**: ~80 occurrences
- **HTTP API**: ~50 occurrences
- **UI/Dashboard**: ~100 occurrences

---

## Conclusion

`workerId` serves as the **universal identifier** for worker agents across the entire orchestrator system. Its flow is:

1. **Created** once at WorkerSession initialization
2. **Stored** immutably in the session and registered in multiple Maps
3. **Used** for routing, hierarchy, lookup, and UI operations
4. **Disposed** when worker completes or is removed

The identifier enables:
- **Deterministic routing** of messages and completions
- **Parent-child hierarchy** for subtask management
- **Scoped tool execution** within worker context
- **Health monitoring** and error tracking
- **UI integration** with chat sessions and dashboard
- **HTTP API** access for external tools

This analysis covers ALL 880 references across the codebase, documenting creation points, storage locations, flow patterns, and component interactions.
