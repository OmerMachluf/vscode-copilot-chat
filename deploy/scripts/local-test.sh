#!/bin/bash
#
# Copilot Web Gateway - Local Testing Script (WSL/Linux)
# Tests the full nginx + backend + frontend stack locally
#
# Usage: ./local-test.sh <windows-source-path>
# Example: ./local-test.sh /mnt/q/src/PowerQuery/vs/vscode-copilot-chat
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
SOURCE_PATH=""

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

print_banner() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║     Copilot Web Gateway - Local Testing (WSL)            ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# Parse arguments
if [[ $# -lt 1 ]]; then
    echo "Usage: ./local-test.sh <source-path>"
    echo ""
    echo "Example:"
    echo "  ./local-test.sh /mnt/q/src/PowerQuery/vs/vscode-copilot-chat"
    echo ""
    echo "From Windows, your path is likely:"
    echo "  /mnt/q/src/PowerQuery/vs/vscode-copilot-chat"
    exit 1
fi

SOURCE_PATH="$1"
GATEWAY_SRC="$SOURCE_PATH/src/web-gateway"

# Validate source
validate_source() {
    if [[ ! -d "$GATEWAY_SRC" ]]; then
        log_error "Source not found: $GATEWAY_SRC"
        exit 1
    fi
    log_success "Source found: $GATEWAY_SRC"
}

# Check/install dependencies
check_dependencies() {
    log_info "Checking dependencies..."

    # Check Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js not installed"
        log_info "Install with: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
        exit 1
    fi
    log_success "Node.js $(node -v)"

    # Check nginx
    if ! command -v nginx &> /dev/null; then
        log_warn "nginx not installed, installing..."
        sudo apt-get update -qq && sudo apt-get install -y nginx
    fi
    log_success "nginx installed"
}

# Build the application
build_app() {
    log_info "Building application..."

    # Build backend
    log_info "Building backend..."
    cd "$GATEWAY_SRC"
    npm install --silent 2>/dev/null || npm install
    npm run build

    # Build frontend
    log_info "Building frontend..."
    cd "$GATEWAY_SRC/client"
    npm install --silent 2>/dev/null || npm install
    npm run build

    log_success "Build complete"
}

# Create test directories
setup_directories() {
    log_info "Setting up test directories..."

    # Create frontend directory
    sudo mkdir -p /var/www/copilot-gateway
    sudo cp -r "$GATEWAY_SRC/client/dist"/* /var/www/copilot-gateway/
    sudo chown -R www-data:www-data /var/www/copilot-gateway

    log_success "Frontend deployed to /var/www/copilot-gateway"
}

# Create test nginx config (HTTP only, no SSL)
setup_nginx() {
    log_info "Configuring nginx for local testing..."

    # Create test config
    sudo tee /etc/nginx/sites-available/copilot-test > /dev/null << EOF
# Copilot Gateway - Local Test Configuration (HTTP only)
server {
    listen $TEST_PORT;
    server_name localhost;

    # Frontend static files
    root /var/www/copilot-gateway;
    index index.html;

    # API proxy to backend
    location /api/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header Connection "";

        # Longer timeout for streaming
        proxy_read_timeout 300s;
    }

    # SSE streaming endpoints - disable buffering
    location ~ ^/api/sessions/[^/]+/chat\$ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1800s;
        chunked_transfer_encoding on;
    }

    # Health check
    location = /health {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
    }

    # SPA fallback
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

    # Enable site
    sudo rm -f /etc/nginx/sites-enabled/copilot-test
    sudo ln -sf /etc/nginx/sites-available/copilot-test /etc/nginx/sites-enabled/

    # Test and reload nginx
    sudo nginx -t
    sudo systemctl restart nginx 2>/dev/null || sudo service nginx restart

    log_success "nginx configured on port $TEST_PORT"
}

# Create environment file for backend
setup_env() {
    log_info "Creating environment configuration..."

    cat > "$GATEWAY_SRC/.env" << EOF
PORT=$BACKEND_PORT
NODE_ENV=development
JWT_SECRET=test-secret-for-local-development-only
JWT_EXPIRES_IN=24h
EXTENSION_API_URL=http://localhost:19847
CORS_ORIGINS=http://localhost:$TEST_PORT
ENABLE_LOGGING=true
EOF

    log_success "Environment configured"
}

# Start backend
start_backend() {
    log_info "Starting backend server..."

    cd "$GATEWAY_SRC"

    # Kill any existing process on port 3000
    sudo fuser -k $BACKEND_PORT/tcp 2>/dev/null || true

    # Start backend in background
    nohup node dist/server.js > /tmp/copilot-gateway.log 2>&1 &
    BACKEND_PID=$!

    # Wait for startup
    sleep 2

    if kill -0 $BACKEND_PID 2>/dev/null; then
        log_success "Backend started (PID: $BACKEND_PID)"
    else
        log_error "Backend failed to start. Check /tmp/copilot-gateway.log"
        cat /tmp/copilot-gateway.log
        exit 1
    fi
}

# Get WSL IP for remote access
get_wsl_ip() {
    WSL_IP=$(hostname -I | awk '{print $1}')
    echo "$WSL_IP"
}

# Print access instructions
print_instructions() {
    WSL_IP=$(get_wsl_ip)

    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              Local Testing Ready!                        ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Access the gateway:"
    echo ""
    echo "  From WSL/Linux:  http://localhost:$TEST_PORT"
    echo "  From Windows:    http://localhost:$TEST_PORT"
    echo "  From Network:    http://$WSL_IP:$TEST_PORT"
    echo ""
    echo "API endpoints:"
    echo "  Health:          http://localhost:$TEST_PORT/health"
    echo "  Auth:            http://localhost:$TEST_PORT/api/auth/login"
    echo ""
    echo "Logs:"
    echo "  Backend:         tail -f /tmp/copilot-gateway.log"
    echo "  nginx:           sudo tail -f /var/log/nginx/error.log"
    echo ""
    echo "To stop:"
    echo "  ./local-test.sh stop"
    echo ""
    echo -e "${YELLOW}Note: The VS Code extension API must be running on port 19847${NC}"
    echo -e "${YELLOW}for full functionality (chat, orchestrator, etc.)${NC}"
    echo ""
}

# Stop services
stop_services() {
    log_info "Stopping services..."

    # Stop backend
    sudo fuser -k $BACKEND_PORT/tcp 2>/dev/null || true

    # Disable nginx site
    sudo rm -f /etc/nginx/sites-enabled/copilot-test
    sudo systemctl reload nginx 2>/dev/null || sudo service nginx reload

    log_success "Services stopped"
    exit 0
}

# Main
main() {
    print_banner

    # Handle stop command
    if [[ "$SOURCE_PATH" == "stop" ]]; then
        stop_services
    fi

    validate_source
    check_dependencies
    build_app
    setup_directories
    setup_nginx
    setup_env
    start_backend
    print_instructions
}

main "$@"
