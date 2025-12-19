# Unified Commands/Agents/Skills Architecture Plan

## Executive Summary

This document outlines the architecture for a unified system where commands, agents, skills, and instructions are shared between GitHub Copilot Chat and Claude Agent SDK without requiring `package.json` declarations for custom commands, and with proper prompt injection instead of shallow agent activation.

---

## Current State Analysis

### Problems with Current System

| Problem | Current Behavior | Desired Behavior |
|---------|-----------------|------------------|
| **Commands require package.json** | Must declare in `chatParticipants[].commands` | File-based discovery + package.json fallback |
| **Claude gets shallow commands** | `/architect` just activates agent | Commands inject actual prompt content |
| **Skills not shared in context** | Agents don't know available skills | Metadata in prompt + `loadSkill` tool |
| **MCPs not shared** | Only `a2a-orchestration` MCP for Claude | Share all Copilot MCPs with Claude SDK |
| **Instructions baked into commands** | Claude migration pre-bakes instructions | Runtime injection with metadata wrapper |

### Current Claude SDK Integration Point

**File**: `src/extension/agents/claude/node/claudeCodeAgent.ts:614-668`

```typescript
const options: Options = {
    cwd: workingDirectory,
    mcpServers: {
        'a2a-orchestration': a2aMcpServer  // Only this MCP today
    },
    // NO agents defined
    // NO skills provided
    // NO custom commands
};
```

---

## Proposed Architecture

### Layer Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Definition Layer (Files)                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Built-in (assets/)              │  Custom (.github/)                │
│  ├── commands/*.command.md       │  ├── commands/*.command.md       │
│  ├── agents/*.agent.md           │  ├── agents/*.agent.md           │
│  ├── skills/*.skill.md           │  ├── skills/*.skill.md           │
│  └── (package.json fallback)     │  └── instructions/*.instructions.md
│                                                                      │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Unified Discovery Service                          │
│                                                                      │
│  UnifiedDefinitionService                                           │
│  ├── discoverCommands() → CommandDefinition[]                       │
│  ├── discoverAgents() → AgentDefinition[]                           │
│  ├── discoverSkills() → SkillMetadata[]                             │
│  └── getInstructionsForAgent(agentId) → string                      │
│                                                                      │
└────────────────────────────┬────────────────────────────────────────┘
                             │
           ┌─────────────────┴─────────────────┐
           │                                   │
           ▼                                   ▼
┌─────────────────────────────┐    ┌─────────────────────────────────┐
│    Copilot Chat Backend     │    │     Claude Agent SDK Backend    │
│                             │    │                                 │
│  • Dynamic slash commands   │    │  • Options.agents = {...}       │
│  • loadSkill tool           │    │  • Options.mcpServers = {...}   │
│  • Shared MCP tools         │    │  • Skills in system prompt      │
│  • Instructions injection   │    │  • Instructions in agent prompt │
│                             │    │                                 │
└─────────────────────────────┘    └─────────────────────────────────┘
```

---

## File Format Specifications

### 1. Command Definition (`.command.md`)

**Location**: `assets/commands/*.command.md` (built-in) or `.github/commands/*.command.md` (custom)

```yaml
---
name: review-pr
description: Review a GitHub pull request for code quality issues
argumentHint: "[PR number, URL, or 'current' for current branch]"
# Optional: which agents can use this command (default: all)
agents: ['reviewer', 'agent']
---

## PR Review Guidelines

When reviewing a pull request, analyze for:

1. **Code Quality**
   - Clear variable and function naming
   - Appropriate abstraction levels
   - No code duplication

2. **Security**
   - Input validation
   - No hardcoded secrets
   - OWASP top 10 vulnerabilities

3. **Performance**
   - Efficient algorithms
   - No N+1 queries
   - Appropriate caching

$ARGUMENTS
```

**Key Points**:
- `$ARGUMENTS` placeholder is replaced with user input
- Content is injected as prompt, not just command activation
- Shared between Copilot and Claude SDK

### 2. Agent Definition (`.agent.md`) - Updated

**Aligned with Claude SDK `AgentDefinition` type**:

```yaml
---
name: architect
description: Designs technical implementation plans with file-level specificity
# Claude SDK compatible fields
tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'Task']
disallowedTools: ['Bash', 'Write', 'Edit']
model: sonnet
# Extension fields
hasArchitectureAccess: true
useSkills: ['design-patterns', 'api-design']
---

You are the Architect agent. Your role is to design implementation plans.

## Your Responsibilities

1. Analyze codebase structure
2. Identify dependencies
3. Create phased implementation plans

## Output Format

Write plans to `plans/ArchitecturePlan.md` with phases and tasks.
```

### 3. Skill Definition (`.skill.md`) - Unchanged

```yaml
---
name: REST API Design
description: Best practices for designing RESTful APIs
keywords: ['api', 'rest', 'http', 'endpoints']
---

## HTTP Methods

- GET: Retrieve resources (idempotent)
- POST: Create resources
- PUT: Replace resources (idempotent)
- PATCH: Partial update
- DELETE: Remove resources (idempotent)

## Status Codes

- 2xx: Success
- 4xx: Client error
- 5xx: Server error
...
```

---

## New Service: UnifiedDefinitionService

**File**: `src/extension/orchestrator/unifiedDefinitionService.ts`

```typescript
export interface CommandDefinition {
    id: string;                    // Derived from filename
    name: string;                  // From frontmatter
    description: string;
    argumentHint?: string;
    agents?: string[];             // Which agents can use this
    content: string;               // Markdown content (prompt injection)
    source: 'builtin' | 'repo' | 'package';
}

export interface AgentDefinitionUnified {
    id: string;
    name: string;
    description: string;
    prompt: string;                // Agent system prompt
    tools?: string[];              // Allowed tools
    disallowedTools?: string[];    // Blocked tools
    model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
    useSkills?: string[];
    hasArchitectureAccess?: boolean;
    source: 'builtin' | 'repo';
}

export interface SkillMetadata {
    id: string;
    name: string;
    description: string;
    keywords: string[];
    source: 'builtin' | 'repo';
    // Content NOT included - loaded on-demand
}

export interface IUnifiedDefinitionService {
    // Commands
    discoverCommands(): Promise<CommandDefinition[]>;
    getCommand(commandId: string): Promise<CommandDefinition | undefined>;

    // Agents
    discoverAgents(): Promise<AgentDefinitionUnified[]>;
    getAgent(agentId: string): Promise<AgentDefinitionUnified | undefined>;

    // Skills (metadata only)
    discoverSkills(): Promise<SkillMetadata[]>;
    loadSkillContent(skillId: string): Promise<string | undefined>;

    // Instructions
    getInstructionsForAgent(agentId: string): Promise<ComposedInstructions>;

    // Build Claude SDK options
    buildClaudeSdkAgents(): Promise<Record<string, AgentDefinition>>;
    buildClaudeSdkOptions(baseOptions: Partial<Options>): Promise<Options>;
}
```

---

## Integration Points

### 1. Copilot Chat UI - Dynamic Slash Commands

**Challenge**: VS Code Chat API requires commands in `package.json`

**Solution**: Use `vscode.chat.registerChatParticipantWithMetadata` (proposed API) or enhance existing participants with dynamic command discovery.

**Implementation**:

```typescript
// In chatParticipantRequestHandler.ts
class ChatParticipantRequestHandler {
    async handleRequest(request: vscode.ChatRequest, ...) {
        // Check if this is a dynamic command
        const dynamicCommand = await this.unifiedService.getCommand(request.command);
        if (dynamicCommand) {
            // Inject command content into prompt
            const augmentedPrompt = this.injectCommandContent(
                request.prompt,
                dynamicCommand.content
            );
            // Continue with augmented prompt
        }
    }
}
```

### 2. loadSkill Tool for Copilot

**New Tool**: `src/extension/tools/node/loadSkillTool.ts`

```typescript
export const loadSkillTool: IToolDefinition = {
    name: 'loadSkill',
    description: 'Load a skill to get domain-specific knowledge',
    inputSchema: {
        type: 'object',
        properties: {
            skillId: { type: 'string', description: 'The skill ID to load' }
        },
        required: ['skillId']
    },
    async execute(input: { skillId: string }): Promise<string> {
        const content = await unifiedService.loadSkillContent(input.skillId);
        if (!content) {
            return `Skill '${input.skillId}' not found. Available skills: ${availableSkills.join(', ')}`;
        }
        return content;
    }
};
```

**Skill Context in System Prompt**:

```markdown
## Available Skills

You have access to domain-specific knowledge via skills. Use the loadSkill tool to load any of these:

| Skill | Description |
|-------|-------------|
| rest-api-design | Best practices for RESTful API design |
| microservices | Microservices architecture patterns |
| security | Security best practices and OWASP guidelines |

Example: loadSkill({ skillId: "rest-api-design" })
```

### 3. Claude SDK Integration

**Updated**: `src/extension/agents/claude/node/claudeCodeAgent.ts`

```typescript
async _startClaudeQuery(prompt: string) {
    // Get unified definitions
    const agents = await this.unifiedService.buildClaudeSdkAgents();
    const skills = await this.unifiedService.discoverSkills();
    const mcpServers = await this.buildSharedMcpServers();

    // Build skills metadata for system prompt
    const skillsPrompt = this.formatSkillsMetadata(skills);

    // Get instructions for current agent
    const instructions = await this.unifiedService.getInstructionsForAgent(
        this._currentAgentId
    );

    const options: Options = {
        cwd: workingDirectory,
        abortController: this._abortController,
        model: "claude-opus-4-5",

        // NEW: Inject discovered agents
        agents: agents,

        // NEW: Share all MCPs
        mcpServers: {
            'a2a-orchestration': a2aMcpServer,
            ...mcpServers  // Additional shared MCPs
        },

        // Existing hooks preserved
        hooks: { ... },
    };

    // Inject skills + instructions into prompt
    const augmentedPrompt = this.wrapWithContext(prompt, {
        skills: skillsPrompt,
        instructions: instructions.instructions.join('\n'),
    });

    this._queryGenerator = await this.claudeCodeService.query({
        prompt: this._createPromptIterable(augmentedPrompt),
        options
    });
}
```

### 4. Instructions Wrapper

**Format for injected instructions**:

```markdown
<custom-instructions source="repo" agent="architect">
## Repository Custom Instructions

These instructions are defined by the repository maintainers:

[Content from .github/instructions/ and .github/agents/{agent}/*.instructions.md]

</custom-instructions>
```

---

## Preserving Existing Systems

### Health Monitor - NO CHANGES

**Files to preserve**:
- `workerHealthMonitor.ts` - Health metrics tracking
- `workerSession.ts` - Session management
- `subTaskManager.ts` - Subtask lifecycle

These are consumed by `ClaudeCodeAgentExecutor` and don't need modification.

### Worktree Management - NO CHANGES

**Files to preserve**:
- `claudeWorktreeSession.ts` - Worktree-scoped sessions
- `ClaudeAgentManager.getOrCreateWorktreeSession()` - Session factory

### Migration Service - DISABLE ON INIT

**Change**: Don't call migration on initialization, but keep code for manual use.

```typescript
// In extension.ts
async function runClaudeMigration(...) {
    // DISABLED: Migration no longer needed with unified system
    // Keep code for potential manual regeneration
    return;
}
```

---

## Migration Path

### Phase 1: Add UnifiedDefinitionService
1. Create `UnifiedDefinitionService`
2. Merge `AgentDiscoveryService`, `SkillsService`, `AgentInstructionService` logic
3. Add `CommandDefinition` support
4. Unit tests

### Phase 2: Add loadSkill Tool
1. Create `loadSkillTool.ts`
2. Register with Copilot tools
3. Add skill metadata to agent prompts
4. Integration tests

### Phase 3: Update Claude SDK Integration
1. Modify `ClaudeCodeSession` to use `UnifiedDefinitionService`
2. Inject `agents` into SDK Options
3. Share MCPs from Copilot
4. Wrap instructions with metadata tags
5. E2E tests

### Phase 4: Dynamic Commands for Copilot
1. Investigate VS Code API options
2. Implement dynamic command discovery
3. Command content injection
4. UI integration tests

### Phase 5: Cleanup
1. Disable migration on init
2. Remove duplicate code
3. Update documentation
4. Performance testing

---

## Open Questions

1. **VS Code Dynamic Commands**: Does `chatParticipantPrivate` API support dynamic commands, or do we need a workaround?

2. **MCP Server Sharing**: Which existing Copilot MCPs should be shared with Claude SDK? All of them, or a curated list?

3. **Backward Compatibility**: Should we support the old `.claude/commands/` format during a transition period?

4. **Skill Caching**: Should loaded skills be cached per-session, or refreshed on each load?

---

## Files to Create/Modify

### New Files
- `src/extension/orchestrator/unifiedDefinitionService.ts`
- `src/extension/tools/node/loadSkillTool.ts`
- `assets/commands/*.command.md` (built-in commands)

### Modified Files
- `src/extension/agents/claude/node/claudeCodeAgent.ts` - SDK Options injection
- `src/extension/orchestrator/executors/claudeCodeAgentExecutor.ts` - Use unified service
- `src/extension/conversation/vscode-node/chatParticipants.ts` - Dynamic commands
- `src/extension/extension/vscode-node/extension.ts` - Disable migration

### Preserved Files (NO CHANGES)
- `src/extension/orchestrator/workerHealthMonitor.ts`
- `src/extension/orchestrator/workerSession.ts`
- `src/extension/orchestrator/subTaskManager.ts`
- `src/extension/agents/claude/node/claudeWorktreeSession.ts`
- `src/extension/orchestrator/orchestratorServiceV2.ts`

---

## Success Criteria

1. **Commands work without package.json**: Custom commands from `.github/commands/` appear in chat
2. **Commands inject content**: `/review-pr` injects review guidelines, not just activates agent
3. **Skills discoverable**: Agents know available skills and can load on-demand
4. **MCPs shared**: Claude SDK has access to same tools as Copilot
5. **Instructions wrapped**: Custom instructions have metadata tags for transparency
6. **Health monitoring intact**: Worker health, stuck detection, loop detection all work
7. **Worktrees intact**: Worktree-scoped sessions continue working
