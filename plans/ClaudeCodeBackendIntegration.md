# Claude Code Backend Integration & Formalized Agent Configuration

> **Status:** Planning
> **Created:** December 15, 2025
> **Last Updated:** December 15, 2025
> **Authors:** Copilot Architect + User

---

## Overview

This plan enables Claude Code as a functional orchestrator backend and formalizes the Skills and Architecture document patterns. The implementation wires up existing dead code, establishes a 3-level backend selection hierarchy, and creates specialized agents for architecture access.

**Key Deliverables:**
1. Wire up existing but unused `AgentExecutorRegistry` and `ClaudeCodeAgentExecutor`
2. Implement 3-level backend selection: User Request > Repo Config > Extension Defaults
3. Formalize Skills as explicitly referenceable knowledge modules
4. Restrict Architecture document access to specialized agents (`architect`, `repository-researcher`)
5. Auto-generate Claude Code configuration files from `.github/agents/`
6. Ensure custom agents work with Claude Code backend

---

## Problem Statement / Motivation

### Critical Discovery: Dead Code Pattern

The infrastructure for Claude Code backend **already exists** but is completely disconnected:

| Component | File | Status |
|-----------|------|--------|
| `AgentExecutorRegistry` | `agentExecutorRegistry.ts` | ✅ Implemented, ❌ Never instantiated |
| `registerBuiltInExecutors()` | `agentExecutorRegistry.ts:92` | ✅ Implemented, ❌ 0 external references |
| `ClaudeCodeAgentExecutor` | `executors/claudeCodeAgentExecutor.ts` | ✅ Implemented, ❌ Never used |
| `CopilotAgentExecutor` | `executors/copilotAgentExecutor.ts` | ✅ Implemented, ❌ Never used |
| `IAgentExecutorRegistry` | `services.ts` | ❌ Not registered as service |
| `IClaudeAgentManager` | `services.ts` | ❌ Not registered as service |

### Hardcoded Backend Rejection

In `orchestratorServiceV2.ts` lines 1510-1518:
```typescript
// Currently only Copilot backend is supported
if (parsedAgentType.backend !== 'copilot') {
    throw new Error(
        `Unsupported backend '${parsedAgentType.backend}' for task ${task.id}.\n` +
        `Agent type: ${rawAgentType}\n\n` +
        `Currently supported:\n` +
        `- Copilot agents: @agent, @architect, @reviewer\n\n` +
        `Please use Copilot agent types.`
    );
}
```

### Informal Patterns Needing Formalization

1. **Skills**: Users create `SKILLS.instructions.md` informally - no schema, always loaded
2. **Architecture**: All instructions loaded into every prompt, wasting tokens
3. **Backend Selection**: No way to choose between copilot/claude backends

---

## Proposed Solution

### Backend Selection Hierarchy (3 Levels)

```
┌─────────────────────────────────────────────────────────────┐
│ Priority 1 (Highest): User Request                          │
│   - Prompt syntax: "use claude for this" or "claude:agent"  │
│   - UI: Backend selector in orchestrator panel              │
├─────────────────────────────────────────────────────────────┤
│ Priority 2: Repository Configuration                        │
│   - File: .github/agents/config.yaml                        │
│   - Per-agent backend and model preferences                 │
├─────────────────────────────────────────────────────────────┤
│ Priority 3 (Lowest): Extension Defaults                     │
│   - Setting: github.copilot.orchestrator.defaultBackend     │
│   - Default value: "copilot"                                │
└─────────────────────────────────────────────────────────────┘
```

### Skills: Explicitly Referenceable Knowledge Modules

Skills are domain-specific knowledge that agents can reference on-demand:

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

## Service Communication
...
```

**Loading Mechanism:**
- Skills are **NOT** auto-loaded into prompts
- Agents explicitly reference skills: `#skill:microservices`
- Alternative: Agent instructions can include `useSkills: [microservices, design-patterns]`

**Comparison with Instructions:**

| Aspect | Instructions | Skills |
|--------|-------------|--------|
| Loading | Always loaded | Explicitly referenced |
| Purpose | Behavioral rules | Domain knowledge |
| Location | `*.instructions.md` | `skills/*.skill.md` |
| Example | "Use tabs not spaces" | "Microservices patterns" |

### Architecture Documents: Restricted Access via Specialized Agents

Architecture documents are **only** available to specific agents:

**Architecture-Aware Agents:**
- `architect` - System design, needs full architecture context
- `repository-researcher` (NEW) - Investigates codebase, answers architecture questions

**Access Pattern for Other Agents:**
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

**Repository-Researcher Agent:**
```yaml
# assets/agents/RepositoryResearcher.agent.md
---
name: Repository Researcher
description: Investigates codebase architecture, patterns, and best practices
hasArchitectureAccess: true
tools:
  - search_workspace
  - read_file
  - semantic_search
  - grep_search
---
You are a repository researcher with deep knowledge of this codebase.

You have access to architecture documents that describe system design.

When consulted by other agents:
1. Search relevant architecture docs in .github/agents/*/architecture/
2. Analyze existing codebase patterns
3. Provide guidance based on established conventions
```

### Custom Agents: Claude Backend Compatibility

Custom agents (`.agent.md` files in `.github/agents/`) already work for Copilot. This plan ensures:
- Custom agent names are parsed correctly by `agentTypeParser.ts`
- Claude slash commands are auto-generated: `my-agent` → `/my-agent`
- Custom agents appear in Claude migration output

---

## Technical Considerations

### Architecture Changes

1. **Service Registration**: Register `IAgentExecutorRegistry` and `IClaudeAgentManager` in `services.ts`
2. **Remove Hardcoded Rejection**: Replace backend check with executor registry lookup
3. **Backend Selection Service**: New service implementing 3-level precedence
4. **Skills Service**: Discover and load skills on explicit reference
5. **Architecture Access Control**: `hasArchitectureAccess` flag in agent schema

### File Structure Conventions

```
.github/
├── agents/
│   ├── config.yaml                    # Global agent configuration
│   ├── architect/
│   │   ├── architect.agent.md         # Agent definition
│   │   ├── architect.instructions.md  # Always-loaded instructions
│   │   ├── skills/
│   │   │   ├── design-patterns.skill.md
│   │   │   └── cloud-native.skill.md
│   │   └── architecture/
│   │       ├── system-overview.architecture.md
│   │       └── database-schema.architecture.md
│   ├── repository-researcher/
│   │   └── repository-researcher.agent.md
│   └── orchestrator/
│       └── permissions.yaml
├── instructions/                      # Global instructions (all agents)
│   └── coding-standards.instructions.md
└── claude/                            # Auto-generated for Claude Code
    └── CLAUDE.md
```

### Claude Code Preparation Flow

```
First Claude task requested
         │
         ▼
Check if .github/claude/CLAUDE.md exists
         │
         ├── Yes: Use existing
         │
         └── No: Run migration
                  │
                  ▼
         Read .github/agents/
                  │
                  ▼
         Generate CLAUDE.md with:
         - Consolidated agent instructions
         - Available agents list
         - Slash command documentation
         - Skills reference
                  │
                  ▼
         Launch Claude session
```

---

## Acceptance Criteria

### Phase 1: Wire Up Dead Code
- [ ] `IAgentExecutorRegistry` registered as service
- [ ] `IClaudeAgentManager` registered as service
- [ ] `registerBuiltInExecutors()` called during initialization
- [ ] Backend rejection removed from `orchestratorServiceV2.ts`
- [ ] Tasks with `claude:agent` route to `ClaudeCodeAgentExecutor`

### Phase 2: Backend Selection
- [ ] User can specify backend via prompt syntax (`claude:architect`)
- [ ] `.github/agents/config.yaml` parsed for default backends
- [ ] VS Code setting `github.copilot.orchestrator.defaultBackend` works
- [ ] 3-level precedence correctly applied

### Phase 3: Skills Formalization
- [ ] `.skill.md` files discovered in `skills/` subdirectories
- [ ] Skills have YAML frontmatter (name, description, keywords)
- [ ] `#skill:name` syntax loads skill into prompt
- [ ] Agent definitions can specify `useSkills` array

### Phase 4: Architecture Access Control
- [ ] `hasArchitectureAccess` flag in agent schema
- [ ] `architect` agent has access by default
- [ ] `repository-researcher` agent created with access
- [ ] Architecture docs NOT loaded for other agents
- [ ] A2A pattern documented for architecture queries

### Phase 5: Claude Code Preparation
- [ ] Migration triggered on first Claude task
- [ ] `CLAUDE.md` generated with agent documentation
- [ ] Slash commands generated for all agents
- [ ] Migration is idempotent

### Phase 6: Custom Agent Claude Support
- [ ] Custom agent names parsed by `agentTypeParser.ts`
- [ ] Claude slash commands generated for custom agents
- [ ] Custom agents listed in `CLAUDE.md`

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Claude tasks execute without errors | 100% |
| Backend selection follows precedence | 100% |
| Skills only load when referenced | Verified |
| Architecture docs not in non-architect prompts | Verified |
| Migration completes without errors | 100% |

---

## Dependencies & Risks

### Dependencies
- Claude Code SDK availability
- Claude API key configured
- Git worktree support

### Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing Copilot flows | High | Feature flag, extensive testing |
| Claude session management issues | Medium | Reuse existing ClaudeAgentManager patterns |
| Skills over-engineering | Low | Start with explicit reference only |
| Migration edge cases | Medium | Thorough error handling, manual override |

---

## Implementation Phases

### Phase 1: Wire Up Existing Dead Code
**Objective**: Make the existing executor registry functional

**Tasks**:
1. [ ] Register `IAgentExecutorRegistry` as service in `services.ts` using `SyncDescriptor(AgentExecutorRegistry)`
2. [ ] Register `IClaudeAgentManager` as service in `services.ts`
3. [ ] Call `registerBuiltInExecutors()` in orchestrator initialization (likely in `OrchestratorService` constructor or contribution)
4. [ ] Remove hardcoded backend rejection in `orchestratorServiceV2.ts` lines 1510-1518
5. [ ] Update `_runWorkerTask()` to use `IAgentExecutorRegistry.getExecutor(parsedType).execute()` instead of direct `_agentRunner.run()`
6. [ ] Add unit tests for executor registry routing

**Depends on**: None
**Estimated Time**: 2 days
**Success Criteria**: `claude:agent` tasks route to ClaudeCodeAgentExecutor without throwing

---

### Phase 2: Backend Selection Service
**Objective**: Implement 3-level precedence for backend selection

**Tasks**:
1. [ ] Create `IBackendSelectionService` interface in `src/extension/orchestrator/backendSelectionService.ts`
2. [ ] Implement `BackendSelectionService` with methods:
   - `selectBackend(prompt: string, agentId: string): AgentBackendType`
   - `getDefaultBackend(agentId: string): AgentBackendType`
3. [ ] Add VS Code setting `github.copilot.orchestrator.defaultBackend` to `package.json`
4. [ ] Create schema for `.github/agents/config.yaml`:
   ```yaml
   version: 1
   defaults:
     backend: copilot
   agents:
     architect:
       backend: claude
       model: claude-4-5-sonnet
   ```
5. [ ] Implement config.yaml parsing in `AgentInstructionService` or new `AgentConfigService`
6. [ ] Integrate backend selection into task deployment flow
7. [ ] Add unit tests for precedence logic

**Depends on**: Phase 1
**Estimated Time**: 3 days
**Success Criteria**: Backend selection follows User Request > Repo Config > Defaults

---

### Phase 3: Skills Formalization
**Objective**: Formalize skills as explicitly referenceable knowledge modules

**Tasks**:
1. [ ] Define `ISkill` interface:
   ```typescript
   interface ISkill {
     id: string;
     name: string;
     description: string;
     keywords: string[];
     content: string;
     source: 'builtin' | 'repo';
   }
   ```
2. [ ] Create `ISkillsService` interface with methods:
   - `discoverSkills(agentId: string): Promise<ISkill[]>`
   - `getSkill(agentId: string, skillId: string): Promise<ISkill | undefined>`
   - `getSkillsByReference(agentId: string, refs: string[]): Promise<ISkill[]>`
3. [ ] Implement `SkillsService` scanning `.github/agents/{agentId}/skills/*.skill.md`
4. [ ] Implement YAML frontmatter parsing for `.skill.md` files
5. [ ] Add `#skill:name` reference parsing in prompt processing
6. [ ] Extend `AgentDefinition` interface with `useSkills?: string[]`
7. [ ] Integrate skill loading into `AgentInstructionService.loadInstructions()`
8. [ ] Add unit tests for skill discovery and loading

**Depends on**: None (can parallel with Phase 2)
**Estimated Time**: 3 days
**Success Criteria**: Skills discovered, loaded only when explicitly referenced

---

### Phase 4: Architecture Access & Repository-Researcher Agent
**Objective**: Restrict architecture access to specialized agents

**Tasks**:
1. [ ] Add `hasArchitectureAccess: boolean` to `AgentDefinition` interface
2. [ ] Create `RepositoryResearcher.agent.md` in `assets/agents/` with:
   - `hasArchitectureAccess: true`
   - Tools: search_workspace, read_file, semantic_search, grep_search
   - System prompt for codebase investigation
3. [ ] Modify `AgentInstructionService` to:
   - Scan `.architecture.md` files in `architecture/` subdirectories
   - Only load architecture docs for agents with `hasArchitectureAccess: true`
4. [ ] Set `hasArchitectureAccess: true` for `architect` agent (in builtin definition)
5. [ ] Update agent discovery to include `repository-researcher`
6. [ ] Document A2A pattern: other agents spawn subtasks to architect/repository-researcher for architecture queries
7. [ ] Add unit tests for architecture access control

**Depends on**: None (can parallel with Phase 2, 3)
**Estimated Time**: 2 days
**Success Criteria**: Architecture docs loaded only for architect and repository-researcher

---

### Phase 5: Claude Code Dynamic Preparation
**Objective**: Auto-generate Claude-specific files from .github/agents

**Tasks**:
1. [ ] Create `IClaudeMigrationService` interface with methods:
   - `shouldMigrate(): Promise<boolean>`
   - `migrate(): Promise<void>`
   - `getMigrationStatus(): MigrationStatus`
2. [ ] Implement migration check: exists `.github/claude/CLAUDE.md`?
3. [ ] Create CLAUDE.md template generator:
   ```markdown
   # Claude Code Configuration

   ## Available Agents
   - /agent - Default implementation agent
   - /architect - System design and planning
   - /reviewer - Code review
   - /repository-researcher - Codebase investigation

   ## Custom Agents
   - /my-custom-agent - [description from .agent.md]

   ## Instructions
   [Consolidated from .github/agents/*/instructions]
   ```
4. [ ] Implement instruction consolidation for Claude format
5. [ ] Generate slash command documentation
6. [ ] Add migration state persistence (marker file or frontmatter)
7. [ ] Add VS Code command for manual re-migration
8. [ ] Add unit tests for migration logic

**Depends on**: Phase 1
**Estimated Time**: 3 days
**Success Criteria**: First Claude task auto-generates .github/claude/CLAUDE.md

---

### Phase 6: Custom Agent Claude Support
**Objective**: Ensure custom agents work with Claude Code backend

**Tasks**:
1. [ ] Verify `agentTypeParser.ts` handles custom agent names from `.agent.md` discovery
2. [ ] Generate Claude slash commands for custom agents: `my-agent` → `/my-agent`
3. [ ] Update `CLAUDE_SLASH_COMMANDS` map in `agentTypeParser.ts` to be dynamic
4. [ ] Include custom agents in Claude migration output
5. [ ] Add validation: custom agent names don't conflict with built-in names
6. [ ] Add integration test: custom agent with `backend: claude` specified

**Depends on**: Phase 1, Phase 5
**Estimated Time**: 2 days
**Success Criteria**: Custom agents usable via Claude Code backend

---

### Phase 7: Integration Testing & Documentation
**Objective**: Validate all components work together

**Tasks**:
1. [ ] End-to-end test: Copilot → Claude backend switch mid-plan
2. [ ] End-to-end test: Skill reference loading
3. [ ] End-to-end test: Architecture doc access control
4. [ ] End-to-end test: Custom agent with Claude backend
5. [ ] End-to-end test: Repository-researcher A2A consultation
6. [ ] Update `docs/a2a-configuration.md` with:
   - config.yaml schema
   - Skills pattern documentation
   - Architecture access patterns
7. [ ] Create `docs/skills-guide.md`
8. [ ] Update `docs/orchestrator-readme.md` with backend selection

**Depends on**: Phase 1-6
**Estimated Time**: 2 days
**Success Criteria**: All integration tests pass, documentation complete

---

## File Reference

### Files to Create

| File | Purpose |
|------|---------|
| `src/extension/orchestrator/backendSelectionService.ts` | 3-level precedence backend selection |
| `src/extension/orchestrator/skillsService.ts` | Skills discovery and loading |
| `src/extension/orchestrator/claudeMigrationService.ts` | Claude file auto-generation |
| `src/extension/orchestrator/interfaces/skill.ts` | ISkill interface |
| `assets/agents/RepositoryResearcher.agent.md` | Repository researcher agent |
| `docs/skills-guide.md` | Skills pattern documentation |

### Files to Modify

| File | Changes |
|------|---------|
| `src/extension/extension/vscode-node/services.ts` | Register IAgentExecutorRegistry, IClaudeAgentManager |
| `src/extension/orchestrator/orchestratorServiceV2.ts` | Remove backend rejection (L1510-1518), use executor registry |
| `src/extension/orchestrator/agentInstructionService.ts` | Add skills loading, architecture access control |
| `src/extension/orchestrator/agentExecutorRegistry.ts` | Ensure initialization called |
| `src/extension/orchestrator/agentTypeParser.ts` | Dynamic slash command generation |
| `package.json` | Add `github.copilot.orchestrator.defaultBackend` setting |
| `assets/agents/Architect.agent.md` | Add `hasArchitectureAccess: true` |

### Existing Files (Reference)

| File | Notes |
|------|-------|
| `src/extension/orchestrator/agentTypeParser.ts` | Already supports `claude:agent` syntax |
| `src/extension/orchestrator/executors/claudeCodeAgentExecutor.ts` | Ready but unused |
| `src/extension/orchestrator/executors/copilotAgentExecutor.ts` | Reference implementation |
| `src/extension/agents/claude/node/claudeCodeAgent.ts` | ClaudeAgentManager implementation |
| `src/extension/conversation/node/chatSessions.ts` | Shows how Claude is currently instantiated |

---

## Schema Definitions

### config.yaml Schema

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

### Skill File Schema

```yaml
# .github/agents/{agent}/skills/{name}.skill.md
---
name: string              # Required: Human-readable name
description: string       # Required: What this skill provides
keywords: string[]        # Optional: For discovery/search
---
# Markdown content with domain knowledge
```

### Architecture Document Schema

```yaml
# .github/agents/{agent}/architecture/{name}.architecture.md
---
name: string              # Required: Document name
description: string       # Required: What this document covers
lastUpdated: date         # Optional: For staleness detection
---
# Markdown content describing architecture
```

### Agent Definition Schema (Enhanced)

```yaml
# .github/agents/{agent}/{agent}.agent.md
---
name: string              # Required: Agent name
description: string       # Required: What this agent does
backend: copilot|claude   # Optional: Preferred backend
hasArchitectureAccess: boolean  # Optional: Can load architecture docs
useSkills: string[]       # Optional: Skills to always load
tools: string[]           # Optional: Allowed tools
claudeSlashCommand: string  # Optional: Claude slash command override
---
# Agent system prompt / instructions
```
