# Unified Commands Architecture - Implementation Plan

**Architecture Document**: `docs/UNIFIED_COMMANDS_ARCHITECTURE_PLAN.md`

## Overview

This plan implements the unified commands/agents/skills architecture that allows sharing between GitHub Copilot Chat and Claude Agent SDK without requiring package.json declarations.

---

## Phase 1: UnifiedDefinitionService Foundation

**Objective**: Create the core service that discovers and manages all definitions

**Depends on**: None
**Estimated Complexity**: High
**Can parallelize**: Yes (1.1 and 1.2 can run in parallel after 1.1a)

### Task 1.1: Core Service Implementation `@agent`
**Files to create/modify**:
- `src/extension/orchestrator/unifiedDefinitionService.ts` (NEW)
- `src/extension/orchestrator/interfaces/definitions.ts` (NEW)

**Requirements**:
1. Create `IUnifiedDefinitionService` interface with methods:
   - `discoverCommands(): Promise<CommandDefinition[]>`
   - `getCommand(commandId: string): Promise<CommandDefinition | undefined>`
   - `discoverAgents(): Promise<AgentDefinitionUnified[]>`
   - `getAgent(agentId: string): Promise<AgentDefinitionUnified | undefined>`
   - `discoverSkills(): Promise<SkillMetadata[]>`
   - `loadSkillContent(skillId: string): Promise<string | undefined>`
   - `getInstructionsForAgent(agentId: string): Promise<ComposedInstructions>`
   - `buildClaudeSdkAgents(): Promise<Record<string, AgentDefinition>>`

2. Create type definitions in `interfaces/definitions.ts`:
   - `CommandDefinition` - id, name, description, argumentHint, agents, content, source
   - `AgentDefinitionUnified` - aligned with Claude SDK AgentDefinition
   - `SkillMetadata` - id, name, description, keywords, source (no content)

3. Implement discovery methods that:
   - Check `assets/commands/`, `assets/agents/`, `assets/skills/` for built-ins
   - Check `.github/commands/`, `.github/agents/`, `.github/skills/` for repo-defined
   - Parse YAML frontmatter from `.command.md`, `.agent.md`, `.skill.md` files
   - Use 30-second TTL caching like existing services

4. Delegate to existing services where appropriate:
   - Use `AgentInstructionService.loadInstructions()` for instructions
   - Use `SkillsService` logic for skill content loading

### Task 1.2: Command Discovery Implementation `@agent`
**Files to modify**:
- `src/extension/orchestrator/unifiedDefinitionService.ts`

**Requirements**:
1. Implement `_discoverBuiltinCommands()`:
   - Scan `assets/commands/*.command.md`
   - Parse YAML frontmatter (name, description, argumentHint, agents)
   - Extract markdown content after frontmatter

2. Implement `_discoverRepoCommands()`:
   - Scan `.github/commands/*.command.md` in workspace folders
   - Same parsing logic as built-in

3. Implement `getCommand(commandId)`:
   - Check cache first
   - Search repo commands (higher priority) then built-in
   - Return CommandDefinition with content

### Task 1.3: Service Registration `@agent`
**Files to modify**:
- `src/extension/extension/vscode-node/services.ts`
- `src/extension/orchestrator/configuration.ts` (if needed)

**Requirements**:
1. Register `IUnifiedDefinitionService` with service collection
2. Inject dependencies: `IFileSystemService`, `IVSCodeExtensionContext`, `IAgentInstructionService`, `ISkillsService`
3. Ensure service is available for injection into other services

### Task 1.4: Unit Tests `@tester`
**Files to create**:
- `src/extension/orchestrator/test/unifiedDefinitionService.spec.ts`

**Requirements**:
1. Test command discovery from mock file system
2. Test agent discovery and SDK format conversion
3. Test skill metadata extraction (without content)
4. Test caching behavior
5. Test priority ordering (repo overrides built-in)

---

## Phase 2: loadSkill Tool for Copilot

**Objective**: Create a tool that lets Copilot agents load skill content on-demand

**Depends on**: Phase 1 (Task 1.1)
**Estimated Complexity**: Medium
**Can parallelize**: Tasks 2.1 and 2.2 can run in parallel

### Task 2.1: loadSkill Tool Implementation `@agent`
**Files to create**:
- `src/extension/tools/node/loadSkillTool.ts` (NEW)

**Requirements**:
1. Create tool definition following existing tool patterns in `src/extension/tools/`
2. Input schema: `{ skillId: string }`
3. Use `IUnifiedDefinitionService.loadSkillContent()` to fetch content
4. Return skill content or error message with available skills list
5. Format output as markdown

### Task 2.2: Tool Registration `@agent`
**Files to modify**:
- `src/extension/tools/vscode-node/tools.ts`
- `src/extension/tools/common/toolNames.ts`

**Requirements**:
1. Add `LoadSkill` to `ToolName` enum
2. Register tool in tools contribution
3. Make tool available to all agents (not restricted)

### Task 2.3: Skill Metadata in Agent Prompts `@agent`
**Files to modify**:
- `src/extension/orchestrator/agentInstructionService.ts`
- `src/extension/prompts/node/panel/customInstructions.tsx` (if applicable)

**Requirements**:
1. When composing instructions for an agent, include skill metadata section:
   ```markdown
   ## Available Skills

   Use loadSkill({ skillId: "..." }) to load domain knowledge:

   | Skill | Description |
   |-------|-------------|
   | rest-api-design | Best practices for RESTful API design |
   ...
   ```
2. Get skill metadata from `IUnifiedDefinitionService.discoverSkills()`
3. Only include metadata, not full content

### Task 2.4: Integration Tests `@tester`
**Files to create**:
- `src/extension/tools/test/node/loadSkillTool.spec.ts`

**Requirements**:
1. Test tool execution with valid skill ID
2. Test tool execution with invalid skill ID
3. Test skill content formatting
4. Test integration with UnifiedDefinitionService

---

## Phase 3: Claude SDK Integration Updates

**Objective**: Update ClaudeCodeSession to use unified definitions and share MCPs

**Depends on**: Phase 1 (all tasks)
**Estimated Complexity**: High
**Can parallelize**: Tasks 3.1, 3.2, 3.3 can run in parallel after 3.0

### Task 3.0: Research MCP Sharing `@researcher`
**Goal**: Investigate which MCPs are available in Copilot and how to share them

**Requirements**:
1. Find all MCP server configurations in the codebase
2. Identify which MCPs are configured for Copilot tools
3. Determine how to convert them to Claude SDK format
4. Document findings for Task 3.2

### Task 3.1: Inject Agents into SDK Options `@agent`
**Files to modify**:
- `src/extension/agents/claude/node/claudeCodeAgent.ts`

**Requirements**:
1. Add dependency on `IUnifiedDefinitionService`
2. In `_startClaudeQuery()`, call `buildClaudeSdkAgents()` to get agent definitions
3. Add `agents` property to Options object
4. Ensure agent format matches Claude SDK `AgentDefinition` type:
   ```typescript
   {
     description: string;
     tools?: string[];
     disallowedTools?: string[];
     prompt: string;
     model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
   }
   ```

### Task 3.2: Share MCPs with Claude SDK `@agent`
**Files to modify**:
- `src/extension/agents/claude/node/claudeCodeAgent.ts`

**Requirements**:
1. Create method `_buildSharedMcpServers()` that returns MCP configs
2. Include existing `a2a-orchestration` MCP
3. Add additional MCPs based on research from Task 3.0
4. Merge into `mcpServers` in Options

### Task 3.3: Instructions Wrapper `@agent`
**Files to modify**:
- `src/extension/agents/claude/node/claudeCodeAgent.ts`
- `src/extension/orchestrator/executors/claudeCodeAgentExecutor.ts`

**Requirements**:
1. When activating a specific agent, wrap custom instructions in metadata:
   ```markdown
   <custom-instructions source="repo" agent="architect">
   ## Repository Custom Instructions

   [Instructions content here]

   </custom-instructions>
   ```
2. Get instructions from `IUnifiedDefinitionService.getInstructionsForAgent(agentId)`
3. Inject into prompt before sending to Claude SDK

### Task 3.4: E2E Tests `@tester`
**Files to create**:
- `src/extension/agents/claude/node/test/claudeSdkIntegration.spec.ts`

**Requirements**:
1. Test that agents are correctly injected into SDK Options
2. Test that MCPs are shared
3. Test that instructions are wrapped with metadata
4. Mock Claude SDK to verify Options format

---

## Phase 4: Dynamic Commands for Copilot

**Objective**: Make file-based commands appear in VS Code Chat UI

**Depends on**: Phase 1 (Task 1.2)
**Estimated Complexity**: High (may require VS Code API investigation)
**Can parallelize**: Tasks 4.1 and 4.2 are sequential

### Task 4.0: Research VS Code Chat API `@researcher`
**Goal**: Investigate dynamic command registration options

**Requirements**:
1. Check `vscode.proposed.chatParticipantAdditions.d.ts` for dynamic command APIs
2. Check if `chatParticipantPrivate` supports runtime command addition
3. Investigate if commands can be updated after participant registration
4. Document findings and recommend approach

### Task 4.1: Dynamic Command Discovery `@agent`
**Files to modify**:
- `src/extension/conversation/vscode-node/chatParticipants.ts`

**Requirements**:
1. On participant creation, discover available commands via `IUnifiedDefinitionService`
2. If VS Code API supports dynamic commands, register them
3. If not, implement fallback: detect command in prompt and handle dynamically

### Task 4.2: Command Content Injection `@agent`
**Files to modify**:
- `src/extension/prompt/node/chatParticipantRequestHandler.ts`

**Requirements**:
1. When handling a request with a slash command:
   - Check if command exists in UnifiedDefinitionService
   - If found, inject command content into prompt
   - Replace `$ARGUMENTS` placeholder with user input
2. Continue with augmented prompt through normal flow

### Task 4.3: Integration Tests `@tester`
**Files to create**:
- `src/extension/conversation/vscode-node/test/dynamicCommands.spec.ts`

**Requirements**:
1. Test command discovery from file system
2. Test command content injection
3. Test $ARGUMENTS placeholder replacement
4. Test fallback behavior

---

## Phase 5: Cleanup and Migration

**Objective**: Disable migration on init, cleanup duplicate code, update docs

**Depends on**: Phases 1-4 complete
**Estimated Complexity**: Low
**Can parallelize**: All tasks can run in parallel

### Task 5.1: Disable Migration on Init `@agent`
**Files to modify**:
- `src/extension/extension/vscode-node/extension.ts`

**Requirements**:
1. Comment out or disable `runClaudeMigration()` call
2. Keep the code for potential manual use
3. Add comment explaining why disabled

### Task 5.2: Update Documentation `@agent`
**Files to modify**:
- `docs/SKILLS_AGENTS_INSTRUCTIONS_ARCHITECTURE.md`
- `docs/UNIFIED_COMMANDS_ARCHITECTURE_PLAN.md`
- `CLAUDE.md` (update auto-generation note)

**Requirements**:
1. Update architecture doc to reflect new unified system
2. Add examples of `.command.md` format
3. Document loadSkill tool usage
4. Update any outdated references

### Task 5.3: Performance Testing `@tester`
**Requirements**:
1. Measure discovery time for commands/agents/skills
2. Verify cache is working (second call should be fast)
3. Test with large number of definitions
4. Ensure no regression in startup time

---

## Dependency Graph

```
Phase 1 (Foundation)
├── Task 1.1: Core Service ────┐
├── Task 1.2: Command Discovery │
├── Task 1.3: Registration      │
└── Task 1.4: Tests            │
                               │
Phase 2 (loadSkill)            │
├── Task 2.1: Tool ←───────────┤
├── Task 2.2: Registration     │
├── Task 2.3: Skill Metadata   │
└── Task 2.4: Tests            │
                               │
Phase 3 (Claude SDK)           │
├── Task 3.0: MCP Research ←───┤
├── Task 3.1: Inject Agents    │
├── Task 3.2: Share MCPs       │
├── Task 3.3: Instructions     │
└── Task 3.4: Tests            │
                               │
Phase 4 (Dynamic Commands)     │
├── Task 4.0: API Research ←───┤
├── Task 4.1: Discovery        │
├── Task 4.2: Injection        │
└── Task 4.3: Tests            │
                               │
Phase 5 (Cleanup)              │
├── Task 5.1: Disable Migration │
├── Task 5.2: Update Docs      │
└── Task 5.3: Perf Tests       │
```

---

## Parallel Execution Strategy

### Wave 1 (Immediate)
- Task 1.1: Core Service Implementation
- Task 3.0: MCP Research (no deps)
- Task 4.0: VS Code API Research (no deps)

### Wave 2 (After Task 1.1)
- Task 1.2: Command Discovery
- Task 1.3: Service Registration
- Task 2.1: loadSkill Tool

### Wave 3 (After Wave 2)
- Task 1.4: Unit Tests
- Task 2.2: Tool Registration
- Task 2.3: Skill Metadata
- Task 3.1: Inject Agents (after 1.1)
- Task 3.2: Share MCPs (after 3.0)
- Task 3.3: Instructions Wrapper

### Wave 4 (After Wave 3)
- Task 2.4: Integration Tests
- Task 3.4: E2E Tests
- Task 4.1: Dynamic Command Discovery
- Task 4.2: Command Content Injection

### Wave 5 (Final)
- Task 4.3: Integration Tests
- Task 5.1: Disable Migration
- Task 5.2: Update Documentation
- Task 5.3: Performance Testing

---

## Risk Mitigation

1. **VS Code API limitations**: If dynamic commands not supported, fallback to prompt-based detection
2. **MCP sharing complexity**: Start with a2a-orchestration only, add others incrementally
3. **Breaking changes**: Keep migration service code, just disable on init
4. **Performance**: Implement caching from day 1, monitor startup time

---

## Success Metrics

1. Commands from `.github/commands/` work in chat without package.json
2. `/review-pr` injects actual review guidelines, not just agent activation
3. Agents can discover and load skills on-demand via loadSkill tool
4. Claude SDK receives same agents/MCPs as Copilot
5. Worker health monitoring continues working unchanged
6. Worktree sessions continue working unchanged
