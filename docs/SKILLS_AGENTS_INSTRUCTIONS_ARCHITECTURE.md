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

## Key Services

| Service | File | Purpose |
|---------|------|---------|
| **`UnifiedDefinitionService`** | `unifiedDefinitionService.ts` | **Primary service** - unified access to commands, agents, skills |
| `SkillsService` | `skillsService.ts` | Discovers and loads skills on-demand |
| `AgentInstructionService` | `agentInstructionService.ts` | Composes instructions for agents |
| `AgentDiscoveryService` | `agentDiscoveryService.ts` | Discovers available agents |
| `ClaudeMigrationService` | `claudeMigrationService.ts` | Legacy sync to Claude Code format (disabled) |

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
