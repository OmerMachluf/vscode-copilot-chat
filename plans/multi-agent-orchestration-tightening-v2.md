# Multi-Agent Orchestration Tightening (v2 - Simplified)

## Overview

Tighten the existing multi-agent orchestration system by improving agent delegation guidance, enforcing worktree boundaries, promoting symbolic navigation, and fixing known rough edges.

**Key Insight**: The heavy infrastructure (plans, parallel execution, a2a tools) already works. This plan focuses on guidance, enforcement, and polish - not new architecture.

## Core Problems to Solve

1. **Event-driven orchestration** - Orchestrator LLM must be invoked when events arrive, not just passively handle messages
2. **Agent delegation guidance** - Agents can delegate but don't always know when they should
3. **Worktree granularity** - Must be enforced at the tool level
4. **Symbolic navigation** - Agents default to search when navigation is better
5. **Idle/error handling** - Loose ends that cause friction
6. **Easy agent addition** - Adding new specialist agents should be trivial

---

## Phase 1: Event-Driven Orchestration (CRITICAL)

**Goal**: Make the orchestrator LLM respond to events, not just passively handle messages in JS.

### The Problem

Currently, when workers send messages (questions, errors, completions):
1. Messages arrive at `OrchestratorQueueService` ✓
2. Messages are delivered to `_handleQueueMessage()` ✓
3. Handler runs as JS code ✗
4. **Orchestrator LLM is NOT invoked** ✗

This means the orchestrator can't make intelligent decisions - it just runs predefined JS logic.

Additionally, for non-blocking subtasks:
1. Parent registers handler during tool invocation
2. Tool returns immediately for `blocking: false`
3. Handler is **disposed** in `finally` block
4. Messages arrive to a dead handler

### 1.1 Event-to-LLM Pipeline

Create a service that invokes the orchestrator LLM when events need intelligent handling:

```typescript
// orchestrator/eventDrivenOrchestrator.ts

interface IOrchestratorInvocationContext {
  trigger: 'worker_question' | 'worker_error' | 'worker_completion' |
           'subtask_complete' | 'task_ready' | 'approval_request';
  message?: IOrchestratorQueueMessage;
  activePlan?: OrchestratorPlan;
  workerStatuses?: Map<string, WorkerStatus>;
}

class EventDrivenOrchestratorService extends Disposable {
  constructor(
    private readonly _orchestratorService: IOrchestratorService,
    private readonly _queueService: IOrchestratorQueueService,
    private readonly _agentRunner: IAgentRunner,
    private readonly _logService: ILogService,
  ) {
    super();

    // Replace the simple handler with event-driven handling
    this._register(this._queueService.registerHandler(
      this._handleMessageWithLLMDecision.bind(this)
    ));
  }

  private async _handleMessageWithLLMDecision(message: IOrchestratorQueueMessage): Promise<void> {
    // Some messages can be handled programmatically (no LLM needed)
    if (this._canHandleProgrammatically(message)) {
      return this._handleProgrammatically(message);
    }

    // Messages that need LLM decision-making
    this._logService.info(`[EventDrivenOrchestrator] Invoking LLM for ${message.type} message`);

    await this._invokeoOrchestratorLLM({
      trigger: this._getTriggerType(message),
      message,
      activePlan: this._orchestratorService.getActivePlan(),
      workerStatuses: this._orchestratorService.getWorkerStatuses(),
    });
  }

  private _canHandleProgrammatically(message: IOrchestratorQueueMessage): boolean {
    // These don't need LLM
    return message.type === 'status_update';
  }

  private _getTriggerType(message: IOrchestratorQueueMessage): IOrchestratorInvocationContext['trigger'] {
    switch (message.type) {
      case 'question': return 'worker_question';
      case 'error': return 'worker_error';
      case 'completion': return 'worker_completion';
      case 'approval_request': return 'approval_request';
      default: return 'worker_completion';
    }
  }

  private async _invokeOrchestratorLLM(context: IOrchestratorInvocationContext): Promise<void> {
    const prompt = this._buildPromptForContext(context);

    // Use AgentRunner to invoke the orchestrator as an LLM agent
    await this._agentRunner.run({
      agentType: '@orchestrator',
      prompt,
      history: [], // Orchestrator doesn't need conversation history for event handling
      tools: this._getOrchestratorTools(),
    });
  }

  private _buildPromptForContext(context: IOrchestratorInvocationContext): string {
    const lines: string[] = [];

    lines.push(`# Orchestrator Event: ${context.trigger}`);
    lines.push('');

    if (context.message) {
      lines.push(`## Incoming Message`);
      lines.push(`- Type: ${context.message.type}`);
      lines.push(`- From Worker: ${context.message.workerId}`);
      lines.push(`- Task: ${context.message.taskId}`);
      lines.push(`- Content: ${JSON.stringify(context.message.content)}`);
      lines.push('');
    }

    if (context.activePlan) {
      lines.push(`## Active Plan: ${context.activePlan.name}`);
      const pendingTasks = this._orchestratorService.getPendingTasks(context.activePlan.id);
      const runningTasks = this._orchestratorService.getRunningTasks(context.activePlan.id);
      lines.push(`- Pending Tasks: ${pendingTasks.length}`);
      lines.push(`- Running Tasks: ${runningTasks.length}`);
      lines.push('');
    }

    lines.push(`## Your Action Required`);
    switch (context.trigger) {
      case 'worker_question':
        lines.push('A worker has asked a question. Respond to help them continue.');
        break;
      case 'worker_error':
        lines.push('A worker encountered an error. Decide: retry, cancel, or escalate to user.');
        break;
      case 'worker_completion':
        lines.push('A worker completed. Check if dependent tasks can start.');
        break;
      case 'approval_request':
        lines.push('A worker needs approval. Review and approve or deny.');
        break;
    }

    return lines.join('\n');
  }
}
```

### 1.2 Fix Non-Blocking Handler Lifetime

For non-blocking subtasks, keep the handler alive until subtask completes:

```typescript
// tools/a2aTools.ts - modify A2ASpawnSubTaskTool

async invoke(params: A2ASpawnSubTaskParams): Promise<ToolResult> {
  const subTask = this._createSubTask(params);

  if (params.blocking !== false) {
    // Blocking mode: existing logic, handler lives for duration
    return this._executeBlocking(subTask);
  }

  // Non-blocking mode: register PERSISTENT handler
  const handlerId = `subtask-${subTask.id}`;

  // Handler that persists beyond this tool invocation
  this._registerPersistentHandler(handlerId, subTask.parentWorkerId, async (message) => {
    this._logService.debug(`[A2ASpawnSubTaskTool] Non-blocking message received: ${message.type}`);

    if (message.type === 'completion' || message.type === 'error') {
      // Subtask done, clean up handler
      this._disposePersistentHandler(handlerId);

      // Notify parent via event (parent's next turn will see this)
      this._subTaskManager.notifyParentOfCompletion(subTask.parentWorkerId, subTask.id, message);
    }
  });

  // Start subtask execution in background
  this._subTaskManager.executeSubTask(subTask.id).catch(err => {
    this._logService.error(`[A2ASpawnSubTaskTool] Non-blocking subtask failed: ${err}`);
    this._disposePersistentHandler(handlerId);
  });

  // Return immediately with subtask ID
  return {
    status: 'success',
    message: `Subtask ${subTask.id} started in background. Use a2a_await_subtasks to get results.`,
    subTaskId: subTask.id,
  };
}

// Persistent handler management
private _persistentHandlers = new Map<string, IDisposable>();

private _registerPersistentHandler(
  handlerId: string,
  ownerId: string,
  handler: (msg: IOrchestratorQueueMessage) => Promise<void>
): void {
  const disposable = this._queueService.registerOwnerHandler(ownerId, handler);
  this._persistentHandlers.set(handlerId, disposable);
}

private _disposePersistentHandler(handlerId: string): void {
  const disposable = this._persistentHandlers.get(handlerId);
  if (disposable) {
    disposable.dispose();
    this._persistentHandlers.delete(handlerId);
  }
}
```

### 1.3 Message Types That Trigger LLM

| Message Type | LLM Invoked? | Reason |
|--------------|--------------|--------|
| `status_update` | No | Informational only, update UI |
| `question` | **Yes** | Worker needs answer to proceed |
| `error` | **Yes** | Orchestrator decides retry/cancel |
| `completion` | Maybe | If dependent tasks exist, check readiness |
| `approval_request` | **Yes** | Worker needs permission |
| `approval_response` | No | Just route to requester |

### Tasks

- [ ] Create `EventDrivenOrchestratorService` that invokes LLM on events
- [ ] Define which message types need LLM vs programmatic handling
- [ ] Build context-aware prompts for each event type
- [ ] Fix non-blocking handler lifetime (persistent until subtask completes)
- [ ] Add parent notification when background subtask completes
- [ ] Test: worker sends question → orchestrator LLM responds
- [ ] Test: worker error → orchestrator LLM decides retry
- [ ] Test: non-blocking subtask → parent notified on completion

**LOC estimate**: ~200 lines
**This is the critical phase** - it fixes the core "orchestrator idles out" problem.

---

## Phase 2: Agent Delegation Guidance

**Goal**: Teach agents WHEN to delegate, not just HOW.

### 2.1 Delegation Decision Framework (In Agent Instructions)

Add to all `.agent.md` files:

```markdown
## When to Delegate vs Do It Yourself

### ALWAYS delegate when:
- Task requires **architectural decisions** → spawn `@architect` subtask
- Task requires **code review** → spawn `@reviewer` subtask
- Task requires **deep codebase investigation** → spawn `@researcher` subtask
- Task requires **test generation** → spawn `@tester` subtask
- Task requires **product/UX decisions** → spawn `@product` subtask
- Task can be **parallelized** → spawn multiple subtasks

### NEVER delegate when:
- You're already a specialist for this task type
- The task is simple enough to complete in < 5 tool calls
- Delegating would just move the same work to another agent

### Decision heuristic:
Ask yourself: "Is there an agent type that would do this BETTER than me?"
- If yes → delegate
- If no → do it yourself

### Examples:
- You're @agent implementing a feature, need to decide on API structure
  → Delegate to @architect: "Design the API structure for [feature]"

- You're @agent implementing a feature, need to read 3 files
  → Do it yourself (simple task, no specialist needed)

- You're @agent implementing a feature, need to understand how auth works in this codebase
  → Delegate to @researcher: "How is authentication implemented in this codebase?"
```

### 2.2 Specialist Discovery Tool

Agents need to know what specialists are available:

```typescript
// tools/a2aListSpecialists.ts

interface Specialist {
  agentType: string;      // @architect, @researcher, etc.
  expertise: string[];    // What they're good at
  whenToUse: string;      // Human-readable guidance
}

const SPECIALISTS: Specialist[] = [
  {
    agentType: '@architect',
    expertise: ['system design', 'API design', 'data models', 'architectural decisions'],
    whenToUse: 'When you need to make structural decisions about the codebase'
  },
  {
    agentType: '@researcher',
    expertise: ['codebase investigation', 'finding patterns', 'understanding existing code'],
    whenToUse: 'When you need to understand how something works in the codebase'
  },
  {
    agentType: '@reviewer',
    expertise: ['code review', 'quality checks', 'security review'],
    whenToUse: 'Before completing significant code changes'
  },
  {
    agentType: '@tester',
    expertise: ['test strategy', 'test generation', 'edge cases'],
    whenToUse: 'When code needs tests or you need help with test strategy'
  },
  {
    agentType: '@product',
    expertise: ['UX decisions', 'feature scoping', 'user perspective'],
    whenToUse: 'When making user-facing decisions or unclear on requirements'
  }
];

// Tool returns the list so agents can reason about who to delegate to
```

### Tasks
- [ ] Update all `.agent.md` files with delegation guidance
- [ ] Create `a2a_list_specialists` tool for agent discovery
- [ ] Add delegation examples to agent instructions

**LOC estimate**: ~50 lines code + instruction updates

---

## Phase 3: Worktree Granularity Enforcement

**Goal**: Ensure agents can ONLY operate within their assigned worktree.

### 3.1 Path Validation in Tools

Every file operation tool must validate paths:

```typescript
// shared/worktreeValidator.ts

export function validateWorktreePath(
  requestedPath: string,
  worktreePath: string,
  operation: 'read' | 'write' | 'delete'
): { valid: boolean; error?: string } {
  // Normalize paths
  const normalizedRequested = path.resolve(requestedPath);
  const normalizedWorktree = path.resolve(worktreePath);

  // Resolve symlinks to prevent escape
  let resolvedPath: string;
  try {
    resolvedPath = fs.realpathSync(normalizedRequested);
  } catch {
    // File doesn't exist yet (write operation) - check parent
    resolvedPath = fs.realpathSync(path.dirname(normalizedRequested));
  }

  // Must be within worktree
  if (!resolvedPath.startsWith(normalizedWorktree)) {
    return {
      valid: false,
      error: `Access denied: Cannot ${operation} files outside worktree.\n` +
             `Requested: ${requestedPath}\n` +
             `Worktree: ${worktreePath}`
    };
  }

  // Block sensitive paths even within worktree
  const relativePath = path.relative(normalizedWorktree, resolvedPath);
  if (relativePath.startsWith('.git') || relativePath.includes('node_modules')) {
    return {
      valid: false,
      error: `Access denied: Cannot modify ${relativePath}`
    };
  }

  return { valid: true };
}
```

### 3.2 Integrate Validation Into Tools

Add validation to `WorkerToolSet`:

```typescript
// workerToolsService.ts - modify tool invocations

async invokeTool(toolName: string, parameters: unknown, token: CancellationToken) {
  // For file operations, validate worktree path
  const fileTools = ['create_file', 'edit_file', 'read_file', 'delete_file'];
  if (fileTools.includes(toolName) && this._worktreePath) {
    const filePath = (parameters as any).path || (parameters as any).file_path;
    const validation = validateWorktreePath(filePath, this._worktreePath, 'write');
    if (!validation.valid) {
      throw new Error(validation.error);
    }
  }

  return this._originalInvoke(toolName, parameters, token);
}
```

### 3.3 Clear Worktree Path in Agent Context

Ensure agents always know their worktree:

```markdown
## Your Worktree

You are operating in worktree: `${worktreePath}`

All file operations are restricted to this directory. You cannot:
- Read files outside this worktree
- Write files outside this worktree
- Create symlinks that point outside this worktree

If you need files from outside your worktree, ask the orchestrator or spawn a subtask.
```

### Tasks
- [ ] Create `validateWorktreePath()` utility with symlink resolution
- [ ] Add validation to `WorkerToolSet.invokeTool()` for file operations
- [ ] Add worktree path to agent context in all deployments
- [ ] Test: attempt to read/write outside worktree → blocked

**LOC estimate**: ~80 lines

---

## Phase 4: Symbolic Navigation Enforcement

**Goal**: Guide agents to use navigation over search.

### 4.1 Navigation-First Tool Design

Create tools that encourage following code structure:

```typescript
// tools/navigateCode.ts

/**
 * Navigate to a symbol by following imports.
 * Use this instead of grep/search to find code.
 */
interface NavigateToSymbolParams {
  /** The symbol name to find (function, class, type) */
  symbolName: string;
  /** Starting file (defaults to current file) */
  fromFile?: string;
}

/**
 * Find all usages of a symbol by following the dependency graph.
 * More precise than text search.
 */
interface FindUsagesParams {
  /** The symbol to find usages of */
  symbolName: string;
  /** The file where the symbol is defined */
  definitionFile: string;
}

/**
 * Explore a module's exports to understand its API.
 */
interface ExploreModuleParams {
  /** Path to the module */
  modulePath: string;
}
```

### 4.2 Search Tool Guidance

Don't remove search tools, but guide agents away from them:

```markdown
## Code Navigation (PREFERRED)

When you need to understand code, prefer navigation over search:

### DO: Follow the code structure
1. Start from a known file
2. Read imports to find dependencies
3. Use `navigate_to_symbol` to jump to definitions
4. Use `find_usages` to see where things are used
5. Use `explore_module` to understand module APIs

### DON'T: Grep randomly
- Avoid `grep` or `search` for understanding code
- Text search finds matches, not meaning
- Navigation follows the actual code structure

### Example - Good:
"I need to understand how UserService works"
1. Read `src/services/UserService.ts`
2. See it imports from `./auth/AuthProvider`
3. Navigate to `AuthProvider` to understand auth flow
4. See `UserService` is used in `UserController`

### Example - Bad:
"I need to understand how UserService works"
1. grep for "UserService" across all files
2. Get 50 matches including tests, comments, logs
3. Spend time filtering through noise
```

### 4.3 Researcher Agent Definition

The `@researcher` agent should exemplify good navigation:

```markdown
# Researcher Agent (@researcher)

## Role
You are a codebase research expert. You investigate code structure, find patterns,
and gather context using SYMBOLIC NAVIGATION.

## Core Principle
**Follow the code, don't search the code.**

Your job is to understand HOW code works by tracing its structure:
- Follow imports to understand dependencies
- Read type definitions to understand contracts
- Trace function calls to understand data flow
- Examine class hierarchies to understand relationships

## Navigation Workflow
1. Start from a known entry point (file, function, class)
2. Read the file to understand its structure
3. Follow imports to related modules
4. Build a mental map of how components connect
5. Report findings with specific file:line references

## Tools
- `read_file` - Read file contents
- `navigate_to_symbol` - Jump to symbol definition
- `find_usages` - Find where symbol is used
- `explore_module` - List module exports

## DO NOT
- Use grep/search as primary investigation method
- Make assumptions without reading the code
- Report findings without file:line references

## Output Format
Always provide structured findings:
```
## Finding: [Topic]

### Key Files
- `src/services/UserService.ts:42` - Main service implementation
- `src/auth/AuthProvider.ts:15` - Authentication logic

### How It Works
[Clear explanation based on code reading]

### Code Flow
1. Request enters at `UserController.ts:20`
2. Calls `UserService.getUser()` at line 45
3. UserService calls `AuthProvider.verify()` at line 67
```
```

### Tasks
- [ ] Create `navigate_to_symbol` tool
- [ ] Create `find_usages` tool
- [ ] Create `explore_module` tool
- [ ] Add navigation guidance to all agent instructions
- [ ] Create `Researcher.agent.md` with navigation-first approach
- [ ] Add deprecation warning to search tools when better option exists

**LOC estimate**: ~150 lines for tools + instructions

---

## Phase 5: Quick Fixes (Idle, Messages, Errors)

**Goal**: Fix the rough edges with minimal code.

### 5.1 Message Delivery Fix

```typescript
// orchestratorQueue.ts - modify registerOwnerHandler

registerOwnerHandler(ownerId: string, handler: MessageHandler): Disposable {
  this._handlers.set(ownerId, handler);

  // CRITICAL: Process any messages that arrived before handler was registered
  setImmediate(() => {
    const pending = this._queue.filter(m =>
      m.owner?.ownerId === ownerId && !this._processedIds.has(m.id)
    );

    for (const message of pending) {
      try {
        handler(message);
        this._processedIds.add(m.id);
      } catch (e) {
        this._logService.error(`Failed to process pending message: ${e}`);
      }
    }
  });

  return { dispose: () => this._handlers.delete(ownerId) };
}
```

### 5.2 Idle Detection with User Prompt

```typescript
// workerHealthMonitor.ts - modify idle handling

private async _handleIdleWorker(workerId: string): Promise<void> {
  const worker = this._workers.get(workerId);
  if (!worker) return;

  // Check if worker has pending subtasks (don't interrupt)
  if (worker.pendingSubtasks.length > 0) {
    return; // Still waiting for subtasks
  }

  // Check last activity
  const idleTime = Date.now() - worker.lastActivityTime;
  if (idleTime < this._config.idleThresholdMs) {
    return; // Not idle long enough
  }

  // Ask user what to do
  const action = await vscode.window.showWarningMessage(
    `Worker "${worker.taskName}" has been idle for ${Math.round(idleTime / 60000)} minutes. ` +
    `It may be waiting for input or stuck.`,
    'Keep Waiting',
    'Send Reminder',
    'Mark Complete',
    'Cancel'
  );

  switch (action) {
    case 'Send Reminder':
      await this._sendReminderToWorker(workerId,
        'You appear to be idle. If you are done, call a2a_subtask_complete. ' +
        'If you need something, ask.'
      );
      break;
    case 'Mark Complete':
      await this._orchestrator.completeWorker(workerId);
      break;
    case 'Cancel':
      await this._orchestrator.cancelWorker(workerId);
      break;
    // 'Keep Waiting' - do nothing, reset timeout
  }
}
```

### 5.3 Error Notification

```typescript
// orchestratorServiceV2.ts - add to worker error handling

private _handleWorkerError(workerId: string, error: Error): void {
  const task = this._getTaskForWorker(workerId);

  vscode.window.showErrorMessage(
    `Task "${task?.name || workerId}" failed: ${error.message}`,
    'Retry',
    'Cancel',
    'Show Details'
  ).then(action => {
    switch (action) {
      case 'Retry':
        this.retryTask(task.id);
        break;
      case 'Cancel':
        this.cancelTask(task.id);
        break;
      case 'Show Details':
        this._showErrorDetails(error);
        break;
    }
  });
}
```

### Tasks
- [ ] Fix message delivery race condition (flush pending on register)
- [ ] Add idle detection with user prompt (not auto-complete)
- [ ] Add error notification with retry/cancel options
- [ ] Add "Send Reminder" option to wake up idle agents

**LOC estimate**: ~100 lines

---

## Phase 6: Easy Agent Addition

**Goal**: Make adding new specialist agents trivial.

### 6.1 Agent Template

```markdown
# [Agent Name] Agent (@[agent-type])

## Role
[One sentence describing this agent's expertise]

## Expertise
- [Area 1]
- [Area 2]
- [Area 3]

## When to Delegate to This Agent
Other agents should spawn me when they need:
- [Trigger 1]
- [Trigger 2]
- [Trigger 3]

## Tools
- [tool1] - [what it does]
- [tool2] - [what it does]
- Standard tools: read_file, edit_file, etc.

## Workflow
1. [Step 1 of how this agent approaches tasks]
2. [Step 2]
3. [Step 3]

## Output Format
[How this agent should format its deliverables]

## Delegation Guidance
[When this agent should delegate to others vs do it themselves]
```

### 6.2 New Agent Definitions

**@researcher** (see Phase 4 - Symbolic Navigation)

**@tester**
```markdown
# Tester Agent (@tester)

## Role
You are a testing expert who designs test strategies and writes comprehensive tests.

## Expertise
- Unit test generation
- Integration test design
- Edge case identification
- Test coverage analysis

## When to Delegate to This Agent
Other agents should spawn me when they need:
- Tests written for new code
- Test strategy for a feature
- Edge cases identified
- Test coverage improved

## Tools
- read_file, edit_file, create_file
- run_tests (execute test suite)

## Workflow
1. Understand the code being tested (read implementation)
2. Identify test cases (happy path, edge cases, error cases)
3. Write tests following project conventions
4. Run tests to verify they pass
5. Report coverage and any gaps

## Output Format
- Test files following project naming conventions
- Clear test descriptions
- Coverage summary

## Delegation Guidance
- Delegate to @researcher if you need to understand complex code
- Do NOT delegate test writing - that's your job
```

**@product**
```markdown
# Product Agent (@product)

## Role
You are a product expert who helps with UX decisions and user perspective.

## Expertise
- User experience decisions
- Feature scoping and requirements
- User-facing copy and messaging
- Accessibility considerations

## When to Delegate to This Agent
Other agents should spawn me when they need:
- UX/UI decisions
- User-facing copy reviewed
- Feature requirements clarified
- User perspective on technical decisions

## Workflow
1. Understand the user need or question
2. Consider the user perspective
3. Provide clear recommendation with reasoning
4. Suggest alternatives if appropriate

## Output Format
Clear recommendations with:
- Recommended approach
- Reasoning from user perspective
- Alternatives considered
- Any concerns or tradeoffs
```

### 6.3 Agent Registry

Simple JSON registry that agents can query:

```typescript
// agents/agentRegistry.ts

export const AGENT_REGISTRY = {
  '@architect': {
    file: 'Architect.agent.md',
    expertise: ['system design', 'API design', 'architecture'],
    triggers: ['design', 'architecture', 'structure', 'API']
  },
  '@researcher': {
    file: 'Researcher.agent.md',
    expertise: ['codebase investigation', 'patterns', 'understanding'],
    triggers: ['how does', 'understand', 'investigate', 'find']
  },
  '@reviewer': {
    file: 'Reviewer.agent.md',
    expertise: ['code review', 'quality', 'security'],
    triggers: ['review', 'check', 'verify', 'audit']
  },
  '@tester': {
    file: 'Tester.agent.md',
    expertise: ['testing', 'test generation', 'coverage'],
    triggers: ['test', 'coverage', 'edge cases']
  },
  '@product': {
    file: 'Product.agent.md',
    expertise: ['UX', 'user perspective', 'requirements'],
    triggers: ['user', 'UX', 'experience', 'requirements']
  }
};

// Helper for agents to find the right specialist
export function suggestSpecialist(taskDescription: string): string | null {
  const lowerTask = taskDescription.toLowerCase();
  for (const [agentType, config] of Object.entries(AGENT_REGISTRY)) {
    if (config.triggers.some(t => lowerTask.includes(t))) {
      return agentType;
    }
  }
  return null;
}
```

### Tasks
- [ ] Create agent template for consistency
- [ ] Create `Researcher.agent.md`
- [ ] Create `Tester.agent.md`
- [ ] Create `Product.agent.md`
- [ ] Create simple agent registry with trigger keywords
- [ ] Add `suggestSpecialist()` helper for delegation hints

**LOC estimate**: ~50 lines code + agent definition files

---

## Summary

| Phase | Goal | LOC | Time |
|-------|------|-----|------|
| 1. Event-Driven Orchestration | Invoke LLM on events, fix handler lifetime | ~200 | 2-3 days |
| 2. Delegation Guidance | Teach agents when to delegate | ~50 | 1 day |
| 3. Worktree Enforcement | Hard-enforce worktree boundaries | ~80 | 1 day |
| 4. Symbolic Navigation | Guide agents to navigate not search | ~150 | 2 days |
| 5. Quick Fixes | Idle detection, error notification | ~100 | 1 day |
| 6. Easy Agent Addition | Templates + new agents | ~50 + docs | 1 day |

**Total: ~630 LOC + documentation over ~8-9 days**

**Phase 1 is CRITICAL** - it fixes the core "orchestrator idles out" problem that blocks everything else.

---

## What This Plan Does NOT Include

Deliberately excluded based on reviewer feedback:

1. **Complex state machine** - 9-state machine not needed. Simple "invoke LLM on events" is sufficient.
2. **Full pub/sub event bus** - Not needed. Targeted event-to-LLM pipeline for specific message types.
3. **Error recovery engine** - Not needed. Show error to user, let them decide (or orchestrator LLM decides).
4. **Consultation protocol** - Not needed. Spawning subtasks IS consultation.
5. **Complex type hierarchies** - Keep it simple.

---

## Success Criteria

1. **Delegation**: Agents spawn subtasks to specialists without being told
2. **Worktree**: File operations outside worktree are blocked (not just warned)
3. **Navigation**: Agents use navigate tools more than grep (observable in logs)
4. **Idle handling**: User is prompted, not assumed complete
5. **New agents**: Adding a new specialist is < 1 hour of work

---

## Dependencies

- Existing a2a tools (already working)
- Existing orchestrator infrastructure (already working)
- VS Code extension APIs (file operations)

---

## Risks

| Risk | Mitigation |
|------|------------|
| Agents ignore delegation guidance | Add to system prompt, not just instructions |
| Worktree validation has edge cases | Comprehensive test suite for path validation |
| Navigation tools are slower than search | Acceptable tradeoff for precision |
| New agents aren't used | Explicit triggers in instructions |
