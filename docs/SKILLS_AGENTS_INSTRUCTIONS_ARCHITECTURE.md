# Skills, Agents, Instructions & Commands Architecture

This document describes how skills, agents, instructions, and slash commands are organized, loaded, and shared in the GitHub Copilot Chat extension.

## Table of Contents

- [Overview](#overview)
- [Commands & Intents System (Copilot Core)](#commands--intents-system-copilot-core)
  - [Built-in Chat Participants](#built-in-chat-participants)
  - [Intents (Slash Commands)](#intents-slash-commands)
  - [How Commands Are Registered](#how-commands-are-registered)
- [Custom Agents System (Orchestrator)](#custom-agents-system-orchestrator)
  - [Agent Definition Locations](#agent-definition-locations)
  - [Agent File Format](#agent-file-format)
- [Skills System](#skills-system)
  - [Where Skills Are Located](#where-skills-are-located)
  - [Skill File Format](#skill-file-format)
  - [How Skills Are Loaded](#how-skills-are-loaded)
  - [How Skills Are Merged Into Prompts](#how-skills-are-merged-into-prompts)
- [Instructions System](#instructions-system)
  - [Instruction Locations](#instruction-locations)
  - [Instruction Composition Order](#instruction-composition-order)
- [Claude Code Sync Mechanism](#claude-code-sync-mechanism)
- [Error Propagation System](#error-propagation-system)
  - [Error Types](#error-types)
  - [Worker Status States](#worker-status-states)
  - [Error Notification Flow](#error-notification-flow)
  - [Retry Behavior](#retry-behavior)
  - [Handling Unhealthy Workers](#handling-unhealthy-workers)
- [Key Services](#key-services)

---

## Overview

The system has **two layers**:

### Layer 1: Core Copilot (VS Code Chat Participants)
Built-in participants and commands registered via `package.json` and implemented in TypeScript.

### Layer 2: Custom Orchestrator Agents
File-based agent definitions (`.agent.md`) that extend the system with custom personas.

| Type | Layer | Purpose | Loading |
|------|-------|---------|---------|
| **Chat Participants** | Core | VS Code chat UI (`@workspace`, `@terminal`) | Always available |
| **Intents/Commands** | Core | Slash commands (`/explain`, `/fix`, `/tests`) | Always available |
| **Custom Agents** | Orchestrator | File-based agents (`.github/agents/`) | Discovered at runtime |
| **Skills** | Orchestrator | Domain knowledge modules | On-demand |
| **Instructions** | Orchestrator | Behavioral rules | Always loaded for agent |

---

## Commands & Intents System (Copilot Core)

This is the **native VS Code integration layer** - hardcoded participants and commands.

### Built-in Chat Participants

Registered in `package.json` under `contributes.chatParticipants`:

| Participant | ID | Description |
|-------------|----|-----------|
| `@workspace` | `github.copilot.workspace` | Workspace-wide operations |
| `@vscode` | `github.copilot.vscode` | VS Code configuration help |
| `@terminal` | `github.copilot.terminal` | Terminal assistance |
| Default | `github.copilot.default` | Main chat (no @ prefix) |
| Agent Mode | `github.copilot.editsAgent` | Autonomous coding agent |

**Source**: `package.json:1893-2305` (chatParticipants contribution)

### Intents (Slash Commands)

Each participant can have commands. Defined in `src/extension/common/constants.ts`:

```typescript
export const enum Intent {
    Explain = 'explain',
    Review = 'review',
    Tests = 'tests',
    Fix = 'fix',
    New = 'new',
    Search = 'search',
    Terminal = 'terminal',
    VSCode = 'vscode',
    Workspace = 'workspace',
    // ... orchestrator intents
    Orchestrator = 'orchestrator',
    Planner = 'planner',
    Architect = 'architect',
    Reviewer = 'reviewer'
}
```

**Command mapping by participant** (`agentsToCommands`):

| Participant | Available Commands |
|-------------|-------------------|
| `@workspace` | `/explain`, `/edit`, `/review`, `/tests`, `/fix`, `/new`, `/semanticSearch`, `/setupTests` |
| `@vscode` | `/search` |
| `@terminal` | `/explain` |
| Editor (inline) | `/doc`, `/fix`, `/explain`, `/review`, `/tests`, `/edit`, `/generate` |

**Source**: `src/extension/common/constants.ts:47-74`

### How Commands Are Registered

```
package.json (chatParticipants contribution)
         ↓
ChatAgentService.register() [chatParticipants.ts]
         ↓
Creates vscode.ChatParticipant via vscode.chat.createChatParticipant()
         ↓
Each participant has a request handler → ChatParticipantRequestHandler
         ↓
Handler routes to Intent implementations (e.g., ExplainIntent, FixIntent)
```

**Intent implementations**: `src/extension/intents/node/*.ts`
- `explainIntent.ts` → `/explain`
- `fixIntent.ts` → `/fix`
- `testIntent/testIntent.tsx` → `/tests`
- `reviewIntent.ts` → `/review`
- etc.

### Chat Sessions (Background Agents)

Beyond participants, there are **chat sessions** for background work:

| Session Type | ID | Description |
|--------------|----|-----------|
| Claude Code | `claude-code` | Claude Code CLI integration |
| Background Agent | `copilotcli` | Background task runner |
| Cloud Agent | `copilot-cloud-agent` | Cloud-delegated tasks |

**Source**: `package.json:5750-5861` (chatSessions contribution)

---

## Custom Agents System (Orchestrator)

This extends the core system with **file-based agent definitions**.

### Architecture Overview

```
.github/agents/*.agent.md     ←── Custom agent definitions
         ↓
AgentDiscoveryService          ←── Discovers agents at runtime
         ↓
AgentInstructionService        ←── Loads instructions + skills
         ↓
OrchestratorService            ←── Executes multi-agent workflows
```

### Built-in Orchestrator Agents

Hardcoded in `AgentDiscoveryService` + shipped in `assets/agents/`:

| Agent | File | Purpose |
|-------|------|---------|
| `agent` | Built-in | Default coding agent |
| `ask` | Built-in | Q&A mode |
| `edit` | Built-in | Direct editing |
| `architect` | `Architect.agent.md` | Implementation planning |
| `reviewer` | `Reviewer.agent.md` | Code review |
| `researcher` | `Researcher.agent.md` | Codebase investigation |
| `tester` | `Tester.agent.md` | Test strategy |
| `orchestrator` | `Orchestrator.agent.md` | Multi-agent coordination |
| `product` | `Product.agent.md` | Product/UX expertise |

**Source**: `src/extension/orchestrator/agentDiscoveryService.ts:79-104`

### Custom Agent Discovery

Custom agents are discovered from `.github/agents/`:

```typescript
// AgentDiscoveryService.getRepoAgents()
// Looks for: .github/agents/*.agent.md
// And: .github/agents/{name}/{name}.agent.md
```

The architecture supports three types of configuration:

| Type | Purpose | Loading Behavior |
|------|---------|------------------|
| **Skills** | Domain-specific knowledge modules | **On-demand** - loaded only when explicitly referenced |
| **Instructions** | Behavioral rules and guidelines | **Always loaded** - applied to all requests for an agent |
| **Agents** | Specialized AI personas with tools | **On invocation** - loaded when agent is called |

**Key Difference**: Skills vs Instructions
- **Instructions**: Always loaded, behavioral rules (e.g., "Use tabs not spaces")
- **Skills**: Explicitly referenced, domain knowledge (e.g., "Microservices patterns")

---

## Skills System

### Where Skills Are Located

Skills can be found in three locations, with this **priority order** (later sources override earlier):

| Priority | Location | Description |
|----------|----------|-------------|
| 1 (lowest) | `assets/agents/{agentId}/skills/*.skill.md` | **Built-in skills** shipped with the extension |
| 2 | `.github/skills/*.skill.md` | **Global repo skills** available to all agents |
| 3 (highest) | `.github/agents/{agentId}/skills/*.skill.md` | **Agent-specific skills** for a particular agent |

#### Directory Structure Example

```
project-root/
├── .github/
│   ├── skills/                              # Global repo skills
│   │   ├── microservices.skill.md
│   │   └── rest-api.skill.md
│   └── agents/
│       └── architect/
│           └── skills/                      # Agent-specific skills
│               └── design-patterns.skill.md
│
└── [extension]/assets/agents/
    └── architect/
        └── skills/                          # Built-in skills
            └── architecture.skill.md
```

### Skill File Format

Skills use Markdown files with YAML frontmatter:

```markdown
---
name: Microservices Patterns
description: Guidelines for designing microservices architectures
keywords: ['microservices', 'distributed', 'architecture']
---

## Service Communication

Use async messaging for loose coupling...

## Data Management

Each service owns its data...
```

#### Frontmatter Schema

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | Yes | string | Human-readable display name |
| `description` | Yes | string | What this skill provides |
| `keywords` | No | string[] | Keywords for discovery/search |

**Source**: `src/extension/orchestrator/interfaces/skill.ts:62-69`

### How Skills Are Loaded

Skills are loaded **on-demand** through two mechanisms:

#### 1. Explicit Reference in Prompt (`#skill:name`)

Users can reference skills directly in their prompts:

```
Help me design a REST API #skill:rest-patterns #skill:error-handling
```

The `SkillsService.parseSkillReferences()` method extracts these references using regex:

```typescript
// Pattern: #skill:name
const regex = /#skill:([a-zA-Z0-9_-]+)/g;
```

**Source**: `src/extension/orchestrator/skillsService.ts:166-179`

#### 2. Agent Definition's `useSkills` Array

Agents can specify skills to always load in their frontmatter:

```yaml
---
name: Designer
description: UI Designer agent
useSkills: ['design-patterns', 'accessibility']
tools: ['search']
---
```

When this agent is invoked, the listed skills are automatically loaded.

**Source**: `src/extension/orchestrator/agentInstructionService.ts:154-166`

#### Loading Flow

```
User Prompt / Agent Invocation
         ↓
SkillsService.loadSkillsForAgent(agentId, prompt, useSkills)
         ↓
┌────────────────────────────────────────────┐
│ 1. Parse #skill:name references from prompt │
│ 2. Add skills from agent's useSkills array  │
│ 3. Deduplicate skill IDs                    │
└────────────────────────────────────────────┘
         ↓
SkillsService.getSkillsByReference(agentId, skillIds)
         ↓
┌────────────────────────────────────────────┐
│ Search in priority order:                   │
│ 1. Agent-specific skills (highest priority) │
│ 2. Global repo skills                       │
│ 3. Built-in skills (lowest priority)        │
└────────────────────────────────────────────┘
         ↓
Return ISkill[] array
```

**Source**: `src/extension/orchestrator/skillsService.ts:181-199`

### How Skills Are Merged Into Prompts

Once skills are loaded, they are formatted and injected into the agent's prompt using `formatSkillsForPrompt()`:

```typescript
export function formatSkillsForPrompt(skills: ISkill[]): string {
    if (skills.length === 0) {
        return '';
    }

    const sections: string[] = [
        '## Referenced Skills\n',
        'The following skills have been loaded to provide domain knowledge:\n',
    ];

    for (const skill of skills) {
        sections.push(`### ${skill.name}`);
        sections.push(`*${skill.description}*\n`);
        sections.push(skill.content);
        sections.push('');
    }

    return sections.join('\n');
}
```

**Source**: `src/extension/orchestrator/skillsService.ts:427-445`

#### Example Output in Prompt

When skills are loaded, they appear in the prompt like this:

```markdown
## Referenced Skills

The following skills have been loaded to provide domain knowledge:

### Microservices Patterns
*Guidelines for designing microservices architectures*

## Service Communication

Use async messaging for loose coupling...

## Data Management

Each service owns its data...

### REST API Design
*Best practices for RESTful API design*

## HTTP Methods

Use appropriate HTTP verbs...
```

#### Where Skills Appear in Composed Instructions

Skills are added to the `ComposedInstructions` after all instruction files:

```typescript
// AgentInstructionService.loadInstructions()
const result: ComposedInstructions = {
    agentId,
    instructions: [...instructions, ...skillsContent], // Skills appended here
    files: [...files, ...skillFiles],
    architectureDocs,
    architectureFiles,
};
```

**Source**: `src/extension/orchestrator/agentInstructionService.ts:177-184`

---

## Agents System

### Agent Definition Locations

| Location | Type | Description |
|----------|------|-------------|
| `assets/agents/*.agent.md` | Built-in | Shipped with extension (agent, architect, reviewer, etc.) |
| `.github/agents/*.agent.md` | Custom | Repository-specific custom agents |
| `.github/agents/{name}/{name}.agent.md` | Custom | Agent in subdirectory (with instructions) |

### Agent File Format

```yaml
---
name: Architect
description: Designs technical implementation plans with file-level specificity
hasArchitectureAccess: true
useSkills: ['design-patterns', 'architecture']
tools: ['search', 'fetch', 'usages', 'definitions', 'read_file']
backend: copilot
claudeSlashCommand: /architect
---

You are the Architect agent. You design technical implementation plans...

## Your Responsibilities

1. Analyze the codebase
2. Create implementation plans
...
```

#### Frontmatter Schema

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | Yes | string | Agent name |
| `description` | Yes | string | Agent description |
| `tools` | No | string[] | Available tools for this agent |
| `hasArchitectureAccess` | No | boolean | Can access architecture docs |
| `useSkills` | No | string[] | Skills to always load |
| `backend` | No | 'copilot' \| 'claude' | Preferred execution backend |
| `claudeSlashCommand` | No | string | Override for Claude slash command |

**Source**: `src/extension/orchestrator/agentInstructionService.ts:19-40`

---

## Instructions System

### Instruction Locations

| Location | Scope | Loaded When |
|----------|-------|-------------|
| `assets/agents/{agent}.agent.md` | Agent-specific | Agent is invoked |
| `.github/instructions/*.instructions.md` | Global | Any agent is invoked |
| `.github/agents/{agent}/*.instructions.md` | Agent-specific | That agent is invoked |

**Important**: Only files with `instructions` in their name are auto-loaded. Other files in agent folders can be read on-demand.

### Instruction Composition Order

Instructions are loaded in this order (later overrides earlier):

```
1. Built-in default       → assets/agents/{agent}.agent.md
         ↓
2. Global workspace       → .github/instructions/*.instructions.md (alphabetical)
         ↓
3. Agent-specific         → .github/agents/{agent}/*.instructions.md
         ↓
4. Skills                 → From agent's useSkills + #skill:name refs
         ↓
5. Architecture docs      → If hasArchitectureAccess: true
```

**Source**: `src/extension/orchestrator/agentInstructionService.ts:120-187`

---

## Unified Definition Service (New Architecture)

The **UnifiedDefinitionService** provides a single point of access for all definition types,
enabling sharing between GitHub Copilot Chat and Claude Agent SDK without file synchronization.

### How It Works

```
.github/                           assets/
├── commands/*.command.md          ├── commands/*.command.md
├── agents/*.agent.md       →      ├── agents/*.agent.md
├── skills/*.skill.md              ├── skills/*.skill.md
└── instructions/*.md              └── ...
         ↓
   UnifiedDefinitionService
         ↓
   ┌─────────────────────────────────────┐
   │ • discoverCommands()               │
   │ • discoverAgents()                 │
   │ • discoverSkills()                 │
   │ • getCommand(id)                   │
   │ • buildClaudeSdkAgents()           │
   │ • getInstructionsForAgent(id)      │
   └─────────────────────────────────────┘
         ↓
   ┌──────────────┬──────────────┐
   │  Copilot     │  Claude SDK  │
   │  (VS Code)   │  (Backend)   │
   └──────────────┴──────────────┘
```

### Key Features

| Feature | Description |
|---------|-------------|
| **No file generation** | Definitions loaded directly at runtime |
| **Priority ordering** | Repo definitions override built-in |
| **30-second caching** | Fast repeated access |
| **loadSkill tool** | Agents can load skills on-demand |

### loadSkill Tool

Agents can dynamically load skill content using the `loadSkill` tool:

```typescript
// Tool invocation
loadSkill({ skillId: "rest-api-design" })

// Returns the skill content (markdown)
```

The skill catalog is included in agent prompts so they know what skills are available.

### Dynamic Commands (Copilot)

Commands defined in `.github/commands/*.command.md` are discoverable at runtime:

```markdown
---
name: review-pr
description: Review a pull request thoroughly
---

Review the pull request focusing on:
1. Code quality
2. Security concerns
3. Performance implications

$ARGUMENTS
```

Users can invoke with `/review-pr 123` - the `$ARGUMENTS` placeholder is replaced with user input.

**Note**: These commands won't appear in VS Code autocomplete (API limitation), but work when typed directly.

---

## Claude Code Sync Mechanism (Legacy)

> **⚠️ Deprecated**: The migration system is disabled. The new UnifiedDefinitionService
> loads definitions directly without generating `.claude/` files.

The sync mechanism can still be run manually if needed via `ClaudeMigrationService.migrate()`.

---


## Error Propagation System

The orchestrator implements immediate error notification to ensure parent workers are promptly informed when child workers encounter errors, rather than waiting for timeouts or retry exhaustion.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Parent Worker (Orchestrator)                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ a2a_poll_subtask_updates()                                     │  │
│  │ Returns: { updates: [], errors: [...] }                        │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Error notification flow
                              │
┌─────────────────────────────────────────────────────────────────────┐
│                    Child Worker                                      │
│                                                                     │
│  On Error:                                                          │
│  1. WorkerHealthMonitor detects error                               │
│  2. recordActivity(workerId, 'error') increments consecutiveFailures│
│  3. If threshold exceeded: onWorkerUnhealthy fires                  │
│  4. WorkerSession.error(message) sets status='error'                │
│  5. Parent notified via poll_subtask_updates                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Error Types

Workers can encounter several categories of errors, each with distinct handling:

| Error Type | Description | Immediate Notification | Retry Behavior |
|------------|-------------|----------------------|----------------|
| **Rate Limit** | API provider throttling (429) | Yes | Auto-retry with backoff |
| **Network Error** | Connection failures, timeouts | Yes | Auto-retry (3 attempts) |
| **Fatal Error** | Unrecoverable failures | Yes | No retry, mark failed |
| **Tool Error** | Individual tool invocation failure | Depends on severity | Tool-specific |
| **Stuck/Looping** | Worker not making progress | Yes (via health monitor) | User intervention |

### Worker Status States

```typescript
type WorkerStatus =
  | 'idle'              // Waiting for input
  | 'running'           // Actively processing
  | 'waiting-approval'  // Needs user approval
  | 'paused'            // Manually paused
  | 'completed'         // Task done successfully
  | 'error';            // Failed with error
```

### Error Notification Flow

#### 1. Error Detection

Errors are detected at multiple levels:

```typescript
// In WorkerHealthMonitor
recordActivity(workerId: string, type: 'tool_call' | 'message' | 'error' | 'success') {
    // ...
    case 'error':
        metrics.consecutiveFailures++;
        if (metrics.consecutiveFailures >= this._config.errorThreshold) {
            this._onWorkerUnhealthy.fire({ workerId, reason: 'high_error_rate' });
        }
        break;
}
```

#### 2. Status Update

When an error occurs, the worker status is updated immediately:

```typescript
// In WorkerSession
public error(message: string): void {
    this._status = 'error';
    this._errorMessage = message;
    this._onDidChange.fire();  // Triggers parent notification
}
```

#### 3. Parent Notification via Polling

Parents receive error updates when polling for subtask updates:

```typescript
// Parent calls a2a_poll_subtask_updates()
// Response includes any worker errors:
{
    updates: [
        {
            workerId: "worker-123",
            status: "error",
            errorMessage: "Rate limit exceeded",
            errorType: "rate_limit"
        }
    ]
}
```

### Retry Behavior

The orchestrator implements automatic retry for recoverable errors:

| Scenario | Max Retries | Backoff Strategy | Parent Visibility |
|----------|-------------|------------------|-------------------|
| Rate limit (429) | 3 | Exponential (1s, 2s, 4s) | Notified on each retry |
| Network error | 3 | Linear (2s intervals) | Notified on each retry |
| Tool failure | 1 | Immediate | Notified on failure |
| Fatal error | 0 | N/A | Immediate notification |

During retries, the parent sees status updates like:

```typescript
{
    workerId: "worker-123",
    status: "running",
    retryInfo: {
        attempt: 2,
        maxAttempts: 3,
        reason: "rate_limit",
        nextRetryAt: 1702987654321
    }
}
```

### Rate Limit Scenario Example

When a worker encounters a rate limit:

```
Parent polls at T=0:
{
    updates: [{
        workerId: "worker-123",
        status: "running",
        message: "Implementing feature..."
    }]
}

Worker hits rate limit at T=1:

Parent polls at T=2:
{
    updates: [{
        workerId: "worker-123",
        status: "running",
        errorType: "rate_limit",
        retryInfo: {
            attempt: 1,
            maxAttempts: 3,
            reason: "rate_limit",
            waitingUntil: "2025-01-15T10:00:05Z",
            message: "Rate limited by API. Retrying in 3s..."
        }
    }]
}

Parent polls at T=5 (after successful retry):
{
    updates: [{
        workerId: "worker-123",
        status: "running",
        message: "Continuing implementation..."
    }]
}

--- OR if all retries exhausted ---

Parent polls at T=10:
{
    updates: [{
        workerId: "worker-123",
        status: "error",
        errorType: "rate_limit_exhausted",
        errorMessage: "Rate limit exceeded after 3 retry attempts",
        finalError: {
            code: 429,
            retryAfter: 60,
            attempts: 3
        }
    }]
}
```

### Handling Unhealthy Workers

The `WorkerHealthMonitor` detects workers that are stuck or looping:

```typescript
// Configuration thresholds
const healthConfig = {
    errorThreshold: 5,           // Consecutive failures before unhealthy
    stuckTimeoutMs: 120000,      // 2 minutes without progress
    loopDetectionWindow: 10,     // Tool calls to check for loops
};

// Unhealthy reasons
type UnhealthyReason = 'stuck' | 'looping' | 'high_error_rate';
```

When a worker becomes unhealthy:

1. `onWorkerUnhealthy` event fires with reason
2. Parent is notified immediately via next poll
3. Orchestrator can intervene (send message, restart, or escalate to user)

### Integration with SubTaskManager

The `SubTaskManager` listens for worker state changes and resolves subtask promises accordingly:

```typescript
// On worker status change to error
if (workerState.status === 'error') {
    resolveOnce({
        taskId,
        status: 'failed',
        output: workerState.messages?.map(m => m.content).join('\n') || '',
        error: workerState.errorMessage || 'Worker error',
    }, 'workerSession.onDidChange (status=error)');
}
```

This ensures that blocking subtask calls return promptly when errors occur, rather than timing out.

### Best Practices for Error Handling

1. **Poll regularly**: Parents should poll for updates frequently enough to catch errors promptly (recommended: every 5-10 seconds)

2. **Handle retry notifications**: Don't treat retry-in-progress as failures; show appropriate "waiting" UI

3. **Distinguish error types**: Rate limits are recoverable, fatal errors are not

4. **Provide context in errors**: When calling `WorkerSession.error()`, include actionable error messages

5. **Use health monitoring**: Enable health monitoring for long-running workers to catch stuck/looping states

---
## Key Services

| Service | File | Purpose |
|---------|------|---------|
| **`UnifiedDefinitionService`** | `unifiedDefinitionService.ts` | **Primary service** - unified access to commands, agents, skills |
| `SkillsService` | `skillsService.ts` | Discovers and loads skills on-demand |
| `AgentInstructionService` | `agentInstructionService.ts` | Composes instructions for agents |
| `AgentDiscoveryService` | `agentDiscoveryService.ts` | Discovers available agents |
| `ClaudeMigrationService` | `claudeMigrationService.ts` | Legacy sync to Claude Code format (disabled) |
| `WorkerHealthMonitor` | `workerHealthMonitor.ts` | Monitors worker health and detects errors |
| `SubTaskManager` | `subTaskManager.ts` | Manages subtask lifecycle and error propagation |

### Caching

All services implement 30-second TTL caching for performance:

```typescript
private readonly _cacheTtlMs = 30000; // 30 seconds
```

Cache is cleared when workspace folders change or files are modified.

---

## Quick Reference

### Adding a New Skill

1. Create `.github/skills/{skill-name}.skill.md`:
   ```yaml
   ---
   name: My Skill
   description: What this skill provides
   keywords: ['keyword1', 'keyword2']
   ---

   ## Skill Content

   Your domain knowledge here...
   ```

2. Reference in prompts: `#skill:my-skill`
3. Or add to agent's `useSkills` array

### Adding a New Agent

1. Create `.github/agents/my-agent.agent.md`:
   ```yaml
   ---
   name: MyAgent
   description: What this agent does
   tools: ['search', 'read_file']
   useSkills: ['relevant-skill']
   ---

   You are MyAgent. Your purpose is...
   ```

2. The agent is automatically discovered by `UnifiedDefinitionService`
3. Available in both Copilot Chat and Claude SDK

### Adding a New Command

1. Create `.github/commands/my-command.command.md`:
   ```yaml
   ---
   name: my-command
   description: Does something specific
   ---

   You should $ARGUMENTS...
   ```

2. Invoke with `/my-command some args` in chat
3. `$ARGUMENTS` is replaced with user input

### Adding Global Instructions

1. Create `.github/instructions/my-rules.instructions.md`
2. These apply to ALL agents automatically

### Adding Agent-Specific Instructions

1. Create `.github/agents/{agent-name}/custom.instructions.md`
2. These apply only to that agent
