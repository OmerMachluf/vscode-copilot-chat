## Overview

This plan fixes the current Agent-to-Agent (A2A) experience to match the desired behavior:

- In-chat, visible subtask “bubbles” (running/completed/failed) for parallel agents (not just VS Code notifications).
- Deterministic parent “wake-up” when any spawned subagent exits its agentic loop (success/failure/cancel), delivering the full subagent response to the parent as if it were a user message so the parent can react and continue.
- Clear, enforced depth limits: orchestrator max depth = 2; standalone agent max depth = 1.
- Clarified worktree semantics and “dirty workspace” policy; parent can reliably discover/collect worktree outputs and integrate changes.

The current codebase already has most primitives:
- A2A tools for spawn/await/notify/complete in [src/extension/tools/node/a2aTools.ts](src/extension/tools/node/a2aTools.ts) and [src/extension/tools/node/a2aSubTaskCompleteTool.ts](src/extension/tools/node/a2aSubTaskCompleteTool.ts)
- Subtask lifecycle + events in [src/extension/orchestrator/subTaskManager.ts](src/extension/orchestrator/subTaskManager.ts)
- Message routing queue with per-owner handlers in [src/extension/orchestrator/orchestratorQueue.ts](src/extension/orchestrator/orchestratorQueue.ts)
- Worktree manager with chat-stream progress in [src/extension/chatSessions/common/unifiedWorktreeManager.ts](src/extension/chatSessions/common/unifiedWorktreeManager.ts)

The main gaps are:
1) UI: A2A tools currently use `vscode.window.withProgress` notifications, not chat response progress “parts”.
2) Control flow: there is no persistent “owner handler” bound to a parent chat session, so non-blocking subtasks complete without re-entering/resuming the parent agent loop.

## Problem Statement / Motivation

User-observed failures:
- Parallel subtasks do not appear as in-chat running/completed “bubbles”; only notifications appear.
- Parent session stays “loading” / does not automatically resume after subagents finish.
- Parent cannot reliably react to subagent completion without manual polling/await tooling.
- Depth-limit behavior is inconsistent with desired defaults; current enforcement is partly hardcoded and not context-aware.

Why this matters:
- Without in-chat progress and deterministic completion propagation, multi-agent delegation feels broken and untrustworthy.
- Without correct depth limits and clear worktree semantics, subtasks can spiral or produce changes the parent can’t safely integrate.

## Proposed Solution

### 1) Normalize “Subtask Lifecycle” as a first-class event stream
Create a single “subtask lifecycle” abstraction that emits consistent events:
- `spawned` → `running` → (`completed` | `failed` | `cancelled`)
with payload: subTaskId, parent identity, agentType, depth, worktreePath, timestamps, output summary, full output reference.

Sources:
- `SubTaskManager.onDidChangeSubTask` and `onDidCompleteSubTask` from [src/extension/orchestrator/subTaskManager.ts](src/extension/orchestrator/subTaskManager.ts)
- Queue messages (`completion`, `status_update`, etc.) from [src/extension/orchestrator/orchestratorQueue.ts](src/extension/orchestrator/orchestratorQueue.ts)

Sinks:
- Chat UI “progress bubbles” (chat response stream parts)
- Parent wake-up / resume logic
- Optional dashboards/logging

### 2) Bind subtasks to a “Parent Session Identity” that can receive messages
Today, subtasks route messages via `owner: { ownerType: 'worker', ownerId: parentWorkerId }` (created in [src/extension/orchestrator/subTaskManager.ts](src/extension/orchestrator/subTaskManager.ts)), but:
- Owner handlers are registered only transiently inside the spawn tool’s blocking path in [src/extension/tools/node/a2aTools.ts](src/extension/tools/node/a2aTools.ts)
- Non-blocking tasks have no long-lived consumer, so nothing updates the parent chat.

Fix by standardizing “parent identity”:
- For orchestrator workers: parent identity = WorkerSession ID (or session URI) and attach a persistent owner handler for that worker/session.
- For user chat agent sessions: parent identity = chat session ID/URI, and register a persistent owner handler keyed by that ID.

This requires plumbing session identifiers into `IWorkerContext.owner` (it already supports optional `sessionUri` in [src/extension/orchestrator/orchestratorQueue.ts](src/extension/orchestrator/orchestratorQueue.ts)) so subtasks can always target the correct parent session.

### 3) Implement deterministic “Parent Wake-Up” on subtask terminal events
On every subtask terminal event:
- Enqueue a completion payload to the parent owner handler (already done by [src/extension/tools/node/a2aSubTaskCompleteTool.ts](src/extension/tools/node/a2aSubTaskCompleteTool.ts) when the subagent calls it).
- Also implement a fallback completion path in `SubTaskManager.executeSubTask` to guarantee a completion notification even if the subagent never calls `a2a_subtask_complete` (e.g., model error, cancellation, crash).

Then, the parent-side handler should:
- Append a synthetic message to the parent conversation (“as if user”), containing the full subagent response (plus metadata: subTaskId, agentType, worktreePath).
- Trigger the parent agent loop to continue (either by resuming a paused loop, or by scheduling a new agent iteration with the new “user” message).

### 4) Replace notification-only progress with in-chat progress parts
A2A spawn/await tools should emit chat progress:
- When spawning: add a progress item per subtask (running)
- On completion: mark it succeeded/failed and optionally include a short preview + link/open action to worktree

The repo already uses chat-stream progress in worktree flows (see [src/extension/chatSessions/common/unifiedWorktreeManager.ts](src/extension/chatSessions/common/unifiedWorktreeManager.ts)); reuse that pattern rather than `vscode.window.withProgress` notifications in [src/extension/tools/node/a2aTools.ts](src/extension/tools/node/a2aTools.ts).

### 5) Align and enforce depth limits by spawn context
Current mismatch:
- `SafetyLimitsService` supports separate orchestrator vs agent depth defaults in [src/extension/orchestrator/safetyLimits.ts](src/extension/orchestrator/safetyLimits.ts)
- But `SubTaskManager` currently hardcodes `maxDepth = 2` and uses `enforceDepthLimit(options.currentDepth)` without passing context, which defaults to “subtask” behavior.

Fix:
- Determine spawn context from `workerToolSet.workerContext.spawnContext` (already inherited in [src/extension/orchestrator/subTaskManager.ts](src/extension/orchestrator/subTaskManager.ts))
- Enforce:
  - orchestrator root chain max depth = 2
  - standalone agent chain max depth = 1
- Ensure A2A spawn tools use the same single source of truth (SafetyLimitsService config), not separate hardcoded maxDepth.

### 6) Worktree semantics: make them explicit and observable
Clarify and enforce:
- A2A “subtasks” (as currently implemented) generally operate in the parent worktree (shared file view), unless explicitly configured otherwise.
- Orchestrator “workers” operate in separate worktrees created by orchestrator logic (see [src/extension/orchestrator/orchestratorServiceV2.ts](src/extension/orchestrator/orchestratorServiceV2.ts#L2040-L2140), which currently uses git CLI directly).

Improve consistency by:
- Reusing `IUnifiedWorktreeManager` for worktree creation/removal/stats and progress streaming instead of bespoke git CLI worktree handling in orchestrator.
- Surfacing worktreePath + diff stats to the parent automatically on completion.

## Technical Considerations

- Architecture impacts
  - Introduce a “SubtaskLifecycleService” (or equivalent) to unify SubTaskManager events + queue messages and drive UI + wake-up.
  - Establish a stable “Parent Session Identity” contract so owner routing is reliable across orchestrator workers and user chat sessions.
- Performance implications
  - Avoid chat spam: batch/compact progress updates; throttle status updates.
  - Ensure owner handler processing is non-blocking and resilient (queue already persists to disk).
- Security considerations
  - Ensure synthetic “as-if-user” messages are tagged/attributed as system/subtask-originated to prevent prompt injection loops.
  - Respect permission inheritance; never let subtask completion escalate permissions implicitly.

## Acceptance Criteria

- [ ] In-chat subtask progress “bubbles” appear for spawn/await, showing running → completed/failed with per-subtask granularity.
- [ ] Parent is automatically updated on every subagent terminal event (success/failure/cancel), without requiring manual polling.
- [ ] Parent update includes full subagent response payload and metadata (agentType, subTaskId, worktreePath).
- [ ] Parent reliably resumes/continues after receiving completion updates (no “stuck loading”).
- [ ] Depth limits enforce defaults: orchestrator chain max depth 2; standalone agent chain max depth 1.
- [ ] Worktree semantics are explicit: parent can discover subtask/workers’ worktreePath and diff stats; integration path is clear.
- [ ] Tests cover: completion propagation, non-blocking spawn wake-up, depth enforcement by context, and queue owner routing.

## Success Metrics

- Reduced “stuck loading” reports to near-zero in A2A usage.
- ≥90% of A2A sessions show in-chat progress parts (not only notifications).
- Median time-to-parent-react after subtask completion < 1s (local).
- Depth-limit violations produce clear errors and no runaway spawning.

## Dependencies & Risks

- Requires a stable way to inject a synthetic message into a running parent agent loop (risk: VS Code chat/participant APIs may not support “resume” in the exact desired way).
- Tool invocation APIs may not expose the parent response stream directly to node tools; may require passing a stream adapter via worker/session services.
- Must avoid infinite loops where parent spawns subtasks in response to subtask completion message repeatedly.
- Orchestrator worktree creation currently uses git CLI; migrating to UnifiedWorktreeManager needs careful parity checks.

### Plan divide to phases
### Phase 1: Baseline Traceability & Contract Definition ✅ COMPLETE
**Objective**: Establish clear, testable contracts for subtask lifecycle, parent identity, and message routing.

**Tasks**:
1. [x] Document current A2A flows (spawn/await/notify/complete) and identify which paths are “blocking tool output” vs “queue-routed messages”.
2. [x] Define a canonical "Parent Session Identity" schema (workerId vs chat sessionId vs sessionUri) and how it maps to `IOwnerContext` in [src/extension/orchestrator/orchestratorQueue.ts](src/extension/orchestrator/orchestratorQueue.ts).
3. [x] Define the subtask lifecycle event model (states + payload) and map it to SubTaskManager events in [src/extension/orchestrator/subTaskManager.ts](src/extension/orchestrator/subTaskManager.ts).
4. [x] Add an observability checklist: correlation IDs (subTaskId), logging points, and expected message routing behavior.

**Deliverable**: [docs/orchestrator-traceability-contract.md](../docs/orchestrator-traceability-contract.md)

**Depends on**: None
**Estimated Time**: 1–2 days
**Success Criteria**: A written contract that Orchestrator can implement against; clear mapping of current gaps.

### Phase 2: Deterministic Completion Propagation (“Parent Wake-Up”)
**Objective**: Ensure every subtask terminal event generates a parent-visible update and triggers parent continuation.

**Tasks**:
1. [ ] Implement (design + wiring) a persistent owner handler registration for parent sessions (orchestrator workers and user chat sessions) so non-blocking subtasks can notify parents after the spawn tool returns.
2. [ ] Add a fallback completion path so parent is notified even if the subagent never calls `a2a_subtask_complete` (e.g., based on `SubTaskManager.onDidCompleteSubTask`).
3. [ ] Implement parent “wake-up adapter” that injects the completion as a synthetic “user message” (or equivalent parent-input mechanism) and resumes/schedules parent agent iteration.
4. [ ] Add de-dupe logic to prevent double-delivery (queue persistence + SubTaskManager completion events can both fire).

**Depends on**: Phase 1
**Estimated Time**: 2–4 days
**Success Criteria**: Non-blocking subtasks cause parent to update and continue automatically in all terminal cases.

### Phase 3: In-Chat Progress UI (“Bubbles”)
**Objective**: Replace notification-only progress with in-chat progress parts that reflect subtask lifecycle.

**Tasks**:
1. [ ] Identify the correct chat-stream progress API surface to use from tools/agents (pattern reference: [src/extension/chatSessions/common/unifiedWorktreeManager.ts](src/extension/chatSessions/common/unifiedWorktreeManager.ts)).
2. [ ] Update A2A spawn/await UX spec: per-subtask bubble creation, updates, completion rendering, and aggregation for parallel spawns.
3. [ ] Implement a “SubtaskProgressRenderer” that consumes lifecycle events and emits chat progress parts (throttled, minimal noise).
4. [ ] Ensure progress bubbles work in both blocking and non-blocking modes, and remain visible until completion.

**Depends on**: Phase 1, Phase 2
**Estimated Time**: 2–3 days
**Success Criteria**: Users see running/completed subtasks in-chat for parallel agents, not only notifications.

### Phase 4: Depth Limits & Configuration Alignment ✅ COMPLETE
**Objective**: Enforce depth limits consistently by spawn context, matching desired defaults.

**Tasks**:
1. [x] Make `SubTaskManager` derive effective max depth from `SafetyLimitsService` context (`orchestrator` vs `agent`) rather than hardcoding `maxDepth = 2` in [src/extension/orchestrator/subTaskManager.ts](src/extension/orchestrator/subTaskManager.ts).
2. [x] Ensure spawn context is correctly set/inherited through worker toolsets (already partially present as `spawnContext` inheritance).
3. [x] Align user/workspace settings (`copilot.orchestrator.limits.maxSubtaskDepth`) with the SafetyLimitsService config model in [src/extension/orchestrator/safetyLimits.ts](src/extension/orchestrator/safetyLimits.ts).
4. [x] Update error messaging so depth-limit failures clearly explain current depth and allowed maximum.

**Depends on**: Phase 1
**Estimated Time**: 1–2 days
**Success Criteria**: Orchestrator chains allow depth 2; standalone agent chains stop at depth 1; behavior is configurable and tested.

### Phase 5: Worktree Semantics & Dirty-State Policy
**Objective**: Make worktree behavior predictable and parent-integratable, including handling uncommitted changes.

**Tasks**:
1. [ ] Decide and document policy for “dirty workspace” when creating worktrees (fail-fast vs auto-stash vs migrate changes) and implement consistently.
2. [ ] Migrate orchestrator worktree creation to reuse IUnifiedWorktreeManager where feasible (instead of bespoke git CLI in [src/extension/orchestrator/orchestratorServiceV2.ts](src/extension/orchestrator/orchestratorServiceV2.ts#L2040-L2140)).
3. [ ] Ensure completion payloads always include `worktreePath` and optional diff stats, and parent surfaces them automatically.
4. [ ] Add parent-side helpers/actions: open worktree, show diff stats, show changed files list.

**Depends on**: Phase 2
**Estimated Time**: 2–4 days
**Success Criteria**: Parent can reliably find where work happened and integrate it; uncommitted changes behavior is consistent and documented.

### Phase 6: Testing, Docs, and Rollout
**Objective**: Validate end-to-end behavior and reduce regression risk.

**Tasks**:
1. [ ] Add unit tests for queue owner routing, persistent owner handlers, completion propagation, and depth enforcement (Vitest patterns).
2. [ ] Add integration/simulation coverage for “spawn non-blocking → child completes → parent reacts automatically”.
3. [ ] Update docs to reflect the new behavior and configuration knobs: A2A config, depth defaults, and worktree policy (update [docs/a2a-configuration.md](docs/a2a-configuration.md) and related orchestrator docs).
4. [ ] Introduce a feature-flagged rollout if needed (e.g., enable in-chat bubbles first, then enable auto-wake for all sessions).

**Depends on**: Phase 3, Phase 4, Phase 5
**Estimated Time**: 2–3 days
**Success Criteria**: Tests pass; docs match behavior; rollout path is safe.

---

## Addendum (Dec 12, 2025): Clarifications + Worktree Recommendation

### Clarifications (captured)

- Non-blocking spawns: completion delivery is queued; parent is updated after it finishes its current agentic cycle.
- UI: bubble per subtask, expandable.
- “As if user” injection format is explicitly tagged and includes task details:
  - Example: “@Reviewer subagent received task to: {…}. @reviewer response: {…}”
  - Must also include: worktree path the subagent worked in + number of changed files (and optionally insertions/deletions if available)

### Recommendation: same worktree vs new worktree for subtasks

Default policy recommendation:
- Parallel/non-blocking subtasks should default to isolated worktrees (one worktree per subtask) when they may write files, to prevent race conditions and “last writer wins” surprises.
- Shared worktree should remain available as an explicit mode for:
  - strictly read-only subtasks (research, investigation, review)
  - sequential subtasks where parent is blocking/awaiting and you want “immediate shared edits”
  - very small scoped edits with guaranteed non-overlap via `targetFiles` conflict checks

Operationalizing this policy:
- Keep `targetFiles` as the primary signal: if provided and overlaps (or is unknown), prefer isolation.
- If `targetFiles` is omitted and spawn is non-blocking or parallel, default to isolation.
- If spawn is blocking and `targetFiles` is omitted, shared worktree is acceptable but should be discouraged for long-running tasks.

This is compatible with your stated current behavior (“all sub agents … are fired with a new worktree”) while still allowing the earlier “agent-fired subtasks share worktree” idea in the narrow cases where it’s safe.
