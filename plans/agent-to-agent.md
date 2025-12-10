# Agent-to-Agent (A2A) Communication Framework

> **Status:** Planning
> **Last Updated:** December 10, 2025
> **Authors:** Copilot + User

---

## Table of Contents

1. [Overview](#overview)
2. [Problem Statement / Motivation](#problem-statement--motivation)
3. [Proposed Solution](#proposed-solution)
4. [Technical Considerations](#technical-considerations)
5. [Acceptance Criteria](#acceptance-criteria)
6. [Success Metrics](#success-metrics)
7. [Dependencies & Risks](#dependencies--risks)
8. [Architecture](#architecture)
9. [Key Data Models](#key-data-models)
10. [Implementation Phases](#implementation-phases)
11. [File Reference](#file-reference)

---

## Overview

The Agent-to-Agent (A2A) Communication Framework enables specialized AI agents to collaborate, delegate tasks, spawn parallel sub-tasks, and coordinate through a central Orchestrator that acts as a "shift manager" for all worker agents.

**Key Capabilities:**
- **Sub-Task Spawning**: Parent agents can spawn parallel child tasks without losing context
- **Agent Awareness**: Agents know their strengths, weaknesses, and when to delegate
- **Central Orchestration**: Orchestrator supervises all workers with configurable permissions
- **Model Flexibility**: Agents and Orchestrator can change AI models based on task needs
- **Permission Hierarchy**: Configurable auto-approve, ask-user, and auto-deny policies

---

## Problem Statement / Motivation

### Current Limitations

1. **Isolated Agents**: Each agent operates independently without knowledge of other agents' capabilities
2. **No Delegation**: When an agent encounters work outside its expertise, it cannot request help from a more suitable agent
3. **Static Model Assignment**: Agents cannot optimize model selection based on task requirements
4. **User Bottleneck**: All coordination flows through user intervention, even for automatable decisions
5. **Orchestrator Passivity**: Current orchestrator deploys tasks but doesn't actively manage worker interactions
6. **Context Loss**: Handing off work to another agent loses conversation context

### Business Value

| Benefit | Description |
|---------|-------------|
| **Improved Task Quality** | Right agent for each sub-task |
| **Reduced User Interruptions** | Autonomous coordination for routine decisions |
| **Better Model Utilization** | Match model strengths to task requirements |
| **Faster Completion** | Parallel sub-task execution without user wait states |
| **Full Context Preservation** | Parent agent maintains complete conversation history |

---

## Proposed Solution

### Core Concepts

#### Sub-Task Spawning (Not Handoff)

Instead of "handing off" context (which loses continuity), the **parent agent spawns child sub-tasks** that run in parallel and return results. The parent maintains full context throughout.

```
Parent Agent (Architect)
├── spawn: Backend Architecture (Claude) ──────┐
├── spawn: Frontend Architecture (GPT-4) ──────┼── Run in parallel, same worktree
├── spawn: DB Schema Design (Claude) ──────────┘
└── await all → Receive results → Continue with full context
```

**Key benefits:**
- Parent agent maintains **full context** throughout
- Sub-tasks are **scoped** - they know they're advisory, not driving
- Parallel execution without user confusion
- No context loss from model/conversation switching

#### Permission Inheritance Model

Sub-tasks inherit parent's permission level by default:
- If sub-task needs elevated permission → bubble up to parent
- Parent decides: auto-approve (within its permissions) or escalate to Orchestrator
- Orchestrator decides: auto-approve, ask user, or auto-deny (per configuration)

#### Orchestrator as Shift Manager

The Orchestrator becomes an active supervisor:
- Receives ALL status updates from workers (with full context: plan, task, worktree)
- Makes decisions based on configurable permission matrix
- Can reassign agents, change models, reinitialize stuck workers
- Controls PR creation and branch merging
- Supports multiple concurrent plans (future-ready)

---

## Technical Considerations

### Architecture Impacts

- New `IAgentRegistryService` for layered agent capability configuration
- New `SubTaskManager` for parallel sub-task lifecycle management
- Extended `IOrchestratorService` with async queue and permission checking
- New A2A tools in `orchestratorTools.ts` for spawning and communication
- Enhanced `WorkerSession` with sub-task spawning and result aggregation

### Performance Implications

- Async queue adds ~10-50ms per message hop
- Parallel sub-tasks utilize existing worktree (no additional git overhead)
- Sub-task depth limits prevent runaway resource consumption
- Queue persistence survives extension reload

### Security Considerations

- Sub-task depth limits (max 2 by default) prevent infinite loops
- Permission inheritance prevents privilege escalation
- Audit logging for all A2A operations
- Rate limiting on sub-task spawning

---

## Acceptance Criteria

### Agent Registry & Discovery
- [ ] Agents can discover available agents and their capabilities via `a2a_list_agents` tool
- [ ] Default agent capabilities defined in extension assets
- [ ] Users can override capabilities at workspace level (`.github/agents/`)
- [ ] Users can override capabilities at user level (VS Code settings)

### Sub-Task Spawning
- [ ] Parent agent can spawn sub-tasks using `a2a_spawn_subtask` tool
- [ ] Parent agent can spawn multiple parallel sub-tasks using `a2a_spawn_parallel_subtasks` tool
- [ ] Sub-tasks run in same worktree as parent (shared files)
- [ ] Sub-tasks return structured results to parent via `a2a_subtask_complete` tool
- [ ] Parent receives aggregated results and continues with full context
- [ ] Sub-task depth is tracked and limited (max 2 levels by default)

### Permission System
- [ ] Sub-tasks inherit parent's permission level
- [ ] Permission requests bubble up: SubTask → Parent → Orchestrator → User
- [ ] Orchestrator permission matrix is configurable (auto_approve, ask_user, auto_deny)
- [ ] Users can define permissions in `.github/agents/orchestrator/permissions.md`
- [ ] Users can override permissions in VS Code settings

### Orchestrator Communication
- [ ] All worker messages include full context (planId, taskId, workerId, worktreePath)
- [ ] Workers can notify orchestrator of status, questions, and completion
- [ ] Orchestrator can respond to workers or escalate to user
- [ ] Async priority queue processes messages (permission_request > completion > status)
- [ ] Queue survives extension reload

### Agent/Model Management
- [ ] Orchestrator can reassign agent type on a worker
- [ ] Orchestrator can change model for a worker
- [ ] Orchestrator can reinitialize stuck workers with new instructions
- [ ] Orchestrator can redirect workers without full reset
- [ ] Orchestrator controls PR creation and branch merging (per permissions)

### Safety & Limits
- [ ] Sub-task depth limit enforced (default: 2)
- [ ] Cycle detection prevents infinite sub-task chains
- [ ] Rate limiting prevents sub-task spam
- [ ] Circuit breaker pauses workers after N consecutive failures
- [ ] Emergency stop kills all sub-tasks

### Audit & Visibility
- [ ] All A2A operations logged with full context
- [ ] Sub-task tree visualization in Worker Dashboard
- [ ] Orchestrator inbox shows pending decisions
- [ ] Queue visualization grouped by plan/task

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Sub-task spawn latency | < 100ms |
| Successful sub-task completions | > 95% |
| User intervention reduction | > 50% (for routine decisions) |
| Orchestrator queue throughput | > 100 messages/sec |
| Parent context preservation | 100% (no context loss) |

---

## Dependencies & Risks

### Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| Existing orchestrator service | ✅ Available | `orchestratorServiceV2.ts` |
| Worker session infrastructure | ✅ Available | `workerSession.ts` |
| Agent runner | ✅ Available | `agentRunner.ts` |
| VS Code Chat Sessions API | ✅ Available | For sub-task execution |
| Language Model API | ✅ Available | For model switching |

### Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Orchestrator bottleneck | High | Medium | Async queue with prioritization |
| Infinite sub-task loops | High | Low | Depth limit (2) + cycle detection |
| Model context loss on switch | Medium | Medium | Pass summary, not full history |
| Race conditions in shared worktree | Medium | Medium | File-level coordination in sub-tasks |
| Runaway costs from sub-tasks | High | Low | Rate limits + depth limits + cost tracking |

---

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR (Main Thread - Singleton)                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Permission Matrix (from .github/agents/orchestrator/permissions.md) │    │
│  │  ┌─────────────┬─────────────┬─────────────┐                        │    │
│  │  │ Auto-Approve│ Ask User    │ Auto-Deny   │                        │    │
│  │  └─────────────┴─────────────┴─────────────┘                        │    │
│  │  • Receives ALL worker status updates (with full context)           │    │
│  │  • Can approve sub-task spawning                                     │    │
│  │  • Can reassign agents / change models                               │    │
│  │  • Can reinitialize/redirect stuck workers                           │    │
│  │  • Controls PR creation / branch merging                             │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                    ▲                                    │
                    │ Async Queue (with full context)    │ Commands/Responses
                    │                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      ASYNC MESSAGE QUEUE (Priority-Based)                    │
│  Priority: permission_request > completion > question > status_update        │
│  Each message includes: planId, taskId, workerId, worktreePath, depth       │
└─────────────────────────────────────────────────────────────────────────────┘
                    ▲
                    │
┌─────────────────────────────────────────────────────────────────────────────┐
│                     WORKER (Main Agent - Full Context Owner)                 │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  @architect (or @agent, @reviewer, etc.)                            │    │
│  │  • Has FULL conversation context                                     │    │
│  │  • Can spawn sub-tasks (parallel, same worktree)                    │    │
│  │  • Receives all sub-task results                                     │    │
│  │  • Decides when work is complete                                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│       │                                                                      │
│       │  a2a_spawn_parallel_subtasks([                                      │
│       │    { agent: "@architect", prompt: "Backend API design" },           │
│       │    { agent: "@architect", prompt: "Frontend integration" },         │
│       │    { agent: "@architect", prompt: "DB schema design" }              │
│       │  ])                                                                  │
│       │                                                                      │
│       ├── SubTask 1: Backend Architecture ──────┐                           │
│       ├── SubTask 2: Frontend Integration ──────┼── Parallel Execution      │
│       └── SubTask 3: DB Schema Design ──────────┘                           │
│                          │                                                   │
│                          ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  SUB-TASKS (Advisory - Return Results to Parent)                     │    │
│  │  • Run in same worktree (can access same files)                      │    │
│  │  • Inherit parent's permission level                                 │    │
│  │  • Depth limit: max 2 levels (configurable)                          │    │
│  │  • Permission requests bubble up: SubTask → Parent → Orchestrator    │    │
│  │  • Return structured results via a2a_subtask_complete                │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                          │                                                   │
│                          ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  RESULT AGGREGATION                                                  │    │
│  │  • Collect results from all parallel sub-tasks                       │    │
│  │  • Handle partial results (some succeed, some fail)                  │    │
│  │  • Inject aggregated results into parent's context                   │    │
│  │  • Parent continues with full context + sub-task insights            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Permission Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PERMISSION BUBBLING FLOW                              │
└─────────────────────────────────────────────────────────────────────────────┘

Sub-Task needs permission (e.g., edit file outside scope)
                │
                ▼
┌───────────────────────────────┐
│  Check: Within inherited      │
│  permission level?            │
└───────────────┬───────────────┘
                │
        ┌───────┴───────┐
        │               │
       YES              NO
        │               │
        ▼               ▼
   ✅ Proceed    ┌───────────────────────────────┐
                 │  Bubble to Parent Agent       │
                 └───────────────┬───────────────┘
                                 │
                         ┌───────┴───────┐
                         │               │
                   Parent can        Parent cannot
                   approve           approve
                         │               │
                         ▼               ▼
                    ✅ Proceed    ┌───────────────────────────────┐
                                  │  Bubble to Orchestrator       │
                                  └───────────────┬───────────────┘
                                                  │
                                          ┌───────┴───────┐
                                          │               │
                                    Auto-approve     Ask User / Auto-deny
                                    (per config)     (per config)
                                          │               │
                                          ▼               ▼
                                     ✅ Proceed    ┌─────────────────┐
                                                   │ User decides or │
                                                   │ Request denied  │
                                                   └─────────────────┘
```

### Agent Capability Registry Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LAYERED CONFIGURATION (Lower overrides Higher)            │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  Level 1: Extension Defaults (assets/agents/registry.json)                  │
│  • Built-in agent definitions: @architect, @reviewer, @agent, etc.          │
│  • Default capabilities, strengths, weaknesses                              │
│  • Default model preferences                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ can be overridden by
┌─────────────────────────────────────────────────────────────────────────────┐
│  Level 2: Workspace Configuration (.github/agents/)                         │
│  • Repo-specific agent definitions                                          │
│  • Custom agents for this project                                           │
│  • Override model preferences ("Claude for backend, GPT-4 for frontend")   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ can be overridden by
┌─────────────────────────────────────────────────────────────────────────────┐
│  Level 3: User Settings (VS Code settings.json or prompts/)                 │
│  • Personal preferences across all workspaces                               │
│  • Per-user model preferences                                               │
│  • Custom capability overrides                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Data Models

### Sub-Task Definition

```typescript
/**
 * Represents a sub-task spawned by a parent agent
 */
interface ISubTask {
  /** Unique identifier for this sub-task */
  id: string;

  /** ID of the worker that spawned this sub-task */
  parentWorkerId: string;

  /** Task ID from the orchestrator plan */
  parentTaskId: string;

  /** Plan ID this sub-task belongs to */
  planId: string;

  /** Path to worktree (same as parent - shared) */
  worktreePath: string;

  /** Agent type to execute this sub-task */
  agentType: string;  // "@architect", "@reviewer", "@agent", etc.

  /** The prompt/instruction for the sub-task */
  prompt: string;

  /** Description of expected output format */
  expectedOutput: string;

  /** Optional: specific model to use */
  model?: string;

  /** Nesting depth: 0 = main worker, 1 = sub-task, 2 = sub-sub-task */
  depth: number;

  /** Current status */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

  /** Result when completed */
  result?: ISubTaskResult;

  /** Timestamp when created */
  createdAt: number;

  /** Timestamp when completed/failed */
  completedAt?: number;
}
```

### Sub-Task Result

```typescript
/**
 * Result returned by a completed sub-task
 */
interface ISubTaskResult {
  /** ID of the sub-task this result belongs to */
  taskId: string;

  /** Completion status */
  status: 'success' | 'partial' | 'failed';

  /** Text response from the sub-task */
  output: string;

  /** Optional: reference to output file (e.g., .md plan) */
  outputFile?: string;

  /** Optional: structured data */
  metadata?: Record<string, unknown>;

  /** Permissions that were requested during execution */
  permissionsRequested?: IPermissionRequest[];

  /** Error message if failed */
  error?: string;
}
```

### Orchestrator Queue Message

```typescript
/**
 * Message sent to the orchestrator queue
 * Includes full context for multi-feature support
 */
interface IOrchestratorQueueMessage {
  /** Unique message ID */
  id: string;

  /** When the message was created */
  timestamp: number;

  /** Priority for queue ordering */
  priority: 'critical' | 'high' | 'normal' | 'low';

  // ===== Full Context (required for multi-feature orchestration) =====

  /** Plan this message relates to */
  planId: string;

  /** Task within the plan */
  taskId: string;

  /** Worker that sent this message */
  workerId: string;

  /** Worktree path for this worker */
  worktreePath: string;

  // ===== Sub-Task Context (if applicable) =====

  /** If from a sub-task, the parent agent's ID */
  parentAgentId?: string;

  /** Sub-task ID if this is from a sub-task */
  subTaskId?: string;

  /** Nesting depth */
  depth?: number;

  // ===== Message Content =====

  /** Type of message */
  type: 'status_update' | 'permission_request' | 'question' | 'completion' | 'error';

  /** Message payload (varies by type) */
  content: unknown;
}
```

### Permission Configuration

```typescript
/**
 * Orchestrator permission configuration
 * Loaded from .github/agents/orchestrator/permissions.md or defaults
 */
interface IOrchestratorPermissions {
  /** Actions that orchestrator can approve automatically */
  auto_approve: string[];
  // Examples: ['file_edits_in_worktree', 'subtask_spawning', 'agent_reassignment']

  /** Actions that require user confirmation */
  ask_user: string[];
  // Examples: ['pr_creation', 'branch_merge', 'expensive_model_switch']

  /** Actions that are automatically denied */
  auto_deny: string[];
  // Examples: ['edits_outside_worktree', 'delete_files_in_main_workspace']

  /** Numerical limits */
  limits: {
    /** Maximum sub-task nesting depth (default: 2) */
    max_subtask_depth: number;

    /** Maximum total sub-tasks per worker (default: 10) */
    max_subtasks_per_worker: number;

    /** Maximum parallel sub-tasks at once (default: 5) */
    max_parallel_subtasks: number;

    /** Rate limit: max sub-task spawns per minute (default: 20) */
    subtask_spawn_rate_limit: number;
  };
}
```

### Agent Capability Definition

```typescript
/**
 * Agent capability metadata for registry
 */
interface IAgentCapability {
  /** Agent identifier (e.g., "architect", "reviewer") */
  id: string;

  /** Display name */
  name: string;

  /** What this agent does */
  description: string;

  /** What this agent is good at */
  strengths: string[];
  // Example: ["System design", "API architecture", "Breaking down complex tasks"]

  /** What this agent is not good at */
  weaknesses: string[];
  // Example: ["Detailed implementation", "Writing tests"]

  /** Recommended models for this agent type */
  preferredModels?: {
    /** Model to use by default */
    default: string;
    /** Model to use for specific task types */
    byTaskType?: Record<string, string>;
  };

  /** Whether this agent can spawn sub-tasks */
  canSpawnSubTasks: boolean;

  /** Maximum depth this agent can spawn to */
  maxSubTaskDepth?: number;

  /** Tools this agent has access to */
  tools: string[];

  /** Source of this definition */
  source: 'builtin' | 'workspace' | 'user';
}
```

---

## Implementation Phases

### Phase 1: Agent Registry & Capability Discovery
**Objective**: Create registry with defaults that users can override at workspace and user levels.

**Tasks**:
1. [ ] Create `IAgentRegistryService` interface with layered configuration (extension → workspace → user)
2. [ ] Define default agent capabilities in `assets/agents/registry.json` (Architect, Reviewer, Agent, etc.)
3. [ ] Extend `.agent.md` frontmatter: `strengths`, `weaknesses`, `preferredModels`, `canSpawnSubTasks`
4. [ ] Implement workspace override loading from `.github/agents/registry-overrides.md`
5. [ ] Implement user override loading from VS Code settings (`copilot.agents.capabilities`)
6. [ ] Create `a2a_list_agents` tool returning merged capabilities
7. [ ] Add agent context injection into system prompts
8. [ ] Write unit tests for layered configuration merging

**Depends on**: None
**Estimated Time**: 3-4 days
**Success Criteria**: Agent capabilities resolve correctly with user overrides taking precedence

---

### Phase 2: Sub-Task Spawning Infrastructure
**Objective**: Enable parent agents to spawn parallel sub-tasks that return results without losing parent context.

**Tasks**:
1. [ ] Create `ISubTask` interface: `{ id, parentWorkerId, agentType, prompt, expectedOutput, model?, depth }`
2. [ ] Create `ISubTaskResult` interface: `{ taskId, status, output, outputFile?, metadata }`
3. [ ] Implement `SubTaskManager` service in orchestrator
4. [ ] Create `a2a_spawn_subtask` tool with parameters: `agentType`, `prompt`, `expectedOutput`, `model?`
5. [ ] Create `a2a_spawn_parallel_subtasks` tool for batch spawning (array of sub-tasks)
6. [ ] Implement sub-task execution using existing `AgentRunner` with scoped context
7. [ ] Add depth tracking (max depth = 2 by default, configurable)
8. [ ] Implement sub-task result aggregation and return to parent
9. [ ] Add `await_subtasks` mechanism for parent to wait for completion
10. [ ] Write integration tests for sub-task spawning and result collection

**Depends on**: Phase 1
**Estimated Time**: 5-6 days
**Success Criteria**: Parent agent spawns 3 sub-tasks, they run in parallel, parent receives all results and continues

---

### Phase 3: Sub-Task Permission Inheritance & Bubbling
**Objective**: Handle permission requests from sub-tasks without interrupting parent flow.

**Tasks**:
1. [ ] Define permission inheritance model: sub-task inherits parent's permission level
2. [ ] Create `IPermissionRequest` interface with escalation path
3. [ ] Implement permission bubbling: SubTask → Parent → Orchestrator → User (if needed)
4. [ ] Add `auto_approve_for_subtasks` configuration option
5. [ ] Create sub-task permission queue (parent can batch-approve)
6. [ ] Implement timeout with default action for unhandled permissions
7. [ ] Add UI indicator when sub-task is waiting for permission
8. [ ] Write tests for permission escalation scenarios

**Depends on**: Phase 2
**Estimated Time**: 4-5 days
**Success Criteria**: Sub-task needing permission bubbles to parent, parent auto-approves or escalates to orchestrator

---

### Phase 4: Orchestrator Async Queue with Full Context
**Objective**: Build prioritized async queue that includes full context (plan, task, worktree) for multi-feature support.

**Tasks**:
1. [ ] Define `OrchestratorQueueMessage` with mandatory: `planId`, `taskId`, `workerId`, `worktreePath`
2. [ ] Add optional: `parentAgentId`, `subTaskId`, `depth` for sub-task context
3. [ ] Implement `PriorityQueue<OrchestratorQueueMessage>` with configurable priorities
4. [ ] Create `OrchestratorQueueService` with pub/sub pattern
5. [ ] Add message persistence (survive reload) using workspace state
6. [ ] Implement deduplication (same message from retry doesn't queue twice)
7. [ ] Add queue metrics: depth, processing time, wait time
8. [ ] Create queue visualization in dashboard (grouped by plan/task)
9. [ ] Write performance tests for queue throughput

**Depends on**: Phase 1
**Estimated Time**: 4-5 days
**Success Criteria**: Queue processes messages in priority order, survives reload, shows full context

---

### Phase 5: Orchestrator Permission Configuration
**Objective**: Implement configurable permission matrix that users can customize.

**Tasks**:
1. [ ] Define permission schema for `.github/agents/orchestrator/permissions.md`
2. [ ] Create default permissions in `assets/agents/orchestrator-permissions.json`
3. [ ] Implement `IOrchestratorPermissionService` with three tiers: auto_approve, ask_user, auto_deny
4. [ ] Add permission categories: `file_operations`, `spawning`, `model_changes`, `git_operations`, `pr_operations`
5. [ ] Implement permission evaluation: check matrix → return decision
6. [ ] Create `orchestrator_check_permission` internal method
7. [ ] Add permission override via VS Code settings
8. [ ] Create permission editor UI (optional, can be file-based initially)
9. [ ] Write tests for permission evaluation

**Depends on**: Phase 4
**Estimated Time**: 4-5 days
**Success Criteria**: Orchestrator auto-approves/denies/escalates based on configured permissions

---

### Phase 6: Sub-Task Completion & Result Aggregation
**Objective**: Enable sub-tasks to return structured results that parent agent can use.

**Tasks**:
1. [ ] Implement `a2a_subtask_complete` tool for sub-tasks to signal completion
2. [ ] Support multiple output types: text, file reference (`.md`), structured JSON
3. [ ] Create `SubTaskResultAggregator` to collect parallel results
4. [ ] Implement result injection into parent agent's context
5. [ ] Add partial result handling (some succeed, some fail)
6. [ ] Create timeout handling with partial results return
7. [ ] Add result caching (parent can re-query sub-task results)
8. [ ] Write tests for various completion scenarios

**Depends on**: Phase 2, Phase 3
**Estimated Time**: 3-4 days
**Success Criteria**: 3 parallel sub-tasks complete, parent receives aggregated results, continues with full context

---

### Phase 7: Orchestrator-Worker Communication
**Objective**: Enable orchestrator to communicate with workers and workers to report status.

**Tasks**:
1. [ ] Implement `a2a_notify_orchestrator` tool (status, question, completion)
2. [ ] Enhance orchestrator's `sendMessage` to support conversation threads
3. [ ] Create `OrchestratorInbox` for pending messages requiring action
4. [ ] Implement orchestrator auto-response based on permissions
5. [ ] Add conversation history between orchestrator and specific worker
6. [ ] Create notification system (badge in UI) for pending orchestrator actions
7. [ ] Write tests for orchestrator-worker conversation

**Depends on**: Phase 4, Phase 5
**Estimated Time**: 4-5 days
**Success Criteria**: Worker sends question to orchestrator, orchestrator responds or escalates to user

---

### Phase 8: Agent Reassignment & Model Switching
**Objective**: Allow orchestrator to change agent type or model on a worker.

**Tasks**:
1. [ ] Implement `orchestrator_reassign_agent` tool (change @agent to @reviewer, etc.)
2. [ ] Implement `orchestrator_change_model` tool (switch from GPT-4 to Claude)
3. [ ] Create agent hot-swap in WorkerSession (preserve context, change system prompt)
4. [ ] Create model hot-swap in AgentRunner (summarize context if needed for smaller context window)
5. [ ] Add permission check for model changes (expensive models may require approval)
6. [ ] Create UI indicator when agent/model changes
7. [ ] Write tests for reassignment scenarios

**Depends on**: Phase 5, Phase 7
**Estimated Time**: 4-5 days
**Success Criteria**: Orchestrator changes worker from @agent to @reviewer mid-task, work continues

---

### Phase 9: Worker Reinitialization & Redirection
**Objective**: Allow orchestrator to restart or redirect stuck workers.

**Tasks**:
1. [ ] Implement `orchestrator_reinitialize_worker` (fresh start with new instructions)
2. [ ] Implement `orchestrator_redirect_worker` (inject new context without full reset)
3. [ ] Create `WorkerHealthMonitor` to detect stuck/looping workers
4. [ ] Implement circuit breaker: auto-pause after N consecutive failures
5. [ ] Add heuristics for "off-track" detection
6. [ ] Create recovery templates for common stuck scenarios
7. [ ] Add manual reinitialize/redirect buttons in dashboard
8. [ ] Write tests for recovery scenarios

**Depends on**: Phase 7, Phase 8
**Estimated Time**: 4-5 days
**Success Criteria**: Stuck worker is detected, orchestrator redirects, worker recovers

---

### Phase 10: Completion, PR, and Merge Management
**Objective**: Orchestrator manages final completion workflow based on permissions.

**Tasks**:
1. [ ] Enhance worker completion notification with summary of changes
2. [ ] Implement orchestrator completion approval workflow
3. [ ] Add completion options: `approve_and_merge`, `create_pr`, `request_changes`, `send_to_reviewer`
4. [ ] Implement PR creation with auto-generated description
5. [ ] Add merge conflict detection and handling UI
6. [ ] Create completion templates for different scenarios
7. [ ] Implement worktree cleanup after successful merge
8. [ ] Check permissions before PR/merge operations
9. [ ] Write end-to-end completion tests

**Depends on**: Phase 7
**Estimated Time**: 4-5 days
**Success Criteria**: Worker completes → Orchestrator approves (per permissions) → PR created or merged

---

### Phase 11: Depth Limits & Safety
**Objective**: Prevent infinite loops, runaway costs, and system abuse.

**Tasks**:
1. [ ] Implement sub-task depth tracking (max 2 by default)
2. [ ] Add cycle detection for sub-task chains
3. [ ] Implement rate limiting: max N sub-tasks per worker per minute
4. [ ] Add total sub-task limit per worker (e.g., max 10 total)
5. [ ] Create cost tracking for spawned sub-tasks
6. [ ] Implement emergency stop (kill all sub-tasks)
7. [ ] Add configurable limits in settings
8. [ ] Write stress tests for limit enforcement

**Depends on**: Phase 2
**Estimated Time**: 3-4 days
**Success Criteria**: Attempts to exceed depth/count limits are blocked with clear error

---

### Phase 12: UI Enhancements & Audit Trail
**Objective**: Visualize sub-task spawning, orchestrator queue, and provide audit trail.

**Tasks**:
1. [ ] Add sub-task tree visualization in Worker Dashboard
2. [ ] Create orchestrator inbox panel for pending decisions
3. [ ] Implement queue visualization (grouped by plan/task)
4. [ ] Add audit log for all A2A operations
5. [ ] Create "Agent Network" view showing parent-child relationships
6. [ ] Add real-time badges for pending items
7. [ ] Implement export (JSON/Markdown) for debugging
8. [ ] Write UI tests

**Depends on**: Phase 4, Phase 6, Phase 7
**Estimated Time**: 4-5 days
**Success Criteria**: User can see sub-task tree, pending orchestrator items, and full audit history

---

### Phase 13: User Customization & Configuration
**Objective**: Enable users to configure agent capabilities, model preferences, and permissions.

**Tasks**:
1. [ ] Create configuration schema documentation
2. [ ] Implement `.github/agents/` workspace configuration loading
3. [ ] Add VS Code settings for A2A options
4. [ ] Create "Model Preferences" configuration (which model for which task type)
5. [ ] Implement instruction injection for custom preferences
6. [ ] Create configuration templates for common setups
7. [ ] Add configuration validation with helpful errors
8. [ ] Write tests for configuration loading

**Depends on**: Phase 1, Phase 5
**Estimated Time**: 3-4 days
**Success Criteria**: User's custom agent definitions and model preferences are respected

---

## Summary Timeline

| Phase | Name | Duration | Dependencies | Can Parallelize With |
|-------|------|----------|--------------|---------------------|
| 1 | Agent Registry | 3-4 days | None | - |
| 2 | Sub-Task Spawning | 5-6 days | Phase 1 | Phase 4 |
| 3 | Permission Inheritance | 4-5 days | Phase 2 | - |
| 4 | Async Queue | 4-5 days | Phase 1 | Phase 2 |
| 5 | Permission Config | 4-5 days | Phase 4 | Phase 6 |
| 6 | Result Aggregation | 3-4 days | Phase 2, 3 | Phase 5 |
| 7 | Orchestrator Comms | 4-5 days | Phase 4, 5 | - |
| 8 | Agent/Model Switching | 4-5 days | Phase 5, 7 | Phase 9 |
| 9 | Reinitialization | 4-5 days | Phase 7, 8 | Phase 8 |
| 10 | Completion/PR | 4-5 days | Phase 7 | Phase 9 |
| 11 | Safety/Limits | 3-4 days | Phase 2 | Any after Phase 2 |
| 12 | UI/Audit | 4-5 days | Phase 4, 6, 7 | Late stage |
| 13 | Configuration | 3-4 days | Phase 1, 5 | Any time |

**Total Sequential**: ~50-60 days
**Total with Parallelization**: ~30-35 days

### Critical Path

```
Phase 1 (Registry)
    │
    ├──► Phase 2 (Sub-Task Spawning) ──► Phase 3 (Permissions) ──► Phase 6 (Aggregation)
    │
    └──► Phase 4 (Async Queue) ──► Phase 5 (Permission Config) ──► Phase 7 (Orchestrator Comms)
                                                                         │
                                                                         ▼
                                              Phase 8 (Agent/Model) ──► Phase 9 (Reinit)
                                                                         │
                                                                         ▼
                                                                   Phase 10 (Completion/PR)
```

Phases 11 (Safety), 12 (UI), and 13 (Config) can run in parallel with the main critical path after their dependencies are met.

---

## File Reference

### New Files to Create

| File Path | Purpose |
|-----------|---------|
| `src/extension/orchestrator/agentRegistryService.ts` | Layered agent capability registry |
| `src/extension/orchestrator/subTaskManager.ts` | Sub-task spawning and lifecycle management |
| `src/extension/orchestrator/subTaskAggregator.ts` | Result collection from parallel sub-tasks |
| `src/extension/orchestrator/orchestratorQueue.ts` | Async priority message queue |
| `src/extension/orchestrator/orchestratorPermissions.ts` | Permission evaluation service |
| `src/extension/orchestrator/workerHealthMonitor.ts` | Stuck worker detection and recovery |
| `src/extension/tools/node/a2aTools.ts` | A2A-specific LLM tools |
| `assets/agents/registry.json` | Default agent capability definitions |
| `assets/agents/orchestrator-permissions.json` | Default permission configuration |

### Existing Files to Modify

| File Path | Changes |
|-----------|---------|
| `src/extension/orchestrator/orchestratorServiceV2.ts` | Queue integration, sub-task management, new methods |
| `src/extension/orchestrator/workerSession.ts` | Sub-task spawning support, result handling |
| `src/extension/orchestrator/agentRunner.ts` | Sub-task execution mode, model switching |
| `src/extension/tools/node/orchestratorTools.ts` | Enhanced tools, A2A tool registration |
| `src/extension/orchestrator/dashboard/WorkerDashboardV2.ts` | Sub-task visualization, queue panel, inbox |
| `assets/agents/Architect.agent.md` | Extended frontmatter (strengths, weaknesses, etc.) |
| `assets/agents/Reviewer.agent.md` | Extended frontmatter |
| `assets/agents/Orchestrator.agent.md` | Updated with A2A coordination capabilities |
| `assets/agents/WorkflowPlanner.agent.md` | Extended frontmatter |

### Configuration Files (User-Created)

| File Path | Purpose |
|-----------|---------|
| `.github/agents/orchestrator/permissions.md` | Workspace-level permission configuration |
| `.github/agents/registry-overrides.md` | Workspace-level agent capability overrides |

---

## Example: Full Sub-Task Flow

```
1. User: "@orchestrator deploy feature-oauth"

2. Orchestrator deploys "architecture" task → Worker starts with @architect

3. @architect analyzes the task:
   "This OAuth feature spans backend, frontend, and database.
    I'll spawn sub-tasks for each domain to work in parallel."

4. @architect calls a2a_spawn_parallel_subtasks([
     { agent: "@architect", prompt: "Design Backend OAuth API endpoints...", expectedOutput: "API specification" },
     { agent: "@architect", prompt: "Design Frontend OAuth UI flow...", expectedOutput: "Component specifications" },
     { agent: "@architect", prompt: "Design Database schema for OAuth tokens...", expectedOutput: "Schema DDL" }
   ])

5. SubTaskManager:
   - Creates 3 sub-tasks with depth=1
   - Each inherits parent's permission level
   - Spawns parallel AgentRunner instances
   - All share same worktree

6. Sub-tasks execute in parallel:
   - SubTask 1 (Backend): Designs API, calls a2a_subtask_complete with output
   - SubTask 2 (Frontend): Designs UI, needs to create a new file → auto-approved (inherited permission)
   - SubTask 3 (Database): Designs schema, calls a2a_subtask_complete with output

7. SubTaskResultAggregator collects all results:
   {
     results: [
       { taskId: "sub-1", status: "success", output: "Backend API spec..." },
       { taskId: "sub-2", status: "success", output: "Frontend component spec..." },
       { taskId: "sub-3", status: "success", output: "DB schema DDL..." }
     ],
     allSucceeded: true
   }

8. Results injected into parent @architect context:
   "Sub-tasks completed. Results:
    - Backend: [full output]
    - Frontend: [full output]
    - Database: [full output]"

9. @architect (with full context) continues:
   "Great, now I'll synthesize these into the final architecture plan
    and write it to plans/ArchitecturePlan.md"

10. @architect completes, notifies orchestrator → Next phase begins
```

---

## Appendix: Permission Configuration Example

```yaml
# .github/agents/orchestrator/permissions.md
---
version: 1
---

# Orchestrator Permissions

## Auto-Approve (No user confirmation needed)

- file_edits_in_worktree     # Agents can edit files in their assigned worktree
- file_creation_in_worktree  # Agents can create new files in worktree
- subtask_spawning           # Parent agents can spawn sub-tasks
- agent_reassignment         # Orchestrator can change agent types
- model_switch_same_tier     # Switch between models of similar cost

## Ask User (Require confirmation)

- pr_creation                # Creating pull requests
- branch_merge               # Merging branches
- model_switch_expensive     # Switching to more expensive models (e.g., GPT-4 → o1)
- worktree_cleanup           # Deleting worktrees

## Auto-Deny (Always blocked)

- edits_outside_worktree     # Never edit files outside assigned worktree
- delete_main_branch         # Never delete main/master branch
- force_push                 # Never force push

## Limits

max_subtask_depth: 2           # Sub-tasks can spawn sub-sub-tasks, but no deeper
max_subtasks_per_worker: 10    # No more than 10 total sub-tasks per worker
max_parallel_subtasks: 5       # No more than 5 sub-tasks running at once
subtask_spawn_rate_limit: 20   # Max 20 spawns per minute per worker
```

---

*End of A2A Architecture Plan*
