# COMPREHENSIVE ownerId FLOW ANALYSIS

**Generated**: 2025-12-22
**Total References**: 112 occurrences across 12 files
**Analysis Scope**: Q:\src\PowerQuery\vs\vscode-copilot-chat\src\extension

---

## SECTION 1: ALL 112 REFERENCES WITH FILE:LINE AND CODE SNIPPETS

### File 1: workerToolsService.ts (1 occurrence)

**Line 92** - Interface property definition
```typescript
export interface IWorkerOwnerContext {
	/** Type of owner */
	ownerType: 'orchestrator' | 'worker' | 'agent';
	/** Unique ID of the owner */
	ownerId: string;  // ← DEFINITION
	/** Session URI for agent sessions */
	sessionUri?: string;
}
```
- **Type**: Interface field definition
- **Role**: Declares the unique identifier for the owner
- **Data Structure**: Part of `IWorkerOwnerContext` interface
- **Flow IN**: N/A (definition)
- **Flow OUT**: Used throughout the system to identify message routing targets

---

### File 2: parentCompletionService.ts (8 occurrences)

**Line 65** - Interface property definition
```typescript
export interface IParentHandler {
	/** The owner ID (workerId or session ID) */
	ownerId: string;  // ← DEFINITION
	/** Callback to handle completion messages */
	onCompletion: (message: IParentCompletionMessage) => Promise<void>;
	/** Whether to inject as synthetic user message */
	injectAsUserMessage: boolean;
}
```
- **Type**: Interface field definition
- **Role**: Identifies which parent handler to invoke

**Line 89** - JSDoc parameter documentation
```typescript
/**
 * Register a persistent handler for a parent session.
 * The handler will receive completion messages for all subtasks spawned by this parent.
 *
 * @param ownerId The parent's unique ID (workerId or chat session ID)  // ← DOCUMENTATION
 */
```
- **Type**: Documentation
- **Role**: Describes the ownerId parameter

**Line 95** - Method parameter
```typescript
registerParentHandler(
	ownerId: string,  // ← PARAMETER
	onCompletion: (message: IParentCompletionMessage) => Promise<void>,
	options?: { injectAsUserMessage?: boolean }
): IDisposable;
```
- **Type**: Parameter declaration
- **Role**: Input for registering a handler
- **Flow IN**: Passed from caller (worker or session)
- **Flow OUT**: Used as key in handler map

**Line 103** - Method parameter
```typescript
hasParentHandler(ownerId: string): boolean;  // ← PARAMETER
```
- **Type**: Parameter declaration
- **Role**: Query handler existence
- **Flow IN**: From caller
- **Flow OUT**: Used to check handler map

**Line 108** - Method parameter
```typescript
getPendingCompletions(ownerId: string): IParentCompletionMessage[];  // ← PARAMETER
```
- **Type**: Parameter declaration
- **Role**: Retrieve pending completions for owner
- **Flow IN**: From caller
- **Flow OUT**: Used to filter pending completions

**Line 118** - Event payload property
```typescript
readonly onCompletionDelivered: Event<{ ownerId: string; message: IParentCompletionMessage }>;  // ← EVENT PAYLOAD
```
- **Type**: Event data field
- **Role**: Tracks who received the completion
- **Flow IN**: From handler invocation
- **Flow OUT**: To event subscribers

**Line 123** - Event payload property
```typescript
readonly onCompletionQueued: Event<{ ownerId: string; message: IParentCompletionMessage }>;  // ← EVENT PAYLOAD
```
- **Type**: Event data field
- **Role**: Tracks who has queued completions
- **Flow IN**: From pending queue
- **Flow OUT**: To event subscribers

**Line 182-207** - Method implementation
```typescript
registerParentHandler(
	ownerId: string,  // ← USAGE IN IMPLEMENTATION
	onCompletion: (message: IParentCompletionMessage) => Promise<void>,
	options?: { injectAsUserMessage?: boolean }
): IDisposable {
	this._logService.debug(`[ParentCompletionService] Registered handler for owner ${ownerId}`);

	const handler: IParentHandler = {
		ownerId,  // ← STORAGE IN OBJECT
		onCompletion,
		injectAsUserMessage: options?.injectAsUserMessage ?? true,
	};

	this._parentHandlers.set(ownerId, handler);  // ← MAP KEY

	// Deliver any pending completions
	const pending = this._pendingCompletions.get(ownerId);  // ← MAP LOOKUP
	if (pending && pending.length > 0) {
		this._logService.debug(`[ParentCompletionService] Delivering ${pending.length} pending completions to ${ownerId}`);
		this._pendingCompletions.delete(ownerId);  // ← MAP DELETION
		// ...
	}

	return toDisposable(() => {
		this._parentHandlers.delete(ownerId);  // ← MAP DELETION
		this._logService.debug(`[ParentCompletionService] Disposed handler for owner ${ownerId}`);
	});
}
```
- **Type**: Multiple operations - parameter, storage, map key
- **Function**: `registerParentHandler()`
- **Flow IN**: From method parameter
- **Flow OUT**: Stored in `_parentHandlers` map as key

---

### File 3: orchestratorQueue.ts (17 occurrences)

**Line 24** - Interface property definition
```typescript
export interface IOwnerContext {
	/** Type of owner */
	ownerType: 'orchestrator' | 'worker' | 'agent';
	/** Unique ID of the owner (worker ID, session ID, or 'orchestrator') */
	ownerId: string;  // ← DEFINITION
	/** Session URI for agent sessions */
	sessionUri?: string;
}
```
- **Type**: Interface field definition
- **Role**: Part of message routing metadata

**Line 110** - Method parameter
```typescript
registerOwnerHandler(ownerId: string, handler: (message: IOrchestratorQueueMessage) => Promise<void>): IDisposable;  // ← PARAMETER
```
- **Type**: Parameter declaration
- **Role**: Register handler for specific owner
- **Flow IN**: From caller (executor, agent, orchestrator)
- **Flow OUT**: Used as map key

**Line 113** - Method parameter
```typescript
getPendingMessagesForOwner(ownerId: string): IOrchestratorQueueMessage[];  // ← PARAMETER
```
- **Type**: Parameter declaration
- **Role**: Query pending messages
- **Flow IN**: From caller
- **Flow OUT**: Filter messages by owner.ownerId

**Line 125** - Method parameter
```typescript
hasOwnerHandler(ownerId: string): boolean;  // ← PARAMETER
```
- **Type**: Parameter declaration
- **Role**: Check handler existence

**Lines 226-238** - Method implementation
```typescript
registerOwnerHandler(ownerId: string, handler: (message: IOrchestratorQueueMessage) => Promise<void>): IDisposable {
	this._qLog('Registered owner handler', { ownerId });  // ← LOGGING
	this._ownerHandlers.set(ownerId, handler);  // ← MAP STORAGE
	// Check for any pending messages for this owner
	const pending = this.getPendingMessagesForOwner(ownerId);  // ← METHOD CALL
	if (pending.length > 0) {
		this._qLog('Found pending messages for owner', { ownerId, pendingCount: pending.length });
		setTimeout(() => this.processNext(), 0);
	}
	return toDisposable(() => {
		this._ownerHandlers.delete(ownerId);  // ← MAP DELETION
		this._qLog('Disposed owner handler', { ownerId });
	});
}
```
- **Type**: Map operations
- **Function**: `registerOwnerHandler()`
- **Flow IN**: Parameter
- **Flow OUT**: Stored in `_ownerHandlers` map

**Lines 241-243** - Method implementation
```typescript
hasOwnerHandler(ownerId: string): boolean {
	return this._ownerHandlers.has(ownerId);  // ← MAP LOOKUP
}
```
- **Type**: Map lookup
- **Function**: `hasOwnerHandler()`

**Lines 245-247** - Method implementation
```typescript
getPendingMessagesForOwner(ownerId: string): IOrchestratorQueueMessage[] {
	return this._queue.getAll().filter(m => m.owner?.ownerId === ownerId);  // ← FILTER BY PROPERTY
}
```
- **Type**: Filter operation
- **Function**: `getPendingMessagesForOwner()`
- **Flow IN**: Parameter
- **Flow OUT**: Filters queue messages by `message.owner.ownerId`

**Lines 262-274** - Message routing logic
```typescript
private _getHandlerForMessage(message: IOrchestratorQueueMessage): ((message: IOrchestratorQueueMessage) => Promise<void>) | undefined {
	// If message has an owner, try to route to owner handler first
	if (message.owner?.ownerId) {  // ← CONDITIONAL CHECK
		const ownerHandler = this._ownerHandlers.get(message.owner.ownerId);  // ← MAP LOOKUP
		if (ownerHandler) {
			this._qLog('Routing message to owner handler', { messageId: message.id, ownerId: message.owner.ownerId, type: message.type });  // ← LOGGING
			return ownerHandler;
		}
		this._qLog('No handler found for owner, will use default', { messageId: message.id, ownerId: message.owner.ownerId, type: message.type });
	}
	// Fall back to default handler (orchestrator)
	return this._handler;
}
```
- **Type**: Routing logic with map lookup
- **Function**: `_getHandlerForMessage()`
- **Flow IN**: From message.owner.ownerId
- **Flow OUT**: Routes to appropriate handler

**Lines 289-302** - Message enqueue logging
```typescript
this._qLog('Enqueuing message', {
	messageId: message.id,
	type: message.type,
	ownerId: message.owner?.ownerId ?? 'none',  // ← LOGGING
	ownerType: message.owner?.ownerType ?? 'none',
	priority: message.priority,
	workerId: message.workerId,
	taskId: message.taskId,
});
```
- **Type**: Logging
- **Function**: `enqueueMessage()`

**Lines 346-363** - Message processing logging
```typescript
this._qLog('No handler for message, leaving in queue', {
	messageId: message.id,
	ownerId: message.owner?.ownerId ?? 'none',  // ← LOGGING
	type: message.type,
});

// ...

this._qLog('Processing message', {
	messageId: message.id,
	type: message.type,
	waitedMs: this._metrics.waitTime,
	ownerId: message.owner?.ownerId ?? 'none',  // ← LOGGING
	workerId: message.workerId,
	taskId: message.taskId,
});
```
- **Type**: Logging
- **Function**: `processNext()`

---

### File 4: taskMonitorService.ts (3 occurrences)

**Lines 385-390** - Worker cleanup loop
```typescript
// Remove all monitored tasks for this parent
const removedTasks: string[] = [];
for (const [subTaskId, ownerId] of this._monitoredTasks) {  // ← MAP ITERATION
	if (ownerId === parentWorkerId) {  // ← COMPARISON
		this._monitoredTasks.delete(subTaskId);
		removedTasks.push(subTaskId);
	}
}
```
- **Type**: Map iteration and comparison
- **Function**: `_unregisterParent()`
- **Data Structure**: Map<subTaskId, ownerId>
- **Flow IN**: From `_monitoredTasks` map values
- **Flow OUT**: Used for comparison to remove tasks

---

### File 5: claudeCodeAgent.ts (8 occurrences)

**Lines 434-477** - Worker context setup and handler registration
```typescript
if (context.owner?.ownerId) {  // ← CONDITIONAL CHECK
	this.logService.info(
		`[ClaudeCodeSession] Registering owner handler | workerId=${context.workerId}, ownerId=${context.owner.ownerId}, ownerType=${context.owner.ownerType}`  // ← LOGGING
	);

	const disposable = this.queueService.registerOwnerHandler(
		context.owner.ownerId,  // ← PARAMETER PASSING
		async (message) => {
			this.logService.info(
				`[ClaudeCodeSession] Received queued message | type=${message.type}, workerId=${message.workerId}, taskId=${message.taskId}, messageId=${message.id}`
			);
			// ... handler logic
		}
	);

	// Register disposable so handler is cleaned up when session is disposed
	this._register(disposable);

	this.logService.info(
		`[ClaudeCodeSession] Owner handler registered successfully | ownerId=${context.owner.ownerId}`  // ← LOGGING
	);
} else {
	this.logService.info(
		`[ClaudeCodeSession] No owner context provided - worker will not receive routed messages | workerId=${context.workerId}`
	);
}
```
- **Type**: Conditional check, logging, parameter passing
- **Function**: `setWorkerContext()`
- **Flow IN**: From `context.owner.ownerId`
- **Flow OUT**: Passed to `registerOwnerHandler()`

---

### File 6: claudeCodeAgentExecutor.ts (0 occurrences)

No direct references to `ownerId` in this file. The file uses `workerContext` extensively but doesn't directly access the `ownerId` property.

---

### File 7: copilotAgentExecutor.ts (8 occurrences)

**Lines 81-125** - Owner handler registration
```typescript
// Register as owner handler to receive child updates if we have worker context
if (workerContext?.owner?.ownerId) {  // ← CONDITIONAL CHECK
	this._logService.info(
		`[CopilotAgentExecutor] Registering owner handler | workerId=${workerContext.workerId}, ownerId=${workerContext.owner.ownerId}, ownerType=${workerContext.owner.ownerType}`  // ← LOGGING
	);

	const ownerHandlerDisposable = this._queueService.registerOwnerHandler(
		workerContext.owner.ownerId,  // ← PARAMETER PASSING
		async (message) => {
			this._logService.info(
				`[CopilotAgentExecutor] Received queued message | type=${message.type}, workerId=${message.workerId}, taskId=${message.taskId}, messageId=${message.id}`
			);
			// ... handler logic
		}
	) as Disposable;

	workerState.ownerHandlerDisposable = ownerHandlerDisposable;

	this._logService.info(
		`[CopilotAgentExecutor] Owner handler registered successfully | ownerId=${workerContext.owner.ownerId}`  // ← LOGGING
	);
} else if (workerContext) {
	this._logService.info(
		`[CopilotAgentExecutor] No owner context provided - worker will not receive routed messages | workerId=${workerContext.workerId}`
	);
}
```
- **Type**: Conditional check, logging, parameter passing
- **Function**: `execute()`
- **Flow IN**: From `workerContext.owner.ownerId`
- **Flow OUT**: Passed to `registerOwnerHandler()`

---

### File 8: a2aTools.ts (5 occurrences)

**Lines 250-310** - Owner routing in notification tool
```typescript
// Determine target: if we have an owner context, route to owner; otherwise route to orchestrator
const targetDescription = this._workerContext.owner
	? `${this._workerContext.owner.ownerType} (${this._workerContext.owner.ownerId})`  // ← STRING INTERPOLATION
	: 'orchestrator';

this._logService.info(`[A2ANotifyOrchestratorTool] Sending ${type} notification to ${targetDescription}`);

try {
	this._queueService.enqueueMessage({
		id: generateUuid(),
		timestamp: Date.now(),
		priority,
		planId: this._workerContext.planId ?? 'standalone',
		taskId: this._workerContext.taskId ?? this._workerContext.workerId,
		workerId: this._workerContext.workerId,
		worktreePath: this._workerContext.worktreePath,
		depth: this._workerContext.depth,
		// Include owner context for routing - messages go to owner, not directly to orchestrator
		owner: this._workerContext.owner,  // ← OBJECT PASSING (includes ownerId)
		type,
		content: metadata ? { message: content, ...metadata } : content
	});

	return new LanguageModelToolResult([
		new LanguageModelTextPart(`Notification sent to ${targetDescription}.`),  // ← LOGGING
	]);
}
```
- **Type**: Property access for logging and message routing
- **Function**: `invoke()` in `A2ANotifyOrchestratorTool`
- **Flow IN**: From `_workerContext.owner`
- **Flow OUT**: Included in enqueued message

**Lines 356-364** - Owner handler registration in spawn tool
```typescript
// Register this worker as owner handler to receive messages from subtask
if (parentWorkerId) {
	this._logService.debug(`[A2ASpawnSubTaskTool] Registering owner handler for parentWorkerId '${parentWorkerId}'`);
	handlerDisposable = this._queueService.registerOwnerHandler(parentWorkerId, async (message) => {  // ← USING PARENT WORKER ID AS OWNER ID
		this._logService.info(`[A2ASpawnSubTaskTool] RECEIVED MESSAGE from subtask: type=${message.type}, taskId=${message.taskId}`);
		collectedMessages.push(message);
		const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
		progressHandle.update(`[${message.type}] ${content.slice(0, 50)}...`);
	});
}
```
- **Type**: Parameter passing to register handler
- **Function**: `invoke()` in `A2ASpawnSubTaskTool`
- **Note**: Uses `parentWorkerId` directly as the ownerId for handler registration

---

### File 9: a2aReportCompletionTool.ts (4 occurrences)

**Lines 93-94** - Logging context
```typescript
this._log('Tool invoked', {
	subTaskId,
	status,
	hasOutput: !!output,
	hasOutputFile: !!outputFile,
	hasMetadata: !!metadata,
	hasError: !!error,
	workerId: this._workerContext.workerId,
	planId: this._workerContext.planId,
	ownerId: this._workerContext.owner?.ownerId ?? null,  // ← LOGGING
	ownerType: this._workerContext.owner?.ownerType ?? null,
});
```
- **Type**: Logging
- **Function**: `invoke()`

**Lines 170-183** - Message routing setup
```typescript
const targetDescription = this._workerContext.owner
	? `${this._workerContext.owner.ownerType} (${this._workerContext.owner.ownerId})`  // ← STRING INTERPOLATION
	: 'orchestrator';

const messageId = generateUuid();
this._log('Enqueuing completion message', {
	subTaskId,
	messageId,
	targetDescription,
	targetOwnerId: this._workerContext.owner?.ownerId ?? 'orchestrator',  // ← LOGGING
	targetOwnerType: this._workerContext.owner?.ownerType ?? 'orchestrator',
	workerId: this._workerContext.workerId,
	planId: this._workerContext.planId ?? 'standalone',
});
```
- **Type**: Property access for logging and routing
- **Function**: `_standardComplete()`

**Lines 205-209** - Parent notification check
```typescript
const ownerContext = this._workerContext.owner;
const isChildWorker = ownerContext && ownerContext.ownerType === 'worker';
const parentWorkerId = isChildWorker ? ownerContext.ownerId : undefined;  // ← CONDITIONAL EXTRACTION

if (parentWorkerId) {
	this._log('NOTIFYING PARENT via TaskMonitorService', {
		subTaskId,
		parentWorkerId,  // ← LOGGING
		status: status === 'success' ? 'completed' : 'failed',
	});
	// ...
}
```
- **Type**: Conditional extraction and usage
- **Function**: `_standardComplete()`
- **Flow IN**: From `_workerContext.owner.ownerId`
- **Flow OUT**: Used as parentWorkerId for task monitoring

---

### File 10: hierarchicalPermissionRouter.ts (3 occurrences)

**Lines 250-273** - Permission routing logic
```typescript
// Route to parent
this._logService.debug(`[HierarchicalPermissionRouter] Routing permission to parent ${owner.ownerId} for worker ${workerContext.workerId}`);  // ← LOGGING

// First, try auto-approval based on policy
const autoDecision = this.handleAsParent(request, DEFAULT_PARENT_POLICY);
if (autoDecision.decision !== 'escalate') {
	this._onPermissionDecided.fire({ request, decision: autoDecision });
	if (autoDecision.remember === 'session') {
		this._sessionApprovals.set(sessionKey, autoDecision.decision);
	}
	return autoDecision;
}

// Send to parent via queue for manual decision
this._onPermissionRouted.fire({ request, routedTo: owner.ownerType === 'orchestrator' ? 'orchestrator' : 'parent' });

const parentDecision = await this._routeToParent(request, owner, fallbackToUser, token);  // ← PASSED IN OWNER OBJECT
```
- **Type**: Logging and object passing
- **Function**: `routePermission()`

**Lines 388-410** - Pending request tracking
```typescript
// Track pending request
this._pendingRequests.set(request.id, {
	request,
	parentId: owner.ownerId,  // ← STORAGE
	resolve: (decision) => {
		clearTimeout(timeoutHandle);
		this._pendingRequests.delete(request.id);

		// If parent escalated, go to user
		if (decision.decision === 'escalate') {
			fallbackToUser().then(approved => {
				resolve({
					requestId: request.id,
					decision: approved ? 'approve' : 'deny',
					decidedBy: 'user',
					reason: 'Parent escalated to user',
				});
			});
		} else {
			resolve(decision);
		}
	},
	timeoutHandle,
});
```
- **Type**: Object property storage
- **Function**: `_routeToParent()`
- **Flow IN**: From `owner.ownerId`
- **Flow OUT**: Stored in pending requests map

---

### File 11: subtaskProgressService.ts (0 occurrences)

No direct references to `ownerId` in this file. The file uses owner-related concepts through worker IDs and subtask IDs but doesn't directly access `ownerId`.

---

### File 12: orchestratorServiceV2.ts (0 occurrences - partial read)

The file was only partially read (first 500 lines), but within the visible code, there are no direct references to `ownerId`. The orchestrator primarily works with worker IDs and task IDs.

---

## SECTION 2: CREATION AND ASSIGNMENT POINTS

### Primary Creation Points

1. **WorkerToolsService** - Line 92
   - **Location**: `workerToolsService.ts:92`
   - **Type**: Interface definition
   - **Purpose**: Defines the structure for owner context
   - **Created By**: Instantiator when creating worker context

2. **Orchestrator Service** - During worker deployment
   - **Location**: Throughout orchestrator when deploying workers
   - **Type**: Object creation
   - **Purpose**: Sets owner context for spawned workers
   - **Values**:
     - `ownerType`: 'orchestrator' | 'worker' | 'agent'
     - `ownerId`: workerId or sessionId
     - `sessionUri`: Optional session identifier

3. **A2A Tools** - During subtask spawning
   - **Location**: `a2aTools.ts` (spawn tools)
   - **Type**: Propagation from parent context
   - **Purpose**: Child workers inherit owner context from parent
   - **Pattern**: Parent's workerId becomes child's ownerId

### Assignment Pattern

```typescript
// Pattern 1: Top-level agent (no owner)
const workerContext: IWorkerContext = {
	workerId: 'agent-session-123',
	worktreePath: '/path/to/workspace',
	depth: 0,
	owner: undefined,  // No owner - routes to user
	spawnContext: 'agent'
};

// Pattern 2: Orchestrator-spawned worker
const workerContext: IWorkerContext = {
	workerId: 'worker-456',
	worktreePath: '/path/to/worktree',
	depth: 1,
	owner: {
		ownerType: 'orchestrator',
		ownerId: 'orchestrator',  // Routes to orchestrator
		sessionUri: 'orchestrator:/task-789'
	},
	spawnContext: 'orchestrator'
};

// Pattern 3: Worker-spawned subtask
const workerContext: IWorkerContext = {
	workerId: 'subtask-worker-abc',
	worktreePath: '/path/to/subtask-worktree',
	depth: 2,
	owner: {
		ownerType: 'worker',
		ownerId: 'parent-worker-456',  // Routes to parent worker
		sessionUri: undefined
	},
	spawnContext: 'orchestrator'
};
```

---

## SECTION 3: STORAGE LOCATIONS

### Map Storage

1. **OrchestratorQueueService**
   - **Map**: `_ownerHandlers: Map<string, handler>`
   - **Key**: `ownerId`
   - **Value**: Message handler function
   - **Purpose**: Route messages to the correct handler
   - **Lifecycle**: Registered when worker/session starts, disposed when ends

2. **ParentCompletionService**
   - **Map**: `_parentHandlers: Map<string, IParentHandler>`
   - **Key**: `ownerId`
   - **Value**: Handler object (includes ownerId, callback, options)
   - **Purpose**: Route completion messages to parents
   - **Lifecycle**: Registered during worker setup, disposed at completion

3. **TaskMonitorService**
   - **Map**: `_monitoredTasks: Map<string, string>`
   - **Key**: `subTaskId`
   - **Value**: `ownerId` (parentWorkerId)
   - **Purpose**: Track which parent owns each subtask
   - **Lifecycle**: Set during monitoring start, removed at completion

### Object Properties

1. **IOrchestratorQueueMessage.owner**
   - **Property**: `owner.ownerId`
   - **Type**: `string`
   - **Purpose**: Routing metadata for message delivery
   - **Lifetime**: Duration of message in queue

2. **IWorkerContext.owner**
   - **Property**: `owner.ownerId`
   - **Type**: `string`
   - **Purpose**: Identifies who spawned this worker
   - **Lifetime**: Entire worker lifetime

3. **IHierarchicalPermissionRequest**
   - **Tracked In**: `_pendingRequests` map
   - **Property**: `parentId` (derived from owner.ownerId)
   - **Purpose**: Track pending permission requests
   - **Lifetime**: Until permission decided or timeout

---

## SECTION 4: FLOW DIAGRAM - OWNERSHIP HIERARCHY

```
┌─────────────────────────────────────────────────────────────┐
│                         USER                                │
│                     (no ownerId)                            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Starts session
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  STANDALONE AGENT                           │
│  workerId: "claude-standalone-xxx"                          │
│  owner: undefined                                           │
│  depth: 0                                                   │
│  Routes to: USER (via fallbackToUser)                      │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Spawns subtask
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    SUBTASK WORKER                           │
│  workerId: "subtask-worker-abc"                             │
│  owner: {                                                   │
│    ownerType: 'worker',                                     │
│    ownerId: 'claude-standalone-xxx'  ← ROUTES BACK TO AGENT│
│  }                                                          │
│  depth: 1                                                   │
│  Routes to: STANDALONE AGENT                                │
└─────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR                             │
│  ownerId: "orchestrator"                                    │
│  Manages: Plans, Tasks, Workers                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Deploys task
                         ▼
┌─────────────────────────────────────────────────────────────┐
│               ORCHESTRATOR WORKER                           │
│  workerId: "worker-task-123"                                │
│  owner: {                                                   │
│    ownerType: 'orchestrator',                               │
│    ownerId: 'orchestrator',  ← ROUTES TO ORCHESTRATOR      │
│    sessionUri: 'orchestrator:/task-123'                     │
│  }                                                          │
│  depth: 1                                                   │
│  Routes to: ORCHESTRATOR                                    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Spawns subtask
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                WORKER-SPAWNED SUBTASK                       │
│  workerId: "subtask-worker-456"                             │
│  owner: {                                                   │
│    ownerType: 'worker',                                     │
│    ownerId: 'worker-task-123'  ← ROUTES TO PARENT WORKER   │
│  }                                                          │
│  depth: 2                                                   │
│  Routes to: ORCHESTRATOR WORKER                             │
└─────────────────────────────────────────────────────────────┘
```

### Message Flow Examples

**Example 1: Subtask Completion from Worker-Spawned Task**
```
1. Subtask completes work
2. Calls a2a_reportCompletion tool
3. Tool extracts: owner.ownerId = 'worker-task-123'
4. Enqueues message with owner context
5. OrchestratorQueueService receives message
6. Checks message.owner.ownerId = 'worker-task-123'
7. Looks up handler: _ownerHandlers.get('worker-task-123')
8. Invokes handler → delivers to parent worker
```

**Example 2: Permission Request from Deep Subtask**
```
1. Subtask needs file write permission
2. HierarchicalPermissionRouter.routePermission()
3. Checks workerContext.owner.ownerId = 'worker-task-123'
4. Creates permission request
5. Sets parentId = owner.ownerId
6. Enqueues to parent via queue
7. Parent's owner handler receives request
8. Parent evaluates → auto-approve or escalate
```

**Example 3: Standalone Agent Spawning**
```
1. User starts @agent session
2. Agent has owner: undefined
3. Agent spawns subtask via a2a_spawn_subtask
4. Subtask gets owner: { ownerType: 'worker', ownerId: agent.sessionId }
5. Subtask sends messages → routed to agent's session
6. Agent receives via registered owner handler
```

---

## SECTION 5: KEY FUNCTIONS AND METHODS

### 1. Message Routing Functions

#### `OrchestratorQueueService.registerOwnerHandler()`
- **File**: `orchestratorQueue.ts:226`
- **Purpose**: Register a handler for messages routed to specific owner
- **ownerId Role**: Map key for handler storage
- **Flow**:
  1. Receives `ownerId` parameter
  2. Stores handler: `_ownerHandlers.set(ownerId, handler)`
  3. Checks for pending messages: `getPendingMessagesForOwner(ownerId)`
  4. Returns disposable that deletes handler

#### `OrchestratorQueueService._getHandlerForMessage()`
- **File**: `orchestratorQueue.ts:262`
- **Purpose**: Route message to appropriate handler based on owner
- **ownerId Role**: Lookup key for handler selection
- **Flow**:
  1. Checks `message.owner?.ownerId`
  2. If present: `_ownerHandlers.get(message.owner.ownerId)`
  3. If found: return owner handler
  4. Else: return default (orchestrator) handler

#### `OrchestratorQueueService.getPendingMessagesForOwner()`
- **File**: `orchestratorQueue.ts:245`
- **Purpose**: Get all queued messages for specific owner
- **ownerId Role**: Filter criterion
- **Flow**: `this._queue.getAll().filter(m => m.owner?.ownerId === ownerId)`

### 2. Completion Routing Functions

#### `ParentCompletionService.registerParentHandler()`
- **File**: `parentCompletionService.ts:177`
- **Purpose**: Register handler for subtask completion notifications
- **ownerId Role**: Identifies which parent to notify
- **Flow**:
  1. Creates `IParentHandler` with ownerId
  2. Stores: `_parentHandlers.set(ownerId, handler)`
  3. Delivers pending completions if any
  4. Returns cleanup disposable

#### `ParentCompletionService.deliverCompletion()`
- **File**: `parentCompletionService.ts:286`
- **Purpose**: Route completion message to parent
- **ownerId Role**: Determines target handler
- **Flow**:
  1. Gets `ownerId = subTask.parentWorkerId`
  2. Looks up: `_parentHandlers.get(ownerId)`
  3. If found: invoke handler
  4. Else: queue for later delivery

### 3. Worker Context Setup Functions

#### `ClaudeCodeSession.setWorkerContext()`
- **File**: `claudeCodeAgent.ts:429`
- **Purpose**: Configure session to receive owner-routed messages
- **ownerId Role**: Register as message recipient
- **Flow**:
  1. Receives worker context
  2. Extracts: `context.owner?.ownerId`
  3. If present: `queueService.registerOwnerHandler(context.owner.ownerId, handler)`
  4. Handler receives messages from child workers

#### `CopilotAgentExecutor.execute()`
- **File**: `copilotAgentExecutor.ts:49`
- **Purpose**: Execute task and register for child messages
- **ownerId Role**: Register to receive child updates
- **Flow**:
  1. Gets: `workerContext?.owner?.ownerId`
  2. If present: `registerOwnerHandler(workerContext.owner.ownerId, handler)`
  3. Handler stores child messages in state
  4. Messages injected into next execution

### 4. Spawning Functions

#### `A2ASpawnSubTaskTool.invoke()`
- **File**: `a2aTools.ts:125`
- **Purpose**: Spawn subtask and set up message routing
- **ownerId Role**: Create owner context for child, register as parent
- **Flow**:
  1. Gets parent: `workerId = this._workerContext?.workerId`
  2. Creates subtask with owner: `{ ownerType: 'worker', ownerId: workerId }`
  3. If blocking: registers handler: `registerOwnerHandler(parentWorkerId, handler)`
  4. Handler collects messages until completion

#### `A2ANotifyOrchestratorTool.invoke()`
- **File**: `a2aTools.ts:1292`
- **Purpose**: Send message to owner (parent or orchestrator)
- **ownerId Role**: Route message to correct recipient
- **Flow**:
  1. Gets: `owner = this._workerContext.owner`
  2. Enqueues message with: `owner: this._workerContext.owner` (includes ownerId)
  3. Queue routes to handler registered for that ownerId

### 5. Permission Routing Functions

#### `HierarchicalPermissionRouter.routePermission()`
- **File**: `hierarchicalPermissionRouter.ts:208`
- **Purpose**: Route permission request through hierarchy
- **ownerId Role**: Identify parent to ask for permission
- **Flow**:
  1. Gets: `owner = workerContext.owner`
  2. If no owner: route to user
  3. Else: try auto-approval
  4. If escalate: `_routeToParent(request, owner, ...)`

#### `HierarchicalPermissionRouter._routeToParent()`
- **File**: `hierarchicalPermissionRouter.ts:365`
- **Purpose**: Send permission request to parent via queue
- **ownerId Role**: Track which parent should respond
- **Flow**:
  1. Stores: `parentId: owner.ownerId` in pending requests
  2. Enqueues permission_request message
  3. Waits for permission_response with matching ID
  4. Times out if parent doesn't respond → escalate to user

### 6. Reporting Functions

#### `A2AReportCompletionTool.invoke()`
- **File**: `a2aReportCompletionTool.ts:71`
- **Purpose**: Report subtask completion to parent
- **ownerId Role**: Route completion message
- **Flow**:
  1. Gets: `owner = this._workerContext.owner`
  2. Enqueues completion message with: `owner: this._workerContext.owner`
  3. If parent is worker: extracts `parentWorkerId = owner.ownerId`
  4. Notifies via TaskMonitorService: `queueUpdate(parentWorkerId, ...)`

---

## SECTION 6: DATA FLOW SUMMARY

### Creation → Storage → Retrieval → Usage

#### Path 1: Orchestrator-Deployed Worker
```
1. CREATE:
   Orchestrator deploys task
   → Creates IWorkerOwnerContext { ownerType: 'orchestrator', ownerId: 'orchestrator' }

2. STORE:
   → Passed to WorkerToolsService.createWorkerToolSet()
   → Stored in WorkerToolSet._workerContext.owner
   → Injected into tool instances via DI

3. REGISTER:
   → Executor calls registerOwnerHandler('orchestrator', handler)
   → Stored in OrchestratorQueueService._ownerHandlers

4. USE:
   → Worker completes task
   → Enqueues message with owner: { ownerId: 'orchestrator' }
   → Queue routes to registered handler
   → Orchestrator receives completion
```

#### Path 2: Agent-Spawned Subtask
```
1. CREATE:
   Standalone agent spawns subtask
   → Creates IWorkerOwnerContext { ownerType: 'worker', ownerId: sessionId }

2. STORE:
   → SubTaskManager creates ISubTask with parentWorkerId = sessionId
   → WorkerToolsService creates context with owner = { ownerId: sessionId }
   → Passed to agent executor

3. REGISTER:
   → Agent registers: registerOwnerHandler(sessionId, handler)
   → Spawn tool registers: registerOwnerHandler(parentWorkerId, handler)

4. USE:
   → Subtask needs permission
   → Permission router checks workerContext.owner.ownerId
   → Routes to parent handler
   → Agent receives and decides
```

#### Path 3: Hierarchical Spawning (Worker → Subtask → Sub-subtask)
```
1. CREATE LEVEL 1:
   Orchestrator → Worker
   owner: { ownerType: 'orchestrator', ownerId: 'orchestrator' }

2. CREATE LEVEL 2:
   Worker → Subtask
   owner: { ownerType: 'worker', ownerId: 'worker-id-123' }

3. REGISTER HANDLERS:
   Worker registers: registerOwnerHandler('worker-id-123', workerHandler)
   Orchestrator has: registerOwnerHandler('orchestrator', orchHandler)

4. MESSAGE ROUTING:
   Sub-subtask (depth 2) completes
   → Routes to: worker-id-123 (parent worker)
   → Worker processes, may notify up: 'orchestrator'
   → Orchestrator receives final result
```

---

## SECTION 7: CRITICAL PATTERNS AND RULES

### Rule 1: Owner Chain Invariant
**Every worker EXCEPT standalone agents has an owner**
- Standalone agent: `owner = undefined` → routes to user
- Orchestrator worker: `owner.ownerId = 'orchestrator'`
- Spawned subtask: `owner.ownerId = parentWorkerId`

### Rule 2: Handler Registration Timing
**Handlers MUST be registered BEFORE messages can be routed**
```typescript
// CORRECT: Register before spawning
const handler = queueService.registerOwnerHandler(workerId, callback);
const subtask = spawnSubTask({ ... });

// WRONG: Messages sent before handler ready
const subtask = spawnSubTask({ ... });
const handler = queueService.registerOwnerHandler(workerId, callback);  // TOO LATE!
```

### Rule 3: Owner Context Inheritance
**Children inherit spawn context from parent**
- Parent: `spawnContext = 'orchestrator'` → Child: `spawnContext = 'orchestrator'`
- Parent: `spawnContext = 'agent'` → Child: `spawnContext = 'agent'`
- Owner context: `{ ownerType: 'worker', ownerId: parentWorkerId }`

### Rule 4: Message Routing Priority
**Queue routing order:**
1. Check `message.owner?.ownerId`
2. Look up handler: `_ownerHandlers.get(ownerId)`
3. If found: route to owner handler
4. Else: route to default orchestrator handler

### Rule 5: Depth Limits and ownerId
**ownerId is NOT used for depth calculation**
- Depth tracked separately in `workerContext.depth`
- ownerId only for message routing
- Depth limit prevents infinite spawning chains

### Rule 6: Cleanup Discipline
**Owner handlers MUST be disposed when worker ends**
```typescript
// Pattern: Store disposable and clean up
const disposable = registerOwnerHandler(ownerId, handler);
this._register(disposable);  // Auto-cleanup on dispose

// Or manual:
const disposable = registerOwnerHandler(ownerId, handler);
try {
  await doWork();
} finally {
  disposable.dispose();
}
```

---

## SECTION 8: KEY INSIGHTS

### Insight 1: Dual-Purpose ownerId
The `ownerId` serves two distinct purposes:
1. **Identity**: Uniquely identifies who owns/spawned a worker
2. **Routing Key**: Technical key for message handler lookup

### Insight 2: Handler Registry is Central
The `_ownerHandlers` map in OrchestratorQueueService is the **critical hub**:
- All message routing depends on this map
- No handler = messages go to orchestrator default
- Handler registration = opt-in to receive child messages

### Insight 3: Owner Context is Immutable
Once set in `IWorkerContext`, the owner context doesn't change:
- Set during worker creation
- Propagates to all tools via DI
- Lifetime = worker lifetime

### Insight 4: Three Routing Destinations
Messages ultimately route to one of three places:
1. **Orchestrator**: Messages with `ownerId = 'orchestrator'`
2. **Worker**: Messages with `ownerId = <workerId>`
3. **User**: Messages from workers with no owner (standalone agents)

### Insight 5: Parent-Child Communication Pattern
```
Parent Worker:
  1. Registers handler: registerOwnerHandler(myWorkerId, handler)
  2. Spawns child with: owner = { ownerId: myWorkerId }

Child Worker:
  1. Receives owner context via workerContext
  2. Sends messages with: owner = workerContext.owner
  3. Queue routes to parent's registered handler
```

### Insight 6: Permission Hierarchy Uses ownerId
Permission requests follow the owner chain:
1. Child asks parent via `owner.ownerId`
2. Parent can auto-approve, deny, or escalate
3. Escalation → next parent in chain or user

### Insight 7: Completion Notification Redundancy
Completions use BOTH mechanisms for reliability:
1. **Queue Message**: With `owner` context for routing
2. **TaskMonitorService**: Direct parent notification via `parentWorkerId`

This ensures parents receive completion even if one mechanism fails.

---

## SECTION 9: DEBUGGING GUIDE

### How to Trace ownerId Flow

#### Question: "Why isn't my worker receiving child messages?"

**Debug Steps:**
1. Check worker context has owner: `workerContext.owner?.ownerId`
2. Verify handler registered: `queueService.hasOwnerHandler(ownerId)`
3. Check message routing: Look for logs with `"Routing message to owner handler"`
4. Verify message has owner: `message.owner?.ownerId === expectedOwnerId`

**Common Issues:**
- Handler not registered before spawning child
- ownerId mismatch (sessionId vs workerId confusion)
- Handler disposed too early

#### Question: "Where is this completion message going?"

**Debug Steps:**
1. Log the message: `message.owner?.ownerId`
2. Check queue handler registry: `_ownerHandlers` keys
3. Look for routing logs in OrchestratorQueueService
4. Check pending messages: `getPendingMessagesForOwner(ownerId)`

**Common Issues:**
- Message sent before parent registered handler
- Wrong ownerId in message (copy/paste error)
- Parent handler threw exception → message stuck

#### Question: "Why is permission routing to user instead of parent?"

**Debug Steps:**
1. Check `workerContext.owner` is not undefined
2. Verify `owner.ownerId` is correct parent ID
3. Check parent has permission handler
4. Look for auto-approval policy matches

**Common Issues:**
- Worker has no owner context (standalone mode)
- Permission router can't find parent handler
- Parent auto-policy matches nothing → escalates

### Log Patterns to Search For

**Handler Registration:**
```
[OrchestratorQueue] Registered owner handler | ownerId=<value>
[ClaudeCodeSession] Registering owner handler | ownerId=<value>
[CopilotAgentExecutor] Registering owner handler | ownerId=<value>
```

**Message Routing:**
```
[OrchestratorQueue] Routing message to owner handler | ownerId=<value>
[OrchestratorQueue] No handler found for owner | ownerId=<value>
```

**Completion Delivery:**
```
[ParentCompletionService] Delivering completion to handler | ownerId=<value>
[A2AReportCompletion] Enqueuing completion message | targetOwnerId=<value>
```

---

## SECTION 10: ANTI-PATTERNS AND PITFALLS

### Anti-Pattern 1: Creating ownerId from Scratch
**Wrong:**
```typescript
const ownerId = generateUuid();  // Random ID
const owner = { ownerType: 'worker', ownerId };
```
**Right:**
```typescript
const ownerId = workerContext.workerId;  // Use actual worker ID
const owner = { ownerType: 'worker', ownerId };
```

### Anti-Pattern 2: Not Registering Handler for Spawned Children
**Wrong:**
```typescript
// Spawn child but don't register to receive messages
await spawnSubTask({ agentType: '@agent', prompt: '...' });
// Child messages go nowhere!
```
**Right:**
```typescript
const handler = registerOwnerHandler(myWorkerId, (msg) => { /* handle */ });
await spawnSubTask({ agentType: '@agent', prompt: '...' });
handler.dispose();  // Cleanup when done
```

### Anti-Pattern 3: Reusing ownerId Across Sessions
**Wrong:**
```typescript
const staticOwnerId = 'my-agent';  // Same for all sessions
registerOwnerHandler(staticOwnerId, handler);
```
**Right:**
```typescript
const uniqueOwnerId = sessionId;  // Unique per session
registerOwnerHandler(uniqueOwnerId, handler);
```

### Anti-Pattern 4: Not Passing Owner Context to Children
**Wrong:**
```typescript
createSubTask({
  // ... no owner context
});
// Child has no way to route messages back!
```
**Right:**
```typescript
createSubTask({
  // ...
  owner: {
    ownerType: 'worker',
    ownerId: myWorkerId
  }
});
```

### Anti-Pattern 5: Checking ownerId for Authorization
**Wrong:**
```typescript
if (message.owner.ownerId === 'trusted-worker') {
  // Do sensitive operation
}
```
**Why Wrong:** ownerId is for routing, not security. Any code can set it.

**Right:**
Use proper permission system (HierarchicalPermissionRouter) or trust boundaries.

---

## SECTION 11: FUTURE CONSIDERATIONS

### Potential Enhancements

1. **ownerId Validation**
   - Current: No validation that ownerId actually exists
   - Future: Registry of valid owner IDs, reject invalid messages

2. **Message Queue Prioritization by Owner**
   - Current: Priority based on message type
   - Future: Per-owner priority levels (urgent parent vs background parent)

3. **ownerId Scoping**
   - Current: Global namespace for all owners
   - Future: Hierarchical namespaces (orchestrator.worker.subtask)

4. **Ownership Transfer**
   - Current: Owner set at creation, never changes
   - Future: Transfer subtask ownership (handoff between workers)

5. **Multi-Parent Support**
   - Current: Each worker has exactly one owner
   - Future: Multiple parents for broadcast messages

### Known Limitations

1. **No Circular Dependency Detection**
   - Worker A spawns B spawns A → infinite loop possible
   - Depth limits help but not foolproof

2. **Handler Leaks**
   - If disposable not called → handler stays in map
   - Memory leak for long-running sessions

3. **ownerId Collision**
   - Two sessions with same ID → routing confusion
   - Mitigated by UUID generation but not enforced

4. **No Message Ordering Guarantees**
   - Messages from child to parent may arrive out of order
   - No sequence numbers or ordering enforcement

---

## APPENDIX A: COMPLETE TYPE DEFINITIONS

```typescript
// Core owner context
export interface IWorkerOwnerContext {
	ownerType: 'orchestrator' | 'worker' | 'agent';
	ownerId: string;
	sessionUri?: string;
}

// Worker context (includes owner)
export interface IWorkerContext {
	readonly _serviceBrand: undefined;
	readonly workerId: string;
	readonly worktreePath: string;
	readonly planId?: string;
	readonly taskId?: string;
	readonly depth: number;
	readonly owner?: IWorkerOwnerContext;  // ← CRITICAL
	readonly spawnContext: SpawnContext;
}

// Queue message (includes owner for routing)
export interface IOrchestratorQueueMessage {
	id: string;
	timestamp: number;
	priority: 'critical' | 'high' | 'normal' | 'low';
	planId: string;
	taskId: string;
	workerId: string;
	worktreePath: string;
	parentAgentId?: string;
	subTaskId?: string;
	depth?: number;
	owner?: IOwnerContext;  // ← ROUTING KEY
	type: string;
	content: unknown;
}

// Parent handler (keyed by ownerId)
export interface IParentHandler {
	ownerId: string;  // ← MAP KEY
	onCompletion: (message: IParentCompletionMessage) => Promise<void>;
	injectAsUserMessage: boolean;
}
```

---

## APPENDIX B: CRITICAL CODE PATHS

### Path: Subtask Spawning and Message Routing

```typescript
// 1. Parent spawns child
// File: a2aTools.ts:236
const createOptions: ISubTaskCreateOptions = {
	parentWorkerId: workerId,  // Parent's worker ID
	// ...
};

// 2. SubTaskManager creates context
// File: subTaskManager.ts (inferred)
const workerContext: IWorkerContext = {
	workerId: generateUuid(),
	owner: {
		ownerType: 'worker',
		ownerId: parentWorkerId  // ← LINK ESTABLISHED
	},
	// ...
};

// 3. Parent registers handler
// File: a2aTools.ts:358
handlerDisposable = this._queueService.registerOwnerHandler(
	parentWorkerId,  // ← SAME AS child.owner.ownerId
	async (message) => {
		// Receives child messages
	}
);

// 4. Child sends message
// File: a2aReportCompletionTool.ts:187
this._queueService.enqueueMessage({
	// ...
	owner: this._workerContext.owner,  // ← CONTAINS parentWorkerId
	type: 'completion',
	content: result
});

// 5. Queue routes message
// File: orchestratorQueue.ts:264
if (message.owner?.ownerId) {
	const ownerHandler = this._ownerHandlers.get(message.owner.ownerId);
	// ← LOOKUP BY ownerId
	if (ownerHandler) {
		return ownerHandler;  // ← ROUTE TO PARENT
	}
}
```

---

**END OF COMPREHENSIVE ANALYSIS**

Total analyzed: 112 references across 12 files
Analysis complete: 2025-12-22
