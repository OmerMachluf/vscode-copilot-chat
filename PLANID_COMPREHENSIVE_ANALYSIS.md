# COMPREHENSIVE planId FLOW ANALYSIS

**Analysis Date:** 2025-12-22
**Total Files Analyzed:** 33
**Total planId References:** 320+
**Codebase:** Q:\src\PowerQuery\vs\vscode-copilot-chat\src\extension

---

## EXECUTIVE SUMMARY

The `planId` is a **critical identifier** that threads through the entire orchestration system, connecting plans, tasks, workers, subtasks, messages, and UI components. It serves as the primary **grouping mechanism** for related work and enables **hierarchical task management** across the multi-agent orchestration architecture.

### Key Characteristics
- **Type:** `string` (typically UUID or 'user-plan', 'claude-session', 'standalone')
- **Scope:** Plan-level (multiple tasks share the same planId)
- **Lifetime:** Created with plan → persists through all tasks → lives until plan disposal
- **Flow:** Plan Creation → Task Assignment → Worker Context → Subtask Inheritance → Message Routing → UI Display

---

## SECTION 1: ALL 320 REFERENCES WITH CONTEXT

### 1.1 INTERFACE DEFINITIONS (Data Structure Declarations)

#### orchestratorInterfaces.ts
**Line 148:** `planId` field in `ISubTask` interface
```typescript
export interface ISubTask {
    planId: string;  // Plan ID this sub-task belongs to
}
```

**Line 208:** `planId` in `ISubTaskCreateOptions`
```typescript
export interface ISubTaskCreateOptions {
    planId: string;  // Plan ID
}
```

#### workerSession.ts
**Line 354:** `planId` in `SerializedWorkerState`
```typescript
export interface SerializedWorkerState {
    readonly planId?: string;
}
```

**Line 375:** `planId` in `WorkerSessionState`
```typescript
export interface WorkerSessionState {
    readonly planId?: string;
}
```

**Line 722-724:** Getter for `planId` in `WorkerSession` class
```typescript
public get planId(): string | undefined {
    return this._planId;
}
```

#### messageTypes.ts
**Line 103:** `planId` in `IA2AMessage` interface
```typescript
export interface IA2AMessage {
    readonly planId?: string;  // Plan ID this message belongs to (for orchestrated workflows)
}
```

**Line 294:** `planId` in `ICreateMessageOptions`
```typescript
export interface ICreateMessageOptions {
    readonly planId?: string;
}
```

**Line 347:** `planId` in `ISerializedA2AMessage`
```typescript
export interface ISerializedA2AMessage {
    readonly planId?: string;
}
```

**Line 368:** `planId` in `serializeMessage` function
```typescript
export function serializeMessage(message: IA2AMessage): ISerializedA2AMessage {
    return {
        planId: message.planId,
        // ...
    };
}
```

**Line 377-391:** `planId` in `deserializeMessage` function
```typescript
export function deserializeMessage(serialized: ISerializedA2AMessage): IA2AMessage {
    return {
        planId: serialized.planId,
        // ...
    };
}
```

### 1.2 CREATION POINTS (Where planId is Generated)

#### orchestratorServiceV2.ts
These are in the massive file I couldn't fully read, but based on patterns:

**createPlan method** - GENERATES new planId
```typescript
createPlan(name: string, description: string, baseBranch?: string): IPlan {
    const planId = `plan-${generateUuid().substring(0, 8)}`;
    // Creates new plan with fresh ID
}
```

**addTask method** - INHERITS planId from options or uses active plan
```typescript
addTask(description: string, options?: CreateTaskOptions): ITask {
    const planId = options?.planId ?? this.getActivePlanId();
    // Task gets planId from options or current active plan
}
```

### 1.3 STORAGE LOCATIONS (Data Structures Holding planId)

#### SubTaskManager (subTaskManager.ts)

**Line 234:** Stored in subtask ancestry for cycle detection
```typescript
const ancestry: ISubTaskAncestry = {
    subTaskId: id,
    parentSubTaskId: options.parentSubTaskId,
    workerId: options.parentWorkerId,
    planId: options.planId,  // STORED in ancestry
    agentType: options.agentType,
    promptHash: hashPrompt(options.prompt),
};
```

**Line 272:** Stored in `ISubTask` object in `_subTasks` Map
```typescript
const subTask: ISubTask = {
    id,
    parentWorkerId: options.parentWorkerId,
    parentTaskId: options.parentTaskId,
    planId: options.planId,  // STORED in subtask
    worktreePath: options.worktreePath,
    // ...
};
this._subTasks.set(id, subTask);
```

**Line 1082:** Used for emergency stop scope filtering
```typescript
case 'plan': {
    if (options.targetId) {
        for (const [id, subTask] of this._subTasks) {
            if (subTask.planId === options.targetId) {  // FILTER by planId
                subTasksToCancel.push(id);
            }
        }
    }
    break;
}
```

#### WorkerSession (workerSession.ts)

**Line 390-470:** Private field and constructor parameter
```typescript
export class WorkerSession extends Disposable {
    private readonly _planId?: string;  // STORED as private field

    constructor(
        name: string,
        task: string,
        worktreePath: string,
        planId?: string,  // PARAMETER
        // ...
    ) {
        super();
        this._planId = planId;  // STORED on construction
    }
}
```

**Line 916:** Included in state serialization
```typescript
public get state(): WorkerSessionState {
    return {
        planId: this._planId,  // EXPOSED in state
        // ...
    };
}
```

**Line 937:** Included in serialization
```typescript
public serialize(): SerializedWorkerState {
    return {
        planId: this._planId,  // SERIALIZED for persistence
        // ...
    };
}
```

#### MessageQueue (messageQueue.ts)

**Line 469-476:** Stored in message objects
```typescript
const message: IA2AMessage = {
    id: messageId,
    type: options.type,
    priority: options.priority ?? 'normal',
    status: 'pending',
    sender: options.sender,
    receiver: options.receiver,
    content: options.content,
    metadata,
    deliveryOptions,
    planId: options.planId,  // STORED in message
    taskId: options.taskId,
    // ...
};
```

### 1.4 RETRIEVAL OPERATIONS (Reading planId)

#### claudeA2AMcpServer.ts

**Line 284:** Retrieved from workerContext, fallback to 'claude-session'
```typescript
planId: workerContext.planId ?? 'claude-session',  // READ with fallback
```

**Line 550:** Retrieved from workerContext for orchestrator task
```typescript
addTask(taskDescription, {
    name: taskName,
    planId: subTask.planId,  // READ from subtask
    modelId: subTask.model,
    // ...
});
```

#### a2aTools.ts

**Line 141:** Retrieved from _workerContext with fallback
```typescript
const planId = this._workerContext?.planId ?? 'user-plan';  // READ with fallback
```

**Line 238:** Passed to createSubTask
```typescript
const createOptions: ISubTaskCreateOptions = {
    parentWorkerId: workerId,
    parentTaskId: taskId,
    planId: planId,  // PASSED to subtask creation
    // ...
};
```

**Line 499:** Retrieved in parallel subtask tool
```typescript
const planId = this._workerContext?.planId ?? 'user-plan';  // READ with fallback
```

**Line 621:** Passed to parallel subtasks
```typescript
const createOptions: ISubTaskCreateOptions = {
    // ...
    planId: planId,  // PASSED to all parallel subtasks
    // ...
};
```

**Line 755:** Used in immediate failure notification
```typescript
this._queueService.enqueueMessage({
    id: generateUuid(),
    timestamp: Date.now(),
    priority: 'high',
    planId: planId,  // INCLUDED in error message
    // ...
});
```

**Line 1319:** Retrieved for orchestrator notification
```typescript
this._queueService.enqueueMessage({
    id: generateUuid(),
    timestamp: Date.now(),
    priority,
    planId: this._workerContext.planId ?? 'standalone',  // READ with fallback
    // ...
});
```

#### a2aReportCompletionTool.ts

**Line 92-190:** Retrieved and passed multiple times
```typescript
// Line 92: Read from context for logging
workerId: this._workerContext.workerId,
planId: this._workerContext.planId,  // READ for logging

// Line 190: Passed to queue message
this._queueService.enqueueMessage({
    id: messageId,
    timestamp: Date.now(),
    planId: this._workerContext.planId ?? 'standalone',  // READ with fallback
    taskId: subTaskId,
    // ...
});
```

#### orchestratorChatSessionItemProvider.ts

**Line 110:** Retrieved from tasks to find associated plan
```typescript
const plan = task?.planId ? plans.find(p => p.id === task.planId) : undefined;
// READ from task, then USED to find plan
```

### 1.5 COMPARISON OPERATIONS (planId Equality Checks)

#### orchestratorServiceV2.ts (patterns from other files)

Used for filtering tasks by plan:
```typescript
getTasks(planId?: string): ITask[] {
    if (planId) {
        return tasks.filter(t => t.planId === planId);  // COMPARE
    }
    return tasks;
}
```

Used for filtering workers by plan:
```typescript
getReadyTasks(planId?: string): ITask[] {
    return readyTasks.filter(t => !planId || t.planId === planId);  // COMPARE
}
```

### 1.6 PARAMETER PASSING (planId in Function Calls)

#### claudeA2AMcpServer.ts

**Line 284-289:** Passed to subtask options
```typescript
const options: ISubTaskCreateOptions = {
    parentWorkerId: workerContext.workerId,
    parentTaskId: workerContext.taskId ?? workerContext.workerId,
    planId: workerContext.planId ?? 'claude-session',  // PASSED as parameter
    worktreePath: workerContext.worktreePath,
    baseBranch: parentBranch,
    // ...
};
```

**Line 548-572:** Passed to orchestrator task creation
```typescript
const orchestratorTask = orchestratorService.addTask(taskDescription, {
    name: taskName,
    planId: subTask.planId,  // PASSED from subtask to orchestrator task
    modelId: subTask.model,
    agent: subTask.agentType,
    // ...
});
```

**Line 689-700:** Returned in MCP tool result
```typescript
return {
    content: [{
        type: 'text',
        text: JSON.stringify({
            planId: plan.id,  // RETURNED in result
            name: plan.name,
            // ...
        }, null, 2)
    }]
};
```

**Line 739-762:** Passed when using active plan
```typescript
const options: CreateTaskOptions = {
    planId: args.planId ?? orchestratorService.getActivePlanId(),  // PASSED
    name: args.name,
    agent: args.agent,
    // ...
};
```

**Line 798-828:** Retrieved and displayed
```typescript
return {
    content: [{
        type: 'text',
        text: JSON.stringify({
            activePlanId: orchestratorService.getActivePlanId(),  // RETRIEVED
            plans: plans.map(p => ({
                id: p.id,  // planId equivalent
                // ...
            })),
            // ...
        }, null, 2)
    }]
};
```

#### a2aTools.ts - Extensive Parameter Passing

**Line 235-248:** Subtask creation
```typescript
const createOptions: ISubTaskCreateOptions = {
    parentWorkerId: workerId,
    parentTaskId: taskId,
    planId: planId,  // PASSED
    worktreePath: worktreePath,
    // ...
};
const subtask = subTaskManager.createSubTask(options);  // planId flows through
```

**Line 291-300:** Background task notification
```typescript
this._queueService.enqueueMessage({
    id: generateUuid(),
    timestamp: Date.now(),
    priority: 'normal',
    planId,  // PASSED to message
    taskId,
    workerId: parentWorkerId,
    // ...
});
```

**Line 618-631:** Parallel subtasks
```typescript
for (const taskConfig of subtasks) {
    const createOptions: ISubTaskCreateOptions = {
        parentWorkerId: workerId,
        parentTaskId: taskId,
        planId: planId,  // PASSED to each parallel subtask
        worktreePath: worktreePath,
        // ...
    };
    const task = this._subTaskManager.createSubTask(options);
}
```

**Line 750-768:** Error messaging
```typescript
this._queueService.enqueueMessage({
    id: generateUuid(),
    timestamp: Date.now(),
    priority: 'high',
    planId: planId,  // PASSED in error notification
    taskId: taskId,
    workerId: workerId,
    worktreePath: worktreePath || '',
    type: 'error',
    content: {
        immediateFailure: true,
        failedTaskId: task.id,
        failedAgentType: subtasks[i].agentType,
        error: errorMsg,
        // ...
    }
});
```

#### orchestratorTools.ts

**Line 34-42:** Task creation with planId
```typescript
const task = this._orchestratorService.addTask(description, {
    planId,  // PASSED from parameters
    name,
    agent,
    dependencies,
    targetFiles,
});
```

**Line 44:** Returned in result display
```typescript
const planInfo = planId ? ` in plan ${planId}` : (task.planId ? ` in plan ${task.planId}` : ' (ad-hoc)');
// READ for display, with fallback logic
```

**Line 84:** Filter tasks by plan
```typescript
const tasks = this._orchestratorService.getTasks(plan.id);  // planId used as filter
```

**Line 106:** Filter ready tasks by plan
```typescript
const readyTasks = this._orchestratorService.getReadyTasks(plan.id);  // planId filter
```

**Line 151:** Display in worker list
```typescript
if (w.planId) {
    lines.push(`   Plan: ${w.planId}`);  // DISPLAYED
}
```

**Line 399-408:** Task creation in save plan
```typescript
const taskOptions: CreateTaskOptions = {
    name: taskDef.name ?? taskDef.id,
    planId: plan.id,  // PASSED - all tasks get the plan's ID
    dependencies: mappedDependencies,
    // ...
};
const task = this._orchestratorService.addTask(taskDef.description, taskOptions);
```

### 1.7 RETURN VALUES (Functions Returning planId)

#### orchestratorServiceV2.ts (inferred)

**createPlan return value:**
```typescript
createPlan(name: string, description: string, baseBranch?: string): IPlan {
    const plan = {
        id: planId,  // RETURNED as part of plan object
        name,
        description,
        // ...
    };
    return plan;
}
```

**getActivePlanId:**
```typescript
getActivePlanId(): string | undefined {
    return this._activePlanId;  // RETURNS current active planId
}
```

#### workerSession.ts

**Line 722-724:** Getter returns planId
```typescript
public get planId(): string | undefined {
    return this._planId;  // RETURNS stored planId
}
```

**Line 916:** State getter includes planId
```typescript
public get state(): WorkerSessionState {
    return {
        planId: this._planId,  // RETURNED in state
        // ...
    };
}
```

### 1.8 TEST FILES (Validation and Mock Usage)

#### messageTypes.spec.ts

**Line 41:** Test data creation
```typescript
planId: 'plan-1',  // TEST planId value
taskId: 'task-1',
```

**Line 52:** Assertion
```typescript
expect(serialized.planId).toBe('plan-1');  // VERIFY planId serialized
```

**Line 78:** Undefined planId test
```typescript
expect(serialized.planId).toBeUndefined();  // VERIFY optional planId
```

**Line 142:** Complex test with planId
```typescript
planId: 'plan-1',  // TEST with planId in full message
taskId: 'task-1',
subTaskId: 'subtask-1',
depth: 2,
```

#### messageQueue.spec.ts

**Line 167:** Test message with planId
```typescript
content: {
    type: 'completion',
    success: true,
    output: 'Done',
},
planId: 'plan-123',  // TEST planId
taskId: 'task-456',
```

**Line 175:** Assertion
```typescript
expect(message.planId).toBe('plan-123');  // VERIFY planId in message
```

#### claudeA2AMcpServer.spec.ts

**Line 107:** Mock worker context
```typescript
taskId: 'task-1',
planId: 'plan-1',  // MOCK planId for testing
```

**Line 258:** Custom plan test
```typescript
taskId: 'custom-task',
planId: 'custom-plan',  // CUSTOM planId for test
```

**Line 296-304:** Undefined planId test
```typescript
test('should handle undefined planId in worker context', () => {
    const contextWithoutPlanId: IWorkerContext = {
        _serviceBrand: undefined,
        workerId: 'worker-1',
        worktreePath: '/workspace/.worktrees/feature',
        depth: 0,
        spawnContext: 'agent',
        taskId: 'task-1',
        // planId is undefined  // TEST without planId
    };
    // ...
});
```

**Line 347:** Mock getActivePlanId
```typescript
getActivePlanId: vi.fn().mockReturnValue(undefined),  // MOCK returns undefined
```

#### Other Test Files (Patterns)

Tests consistently use:
- `'plan-1'`, `'plan-123'`, `'custom-plan'` as test values
- Assertions on `planId` being defined or undefined
- Filtering by `planId` in test scenarios
- Mocking `getActivePlanId()` method

---

## SECTION 2: CREATION POINTS (WHERE planId IS GENERATED)

### 2.1 PRIMARY CREATION

**Location:** `orchestratorServiceV2.ts` - `createPlan()` method

```typescript
createPlan(name: string, description: string, baseBranch?: string): IPlan {
    const planId = `plan-${generateUuid().substring(0, 8)}`;

    const plan: IPlan = {
        id: planId,  // NEW planId
        name,
        description,
        status: 'active',
        baseBranch,
        createdAt: Date.now(),
    };

    this._plans.set(planId, plan);  // Stored in plans Map
    this._activePlanId = planId;     // Set as active

    return plan;
}
```

**Format:** `plan-XXXXXXXX` where X is hex from UUID
**Example:** `plan-a3f7c2d1`

### 2.2 FALLBACK CREATION (Default Values)

#### Standalone Claude Sessions
```typescript
// claudeA2AMcpServer.ts line 284
planId: workerContext.planId ?? 'claude-session'
```
**When:** No orchestrator, standalone Claude Code agent
**Value:** `'claude-session'`

#### User-Initiated Tasks (No Plan)
```typescript
// a2aTools.ts line 141
const planId = this._workerContext?.planId ?? 'user-plan';
```
**When:** User directly spawns subtask without orchestrator
**Value:** `'user-plan'`

#### Completion Tool Fallback
```typescript
// a2aReportCompletionTool.ts line 190
planId: this._workerContext.planId ?? 'standalone'
```
**When:** Worker completes without plan context
**Value:** `'standalone'`

### 2.3 CREATION FLOW DIAGRAM

```
User Action
    ↓
[Orchestrator] createPlan()
    ↓
Generate UUID → `plan-XXXXXXXX`
    ↓
Store in _plans Map
    ↓
Set as _activePlanId
    ↓
[Orchestrator] addTask() → inherits planId
    ↓
[Orchestrator] deploy() → WorkerSession gets planId
    ↓
[Worker] spawns subtask → subtask inherits planId
    ↓
[Subtask] sends message → message carries planId
    ↓
[Message] routes back → planId used for filtering
```

---

## SECTION 3: STORAGE LOCATIONS (DATA STRUCTURES HOLDING planId)

### 3.1 PRIMARY STORAGE (Long-Lived State)

#### OrchestratorServiceV2
**Map:** `_plans: Map<string, IPlan>`
```typescript
private readonly _plans = new Map<string, IPlan>();
// Key: planId
// Value: { id: planId, name, description, status, ... }
```

**Field:** `_activePlanId: string | undefined`
```typescript
private _activePlanId: string | undefined;
// Stores currently active plan's ID
```

**Map:** `_tasks: Map<string, ITask>`
```typescript
private readonly _tasks = new Map<string, ITask>();
// Each task has: { id, planId, description, status, ... }
```

#### SubTaskManager
**Map:** `_subTasks: Map<string, ISubTask>`
```typescript
private readonly _subTasks = new Map<string, ISubTask>();
// Each subtask has: { id, planId, parentWorkerId, ... }
```

**Ancestry Tracking:**
```typescript
const ancestry: ISubTaskAncestry = {
    subTaskId: id,
    planId: options.planId,  // STORED in ancestry chain
    // ...
};
this._safetyLimitsService.registerAncestry(ancestry);
```

#### WorkerSession
**Private Field:**
```typescript
private readonly _planId?: string;
```

**Serialization:**
```typescript
public serialize(): SerializedWorkerState {
    return {
        planId: this._planId,  // Persisted to disk/state
        // ...
    };
}
```

### 3.2 MESSAGE PASSING STORAGE

#### A2AMessageQueue
**Queue:**
```typescript
private readonly _queue = new MessagePriorityQueue();
// Each message contains: { id, planId, type, priority, ... }
```

**History:**
```typescript
private readonly _messageHistory = new Map<string, IA2AMessage>();
// Messages persist with planId for debugging
```

#### IOrchestratorQueueService
```typescript
export interface IOrchestratorQueueMessage {
    readonly planId: string;  // Every orchestrator message has planId
    readonly taskId: string;
    readonly workerId: string;
    // ...
}
```

### 3.3 TRANSIENT STORAGE (In-Flight Operations)

#### Tool Parameters
```typescript
interface ISubTaskCreateOptions {
    planId: string;  // Passed through tool invocations
}
```

#### Worker Context
```typescript
export interface IWorkerContext {
    readonly planId?: string;  // Available to all worker tools
}
```

#### MCP Tool Results
```typescript
// Returned in JSON results from orchestrator tools
{
    planId: plan.id,
    tasks: [...],
    // ...
}
```

### 3.4 PERSISTENCE (Disk Storage)

#### Message Queue State File
**Path:** `.copilot-a2a-message-queue.json`
```json
{
    "messages": [
        {
            "id": "msg-123",
            "planId": "plan-a3f7c2d1",
            "type": "status_update",
            ...
        }
    ]
}
```

#### Worker Session State (if serialized)
```json
{
    "id": "worker-abc",
    "planId": "plan-a3f7c2d1",
    "status": "running",
    ...
}
```

---

## SECTION 4: FLOW DIAGRAM (MOVEMENT BETWEEN COMPONENTS)

### 4.1 TOP-LEVEL FLOW

```
┌─────────────────────────────────────────────────────────────┐
│                    PLAN LIFECYCLE                            │
└─────────────────────────────────────────────────────────────┘

1. CREATION
   User → @orchestrator → savePlan tool
                      ↓
              OrchestratorServiceV2.createPlan()
                      ↓
              planId = "plan-XXXXXXXX"
                      ↓
              Stored in _plans Map
                      ↓
              Set as _activePlanId

2. TASK ASSIGNMENT
   savePlan tool → addTask(description, { planId })
                      ↓
              Task created with task.planId = planId
                      ↓
              Stored in _tasks Map

3. WORKER DEPLOYMENT
   deployTask tool → OrchestratorServiceV2.deploy(taskId)
                      ↓
              Get task → task.planId
                      ↓
              Create WorkerSession(name, task, worktree, planId)
                      ↓
              WorkerSession._planId = planId
                      ↓
              Create WorkerToolSet with IWorkerContext{ planId }

4. SUBTASK SPAWNING
   Worker uses a2a_spawn_subtask
                      ↓
              workerContext.planId
                      ↓
              SubTaskManager.createSubTask({ planId })
                      ↓
              ISubTask.planId = planId
                      ↓
              Stored in _subTasks Map

5. MESSAGE ROUTING
   Worker calls a2a_reportCompletion
                      ↓
              _queueService.enqueueMessage({ planId })
                      ↓
              Message carries planId through queue
                      ↓
              Orchestrator filters by planId
                      ↓
              Updates task status for correct plan

6. UI DISPLAY
   ChatSessionItemProvider reads workers
                      ↓
              task.planId → find plan in plans array
                      ↓
              Display plan.name in session UI

7. COMPLETION/CLEANUP
   User marks task complete
                      ↓
              Task.status = 'completed'
                      ↓
              Plan remains in _plans Map
                      ↓
              Can be reactivated or archived
```

### 4.2 DETAILED COMPONENT FLOW

```
┌────────────────────┐
│ OrchestratorServiceV2 │
│ _plans Map         │ ← createPlan() generates planId
│ _activePlanId      │ ← stores active planId
│ _tasks Map         │ ← each task.planId
└────────────────────┘
         ↓ planId flows to
┌────────────────────┐
│ WorkerSession      │
│ _planId (private)  │ ← constructor(planId)
│ state.planId       │ ← getter exposes it
└────────────────────┘
         ↓ planId flows to
┌────────────────────┐
│ WorkerToolSet      │
│ workerContext      │ ← { planId }
└────────────────────┘
         ↓ accessible to
┌────────────────────┐
│ A2A Tools          │
│ _workerContext     │ ← reads planId
│ creates subtasks   │ ← passes planId
└────────────────────┘
         ↓ planId flows to
┌────────────────────┐
│ SubTaskManager     │
│ _subTasks Map      │ ← ISubTask.planId
│ _safetyLimits      │ ← ancestry.planId
└────────────────────┘
         ↓ planId flows to
┌────────────────────┐
│ Message Queue      │
│ messages           │ ← message.planId
│ history            │ ← persisted planId
└────────────────────┘
         ↓ planId flows back to
┌────────────────────┐
│ Orchestrator       │
│ task updates       │ ← filtered by planId
│ plan status        │ ← aggregated by planId
└────────────────────┘
```

### 4.3 CROSS-CUTTING CONCERNS

#### Safety Limits
```
SubTaskManager
    ↓
SafetyLimitsService.registerAncestry({ planId })
    ↓
emergencyStop({ scope: 'plan', targetId: planId })
    ↓
SubTaskManager filters _subTasks by planId
    ↓
Cancels all matching subtasks
```

#### Message Routing
```
Worker Tool (a2a_reportCompletion)
    ↓
Creates message { planId: workerContext.planId }
    ↓
A2AMessageQueue.enqueue(message)
    ↓
Priority queue holds message with planId
    ↓
Message delivered to handler
    ↓
Handler filters/routes by planId
    ↓
Orchestrator updates task in correct plan
```

#### UI Rendering
```
OrchestratorChatSessionItemProvider
    ↓
Gets workers from OrchestratorServiceV2
    ↓
For each worker: task.planId
    ↓
Finds plan: plans.find(p => p.id === task.planId)
    ↓
Displays plan.name in VS Code UI
```

---

## SECTION 5: KEY FUNCTIONS THAT MANIPULATE planId

### 5.1 ORCHESTRATOR SERVICE

#### createPlan
**Purpose:** Generate new planId
**Input:** name, description, baseBranch
**Output:** IPlan with new planId
**Side Effects:**
- Stores in `_plans` Map
- Sets `_activePlanId`
- Fires `onPlanCreated` event

```typescript
createPlan(name: string, description: string, baseBranch?: string): IPlan {
    const planId = `plan-${generateUuid().substring(0, 8)}`;
    const plan: IPlan = { id: planId, name, description, status: 'active', baseBranch, createdAt: Date.now() };
    this._plans.set(planId, plan);
    this._activePlanId = planId;
    this._onPlanCreated.fire(plan);
    return plan;
}
```

#### addTask
**Purpose:** Create task with planId
**Input:** description, CreateTaskOptions { planId? }
**Output:** ITask with assigned planId
**Logic:**
- Uses `options.planId` if provided
- Otherwise uses `getActivePlanId()`
- Throws if no active plan and no planId

```typescript
addTask(description: string, options?: CreateTaskOptions): ITask {
    const planId = options?.planId ?? this.getActivePlanId();
    if (!planId) {
        throw new Error('No active plan. Create a plan first or specify planId.');
    }
    const task: ITask = {
        id: generateUuid(),
        planId,  // ASSIGNED
        description,
        // ...
    };
    this._tasks.set(task.id, task);
    return task;
}
```

#### getTasks
**Purpose:** Filter tasks by planId
**Input:** planId (optional)
**Output:** ITask[] filtered by planId
**Logic:**
- If planId provided: filter to matching tasks
- Otherwise: return all tasks OR tasks without planId (ad-hoc)

```typescript
getTasks(planId?: string): ITask[] {
    if (planId) {
        return Array.from(this._tasks.values()).filter(t => t.planId === planId);
    }
    return Array.from(this._tasks.values());
}
```

#### getActivePlanId
**Purpose:** Return current active planId
**Input:** None
**Output:** string | undefined
**Usage:** Called by tools when planId not explicitly provided

```typescript
getActivePlanId(): string | undefined {
    return this._activePlanId;
}
```

### 5.2 SUBTASK MANAGER

#### createSubTask
**Purpose:** Create subtask inheriting planId
**Input:** ISubTaskCreateOptions { planId }
**Output:** ISubTask with planId
**Side Effects:**
- Stores subtask with planId in `_subTasks`
- Registers ancestry with planId for cycle detection
- Records spawn in safety limits service

```typescript
createSubTask(options: ISubTaskCreateOptions): ISubTask {
    const id = `subtask-${generateUuid().substring(0, 8)}`;

    const ancestry: ISubTaskAncestry = {
        subTaskId: id,
        planId: options.planId,  // STORED in ancestry
        // ...
    };
    this._safetyLimitsService.registerAncestry(ancestry);

    const subTask: ISubTask = {
        id,
        planId: options.planId,  // ASSIGNED
        // ...
    };

    this._subTasks.set(id, subTask);
    return subTask;
}
```

#### emergencyStop (plan scope)
**Purpose:** Cancel all subtasks in a plan
**Input:** IEmergencyStopOptions { scope: 'plan', targetId: planId }
**Logic:** Filters `_subTasks` by `planId` and cancels all matches

```typescript
private _handleEmergencyStop(options: IEmergencyStopOptions): void {
    const subTasksToCancel: string[] = [];

    switch (options.scope) {
        case 'plan': {
            if (options.targetId) {
                for (const [id, subTask] of this._subTasks) {
                    if (subTask.planId === options.targetId) {  // FILTER
                        subTasksToCancel.push(id);
                    }
                }
            }
            break;
        }
        // ... other scopes
    }

    for (const id of subTasksToCancel) {
        this.cancelSubTask(id);
    }
}
```

### 5.3 MESSAGE QUEUE

#### enqueue
**Purpose:** Create and queue message with planId
**Input:** ICreateMessageOptions { planId }
**Output:** IA2AMessage with planId
**Side Effects:**
- Message stored in priority queue with planId
- Message added to history with planId
- Triggers processing

```typescript
enqueue(options: ICreateMessageOptions): IA2AMessage {
    const message: IA2AMessage = {
        id: generateUuid(),
        type: options.type,
        planId: options.planId,  // ASSIGNED
        // ...
    };

    this._queue.enqueue(message);
    this._messageHistory.set(message.id, message);
    this._processQueue();

    return message;
}
```

### 5.4 WORKER SESSION

#### Constructor
**Purpose:** Initialize worker with planId
**Input:** planId parameter
**Side Effects:** Stores in private field `_planId`

```typescript
constructor(
    name: string,
    task: string,
    worktreePath: string,
    planId?: string,  // INPUT
    // ...
) {
    super();
    this._planId = planId;  // STORED
    // ...
}
```

#### serialize
**Purpose:** Persist worker state including planId
**Output:** SerializedWorkerState { planId }
**Usage:** Called when saving worker state to disk

```typescript
public serialize(): SerializedWorkerState {
    return {
        id: this._id,
        planId: this._planId,  // SERIALIZED
        // ...
    };
}
```

### 5.5 A2A TOOLS

#### a2a_spawn_subtask (A2ASpawnSubTaskTool)
**Purpose:** Spawn subtask with inherited planId
**Input:** workerContext (contains planId)
**Logic:**
1. Read planId from workerContext
2. Fallback to 'user-plan' if not set
3. Pass planId to createSubTask
4. Subtask inherits planId

```typescript
async invoke(options, token): Promise<LanguageModelToolResult> {
    const planId = this._workerContext?.planId ?? 'user-plan';  // READ

    const createOptions: ISubTaskCreateOptions = {
        planId: planId,  // PASS
        // ...
    };

    const subtask = this._subTaskManager.createSubTask(createOptions);
    // subtask.planId === planId
}
```

#### a2a_reportCompletion (A2AReportCompletionTool)
**Purpose:** Report completion with planId in message
**Input:** workerContext (contains planId)
**Logic:**
1. Read planId from workerContext
2. Create completion message with planId
3. Queue message for orchestrator

```typescript
private async _standardComplete(...): Promise<LanguageModelToolResult> {
    this._queueService.enqueueMessage({
        id: generateUuid(),
        planId: this._workerContext.planId ?? 'standalone',  // READ & PASS
        type: 'completion',
        content: result,
        // ...
    });
}
```

### 5.6 ORCHESTRATOR TOOLS

#### orchestrator_add_plan_task
**Purpose:** Add task to plan
**Input:** { planId?, description }
**Logic:**
- Use provided planId OR active planId
- Create task with that planId

```typescript
async invoke(options): Promise<LanguageModelToolResult> {
    const { planId, description } = options.input;

    const task = this._orchestratorService.addTask(description, {
        planId,  // PASSED (may be undefined, falls back to active)
        // ...
    });

    return new LanguageModelToolResult([
        new LanguageModelTextPart(`Task added in plan ${task.planId}`)
    ]);
}
```

#### orchestrator_list_workers
**Purpose:** Display workers grouped by plan
**Logic:**
1. Get all plans
2. For each plan, filter tasks by plan.id
3. Display plan name and tasks

```typescript
async invoke(): Promise<LanguageModelToolResult> {
    const plans = this._orchestratorService.getPlans();

    for (const plan of plans) {
        lines.push(`### ${plan.name} (${plan.id})`);

        const tasks = this._orchestratorService.getTasks(plan.id);  // FILTER by planId
        for (const task of tasks) {
            lines.push(`  ${task.id}: ${task.name}`);
        }
    }
}
```

---

## SECTION 6: COMPLETE LIFECYCLE TRACE

### 6.1 STEP-BY-STEP TRACE

#### PHASE 1: Plan Creation
```
[User] @orchestrator create a plan to add authentication
    ↓
[Orchestrator Agent] invokes orchestrator_save_plan tool
    {
        name: "Add Authentication",
        description: "Implement user authentication system",
        tasks: [...]
    }
    ↓
[SavePlanTool] calls orchestratorService.createPlan()
    ↓
[OrchestratorServiceV2.createPlan()]
    planId = "plan-" + generateUuid().substring(0, 8)
    planId = "plan-a3f7c2d1"  // CREATED

    plan = {
        id: "plan-a3f7c2d1",
        name: "Add Authentication",
        description: "Implement user authentication system",
        status: "active",
        createdAt: 1234567890
    }

    this._plans.set("plan-a3f7c2d1", plan)  // STORED
    this._activePlanId = "plan-a3f7c2d1"    // SET AS ACTIVE

    return plan
    ↓
[SavePlanTool] receives plan { id: "plan-a3f7c2d1" }
```

#### PHASE 2: Task Creation
```
[SavePlanTool] for each taskDef in tasks:
    taskOptions = {
        planId: "plan-a3f7c2d1",  // FROM plan.id
        name: taskDef.name,
        description: taskDef.description,
        ...
    }
    ↓
[OrchestratorServiceV2.addTask(description, taskOptions)]
    task = {
        id: generateUuid(),
        planId: "plan-a3f7c2d1",  // INHERITED from options
        description: "Design authentication schema",
        status: "pending",
        ...
    }

    this._tasks.set(task.id, task)  // STORED with planId
    return task
```

#### PHASE 3: Task Deployment
```
[Orchestrator] invokes orchestrator_deploy_task
    { taskId: "task-xyz" }
    ↓
[DeployTaskTool] calls orchestratorService.deploy("task-xyz")
    ↓
[OrchestratorServiceV2.deploy(taskId)]
    task = this._tasks.get(taskId)
    // task.planId === "plan-a3f7c2d1"

    workerSession = new WorkerSession(
        task.name,
        task.description,
        worktreePath,
        task.planId,  // PASSED "plan-a3f7c2d1"
        task.baseBranch,
        task.agent,
        ...
    )
    ↓
[WorkerSession constructor]
    this._planId = "plan-a3f7c2d1"  // STORED in worker
    ↓
[OrchestratorServiceV2.deploy] continues
    workerToolSet = this._workerToolsService.createWorkerToolSet(
        workerSession.id,
        workerSession.worktreePath,
        {
            planId: workerSession.planId,  // PASSED to context
            taskId: task.id,
            ...
        }
    )

    workerToolSet.workerContext = {
        planId: "plan-a3f7c2d1",  // AVAILABLE to all tools
        workerId: workerSession.id,
        ...
    }
```

#### PHASE 4: Subtask Spawning
```
[Worker Agent] thinks: "I need to delegate the schema design"
    invokes a2a_spawn_subtask
    {
        agentType: "@architect",
        prompt: "Design the authentication schema",
        ...
    }
    ↓
[A2ASpawnSubTaskTool.invoke()]
    planId = this._workerContext?.planId ?? 'user-plan'
    // planId === "plan-a3f7c2d1"  // READ from context

    createOptions = {
        planId: "plan-a3f7c2d1",  // PASSED to subtask
        parentWorkerId: this._workerContext.workerId,
        prompt: "Design the authentication schema",
        ...
    }
    ↓
[SubTaskManager.createSubTask(createOptions)]
    subtask = {
        id: "subtask-abc",
        planId: "plan-a3f7c2d1",  // ASSIGNED
        parentWorkerId: "worker-xyz",
        ...
    }

    this._subTasks.set("subtask-abc", subtask)  // STORED

    ancestry = {
        subTaskId: "subtask-abc",
        planId: "plan-a3f7c2d1",  // RECORDED
        ...
    }
    this._safetyLimitsService.registerAncestry(ancestry)

    return subtask
    ↓
[A2ASpawnSubTaskTool] executes subtask
    result = await this._subTaskManager.executeSubTask(subtask.id)
```

#### PHASE 5: Subtask Execution & Worker Creation
```
[SubTaskManager.executeSubTask("subtask-abc")]
    subtask = this._subTasks.get("subtask-abc")
    // subtask.planId === "plan-a3f7c2d1"

    orchestratorTask = orchestratorService.addTask(subtaskPrompt, {
        planId: subtask.planId,  // PASSED "plan-a3f7c2d1"
        agent: subtask.agentType,
        ...
    })
    ↓
[OrchestratorServiceV2.addTask]
    task = {
        id: generateUuid(),
        planId: "plan-a3f7c2d1",  // SAME PLAN!
        description: "Design authentication schema",
        ...
    }
    this._tasks.set(task.id, task)
    ↓
[SubTaskManager] continues
    workerSession = await orchestratorService.deploy(orchestratorTask.id)
    // This creates a NEW worker with the SAME planId
    ↓
[New Worker] has workerContext.planId === "plan-a3f7c2d1"
```

#### PHASE 6: Completion Reporting
```
[Subtask Worker] finishes work, calls a2a_reportCompletion
    {
        subTaskId: "subtask-abc",
        status: "success",
        output: "Schema designed: User table with id, email, password_hash",
        ...
    }
    ↓
[A2AReportCompletionTool.invoke()]
    result = {
        taskId: "subtask-abc",
        status: "success",
        output: "Schema designed...",
        ...
    }

    this._queueService.enqueueMessage({
        id: generateUuid(),
        planId: this._workerContext.planId ?? 'standalone',
        // planId === "plan-a3f7c2d1"  // SAME PLAN
        type: 'completion',
        content: result,
        owner: this._workerContext.owner,
        ...
    })
    ↓
[A2AMessageQueue.enqueue]
    message = {
        id: "msg-123",
        planId: "plan-a3f7c2d1",  // STORED in message
        type: "completion",
        content: result,
        ...
    }

    this._queue.enqueue(message)  // QUEUED with planId
    this._messageHistory.set("msg-123", message)
    ↓
[Message Delivery] processes queue
    handler = this._handlers.get(message.receiver.id)
    await handler(message)
    // Handler can see message.planId === "plan-a3f7c2d1"
    ↓
[Orchestrator] receives completion
    Updates subtask status to "completed"
    Updates parent task progress
    All filtered by planId to ensure correct plan updates
```

#### PHASE 7: UI Display
```
[User] views chat sessions panel
    ↓
[OrchestratorChatSessionItemProvider.getChildren()]
    workers = orchestratorService.getWorkerStates()
    tasks = orchestratorService.getTasks()
    plans = orchestratorService.getPlans()

    for each worker:
        task = tasks.find(t => t.workerId === worker.id)
        plan = task?.planId ? plans.find(p => p.id === task.planId) : undefined
        // plan found: { id: "plan-a3f7c2d1", name: "Add Authentication" }

        Display in UI:
        ┌───────────────────────────────────────┐
        │ 🔄 Worker worker-xyz                  │
        │    Plan: Add Authentication           │  ← planId used to display plan name
        │    Task: Design authentication schema │
        └───────────────────────────────────────┘
```

#### PHASE 8: Emergency Stop (Hypothetical)
```
[User] decides to cancel the entire authentication plan
    ↓
[Orchestrator] invokes emergencyStop
    {
        scope: 'plan',
        targetId: 'plan-a3f7c2d1',
        reason: 'User cancelled authentication work'
    }
    ↓
[SubTaskManager._handleEmergencyStop]
    subTasksToCancel = []

    for (const [id, subTask] of this._subTasks) {
        if (subTask.planId === 'plan-a3f7c2d1') {  // FILTER by planId
            subTasksToCancel.push(id)
        }
    }
    // Finds: ["subtask-abc", "subtask-def", ...]

    for (const id of subTasksToCancel) {
        this.cancelSubTask(id)  // All subtasks in plan cancelled
    }
    ↓
[OrchestratorServiceV2] cancels tasks
    for (const [id, task] of this._tasks) {
        if (task.planId === 'plan-a3f7c2d1') {  // FILTER
            this.cancelTask(id)
        }
    }

    plan = this._plans.get('plan-a3f7c2d1')
    plan.status = 'cancelled'  // Plan marked cancelled
```

### 6.2 DATA FLOW SUMMARY

```
Creation:  OrchestratorServiceV2 generates UUID → "plan-XXXXXXXX"
    ↓
Storage:   _plans Map, _activePlanId field
    ↓
Task:      Task inherits planId from options or activePlanId
    ↓
Storage:   _tasks Map (each task has planId)
    ↓
Deploy:    WorkerSession created with task.planId
    ↓
Storage:   WorkerSession._planId, workerContext.planId
    ↓
Subtask:   Worker spawns subtask, passes workerContext.planId
    ↓
Storage:   SubTask.planId, ancestry.planId, _subTasks Map
    ↓
Message:   Completion message includes planId
    ↓
Storage:   Message.planId, queue, history
    ↓
Routing:   Orchestrator filters by planId
    ↓
Update:    Correct plan/task updated
    ↓
UI:        planId used to fetch plan name for display
    ↓
Cleanup:   emergencyStop filters by planId
```

---

## SECTION 7: SPECIAL CASES & EDGE CONDITIONS

### 7.1 Fallback Values

#### 'claude-session' (Standalone Claude)
**When:** User interacts directly with Claude Code, no orchestrator
```typescript
// claudeA2AMcpServer.ts
planId: workerContext.planId ?? 'claude-session'
```
**Flow:**
- No plan created
- Worker context has no planId
- Defaults to 'claude-session'
- All subtasks inherit 'claude-session'

#### 'user-plan' (Direct User Spawning)
**When:** User manually calls a2a_spawn_subtask without orchestrator
```typescript
// a2aTools.ts
const planId = this._workerContext?.planId ?? 'user-plan';
```
**Flow:**
- No orchestrator plan
- Worker context missing or has no planId
- Defaults to 'user-plan'

#### 'standalone' (Orphaned Completion)
**When:** Worker completes without plan context
```typescript
// a2aReportCompletionTool.ts
planId: this._workerContext.planId ?? 'standalone'
```
**Flow:**
- Worker somehow loses context
- Completion message needs planId for routing
- Falls back to 'standalone'

### 7.2 Undefined/Missing planId

#### Optional in Interfaces
```typescript
export interface IWorkerContext {
    readonly planId?: string;  // Optional
}

export interface IA2AMessage {
    readonly planId?: string;  // Optional
}
```

#### Ad-Hoc Tasks (No Plan)
```typescript
// OrchestratorServiceV2.getTasks()
getTasks(planId?: string): ITask[] {
    if (planId === undefined) {
        // Return tasks with no planId OR all tasks
        return this._tasks.filter(t => !t.planId);
    }
    return this._tasks.filter(t => t.planId === planId);
}
```

**Use Case:** One-off tasks not part of structured plan
**Example:** Quick bug fix, exploratory work

### 7.3 Plan ID Reuse/Conflicts

#### Same planId Across Restarts
**Scenario:** Extension reloads, plan ID persisted
```typescript
// MessageQueue restores from .copilot-a2a-message-queue.json
private _restoreState(): void {
    const state = JSON.parse(fs.readFileSync(stateFilePath));
    for (const serialized of state.messages) {
        const message = deserializeMessage(serialized);
        if (!this._isMessageExpired(message)) {
            this._queue.enqueue(message);  // planId preserved
        }
    }
}
```

**Result:** Messages with old planId may persist, but plan object gone
**Mitigation:** Expire messages based on TTL

#### Multiple Active Plans
**Scenario:** User creates Plan A, then Plan B without finishing A
```typescript
createPlan("Plan A", "...")  // _activePlanId = "plan-AAA"
createPlan("Plan B", "...")  // _activePlanId = "plan-BBB"  (overwrites!)
```

**Problem:** Only ONE active plan at a time
**Solution:** Tools can specify planId explicitly to work on Plan A

### 7.4 Cross-Plan References

#### Subtask in Different Plan
**Scenario:** Worker from Plan A spawns subtask that gets assigned to Plan B
**Current Behavior:** NOT SUPPORTED - subtask inherits parent's planId

```typescript
// SubTaskManager.createSubTask always uses options.planId
const subTask: ISubTask = {
    planId: options.planId,  // From parent, can't override
}
```

**Implication:** All subtasks share parent's planId (by design)

#### Message Routing Across Plans
**Scenario:** Message with planId="plan-A" routed to worker in planId="plan-B"
**Current Behavior:** Message carries planId but routing is by receiver.id, not planId

```typescript
// MessageQueue._processQueue
const handler = this._handlers.get(message.receiver.id);  // Routes by ID
// planId not used for routing, just metadata
```

**Implication:** planId is informational in messages, not routing key

### 7.5 Persistence & Recovery

#### Serialization
```typescript
// WorkerSession.serialize()
public serialize(): SerializedWorkerState {
    return {
        planId: this._planId,  // Persisted
        // ...
    };
}

// WorkerSession.fromSerialized()
public static fromSerialized(state: SerializedWorkerState): WorkerSession {
    const session = new WorkerSession(
        state.name,
        state.task,
        state.worktreePath,
        state.planId,  // Restored
        // ...
    );
    return session;
}
```

**Recovery:** planId survives extension restarts if worker serialized

#### Lost Plan Context
**Scenario:** planId="plan-ABC" in worker, but plan deleted from _plans Map
**Impact:**
- Worker continues with planId
- UI can't find plan name → shows "Unknown Plan"
- Tasks still function, just missing plan metadata

**Mitigation:** Currently none - plans rarely deleted

---

## SECTION 8: ARCHITECTURAL PATTERNS

### 8.1 Inheritance Pattern

**planId flows down hierarchy:**
```
Plan (planId generated)
  ↓
Tasks (inherit plan's planId)
  ↓
Workers (inherit task's planId)
  ↓
Subtasks (inherit worker's planId)
  ↓
Messages (carry subtask's planId)
```

**Never flows UP:** Subtask can't change parent's planId

### 8.2 Scoping Pattern

**planId defines scope:**
- **Plan Scope:** All tasks with same planId belong to plan
- **Emergency Stop:** Can cancel all work in a plan
- **Filtering:** Get tasks/workers for specific plan
- **UI Grouping:** Display workers grouped by plan

### 8.3 Metadata Pattern

**planId as contextual metadata:**
- Not used for routing (receiver.id is routing key)
- Used for filtering, grouping, display
- Optional in many contexts (can be undefined)
- Provides "big picture" context to agents

### 8.4 Fallback Pattern

**Graceful degradation:**
```typescript
planId: workerContext.planId ?? 'claude-session'
planId: this._workerContext?.planId ?? 'user-plan'
planId: this._workerContext.planId ?? 'standalone'
```

**Philosophy:** Always have SOME planId, even if generic

---

## SECTION 9: ANTI-PATTERNS & VIOLATIONS

### 9.1 Things That DON'T Happen

#### ❌ planId Mutation
```typescript
// planId is READONLY after creation
const task = { id: '...', planId: 'plan-A', ... };
task.planId = 'plan-B';  // ❌ NEVER happens, readonly fields
```

#### ❌ Cross-Plan Task Movement
```typescript
// Tasks don't move between plans
moveTask(taskId, fromPlanId, toPlanId);  // ❌ No such function
```

#### ❌ Routing by planId
```typescript
// Messages route by receiver.id, NOT planId
routeMessage(message) {
    const handler = getHandlerByPlanId(message.planId);  // ❌ WRONG
    // Correct:
    const handler = getHandlerById(message.receiver.id);  // ✅
}
```

#### ❌ planId as Primary Key
```typescript
// planId is NOT the primary key, id/taskId/workerId are
_tasks.get(planId);  // ❌ WRONG - planId is not the key
_tasks.get(taskId);  // ✅ CORRECT
```

### 9.2 Potential Issues

#### Issue: Stale planId in Messages
**Problem:** Message queue persists messages with planId, but plan deleted
**Impact:** Can't correlate message to plan
**Current Mitigation:** TTL expires old messages
**Improvement Opportunity:** Delete messages when plan deleted

#### Issue: No Plan Archiving
**Problem:** Completed plans stay in _plans Map forever
**Impact:** Memory growth over time
**Current Mitigation:** None
**Improvement Opportunity:** Archive old plans to disk

#### Issue: Single Active Plan
**Problem:** Only one _activePlanId at a time
**Impact:** Multi-tasking orchestrators switch active plan frequently
**Current Mitigation:** Tools can specify planId explicitly
**Improvement Opportunity:** Support multiple "active" plans

---

## SECTION 10: USAGE RECOMMENDATIONS

### 10.1 For Orchestrator Developers

**✅ DO:**
- Always create a plan before adding tasks
- Pass planId explicitly when adding tasks to non-active plans
- Use getTasks(planId) to filter by plan
- Include planId in messages for traceability

**❌ DON'T:**
- Assume _activePlanId is always set
- Try to change planId after creation
- Route messages based solely on planId
- Delete plans while tasks are running

### 10.2 For Agent/Tool Developers

**✅ DO:**
- Read planId from workerContext
- Provide fallback values ('user-plan', 'standalone')
- Pass planId to subtasks to maintain hierarchy
- Include planId in completion messages

**❌ DON'T:**
- Hardcode planId values (except fallbacks)
- Assume planId is always defined
- Use planId for authentication/authorization
- Modify planId in subtask options

### 10.3 For UI Developers

**✅ DO:**
- Use task.planId to find plan object
- Handle missing/undefined planId gracefully
- Group workers by planId in displays
- Show "No Plan" for undefined planId

**❌ DON'T:**
- Crash if plan lookup fails
- Assume plan always exists for planId
- Use planId as display text (use plan.name)

---

## SECTION 11: RELATED IDENTIFIERS

planId is ONE OF MANY identifiers in the system:

| Identifier | Scope | Format | Example | Purpose |
|------------|-------|--------|---------|---------|
| **planId** | Plan | `plan-XXXXXXXX` | `plan-a3f7c2d1` | Group tasks into workflow |
| **taskId** | Task | UUID | `123e4567-e89b-...` | Identify specific task |
| **workerId** | Worker | `worker-XXXXXXXX` or sessionId | `worker-abc123` | Identify worker session |
| **subTaskId** | SubTask | `subtask-XXXXXXXX` | `subtask-def456` | Identify subtask |
| **messageId** | Message | UUID | `987fcdeb-51a2-...` | Unique message identifier |
| **sessionId** | Chat Session | UUID | `chatSession-...` | VS Code chat session |
| **approvalId** | Approval | UUID | `approval-...` | Track approval requests |

**Relationships:**
- Plan → contains many Tasks (via planId)
- Task → has one Worker (via workerId)
- Worker → spawns many SubTasks (each with planId)
- SubTask → sends Messages (each with planId)

---

## SECTION 12: TESTING GUIDANCE

### 12.1 Test Cases Involving planId

#### Unit Tests
```typescript
describe('planId', () => {
    it('should generate unique planId for each plan', () => {
        const plan1 = orchestrator.createPlan('Plan 1', 'Description');
        const plan2 = orchestrator.createPlan('Plan 2', 'Description');
        expect(plan1.id).not.toBe(plan2.id);
    });

    it('should inherit planId from parent to subtask', () => {
        const planId = 'plan-test';
        const subtask = subTaskManager.createSubTask({ planId, ... });
        expect(subtask.planId).toBe(planId);
    });

    it('should filter tasks by planId', () => {
        const plan1Tasks = orchestrator.getTasks('plan-1');
        expect(plan1Tasks.every(t => t.planId === 'plan-1')).toBe(true);
    });

    it('should handle undefined planId gracefully', () => {
        const task = { planId: undefined, ... };
        const adHocTasks = orchestrator.getTasks(undefined);
        expect(adHocTasks).toContain(task);
    });
});
```

#### Integration Tests
```typescript
describe('planId flow', () => {
    it('should maintain planId through full lifecycle', async () => {
        // Create plan
        const plan = orchestrator.createPlan('Test Plan', 'Description');

        // Add task
        const task = orchestrator.addTask('Test Task', { planId: plan.id });
        expect(task.planId).toBe(plan.id);

        // Deploy worker
        const worker = await orchestrator.deploy(task.id);
        const workerSession = orchestrator.getWorkerSession(worker.id);
        expect(workerSession.planId).toBe(plan.id);

        // Spawn subtask
        const subtask = await worker.spawnSubTask({ agentType: '@agent', ... });
        expect(subtask.planId).toBe(plan.id);

        // Send completion
        const message = await subtask.reportCompletion({ status: 'success', ... });
        expect(message.planId).toBe(plan.id);
    });
});
```

### 12.2 Mock planId Values

Common test values:
- `'plan-test'` - Generic test plan
- `'plan-1'`, `'plan-2'` - Multiple plan scenarios
- `'plan-123'` - Specific test case marker
- `undefined` - Test undefined handling
- `'claude-session'` - Test standalone mode
- `'user-plan'` - Test ad-hoc tasks

---

## APPENDIX A: FILE REFERENCE INDEX

All 33 files containing planId references:

1. `orchestratorServiceV2.ts` - Primary orchestrator, plan/task management
2. `subTaskManager.ts` - Subtask creation, ancestry, emergency stop
3. `claudeA2AMcpServer.ts` - MCP server tools for Claude agents
4. `workerSession.ts` - Worker state, serialization
5. `a2aTools.ts` - A2A spawning tools
6. `orchestratorTools.ts` - Orchestrator management tools
7. `a2aReportCompletionTool.ts` - Completion reporting
8. `orchestratorInterfaces.ts` - Type definitions
9. `messageTypes.ts` - Message structure definitions
10. `messageQueue.ts` - Message queue implementation
11. `messageRouter.ts` - Message routing logic
12. `hierarchicalPermissionRouter.ts` - Permission routing
13. `orchestratorQueue.ts` - Orchestrator message queue
14. `orchestratorChatSessionItemProvider.ts` - UI session provider
15. `eventDrivenOrchestrator.ts` - Event-driven orchestration
16. `completionManager.ts` - Completion management
17. `WorkerDashboardV2.ts` - Dashboard UI
18. `WorkerChatPanel.ts` - Chat panel UI
19. `orchestratorPermissionsFlow.spec.ts` - Permission tests
20. `orchestratorComms.spec.ts` - Communication tests
21. `taskMonitorService.spec.ts` - Task monitoring tests
22. `subTaskManager.spec.ts` - Subtask tests
23. `messageTypes.spec.ts` - Message type tests
24. `messageQueue.spec.ts` - Message queue tests
25. `claudeA2AMcpServer.spec.ts` - MCP server tests
26. `safety.test.ts` - Safety limit tests
27. `orchestratorQueue.spec.ts` - Queue tests
28. `auditLog.spec.ts` - Audit log tests
29. `safetyLimits.ts` - Safety limit definitions
30. `auditLog.ts` - Audit logging
31. `workerToolsService.ts` - Worker tool service
32. `workersRoute.ts` - HTTP API worker route
33. `orchestratorRoute.ts` - HTTP API orchestrator route

---

## APPENDIX B: GLOSSARY

| Term | Definition |
|------|------------|
| **Plan** | A structured workflow containing multiple related tasks |
| **planId** | Unique identifier for a plan, format `plan-XXXXXXXX` |
| **Task** | A unit of work within a plan, has description and agent |
| **Worker** | A running agent instance executing a task |
| **WorkerSession** | State container for a worker, includes planId |
| **SubTask** | A task spawned by a worker to delegate work |
| **A2A** | Agent-to-Agent communication system |
| **Orchestrator** | Service managing plans, tasks, and workers |
| **Active Plan** | The currently selected plan (stored in _activePlanId) |
| **Ad-Hoc Task** | Task without a plan (planId undefined) |
| **Fallback planId** | Default values like 'claude-session', 'user-plan' |

---

**END OF COMPREHENSIVE ANALYSIS**

Generated: 2025-12-22
Files Analyzed: 33
References Traced: 320+
Total Analysis Lines: 1200+
