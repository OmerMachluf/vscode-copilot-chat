# Multi-Agent Orchestrator - User Guide

> **A system for coordinating specialized AI agents to handle complex development tasks in parallel.**

## Quick Start

### 1. Talk to the Planner

Start by asking the Planner to create a workflow for your task:

```
@planner Fix bug #1234 - enterprise login fails for SSO users
```

The Planner will analyze your request and create a structured plan with tasks, dependencies, and agent assignments.

### 2. Review and Save the Plan

The Planner will present a plan like:

```yaml
Plan: fix-enterprise-login-1234

Tasks:
1. investigate (@agent) - Gather bug details, reproduce issue
2. root-cause (@agent) - Analyze findings [after: investigate]
3. architecture (@architect) - Design fix approach [after: root-cause]
4. implement (@agent) - Write the fix [after: architecture]
5. test (@agent) - Write tests [after: implement]
6. review (@reviewer) - Code review [after: test]
7. pr (@agent) - Create pull request [after: review]
```

If you're happy with it, tell the Planner to save it:

```
Yes, save this plan
```

### 3. Deploy with the Orchestrator

Once saved, deploy the plan using the Orchestrator:

```
@orchestrator deploy fix-enterprise-login-1234
```

The Orchestrator will:
- Start tasks in dependency order (DAG-based execution)
- Run independent tasks in parallel when possible
- Show progress in the Worker Dashboard
- Create a PR when complete

---

## Available Agents

| Agent | Mention | Purpose |
|-------|---------|---------|
| **WorkflowPlanner** | `@planner` | Creates high-level workflow plans (Process/Stages) |
| **StepPlanner** | `@stepplanner` | Creates detailed step-by-step research plans (Single Task) |
| **Architect** | `@architect` | Designs technical implementation with file-level specificity |
| **Coder** | `@agent` | Implements code changes (default Copilot agent) |
| **Reviewer** | `@reviewer` | Reviews code for quality and correctness |
| **Orchestrator** | `@orchestrator` | Coordinates plan execution and workers |

---

## Common Workflows

### 1. Complex Project (WorkflowPlanner)

Use `@planner` when you need to coordinate multiple agents or stages.

```
@planner Fix bug #1234 - [describe the issue]
```

**Typical tasks:** Investigate → Root Cause → Architecture → Implement → Test → Review → PR

### 2. Deep Research (StepPlanner)

Use `@stepplanner` when you need a deep dive into a single topic or a detailed plan for yourself.

```
@stepplanner Research how to implement OAuth2 with the new provider
```

**Output:** A detailed markdown plan for you to follow (does NOT create an automated workflow).

---

## Orchestrator Commands

### Deploy a Plan

```
@orchestrator deploy <plan-name>
```

Starts executing the plan. Tasks are deployed based on their dependencies.

### Check Worker Status

```
@orchestrator list workers
```

Shows all active workers and their current status.

### Send Message to Worker

```
@orchestrator send <worker-id> <message>
```

Sends instructions or context to a specific worker.

---

## Worker Dashboard

The Worker Dashboard provides a visual interface for monitoring plan execution:

### Views

- **List View**: Shows workers and tasks in a list format
- **Graph View**: Displays the dependency DAG with critical path highlighting

### Task Status Colors

| Color | Status |
|-------|--------|
| Gray | Pending (waiting for dependencies) |
| Blue | Running |
| Green | Completed |
| Red | Failed |
| Orange | Critical Path (longest dependency chain) |

### Actions

- **Pause/Resume**: Control task execution
- **Cancel**: Stop a worker
- **Complete + PR**: Mark complete and create a pull request

---

## Plan Syntax

Plans use YAML structure with these fields:

```yaml
plan:
  name: descriptive-name
  description: Brief goal description

  tasks:
    - id: task-1
      name: Human Readable Name
      agent: "@agent"           # Which agent handles this
      description: "What to do"
      dependencies: []          # Task IDs that must complete first
      targetFiles:              # Optional: files this task modifies
        - src/path/file.ts
```

### Dependencies

Tasks wait for their dependencies before starting:

```yaml
tasks:
  - id: investigate
    name: Investigate Issue
    agent: "@agent"
    dependencies: []  # Starts immediately

  - id: fix
    name: Implement Fix
    agent: "@agent"
    dependencies: [investigate]  # Waits for investigate
```

### Parallel Execution

Tasks without conflicting dependencies run in parallel:

```yaml
tasks:
  - id: fix-module-a
    agent: "@agent"
    dependencies: [architecture]
    targetFiles: [src/moduleA.ts]

  - id: fix-module-b
    agent: "@agent"
    dependencies: [architecture]
    targetFiles: [src/moduleB.ts]  # Different files = parallel OK
```

---

## Custom Agents & Instructions

Repositories can define custom agents and instructions in `.github/agents/`.

### Agent Instructions

You can customize how each agent behaves by adding markdown files to their specific folder:

| Agent | Folder Path | Purpose |
|-------|-------------|---------|
| **WorkflowPlanner** | `.github/agents/workflowplanner/` | Define workflow rules (e.g., "Always add Security Review") |
| **StepPlanner** | `.github/agents/stepplanner/` | Define research methodologies |
| **Architect** | `.github/agents/architect/` | Define architectural patterns |
| **Reviewer** | `.github/agents/reviewer/` | Define review checklists |

### Custom Agents

Define completely new agents by creating a folder with an `.agent.md` file:

```markdown
<!-- .github/agents/investigation/investigation.agent.md -->
---
name: investigation
description: Investigates issues using internal logging
tools: ['fetch', 'search', 'runCommands']
---

You are an investigation agent. You can:
- Query Kusto logs
- Access Application Insights
- Analyze telemetry data
```

Custom agents appear in the Planner's agent list and can be assigned to tasks.

---

## Best Practices

### 1. Be Specific with the Planner

❌ `@planner Fix the bug`

✅ `@planner Fix bug #1234 - Login fails for enterprise SSO users when token expires`

### 2. Review Plans Before Deploying

Always review the Planner's output. Look for:
- Correct task ordering
- Appropriate agent assignments
- Missing steps

### 3. Use the Architect for Complex Changes

For non-trivial implementations, include an Architecture task:

```yaml
- id: architecture
  agent: "@architect"
  description: "Design the implementation approach"
```

The Architect provides:
- Specific file paths
- Parallelization opportunities
- Test strategy

### 4. Monitor the Dashboard

Keep the Worker Dashboard open to:
- Track progress
- Identify bottlenecks (critical path)
- Catch failures early

### 5. Let Parallel Tasks Run

The orchestrator automatically parallelizes independent tasks. Don't add unnecessary dependencies.

---

## Troubleshooting

### Plan Not Deploying

- Verify the plan is saved (`@planner` should confirm)
- Check the plan name matches exactly

### Tasks Stuck in Pending

- Check dependencies - a task waits for all its dependencies
- Look for failed upstream tasks in the Dashboard

### Worker Failed

- Check the worker's output in the Dashboard
- Send a message with additional context: `@orchestrator send <worker-id> <context>`
- Consider re-running the task

### PR Creation Failed

- Ensure `gh` CLI is installed and authenticated
- Check for uncommitted changes in the worktree

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER REQUEST                            │
│                  "Fix bug #1234 - login fails"                  │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                          @planner                               │
│  • Analyzes request                                             │
│  • Discovers available agents                                   │
│  • Creates workflow plan with tasks & dependencies              │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                        @orchestrator                            │
│  • Deploys plan                                                 │
│  • Manages task DAG                                             │
│  • Spawns workers for each task                                 │
│  • Parallelizes independent tasks                               │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
    ┌───────────┐           ┌───────────┐           ┌───────────┐
    │  Worker   │           │  Worker   │           │  Worker   │
    │ @agent    │           │ @architect│           │ @reviewer │
    └───────────┘           └───────────┘           └───────────┘
          │                       │                       │
          └───────────────────────┼───────────────────────┘
                                  ▼
                         ┌───────────────┐
                         │  Pull Request │
                         └───────────────┘
```

---

## Example: Complete Bug Fix Flow

```
USER: @planner Fix bug #1234 - enterprise login fails

PLANNER: I'll create a workflow plan for this bug fix.

Here's the plan:

## Plan: fix-enterprise-login-1234

### Tasks
1. **investigate** (@agent) - Gather bug details, reproduce issue
2. **root-cause** (@agent) - Analyze findings [after: investigate]
3. **architecture** (@architect) - Design fix approach [after: root-cause]
4. **implement** (@agent) - Write the fix [after: architecture]
5. **test** (@agent) - Add/update tests [after: implement]
6. **review** (@reviewer) - Code review [after: test]
7. **pr** (@agent) - Create pull request [after: review]

Shall I save this plan?

USER: Yes, save it

PLANNER: ✅ Plan saved as "fix-enterprise-login-1234"

USER: @orchestrator deploy fix-enterprise-login-1234

ORCHESTRATOR: 🚀 Deploying plan "fix-enterprise-login-1234"
- Starting task: investigate (@agent)

[Dashboard shows progress...]

ORCHESTRATOR: ✅ Task "investigate" completed
- Starting task: root-cause (@agent)

[... continues through DAG ...]

ORCHESTRATOR: 🎉 Plan completed!
- PR #567 created: "Fix enterprise login issue #1234"
- All 7 tasks successful
```

---

## Related Documentation

- [Architecture Document](./orchestrator-architecture.md) - Technical details and implementation phases
- [Tools Reference](./tools.md) - Available LLM tools
- [Prompts Guide](./prompts.md) - Prompt engineering guidelines
