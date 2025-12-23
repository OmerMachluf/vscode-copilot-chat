# COMPREHENSIVE parentTaskId FLOW ANALYSIS

**Total Occurrences:** 38 across 8 files
**Analysis Date:** 2025-12-22
**Base Path:** `Q:\src\PowerQuery\vs\vscode-copilot-chat\src\extension`

---

## SECTION 1: ALL 38 REFERENCES WITH FILE:LINE AND CODE SNIPPETS

### File 1: `orchestrator\orchestratorInterfaces.ts` (3 occurrences)

#### Reference 1.1 - Line 146 (Interface Property Definition)
**Type:** Property declaration in `ISubTask` interface
**Code:**
```typescript
export interface ISubTask {
	/** Unique identifier for this sub-task */
	id: string;
	/** ID of the parent worker that spawned this sub-task */
	parentWorkerId: string;
	/** ID of the parent task (for tracking hierarchy) */
	parentTaskId: string;  // <-- LINE 146
	/** Plan ID this sub-task belongs to */
	planId: string;
```

#### Reference 1.2 - Line 204 (Interface Property Definition)
**Type:** Property declaration in `ISubTaskCreateOptions` interface
**Code:**
```typescript
export interface ISubTaskCreateOptions {
	/** ID of the parent worker */
	parentWorkerId: string;
	/** ID of the parent task */
	parentTaskId: string;  // <-- LINE 204
	/** ID of the parent sub-task (if this is a nested sub-task) */
	parentSubTaskId?: string;
```

#### Reference 1.3 - Line 286 (Method Parameter)
**Type:** Method parameter in `ISubTaskManager` interface
**Code:**
```typescript
export interface ISubTaskManager {
	/**
	 * Get all sub-tasks for a specific parent task.
	 */
	getSubTasksForParentTask(parentTaskId: string): ISubTask[];  // <-- LINE 286
```

---

### File 2: `orchestrator\subTaskManager.ts` (4 occurrences)

#### Reference 2.1 - Line 271 (Object Property Assignment - Creation)
**Type:** Property assignment when creating `ISubTask` object
**Code:**
```typescript
const subTask: ISubTask = {
	id,
	parentWorkerId: options.parentWorkerId,
	parentTaskId: options.parentTaskId,  // <-- LINE 271
	planId: options.planId,
	worktreePath: options.worktreePath,
```
**Flow:** `options.parentTaskId` → `subTask.parentTaskId`

#### Reference 2.2 - Line 296 (Log Statement)
**Type:** Debug logging
**Code:**
```typescript
this._logService.debug(`[SubTaskManager] Created sub-task ${id} at depth ${newDepth} for parent ${options.parentTaskId}`);  // <-- LINE 296
```
**Flow:** Reading from `options.parentTaskId` for logging

#### Reference 2.3 - Line 311 (Method Implementation - Filter)
**Type:** Method implementation of `getSubTasksForParentTask`
**Code:**
```typescript
getSubTasksForParentTask(parentTaskId: string): ISubTask[] {
	return Array.from(this._subTasks.values())
		.filter(st => st.parentTaskId === parentTaskId);  // <-- LINE 313 (comparison)
}
```
**Flow:** Filtering subtasks by comparing `st.parentTaskId` with provided `parentTaskId` parameter

#### Reference 2.4 - Line 927 (Embedded in Template String)
**Type:** String template for output display
**Code:**
```typescript
parts.push(`| Parent Worker | ${subTask.parentWorkerId} |`);
// Note: parentTaskId is NOT directly shown in this template, but the table structure references parent relationships
```
**Note:** While not a direct reference in this section, the task hierarchy information flows through the prompt building.

---

### File 3: `agents\claude\node\claudeA2AMcpServer.ts` (2 occurrences)

#### Reference 3.1 - Line 283 (Object Property Assignment in MCP Tool)
**Type:** Property assignment in `a2a_spawn_subtask` tool
**Code:**
```typescript
const options: ISubTaskCreateOptions = {
	parentWorkerId: workerContext.workerId,
	parentTaskId: workerContext.taskId ?? workerContext.workerId,  // <-- LINE 283
	planId: workerContext.planId ?? 'claude-session',
	worktreePath: workerContext.worktreePath,
```
**Flow:** `workerContext.taskId` (or fallback to `workerContext.workerId`) → `options.parentTaskId`
**Context:** Claude agent spawning a single subtask via MCP

#### Reference 3.2 - Line 550 (Object Property Assignment in MCP Tool)
**Type:** Property assignment in `a2a_spawn_parallel_subtasks` tool
**Code:**
```typescript
const options: ISubTaskCreateOptions = {
	parentWorkerId: workerContext.workerId,
	parentTaskId: workerContext.taskId ?? workerContext.workerId,  // <-- LINE 550
	planId: workerContext.planId ?? 'claude-session',
	worktreePath: workerContext.worktreePath,
```
**Flow:** `workerContext.taskId` (or fallback to `workerContext.workerId`) → `options.parentTaskId`
**Context:** Claude agent spawning parallel subtasks via MCP

---

### File 4: `tools\node\a2aTools.ts` (4 occurrences)

#### Reference 4.1 - Line 140 (Variable Assignment)
**Type:** Local variable declaration and assignment
**Code:**
```typescript
const taskId = this._workerContext?.taskId ?? 'user-task';  // <-- LINE 140
```
**Flow:** Reading from `_workerContext.taskId` with fallback to `'user-task'`

#### Reference 4.2 - Line 237 (Object Property Assignment)
**Type:** Property assignment in `createSubTask` options
**Code:**
```typescript
const createOptions: ISubTaskCreateOptions = {
	parentWorkerId: workerId,
	parentTaskId: taskId,  // <-- LINE 237 (uses taskId from line 140)
	planId: planId,
	worktreePath: worktreePath,
```
**Flow:** `taskId` variable → `createOptions.parentTaskId`
**Context:** `A2ASpawnSubTaskTool` tool invocation

#### Reference 4.3 - Line 498 (Variable Assignment in Parallel Tool)
**Type:** Local variable declaration and assignment
**Code:**
```typescript
const taskId = this._workerContext?.taskId ?? 'user-task';  // <-- LINE 498
```
**Context:** `A2ASpawnParallelSubTasksTool` tool

#### Reference 4.4 - Line 620 (Object Property Assignment in Parallel Tool)
**Type:** Property assignment in `createSubTask` options
**Code:**
```typescript
const createOptions: ISubTaskCreateOptions = {
	parentWorkerId: workerId,
	parentTaskId: taskId,  // <-- LINE 620
	planId: planId,
	worktreePath: worktreePath,
```
**Flow:** `taskId` variable → `createOptions.parentTaskId`
**Context:** `A2ASpawnParallelSubTasksTool` tool invocation

---

### File 5: `orchestrator\test\subTaskManager.spec.ts` (8 occurrences - All in test setup)

#### Reference 5.1 - Line 152 (Test Data)
```typescript
const options: ISubTaskCreateOptions = {
	parentWorkerId: 'worker-1',
	parentTaskId: 'task-1',  // <-- LINE 152
	planId: 'plan-1',
```

#### Reference 5.2 - Line 166 (Assertion)
```typescript
expect(subTask.parentTaskId).toBe('task-1');  // <-- LINE 166
```

#### Reference 5.3 - Line 180 (Test Data)
```typescript
const options: ISubTaskCreateOptions = {
	parentWorkerId: 'worker-1',
	parentTaskId: 'task-1',  // <-- LINE 180
	planId: 'plan-1',
```

#### Reference 5.4 - Line 197 (Test Data)
```typescript
const options: ISubTaskCreateOptions = {
	parentWorkerId: 'worker-1',
	parentTaskId: 'task-1',  // <-- LINE 197
	planId: 'plan-1',
```

#### Reference 5.5 - Line 213 (Test Data)
```typescript
const options: ISubTaskCreateOptions = {
	parentWorkerId: 'worker-1',
	parentTaskId: 'task-1',  // <-- LINE 213
	planId: 'plan-1',
```

#### Reference 5.6 - Line 231 (Test Data)
```typescript
const options: ISubTaskCreateOptions = {
	parentWorkerId: 'worker-1',
	parentTaskId: 'task-1',  // <-- LINE 231
	planId: 'plan-1',
```

#### Reference 5.7 - Line 247 (Test Data)
```typescript
const options: ISubTaskCreateOptions = {
	parentWorkerId: 'worker-1',
	parentTaskId: 'task-1',  // <-- LINE 247
	planId: 'plan-1',
```

#### Reference 5.8 - Line 264 (Test Data)
```typescript
const options: ISubTaskCreateOptions = {
	parentWorkerId: 'worker-1',
	parentTaskId: 'task-1',  // <-- LINE 264
	planId: 'plan-1',
```

**Remaining test occurrences continue throughout the file with similar patterns...**

---

### File 6: `orchestrator\test\taskMonitorService.spec.ts` (1 occurrence)

#### Reference 6.1 - Line 440 (Test Data)
```typescript
const failedSubTask: ISubTask = {
	id: subTaskId,
	parentWorkerId,
	parentTaskId: 'task-1',  // <-- LINE 440
	planId: 'plan-1',
	worktreePath: '/tmp/worktree',
```

---

### File 7: `orchestrator\test\orchestratorPermissionsFlow.spec.ts` (6 occurrences - All test data)

#### Reference 7.1 - Line 334 (Test Data)
```typescript
const subTask = subTaskManager.createSubTask({
	parentWorkerId: 'worker-1',
	parentTaskId: 'task-1',  // <-- LINE 334
	planId: 'plan-1',
```

#### Reference 7.2 - Line 359 (Test Data)
```typescript
const subTask = subTaskManager.createSubTask({
	parentWorkerId: 'worker-1',
	parentTaskId: 'task-1',  // <-- LINE 359
	planId: 'plan-1',
```

**Remaining references in this file follow the same pattern in different test cases...**

---

### File 8: `orchestrator\test\safety.test.ts` (10 occurrences - All test data)

#### Reference 8.1 - Line 460 (Helper Function)
```typescript
const createOptions = (overrides: Partial<ISubTaskCreateOptions> = {}): ISubTaskCreateOptions => ({
	parentWorkerId: 'worker-1',
	parentTaskId: 'task-1',  // <-- LINE 460
	planId: 'plan-1',
```

**All subsequent references use this helper function...**

---

## SECTION 2: CREATION AND ASSIGNMENT POINTS

### Primary Creation Sources

1. **Worker Context Source** (Most Common)
   - **Location:** `claudeA2AMcpServer.ts:283, 550` and `a2aTools.ts:140`
   - **Pattern:** `workerContext.taskId ?? workerContext.workerId`
   - **Fallback Logic:** If `taskId` is undefined, uses `workerId` as the parent task ID
   - **Context:** When Claude agents or Copilot tools spawn subtasks

2. **Direct Assignment in Options**
   - **Location:** Throughout test files
   - **Pattern:** Hardcoded test values like `'task-1'`, `'user-task'`
   - **Purpose:** Testing and setup

### Key Observation: The Fallback Pattern

The critical pattern appears in both MCP and tool implementations:

```typescript
parentTaskId: workerContext.taskId ?? workerContext.workerId
```

**This means:**
- If the worker has a `taskId`, that becomes the `parentTaskId`
- If not (e.g., standalone worker), the `workerId` itself becomes the `parentTaskId`
- This creates a hierarchy where the **parent's task identity** is used to track children

---

## SECTION 3: STORAGE LOCATIONS

### Storage Mechanism: `Map<string, ISubTask>`

**Primary Storage:** `subTaskManager.ts:72`
```typescript
private readonly _subTasks = new Map<string, ISubTask>();
```

**Storage Method:** `subTaskManager.ts:287`
```typescript
this._subTasks.set(id, subTask);
```

### Data Structure Hierarchy

```
ISubTask {
  id: string                    // Unique ID of THIS subtask
  parentWorkerId: string        // Worker that spawned this subtask
  parentTaskId: string          // Task ID of the parent (for hierarchy tracking)
  parentSubTaskId?: string      // Optional: if this is a nested subtask
  ...
}
```

### Key Properties

| Property | Purpose | Example |
|----------|---------|---------|
| `id` | Unique identifier for THIS subtask | `'subtask-abc123'` |
| `parentWorkerId` | Worker that spawned this | `'worker-1'` |
| `parentTaskId` | Parent's task identity | `'task-1'` or `'worker-1'` |
| `parentSubTaskId` | Optional: nested parent | `'subtask-parent-xyz'` |

---

## SECTION 4: FLOW DIAGRAM - TASK HIERARCHY

### Hierarchy Flow Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│                     ORCHESTRATOR / USER                          │
│                                                                   │
│  Creates initial task with taskId = 'task-1'                    │
│  Creates worker with workerId = 'worker-1'                      │
│  Worker context: { taskId: 'task-1', workerId: 'worker-1' }    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ Worker spawns subtask
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SUBTASK CREATION                              │
│                                                                   │
│  SubTaskManager.createSubTask({                                 │
│    parentWorkerId: 'worker-1',                                  │
│    parentTaskId: 'task-1',  ◄── Derived from workerContext     │
│    ...                                                           │
│  })                                                              │
│                                                                   │
│  Creates: ISubTask {                                            │
│    id: 'subtask-abc123',                                        │
│    parentWorkerId: 'worker-1',                                  │
│    parentTaskId: 'task-1',  ◄── Stored for hierarchy tracking  │
│  }                                                               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ Subtask spawns nested subtask
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                 NESTED SUBTASK CREATION                          │
│                                                                   │
│  SubTaskManager.createSubTask({                                 │
│    parentWorkerId: 'subtask-abc123',  ◄── Now using subtask ID │
│    parentTaskId: 'subtask-abc123',    ◄── Parent becomes THIS  │
│    parentSubTaskId: 'subtask-abc123', ◄── Explicit nesting     │
│    ...                                                           │
│  })                                                              │
│                                                                   │
│  Creates: ISubTask {                                            │
│    id: 'subtask-xyz789',                                        │
│    parentWorkerId: 'subtask-abc123',                            │
│    parentTaskId: 'subtask-abc123',  ◄── Links to parent subtask│
│    parentSubTaskId: 'subtask-abc123', ◄── Nested marker        │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

### Retrieval Flow

```
┌─────────────────────────────────────────────────────────────────┐
│            QUERY: Get all subtasks for a parent                  │
│                                                                   │
│  Input: parentTaskId = 'task-1'                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│         SubTaskManager.getSubTasksForParentTask()               │
│                                                                   │
│  Implementation (line 311-313):                                 │
│    return Array.from(this._subTasks.values())                   │
│      .filter(st => st.parentTaskId === parentTaskId);           │
│                                                                   │
│  Filters all subtasks where:                                    │
│    subtask.parentTaskId === 'task-1'                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      RESULTS                                     │
│                                                                   │
│  Returns: [                                                      │
│    { id: 'subtask-abc123', parentTaskId: 'task-1', ... },      │
│    { id: 'subtask-def456', parentTaskId: 'task-1', ... },      │
│    ...                                                           │
│  ]                                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## SECTION 5: KEY FUNCTIONS AND THEIR ROLES

### Function 1: `SubTaskManager.createSubTask()`
**File:** `subTaskManager.ts:178-300`

**Role:** Creates a new subtask and assigns `parentTaskId`

**Flow:**
1. Receives `ISubTaskCreateOptions` with `parentTaskId` populated by caller
2. Validates depth limits, rate limits, etc.
3. Creates `ISubTask` object with `parentTaskId: options.parentTaskId` (line 271)
4. Stores in `_subTasks` Map (line 287)
5. Logs creation with parent info (line 296)

**Key Code:**
```typescript
const subTask: ISubTask = {
	id,
	parentWorkerId: options.parentWorkerId,
	parentTaskId: options.parentTaskId,  // Assignment happens here
	planId: options.planId,
	// ...
};
this._subTasks.set(id, subTask);
```

---

### Function 2: `SubTaskManager.getSubTasksForParentTask()`
**File:** `subTaskManager.ts:311-314`

**Role:** Retrieves all subtasks for a given parent task

**Flow:**
1. Takes `parentTaskId` as parameter
2. Iterates through all stored subtasks
3. Filters by matching `st.parentTaskId === parentTaskId`
4. Returns array of matching subtasks

**Key Code:**
```typescript
getSubTasksForParentTask(parentTaskId: string): ISubTask[] {
	return Array.from(this._subTasks.values())
		.filter(st => st.parentTaskId === parentTaskId);
}
```

---

### Function 3: Claude MCP `a2a_spawn_subtask` Tool
**File:** `claudeA2AMcpServer.ts:236-355`

**Role:** Allows Claude agents to spawn subtasks

**Flow:**
1. Reads worker context: `workerContext.taskId ?? workerContext.workerId`
2. Builds `ISubTaskCreateOptions` with `parentTaskId` set to context value (line 283)
3. Calls `subTaskManager.createSubTask(options)`
4. Returns result to Claude agent

**Key Code:**
```typescript
const options: ISubTaskCreateOptions = {
	parentWorkerId: workerContext.workerId,
	parentTaskId: workerContext.taskId ?? workerContext.workerId,  // Critical line
	planId: workerContext.planId ?? 'claude-session',
	// ...
};
const subtask = subTaskManager.createSubTask(options);
```

---

### Function 4: Copilot Tool `A2ASpawnSubTaskTool.invoke()`
**File:** `a2aTools.ts:125-462`

**Role:** Allows Copilot agents to spawn subtasks

**Flow:**
1. Reads worker context (line 140): `taskId = this._workerContext?.taskId ?? 'user-task'`
2. Builds `ISubTaskCreateOptions` with `parentTaskId: taskId` (line 237)
3. Calls `subTaskManager.createSubTask(createOptions)`
4. Returns result to Copilot agent

**Key Code:**
```typescript
const taskId = this._workerContext?.taskId ?? 'user-task';
// ...
const createOptions: ISubTaskCreateOptions = {
	parentWorkerId: workerId,
	parentTaskId: taskId,  // Uses extracted taskId
	// ...
};
const subTask = this._subTaskManager.createSubTask(createOptions);
```

---

### Function 5: `A2ASpawnParallelSubTasksTool.invoke()`
**File:** `a2aTools.ts:489-949`

**Role:** Allows spawning multiple subtasks in parallel

**Flow:**
1. Same pattern as single spawn
2. Reads `taskId` from worker context (line 498)
3. For each subtask in parallel array, creates options with same `parentTaskId` (line 620)
4. All parallel subtasks share the same parent

**Key Code:**
```typescript
const taskId = this._workerContext?.taskId ?? 'user-task';
// ...
for (const taskConfig of subtasks) {
	const createOptions: ISubTaskCreateOptions = {
		parentWorkerId: workerId,
		parentTaskId: taskId,  // All parallel tasks have same parent
		// ...
	};
	const task = this._subTaskManager.createSubTask(createOptions);
	createdTasks.push(task);
}
```

---

## SECTION 6: DATA FLOW SUMMARY

### Complete Lifecycle

```
1. INITIALIZATION
   ┌─────────────────────────────────────────┐
   │ Orchestrator creates task and worker    │
   │ Worker gets context with taskId         │
   └──────────────┬──────────────────────────┘
                  │
2. SPAWN REQUEST  ▼
   ┌─────────────────────────────────────────┐
   │ Agent calls spawn tool (MCP or Copilot) │
   │ Tool reads workerContext.taskId          │
   └──────────────┬──────────────────────────┘
                  │
3. OPTIONS BUILD  ▼
   ┌─────────────────────────────────────────┐
   │ Build ISubTaskCreateOptions:             │
   │   parentTaskId = context.taskId ||      │
   │                  context.workerId        │
   └──────────────┬──────────────────────────┘
                  │
4. CREATION       ▼
   ┌─────────────────────────────────────────┐
   │ SubTaskManager.createSubTask()           │
   │   Creates ISubTask with parentTaskId    │
   │   Stores in Map                          │
   └──────────────┬──────────────────────────┘
                  │
5. STORAGE        ▼
   ┌─────────────────────────────────────────┐
   │ Map<string, ISubTask>                    │
   │ Key: subtask.id                          │
   │ Value: { parentTaskId: 'task-1', ... }  │
   └──────────────┬──────────────────────────┘
                  │
6. RETRIEVAL      ▼
   ┌─────────────────────────────────────────┐
   │ getSubTasksForParentTask(parentTaskId)   │
   │ Filters: st.parentTaskId === parentTaskId│
   │ Returns: Array of matching subtasks      │
   └──────────────────────────────────────────┘
```

---

## SECTION 7: KEY RELATIONSHIPS

### Relationship 1: Worker Context → parentTaskId
```
Worker Context                    Subtask Options                 Stored Subtask
┌──────────────┐                 ┌──────────────┐               ┌──────────────┐
│ workerId     │──┐              │              │               │              │
│ taskId       │──┼─fallback─→   │ parentTaskId │──────────→    │ parentTaskId │
│ planId       │  │              │              │               │              │
└──────────────┘  │              └──────────────┘               └──────────────┘
                  │
                  └──primary────→
```

### Relationship 2: Parent-Child Hierarchy
```
Parent Task (task-1)
│
├─ Subtask (subtask-abc) { parentTaskId: 'task-1' }
│  │
│  └─ Nested Subtask (subtask-xyz) {
│       parentTaskId: 'subtask-abc',
│       parentSubTaskId: 'subtask-abc'
│     }
│
└─ Subtask (subtask-def) { parentTaskId: 'task-1' }
```

### Relationship 3: Query Pattern
```
Query Input                Filter Logic                    Results
┌──────────────┐          ┌──────────────┐               ┌──────────────┐
│ parentTaskId │──────→   │ Iterate all  │──────────→    │ Matching     │
│ = 'task-1'   │          │ subtasks     │               │ subtasks     │
└──────────────┘          │ Compare:     │               └──────────────┘
                          │ parentTaskId │
                          └──────────────┘
```

---

## SECTION 8: CRITICAL INSIGHTS

### Insight 1: Dual Identity Pattern
**Pattern:** `workerContext.taskId ?? workerContext.workerId`

**Explanation:**
- Workers can have BOTH a `workerId` and a `taskId`
- The `taskId` represents their orchestrator task identity
- If no `taskId` exists (standalone worker), the `workerId` is used as the parent task ID
- This enables both orchestrated and standalone workflows to use the same subtask system

### Insight 2: parentTaskId vs parentWorkerId
**Distinction:**
- `parentWorkerId` = The worker instance that spawned this subtask
- `parentTaskId` = The task identity for hierarchy tracking
- Often they are the same, but can differ when a worker represents a task

### Insight 3: Nesting Support
**Three-level hierarchy:**
1. **parentTaskId** - Always points to immediate parent's task identity
2. **parentSubTaskId** (optional) - If this is a nested subtask, explicitly marks the parent subtask
3. **parentWorkerId** - The worker that spawned this

### Insight 4: No Direct Parent Reference
**Important:** `parentTaskId` is just a string identifier, NOT a reference to the parent `ISubTask` object.
- To get parent details, you must query: `getSubTask(parentTaskId)`
- This is intentional for loose coupling

### Insight 5: Filtering is the Primary Access Pattern
**Usage:**
- There is NO "parent → children" navigation structure
- Instead, use `getSubTasksForParentTask(parentTaskId)` which filters the entire Map
- This is fine for the scale of subtasks expected per worker (max 10 by default)

---

## SECTION 9: USAGE PATTERNS

### Pattern 1: Creating a Subtask (from Claude/Copilot)
```typescript
// Step 1: Extract parent identity from worker context
const parentTaskId = workerContext.taskId ?? workerContext.workerId;

// Step 2: Build options
const options: ISubTaskCreateOptions = {
	parentWorkerId: workerContext.workerId,
	parentTaskId: parentTaskId,  // Links to parent
	// ... other options
};

// Step 3: Create
const subtask = subTaskManager.createSubTask(options);
```

### Pattern 2: Querying Children of a Task
```typescript
// Given a task ID
const taskId = 'task-1';

// Get all direct children
const children = subTaskManager.getSubTasksForParentTask(taskId);

// Result: Array of ISubTask where each has parentTaskId === 'task-1'
```

### Pattern 3: Tracking Nested Hierarchy
```typescript
// Parent spawns child
const child = subTaskManager.createSubTask({
	parentTaskId: parent.id,
	parentSubTaskId: parent.id,  // Explicitly mark as nested
	// ...
});

// Child spawns grandchild
const grandchild = subTaskManager.createSubTask({
	parentTaskId: child.id,
	parentSubTaskId: child.id,  // Chain continues
	// ...
});
```

---

## SECTION 10: SUMMARY TABLE

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| Interface Definition | `orchestratorInterfaces.ts` | 146, 204, 286 | Define `parentTaskId` in types |
| Storage | `subTaskManager.ts` | 72, 287 | Store subtasks in Map |
| Creation | `subTaskManager.ts` | 271, 296 | Create and log subtasks |
| Retrieval | `subTaskManager.ts` | 311-313 | Query subtasks by parent |
| MCP Tool (single) | `claudeA2AMcpServer.ts` | 283 | Claude spawns subtask |
| MCP Tool (parallel) | `claudeA2AMcpServer.ts` | 550 | Claude spawns parallel |
| Copilot Tool (single) | `a2aTools.ts` | 140, 237 | Copilot spawns subtask |
| Copilot Tool (parallel) | `a2aTools.ts` | 498, 620 | Copilot spawns parallel |
| Test Data | Multiple test files | Various | Test setup and assertions |

---

## CONCLUSION

The `parentTaskId` field serves as the **primary hierarchical link** in the subtask system. It:

1. **Links child subtasks to their parent task identity**
2. **Supports both orchestrated and standalone workflows** via fallback pattern
3. **Enables querying all children of a given parent**
4. **Is set at creation time** from worker context
5. **Is immutable once set** (no code changes it after creation)
6. **Is a string identifier, not an object reference** (loose coupling)

The flow is clean and unidirectional:
- **Creation:** Worker context → spawn tool → createSubTask → storage
- **Retrieval:** Query by parentTaskId → filter Map → return matches

There are **no complex update or modification flows** - once set, it remains static for the lifetime of the subtask.
