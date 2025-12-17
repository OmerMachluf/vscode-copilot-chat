# Orchestrator & A2A System Guide

This document explains how the multi-agent orchestration system works in this VS Code extension.

## Architecture Overview

There are **two separate but related systems** for running multiple agents:

1. **Orchestrator System** - Plan-based task management with UI dashboard
2. **A2A (Agent-to-Agent) System** - Ad-hoc subtask delegation between agents

### Key Distinction

| Aspect | Orchestrator | A2A |
|--------|-------------|-----|
| Purpose | Execute planned tasks with dependencies | Delegate work dynamically during execution |
| Task Source | Pre-defined plan with task graph | Created on-the-fly by parent agent |
| Naming | Uses plan task ID and name | Auto-generated subtask IDs (`subtask-XXXXX`) |
| Status Tracking | Updates plan task status (pending → running → completed) | Independent status, doesn't update parent plan |
| UI | Worker Dashboard shows all tasks | May or may not appear in dashboard |
| Typical Use | "Deploy the implementation plan" | "Research this while I continue coding" |

## File Structure

```
src/extension/orchestrator/
├── orchestratorServiceV2.ts     # Main orchestrator service (plans, tasks, workers)
├── orchestratorInterfaces.ts    # Shared interfaces
├── workerSession.ts             # Worker state management
├── workerHealthMonitor.ts       # Tracks worker activity
├── subTaskManager.ts            # A2A subtask lifecycle
├── safetyLimits.ts              # Depth limits, spawn controls
├── agentDiscoveryService.ts     # Finds available agents
├── executors/
│   └── claudeCodeAgentExecutor.ts  # Claude backend execution
└── dashboard/
    └── WorkerDashboardV2.ts     # UI for managing workers

src/extension/agents/claude/node/
├── claudeA2AMcpServer.ts        # MCP tools exposed to Claude agents
├── claudeCodeAgent.ts           # Main Claude agent logic
├── claudeAgentManager.ts        # Session management
└── claudeWorktreeSession.ts     # Worktree-specific sessions

src/extension/tools/node/
├── orchestratorTools.ts         # Copilot agent tools (non-MCP)
└── a2aTools.ts                  # A2A tools for Copilot agents
```

## Orchestrator System

### Plans and Tasks

A **Plan** is a collection of tasks with dependencies:

```typescript
interface IPlan {
  id: string;           // e.g., "plan-abc123"
  name: string;         // e.g., "Implement Feature X"
  description: string;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'failed';
  baseBranch: string;   // e.g., "main"
  tasks: ITask[];
}

interface ITask {
  id: string;           // e.g., "task-392"
  name: string;         // e.g., "phase-1-repository-investigation-engine"
  description: string;  // Full task prompt
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'blocked';
  dependencies: string[];  // Task IDs that must complete first
  agent?: string;       // e.g., "claude:agent", "@architect"
  workerId?: string;    // Assigned when deployed
  planId: string;
}
```

### Deploying Tasks

The deployment flow:

```
orchestrator_deploy_task(taskId)
    ↓
orchestratorService.deploy(taskId)
    ↓
_createWorktree(taskName, baseBranch)  ← Creates git worktree + copies .claude folder
    ↓
WorkerSession created (status: 'running')
    ↓
Task marked as 'running' in plan
    ↓
_runWorkerTask() dispatches to backend
    ↓
For claude backend: _runExecutorBasedTask()
    ↓
ClaudeCodeAgentExecutor.execute()
    ↓
Claude session.invoke(prompt) ← Agent starts working
```

### MCP Tools (for Claude agents)

Tools exposed via `claudeA2AMcpServer.ts`:

| Tool | Purpose |
|------|---------|
| `orchestrator_save_plan` | Create a new plan |
| `orchestrator_add_plan_task` | Add task to plan |
| `orchestrator_list_workers` | Show plans, tasks, workers status |
| `orchestrator_deploy_task` | **Deploy a task from plan** |
| `orchestrator_complete_task` | Mark task completed |
| `orchestrator_cancel_task` | Cancel a task |
| `orchestrator_retry_task` | Retry failed task |

### Copilot Tools (for @agent etc.)

Defined in `orchestratorTools.ts`, registered in `package.json`:

- `copilot_orchestratorDeployTask`
- `copilot_orchestratorCompleteTask`
- etc.

## A2A System

### Subtask Spawning

A2A allows an agent to spawn child agents for parallel/delegated work:

```
Parent Agent working on task
    ↓
Needs to delegate research
    ↓
a2a_spawn_subtask(agentType: "claude:agent", prompt: "Research X", blocking: true/false)
    ↓
SubTaskManager.createSubTask() → subtask-XXXXX
    ↓
SubTaskManager.executeSubTask()
    ↓
orchestratorService.deploy() with instructionsBuilder
    ↓
Child agent executes in isolated worktree
    ↓
Result returned to parent
```

### Key Difference: blocking vs non-blocking

```typescript
// Blocking - parent waits for result
const result = await a2a_spawn_subtask({
  agentType: "claude:agent",
  prompt: "Research authentication patterns",
  blocking: true  // Parent waits
});
// result.output contains child's response

// Non-blocking - parent continues, polls later
const { taskId } = await a2a_spawn_subtask({
  agentType: "claude:agent",
  prompt: "Research in background",
  blocking: false  // Returns immediately
});
// Later: await a2a_await_subtasks({ taskIds: [taskId] })
```

### Depth Limits

To prevent infinite recursion:

```typescript
// safetyLimits.ts
const MAX_DEPTH = {
  orchestrator: 2,  // Orchestrator → Worker → SubWorker
  agent: 1          // Standalone agent → SubAgent only
};
```

### A2A MCP Tools

| Tool | Purpose |
|------|---------|
| `a2a_list_agents` | List available agent types |
| `a2a_spawn_subtask` | Spawn child agent (blocking or non-blocking) |
| `a2a_await_subtasks` | Wait for non-blocking subtasks |
| `a2a_subtask_complete` | Child signals completion to parent |
| `a2a_pull_subtask_changes` | Pull git changes from child worktree |

## Worktrees

### What They Are

Git worktrees allow multiple working directories from one repo. Each worker gets its own worktree so they can make changes in parallel without conflicts.

```
Main repo: Q:\src\PowerQuery\vscode-copilot-chat
Worktrees: Q:\src\PowerQuery\.worktrees\
    ├── phase-1-repository-investigation-engine\
    ├── implement-core-types\
    └── add-api-endpoints\
```

### Worktree Creation

```typescript
// orchestratorServiceV2.ts → _createWorktree()
1. Check for dirty workspace (fail if uncommitted changes)
2. Create worktrees directory if needed
3. git worktree add -b <taskName> <path> <baseBranch>
4. Copy .claude folder (agents, commands, skills)
5. Return worktree path
```

### Critical: .claude Folder

The `.claude` folder contains:
- Custom agents (`agents/*.md`)
- Slash commands (`commands/*.md`)
- Skills (`SKILL.md` files)
- Settings (`settings.json`)

This folder is in `.gitignore` so it must be explicitly copied to worktrees. Without it, Claude can't find `/agent` and other custom commands.

## Worker Session Lifecycle

```
WorkerSession states:
                    ┌──────────────┐
                    │   created    │
                    └──────┬───────┘
                           │ start()
                           ▼
┌─────────────┐     ┌──────────────┐
│   paused    │◄────│   running    │────►┌──────────────┐
└─────────────┘     └──────┬───────┘     │    error     │
      │                    │             └──────────────┘
      │                    │ idle()
      │                    ▼
      │             ┌──────────────┐
      └────────────►│    idle      │
                    └──────┬───────┘
                           │ complete()
                           ▼
                    ┌──────────────┐
                    │  completed   │
                    └──────────────┘
```

### Key Methods

```typescript
class WorkerSession {
  start()     // Set status to 'running'
  idle()      // Task done, waiting for user input
  complete()  // Fully done, triggers cleanup
  error(msg)  // Failed, triggers cleanup
  interrupt() // User stopped, goes to idle
}
```

## Executor Loop

For Claude backend (`_runExecutorBasedTask`):

```typescript
while (worker.isActive) {
  // Wait if idle
  if (worker.status === 'idle') {
    const nextMessage = await worker.waitForClarification();
    if (!nextMessage) break;
    currentPrompt = nextMessage;
    worker.start();
  }

  // Execute one turn
  const result = await executor.execute({
    taskId, prompt, worktreePath, agentType, ...
  });

  if (result.status === 'failed') {
    // Handle error, retry, or break
  }

  // After successful execution, go idle and wait
  worker.idle();
  const nextMessage = await worker.waitForClarification();
  if (!nextMessage) break;
  currentPrompt = nextMessage;
  worker.start();
}
```

**Important**: After each `execute()` call, the worker goes idle and waits for user input. For autonomous agents, the Claude session itself runs its own internal loop.

## Common Issues & Solutions

### Issue: Worker goes idle immediately after deploy

**Cause**: The executor loop marks worker idle after `session.invoke()` returns. If Claude returns immediately (e.g., unknown slash command), worker appears to do nothing.

**Solution**: Ensure `.claude` folder is copied to worktree so custom commands work.

### Issue: Subtasks created but never executed

**Cause**: `a2a_spawn_subtask` with `blocking: false` wasn't calling `executeSubTask`.

**Solution**: Fixed - non-blocking subtasks now start execution in background.

### Issue: Plan task not marked as running

**Cause**: Using A2A tools instead of orchestrator tools.

**Solution**: Use `orchestrator_deploy_task` for plan tasks, `a2a_spawn_subtask` for ad-hoc delegation.

### Issue: Worktree has uncommitted changes error

**Cause**: Main workspace has unstaged/uncommitted changes.

**Solution**: Commit or stash changes before deploying workers.

### Issue: "Unknown slash command /agent"

**Cause**: `.claude` folder not present in worktree.

**Solution**: Delete worktree, redeploy (auto-copies .claude now), or manually copy.

### Issue: Worker doesn't know about worktree, completion requirements

**Cause**: (Historical) Orchestrator-deployed tasks were missing the additional instructions that A2A subtasks received.

**Solution**: Fixed - `deploy()` now automatically calls `_buildWorkerInstructions()` for top-level workers, providing context about:
- Worktree location and restrictions
- Commit requirements
- How to complete the task (`orchestrator_completeTask`)
- Sub-task spawning capabilities

## Additional Instructions

Both deployment paths now provide consistent additional instructions to workers:

| Path | Method | Instructions Include |
|------|--------|---------------------|
| A2A subtask | `_buildSubTaskAdditionalInstructions()` | Parent context, `a2a_subtask_complete`, commit requirements |
| Orchestrator deploy | `_buildWorkerInstructions()` | Plan context, `orchestrator_completeTask`, commit requirements |

This ensures workers always know:
1. Their worktree path and restrictions
2. How to commit changes
3. How to signal completion
4. That they can spawn sub-tasks if needed

## Health Monitoring

The `WorkerHealthMonitor` tracks worker activity and detects issues:

### Metrics Tracked

| Metric | Timeout | Description |
|--------|---------|-------------|
| Idle | 30 seconds | Worker not producing output (only when not executing) |
| Stuck | 5 minutes | No activity at all |
| Progress Check | 5 minutes | Periodic status request during execution |

### Key Events

| Event | Trigger | Action |
|-------|---------|--------|
| `onWorkerIdle` | Worker idle >30s AND not executing | Sends idle inquiry, queues response for parent |
| `onProgressCheckDue` | Executing for >5 minutes | Requests progress report, queues for parent |
| `onWorkerUnhealthy` | Stuck, looping, or high errors | Notifies parent, fires UI event |

### Execution Tracking

The health monitor distinguishes between:
- **Executing**: Worker is inside `invoke()`/`run()` - may be "thinking" without output
- **Idle**: Worker finished execution and is waiting for input

This prevents false idle detection during long "thinking" phases. Activity is recorded:
1. At execution start/end (`markExecutionStart`/`markExecutionEnd`)
2. On stream output (throttled to every 5 seconds)
3. On tool calls, errors, and successes

### Parent Notifications

All health events for child workers are queued for their parent:
- Idle inquiries and responses → `idle_response` update
- Progress reports → `progress` update
- Errors and stuck notifications → `error` update (high priority)

Parents receive these updates when they go idle (via `_injectPendingSubtaskUpdates`).

## Logging

### File Logging

Logs written to:
```
%APPDATA%\Code\User\globalStorage\github.copilot-chat\orchestrator-logs\
```

Format: `orchestrator-YYYY-MM-DDTHH-mm-ss.log`

### Key Log Prefixes

```
[Orchestrator:deploy]           - Deploy method entry/exit
[Orchestrator:_runWorkerTask]   - Worker task dispatch
[Orchestrator:_runExecutorBasedTask] - Claude backend execution
[ClaudeExecutor:execute]        - Claude session invocation
[WorkerSession:XXX]             - Worker state changes (console.log)
[SubTaskManager]                - Subtask creation/execution
```

## Testing Orchestration

1. Create a plan with `orchestrator_save_plan`
2. Add tasks with `orchestrator_add_plan_task`
3. List status with `orchestrator_list_workers`
4. Deploy tasks with `orchestrator_deploy_task`
5. Monitor via Worker Dashboard UI
6. Complete tasks with `orchestrator_complete_task`

## Quick Reference

### Deploy a plan task
```
Use orchestrator_deploy_task with taskId from the plan
```

### Spawn ad-hoc subtask
```
Use a2a_spawn_subtask with agentType and prompt
```

### Check what's running
```
Use orchestrator_list_workers to see all plans, tasks, workers
```

### Files to know
- `orchestratorServiceV2.ts` - Main logic
- `claudeA2AMcpServer.ts` - MCP tool definitions
- `workerSession.ts` - Worker state machine
- `subTaskManager.ts` - A2A subtask handling
