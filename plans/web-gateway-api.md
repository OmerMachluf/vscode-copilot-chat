# Web Gateway API - Architecture Plan

## Overview

Build a web-accessible gateway to control VS Code Copilot from anywhere (browser, mobile). The system consists of two components:

1. **Extension HTTP API** - Express server running inside VS Code extension (localhost only)
2. **Web Gateway** - Public-facing Node.js service with auth and React UI

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Azure VM (Headless)                               │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Web Gateway (Node.js)                    Port 3000 (public)   │ │
│  │  ├── Password Auth → JWT                                       │ │
│  │  ├── React Chat UI (mobile-responsive)                         │ │
│  │  └── Proxy to Extension API                                    │ │
│  └──────────────────────┬─────────────────────────────────────────┘ │
│                         │ HTTP (localhost only)                      │
│                         ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  VS Code Server (code tunnel)                                   │ │
│  │  └── Copilot Extension                                         │ │
│  │      └── HTTP API Server                  Port 19847 (local)   │ │
│  │          ├── Session Management                                │ │
│  │          ├── Chat Streaming (SSE)                              │ │
│  │          ├── Orchestrator Control                              │ │
│  │          └── Worker Management                                 │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
         ▲
         │ HTTPS (Azure public IP / tunnel)
         ▼
┌─────────────────┐  ┌─────────────────┐
│  Desktop Browser│  │  Mobile Browser │
└─────────────────┘  └─────────────────┘
```

---

## Component Breakdown

### 1. Extension HTTP API Server

**Purpose**: Expose orchestrator and agent capabilities via localhost REST API.

**Key Responsibilities**:
- Run Express server bound to `127.0.0.1:19847`
- Enforce localhost-only access (reject external requests)
- Route requests to `IOrchestratorService` for worker/task management
- Stream agent responses via Server-Sent Events (SSE)
- Manage HTTP session lifecycle

**Service Interface**:
```typescript
interface IHttpApiServer extends Disposable {
  readonly port: number;
  readonly isRunning: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

**Route Groups**:
| Route | Purpose |
|-------|---------|
| `/api/health` | Health check endpoint |
| `/api/sessions/*` | Chat session management |
| `/api/orchestrator/*` | Plan and task control |
| `/api/workers/*` | Worker management and streaming |
| `/api/workspaces/*` | Workspace and folder operations |

**Integration Points**:
- `IOrchestratorService` - Worker deployment, task management, plan control
- `WorkerSession` - Chat conversation streaming (existing implementation)
- `ILogService` - Logging

**New Files**:
- `src/extension/httpApi/httpApiServer.ts` - Main server service
- `src/extension/httpApi/routes/*.ts` - Route handlers
- `src/extension/httpApi/httpResponseStreamAdapter.ts` - Stream bridge

**Modified Files**:
- `src/extension/extension/vscode-node/services.ts` - Register service
- `package.json` - Add `express` dependency

---

### 2. HTTP Response Stream Adapter

**Purpose**: Bridge `vscode.ChatResponseStream` to HTTP SSE responses.

**Problem Statement**:
Agent execution requires a `ChatResponseStream` to write responses. For HTTP clients, we need an adapter that:
- Implements `vscode.ChatResponseStream` interface
- Writes parts to HTTP response as SSE events
- Handles connection lifecycle (close, error)

**Key Responsibilities**:
- Accept `express.Response` in constructor
- Implement `markdown()`, `progress()`, `reference()`, etc.
- Serialize parts to JSON and write as SSE `data:` events
- Handle client disconnect gracefully

**Interface**:
```typescript
interface IHttpResponseStreamAdapter extends vscode.ChatResponseStream {
  readonly isClosed: boolean;
  close(): void;
}
```

**Open Questions**:
1. Which `ChatResponseStream` methods need full implementation vs. no-op?
2. How to handle `button()` and other interactive parts in HTTP context?
3. Should we buffer parts or stream immediately?

---

### 3. Session Management

**Purpose**: Manage chat sessions for HTTP clients.

**Approach Decision Required**:

| Option | Pros | Cons |
|--------|------|------|
| **A: Use existing `WorkerSession`** | Reuses orchestrator infrastructure, full feature parity | Sessions tied to worktrees, heavier weight |
| **B: Create lightweight `WebSession`** | Simpler, no worktree overhead | Duplicates conversation management, loses orchestrator integration |
| **C: Direct `IAgentRunner` calls** | Minimal abstraction | No conversation continuity, requires stream adapter |

**Recommendation**: Option A - leverage `WorkerSession` via `IOrchestratorService.deploy()`.

**Key Responsibilities**:
- Create sessions with specified agent type and folder
- Map HTTP session IDs to `WorkerSession` instances
- Forward messages and stream responses
- Handle session cleanup and timeouts

**Data Model**:
```typescript
interface WebSession {
  id: string;
  agentType: string;
  folder: string;
  workerId: string;        // Links to WorkerSession
  status: 'idle' | 'active' | 'completed';
  createdAt: number;
  lastActivityAt: number;
}
```

---

### 4. Web Gateway Service

**Purpose**: Public-facing gateway with authentication and React UI.

**Key Responsibilities**:
- Password authentication with JWT tokens
- Proxy all `/api/*` requests to extension API
- Serve React frontend for chat and orchestrator UI
- Handle HTTPS termination (via nginx)

**Technology Stack**:
- Node.js + Express
- `jsonwebtoken` for auth
- `http-proxy-middleware` for API proxy
- React + Vite for frontend
- Tailwind CSS for styling

**Directory Structure**:
```
src/web-gateway/
├── src/
│   ├── server.ts           # Express server + proxy
│   ├── auth/               # JWT middleware
│   └── config.ts           # Environment config
└── client/
    ├── src/
    │   ├── components/     # React components
    │   ├── hooks/          # useChat, useOrchestrator
    │   └── api/            # API client
    └── vite.config.ts
```

**Frontend Views**:
| View | Purpose |
|------|---------|
| Login | Password authentication |
| Chat | Message input, streaming responses, agent picker |
| Orchestrator | Plan list, task management, worker status |
| Sessions | Session list, folder picker |

---

## Data Models

```typescript
// Session representation for HTTP API
interface WebSession {
  id: string;
  agentType: string;
  folder: string;
  status: 'idle' | 'active' | 'completed';
  createdAt: number;
  lastActivityAt: number;
}

// Message in a session
interface WebMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// SSE event format
interface StreamEvent {
  type: 'part' | 'complete' | 'error';
  part?: { type: string; value: unknown };
  error?: string;
}

// Serialized worker state for API
interface SerializedWorkerState {
  id: string;
  status: string;
  taskId?: string;
  branch?: string;
  messageCount: number;
  lastActivity: number;
}
```

---

## API Reference

### Authentication (Gateway)
```
POST /auth/login     { password } → { token }
POST /auth/logout    → { success }
```

### Sessions
```
GET    /api/sessions                    List all sessions
POST   /api/sessions                    Create session { agentType, folder }
GET    /api/sessions/:id                Get session details
POST   /api/sessions/:id/chat           Send message, SSE stream response
DELETE /api/sessions/:id                Delete session
```

### Orchestrator
```
GET    /api/orchestrator/plans          List plans
POST   /api/orchestrator/plans          Create plan { name, description }
GET    /api/orchestrator/plans/:id      Get plan details
POST   /api/orchestrator/plans/:id/start   Start plan execution
POST   /api/orchestrator/plans/:id/pause   Pause plan
GET    /api/orchestrator/tasks          List tasks (?planId=)
POST   /api/orchestrator/tasks          Add task { description, ... }
POST   /api/orchestrator/tasks/:id/deploy  Deploy task to worker
GET    /api/orchestrator/events         SSE stream of orchestrator events
```

### Workers
```
GET    /api/workers                     List all workers
GET    /api/workers/:id                 Get worker state
POST   /api/workers/:id/message         Send message to worker
POST   /api/workers/:id/approve         Handle approval { approvalId, approved }
POST   /api/workers/:id/complete        Complete worker
GET    /api/workers/:id/stream          SSE stream of worker updates
```

### Workspaces
```
GET    /api/workspaces                  List open workspaces
GET    /api/workspaces/recent           Recent folders
POST   /api/workspaces                  Open workspace { folder }
```

---

## Security Model

| Layer | Protection |
|-------|------------|
| Extension API | Localhost-only binding (`127.0.0.1`) |
| Gateway Auth | Password → JWT (7-day expiry) |
| Transport | HTTPS via nginx + Let's Encrypt |
| Rate Limiting | `express-rate-limit` on gateway |
| Input Validation | Sanitize before forwarding to extension |
| CORS | Same-origin only |

**Considerations**:
- JWT secret must be stored securely (environment variable)
- Password hash via bcrypt with appropriate cost factor
- Consider session invalidation mechanism for logout
- Rate limit aggressive on `/auth/login` to prevent brute force

---

## Open Questions & Decisions Needed

### Critical (Block Implementation)

1. **Stream Adapter Design**
   - How should `HttpResponseStreamAdapter` implement `vscode.ChatResponseStream`?
   - Need to research which methods are called during agent execution

2. **Session ↔ Worker Mapping**
   - Should web sessions create ad-hoc workers or proper orchestrator tasks?
   - Trade-off: simplicity vs. full orchestrator integration

3. **Port Conflict Handling**
   - What if port 19847 is in use?
   - Options: configurable port, auto-select, fail with message

### Important (Can Defer)

4. **Worker Mode Compatibility**
   - How does HTTP API interact with `COPILOT_WORKER_MODE`?
   - Should API be disabled in worker mode?

5. **Extension Setting**
   - Should HTTP API be opt-in via extension setting?
   - Security implications of always-on server

6. **Session Persistence**
   - Should sessions survive extension restart?
   - Storage: in-memory vs. file-based

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Stream adapter complexity | High - core functionality | Prototype early, research `WorkerSession` implementation |
| `IOrchestratorService` API mismatches | Medium - integration issues | Verify interface methods before implementing routes |
| Port conflicts | Low - deployment issue | Add configuration and clear error messages |
| SSE proxy issues | Medium - streaming broken | Test SSE through nginx proxy early |

---

## Implementation Phases

### Phase 1: Proof of Concept
**Goal**: Validate HTTP API can stream agent responses.

**Tasks**:
- [ ] Create minimal `HttpApiServer` with health endpoint
- [ ] Implement `HttpResponseStreamAdapter`
- [ ] Add single `/api/chat` endpoint (hardcoded agent)
- [ ] Test streaming with curl

**Success Criteria**:
- `POST /api/chat` returns SSE stream
- Agent response streams in real-time
- Connection closes cleanly on completion

**Estimated Effort**: 2-3 days

---

### Phase 2: Core Extension API
**Goal**: Full REST API for sessions, orchestrator, and workers.

**Tasks**:
- [ ] Session management (create, list, delete)
- [ ] Chat endpoint with session context
- [ ] Orchestrator routes (plans, tasks)
- [ ] Worker routes (list, message, stream)
- [ ] Workspace routes

**Success Criteria**:
- All endpoints functional via curl
- SSE streaming works for chat and worker updates
- Integration with `IOrchestratorService` verified

**Estimated Effort**: 1 week

---

### Phase 3: Web Gateway Backend
**Goal**: Authenticated proxy to extension API.

**Tasks**:
- [ ] Express server with JWT auth
- [ ] Proxy middleware to extension API
- [ ] Error handling for extension unavailable
- [ ] Rate limiting

**Success Criteria**:
- Login returns JWT
- Authenticated requests proxy to extension
- Unauthenticated requests rejected

**Estimated Effort**: 2-3 days

---

### Phase 4: Web Gateway Frontend
**Goal**: React UI for chat and orchestrator.

**Tasks**:
- [ ] Project setup (Vite + React + Tailwind)
- [ ] Login page
- [ ] Chat interface with streaming
- [ ] Session management sidebar
- [ ] Orchestrator dashboard
- [ ] Mobile-responsive layout

**Success Criteria**:
- Functional chat from browser
- Can view and manage orchestrator plans/tasks
- Works on mobile viewport

**Estimated Effort**: 1-2 weeks

---

### Phase 5: Deployment
**Goal**: Production deployment on Azure VM.

**Tasks**:
- [ ] VS Code tunnel setup (systemd)
- [ ] Extension installation
- [ ] Web gateway deployment (systemd)
- [ ] Nginx + HTTPS configuration
- [ ] Documentation

**Success Criteria**:
- Access chat from public URL
- HTTPS working
- Services restart on failure

**Estimated Effort**: 2-3 days

---

## Dependencies

**New npm packages (extension)**:
- `express` - HTTP server
- `@types/express` - TypeScript types

**New npm packages (gateway)**:
- `express` - HTTP server
- `jsonwebtoken` - JWT auth
- `bcrypt` - Password hashing
- `http-proxy-middleware` - API proxy
- `express-rate-limit` - Rate limiting

**Frontend**:
- React 18+
- Vite
- Tailwind CSS
- React Router

---

## References

- `src/extension/orchestrator/orchestratorServiceV2.ts` - `IOrchestratorService` interface
- `src/extension/orchestrator/workerSession.ts` - `WorkerSession` implementation
- `src/extension/agents/vscode-node/agentRunner.ts` - `IAgentRunner` interface
- VS Code Chat API - `vscode.ChatResponseStream` interface
