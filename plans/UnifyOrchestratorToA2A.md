# Architecture Plan: Unify Orchestrator to Use A2A Tools

## Overview

Unify the orchestrator's task execution to leverage the already-working A2A (Agent-to-Agent) infrastructure. This eliminates duplicate code, provides consistent UX (blocking progress bubbles), and simplifies the orchestrator's tool surface.

## Problem Statement / Motivation

Currently, we have **two parallel systems** for spawning and managing worker subtasks:

1. **A2A Tools** (`a2a_spawn_subtask`, `a2a_spawn_parallel_subtasks`, etc.)
   - ✅ Blocking with progress bubbles in parent's chat
   - ✅ Rich additional context injected into workers
   - ✅ Proper model selection
   - ✅ Automatic commit/merge via `a2a_subtask_complete`
   - ✅ Well-tested and working

2. **Orchestrator Tools** (`orchestrator_deploy`, `orchestrator_sendMessage`, etc.)
   - ❌ Fire-and-forget (non-blocking despite recent changes)
   - ❌ No additional context injected
   - ❌ Separate code path with duplication
   - ❌ Manual merge/completion required

**Goal**: Make the orchestrator use A2A tools directly, eliminating duplicate code paths and providing consistent behavior.

## Proposed Solution

### Tools to KEEP (orchestrator-specific functionality):

| Tool | Purpose |
|------|---------|
| `orchestrator_savePlan` | Create plan with tasks/dependencies (plan metadata) |
| `orchestrator_addPlanTask` | Add tasks to existing plan |
| `orchestrator_listAgents` | List available agents |
| `orchestrator_listWorkers` | List active workers/sessions |
| `orchestrator_cancelTask` | Cancel task and its worker |
| `orchestrator_completeTask` | **Simplified**: Just mark task done in plan state |
| `orchestrator_retryTask` | Reset task status (redeployment done via A2A by agent) |

### Tools to REMOVE (use A2A instead):

| Remove | Replacement |
|--------|-------------|
| `orchestrator_deploy` | `a2a_spawn_subtask` / `a2a_spawn_parallel_subtasks` |
| `orchestrator_sendMessage` | `a2a_send_message_to_worker` |
| `orchestrator_expandImplementation` | Not needed (orchestrator agent handles this manually) |
| `orchestrator_killWorker` | Use `orchestrator_cancelTask` |
| `orchestrator_reassignAgent` | Set at spawn time |
| `orchestrator_changeModel` | Set at spawn time |
| `orchestrator_reinitializeWorker` | Kill + retry |
| `orchestrator_redirectWorker` | Use `a2a_send_message_to_worker` |

## Technical Considerations

### Architecture Impacts

1. **Plan-Task to Subtask Mapping**: Orchestrator agent must track which A2A subtask corresponds to which plan task
2. **Orchestrator Agent as Parent**: When orchestrator spawns workers via A2A, it becomes their parent
3. **Event Flow**: Plan completion updates happen when orchestrator calls `orchestrator_completeTask` after A2A subtask completes

### Key Insight

The orchestrator is **already an agent** running in a chat session. When it calls A2A tools like `a2a_spawn_subtask`, it naturally becomes the parent of those subtasks. This is exactly how we want it to work - no special infrastructure needed!

### Performance Implications

- Removes duplicate code paths → simpler, more maintainable
- Uses proven A2A infrastructure → more reliable
- Single event/completion flow → less complexity

## Acceptance Criteria

- [x] Orchestrator can deploy plan tasks using `a2a_spawn_subtask` / `a2a_spawn_parallel_subtasks`
- [x] Deployed workers show progress bubbles in orchestrator's chat
- [x] Workers complete via `a2a_subtask_complete` (auto-commit/merge)
- [x] `orchestrator_completeTask` only updates plan state (no merge logic)
- [x] Orchestrator can communicate with workers via `a2a_send_message_to_worker`
- [x] Removed tools no longer appear in package.json or agent instructions
- [x] All documentation updated to reflect new tool usage

## Success Metrics

- Orchestrator workflows complete successfully using A2A tools
- Consistent UX between direct A2A spawning and orchestrator deployment
- Reduced code duplication in orchestratorTools.ts

## Dependencies & Risks

- **Risk**: Orchestrator agent instructions are complex - must update carefully
- **Risk**: package.json tool definitions need careful removal
- **Mitigation**: Phased approach - update agent instructions first, test, then remove code

---

## Implementation Plan

### Phase 1: Update Orchestrator Agent Instructions ✅ COMPLETE
**Objective**: Modify `Orchestrator.agent.md` to use A2A tools for deployment and communication

**Tasks**:
1. [x] Update tools list in frontmatter to include A2A tools: `a2a_spawnSubTask`, `a2a_spawnParallelSubTasks`, `a2a_send_message_to_worker`, `a2a_pull_subtask_changes`
2. [x] Remove deprecated tools from frontmatter: `orchestrator_deploy`, `orchestrator_sendMessage`, `orchestrator_expandImplementation`
3. [x] Rewrite "Plan Deployment" section to use `a2a_spawnSubTask` for single task or `a2a_spawnParallelSubTasks` for multiple ready tasks
4. [x] Rewrite "Worker Communication" section to use `a2a_send_message_to_worker`
5. [x] Simplify "Completing Tasks" section - workers now auto-complete via `a2a_subtask_complete`, orchestrator just marks plan task done
6. [x] Remove "Expanding Architect Output" section referencing `orchestrator_expandImplementation`
7. [x] Update example flows to show A2A tool usage
8. [x] Add guidance on converting plan tasks to A2A subtask options (prompt, agentType, targetFiles, etc.)

**Depends on**: None
**Estimated Time**: 1 day
**Success Criteria**: Orchestrator agent instructions describe A2A-based workflow

---

### Phase 2: Simplify Orchestrator Tools ✅ COMPLETE
**Objective**: Remove deprecated tools and simplify remaining ones

**Tasks**:
1. [x] In `orchestratorTools.ts`: Remove `DeployTool` class and its `ToolRegistry.registerTool` call
2. [x] In `orchestratorTools.ts`: Remove `SendMessageTool` class and registration
3. [x] In `orchestratorTools.ts`: Remove `ExpandImplementationTool` class and registration
4. [x] In `orchestratorTools.ts`: Remove `KillWorkerTool` class and registration (use `CancelTaskTool` instead)
5. [x] In `orchestratorTools.ts`: Remove `ReassignAgentTool` class and registration
6. [x] In `orchestratorTools.ts`: Remove `ChangeModelTool` class and registration
7. [x] In `orchestratorTools.ts`: Remove `ReinitializeWorkerTool` class and registration
8. [x] In `orchestratorTools.ts`: Remove `RedirectWorkerTool` class and registration
9. [x] Simplify `CompleteTaskTool` to only update plan state (remove any merge logic references)
10. [x] Update `RetryTaskTool` to reset task status only (actual redeployment done via A2A by agent)

**Depends on**: Phase 1
**Estimated Time**: 1 day
**Success Criteria**: Only essential orchestrator tools remain; code compiles

---

### Phase 3: Update Tool Names and Categories ✅ COMPLETE
**Objective**: Clean up tool name registry and categories

**Tasks**:
1. [x] In `toolNames.ts`: Remove enum entries for deprecated tools:
   - `OrchestratorDeploy`
   - `OrchestratorSendMessage`
   - `OrchestratorExpandImplementation`
   - `OrchestratorKillWorker`
   - `OrchestratorReassignAgent`
   - `OrchestratorChangeModel`
   - `OrchestratorReinitializeWorker`
   - `OrchestratorRedirectWorker`
2. [x] In `toolNames.ts`: Remove corresponding `ContributedToolName` entries
3. [x] In `toolNames.ts`: Remove corresponding `toolCategories` entries
4. [x] Verify no import errors from removed enums

**Depends on**: Phase 2
**Estimated Time**: 0.5 day
**Success Criteria**: Tool registry clean; no references to removed tools

---

### Phase 4: Update package.json Tool Definitions ✅ COMPLETE
**Objective**: Remove deprecated tool definitions from VS Code contribution points

**Tasks**:
1. [x] Remove `orchestrator_deploy` tool definition from `contributes.languageModelTools`
2. [x] Remove `orchestrator_sendMessage` tool definition
3. [x] Remove `orchestrator_expandImplementation` tool definition
4. [x] Remove `orchestrator_killWorker` tool definition
5. [x] Remove `orchestrator_reassignAgent` tool definition
6. [x] Remove `orchestrator_changeModel` tool definition
7. [x] Remove `orchestrator_reinitializeWorker` tool definition
8. [x] Remove `orchestrator_redirectWorker` tool definition
9. [x] Update orchestrator `languageModelToolSets` array to only include kept tools

**Depends on**: Phase 3
**Estimated Time**: 0.5 day
**Success Criteria**: package.json valid; VS Code loads without errors

---

### Phase 5: Update Documentation ✅ COMPLETE
**Objective**: Update all documentation to reflect the unified approach

**Tasks**:
1. [x] Update `docs/orchestrator-readme.md`:
   - Remove "Deploy a Plan" section references to `orchestrator_deploy`
   - Remove "Send Message to Worker" section references to `orchestrator_sendMessage`
   - Add section on using A2A tools for deployment
2. [x] Update `docs/orchestrator-architecture.md`: Document the A2A-based deployment model
3. [x] Update `docs/orchestrator-knowledge-base.md`: Update tool reference tables
4. [ ] Update `docs/tools.md` if it references orchestrator tools (checked - no references)
5. [ ] Review and update `plans/agent-to-agent.md` if needed (checked - no changes needed)

**Depends on**: Phase 4
**Estimated Time**: 0.5 day
**Success Criteria**: All docs consistent with new architecture

---

### Phase 6: Update OrchestratorServiceV2 (Optional Cleanup)
**Objective**: Remove unused internal methods that were only called by deprecated tools

**Tasks**:
1. [ ] Review `orchestratorServiceV2.ts` for methods only used by deprecated tools
2. [ ] Consider removing or simplifying `deploy()` method if no longer needed externally
3. [ ] Consider removing `_runWorkerTask()` if workers now run via A2A
4. [ ] Clean up unused imports
5. [ ] Verify plan state management still works correctly
6. [ ] Keep methods needed by `orchestrator_cancelTask` and `orchestrator_retryTask`

**Depends on**: Phase 4
**Estimated Time**: 1 day
**Success Criteria**: OrchestratorServiceV2 leaner; only plan management logic remains

---

### Phase 7: Testing
**Objective**: Verify the unified approach works end-to-end

**Tasks**:
1. [ ] Manual test: Create a plan via WorkflowPlanner
2. [ ] Manual test: Deploy tasks using orchestrator agent (should use A2A tools)
3. [ ] Manual test: Verify progress bubbles appear in orchestrator's chat
4. [ ] Manual test: Verify workers complete via `a2a_subtask_complete`
5. [ ] Manual test: Verify `orchestrator_completeTask` updates plan state
6. [ ] Manual test: Verify `a2a_send_message_to_worker` works for communication
7. [ ] Verify TypeScript compilation passes
8. [ ] Run existing unit tests to ensure no regressions

**Depends on**: Phase 5, Phase 6
**Estimated Time**: 1 day
**Success Criteria**: All manual tests pass; no TypeScript errors

---

## Summary

| Phase | Description | Est. Time |
|-------|-------------|-----------|
| 1 | Update Orchestrator Agent Instructions | 1 day |
| 2 | Simplify Orchestrator Tools | 1 day |
| 3 | Update Tool Names and Categories | 0.5 day |
| 4 | Update package.json Tool Definitions | 0.5 day |
| 5 | Update Documentation | 0.5 day |
| 6 | Update OrchestratorServiceV2 (Optional) | 1 day |
| 7 | Testing | 1 day |
| **Total** | | **5.5 days** |

## Files to Modify

| File | Changes |
|------|---------|
| `assets/agents/Orchestrator.agent.md` | Complete rewrite of tool usage and workflow |
| `src/extension/tools/node/orchestratorTools.ts` | Remove 8 tool classes (~800 lines) |
| `src/extension/tools/common/toolNames.ts` | Remove 8 enum entries + categories |
| `package.json` | Remove 8 tool definitions, update chatParticipant tools |
| `docs/orchestrator-readme.md` | Update examples and tool references |
| `docs/orchestrator-architecture.md` | Update architecture notes |
| `docs/orchestrator-knowledge-base.md` | Update tool tables |
| `src/extension/orchestrator/orchestratorServiceV2.ts` | Optional cleanup of unused methods |

## Rollback Plan

If issues arise:
1. Revert agent instructions to use orchestrator tools
2. Restore removed tool classes
3. Restore package.json definitions

The A2A tools will continue to work independently regardless.

## Key Benefits

1. **Single code path** for spawning workers - less bugs, easier maintenance
2. **Consistent UX** - progress bubbles work the same everywhere
3. **Automatic context injection** - workers get rich context via A2A's `additionalInstructions`
4. **Automatic commit/merge** - via `a2a_subtask_complete` with `commitMessage`
5. **Simpler orchestrator** - focuses on plan management, not worker execution
