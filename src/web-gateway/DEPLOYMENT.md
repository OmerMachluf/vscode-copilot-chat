# Web Gateway Deployment Guide

This guide covers deploying the Copilot Web Gateway to a production environment. The gateway provides a secure, web-accessible interface to control VS Code Copilot from browsers and mobile devices.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Deployment Options](#deployment-options)
- [Security Hardening](#security-hardening)
- [Troubleshooting](#troubleshooting)
- [API Reference](#api-reference)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           INTERNET                                   │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    NGINX REVERSE PROXY                               │
│                   (Port 443 - SSL/TLS)                               │
│  • SSL termination        • Rate limiting                           │
│  • Security headers       • WebSocket/SSE support                   │
│  • Static file serving    • Request routing                         │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    WEB GATEWAY (Node.js)                             │
│                   (Port 3000 - localhost)                            │
│  • JWT authentication     • API proxy                               │
│  • CORS handling          • Request logging                         │
│  • Rate limiting          • Error handling                          │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                VS CODE EXTENSION HTTP API                            │
│                   (Port 19847 - localhost)                           │
│  • Chat endpoints         • Orchestrator control                    │
│  • Session management     • Tool execution                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

### System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| OS | Linux with systemd | Ubuntu 22.04 LTS / Debian 12 |
| Node.js | 18.0.0 | 20.x LTS |
| RAM | 512 MB | 1 GB |
| Disk | 100 MB | 500 MB |
| CPU | 1 core | 2 cores |

### Software Dependencies

```bash
# Node.js 20.x (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Nginx
sudo apt-get install -y nginx

# Build essentials (for native dependencies like bcrypt)
sudo apt-get install -y build-essential python3
```

### Network Requirements

| Port | Protocol | Direction | Purpose |
|------|----------|-----------|---------|
| 443 | HTTPS | Inbound | External client access |
| 80 | HTTP | Inbound | HTTP to HTTPS redirect |
| 3000 | HTTP | Internal | Gateway server (localhost only) |
| 19847 | HTTP | Internal | VS Code Extension API (localhost only) |

### SSL Certificate

Obtain an SSL certificate for your domain. Let's Encrypt is recommended for free certificates:

```bash
# Install Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# Obtain certificate
sudo certbot certonly --nginx -d your-domain.com
```

---

## Installation

### Step 1: Create System User

Create a dedicated system user for running the gateway:

```bash
sudo useradd --system --no-create-home --shell /bin/false copilot-gateway
```

### Step 2: Create Directory Structure

```bash
# Create application directory
sudo mkdir -p /opt/copilot-gateway

# Create configuration directory
sudo mkdir -p /etc/copilot-gateway

# Create log directory (optional)
sudo mkdir -p /var/log/copilot-gateway
```

### Step 3: Build the Application

```bash
# Clone or copy the source code
cd /path/to/source

# Install dependencies and build backend
cd src/web-gateway
npm ci --production=false
npm run build

# Install dependencies and build frontend
cd client
npm ci --production=false
npm run build
```

### Step 4: Deploy Files

```bash
# Copy compiled backend
sudo cp -r /path/to/source/src/web-gateway/dist /opt/copilot-gateway/
sudo cp /path/to/source/src/web-gateway/package.json /opt/copilot-gateway/
sudo cp /path/to/source/src/web-gateway/package-lock.json /opt/copilot-gateway/

# Copy compiled frontend (static files)
sudo mkdir -p /opt/copilot-gateway/public
sudo cp -r /path/to/source/src/web-gateway/client/dist/* /opt/copilot-gateway/public/

# Install production dependencies
cd /opt/copilot-gateway
sudo npm ci --production

# Set ownership
sudo chown -R copilot-gateway:copilot-gateway /opt/copilot-gateway
```

### Step 5: Configure Environment

```bash
# Copy and edit environment configuration
sudo cp /path/to/source/deploy/systemd/gateway.env.example /etc/copilot-gateway/gateway.env
sudo chmod 600 /etc/copilot-gateway/gateway.env
sudo chown copilot-gateway:copilot-gateway /etc/copilot-gateway/gateway.env

# Edit configuration
sudo nano /etc/copilot-gateway/gateway.env
```

### Step 6: Install Systemd Service

```bash
# Copy service file
sudo cp /path/to/source/deploy/systemd/copilot-gateway.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable and start service
sudo systemctl enable copilot-gateway
sudo systemctl start copilot-gateway

# Verify status
sudo systemctl status copilot-gateway
```

### Step 7: Configure Nginx

```bash
# Copy nginx configuration
sudo cp /path/to/source/deploy/nginx/copilot-gateway.conf /etc/nginx/sites-available/

# Edit configuration (update server_name and SSL paths)
sudo nano /etc/nginx/sites-available/copilot-gateway.conf

# Enable site
sudo ln -s /etc/nginx/sites-available/copilot-gateway.conf /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

---

## Configuration

### Environment Variables

Create `/etc/copilot-gateway/gateway.env` with the following variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Server port (should match nginx upstream) |
| `NODE_ENV` | No | `production` | Environment (`development`, `production`, `test`) |
| `JWT_SECRET` | **Yes** | - | Secret key for JWT signing (min 32 chars) |
| `JWT_EXPIRES_IN` | No | `24h` | Token expiration (`1h`, `7d`, `24h`) |
| `EXTENSION_API_URL` | No | `http://localhost:3001` | VS Code extension API URL |
| `CORS_ORIGINS` | No | - | Allowed CORS origins (comma-separated) |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate limit window (15 min) |
| `RATE_LIMIT_MAX` | No | `100` | Max requests per window |
| `ENABLE_LOGGING` | No | `false` | Enable request logging |

#### Example Production Configuration

```bash
# /etc/copilot-gateway/gateway.env

# Server
PORT=3000
NODE_ENV=production

# Security - CHANGE THIS!
JWT_SECRET=your-secure-random-string-at-least-32-characters-long
JWT_EXPIRES_IN=24h

# Extension API
EXTENSION_API_URL=http://127.0.0.1:19847

# CORS (empty for same-origin only, or specify allowed origins)
CORS_ORIGINS=https://your-domain.com

# Rate limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100

# Logging (disable in production for performance)
ENABLE_LOGGING=false
```

#### Generating a Secure JWT Secret

```bash
# Generate a 64-character random string
openssl rand -base64 48
```

### Nginx Configuration

Key settings to customize in `/etc/nginx/sites-available/copilot-gateway.conf`:

```nginx
# Update server name
server_name your-domain.com;

# Update SSL certificate paths
ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

# Update static files path if different
root /opt/copilot-gateway/public;
```

---

## Deployment Options

### Option A: Single Server Deployment

Best for small teams or personal use. All components run on the same machine.

```
[Browser] → [Nginx:443] → [Gateway:3000] → [Extension:19847]
                              ↓
                        [VS Code Instance]
```

### Option B: Separate Gateway Server

For better security, run the gateway on a separate server from VS Code:

```
Server 1 (Gateway):
[Browser] → [Nginx:443] → [Gateway:3000]
                              ↓
                        SSH Tunnel/VPN
                              ↓
Server 2 (VS Code):
                    [Extension:19847]
```

Configure SSH tunnel:
```bash
# On gateway server, create tunnel to VS Code server
ssh -L 19847:localhost:19847 user@vscode-server -N -f
```

### Option C: Docker Deployment

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY dist/ ./dist/
COPY public/ ./public/

USER node
EXPOSE 3000

CMD ["node", "dist/server.js"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  gateway:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - JWT_SECRET=${JWT_SECRET}
    restart: unless-stopped
```

---

## Security Hardening

### Systemd Security Features

The provided systemd service includes these security hardening measures:

| Feature | Description |
|---------|-------------|
| `NoNewPrivileges=true` | Prevents privilege escalation |
| `ProtectSystem=strict` | Read-only filesystem access |
| `ProtectHome=true` | No access to /home directories |
| `PrivateTmp=true` | Isolated temporary directory |
| `RestrictAddressFamilies` | Network family restrictions |
| `RestrictSUIDSGID=true` | No setuid/setgid |

### Nginx Security Headers

The nginx configuration includes:

- **HSTS**: 2-year max-age with subdomains and preload
- **X-Content-Type-Options**: nosniff
- **X-Frame-Options**: SAMEORIGIN
- **X-XSS-Protection**: 1; mode=block
- **Content-Security-Policy**: Restrictive CSP for React SPA
- **Permissions-Policy**: Deny geolocation, microphone, camera, payment

### Rate Limiting

| Zone | Limit | Purpose |
|------|-------|---------|
| `api_limit` | 10 req/s | General API endpoints |
| `auth_limit` | 5 req/s | Authentication endpoints |
| `conn_limit` | 50 connections | Per-IP connection limit |

### Additional Recommendations

1. **Firewall Configuration**
   ```bash
   # Allow only necessary ports
   sudo ufw default deny incoming
   sudo ufw allow ssh
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```

2. **Fail2ban Integration**
   ```bash
   # Install fail2ban
   sudo apt-get install -y fail2ban

   # Configure jail for nginx
   sudo nano /etc/fail2ban/jail.local
   ```

3. **Regular Updates**
   ```bash
   # Keep system updated
   sudo apt-get update && sudo apt-get upgrade -y

   # Update Node.js dependencies periodically
   cd /opt/copilot-gateway && npm audit fix
   ```

---

## Troubleshooting

### Common Issues

#### Service Won't Start

**Symptoms**: `systemctl status copilot-gateway` shows failed state.

**Solutions**:
```bash
# Check logs
sudo journalctl -u copilot-gateway -n 50 --no-pager

# Common issues:
# 1. Missing environment file
sudo ls -la /etc/copilot-gateway/gateway.env

# 2. Permission issues
sudo chown -R copilot-gateway:copilot-gateway /opt/copilot-gateway

# 3. Port already in use
sudo lsof -i :3000

# 4. Missing dependencies
cd /opt/copilot-gateway && sudo npm ci --production
```

#### 502 Bad Gateway

**Symptoms**: Nginx returns 502 error.

**Solutions**:
```bash
# 1. Check if gateway is running
sudo systemctl status copilot-gateway

# 2. Check if gateway is listening on correct port
curl -v http://localhost:3000/health

# 3. Check nginx error log
sudo tail -f /var/log/nginx/error.log

# 4. Verify upstream configuration in nginx matches gateway port
```

#### 503 Service Unavailable

**Symptoms**: Gateway returns 503 when proxying to extension.

**Solutions**:
```bash
# 1. Check if VS Code extension API is running
curl -v http://localhost:19847/health

# 2. Verify EXTENSION_API_URL in gateway config
cat /etc/copilot-gateway/gateway.env | grep EXTENSION

# 3. Check VS Code extension logs
# (In VS Code: Output panel → "Copilot HTTP API")
```

#### JWT Authentication Failures

**Symptoms**: 401 Unauthorized errors.

**Solutions**:
```bash
# 1. Verify JWT_SECRET is set and matches
cat /etc/copilot-gateway/gateway.env | grep JWT

# 2. Check token expiration
# Decode JWT at jwt.io to verify exp claim

# 3. Ensure Authorization header format is correct:
# Authorization: Bearer <token>

# 4. Restart service after config changes
sudo systemctl restart copilot-gateway
```

#### WebSocket Connection Issues

**Symptoms**: WebSocket upgrades fail, real-time features don't work.

**Solutions**:
```bash
# 1. Verify nginx WebSocket configuration
grep -A 10 "location /ws" /etc/nginx/sites-available/copilot-gateway.conf

# 2. Check nginx supports WebSocket
nginx -V 2>&1 | grep -o with-http_v2_module

# 3. Test WebSocket connection
curl -i -N -H "Connection: Upgrade" \
     -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Key: test" \
     -H "Sec-WebSocket-Version: 13" \
     https://your-domain.com/ws
```

#### SSE Streaming Not Working

**Symptoms**: Chat streaming or orchestrator events don't update in real-time.

**Solutions**:
```bash
# 1. Verify nginx buffering is disabled for SSE endpoints
grep -B 2 -A 5 "text/event-stream" /etc/nginx/sites-available/copilot-gateway.conf

# 2. Check proxy_buffering is off
grep "proxy_buffering" /etc/nginx/sites-available/copilot-gateway.conf

# 3. Test SSE endpoint directly
curl -N -H "Accept: text/event-stream" \
     -H "Authorization: Bearer <token>" \
     https://your-domain.com/api/orchestrator/events
```

### Monitoring Commands

```bash
# Service status
sudo systemctl status copilot-gateway

# Live logs
sudo journalctl -u copilot-gateway -f

# Resource usage
sudo systemctl show copilot-gateway --property=MemoryCurrent,CPUUsageNSec

# Active connections
ss -tlnp | grep :3000

# Nginx access logs
sudo tail -f /var/log/nginx/access.log

# Nginx error logs
sudo tail -f /var/log/nginx/error.log
```

### Health Check Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/health` | GET | No | Gateway health status |
| `/api` | GET | No | API version info |
| `/api/status` | GET | Yes | Extension connection status |

```bash
# Check gateway health
curl https://your-domain.com/health

# Expected response:
# {"status":"ok","timestamp":"2024-...","environment":"production"}
```

---

## API Reference

### Authentication

#### POST `/api/auth/login`

Authenticate and obtain JWT token.

**Request:**
```json
{
  "method": "password",
  "email": "user@example.com",
  "password": "your-password"
}
```
or
```json
{
  "method": "api-key",
  "apiKey": "your-api-key"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Rate Limit:** 5 requests/second

---

### Chat Endpoints

#### POST `/api/chat`

Send a chat message (non-streaming).

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request:**
```json
{
  "message": "Help me write a function",
  "sessionId": "optional-session-id"
}
```

**Response:**
```json
{
  "message": {
    "id": "msg-123",
    "role": "assistant",
    "content": "Here's a function..."
  },
  "sessionId": "session-456"
}
```

#### POST `/api/chat/stream`

Send a chat message with streaming response (SSE).

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
Accept: text/event-stream
```

**Request:**
```json
{
  "message": "Help me write a function",
  "sessionId": "optional-session-id"
}
```

**Response (SSE):**
```
event: start
data: {"messageId":"msg-123"}

event: content
data: {"content":"Here's"}

event: content
data: {"content":" a function"}

event: done
data: {"messageId":"msg-123"}
```

---

### Orchestrator Endpoints

#### GET `/api/orchestrator/state`

Get current orchestrator state.

**Response:**
```json
{
  "status": "running",
  "activePlans": 2,
  "activeWorkers": 5
}
```

#### GET `/api/orchestrator/plans`

List all plans.

**Response:**
```json
[
  {
    "id": "plan-1",
    "name": "Feature Implementation",
    "status": "running",
    "taskCount": 5,
    "completedTasks": 2
  }
]
```

#### POST `/api/orchestrator/plans`

Create a new plan.

**Request:**
```json
{
  "name": "My Plan",
  "description": "Plan description"
}
```

#### POST `/api/orchestrator/plans/:id/start`

Start plan execution.

#### POST `/api/orchestrator/plans/:id/pause`

Pause plan execution.

#### GET `/api/orchestrator/tasks`

List tasks. Optional query: `?planId=plan-1`

#### POST `/api/orchestrator/tasks`

Create a new task.

**Request:**
```json
{
  "planId": "plan-1",
  "name": "Implement feature",
  "description": "Task details",
  "dependencies": ["task-1"]
}
```

#### POST `/api/orchestrator/tasks/:id/deploy`

Deploy task to a worker.

#### POST `/api/orchestrator/tasks/:id/complete`

Mark task as complete.

#### POST `/api/orchestrator/tasks/:id/cancel`

Cancel task. Optional body: `{"remove": true}`

#### POST `/api/orchestrator/tasks/:id/retry`

Retry failed task.

#### GET `/api/orchestrator/events`

Subscribe to orchestrator events (SSE stream).

**Response (SSE):**
```
event: planCreated
data: {"planId":"plan-1","name":"My Plan"}

event: taskStarted
data: {"taskId":"task-1","planId":"plan-1"}

event: taskCompleted
data: {"taskId":"task-1","status":"success"}
```

---

### Status Endpoint

#### GET `/api/status`

Check connection to VS Code extension.

**Response:**
```json
{
  "connected": true,
  "vscodeVersion": "1.85.0",
  "extensionVersion": "1.0.0"
}
```

---

## Maintenance

### Log Rotation

The systemd journal automatically rotates logs. To configure retention:

```bash
# Edit journal configuration
sudo nano /etc/systemd/journald.conf

# Set retention (e.g., 1 week)
MaxRetentionSec=1week
SystemMaxUse=500M
```

### Backup Configuration

```bash
# Backup configuration files
sudo cp /etc/copilot-gateway/gateway.env /backup/
sudo cp /etc/nginx/sites-available/copilot-gateway.conf /backup/
sudo cp /etc/systemd/system/copilot-gateway.service /backup/
```

### Updating the Gateway

```bash
# Stop service
sudo systemctl stop copilot-gateway

# Backup current version
sudo cp -r /opt/copilot-gateway /opt/copilot-gateway.bak

# Deploy new version (follow installation steps)
# ...

# Start service
sudo systemctl start copilot-gateway

# Verify health
curl https://your-domain.com/health

# If issues, rollback
sudo systemctl stop copilot-gateway
sudo rm -rf /opt/copilot-gateway
sudo mv /opt/copilot-gateway.bak /opt/copilot-gateway
sudo systemctl start copilot-gateway
```

---

## Support

For issues and feature requests, please refer to the project's issue tracker.

### Useful Resources

- [Node.js Documentation](https://nodejs.org/docs/)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [systemd Documentation](https://www.freedesktop.org/software/systemd/man/)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
