# Web Gateway API - Implementation Plan

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

## Phase 1: Extension HTTP API Server

### New Files

#### `src/extension/httpApi/httpApiServer.ts`
Main Express server that runs inside the extension.

```typescript
import * as express from 'express';
import { Server } from 'http';
import { Disposable } from 'vscode';

export interface IHttpApiServer extends Disposable {
  readonly port: number;
  readonly isRunning: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const IHttpApiServer = createServiceIdentifier<IHttpApiServer>('IHttpApiServer');

export class HttpApiServer extends Disposable implements IHttpApiServer {
  private _server: Server | undefined;
  private _app: express.Application;
  readonly port = 19847;

  constructor(
    @IOrchestratorService private readonly orchestratorService: IOrchestratorService,
    @ISubTaskManager private readonly subTaskManager: ISubTaskManager,
    @IAgentRunner private readonly agentRunner: IAgentRunner,
    @ILogService private readonly logService: ILogService,
  ) {
    super();
    this._app = express();
    this._setupMiddleware();
    this._setupRoutes();
  }

  private _setupMiddleware(): void {
    this._app.use(express.json());
    this._app.use((req, res, next) => {
      // Only allow localhost
      const host = req.hostname;
      if (host !== 'localhost' && host !== '127.0.0.1') {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    });
  }

  private _setupRoutes(): void {
    // Health check
    this._app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });

    // Mount route handlers
    this._app.use('/api/sessions', this._createSessionRouter());
    this._app.use('/api/orchestrator', this._createOrchestratorRouter());
    this._app.use('/api/workers', this._createWorkerRouter());
    this._app.use('/api/workspaces', this._createWorkspaceRouter());
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._server = this._app.listen(this.port, '127.0.0.1', () => {
        this.logService.info(`[HttpApiServer] Started on port ${this.port}`);
        resolve();
      });
      this._server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this._server) {
        this._server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
```

#### `src/extension/httpApi/routes/sessionRoutes.ts`
Session management endpoints.

```typescript
import { Router } from 'express';
import { v4 as uuid } from 'uuid';

export interface WebSession {
  id: string;
  agentType: string;
  folder: string;
  status: 'active' | 'idle' | 'completed';
  messages: WebMessage[];
  createdAt: number;
  lastActivityAt: number;
}

export interface WebMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  parts?: SerializedChatPart[];
}

export function createSessionRouter(
  sessionManager: IWebSessionManager,
  agentRunner: IAgentRunner,
): Router {
  const router = Router();

  // List all sessions
  router.get('/', (req, res) => {
    const sessions = sessionManager.getSessions();
    res.json({ sessions });
  });

  // Create new session
  router.post('/', async (req, res) => {
    const { agentType, folder } = req.body;
    const session = await sessionManager.createSession(agentType, folder);
    res.json({ session });
  });

  // Get session by ID
  router.get('/:id', (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json({ session });
  });

  // Send message (SSE streaming response)
  router.post('/:id/chat', async (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { message } = req.body;

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      await sessionManager.sendMessage(session.id, message, {
        onPart: (part) => {
          res.write(`data: ${JSON.stringify({ type: 'part', part })}\n\n`);
        },
        onComplete: (response) => {
          res.write(`data: ${JSON.stringify({ type: 'complete', response })}\n\n`);
          res.end();
        },
        onError: (error) => {
          res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
          res.end();
        },
      });
    } catch (error) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`);
      res.end();
    }
  });

  // Delete session
  router.delete('/:id', (req, res) => {
    const deleted = sessionManager.deleteSession(req.params.id);
    res.json({ deleted });
  });

  return router;
}
```

#### `src/extension/httpApi/routes/orchestratorRoutes.ts`
Orchestrator control endpoints.

```typescript
import { Router } from 'express';

export function createOrchestratorRouter(
  orchestratorService: IOrchestratorService,
): Router {
  const router = Router();

  // ===== PLANS =====

  // List all plans
  router.get('/plans', (req, res) => {
    const plans = orchestratorService.getPlans();
    res.json({ plans });
  });

  // Create plan
  router.post('/plans', (req, res) => {
    const { name, description, baseBranch } = req.body;
    const plan = orchestratorService.createPlan(name, description, baseBranch);
    res.json({ plan });
  });

  // Get plan by ID
  router.get('/plans/:id', (req, res) => {
    const plan = orchestratorService.getPlanById(req.params.id);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    res.json({ plan });
  });

  // Start plan
  router.post('/plans/:id/start', async (req, res) => {
    try {
      await orchestratorService.startPlan(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  // Pause plan
  router.post('/plans/:id/pause', (req, res) => {
    orchestratorService.pausePlan(req.params.id);
    res.json({ success: true });
  });

  // ===== TASKS =====

  // List tasks (optionally filter by plan)
  router.get('/tasks', (req, res) => {
    const planId = req.query.planId as string | undefined;
    const tasks = orchestratorService.getTasks(planId);
    res.json({ tasks });
  });

  // Add task
  router.post('/tasks', (req, res) => {
    const { description, planId, dependencies, agent, priority, targetFiles } = req.body;
    const task = orchestratorService.addTask(description, {
      planId,
      dependencies,
      agent,
      priority,
      targetFiles,
    });
    res.json({ task });
  });

  // Get ready tasks
  router.get('/tasks/ready', (req, res) => {
    const planId = req.query.planId as string | undefined;
    const tasks = orchestratorService.getReadyTasks(planId);
    res.json({ tasks });
  });

  // Deploy task
  router.post('/tasks/:id/deploy', async (req, res) => {
    try {
      const { modelId } = req.body;
      const worker = await orchestratorService.deploy(req.params.id, { modelId });
      res.json({ worker: serializeWorkerState(worker) });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  // ===== EVENTS (SSE) =====

  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const listener = orchestratorService.onOrchestratorEvent((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    req.on('close', () => {
      listener.dispose();
    });
  });

  return router;
}
```

#### `src/extension/httpApi/routes/workerRoutes.ts`
Worker management endpoints.

```typescript
import { Router } from 'express';

export function createWorkerRouter(
  orchestratorService: IOrchestratorService,
): Router {
  const router = Router();

  // List all workers
  router.get('/', (req, res) => {
    const workers = orchestratorService.getWorkerStates();
    res.json({ workers });
  });

  // Get worker by ID
  router.get('/:id', (req, res) => {
    const worker = orchestratorService.getWorkerState(req.params.id);
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    res.json({ worker });
  });

  // Send message to worker
  router.post('/:id/message', (req, res) => {
    const { message } = req.body;
    try {
      orchestratorService.sendMessageToWorker(req.params.id, message);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  // Handle approval
  router.post('/:id/approve', (req, res) => {
    const { approvalId, approved } = req.body;
    try {
      orchestratorService.handleApproval(req.params.id, approvalId, approved);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  // Complete worker
  router.post('/:id/complete', async (req, res) => {
    try {
      const result = await orchestratorService.completeWorker(req.params.id);
      res.json({ result });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  // Stream worker updates (SSE)
  router.get('/:id/stream', (req, res) => {
    const worker = orchestratorService.getWorkerState(req.params.id);
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send current state
    res.write(`data: ${JSON.stringify({ type: 'state', worker })}\n\n`);

    // TODO: Subscribe to worker updates
    const listener = orchestratorService.onDidChangeWorkers(() => {
      const updated = orchestratorService.getWorkerState(req.params.id);
      if (updated) {
        res.write(`data: ${JSON.stringify({ type: 'update', worker: updated })}\n\n`);
      }
    });

    req.on('close', () => {
      listener.dispose();
    });
  });

  return router;
}
```

#### `src/extension/httpApi/webSessionManager.ts`
Manages web sessions and bridges to agent execution.

```typescript
export interface IWebSessionManager {
  createSession(agentType: string, folder: string): Promise<WebSession>;
  getSession(id: string): WebSession | undefined;
  getSessions(): WebSession[];
  deleteSession(id: string): boolean;
  sendMessage(sessionId: string, message: string, callbacks: StreamCallbacks): Promise<void>;
}

export const IWebSessionManager = createServiceIdentifier<IWebSessionManager>('IWebSessionManager');

export class WebSessionManager implements IWebSessionManager {
  private readonly _sessions = new Map<string, WebSession>();
  private readonly _workerSessions = new Map<string, WorkerSession>();

  constructor(
    @IOrchestratorService private readonly orchestratorService: IOrchestratorService,
    @IAgentRunner private readonly agentRunner: IAgentRunner,
    @IInstantiationService private readonly instantiationService: IInstantiationService,
  ) {}

  async createSession(agentType: string, folder: string): Promise<WebSession> {
    const id = `web-session-${uuid()}`;

    // Create a WorkerSession to manage the conversation
    const workerSession = this.instantiationService.createInstance(
      WorkerSession,
      id,
      `Web Session: ${agentType}`,
      folder,
    );

    const session: WebSession = {
      id,
      agentType,
      folder,
      status: 'idle',
      messages: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    this._sessions.set(id, session);
    this._workerSessions.set(id, workerSession);

    return session;
  }

  async sendMessage(
    sessionId: string,
    message: string,
    callbacks: StreamCallbacks,
  ): Promise<void> {
    const session = this._sessions.get(sessionId);
    const workerSession = this._workerSessions.get(sessionId);

    if (!session || !workerSession) {
      throw new Error('Session not found');
    }

    // Add user message
    session.messages.push({
      id: uuid(),
      role: 'user',
      content: message,
      timestamp: Date.now(),
    });
    session.status = 'active';
    session.lastActivityAt = Date.now();

    // Set up streaming
    const assistantMessage: WebMessage = {
      id: uuid(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      parts: [],
    };

    workerSession.onStreamPart((part) => {
      assistantMessage.parts!.push(part);
      if (part.type === 'markdown') {
        assistantMessage.content += part.value;
      }
      callbacks.onPart(part);
    });

    try {
      // Run the agent
      const result = await this.agentRunner.run({
        prompt: message,
        sessionId,
        model: await this._getModel(session.agentType),
        // ... other options based on agentType
      });

      session.messages.push(assistantMessage);
      session.status = 'idle';
      callbacks.onComplete(result.response || '');
    } catch (error) {
      session.status = 'idle';
      callbacks.onError(error as Error);
    }
  }

  // ... other methods
}
```

### Modified Files

#### `src/extension/extension/vscode-node/extension.ts`
Start HTTP API server on extension activation.

```typescript
// Add to activate():
const httpApiServer = instantiationService.createInstance(HttpApiServer);
await httpApiServer.start();
context.subscriptions.push(httpApiServer);
```

#### `package.json`
Add Express dependency.

```json
{
  "dependencies": {
    "express": "^4.18.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21"
  }
}
```

---

## Phase 2: Web Gateway Service

The gateway is a **separate Node.js project** that runs independently of VS Code.

### Directory Structure

```
src/web-gateway/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # Express server
│   ├── auth/
│   │   ├── authMiddleware.ts # JWT validation
│   │   └── authService.ts    # Password/token management
│   ├── proxy/
│   │   └── extensionProxy.ts # Proxy to extension API
│   ├── routes/
│   │   ├── authRoutes.ts     # Login/logout
│   │   └── apiRoutes.ts      # Proxied API routes
│   └── config.ts             # Configuration
└── client/                   # React frontend
    ├── package.json
    ├── src/
    │   ├── App.tsx
    │   ├── components/
    │   │   ├── Chat/
    │   │   │   ├── ChatContainer.tsx
    │   │   │   ├── MessageList.tsx
    │   │   │   ├── MessageInput.tsx
    │   │   │   └── AgentPicker.tsx
    │   │   ├── Orchestrator/
    │   │   │   ├── PlanList.tsx
    │   │   │   ├── TaskList.tsx
    │   │   │   └── WorkerStatus.tsx
    │   │   ├── Sidebar/
    │   │   │   ├── SessionList.tsx
    │   │   │   └── FolderPicker.tsx
    │   │   └── Layout/
    │   │       ├── Header.tsx
    │   │       └── MobileNav.tsx
    │   ├── hooks/
    │   │   ├── useSession.ts
    │   │   ├── useChat.ts
    │   │   └── useOrchestrator.ts
    │   ├── api/
    │   │   └── client.ts     # API client with auth
    │   └── styles/
    │       └── tailwind.css
    └── vite.config.ts
```

### Key Files

#### `src/web-gateway/src/server.ts`

```typescript
import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { authMiddleware } from './auth/authMiddleware';
import { authRoutes } from './routes/authRoutes';
import path from 'path';

const app = express();
const EXTENSION_API_PORT = 19847;

app.use(cors());
app.use(express.json());

// Auth routes (no auth required)
app.use('/auth', authRoutes);

// API proxy (auth required)
app.use('/api', authMiddleware, createProxyMiddleware({
  target: `http://127.0.0.1:${EXTENSION_API_PORT}`,
  changeOrigin: true,
  onError: (err, req, res) => {
    res.status(502).json({
      error: 'VS Code extension not available',
      details: 'Make sure VS Code is running with the Copilot extension'
    });
  }
}));

// Serve React frontend
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Web Gateway running on port ${PORT}`);
});
```

#### `src/web-gateway/src/auth/authMiddleware.ts`

```typescript
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    (req as any).user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
```

#### `src/web-gateway/src/routes/authRoutes.ts`

```typescript
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { config } from '../config';

const router = Router();

// Simple password auth
router.post('/login', async (req, res) => {
  const { password } = req.body;

  const isValid = await bcrypt.compare(password, config.passwordHash);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = jwt.sign({ authenticated: true }, config.jwtSecret, {
    expiresIn: '7d',
  });

  res.json({ token });
});

router.post('/logout', (req, res) => {
  // Client-side token removal
  res.json({ success: true });
});

export { router as authRoutes };
```

#### `src/web-gateway/client/src/App.tsx`

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Chat } from './pages/Chat';
import { Orchestrator } from './pages/Orchestrator';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }>
            <Route index element={<Chat />} />
            <Route path="chat/:sessionId" element={<Chat />} />
            <Route path="orchestrator" element={<Orchestrator />} />
            <Route path="orchestrator/plans/:planId" element={<Orchestrator />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

#### `src/web-gateway/client/src/components/Chat/ChatContainer.tsx`

```tsx
import { useState, useEffect, useRef } from 'react';
import { useChat } from '../../hooks/useChat';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { AgentPicker } from './AgentPicker';

interface Props {
  sessionId: string;
}

export function ChatContainer({ sessionId }: Props) {
  const { messages, isStreaming, sendMessage } = useChat(sessionId);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      {/* Agent picker */}
      <div className="p-2 border-b">
        <AgentPicker sessionId={sessionId} />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        <MessageList messages={messages} isStreaming={isStreaming} />
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t">
        <MessageInput
          onSend={sendMessage}
          disabled={isStreaming}
        />
      </div>
    </div>
  );
}
```

#### `src/web-gateway/client/src/hooks/useChat.ts`

```tsx
import { useState, useCallback } from 'react';
import { api } from '../api/client';

export function useChat(sessionId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const sendMessage = useCallback(async (content: string) => {
    // Add user message immediately
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMessage]);
    setIsStreaming(true);

    // Prepare assistant message
    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, assistantMessage]);

    try {
      // Stream response via SSE
      const response = await fetch(`/api/sessions/${sessionId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${api.getToken()}`,
        },
        body: JSON.stringify({ message: content }),
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'part' && data.part.type === 'markdown') {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === 'assistant') {
                  last.content += data.part.value;
                }
                return updated;
              });
            }
          }
        }
      }
    } finally {
      setIsStreaming(false);
    }
  }, [sessionId]);

  return { messages, isStreaming, sendMessage };
}
```

---

## Phase 3: Deployment

### Azure VM Setup

#### 1. Install VS Code CLI

```bash
# Download VS Code CLI
curl -L "https://code.visualstudio.com/sha/download?build=stable&os=cli-alpine-x64" -o vscode-cli.tar.gz
tar -xzf vscode-cli.tar.gz
sudo mv code /usr/local/bin/

# Authenticate with GitHub
code tunnel user login --provider github
```

#### 2. Create systemd service for VS Code Tunnel

```bash
# /etc/systemd/system/vscode-tunnel.service
[Unit]
Description=VS Code Tunnel
After=network.target

[Service]
Type=simple
User=azureuser
Environment="HOME=/home/azureuser"
WorkingDirectory=/home/azureuser
ExecStart=/usr/local/bin/code tunnel --accept-server-license-terms --name azure-copilot
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable vscode-tunnel
sudo systemctl start vscode-tunnel
```

#### 3. Install Extension

```bash
# Build extension on dev machine
npm run package

# Copy to Azure VM
scp copilot-chat-*.vsix azureuser@your-vm:/tmp/

# Install via code CLI
code tunnel extension install /tmp/copilot-chat-*.vsix
```

#### 4. Deploy Web Gateway

```bash
# Clone/copy web-gateway to VM
cd /home/azureuser/web-gateway

# Install dependencies
npm install

# Set environment variables
cat > .env << EOF
PORT=3000
JWT_SECRET=$(openssl rand -hex 32)
PASSWORD_HASH=$(node -e "console.log(require('bcrypt').hashSync('your-password', 10))")
EOF

# Build frontend
cd client && npm install && npm run build && cd ..

# Create systemd service
sudo cat > /etc/systemd/system/copilot-gateway.service << EOF
[Unit]
Description=Copilot Web Gateway
After=network.target vscode-tunnel.service

[Service]
Type=simple
User=azureuser
WorkingDirectory=/home/azureuser/web-gateway
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
EnvironmentFile=/home/azureuser/web-gateway/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable copilot-gateway
sudo systemctl start copilot-gateway
```

#### 5. Setup HTTPS with Nginx

```bash
sudo apt install nginx certbot python3-certbot-nginx

# Configure nginx
sudo cat > /etc/nginx/sites-available/copilot << EOF
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;

        # SSE support
        proxy_buffering off;
        proxy_cache off;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/copilot /etc/nginx/sites-enabled/
sudo certbot --nginx -d your-domain.com
sudo systemctl restart nginx
```

---

## API Reference

### Authentication

```
POST /auth/login
Body: { "password": "your-password" }
Response: { "token": "jwt-token" }
```

### Sessions

```
GET    /api/sessions                    # List sessions
POST   /api/sessions                    # Create session
       Body: { "agentType": "@agent", "folder": "/path" }
GET    /api/sessions/:id                # Get session
POST   /api/sessions/:id/chat           # Send message (SSE stream)
       Body: { "message": "Hello" }
DELETE /api/sessions/:id                # Delete session
```

### Orchestrator

```
GET    /api/orchestrator/plans          # List plans
POST   /api/orchestrator/plans          # Create plan
GET    /api/orchestrator/plans/:id      # Get plan
POST   /api/orchestrator/plans/:id/start    # Start plan
POST   /api/orchestrator/plans/:id/pause    # Pause plan
GET    /api/orchestrator/tasks          # List tasks
POST   /api/orchestrator/tasks          # Add task
POST   /api/orchestrator/tasks/:id/deploy   # Deploy task
GET    /api/orchestrator/events         # SSE event stream
```

### Workers

```
GET    /api/workers                     # List workers
GET    /api/workers/:id                 # Get worker
POST   /api/workers/:id/message         # Send message
POST   /api/workers/:id/approve         # Handle approval
POST   /api/workers/:id/complete        # Complete worker
GET    /api/workers/:id/stream          # SSE worker stream
```

### Workspaces

```
GET    /api/workspaces                  # List open workspaces
GET    /api/workspaces/recent           # Recent folders
POST   /api/workspaces                  # Open workspace
       Body: { "folder": "/path/to/folder" }
GET    /api/workspaces/worktrees        # Git worktrees
```

---

## Security Considerations

1. **Extension API is localhost-only** - No external access possible
2. **Gateway requires authentication** - Password + JWT
3. **HTTPS enforced** - Via nginx/certbot
4. **Rate limiting** - Add express-rate-limit to gateway
5. **Input validation** - Sanitize all inputs before forwarding
6. **Session timeout** - JWT expires after 7 days
7. **CORS restricted** - Only allow same-origin requests

---

## Implementation Order

1. **Week 1**: Extension HTTP API
   - [ ] Create httpApiServer.ts skeleton
   - [ ] Implement session routes
   - [ ] Implement WebSessionManager
   - [ ] Test with curl locally

2. **Week 2**: Extension HTTP API (continued)
   - [ ] Implement orchestrator routes
   - [ ] Implement worker routes
   - [ ] Add SSE streaming
   - [ ] Integration tests

3. **Week 3**: Web Gateway Backend
   - [ ] Set up Express server
   - [ ] Implement auth (password + JWT)
   - [ ] Implement proxy to extension API
   - [ ] Test end-to-end

4. **Week 4**: Web Gateway Frontend
   - [ ] React + Vite + Tailwind setup
   - [ ] Login page
   - [ ] Chat interface
   - [ ] Mobile responsive design

5. **Week 5**: Frontend (continued)
   - [ ] Orchestrator dashboard
   - [ ] Worker status views
   - [ ] Session management UI
   - [ ] Polish and UX improvements

6. **Week 6**: Deployment
   - [ ] Azure VM setup scripts
   - [ ] systemd services
   - [ ] Nginx + HTTPS
   - [ ] Documentation
