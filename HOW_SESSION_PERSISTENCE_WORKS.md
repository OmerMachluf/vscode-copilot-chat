# How Session ID Persistence Works Across Messages & Restarts

## The Complete Persistence Architecture

Session persistence works through **three complementary layers** that work together:

### 1. **VS Code Chat UI Persistence** (External to our code)
### 2. **Claude SDK Session Persistence** (Managed by Anthropic SDK)
### 3. **Orchestrator State Persistence** (Our implementation)

---

## Layer 1: VS Code Chat UI Persistence

VS Code itself persists chat conversations and provides stable session identifiers.

### How It Works

#### **First Message in New Chat**

```typescript
// User clicks "New Chat" and types first message

context.chatSessionContext.isUntitled = true  // VS Code: This is a new chat

↓

Extension creates new ClaudeCodeSession
↓
ClaudeCodeSession gets sessionId from Claude SDK (e.g., "879a9dbc...")
↓
Extension tells VS Code: "This chat's URI is claude-session://879a9dbc..."
↓
VS Code SAVES this URI with the chat in its database
```

**Code Location:** `claudeChatSessionParticipant.ts:35-41`
```typescript
const claudeSessionId = await create();
if (claudeSessionId) {
    this.sessionItemProvider.swap(chatSessionContext.chatSessionItem, {
        resource: ClaudeSessionUri.forSessionId(claudeSessionId),
        label: request.prompt ?? 'Claude Code'
    });
}
```

#### **Subsequent Messages in Same Chat**

```typescript
// User returns to same chat window and sends another message

context.chatSessionContext.isUntitled = false  // Not a new chat
context.chatSessionContext.chatSessionItem.resource = "claude-session://879a9dbc..."

↓

Extension extracts sessionId from URI:
const id = ClaudeSessionUri.getId(resource);  // → "879a9dbc..."

↓

Extension passes this sessionId to ClaudeAgentManager:
await this.claudeAgentManager.handleRequest(id, request, ...)
```

**Code Location:** `claudeChatSessionParticipant.ts:47-48`
```typescript
const id = ClaudeSessionUri.getId(chatSessionContext.chatSessionItem.resource);
await this.claudeAgentManager.handleRequest(id, request, context, stream, token);
```

#### **After VS Code Restart**

```typescript
// User closes VS Code, reopens it, sees their chat history

VS Code restores chat UI from its database
↓
Chat history is visible
↓
Each chat has its saved URI: "claude-session://879a9dbc..."
↓
User clicks on chat and sends new message
↓
VS Code provides context.chatSessionContext with the SAME URI
↓
Extension extracts SAME sessionId from URI
↓
Everything reconnects!
```

**Key Insight:** VS Code Chat UI is the **source of truth** for session continuity across restarts!

---

## Layer 2: Claude SDK Session Persistence

The Claude Agent SDK manages session state and conversation history on disk.

### How It Works

#### **Session Creation**

```typescript
// First message in new chat
const session = this.instantiationService.createInstance(
    ClaudeCodeSession,
    serverConfig,
    claudeSessionId,  // ← undefined for new session
    worktreePath
);

↓

ClaudeCodeSession internally uses Claude Agent SDK:
this._queryGenerator = new Query(...)

↓

Claude SDK:
- Generates sessionId if not provided
- Creates session directory: ~/.claude/sessions/{sessionId}/
- Stores conversation history, tool results, etc.
```

**Session Storage Location:**
```
~/.claude/sessions/
├── 879a9dbc-9ce4-4b0f-880d-8785c1a67272/
│   ├── conversation.jsonl
│   ├── metadata.json
│   └── tool_results/
├── another-session-id/
│   └── ...
```

#### **Session Resumption**

```typescript
// After restart, user sends new message to existing chat

VS Code provides sessionId: "879a9dbc..."
↓
Extension creates NEW ClaudeCodeSession (in-memory lost after restart):
const session = new ClaudeCodeSession(serverConfig, "879a9dbc...", ...)

↓

Claude SDK sees existing sessionId:
- Looks in ~/.claude/sessions/879a9dbc.../
- Finds existing conversation.jsonl
- RESTORES conversation history
- Continues from where it left off
```

**Code Location:** `claudeCodeAgent.ts:234`
```typescript
const newSession = this.instantiationService.createInstance(
    ClaudeCodeSession,
    serverConfig,
    claudeSessionId,  // ← SAME ID after restart
    undefined
);
```

**Link:** https://platform.claude.com/docs/en/agent-sdk/sessions

---

## Layer 3: Orchestrator State Persistence

Our orchestrator persists tasks, plans, and worker state to disk.

### How It Works

#### **State Structure**

**File Location:** `~/.vscode/User/globalStorage/.../orchestrator-state.json`

```json
{
  "version": 2,
  "plans": [...],
  "tasks": [
    {
      "id": "task-123",
      "name": "Implement feature",
      "description": "...",
      "sessionId": "879a9dbc-9ce4-4b0f-880d-8785c1a67272",  ← PERSISTED!
      "workerId": "879a9dbc-9ce4-4b0f-880d-8785c1a67272",   ← PERSISTED!
      "status": "running",
      "parentWorkerId": null,
      ...
    }
  ],
  "workers": [
    {
      "id": "879a9dbc-9ce4-4b0f-880d-8785c1a67272",        ← PERSISTED!
      "messages": [...],
      "status": "running",
      ...
    }
  ],
  "nextTaskId": 124,
  "nextPlanId": 5,
  "activePlanId": "plan-3"
}
```

#### **Save Triggers**

State is saved after every significant event:

```typescript
// Task status changes
task.status = 'completed';
this._saveState();  // ← Debounced 500ms

// Worker events
worker.stop();
this._saveState();

// Task creation
orchestrator.addTask(..., { sessionId });
this._saveState();
```

**Code Location:** `orchestratorServiceV2.ts:2454-2474`
```typescript
private _saveStateImmediate(): void {
    const state: PersistedOrchestratorState = {
        version: OrchestratorService.STATE_VERSION,
        plans: [...this._plans],
        tasks: [...this._tasks],  // ← Tasks include sessionId!
        workers: Array.from(this._workers.values()).map(w => w.serialize()),
        nextTaskId: this._nextTaskId,
        nextPlanId: this._nextPlanId,
        activePlanId: this._activePlanId,
    };
    fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
}
```

#### **Restore on Startup**

```typescript
// Extension activates after VS Code restart

constructor() {
    super();
    this._restoreState();  // ← Load from disk
}

↓

private _restoreState(): void {
    const content = fs.readFileSync(stateFilePath, 'utf-8');
    const state = JSON.parse(content) as PersistedOrchestratorState;

    this._tasks = state.tasks;  // ← Tasks restored with sessionId!
    this._plans = state.plans;
    // Workers are recreated on-demand when tasks resume
}
```

**Code Location:** `orchestratorServiceV2.ts:2476-2527`

---

## The Complete Flow: Message → Restart → Resume

### **Initial Session**

```
┌─────────────────────────────────────┐
│ User starts new chat in VS Code    │
│ Types: "Implement login feature"   │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ VS Code                             │
│ chatSessionContext.isUntitled=true  │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ Extension                           │
│ Creates ClaudeCodeSession           │
│ sessionId: undefined                │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ Claude SDK                          │
│ Generates sessionId: "879a9dbc..."  │
│ Creates ~/.claude/sessions/879a.../ │
│ Stores conversation.jsonl           │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ Extension                           │
│ Returns sessionId to VS Code        │
│ URI: claude-session://879a9dbc...   │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ VS Code                             │
│ Saves URI with chat in database     │
│ Chat visible in UI with history     │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ Orchestrator                        │
│ addTask(..., {sessionId:"879a..."}) │
│ task.sessionId = "879a9dbc..."      │
│ deploy(task) → worker.id = "879a..."│
│ Saves to orchestrator-state.json    │
└─────────────────────────────────────┘
```

### **Subsequent Message (Same Session)**

```
┌─────────────────────────────────────┐
│ User returns to same chat           │
│ Types: "Add password reset"         │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ VS Code                             │
│ chatSessionContext.isUntitled=false │
│ resource=claude-session://879a...   │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ Extension                           │
│ Extracts sessionId from URI         │
│ sessionId = "879a9dbc..."           │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ ClaudeAgentManager                  │
│ _sessions.has("879a9dbc...") → YES  │
│ Reuses existing ClaudeCodeSession   │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ Claude SDK                          │
│ Continues conversation in           │
│ ~/.claude/sessions/879a.../         │
│ Appends to conversation.jsonl       │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ Orchestrator                        │
│ Existing task.sessionId="879a..."   │
│ Worker already running with id=879..│
│ Everything connected ✅             │
└─────────────────────────────────────┘
```

### **After VS Code Restart**

```
┌─────────────────────────────────────┐
│ User closes VS Code                 │
│ (Worker stops, memory cleared)      │
└──────────────┬──────────────────────┘
               │
               ↓ [SAVED TO DISK]
               │
               ↓ VS Code DB: URI=claude-session://879a...
               ↓ Claude SDK: ~/.claude/sessions/879a.../conversation.jsonl
               ↓ Orchestrator: orchestrator-state.json with task.sessionId="879a..."
               │
               ↓
┌─────────────────────────────────────┐
│ User reopens VS Code                │
│ Chat history visible in UI          │
│ Clicks on previous chat             │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ VS Code                             │
│ Restores chat from database         │
│ Provides resource=claude-session://879a...│
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ Orchestrator                        │
│ _restoreState()                     │
│ Loads tasks from disk               │
│ task.sessionId = "879a9dbc..."      │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ User sends message: "Continue"      │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ Extension                           │
│ Extracts sessionId = "879a9dbc..."  │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ ClaudeAgentManager                  │
│ _sessions.has("879a...") → NO       │
│ (In-memory map lost after restart)  │
│ Creates NEW ClaudeCodeSession       │
│ WITH SAME sessionId: "879a9dbc..."  │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ Claude SDK                          │
│ Sees existing sessionId             │
│ Finds ~/.claude/sessions/879a.../   │
│ RESTORES conversation history ✅    │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ Orchestrator                        │
│ getActiveTaskForSession("879a...")  │
│ Finds task from restored state ✅   │
│ deploy(task) with SAME sessionId    │
│ worker.id = "879a9dbc..." AGAIN ✅  │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│ Everything Reconnected! ✅          │
│ - Same conversation history         │
│ - Same orchestrator task            │
│ - Same worker identity              │
│ - Same session chain                │
└─────────────────────────────────────┘
```

---

## Key Persistence Points

| Component | What's Persisted | Where | How |
|-----------|------------------|-------|-----|
| **VS Code Chat** | Chat URI with sessionId | VS Code's internal DB | Automatic by VS Code |
| **Claude SDK** | Conversation history | `~/.claude/sessions/{sessionId}/` | Claude Agent SDK |
| **Orchestrator** | Tasks with sessionId | `orchestrator-state.json` | `_saveState()` |
| **ClaudeAgentManager** | Session objects | In-memory only | ❌ Lost on restart |

---

## Why This Design Works

### **sessionId is the Stable Identifier**

All three layers agree on the same sessionId:
- ✅ VS Code stores it in the chat URI
- ✅ Claude SDK uses it to find conversation history
- ✅ Orchestrator stores it in tasks
- ✅ Workers use it as their ID

### **Resumption is Automatic**

When user returns to a chat after restart:
1. VS Code provides the sessionId
2. Extension creates new ClaudeCodeSession with same sessionId
3. Claude SDK restores conversation from disk
4. Orchestrator finds existing task by sessionId
5. Task is redeployed with same sessionId
6. Worker gets same ID as before
7. Everything reconnects!

### **No Manual Mapping Needed**

Before our changes:
- ❌ Workers had ephemeral IDs (worker-{uuid})
- ❌ No connection between sessionId and workerId
- ❌ After restart, new worker ID → lost connection

After our changes:
- ✅ workerId = sessionId
- ✅ Direct connection maintained
- ✅ After restart, same sessionId → same worker ID → reconnect!

---

## Testing Persistence

### **Test 1: Message Continuity**
```
1. Start new chat, send: "Create a function"
2. Send another message: "Add error handling"
3. Verify same sessionId used for both
4. Check orchestrator-state.json has task with sessionId
```

### **Test 2: VS Code Restart**
```
1. Start new chat, send: "Implement feature"
2. Verify worker is running, task created
3. Close VS Code completely
4. Reopen VS Code
5. Open same chat from history
6. Send: "Continue implementation"
7. Verify:
   - Same sessionId extracted from URI ✅
   - Claude SDK restored conversation ✅
   - Orchestrator found existing task ✅
   - Worker redeployed with same ID ✅
```

### **Test 3: Child Task Reconnection**
```
1. Spawn subtask from main task
2. Verify child inherits parent sessionId
3. Close VS Code
4. Reopen VS Code
5. Resume parent task
6. Verify child can still report completion to parent ✅
```

---

## Common Questions

**Q: What if user deletes ~/.claude/sessions/ folder?**
A: Claude SDK starts fresh conversation. Orchestrator still has task with sessionId, but conversation history is lost.

**Q: What if orchestrator-state.json is deleted?**
A: Tasks are lost, but VS Code chat and Claude SDK session still exist. New orchestrator task would be created.

**Q: Can sessionId be changed?**
A: No. Once assigned, it's immutable. VS Code, Claude SDK, and Orchestrator all rely on it.

**Q: What about multiple VS Code windows?**
A: Each VS Code window has its own chat UI and orchestrator. SessionIds are still unique and don't conflict.

---

## Summary

Session persistence works through **cooperative storage**:

1. **VS Code** = Source of truth for session identity (URI)
2. **Claude SDK** = Source of truth for conversation history
3. **Orchestrator** = Source of truth for task state and worker identity

By making **workerId = sessionId**, we align all three layers around the same stable identifier that survives restarts! 🎉
