# Systemd Deployment for Copilot Web Gateway

This directory contains systemd service files for deploying the VS Code Copilot Web Gateway as a system service.

## Architecture Overview

The deployment consists of a single service:

- **copilot-gateway.service** - Node.js Express server that serves both the API and static React frontend

The React frontend is built into static files and served directly by the Express server in production, eliminating the need for a separate frontend service.

## Prerequisites

- Linux system with systemd
- Node.js 18.x or later
- A dedicated service user (`copilot-gateway`)

## Installation

### 1. Create Service User

```bash
sudo useradd --system --shell /usr/sbin/nologin --home-dir /opt/copilot-gateway copilot-gateway
```

### 2. Install Application

```bash
# Create application directory
sudo mkdir -p /opt/copilot-gateway
sudo chown copilot-gateway:copilot-gateway /opt/copilot-gateway

# Copy built application files
# From the web-gateway directory after running npm run build:
sudo cp -r dist/* /opt/copilot-gateway/
sudo cp -r node_modules /opt/copilot-gateway/
sudo cp package.json /opt/copilot-gateway/

# Build and copy the React client (optional, for static serving)
# From the web-gateway/client directory after running npm run build:
sudo mkdir -p /opt/copilot-gateway/public
sudo cp -r client/dist/* /opt/copilot-gateway/public/

# Set ownership
sudo chown -R copilot-gateway:copilot-gateway /opt/copilot-gateway
```

### 3. Configure Environment

```bash
# Create configuration directory
sudo mkdir -p /etc/copilot-gateway

# Copy and edit environment file
sudo cp gateway.env.example /etc/copilot-gateway/gateway.env
sudo chmod 600 /etc/copilot-gateway/gateway.env
sudo chown copilot-gateway:copilot-gateway /etc/copilot-gateway/gateway.env

# Edit configuration (REQUIRED: set JWT_SECRET)
sudo nano /etc/copilot-gateway/gateway.env
```

**Generate a secure JWT secret:**
```bash
openssl rand -base64 64
```

### 4. Install Service File

```bash
sudo cp copilot-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### 5. Start Service

```bash
# Enable and start
sudo systemctl enable copilot-gateway
sudo systemctl start copilot-gateway

# Check status
sudo systemctl status copilot-gateway
```

## Management Commands

```bash
# Start/stop/restart
sudo systemctl start copilot-gateway
sudo systemctl stop copilot-gateway
sudo systemctl restart copilot-gateway

# Enable/disable auto-start
sudo systemctl enable copilot-gateway
sudo systemctl disable copilot-gateway

# View logs
sudo journalctl -u copilot-gateway -f          # Follow logs
sudo journalctl -u copilot-gateway --since today
sudo journalctl -u copilot-gateway -n 100      # Last 100 lines

# Check service status
sudo systemctl status copilot-gateway
```

## Reverse Proxy Configuration

For production deployments, place the gateway behind a reverse proxy like nginx for TLS termination.

### Nginx Example

```nginx
upstream copilot_gateway {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 443 ssl http2;
    server_name gateway.example.com;

    ssl_certificate /etc/letsencrypt/live/gateway.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gateway.example.com/privkey.pem;

    location / {
        proxy_pass http://copilot_gateway;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

## Security Notes

The systemd service includes several security hardening options:

- **NoNewPrivileges** - Prevents privilege escalation
- **ProtectSystem=strict** - Read-only access to most of the filesystem
- **ProtectHome=true** - No access to home directories
- **PrivateTmp** - Isolated /tmp directory
- **RestrictAddressFamilies** - Only IPv4, IPv6, and Unix sockets allowed

## Troubleshooting

### Service fails to start

1. Check logs: `sudo journalctl -u copilot-gateway -e`
2. Verify environment file exists and is readable
3. Ensure JWT_SECRET is set in production mode
4. Verify Node.js is installed: `node --version`

### Permission denied errors

1. Check file ownership: `ls -la /opt/copilot-gateway`
2. Verify service user exists: `id copilot-gateway`
3. Check environment file permissions: `ls -la /etc/copilot-gateway/`

### Connection issues

1. Verify the service is listening: `ss -tlnp | grep 3000`
2. Check firewall rules: `sudo ufw status` or `sudo firewall-cmd --list-all`
3. Test locally: `curl http://localhost:3000/health`

## File Structure

```
/opt/copilot-gateway/
├── dist/
│   └── server.js        # Compiled server
├── public/              # Built React frontend (optional)
├── node_modules/
└── package.json

/etc/copilot-gateway/
└── gateway.env          # Environment configuration

/etc/systemd/system/
└── copilot-gateway.service
```
