# Copilot Web Gateway - Deployment Guide

This guide covers deploying the Copilot Web Gateway for production use. The gateway enables remote access to VS Code Copilot through a web interface.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Deployment Options](#deployment-options)
- [Docker Deployment](#docker-deployment)
- [Native Linux Deployment](#native-linux-deployment)
- [Configuration Reference](#configuration-reference)
- [Security Considerations](#security-considerations)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## Overview

The Web Gateway provides:
- **Web UI**: React-based chat interface accessible from any browser
- **REST API**: HTTP endpoints for chat sessions and orchestration
- **WebSocket**: Real-time event delivery
- **SSE Streaming**: Server-sent events for chat responses
- **Authentication**: JWT-based authentication with rate limiting

### Prerequisites

- Node.js 18+ (for native deployment)
- Docker 20.10+ and Docker Compose 2.0+ (for Docker deployment)
- VS Code with Copilot extension running and HTTP API enabled
- A domain name (for production SSL)

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Internet                                  │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Nginx (SSL Termination)                       │
│  - HTTPS/TLS encryption                                           │
│  - Rate limiting                                                  │
│  - Static file caching                                            │
│  - WebSocket/SSE proxy                                            │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Web Gateway (Node.js)                          │
│  - JWT authentication                                             │
│  - Session management                                             │
│  - API routing                                                    │
│  - Extension proxy                                                │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                  VS Code Extension HTTP API                       │
│  - Chat completion                                                │
│  - Orchestrator control                                           │
│  - Session management                                             │
└──────────────────────────────────────────────────────────────────┘
```

## Deployment Options

| Option | Best For | Complexity |
|--------|----------|------------|
| Docker | Most deployments | Low |
| Docker + Nginx | Production with SSL | Medium |
| Native Linux | Bare-metal servers | Medium |
| Native + systemd | Production bare-metal | High |

## Docker Deployment

The fastest way to deploy the gateway.

### Quick Start

```bash
cd deploy/docker

# Configure environment
cp .env.example .env
nano .env  # Set JWT_SECRET and other options

# Build and run
docker-compose up -d

# Verify
curl http://localhost:3000/health
```

### Production with SSL

```bash
# Set domain in .env
echo "DOMAIN=your-domain.com" >> .env

# Start with nginx profile
docker-compose --profile with-nginx up -d

# Generate SSL certificate
docker-compose run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  -d your-domain.com \
  --email admin@your-domain.com \
  --agree-tos

# Restart to apply certificate
docker-compose restart nginx
```

### Production Hardening

Use production compose overrides:

```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

This adds:
- Read-only filesystem
- No new privileges
- CPU/memory limits
- Restart policies

See [deploy/docker/README.md](docker/README.md) for complete Docker documentation.

## Native Linux Deployment

For bare-metal or VM deployments.

### Installation

```bash
# Run as root
sudo ./deploy/scripts/install.sh
```

This script:
1. Installs Node.js 20.x
2. Installs nginx and certbot
3. Creates `copilot-gateway` system user
4. Creates directory structure
5. Generates JWT secret
6. Installs systemd service

### Configuration

Edit the configuration file:

```bash
sudo nano /etc/copilot-gateway/gateway.env
```

Required settings:
```bash
JWT_SECRET=<your-generated-secret>
EXTENSION_API_URL=http://localhost:3001
```

### Deploy Application

```bash
# From the repository root
sudo ./deploy/scripts/deploy.sh /path/to/vscode-copilot-chat
```

### Configure Domain and SSL

1. Edit nginx configuration:
   ```bash
   sudo nano /etc/nginx/sites-available/copilot-gateway
   # Replace 'your-domain.com' with your actual domain
   ```

2. Obtain SSL certificate:
   ```bash
   sudo certbot --nginx -d your-domain.com
   ```

3. Reload nginx:
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

### Service Management

```bash
# Start
sudo systemctl start copilot-gateway

# Stop
sudo systemctl stop copilot-gateway

# Restart
sudo systemctl restart copilot-gateway

# Status
sudo systemctl status copilot-gateway

# Logs
sudo journalctl -u copilot-gateway -f
```

See [deploy/systemd/README.md](systemd/README.md) for systemd documentation.
See [deploy/nginx/README.md](nginx/README.md) for nginx documentation.

## Configuration Reference

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | **Yes** | - | Secret for JWT token signing. Generate with `openssl rand -base64 64` |
| `PORT` | No | 3000 | Server listening port |
| `NODE_ENV` | No | production | Environment mode |
| `JWT_EXPIRES_IN` | No | 24h | Token expiration (e.g., 1h, 12h, 24h, 7d) |
| `EXTENSION_API_URL` | No | http://localhost:3001 | VS Code extension HTTP API URL |
| `CORS_ORIGINS` | No | (empty) | Allowed CORS origins (comma-separated) |
| `RATE_LIMIT_WINDOW_MS` | No | 900000 | Rate limit window in ms (15 min) |
| `RATE_LIMIT_MAX` | No | 100 | Max requests per window |
| `ENABLE_LOGGING` | No | false | Enable request logging |

### Generating JWT Secret

```bash
# Linux/macOS
openssl rand -base64 64

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
```

### VS Code Extension Configuration

The VS Code extension must have HTTP API enabled. Configure in VS Code settings:

```json
{
  "copilot.httpApi.enabled": true,
  "copilot.httpApi.port": 3001
}
```

## Security Considerations

### Production Checklist

- [ ] Generate strong JWT secret (64+ bytes)
- [ ] Enable HTTPS with valid SSL certificate
- [ ] Configure firewall to only allow ports 80, 443
- [ ] Set appropriate CORS origins
- [ ] Review rate limiting settings
- [ ] Run service as non-root user
- [ ] Enable security headers in nginx
- [ ] Keep Node.js and dependencies updated

### Authentication

The gateway uses JWT tokens for authentication:
- Tokens expire after `JWT_EXPIRES_IN` (default 24h)
- Failed login attempts are rate-limited
- Tokens can be refreshed before expiration

### Network Security

Recommended firewall rules:

```bash
# Allow HTTP (for ACME challenges)
sudo ufw allow 80/tcp

# Allow HTTPS
sudo ufw allow 443/tcp

# Block direct access to backend port
sudo ufw deny 3000/tcp

# Enable firewall
sudo ufw enable
```

### SSL/TLS Best Practices

The provided nginx configuration includes:
- TLS 1.2 and 1.3 only
- Modern cipher suites
- HSTS header
- OCSP stapling

## Monitoring

### Health Check

```bash
curl http://localhost:3000/health
```

Returns:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Logs

**Docker:**
```bash
docker-compose logs -f gateway
```

**systemd:**
```bash
sudo journalctl -u copilot-gateway -f
```

**nginx:**
```bash
tail -f /var/log/nginx/copilot-gateway.access.log
tail -f /var/log/nginx/copilot-gateway.error.log
```

### Prometheus Metrics (Optional)

Add to environment for metrics endpoint:
```bash
ENABLE_METRICS=true
METRICS_PORT=9090
```

## Troubleshooting

### Gateway Won't Start

**Check logs:**
```bash
# Docker
docker-compose logs gateway

# systemd
sudo journalctl -u copilot-gateway -n 50
```

**Common causes:**
- Missing `JWT_SECRET` environment variable
- Port already in use
- Node.js version too old

### Cannot Connect to VS Code Extension

1. Verify extension is running:
   ```bash
   curl http://localhost:3001/health
   ```

2. Check `EXTENSION_API_URL` is correct

3. For Docker, ensure `host.docker.internal` resolves:
   ```bash
   docker run --rm alpine ping -c1 host.docker.internal
   ```

### SSL Certificate Issues

**Verify certificate:**
```bash
openssl s_client -connect your-domain.com:443 -servername your-domain.com
```

**Check certificate files:**
```bash
ls -la /etc/letsencrypt/live/your-domain.com/
```

**Renew certificate:**
```bash
sudo certbot renew --dry-run  # Test
sudo certbot renew            # Actual renewal
```

### WebSocket Connection Fails

Check nginx WebSocket configuration:
- Verify `/ws` location block exists
- Check `proxy_set_header Upgrade` and `Connection` headers
- Verify timeout settings

### SSE Streaming Breaks

Ensure buffering is disabled for SSE endpoints:
- `proxy_buffering off` in nginx
- `X-Accel-Buffering: no` header

### Performance Issues

**Check resource usage:**
```bash
# Docker
docker stats

# Native
htop
```

**Adjust rate limits** if legitimate traffic is being blocked:
```bash
RATE_LIMIT_MAX=200
```

## Updating

### Docker

```bash
cd deploy/docker
git pull
docker-compose build
docker-compose up -d
```

### Native

```bash
cd /path/to/vscode-copilot-chat
git pull
sudo ./deploy/scripts/deploy.sh .
```

## Backup and Recovery

The gateway is stateless - no persistent data to backup.

**What to backup:**
- Environment configuration (`.env` or `/etc/copilot-gateway/gateway.env`)
- SSL certificates (`/etc/letsencrypt/`)
- nginx configuration (`/etc/nginx/sites-available/copilot-gateway`)

**Recovery:**
1. Install fresh using install.sh or Docker
2. Restore configuration files
3. Deploy application

## Support

For issues and questions:
- Check the [troubleshooting](#troubleshooting) section
- Review logs for error messages
- Open an issue on GitHub
