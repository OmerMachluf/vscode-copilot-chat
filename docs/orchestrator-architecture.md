# Multi-Agent Orchestrator Architecture

> **Status:** Planning
> **Last Updated:** November 27, 2025
> **Authors:** Copilot + User

## Executive Summary

This document outlines the architecture for a multi-agent orchestration system within VS Code Copilot Chat. The system enables complex development tasks to be broken down by specialized agents (Planner, Architect, Coder, Reviewer) and executed in parallel across isolated git worktrees.

---

## Table of Contents

1. [Vision](#vision)
2. [Core Concepts](#core-concepts)
3. [Agent Types](#agent-types)
4. [Architecture](#architecture)
5. [Folder Structure](#folder-structure)
6. [Data Models](#data-models)
7. [Workflows](#workflows)
8. [Implementation Phases](#implementation-phases)
9. [Open Questions](#open-questions)

---

## Vision

### The Problem

Today, developers use Copilot for individual tasks one at a time. For complex work (bug fixes, features, refactors), they must:
- Manually break down work into steps
- Execute steps sequentially
- Context-switch between investigation, planning, coding, testing, review

### The Solution

A multi-agent system where:
- **Planner** creates high-level workflows based on the task type and repo methodology
- **Architect** designs the technical implementation approach
- **Coder** (default Agent) implements the changes
- **Reviewer** validates the work
- **Orchestrator** coordinates everything, managing dependencies and parallelism
- **Custom agents** (repo-defined) handle domain-specific tasks (investigation, Kusto queries, etc.)

### Key Benefits

1. **Parallel execution** - Independent tasks run concurrently in separate worktrees
2. **Specialization** - Each agent optimized for its role with dedicated instructions
3. **Domain awareness** - Repos define custom agents and methodology-specific instructions
4. **Non-blocking** - User continues working while agents execute in background
5. **Multi-plan support** - Multiple plans can be active simultaneously

---

## Core Concepts

### Workflow vs Implementation Planning

| Concern | Agent | Question Answered |
|---------|-------|-------------------|
| **Workflow** | Planner | WHAT steps/phases do we need? In what order? |
| **Technical** | Architect | HOW do we implement? Which files? What patterns? |

**Example:**

```
User: "Fix bug #1234 - login fails for enterprise users"

┌─────────────────────────────────────────────────────────────────┐
│ PLANNER OUTPUT (Workflow)                                       │
├─────────────────────────────────────────────────────────────────┤
│ 1. Investigate: Gather bug details, reproduce issue             │
│ 2. Root Cause: Analyze logs, identify the problem               │
│ 3. Architecture: Design the fix approach                        │
│ 4. Implement: Write the code fix                                │
│ 5. Test: Write/update tests                                     │
│ 6. Review: Code review and validation                           │
│ 7. PR: Create pull request                                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ ARCHITECT OUTPUT (Technical - triggered at step 3)             │
├─────────────────────────────────────────────────────────────────┤
│ Files to modify:                                                │
│   - src/auth/TokenValidator.ts: Add null check line 45         │
│   - src/auth/EnterpriseAuth.ts: Update token refresh logic     │
│                                                                 │
│ New files:                                                      │
│   - src/auth/__tests__/enterprise-auth.spec.ts                 │
│                                                                 │
│ Test strategy:                                                  │
│   - Unit tests: 3 new cases in TokenValidator.spec.ts          │
│   - Integration: New enterprise-auth.integration.spec.ts       │
│   - E2E: Not needed (existing login E2E covers this)           │
│                                                                 │
│ Parallelization:                                                │
│   - TokenValidator changes: independent                         │
│   - EnterpriseAuth changes: independent                         │
│   - Can run in parallel (no file overlap)                       │
└─────────────────────────────────────────────────────────────────┘
```

### Dependency-Based Execution

Tasks form a Directed Acyclic Graph (DAG):

```
                    ┌─────────────┐
                    │ Investigate │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Root Cause  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Architect  │
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
                   │   Test     │
                   └─────┬──────┘
                         │
                   ┌─────▼──────┐
                   │   Review   │
                   └─────┬──────┘
                         │
                   ┌─────▼──────┐
                   │     PR     │
                   └────────────┘
```

### Event-Driven Orchestration

The orchestrator does NOT block. It reacts to events:

```typescript
// NOT this (blocking):
while (plan.hasMoreTasks()) {
  await deployNextTask();
  await waitForCompletion();  // BLOCKS USER
}

// BUT this (event-driven):
orchestrator.on('task.completed', (task) => {
  const readyTasks = plan.getTasksWithSatisfiedDependencies();
  readyTasks.forEach(t => deployTask(t));
});
```

---

## Agent Types

### Built-in Agents

| Agent | ID | Role | Scope |
|-------|-----|------|-------|
| **Planner** | `@planner` | Creates high-level workflows | Process/methodology |
| **Architect** | `@architect` | Designs technical implementation | Code structure |
| **Coder** | `@agent` | Implements code changes | Default copilot agent |
| **Reviewer** | `@reviewer` | Reviews and validates changes | Quality assurance |
| **Ask** | `@ask` | Legacy: Q&A mode | Backward compatibility |
| **Edit** | `@edit` | Legacy: Direct editing | Backward compatibility |
| **Orchestrator** | `@orchestrator` | Coordinates plans and workers | Meta-coordination |

### Custom Agents (Repo-Defined)

Repos can define their own agents via `.github/agents/` folder:

```yaml
# .github/agents/investigation/investigation.agent.md
---
name: investigation
description: Investigates issues using internal logging and monitoring
tools: ['fetch', 'search', 'runCommands']
---
You are an investigation agent for this project.

## Your Capabilities
- Query Kusto logs via `query-kusto` command
- Access Application Insights
- Analyze telemetry data

## Investigation Process
1. Always start with the error message...
```

**Note:** Custom agents like `@investigation` are workspace-specific. All their logic (which DB, business rules, etc.) must be defined in repo instructions.

### Agent Instruction Hierarchy

Instructions are loaded in order (later overrides earlier):

```
1. Global instructions    (.github/instructions/*.md)
2. Agent-specific folder  (.github/agents/{agent}/*.md)
3. Task-specific context  (from Planner/Architect output)
```

---

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER                                            │
│   "Fix bug #1234" or "@orchestrator status"                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
        ┌───────────────────┐           ┌───────────────────┐
        │  @planner         │           │  @orchestrator    │
        │  (Conversation)   │           │  (Conversation)   │
        │                   │           │                   │
        │  Creates plans    │           │  Deploys plans    │
        │  Assigns agents   │           │  Tracks progress  │
        │  Sets dependencies│           │  Handles events   │
        └───────────────────┘           └───────────────────┘
                    │                               │
                    │ saves plan                    │ reads plan
                    ▼                               ▼
        ┌─────────────────────────────────────────────────────┐
        │                    PLAN STORE                       │
        │  plan-123: Bug fix login                            │
        │  plan-456: Feature: SSO                             │
        │  plan-789: Refactor auth                            │
        └─────────────────────────────────────────────────────┘
                                    │
                                    ▼
        ┌─────────────────────────────────────────────────────┐
        │              ORCHESTRATOR ENGINE                     │
        │              (Background Service)                    │
        │                                                     │
        │  - Listens for events from all workers              │
        │  - Deploys tasks when dependencies satisfied        │
        │  - Manages worktrees per plan                       │
        │  - Notifies user of important events                │
        │  - Runs multiple plans concurrently                 │
        └─────────────────────────────────────────────────────┘
                    │
      ┌─────────────┼─────────────┬─────────────┐
      ▼             ▼             ▼             ▼
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Worker 1 │  │ Worker 2 │  │ Worker 3 │  │ Worker 4 │
│ Plan 123 │  │ Plan 123 │  │ Plan 456 │  │ Plan 456 │
│ @invest. │  │ @agent   │  │ @agent   │  │@architect│
│ Worktree │  │ Worktree │  │ Worktree │  │ Worktree │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
      │             │             │             │
      └─────────────┴─────────────┴─────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │      EVENT BUS        │
              │  task.completed       │
              │  task.needs_approval  │
              │  task.failed          │
              │  task.blocked         │
              │  worker.idle          │
              └───────────────────────┘
```

### Component Responsibilities

#### Planner Agent
- Reads repo methodology (TDD vs standard, etc.)
- Discovers available agents (built-in + custom)
- Creates workflow plan with phases
- Assigns agents to tasks
- Sets task dependencies
- Outputs structured plan JSON/YAML

#### Architect Agent
- Reads codebase structure
- Understands repo design patterns
- Plans specific file changes
- Defines test strategy (unit/integration/E2E)
- Identifies parallelization opportunities
- Outputs technical implementation plan

#### Orchestrator Engine
- Stores and manages plans
- Deploys workers when dependencies satisfied
- Creates git worktrees per worker
- Routes events between workers and UI
- Handles failure/retry logic
- Supports multiple concurrent plans

#### Workers
- Execute single tasks in isolation
- Run in separate git worktrees
- Load agent-specific instructions
- Report progress via events
- Support pause/resume/conversation

---

## Folder Structure

### Repo-Level Configuration

```
.github/
├── instructions/                    # 🌐 GLOBAL - applies to ALL agents
│   ├── coding-standards.md          # Code style, naming conventions
│   ├── testing-guidelines.md        # Test patterns, coverage requirements
│   ├── architecture-principles.md   # Design patterns, file organization
│   └── git-workflow.md              # Branch naming, commit messages
│
├── agents/
│   ├── planner/                     # 📋 Workflow Planner
│   │   ├── planner.agent.md         # Main agent definition
│   │   ├── workflow-templates.md    # Bug vs Feature vs Refactor workflows
│   │   ├── agent-capabilities.md    # What each agent can do
│   │   └── methodology.md           # TDD, BDD, or standard approach
│   │
│   ├── architect/                   # 🏗️ Technical Architect
│   │   ├── architect.agent.md       # Main agent definition
│   │   ├── design-patterns.md       # Patterns used in this repo
│   │   ├── test-strategy.md         # Unit vs Integration vs E2E decisions
│   │   └── parallelization.md       # How to identify parallel work
│   │
│   ├── coder/                       # 💻 Main Coder (Agent)
│   │   └── coder.instructions.md    # Coding-specific instructions
│   │
│   ├── reviewer/                    # 👀 Code Reviewer
│   │   ├── reviewer.agent.md        # Main agent definition
│   │   └── review-checklist.md      # What to check during review
│   │
│   └── {custom}/                    # 🔧 Custom agents (repo-specific)
│       ├── {custom}.agent.md        # Agent definition
│       └── *.md                     # Additional instructions
```

### Extension-Level Assets

```
assets/
├── agents/
│   ├── Orchestrator.agent.md        # Orchestrator agent (already exists)
│   ├── Planner.agent.md             # Default planner behavior
│   ├── Architect.agent.md           # Default architect behavior
│   └── Reviewer.agent.md            # Default reviewer behavior
```

---

## Data Models

### Plan

```typescript
interface OrchestratorPlan {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'failed';
  createdAt: number;
  createdBy: 'planner' | 'user';
  baseBranch: string;

  // Workflow phases
  tasks: PlanTask[];

  // Metadata
  metadata?: {
    sourceRequest?: string;  // Original user request
    methodology?: string;    // TDD, BDD, standard
  };
}

interface PlanTask {
  id: string;
  name: string;                    // Human-readable name (becomes branch)
  description: string;             // What to accomplish

  // Agent assignment
  agent: string;                   // '@planner', '@architect', '@agent', '@reviewer', '@custom'
  agentInstructions?: string;      // Additional context for this task

  // Dependencies
  dependencies: string[];          // Task IDs that must complete first
  parallelGroup?: string;          // Tasks in same group can run together

  // Execution hints
  priority: 'critical' | 'high' | 'normal' | 'low';
  estimatedComplexity?: 'trivial' | 'small' | 'medium' | 'large';

  // For Architect output
  targetFiles?: string[];          // Files this task will touch
  canParallelize?: boolean;        // Safe to run with other parallel tasks

  // Runtime state
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'blocked';
  workerId?: string;               // Assigned worker ID
  completedAt?: number;
  error?: string;
}
```

### Worker

```typescript
interface WorkerSession {
  id: string;
  name: string;                    // Branch name
  planId: string;
  taskId: string;

  // Agent configuration
  agent: string;
  instructions: string[];          // Loaded instruction files

  // Execution
  status: WorkerStatus;
  worktreePath: string;
  messages: WorkerMessage[];
  pendingApprovals: PendingApproval[];

  // Timestamps
  createdAt: number;
  lastActivityAt: number;
}

type WorkerStatus =
  | 'idle'              // Waiting for input
  | 'running'           // Actively processing
  | 'waiting-approval'  // Needs user approval
  | 'paused'            // Manually paused
  | 'completed'         // Task done, can be finalized
  | 'error';            // Failed
```

### Events

```typescript
type OrchestratorEvent =
  | { type: 'task.queued'; planId: string; taskId: string }
  | { type: 'task.started'; planId: string; taskId: string; workerId: string }
  | { type: 'task.completed'; planId: string; taskId: string; workerId: string }
  | { type: 'task.failed'; planId: string; taskId: string; error: string }
  | { type: 'task.blocked'; planId: string; taskId: string; reason: string }
  | { type: 'worker.needs_approval'; workerId: string; approval: PendingApproval }
  | { type: 'worker.idle'; workerId: string }
  | { type: 'plan.completed'; planId: string }
  | { type: 'plan.failed'; planId: string; error: string };
```

---

## Workflows

### User Flow: Bug Fix

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. USER → PLANNER                                               │
│    "Plan a fix for bug #1234 - login fails for enterprise"      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. PLANNER analyzes and outputs:                                │
│                                                                 │
│    Plan: fix-enterprise-login                                   │
│    Tasks:                                                       │
│    ├─ investigate (@investigation or @agent)                    │
│    ├─ root-cause (@agent) [depends: investigate]               │
│    ├─ architecture (@architect) [depends: root-cause]          │
│    ├─ implement (@agent) [depends: architecture]               │
│    ├─ test (@agent) [depends: implement]                       │
│    ├─ review (@reviewer) [depends: test]                       │
│    └─ pr (@agent) [depends: review]                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. USER reviews plan                                            │
│    "Looks good, let's go"                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. USER → ORCHESTRATOR                                          │
│    "@orchestrator deploy plan fix-enterprise-login"             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. ORCHESTRATOR executes:                                       │
│                                                                 │
│    - Creates worktree for plan                                  │
│    - Deploys 'investigate' task (no deps)                       │
│    - Waits for completion event                                 │
│    - Deploys 'root-cause' (deps satisfied)                      │
│    - ... continues through DAG                                  │
│    - User can check status anytime                              │
│    - User can interact with workers                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. ARCHITECT (when reached) outputs:                            │
│                                                                 │
│    Implementation Plan:                                         │
│    - Modify: src/auth/TokenValidator.ts                        │
│    - Modify: src/auth/EnterpriseAuth.ts                        │
│    - Add tests: src/auth/__tests__/enterprise.spec.ts          │
│                                                                 │
│    This may split 'implement' into sub-tasks                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. Completion                                                   │
│                                                                 │
│    - All tasks complete                                         │
│    - PR created                                                 │
│    - User notified                                              │
│    - Worktrees cleaned up (or kept for review)                  │
└─────────────────────────────────────────────────────────────────┘
```

### User Flow: Multiple Plans

```
USER                    PLANNER              ORCHESTRATOR
 │                        │                        │
 │──"Plan bug fix"───────►│                        │
 │◄──"Plan A ready"───────│                        │
 │                        │                        │
 │──"Plan new feature"───►│                        │
 │◄──"Plan B ready"───────│                        │
 │                        │                        │
 │──"@orchestrator deploy Plan A"─────────────────►│
 │◄────────────────"Deploying Plan A"──────────────│
 │                        │                        │
 │──"@orchestrator deploy Plan B"─────────────────►│
 │◄────────────────"Deploying Plan B"──────────────│
 │                        │                        │
 │──"@orchestrator status"────────────────────────►│
 │◄──"Plan A: 2/5 tasks, Plan B: 1/3 tasks"────────│
 │                        │                        │
 │  (User continues working while plans execute)   │
```

---

## Implementation Phases

### Phase 1: Dependencies & Event-Driven Orchestrator

**Goal:** Transform orchestrator from blocking to event-driven with dependency support.

**Changes:**

1. **Add dependencies to WorkerTask**
   ```typescript
   interface WorkerTask {
     // ... existing
     dependencies: string[];
     parallelGroup?: string;
   }
   ```

2. **Add event system**
   ```typescript
   interface IOrchestratorEngine {
     on(event: 'task.completed', handler: (task) => void): void;
     on(event: 'task.failed', handler: (task, error) => void): void;
     emit(event: OrchestratorEvent): void;
   }
   ```

3. **Implement DAG-based deployment**
   ```typescript
   private _onTaskCompleted(task: PlanTask): void {
     const readyTasks = this._getTasksWithSatisfiedDependencies(task.planId);
     for (const readyTask of readyTasks) {
       this._deployTask(readyTask);
     }
   }
   ```

4. **Support multiple concurrent plans**

**Files to modify:**
- `src/extension/orchestrator/orchestratorServiceV2.ts`
- `src/extension/orchestrator/workerSession.ts`

**Deliverables:**
- [ ] Dependencies field on tasks
- [ ] Event emitter for task lifecycle
- [ ] DAG-based task deployment
- [ ] Multiple plan support
- [ ] Dashboard shows dependencies

---

### Phase 2: Agent Instructions Hierarchy

**Goal:** Support folder-based agent definitions with instruction inheritance.

**Changes:**

1. **Create instruction loader service**
   ```typescript
   interface IAgentInstructionService {
     loadInstructions(agentId: string): Promise<string[]>;
     getGlobalInstructions(): Promise<string[]>;
     getAgentInstructions(agentId: string): Promise<string[]>;
   }
   ```

2. **Support folder structure**
   ```
   .github/instructions/     → Global (all agents)
   .github/agents/{name}/    → Agent-specific
   ```

3. **Instruction composition**
   ```typescript
   async loadInstructions(agentId: string): Promise<string[]> {
     return [
       ...await this.getGlobalInstructions(),
       ...await this.getAgentInstructions(agentId),
     ];
   }
   ```

**Files to create:**
- `src/extension/orchestrator/agentInstructionService.ts`

**Files to modify:**
- `src/extension/orchestrator/orchestratorServiceV2.ts` (use instruction service)

**Deliverables:**
- [ ] AgentInstructionService
- [ ] Global instructions loading
- [ ] Agent-specific instructions loading
- [ ] Instruction composition
- [ ] Worker receives composed instructions

---

### Phase 3: Agent Discovery Service

**Goal:** Planner can discover available agents (built-in + repo custom).

**Changes:**

1. **Create agent discovery service**
   ```typescript
   interface IAgentDiscoveryService {
     getAvailableAgents(): Promise<AgentInfo[]>;
     getAgent(name: string): Promise<AgentDefinition | undefined>;
   }

   interface AgentInfo {
     id: string;
     name: string;
     description: string;
     tools: string[];
     source: 'builtin' | 'repo';
     capabilities?: string[];
   }
   ```

2. **Discover from multiple sources**
   - Built-in: `assets/agents/*.agent.md`
   - Repo: `.github/agents/*/*.agent.md`

3. **Create discovery tool for Planner**
   ```typescript
   // Tool: list_available_agents
   // Returns list of agents Planner can assign to tasks
   ```

**Files to create:**
- `src/extension/orchestrator/agentDiscoveryService.ts`
- `src/extension/tools/orchestrator/listAgentsTool.ts`

**Deliverables:**
- [ ] AgentDiscoveryService
- [ ] Built-in agent discovery
- [ ] Repo agent discovery
- [ ] `list_available_agents` tool for Planner

---

### Phase 4: Planner Agent

**Goal:** Create Planner agent that outputs structured workflow plans.

**Changes:**

1. **Create Planner agent definition**
   ```markdown
   # assets/agents/Planner.agent.md
   ---
   name: Planner
   description: Creates high-level workflow plans
   tools: ['list_available_agents', 'search', 'fetch', ...]
   ---
   You are a workflow planner...
   ```

2. **Structured plan output format**
   ```yaml
   plan:
     name: fix-enterprise-login
     tasks:
       - id: investigate
         agent: "@agent"
         description: "..."
       - id: architect
         agent: "@architect"
         dependencies: [investigate]
   ```

3. **Create plan parsing/validation**

4. **Add `save_plan` tool**

**Files to create:**
- `assets/agents/Planner.agent.md`
- `src/extension/tools/orchestrator/savePlanTool.ts`

**Files to modify:**
- `src/extension/orchestrator/orchestratorServiceV2.ts` (plan import)

**Deliverables:**
- [ ] Planner.agent.md with workflow templates
- [ ] Structured plan output format
- [ ] Plan validation
- [ ] `save_plan` tool
- [ ] Plan import into orchestrator

---

### Phase 5: Architect Agent

**Goal:** Create Architect agent for technical implementation planning.

**Changes:**

1. **Create Architect agent definition**
   ```markdown
   # assets/agents/Architect.agent.md
   ---
   name: Architect
   description: Designs technical implementation
   tools: ['search', 'usages', 'read_file', ...]
   ---
   You are a technical architect...
   ```

2. **Structured output format**
   ```yaml
   implementation:
     files_to_modify:
       - path: src/auth/TokenValidator.ts
         changes: "Add null check..."
     files_to_create:
       - path: src/auth/__tests__/token.spec.ts
     test_strategy:
       unit: [...]
       integration: [...]
     parallelization:
       - group: auth-core
         files: [src/auth/TokenValidator.ts]
       - group: auth-enterprise
         files: [src/auth/EnterpriseAuth.ts]
   ```

3. **Optional: Auto-split into sub-tasks based on parallelization**

**Files to create:**
- `assets/agents/Architect.agent.md`

**Deliverables:**
- [ ] Architect.agent.md
- [ ] Implementation plan output format
- [ ] Target files specification
- [ ] Parallelization hints

---

### Phase 6: Reviewer Agent

**Goal:** Create Reviewer agent for code review.

**Changes:**

1. **Create Reviewer agent definition**
   ```markdown
   # assets/agents/Reviewer.agent.md
   ---
   name: Reviewer
   description: Reviews code changes
   tools: ['changes', 'search', 'problems', ...]
   ---
   You are a code reviewer...
   ```

2. **Review output format**
   ```yaml
   review:
     status: approved | changes_requested | needs_discussion
     comments:
       - file: src/auth/TokenValidator.ts
         line: 45
         comment: "Consider adding error logging here"
     summary: "..."
   ```

**Files to create:**
- `assets/agents/Reviewer.agent.md`

**Deliverables:**
- [ ] Reviewer.agent.md
- [ ] Review output format
- [ ] Integration with PR workflow

---

### Phase 7: Smart Parallelization

**Goal:** Execute independent tasks in parallel safely.

**Changes:**

1. **File overlap detection**
   ```typescript
   function canRunInParallel(taskA: PlanTask, taskB: PlanTask): boolean {
     if (!taskA.targetFiles || !taskB.targetFiles) return false;
     const overlap = taskA.targetFiles.some(f =>
       taskB.targetFiles?.includes(f)
     );
     return !overlap;
   }
   ```

2. **Parallel group handling**
   - Tasks in same `parallelGroup` AND no file overlap → run together
   - Each gets own branch from plan base
   - Merge to plan's integration branch on completion

3. **Conflict resolution**
   - Auto-merge if possible
   - Notify user on conflicts
   - Option for AI-assisted resolution

**Files to modify:**
- `src/extension/orchestrator/orchestratorServiceV2.ts`

**Deliverables:**
- [ ] File overlap detection
- [ ] Parallel deployment logic
- [ ] Branch-per-parallel-task
- [ ] Merge strategy
- [ ] Conflict notification

---

### Phase 8: Dashboard Enhancements

**Goal:** Visualize plans, dependencies, and parallel execution.

**Changes:**

1. **Plan view**
   - Show all plans with status
   - Expand to see tasks
   - Show dependency graph

2. **Task status**
   - Pending (gray)
   - Queued (blue)
   - Running (animated)
   - Completed (green)
   - Failed (red)
   - Blocked (yellow)

3. **Dependency visualization**
   - Lines connecting dependent tasks
   - Highlight critical path

**Files to modify:**
- `src/extension/orchestrator/dashboard/WorkerDashboardV2.ts`

**Deliverables:**
- [ ] Plan list view
- [ ] Task dependency visualization
- [ ] Status indicators
- [ ] Critical path highlighting

---

## Open Questions

### Resolved

1. **Agent discovery** → Built-in + repo custom agents via discovery service
2. **Plan approval** → Explicit user approval before deployment
3. **Architect invocation** → Explicit task from Planner
4. **Parallel scope** → Start with non-overlapping files, Architect determines
5. **Instructions hierarchy** → Global + agent-specific folders

### Still Open

1. **Plan storage location**
   - Option A: In-memory only (current session)
   - Option B: Workspace state (`.copilot-orchestrator-state.json`)
   - Option C: Exportable `.plan.md` files
   - **Recommendation:** B + C (persist + exportable)

2. **Worker-to-worker communication**
   - Option A: Always through orchestrator
   - Option B: Direct communication allowed
   - **Recommendation:** A (simpler, auditable)

3. **Failure handling**
   - If task fails, what happens to dependents?
   - Option A: Block all dependents
   - Option B: Allow user to skip/retry
   - Option C: Re-plan from failure point
   - **Recommendation:** A + B (block + user override)

4. **Merge strategy for parallel work**
   - Option A: Sequential merge (first completes, second rebases)
   - Option B: Integration branch (all merge to shared branch)
   - Option C: User decides per-plan
   - **Recommendation:** B for default, C as option

---

## Success Criteria

### Phase 1 Complete When:
- [ ] Tasks can have dependencies
- [ ] Orchestrator deploys based on DAG
- [ ] Multiple plans can run concurrently
- [ ] Events flow properly

### Phase 2 Complete When:
- [ ] Instructions loaded from folders
- [ ] Global + agent-specific composition works
- [ ] Workers receive correct instructions

### Phase 3 Complete When:
- [ ] All agents discoverable
- [ ] Planner can list agents
- [ ] Agent capabilities exposed

### Phase 4 Complete When:
- [ ] Planner creates valid plans
- [ ] Plans importable to orchestrator
- [ ] User can review/approve plans

### Phase 5 Complete When:
- [ ] Architect outputs implementation plans
- [ ] Parallelization hints provided
- [ ] Test strategy included

### Full System Complete When:
- [ ] End-to-end: User request → Plan → Execute → PR
- [ ] Multiple plans concurrent
- [ ] Parallel task execution working
- [ ] Dashboard shows everything

---

## Appendix

### Example: Full Bug Fix Flow

```
USER: @planner Fix bug #1234 - enterprise login fails

PLANNER: I'll create a workflow plan for this bug fix.

[Discovers agents: @agent, @architect, @reviewer, @investigation (custom)]
[Reads repo methodology: standard (not TDD)]

Here's the plan:

## Plan: fix-enterprise-login-1234

### Tasks
1. **investigate** (@investigation) - Query logs, gather error details
2. **root-cause** (@agent) - Analyze findings, identify cause [after: investigate]
3. **architecture** (@architect) - Design fix approach [after: root-cause]
4. **implement** (@agent) - Write the fix [after: architecture]
5. **test** (@agent) - Add/update tests [after: implement]
6. **review** (@reviewer) - Code review [after: test]
7. **pr** (@agent) - Create pull request [after: review]

Shall I save this plan?

USER: Yes, save it

PLANNER: Plan saved as "fix-enterprise-login-1234"

USER: @orchestrator deploy fix-enterprise-login-1234

ORCHESTRATOR: Deploying plan "fix-enterprise-login-1234"
- Creating worktree from main
- Starting task: investigate (@investigation)

[Worker runs investigation task...]

ORCHESTRATOR: Task "investigate" completed
- Starting task: root-cause (@agent)

[... continues through DAG ...]

ORCHESTRATOR: 🎉 Plan "fix-enterprise-login-1234" completed!
- PR #567 created: "Fix enterprise login issue #1234"
- All 7 tasks successful
- Worktree cleaned up
```

---

*End of Architecture Document*
