# Copilot Web Gateway - Docker Deployment

This directory contains Docker configuration for deploying the Copilot Web Gateway.

## Quick Start

### Prerequisites

- Docker 20.10+
- Docker Compose 2.0+

### 1. Configure Environment

```bash
cd deploy/docker
cp .env.example .env
```

Edit `.env` and set the required values:

```bash
# Generate a JWT secret
openssl rand -base64 64

# Add it to .env
JWT_SECRET=<generated-secret>
```

### 2. Build and Run

```bash
# Build the image
docker-compose build

# Start the gateway
docker-compose up -d

# Check logs
docker-compose logs -f gateway
```

The gateway will be available at `http://localhost:3000`.

## Deployment Options

### Basic (Gateway Only)

```bash
docker-compose up -d gateway
```

This runs just the gateway container, suitable for:
- Development and testing
- Behind an existing reverse proxy
- Internal network access

### With Nginx (SSL Termination)

```bash
# First, set up SSL certificates (see SSL Setup below)
docker-compose --profile with-nginx up -d
```

This adds nginx for:
- SSL/TLS termination
- Rate limiting
- Static file caching
- WebSocket and SSE support

### Production

```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Production configuration adds:
- Security hardening (read-only filesystem, no-new-privileges)
- Resource limits (CPU, memory)
- Optimized restart policies

## SSL Setup

### Option 1: Let's Encrypt (Recommended)

1. Set your domain in `.env`:
   ```bash
   DOMAIN=your-domain.com
   CERTBOT_EMAIL=admin@your-domain.com
   ```

2. Start nginx without SSL:
   ```bash
   docker-compose --profile with-nginx up -d
   ```

3. Generate certificate:
   ```bash
   docker-compose run --rm certbot certonly \
     --webroot \
     --webroot-path=/var/www/certbot \
     -d your-domain.com \
     --email admin@your-domain.com \
     --agree-tos
   ```

4. Restart nginx to use the certificate:
   ```bash
   docker-compose restart nginx
   ```

### Option 2: Self-Signed Certificate

For testing only:

```bash
mkdir -p nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/privkey.pem \
  -out nginx/ssl/fullchain.pem \
  -subj "/CN=localhost"
```

## Configuration Reference

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | - | Secret for signing JWT tokens |
| `GATEWAY_PORT` | No | 3000 | Port to expose on host |
| `NODE_ENV` | No | production | Node environment |
| `JWT_EXPIRES_IN` | No | 24h | Token expiration time |
| `EXTENSION_API_URL` | No | http://host.docker.internal:3001 | VS Code extension API URL |
| `CORS_ORIGINS` | No | (empty) | Allowed CORS origins |
| `RATE_LIMIT_WINDOW_MS` | No | 900000 | Rate limit window (ms) |
| `RATE_LIMIT_MAX` | No | 100 | Max requests per window |
| `ENABLE_LOGGING` | No | false | Enable request logging |

### Connecting to VS Code

The gateway needs to connect to the VS Code extension's HTTP API. By default, it uses `host.docker.internal:3001` to access services on the Docker host.

For remote VS Code instances, update `EXTENSION_API_URL` in your `.env`:

```bash
EXTENSION_API_URL=http://192.168.1.100:3001
```

## Development

### Hot Reloading

Use the development compose file for hot reloading:

```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

This mounts source code as volumes for live updates.

### Debugging

The dev configuration exposes the Node.js debugger on port 9229:

```bash
# In VS Code, attach to localhost:9229
```

## Maintenance

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f gateway
```

### Update

```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose build
docker-compose up -d
```

### Backup

The gateway is stateless - no persistent data to backup. Configuration is in `.env`.

### Stop

```bash
# Stop all services
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

## Troubleshooting

### Container won't start

Check logs:
```bash
docker-compose logs gateway
```

Common issues:
- Missing `JWT_SECRET` in `.env`
- Port 3000 already in use (change `GATEWAY_PORT`)

### Cannot connect to VS Code extension

1. Ensure VS Code extension is running with HTTP API enabled
2. Check `EXTENSION_API_URL` in `.env`
3. If using Docker Desktop, `host.docker.internal` should work
4. On Linux, you may need to use `--add-host=host.docker.internal:host-gateway`

### Health check failing

```bash
# Test health endpoint
curl http://localhost:3000/health

# Check container status
docker-compose ps
```

### SSL certificate issues

```bash
# Test certificate
openssl s_client -connect localhost:443 -servername your-domain.com

# Check nginx logs
docker-compose logs nginx
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│    Nginx    │────▶│   Gateway   │
│  (Browser)  │     │  (Optional) │     │  (Node.js)  │
└─────────────┘     └─────────────┘     └─────────────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │  VS Code    │
                                        │  Extension  │
                                        └─────────────┘
```

## Files

```
deploy/docker/
├── Dockerfile              # Production multi-stage build
├── Dockerfile.dev          # Development build with hot reload
├── docker-compose.yml      # Base compose configuration
├── docker-compose.dev.yml  # Development overrides
├── docker-compose.prod.yml # Production overrides
├── .env.example            # Environment template
├── nginx/
│   └── copilot-gateway-docker.conf  # Nginx config for Docker
└── README.md               # This file
```
