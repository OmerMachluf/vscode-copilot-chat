# Agent-to-Agent (A2A) Configuration Guide

This guide details how to customize the behavior of Copilot's Agent-to-Agent (A2A) architecture, including agent capabilities, orchestrator permissions, and model preferences.

## Configuration Levels

Configuration is applied in the following order of precedence (highest to lowest):
1. **User Settings** (VS Code `settings.json`)
2. **Workspace Configuration** (`.github/agents/` files)
3. **Extension Defaults**

## 1. VS Code Settings

These settings can be configured in your user or workspace `settings.json`.

### `copilot.agents.capabilities`
Override specific capabilities for agents.

```json
"copilot.agents.capabilities": {
    "architect": {
        "skills": ["design-patterns", "system-architecture"],
        "allowedTools": ["search_workspace", "read_file"]
    }
}
```

### `copilot.orchestrator.permissions`
Control what actions the orchestrator can perform without explicit user approval.

```json
"copilot.orchestrator.permissions": {
    "fileSystem": {
        "read": "auto_approve",
        "write": "ask_user"
    },
    "terminal": {
        "execute": "ask_user"
    }
}
```

### `copilot.orchestrator.limits`
Set operational limits for the orchestrator.

```json
"copilot.orchestrator.limits": {
    "maxSubtaskDepth": 3,
    "maxSubtasksPerWorker": 15
}
```

### `copilot.orchestrator.modelPreferences`
Specify which AI models to use for different tasks or agents.

```json
"copilot.orchestrator.modelPreferences": {
    "default": "gpt-4o",
    "byTaskType": {
        "architecture": "o1-preview",
        "implementation": "claude-3-5-sonnet",
        "review": "gpt-4o"
    },
    "byAgent": {
        "architect": "o1-preview"
    }
}
```

## 2. Workspace Configuration Files

You can commit these files to your repository to share configuration with your team.

### Global Agent Configuration
**Path:** `.github/agents/config.yaml`

Central configuration for all agents in your workspace:

```yaml
# .github/agents/config.yaml
version: 1

defaults:
  backend: copilot          # Default backend for all agents
  model: gpt-4o             # Default model

agents:
  architect:
    backend: claude         # Override: use Claude for architect
    model: claude-3-5-sonnet
    claudeSlashCommand: /architect

  reviewer:
    backend: copilot
    model: gpt-4o

  repository-researcher:
    backend: copilot
    model: gpt-4o
```

### Agent Definitions
**Path:** `.github/agents/{agentId}/{agentId}.agent.md`

Define custom agents or override existing ones using Markdown frontmatter and content.

```markdown
---
name: "Security Auditor"
description: "Reviews code for security vulnerabilities"
hasArchitectureAccess: false
useSkills: [security-patterns, owasp-guidelines]
backend: copilot
tools:
  - search_workspace
  - read_file
  - grep_search
---

# System Prompt
You are a security expert...
```

### Extended Agent Definition Schema

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Required: Agent name |
| `description` | string | Required: What this agent does |
| `backend` | `copilot` \| `claude` | Preferred backend |
| `hasArchitectureAccess` | boolean | Can load architecture docs |
| `useSkills` | string[] | Skills to always load |
| `tools` | string[] | Allowed tools |
| `claudeSlashCommand` | string | Claude slash command override |

### Registry Overrides
**Path:** `.github/agents/registry-overrides.md`

Override capabilities of registered agents.

```markdown
# Registry Overrides

## architect
- add_skill: "cloud-native-design"
- remove_tool: "delete_file"

## reviewer
- set_model: "gpt-4o"
```

### Permission Overrides
**Path:** `.github/agents/orchestrator/permissions.md`

Define project-specific permissions.

```markdown
# Orchestrator Permissions

## File System
- **Read**: auto_approve
- **Write**: ask_user (protected branches only)

## Terminal
- **Execute**: ask_user
```

## 3. Skills Configuration

Skills are domain-specific knowledge modules that agents can reference on-demand.

### Skill File Location

```
.github/
├── skills/                          # Global skills (all agents)
│   └── coding-standards.skill.md
├── agents/
│   └── architect/
│       └── skills/                  # Agent-specific skills
│           ├── microservices.skill.md
│           └── design-patterns.skill.md
```

### Skill File Schema

```yaml
# .github/agents/architect/skills/microservices.skill.md
---
name: Microservices Patterns
description: Knowledge of microservices architecture patterns
keywords:
  - microservice
  - service mesh
  - API gateway
---
# Microservices Architecture Patterns
...
```

### Referencing Skills

**In Prompts:**
```
Help me design a service using #skill:microservices patterns.
```

**In Agent Definitions:**
```yaml
useSkills: [microservices, design-patterns]
```

See [Skills Guide](./skills-guide.md) for complete documentation.

## 4. Architecture Access Control

Architecture documents (`.architecture.md` files) contain sensitive system design information that should only be accessible to specialized agents.

### Architecture-Aware Agents

Only agents with `hasArchitectureAccess: true` can load architecture documents:

| Agent | Has Access | Purpose |
|-------|------------|---------|
| `architect` | Yes | System design, needs full context |
| `repository-researcher` | Yes | Investigates codebase, answers architecture questions |
| `agent` | No | Implementation agent |
| `reviewer` | No | Code review |

### Architecture Document Location

```
.github/agents/
├── architect/
│   └── architecture/
│       ├── system-overview.architecture.md
│       └── database-schema.architecture.md
```

### A2A Pattern for Architecture Queries

Agents without architecture access should delegate to specialized agents:

```
@agent (implementing feature)
    │
    ├── Needs DB schema understanding?
    │   └── a2a_spawn_subtask → repository-researcher:
    │       "What's the current DB schema for users table?"
    │
    └── Needs design guidance?
        └── a2a_spawn_subtask → architect:
            "What pattern should I use for this service?"
```

## 5. Worktree Semantics

### Dirty Workspace Policy

When the orchestrator creates worktrees for workers, it follows a **fail-fast** policy:

1. **Clean State Requirement**: The main workspace must have no uncommitted changes before spawning workers.
2. **Error on Dirty State**: If uncommitted changes exist, the orchestrator will:
   - Display an error message indicating the dirty state
   - Suggest the user commit, stash, or discard changes
   - Refuse to create new worktrees until resolved

This policy prevents:
- Accidental loss of uncommitted work
- Confusion about which changes belong to which worker
- Merge conflicts when workers complete

### Worktree Isolation (Critical Security Feature)

Workers are **strictly isolated** to their assigned worktree directory:

1. **Scoped Tool Execution**: When tools are invoked by a worker:
   - The `WorkerToolSet` uses scoped tool instances bound to the worktree
   - The `ScopedWorkspaceService` presents only the worktree as the workspace
   - File operations are validated against the worker's `IWorkerContext`

2. **Path Enforcement**: The `assertFileOkForTool` function enforces that:
   - Workers can ONLY read/write files within their worktree path
   - Attempts to access files outside the worktree result in a clear error:
     ```
     File <path> is outside the worker's worktree (<worktree-path>).
     Workers can only access files within their assigned worktree directory.
     ```
   - External instruction files and untitled files are explicitly allowed

3. **Why This Matters**:
   - Prevents workers from accidentally modifying the main workspace
   - Ensures each worker's changes are isolated and reviewable
   - Allows safe parallel execution of multiple workers
   - Maintains clean separation between orchestrator and worker file access

### Worktree Lifecycle

1. **Creation**: Each worker gets an isolated worktree in `.worktrees/<task-name>/`
2. **Branch**: A new branch `<task-name>` is created from the base branch
3. **Execution**: Worker makes changes within its worktree
4. **Completion**: On completion, the worktree's changes are:
   - Committed with a task-specific message
   - Pushed to origin
   - Optionally converted to a PR
5. **Cleanup**: Worktree and branch are removed after successful merge or explicit cleanup

### Completion Payloads

When a subtask completes, the parent receives:
- `worktreePath`: Full path to the subtask's worktree
- `changedFilesCount`: Number of files modified
- `insertions`: Lines added
- `deletions`: Lines removed

This information helps the parent understand the scope of changes and decide on next steps.

## 5. Configuration Templates

We provide templates for common scenarios:

- **Enterprise**: Restrictive, security-focused (requires approval for most actions).
- **Open Source**: Permissive for contributors, strict for maintainers.
- **Solo**: Optimized for speed (auto-approve most actions).
- **Team**: Balanced for collaboration (PR workflows).

## Troubleshooting

### Configuration Not Loading
- Ensure files are in `.github/agents/`.
- Check VS Code Output channel for "Copilot Orchestrator" for parsing errors.
- Verify JSON syntax in `settings.json`.

### Conflicts
- User settings always override workspace settings.
- If an agent behaves unexpectedly, check `copilot.agents.capabilities` for overrides.
