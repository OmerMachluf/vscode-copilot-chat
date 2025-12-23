# Nginx Configuration for VS Code Copilot Web Gateway

This directory contains the nginx configuration for deploying the VS Code Copilot Web Gateway in production.

## Architecture Overview

```
                                    ┌─────────────────────────────────────┐
                                    │           Internet                  │
                                    └─────────────────┬───────────────────┘
                                                      │
                                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Nginx (Port 443)                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  SSL/TLS Termination │ Security Headers │ Rate Limiting │ Caching  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                │                                              │
                │ /assets/*                                    │ /api/*
                │ /index.html                                  │ /ws
                │ Static Files                                 │ WebSocket/SSE
                ▼                                              ▼
┌───────────────────────────┐                   ┌───────────────────────────────┐
│   React Frontend (dist)   │                   │  Node.js Backend (Port 3000)  │
│  /var/www/copilot-gateway │                   │        Web Gateway API        │
│     /client/dist          │                   └───────────────┬───────────────┘
└───────────────────────────┘                                   │
                                                                │ Proxy to
                                                                │ localhost:19847
                                                                ▼
                                                ┌───────────────────────────────┐
                                                │   VS Code Extension API       │
                                                │     (localhost:19847)         │
                                                └───────────────────────────────┘
```

## Quick Start

### 1. Install nginx

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nginx

# CentOS/RHEL
sudo yum install nginx
```

### 2. Deploy the Web Gateway

```bash
# Create deployment directory
sudo mkdir -p /var/www/copilot-gateway

# Copy backend files
sudo cp -r src/web-gateway /var/www/copilot-gateway/

# Build and copy frontend
cd src/web-gateway/client
npm install
npm run build
sudo cp -r dist /var/www/copilot-gateway/client/

# Install backend dependencies
cd /var/www/copilot-gateway
npm install --production
```

### 3. Configure nginx

```bash
# Copy configuration
sudo cp deploy/nginx/copilot-gateway.conf /etc/nginx/sites-available/

# Edit configuration (update domain, SSL paths, etc.)
sudo nano /etc/nginx/sites-available/copilot-gateway.conf

# Enable site
sudo ln -s /etc/nginx/sites-available/copilot-gateway.conf /etc/nginx/sites-enabled/

# Remove default site (optional)
sudo rm /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### 4. Set Up SSL with Let's Encrypt

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate (automatic nginx configuration)
sudo certbot --nginx -d your-domain.com

# Or obtain certificate only (manual configuration)
sudo certbot certonly --webroot -w /var/www/certbot -d your-domain.com

# Test automatic renewal
sudo certbot renew --dry-run
```

### 5. Start the Backend Service

```bash
# Create systemd service
sudo tee /etc/systemd/system/copilot-gateway.service << 'EOF'
[Unit]
Description=VS Code Copilot Web Gateway
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/copilot-gateway
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=JWT_SECRET=your-secure-secret-here
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable copilot-gateway
sudo systemctl start copilot-gateway

# Check status
sudo systemctl status copilot-gateway
```

## Configuration Reference

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend server port | `3000` |
| `NODE_ENV` | Environment mode | `development` |
| `JWT_SECRET` | JWT signing secret (required in production) | - |
| `JWT_EXPIRES_IN` | JWT token expiration | `24h` |
| `EXTENSION_API_URL` | VS Code extension API URL | `http://localhost:19847` |
| `CORS_ORIGINS` | Allowed CORS origins (comma-separated) | - |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window in ms | `900000` |
| `RATE_LIMIT_MAX` | Max requests per window | `100` |

### nginx Configuration Sections

#### SSL/TLS Settings

The configuration uses modern TLS settings:
- TLS 1.2 and 1.3 only
- Strong cipher suites
- OCSP stapling
- HSTS enabled

To generate a stronger DH parameter:
```bash
sudo openssl dhparam -out /etc/nginx/dhparam.pem 4096
```

Then uncomment the `ssl_dhparam` line in the configuration.

#### Rate Limiting

| Zone | Rate | Purpose |
|------|------|---------|
| `api_limit` | 10 req/s | General API endpoints |
| `auth_limit` | 5 req/s | Authentication endpoints |
| `conn_limit` | 50 connections | Per-IP connection limit |

Adjust these values based on your expected traffic.

#### SSE/Streaming

SSE endpoints require special handling:
- Buffering disabled (`proxy_buffering off`)
- Long read timeouts (30 minutes)
- `X-Accel-Buffering: no` header
- Chunked transfer encoding enabled

Configured endpoints:
- `/api/sessions/:id/chat` - Chat streaming
- `/api/orchestrator/events` - Orchestrator events

#### WebSocket

WebSocket connections are handled at `/ws`:
- HTTP/1.1 with Upgrade headers
- 10-minute idle timeout
- Buffering disabled

## Security Headers

The configuration adds these security headers:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-XSS-Protection` | `1; mode=block` | XSS filter |
| `X-Frame-Options` | `SAMEORIGIN` | Prevent clickjacking |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Force HTTPS |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Control referrer info |
| `Content-Security-Policy` | See config | Restrict resource loading |
| `Permissions-Policy` | Deny geolocation, microphone, camera, payment | Restrict browser features |

### Customizing CSP

The default CSP may need adjustment for your frontend. Common modifications:

```nginx
# Allow external fonts (e.g., Google Fonts)
font-src 'self' https://fonts.gstatic.com;

# Allow external images
img-src 'self' data: blob: https:;

# Allow analytics
script-src 'self' 'unsafe-inline' https://www.googletagmanager.com;
```

## Caching Strategy

| Path | Cache Duration | Notes |
|------|----------------|-------|
| `/assets/*` | 1 year | Vite-hashed filenames |
| `/favicon.ico`, `/manifest.json` | 1 day | Infrequently changed |
| `/index.html` | No cache | Always serve fresh |
| `/api/*` | No cache | Dynamic content |

## Monitoring

### Log Files

- Access log: `/var/log/nginx/copilot-gateway.access.log`
- Error log: `/var/log/nginx/copilot-gateway.error.log`

### Health Check

Test the health endpoint:
```bash
curl -k https://your-domain.com/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T12:00:00.000Z",
  "environment": "production"
}
```

### Backend Service Logs

```bash
# View service logs
sudo journalctl -u copilot-gateway -f

# View recent logs
sudo journalctl -u copilot-gateway --since "1 hour ago"
```

## Troubleshooting

### 502 Bad Gateway

The backend server is not responding:
```bash
# Check if backend is running
sudo systemctl status copilot-gateway

# Check backend logs
sudo journalctl -u copilot-gateway -n 50

# Test backend directly
curl http://localhost:3000/health
```

### 503 Service Unavailable

The VS Code extension API is not available:
- Ensure VS Code is running with the Copilot extension
- Verify the HTTP API server is enabled in the extension
- Check that port 19847 is accessible from the gateway server

### SSE Not Working

If streaming responses hang:
1. Verify `proxy_buffering off` is set
2. Check for any upstream proxy buffering
3. Ensure the `X-Accel-Buffering: no` header is present
4. Test with `curl -N` to disable client-side buffering

### WebSocket Connection Issues

```bash
# Test WebSocket connectivity
wscat -c wss://your-domain.com/ws

# Check nginx error log
sudo tail -f /var/log/nginx/copilot-gateway.error.log
```

### SSL Certificate Issues

```bash
# Test SSL configuration
openssl s_client -connect your-domain.com:443 -servername your-domain.com

# Check certificate expiration
echo | openssl s_client -connect your-domain.com:443 2>/dev/null | openssl x509 -noout -dates

# Force certificate renewal
sudo certbot renew --force-renewal
```

## Development Mode

For local development without SSL, uncomment the development server block at the bottom of `copilot-gateway.conf`:

```nginx
server {
    listen 80;
    server_name localhost;
    # ... rest of development config
}
```

Then access the gateway at `http://localhost`.

## Performance Tuning

For high-traffic deployments, consider these nginx optimizations:

```nginx
# In nginx.conf (main context)
worker_processes auto;
worker_rlimit_nofile 65535;

events {
    worker_connections 4096;
    multi_accept on;
    use epoll;
}

http {
    # Enable sendfile for static files
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml;
}
```

## Related Documentation

- [nginx Documentation](https://nginx.org/en/docs/)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [Web Gateway API Documentation](../../src/web-gateway/README.md)
