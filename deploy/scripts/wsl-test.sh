#!/bin/bash
#
# Copilot Web Gateway - WSL Local Test Script
# Run this from WSL to test the full stack locally
#
# Usage: bash wsl-test.sh
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
TEST_PORT=8080
BACKEND_PORT=3000

# Auto-detect source path (script location)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_PATH="$(dirname "$(dirname "$SCRIPT_DIR")")"
GATEWAY_SRC="$SOURCE_PATH/src/web-gateway"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

print_banner() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║     Copilot Web Gateway - WSL Local Test                 ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

stop_services() {
    log_info "Stopping any existing services..."

    # Kill backend on port 3000
    if command -v fuser &> /dev/null; then
        sudo fuser -k $BACKEND_PORT/tcp 2>/dev/null || true
    else
        pkill -f "node.*server.js" 2>/dev/null || true
    fi

    # Remove nginx site
    sudo rm -f /etc/nginx/sites-enabled/copilot-test 2>/dev/null || true
    sudo systemctl reload nginx 2>/dev/null || sudo service nginx reload 2>/dev/null || true

    log_success "Services stopped"
}

# Handle stop command
if [[ "${1:-}" == "stop" ]]; then
    print_banner
    stop_services
    exit 0
fi

print_banner

# Validate source
log_info "Source path: $SOURCE_PATH"
if [[ ! -d "$GATEWAY_SRC" ]]; then
    log_error "Gateway source not found: $GATEWAY_SRC"
    exit 1
fi
log_success "Source validated"

# Check Node.js
log_info "Checking Node.js..."
if ! command -v node &> /dev/null; then
    log_error "Node.js not installed!"
    log_info "Install with:"
    echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    echo "  sudo apt-get install -y nodejs"
    exit 1
fi
log_success "Node.js $(node -v)"

# Install nginx if needed
log_info "Checking nginx..."
if ! command -v nginx &> /dev/null; then
    log_warn "nginx not installed, installing..."
    sudo apt-get update -qq
    sudo apt-get install -y nginx
fi
log_success "nginx installed"

# Stop any existing services
stop_services

# Build backend
log_info "Building backend..."
cd "$GATEWAY_SRC"
npm install
npm run build
log_success "Backend built"

# Build frontend
log_info "Building frontend..."
cd "$GATEWAY_SRC/client"
npm install
npm run build
log_success "Frontend built"

# Deploy frontend to nginx directory
log_info "Deploying frontend..."
sudo mkdir -p /var/www/copilot-gateway
sudo rm -rf /var/www/copilot-gateway/*
sudo cp -r "$GATEWAY_SRC/client/dist"/* /var/www/copilot-gateway/
sudo chown -R www-data:www-data /var/www/copilot-gateway
log_success "Frontend deployed to /var/www/copilot-gateway"

# Create nginx config
log_info "Configuring nginx..."
sudo tee /etc/nginx/sites-available/copilot-test > /dev/null << 'NGINX_EOF'
server {
    listen 8080;
    server_name localhost;

    # Frontend static files
    root /var/www/copilot-gateway;
    index index.html;

    # Logging
    access_log /var/log/nginx/copilot-test.access.log;
    error_log /var/log/nginx/copilot-test.error.log;

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    # Health check
    location = /health {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # SPA fallback - serve index.html for all non-file routes
    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX_EOF

# Enable site
sudo ln -sf /etc/nginx/sites-available/copilot-test /etc/nginx/sites-enabled/

# Test and start nginx
if sudo nginx -t; then
    sudo systemctl restart nginx 2>/dev/null || sudo service nginx restart
    log_success "nginx configured on port $TEST_PORT"
else
    log_error "nginx configuration failed!"
    exit 1
fi

# Create backend .env
log_info "Creating backend configuration..."

# Get Windows host IP for WSL2 (where VS Code runs)
WINDOWS_HOST=$(ip route | grep default | awk '{print $3}')
log_info "Detected Windows host IP: $WINDOWS_HOST"

cat > "$GATEWAY_SRC/.env" << ENV_EOF
PORT=$BACKEND_PORT
NODE_ENV=development
JWT_SECRET=test-secret-for-local-development-only-$(date +%s)
JWT_EXPIRES_IN=24h
EXTENSION_API_URL=http://$WINDOWS_HOST:19847
CORS_ORIGINS=http://localhost:$TEST_PORT
ENABLE_LOGGING=true
ENV_EOF
log_success "Backend .env created (Extension API: http://$WINDOWS_HOST:19847)"

# Get IP addresses
WSL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown")

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    Setup Complete!                       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Starting backend server..."
echo ""
echo "Access URLs:"
echo "  Local:      http://localhost:$TEST_PORT"
echo "  WSL IP:     http://$WSL_IP:$TEST_PORT"
echo ""
echo "Test endpoints:"
echo "  Frontend:   http://localhost:$TEST_PORT"
echo "  Health:     http://localhost:$TEST_PORT/health"
echo "  API:        http://localhost:$TEST_PORT/api/auth/login"
echo ""
echo "Logs (in another terminal):"
echo "  nginx:      sudo tail -f /var/log/nginx/copilot-test.error.log"
echo ""
echo "To stop:"
echo "  Press Ctrl+C, then run: bash wsl-test.sh stop"
echo ""
echo -e "${YELLOW}NOTE: For full functionality, the VS Code extension API${NC}"
echo -e "${YELLOW}must be running on port 19847${NC}"
echo ""
echo "─────────────────────────────────────────────────────────────"
echo ""

# Start backend (foreground so you can see logs)
cd "$GATEWAY_SRC"
node dist/server.js
