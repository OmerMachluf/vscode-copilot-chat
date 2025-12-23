# Web Gateway Architecture

## Vision

A lightweight web gateway that provides remote access to VS Code Copilot Chat from any device (including mobile). The gateway acts as a thin proxy layer, translating HTTP/WebSocket requests into extension API calls while maintaining full feature parity with the VS Code experience.

**Core Principle**: Keep the gateway simple. All intelligence lives in the extension. The gateway is just a secure tunnel.

---

## Current State & Immediate Fix

### The SSE Proxy Crash

**Root Cause**: The `onProxyReq` handler in `apiProxy.ts:70` calls `proxyReq.setHeader()` after the extension has already sent SSE headers via `writeHead()`.

**The Problem Flow**:
1. Request arrives at gateway `/api/chat`
2. Proxy forwards to extension at `:19847/api/chat`
3. Extension calls `writeHead(200, { 'Content-Type': 'text/event-stream' })` immediately
4. Proxy's `onProxyReq` fires and tries to `setHeader()` on an already-started response
5. Node throws `ERR_HTTP_HEADERS_SENT`

**Fix Strategy**: Move header additions to happen before the request is sent, not in a callback. The `onProxyReq` handler should only modify the *outgoing* request to the extension, not attempt to modify headers after streaming begins.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Mobile / Browser                             │
│                    (React/Next.js PWA Frontend)                      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTPS + WSS
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Web Gateway (Node.js)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │    Auth     │  │   Proxy     │  │  Launcher   │  │  Static    │ │
│  │  (JWT/API)  │  │ (HTTP+SSE)  │  │  Service    │  │   Files    │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │
│                           │                │                         │
│                    ┌──────┴────────────────┘                         │
│                    ▼                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    WebSocket Hub                                 ││
│  │  (Multiplexes events from extension to connected clients)       ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP (localhost/private network)
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    VS Code Extension HTTP API                        │
│                         (Port 19847)                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │    Chat     │  │ Orchestrator│  │   Workers   │  │   Plans    │ │
│  │   (SSE)     │  │   Events    │  │   Control   │  │  Storage   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Design

### 1. Web Gateway Server

**Role**: Secure entry point. Authentication, routing, static file serving.

**Responsibilities**:
- JWT/API key authentication
- Rate limiting
- CORS handling
- Serve frontend static files (PWA)
- Route API requests to proxy
- Host WebSocket hub

**Does NOT do**:
- Business logic
- Chat processing
- Agent selection
- State management

### 2. Proxy Layer

**Role**: Forward HTTP requests to extension API.

**Key Design Decisions**:
- **SSE passthrough**: Don't buffer SSE responses. Set `selfHandleResponse: false` and disable all buffering.
- **No header modification on streaming**: Only add headers to the initial proxy request, never in `onProxyRes` for SSE.
- **Timeout handling**: 2 minutes for chat requests, 30 seconds for others.
- **Health-aware routing**: Check extension availability before long operations.

### 3. WebSocket Hub

**Role**: Real-time event delivery to connected clients.

**Pattern**: The gateway maintains a single connection to extension events and fans out to all connected browser clients.

```
Extension ──(SSE)──► Gateway ──(WebSocket)──► Client 1
                           └──(WebSocket)──► Client 2
                           └──(WebSocket)──► Client N
```

**Why WebSocket for clients instead of SSE?**:
- Bidirectional (client can send messages)
- Better mobile support
- Single connection for all event types
- Easier reconnection handling

### 4. Launcher Service

**Role**: Launch VS Code instances on demand.

**API**: `POST /api/launcher/open`

**Request**:
```json
{
  "path": "/path/to/project",
  "newWindow": true
}
```

**Implementation**: Shell out to `code` CLI.
- Windows: `code.cmd`
- Mac/Linux: `code`
- WSL: `code` (works if VS Code Server is installed)

**Security**: Path validation required. Only allow paths within configured allowed directories.

### 5. Frontend (PWA)

**Role**: Mobile-first chat interface.

**Key Requirements**:
- Responsive design (mobile-first)
- Offline capability (service worker for static assets)
- Touch-friendly controls
- Real-time updates via WebSocket

---

## API Design

### Authentication

```
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
```

All other `/api/*` routes require `Authorization: Bearer <token>` header.

### Chat

```
POST /api/chat/stream
  Body: { message, agentType?, sessionId? }
  Response: SSE stream

POST /api/chat/message
  Body: { sessionId, message }
  Response: SSE stream (continues existing session)

GET /api/chat/sessions
  Response: { sessions: [...] }

GET /api/chat/sessions/:id
  Response: { session, messages }

DELETE /api/chat/sessions/:id
  Response: { success: true }

POST /api/chat/sessions/:id/pause
  Response: { success: true }

POST /api/chat/sessions/:id/resume
  Response: { success: true }
```

### Orchestrator

```
# Plans
GET    /api/orchestrator/plans
POST   /api/orchestrator/plans
GET    /api/orchestrator/plans/:id
DELETE /api/orchestrator/plans/:id
POST   /api/orchestrator/plans/:id/start
POST   /api/orchestrator/plans/:id/pause

# Tasks
GET    /api/orchestrator/plans/:id/tasks
POST   /api/orchestrator/plans/:id/tasks
GET    /api/orchestrator/tasks/:id
DELETE /api/orchestrator/tasks/:id
POST   /api/orchestrator/tasks/:id/deploy
POST   /api/orchestrator/tasks/:id/retry

# Workers
GET    /api/orchestrator/workers
GET    /api/orchestrator/workers/:id
GET    /api/orchestrator/workers/:id/messages
POST   /api/orchestrator/workers/:id/message
POST   /api/orchestrator/workers/:id/pause
POST   /api/orchestrator/workers/:id/resume
POST   /api/orchestrator/workers/:id/complete
DELETE /api/orchestrator/workers/:id

# Graph (for visualization)
GET    /api/orchestrator/plans/:id/graph
  Response: { nodes: [...], edges: [...] }
```

### Launcher

```
POST /api/launcher/open
  Body: { path, newWindow? }
  Response: { success: true }

GET /api/launcher/recent
  Response: { paths: [...] }
```

### WebSocket

```
WS /ws
  Client sends: { type: 'subscribe', channels: ['chat', 'orchestrator', 'workers'] }
  Server sends: { type: 'event', channel: 'chat', data: {...} }
```

---

## Agent Selection

The frontend provides UI to select:

1. **Agent Type**: `agent`, `architect`, `orchestrator`, `reviewer`, `researcher`, etc.
2. **Backend**: `local` (VS Code extension) or `claude:` prefix (Claude CLI agents)

**How it works**:
- Agent type is passed in the `agentType` field of chat requests
- For `claude:` prefixed agents, the extension routes to Claude CLI instead of local agents
- The gateway is agnostic - it just forwards the request

**Frontend UI**:
```
┌─────────────────────────────────────┐
│  Agent: [Architect ▼]  Backend: [◉ Local  ○ Claude]  │
└─────────────────────────────────────┘
```

---

## Mobile Compatibility

### Responsive Design Principles

1. **Single-column layout** on mobile
2. **Bottom navigation** for primary actions
3. **Swipe gestures** for panels (chat list, worker list)
4. **Pull-to-refresh** for updates
5. **Touch targets** minimum 44x44px

### Layout Structure

```
Mobile Portrait:
┌─────────────────────┐
│ Header (agent/mode) │
├─────────────────────┤
│                     │
│    Chat Messages    │
│    (scrollable)     │
│                     │
├─────────────────────┤
│   Input + Actions   │
├─────────────────────┤
│  ◀ Chat │ Plan │ ⚙  │
└─────────────────────┘

Tablet/Desktop:
┌──────────┬───────────────────┬──────────┐
│          │                   │          │
│  Plans   │   Chat/Worker     │  Details │
│  (240px) │   (flex)          │  (300px) │
│          │                   │          │
└──────────┴───────────────────┴──────────┘
```

### PWA Features

- Add to home screen
- Offline static assets
- Push notifications (future: worker completion alerts)
- Background sync (future: queue messages when offline)

---

## Session & Conversation Management

### Session Continuity

Sessions are managed by the extension, not the gateway. The gateway passes `sessionId` through and the extension handles:

- Conversation history
- Context preservation
- Pause/resume state

### Intent Translation

The extension already handles intent translation (e.g., "fix this" → appropriate tool calls). The gateway simply forwards the user's message.

### Pause/Resume

```
POST /api/chat/sessions/:id/pause
  → Extension saves session state
  → Returns { paused: true, canResume: true }

POST /api/chat/sessions/:id/resume
  → Extension restores session
  → Returns SSE stream with resumed context
```

---

## Orchestrator Panel

### Plan Visualization

The orchestrator panel shows:

1. **Plan List**: All plans with status indicators
2. **Task Graph**: Visual DAG of tasks and dependencies
3. **Worker Status**: Running workers with real-time output
4. **Inbox**: Pending approvals and escalations

### Graph Rendering

Use a lightweight graph library (e.g., `dagre` for layout, `react-flow` or plain SVG for rendering).

```
GET /api/orchestrator/plans/:id/graph

Response:
{
  "nodes": [
    { "id": "task-1", "label": "Setup project", "status": "completed" },
    { "id": "task-2", "label": "Implement auth", "status": "running" },
    { "id": "task-3", "label": "Add tests", "status": "pending" }
  ],
  "edges": [
    { "from": "task-1", "to": "task-2" },
    { "from": "task-2", "to": "task-3" }
  ]
}
```

### Real-time Updates

The WebSocket connection receives orchestrator events:
- `task.started`
- `task.completed`
- `task.failed`
- `worker.needs_approval`
- `worker.idle`

Frontend updates the graph/list in real-time based on these events.

---

## Security Considerations

### Authentication

- JWT tokens with short expiry (15 min)
- Refresh tokens stored in httpOnly cookies
- API keys for service-to-service (optional)

### Network Security

- Gateway should run on HTTPS in production
- Extension API only accepts private network connections
- Path validation for launcher service

### Rate Limiting

- Global: 1000 req/min per IP
- Chat: 10 req/min per user
- Launcher: 5 req/min per user

---

## Implementation Phases

### Phase 1: Fix & Stabilize (Immediate)
- Fix SSE proxy crash
- Verify chat streaming works end-to-end
- Add proper error handling for proxy failures

### Phase 2: Core API (Week 1)
- Add launcher service endpoint
- Expose orchestrator read APIs (plans, tasks, workers)
- Add WebSocket hub for real-time events

### Phase 3: Full Orchestrator (Week 2)
- Orchestrator mutation APIs (create plan, add task, deploy)
- Worker control (pause, resume, message, complete)
- Graph endpoint for visualization

### Phase 4: Session Management (Week 3)
- Chat session listing
- Pause/resume functionality
- Session deletion

### Phase 5: Frontend (Week 4)
- Mobile-responsive chat UI
- Agent/backend selector
- Basic orchestrator panel

### Phase 6: Polish (Week 5)
- PWA setup
- Offline support
- Push notifications
- Performance optimization

---

## File Structure

```
src/web-gateway/
├── src/
│   ├── server.ts              # Express app setup
│   ├── config.ts              # Environment config
│   ├── proxy/
│   │   ├── apiProxy.ts        # HTTP proxy middleware
│   │   └── sseHandler.ts      # SSE-specific handling
│   ├── routes/
│   │   ├── auth.ts            # Authentication routes
│   │   ├── launcher.ts        # VS Code launcher
│   │   └── index.ts           # Route aggregation
│   ├── middleware/
│   │   ├── auth.ts            # JWT validation
│   │   └── rateLimit.ts       # Rate limiting
│   ├── websocket/
│   │   └── hub.ts             # WebSocket event hub
│   └── utils/
│       └── logger.ts          # Logging utility
├── public/                     # Frontend static files (built)
├── package.json
└── tsconfig.json
```

---

## Extension API Additions Needed

To support the full gateway vision, the extension HTTP API needs:

1. **Session endpoints**:
   - `GET /api/sessions` - list sessions
   - `GET /api/sessions/:id` - get session with messages
   - `POST /api/sessions/:id/pause`
   - `POST /api/sessions/:id/resume`
   - `DELETE /api/sessions/:id`

2. **Orchestrator endpoints**:
   - Full CRUD for plans and tasks
   - Worker control endpoints
   - Event stream endpoint (SSE or WebSocket)
   - Graph data endpoint

3. **System endpoints**:
   - `GET /api/agents` - list available agents
   - `GET /api/models` - list available models

These can be added incrementally as the gateway features are built.
