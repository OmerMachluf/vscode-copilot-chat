# Copilot Web Gateway - Deployment Scripts

Scripts for deploying the Web Gateway to a Linux server.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       INTERNET                               │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    NGINX (Port 443)                          │
│                                                              │
│  ┌─────────────────────────┐  ┌──────────────────────────┐  │
│  │   Static Frontend       │  │    API Proxy             │  │
│  │   /var/www/copilot-     │  │    /api/* → localhost:   │  │
│  │   gateway/              │  │    3000                  │  │
│  │   (React SPA)           │  │                          │  │
│  └─────────────────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ (API requests only)
┌─────────────────────────────────────────────────────────────┐
│              Gateway Backend (Port 3000)                     │
│              /opt/copilot-gateway                            │
│              (Node.js - internal only)                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│           VS Code Extension API (Port 19847)                 │
│           (running on same or different machine)             │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Check Prerequisites

```bash
./check-prerequisites.sh
```

This validates:
- OS and systemd
- Node.js >= 18
- nginx
- Build tools (gcc, make)
- SSL tools (certbot, openssl)
- Available ports
- Disk space and memory

### 2. Install Dependencies (One-Time)

```bash
sudo ./install.sh
```

This installs:
- Node.js 20.x
- nginx
- Certbot for SSL
- Creates system user `copilot-gateway`
- Creates directory structure
- Generates JWT secret
- Installs systemd service

### 3. Configure Your Domain

Edit the nginx configuration:

```bash
sudo nano /etc/nginx/sites-available/copilot-gateway
```

Replace `your-domain.com` with your actual domain.

### 4. Get SSL Certificate

```bash
sudo certbot --nginx -d your-domain.com
```

### 5. Deploy Application

```bash
sudo ./deploy.sh /path/to/vscode-copilot-chat
```

This:
- Builds frontend and backend
- Deploys to /opt/copilot-gateway and /var/www/copilot-gateway
- Enables nginx site
- Starts the service

## Script Reference

### check-prerequisites.sh

Validates all system requirements are met.

```bash
./check-prerequisites.sh
```

### install.sh

One-time system setup.

```bash
sudo ./install.sh [OPTIONS]

Options:
  --skip-node      Skip Node.js installation
  --skip-nginx     Skip nginx installation
  --skip-certbot   Skip Certbot installation
```

### deploy.sh

Build and deploy the application.

```bash
sudo ./deploy.sh <source-path> [OPTIONS]

Arguments:
  <source-path>    Path to vscode-copilot-chat source

Options:
  --no-restart     Don't restart service after deploy
  --skip-build     Skip npm install/build (use existing dist)
```

## File Locations

| Purpose | Path |
|---------|------|
| Backend application | `/opt/copilot-gateway/` |
| Frontend static files | `/var/www/copilot-gateway/` |
| Configuration | `/etc/copilot-gateway/gateway.env` |
| systemd service | `/etc/systemd/system/copilot-gateway.service` |
| nginx config | `/etc/nginx/sites-available/copilot-gateway` |
| Logs | `journalctl -u copilot-gateway` |

## Service Management

```bash
# Check status
sudo systemctl status copilot-gateway

# View logs
sudo journalctl -u copilot-gateway -f

# Restart service
sudo systemctl restart copilot-gateway

# Stop service
sudo systemctl stop copilot-gateway
```

## Troubleshooting

### Service won't start

```bash
# Check logs
sudo journalctl -u copilot-gateway -n 50

# Check config file
cat /etc/copilot-gateway/gateway.env

# Test manually
cd /opt/copilot-gateway
sudo -u copilot-gateway node dist/server.js
```

### nginx errors

```bash
# Test configuration
sudo nginx -t

# Check nginx logs
sudo tail -f /var/log/nginx/copilot-gateway.error.log
```

### Frontend not loading

```bash
# Check files exist
ls -la /var/www/copilot-gateway/

# Check nginx is serving correct path
curl -I http://localhost/
```
