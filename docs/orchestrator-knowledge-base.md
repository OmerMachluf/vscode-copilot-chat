# Multi-Agent Orchestrator System - Technical Knowledge Base

> **Document Version:** 1.0
> **Last Updated:** December 7, 2025
> **Status:** Reference Documentation

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture](#system-architecture)
3. [Core Components](#core-components)
4. [Specialized Agents](#specialized-agents)
5. [Orchestrator Tools](#orchestrator-tools)
6. [Workflow Execution](#workflow-execution)
7. [Git Worktree Integration](#git-worktree-integration)
8. [Dashboard & UI](#dashboard--ui)
9. [Chat Sessions Integration](#chat-sessions-integration)
10. [Key Data Models](#key-data-models)
11. [Example Workflows](#example-workflows)

---

## Executive Summary

The Multi-Agent Orchestrator is a sophisticated system for **parallel execution of AI agent tasks** within VS Code Copilot Chat. It enables complex development workflows by:

- Breaking down tasks into stages assigned to specialized agents
- Executing independent tasks in parallel across isolated git worktrees
- Managing dependencies between tasks using a DAG (Directed Acyclic Graph)
- Coordinating multiple workers with different AI models
- Creating pull requests upon completion

### Key Benefits

| Benefit | Description |
|---------|-------------|
| **Parallel Execution** | Independent tasks run concurrently in separate worktrees |
| **Specialization** | Each agent optimized for its role (planning, design, implementation, review) |
| **Non-blocking** | User continues working while agents execute in background |
| **Multi-plan Support** | Multiple plans can be active simultaneously |
| **Event-driven** | Reactive orchestration based on task completion events |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER REQUEST                                    │
│                    "Fix bug #1234" or "@orchestrator deploy"                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
        ┌───────────────────┐           ┌───────────────────┐
        │  @planner         │           │  @orchestrator    │
        │  (WorkflowPlanner)│           │  (Orchestrator)   │
        │                   │           │                   │
        │  Creates plans    │           │  Deploys plans    │
        │  Assigns agents   │           │  Tracks progress  │
        │  Sets dependencies│           │  Handles events   │
        └───────────────────┘           └───────────────────┘
                    │                               │
                    │ orchestrator_savePlan         │ orchestrator_deploy
                    ▼                               ▼
        ┌─────────────────────────────────────────────────────┐
        │                 ORCHESTRATOR SERVICE                 │
        │                 (orchestratorServiceV2.ts)          │
        │                                                     │
        │  Plans[] ──────► Tasks[] ──────► Workers[]         │
        │                                                     │
        │  • Manages plan lifecycle                           │
        │  • Deploys tasks based on DAG                       │
        │  • Smart parallelization (file overlap detection)   │
        │  • State persistence to JSON                        │
        └─────────────────────────────────────────────────────┘
                    │
      ┌─────────────┼─────────────┬─────────────┐
      ▼             ▼             ▼             ▼
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Worker 1 │  │ Worker 2 │  │ Worker 3 │  │ Worker 4 │
│ @agent   │  │@architect│  │ @agent   │  │@reviewer │
│ Worktree │  │ Worktree │  │ Worktree │  │ Worktree │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
```

---

## Core Components

### 1. Orchestrator Service (`orchestratorServiceV2.ts`)

The central coordinator managing all orchestration logic.

**Location:** `src/extension/orchestrator/orchestratorServiceV2.ts`

**Responsibilities:**
- Plan CRUD operations (create, read, update, delete)
- Task management with dependency tracking
- Worker deployment and lifecycle management
- Smart parallelization with file overlap detection
- Event emission for task lifecycle
- State persistence to `.copilot-orchestrator-state.json`

**Key Methods:**

```typescript
interface IOrchestratorService {
  // Plan Management
  createPlan(name: string, description: string, baseBranch?: string): OrchestratorPlan;
  startPlan(planId: string): Promise<void>;
  pausePlan(planId: string): void;
  resumePlan(planId: string): void;
  deletePlan(planId: string): void;

  // Task Management
  addTask(description: string, options?: CreateTaskOptions): WorkerTask;
  getReadyTasks(planId?: string): readonly WorkerTask[];
  removeTask(taskId: string): void;

  // Worker Management
  deploy(taskId?: string, options?: DeployOptions): Promise<WorkerSession>;
  deployAll(planId?: string, options?: DeployOptions): Promise<WorkerSession[]>;
  sendMessageToWorker(workerId: string, message: string): void;
  interruptWorker(workerId: string): void;
  killWorker(workerId: string, options?: KillWorkerOptions): Promise<void>;
  completeWorker(workerId: string, options?: CompleteWorkerOptions): Promise<CompleteWorkerResult>;
  retryTask(taskId: string, options?: DeployOptions): Promise<WorkerSession>;
}
```

---

### 2. Worker Session (`workerSession.ts`)

Manages individual worker state and conversation.

**Location:** `src/extension/orchestrator/workerSession.ts`

**Status Lifecycle:**

```
idle ──► running ──► waiting-approval ──► completed
  │         │              │                  │
  │         └──► paused ◄──┘                  │
  │                                           │
  └──────────────► error ◄────────────────────┘
```

**Key Features:**
- Conversation history tracking (`WorkerMessage[]`)
- Approval workflow (`PendingApproval[]`)
- Pause/resume/interrupt support
- Cancellation token for stopping operations
- Serialization for persistence

**WorkerResponseStream:**

Implements `vscode.ChatResponseStream` to capture LLM output and report back to the worker session with debounced updates.

---

### 3. Agent Runner (`agentRunner.ts`)

Executes agent tasks programmatically without VS Code chat UI.

**Location:** `src/extension/orchestrator/agentRunner.ts`

**Key Features:**
- Creates synthetic `ChatRequest` with all tools enabled
- Uses `Intent.Agent` at `ChatLocation.Agent` for full capabilities
- Supports custom worktree paths for file operations
- Integrates with `DefaultIntentRequestHandler`

```typescript
interface IAgentRunOptions {
  prompt: string;
  sessionId?: string;
  model: vscode.LanguageModelChat;
  suggestedFiles?: string[];
  additionalInstructions?: string;
  token: CancellationToken;
  onPaused?: Event<boolean>;
  maxToolCallIterations?: number;  // Default: 200
  worktreePath?: string;
}

interface IAgentRunResult {
  success: boolean;
  error?: string;
  response?: string;
  metadata?: Record<string, unknown>;
}
```

---

### 4. Agent Discovery Service (`agentDiscoveryService.ts`)

Discovers available agents from multiple sources.

**Location:** `src/extension/orchestrator/agentDiscoveryService.ts`

**Sources:**
1. **Built-in agents** (hardcoded): `@agent`, `@ask`, `@edit`
2. **Extension assets**: `assets/agents/*.agent.md`
3. **Repository agents**: `.github/agents/*/*.agent.md`

**Agent Info Structure:**

```typescript
interface AgentInfo {
  id: string;           // e.g., 'planner', 'architect'
  name: string;         // Human-readable name
  description: string;
  tools: string[];      // Available tools
  source: 'builtin' | 'repo';
  capabilities?: string[];
  path?: string;        // File path
}
```

---

### 5. Agent Instruction Service (`agentInstructionService.ts`)

Composes instructions for agents from multiple sources.

**Location:** `src/extension/orchestrator/agentInstructionService.ts`

**Instruction Loading Order (later overrides earlier):**

1. **Built-in defaults:** `assets/agents/{agent}.agent.md`
2. **Global workspace:** `.github/instructions/*.md`
3. **Agent-specific:** `.github/agents/{agent}/*.md`

**Agent Definition Format (`.agent.md`):**

```markdown
---
name: WorkflowPlanner
description: Creates high-level workflow plans
tools: ['search', 'fetch', 'orchestrator_savePlan']
---

You are the WorkflowPlanner...
```

---

## Specialized Agents

### WorkflowPlanner (`@planner`)

**File:** `assets/agents/WorkflowPlanner.agent.md`

**Purpose:** Creates high-level process workflows (stages/phases)

**What it does:**
- Defines workflow stages (Investigate, Design, Implement, Review)
- Assigns appropriate agents to each stage
- Sets stage dependencies
- Discovers and uses custom repo agents

**What it does NOT do:**
- Plan which specific files to modify
- Create granular implementation tasks
- Decide parallelization of code changes

**Tools Used:**
- `search`, `fetch`, `read_file`, `semantic_search`
- `orchestrator_listAgents`
- `orchestrator_savePlan`

---

### Orchestrator (`@orchestrator`)

**File:** `assets/agents/Orchestrator.agent.md`

**Purpose:** Manages execution of multi-agent workflows

**Responsibilities:**
1. **Plan Deployment** - Deploy plans created by WorkflowPlanner
2. **Implementation Expansion** - Create tasks from Architect output
3. **Parallelization Decisions** - Decide optimal worker allocation
4. **Worker Coordination** - Monitor and communicate with workers
5. **Progressive Execution** - Deploy tasks in dependency order

**Tools Used:**
- `orchestrator_deploy`
- `orchestrator_listWorkers`
- `orchestrator_sendMessage`
- `orchestrator_expandImplementation`
- `orchestrator_addPlanTask`

---

### Architect (`@architect`)

**File:** `assets/agents/Architect.agent.md`

**Purpose:** Designs technical implementation

**Output Format:**

```yaml
implementation:
  summary: "Brief description of the fix"
  files_to_modify:
    - path: src/auth/TokenValidator.ts
      changes: "Add null check at line 45"
      complexity: small
  files_to_create:
    - path: src/auth/__tests__/token.spec.ts
      purpose: "Unit tests for token validation"
  test_strategy:
    unit: ["TokenValidator edge cases"]
    integration: ["Auth flow with enterprise tokens"]
  parallelization:
    - group: auth-core
      files: [src/auth/TokenValidator.ts]
    - group: auth-enterprise
      files: [src/auth/EnterpriseAuth.ts]
```

---

### Reviewer (`@reviewer`)

**File:** `assets/agents/Reviewer.agent.md`

**Purpose:** Reviews code changes for quality

**Output Format:**

```yaml
review:
  status: approved | changes_requested | needs_discussion
  summary: "Overall assessment"
  blocking_issues: []
  suggestions:
    - file: src/auth/TokenValidator.ts
      line: 45
      severity: warning
      comment: "Consider adding error logging"
  approved_changes:
    - "Token null check implementation"
```

---

## Orchestrator Tools

Tools exposed to LLMs for workflow management.

**Location:** `src/extension/tools/node/orchestratorTools.ts`

| Tool Name | Purpose | Key Parameters |
|-----------|---------|----------------|
| `orchestrator_addPlanTask` | Add a task to a plan | `description`, `planId?`, `agent?`, `dependencies?`, `targetFiles?` |
| `orchestrator_deploy` | Deploy plan or specific task | `planId?`, `taskId?`, `modelId?` |
| `orchestrator_listWorkers` | Show plans, tasks, workers | (none) |
| `orchestrator_sendMessage` | Communicate with a worker | `receiver`, `message` |
| `orchestrator_listAgents` | Discover available agents | (none) |
| `orchestrator_savePlan` | Save a complete workflow plan | `name`, `description`, `tasks[]`, `autoStart?` |
| `orchestrator_expandImplementation` | Create sub-tasks from Architect | `parentTaskId`, `architectOutput`, `strategy?` |
| `orchestrator_killWorker` | Stop and clean up a worker | `workerId`, `removeWorktree?`, `resetTask?` |
| `orchestrator_cancelTask` | Cancel/reset a task | `taskId`, `remove?` |
| `orchestrator_retryTask` | Retry a failed task | `taskId`, `modelId?` |

### Save Plan Tool - Task Structure

```typescript
interface IPlanTaskDefinition {
  id: string;              // Unique within plan (e.g., "investigate")
  name?: string;           // Human-readable name
  description: string;     // What to accomplish
  agent?: string;          // "@agent", "@architect", "@reviewer"
  dependencies?: string[]; // Task IDs that must complete first
  parallelGroup?: string;  // For potential parallel execution
  targetFiles?: string[];  // Files this task will touch
  priority?: 'critical' | 'high' | 'normal' | 'low';
}
```

### Plan Validation

The `orchestrator_savePlan` tool validates:
- Plan name and description required
- At least one task
- No duplicate task IDs
- All dependencies exist
- No circular dependencies

---

## Workflow Execution

### Dependency-Based Execution (DAG)

Tasks form a Directed Acyclic Graph:

```
                    ┌─────────────┐
                    │ Investigate │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   Design    │
                    │ (@architect)│
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
       ┌────────────┐           ┌────────────┐
       │ Implement  │           │ Implement  │
       │  (Area A)  │           │  (Area B)  │
       └─────┬──────┘           └──────┬─────┘
             │                         │
             └────────────┬────────────┘
                          ▼
                   ┌────────────┐
                   │   Review   │
                   │ (@reviewer)│
                   └────────────┘
```

### Task Status Lifecycle

```
pending ──► queued ──► running ──► completed
                          │            │
                          ▼            │
                       failed ◄────────┘
                          │
                          ▼
                       blocked (if dependency failed)
```

### Smart Parallelization

The orchestrator uses file overlap detection for safe parallel execution:

```typescript
// Tasks can run in parallel if:
// 1. Both have targetFiles specified
// 2. No file overlap between them
// 3. Dependencies are satisfied

function canRunInParallel(taskA: WorkerTask, taskB: WorkerTask): boolean {
  if (!taskA.targetFiles?.length || !taskB.targetFiles?.length) {
    return false;
  }
  const filesA = new Set(taskA.targetFiles.map(normalize));
  return !taskB.targetFiles.some(f => filesA.has(normalize(f)));
}
```

---

## Git Worktree Integration

Each worker operates in an isolated git worktree.

### Worktree Creation

```typescript
// Worktrees created in sibling directory
const worktreesDir = path.join(workspaceFolder, '..', '.worktrees');
const worktreePath = path.join(worktreesDir, taskName);

// Create branch and worktree
await execGit(['worktree', 'add', '-b', branchName, worktreePath, baseBranch]);
```

### Worker Completion

When completing a worker:
1. Stage all changes (`git add -A`)
2. Commit (`git commit -m "Complete task: ..."`)
3. Push to origin (`git push -u origin branchName`)
4. Optionally create PR via `gh pr create`
5. Remove worktree (`git worktree remove`)

---

## Dashboard & UI

**Location:** `src/extension/orchestrator/dashboard/WorkerDashboardV2.ts`

### Features

- **Plan Selector:** Dropdown to switch between plans with status badges
- **Plan Controls:** Start/Pause/Resume/Delete buttons
- **Task List View:** Shows tasks with status, dependencies, agent, priority
- **Graph View:** SVG dependency visualization with critical path highlighting
- **Worker Cards:** Expandable cards showing conversation history
- **Model Selector:** Change AI model for workers/deployments
- **Action Buttons:** Deploy, Kill, Cancel, Retry, Complete, Complete+PR

### Status Colors

| Status | Color | Icon |
|--------|-------|------|
| Pending | Gray | ⬜ |
| Queued | Blue | ⏳ |
| Running | Blue (animated) | 🔄 |
| Completed | Green | ✅ |
| Failed | Red | ❌ |
| Blocked | Yellow | 🚫 |
| Critical Path | Orange border | ⚡ |

### Critical Path Calculation

The dashboard calculates and highlights the longest dependency chain:

```javascript
function calculateCriticalPath(tasks) {
  // Calculate depth (layer) for each task
  // Trace back from deepest tasks to find critical chain
  // Mark all tasks on the critical path
}
```

---

## Chat Sessions Integration

**Location:** `src/extension/chatSessions/vscode-node/chatSessions.ts`

The `ChatSessionsContrib` class integrates multiple session types:

### Session Types

1. **Claude Code Sessions**
   - `ClaudeChatSessionItemProvider`
   - `ClaudeChatSessionContentProvider`
   - `ClaudeChatSessionParticipant`
   - Uses `ClaudeAgentManager` and `ClaudeCodeSdkService`

2. **Copilot CLI Sessions**
   - `CopilotCLIChatSessionItemProvider`
   - `CopilotCLIChatSessionContentProvider`
   - `CopilotCLIChatSessionParticipant`
   - Includes `CopilotCLIWorktreeManager` for git integration
   - Terminal integration via `CopilotCLITerminalIntegration`
   - MCP support via `CopilotCLIMCPHandler`

3. **Copilot Cloud Sessions**
   - `CopilotCloudSessionsProvider`
   - PR integration (close PR command)
   - Browser session viewing

### Service Collections

Each session type uses dependency injection with custom service collections:

```typescript
const copilotcliAgentInstaService = instantiationService.createChild(
  new ServiceCollection(
    [ICopilotCLISessionService, new SyncDescriptor(CopilotCLISessionService)],
    [ICopilotCLIModels, new SyncDescriptor(CopilotCLIModels)],
    [ICopilotCLISDK, new SyncDescriptor(CopilotCLISDK)],
    [ILanguageModelServer, new SyncDescriptor(LanguageModelServer)],
    [ICopilotCLITerminalIntegration, new SyncDescriptor(CopilotCLITerminalIntegration)],
    [ICopilotCLIMCPHandler, new SyncDescriptor(CopilotCLIMCPHandler)],
  ));
```

---

## Key Data Models

### OrchestratorPlan

```typescript
interface OrchestratorPlan {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly createdAt: number;
  readonly baseBranch?: string;
  status: PlanStatus;  // 'draft' | 'active' | 'paused' | 'completed' | 'failed'
  metadata?: {
    sourceRequest?: string;
    methodology?: string;
  };
}
```

### WorkerTask

```typescript
interface WorkerTask {
  readonly id: string;
  readonly name: string;           // Branch name
  readonly description: string;
  readonly priority: 'critical' | 'high' | 'normal' | 'low';
  readonly dependencies: string[];  // Task IDs
  readonly parallelGroup?: string;
  readonly context?: WorkerTaskContext;
  readonly baseBranch?: string;
  readonly planId?: string;
  readonly modelId?: string;
  readonly agent?: string;         // "@agent", "@architect", etc.
  readonly targetFiles?: string[]; // For parallelization
  status: TaskStatus;              // 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'blocked'
  workerId?: string;
  completedAt?: number;
  error?: string;
}
```

### WorkerSessionState

```typescript
interface WorkerSessionState {
  readonly id: string;
  readonly name: string;
  readonly task: string;
  readonly worktreePath: string;
  readonly status: WorkerStatus;
  readonly messages: readonly WorkerMessage[];
  readonly pendingApprovals: readonly PendingApproval[];
  readonly createdAt: number;
  readonly lastActivityAt: number;
  readonly errorMessage?: string;
  readonly planId?: string;
  readonly baseBranch?: string;
}
```

### OrchestratorEvent

```typescript
type OrchestratorEvent =
  | { type: 'task.queued'; planId: string | undefined; taskId: string }
  | { type: 'task.started'; planId: string | undefined; taskId: string; workerId: string }
  | { type: 'task.completed'; planId: string | undefined; taskId: string; workerId: string }
  | { type: 'task.failed'; planId: string | undefined; taskId: string; error: string }
  | { type: 'task.blocked'; planId: string | undefined; taskId: string; reason: string }
  | { type: 'worker.needs_approval'; workerId: string; approvalId: string }
  | { type: 'worker.idle'; workerId: string }
  | { type: 'plan.started'; planId: string }
  | { type: 'plan.completed'; planId: string }
  | { type: 'plan.failed'; planId: string; error: string };
```

---

## Example Workflows

### Bug Fix Workflow

```
1. User: "@planner Fix bug #1234 - enterprise login fails"

2. WorkflowPlanner creates plan via orchestrator_savePlan:
   - investigate (no deps) → @agent
   - design (depends: investigate) → @architect
   - implement (depends: design) → @agent
   - review (depends: implement) → @reviewer

3. User: "@orchestrator deploy plan-1"

4. Orchestrator executes:
   a. Creates worktree from main
   b. Deploys "investigate" task → Worker starts
   c. On completion → deploys "design" (@architect)
   d. Architect outputs file changes with parallelization hints
   e. Orchestrator expands into 2 parallel implementation tasks
   f. Both complete → deploys "review"
   g. Review completes → Plan marked complete
   h. User clicks "Complete + PR" → PR created
```

### Feature Implementation Workflow

```yaml
plan:
  name: feature-oauth2-integration
  description: Add OAuth2 authentication support
  tasks:
    - id: requirements
      agent: "@agent"
      description: "Clarify OAuth2 requirements and scope"
      dependencies: []

    - id: architecture
      agent: "@architect"
      description: "Design OAuth2 integration architecture"
      dependencies: [requirements]

    - id: implement
      agent: "@agent"
      description: "Implement OAuth2 support"
      dependencies: [architecture]

    - id: review
      agent: "@reviewer"
      description: "Review implementation"
      dependencies: [implement]
```

---

## File Reference

| Component | File Path |
|-----------|-----------|
| Orchestrator Service | `src/extension/orchestrator/orchestratorServiceV2.ts` |
| Worker Session | `src/extension/orchestrator/workerSession.ts` |
| Agent Runner | `src/extension/orchestrator/agentRunner.ts` |
| Agent Discovery | `src/extension/orchestrator/agentDiscoveryService.ts` |
| Agent Instructions | `src/extension/orchestrator/agentInstructionService.ts` |
| Orchestrator Tools | `src/extension/tools/node/orchestratorTools.ts` |
| Dashboard | `src/extension/orchestrator/dashboard/WorkerDashboardV2.ts` |
| Worker Chat Panel | `src/extension/orchestrator/dashboard/WorkerChatPanel.ts` |
| Worker Main | `src/extension/orchestrator/workerMain.ts` |
| Chat Sessions | `src/extension/chatSessions/vscode-node/chatSessions.ts` |
| WorkflowPlanner Agent | `assets/agents/WorkflowPlanner.agent.md` |
| Orchestrator Agent | `assets/agents/Orchestrator.agent.md` |
| Architect Agent | `assets/agents/Architect.agent.md` |
| Reviewer Agent | `assets/agents/Reviewer.agent.md` |
| Architecture Doc | `docs/orchestrator-architecture.md` |
| User Guide | `docs/orchestrator-readme.md` |

---

## State Persistence

The orchestrator persists state to `.copilot-orchestrator-state.json`:

```json
{
  "version": 3,
  "plans": [...],
  "tasks": [...],
  "workers": [...],
  "nextTaskId": 42,
  "nextPlanId": 5,
  "activePlanId": "plan-3"
}
```

State is saved with debouncing (500ms) and restored on extension activation.

---

*End of Knowledge Base Document*
