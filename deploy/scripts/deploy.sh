#!/bin/bash
#
# Copilot Web Gateway - Deployment Script
# Builds and deploys the application from source
#
# Usage: sudo ./deploy.sh <source-path> [--no-restart] [--skip-build]
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
INSTALL_DIR="/opt/copilot-gateway"
CONFIG_DIR="/etc/copilot-gateway"
FRONTEND_DIR="/var/www/copilot-gateway"
SERVICE_USER="copilot-gateway"
SERVICE_NAME="copilot-gateway"

# Flags
NO_RESTART=false
SKIP_BUILD=false
SOURCE_PATH=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --no-restart)
            NO_RESTART=true
            shift
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --help|-h)
            echo "Usage: sudo ./deploy.sh <source-path> [OPTIONS]"
            echo ""
            echo "Arguments:"
            echo "  <source-path>    Path to the vscode-copilot-chat source directory"
            echo ""
            echo "Options:"
            echo "  --no-restart     Don't restart the service after deployment"
            echo "  --skip-build     Skip npm install and build (use existing dist)"
            echo "  --help, -h       Show this help message"
            echo ""
            echo "Examples:"
            echo "  sudo ./deploy.sh /home/user/vscode-copilot-chat"
            echo "  sudo ./deploy.sh . --no-restart"
            exit 0
            ;;
        -*)
            echo "Unknown option: $1"
            exit 1
            ;;
        *)
            SOURCE_PATH="$1"
            shift
            ;;
    esac
done

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Validate source path
validate_source() {
    if [[ -z "$SOURCE_PATH" ]]; then
        log_error "Source path is required"
        echo "Usage: sudo ./deploy.sh <source-path>"
        exit 1
    fi

    # Resolve to absolute path
    SOURCE_PATH=$(cd "$SOURCE_PATH" && pwd)

    GATEWAY_SRC="$SOURCE_PATH/src/web-gateway"

    if [[ ! -d "$GATEWAY_SRC" ]]; then
        log_error "Invalid source path: $GATEWAY_SRC not found"
        log_error "Make sure you're pointing to the vscode-copilot-chat root directory"
        exit 1
    fi

    if [[ ! -f "$GATEWAY_SRC/package.json" ]]; then
        log_error "Invalid source: $GATEWAY_SRC/package.json not found"
        exit 1
    fi

    log_success "Source validated: $GATEWAY_SRC"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check directories exist
    if [[ ! -d "$INSTALL_DIR" ]]; then
        log_error "Installation directory not found: $INSTALL_DIR"
        log_error "Run install.sh first"
        exit 1
    fi

    if [[ ! -d "$FRONTEND_DIR" ]]; then
        log_error "Frontend directory not found: $FRONTEND_DIR"
        log_error "Run install.sh first"
        exit 1
    fi

    # Check config exists
    if [[ ! -f "$CONFIG_DIR/gateway.env" ]]; then
        log_error "Configuration not found: $CONFIG_DIR/gateway.env"
        log_error "Run install.sh first"
        exit 1
    fi

    # Check node
    if ! command -v node &> /dev/null; then
        log_error "Node.js not found"
        exit 1
    fi

    log_success "Prerequisites check passed"
}

print_banner() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║        Copilot Web Gateway - Deployment Script           ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# Build backend
build_backend() {
    if [[ "$SKIP_BUILD" == true ]]; then
        log_warn "Skipping backend build (--skip-build)"
        return
    fi

    log_info "Building backend..."
    cd "$GATEWAY_SRC"

    # Install dependencies
    log_info "Installing backend dependencies..."
    npm ci --production=false --silent

    # Build TypeScript
    log_info "Compiling TypeScript..."
    npm run build

    log_success "Backend built successfully"
}

# Build frontend
build_frontend() {
    if [[ "$SKIP_BUILD" == true ]]; then
        log_warn "Skipping frontend build (--skip-build)"
        return
    fi

    log_info "Building frontend..."
    cd "$GATEWAY_SRC/client"

    # Install dependencies
    log_info "Installing frontend dependencies..."
    npm ci --production=false --silent

    # Build for production
    log_info "Building React app..."
    npm run build

    log_success "Frontend built successfully"
}

# Deploy backend
deploy_backend() {
    log_info "Deploying backend to $INSTALL_DIR..."

    # Stop service if running
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        log_info "Stopping service..."
        systemctl stop "$SERVICE_NAME"
    fi

    # Clean old deployment (keep node_modules for faster deploys)
    rm -rf "$INSTALL_DIR/dist"

    # Copy built files
    cp -r "$GATEWAY_SRC/dist" "$INSTALL_DIR/"
    cp "$GATEWAY_SRC/package.json" "$INSTALL_DIR/"
    cp "$GATEWAY_SRC/package-lock.json" "$INSTALL_DIR/"

    # Install production dependencies
    log_info "Installing production dependencies..."
    cd "$INSTALL_DIR"
    npm ci --production --silent

    # Set ownership
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

    log_success "Backend deployed to $INSTALL_DIR"
}

# Deploy frontend
deploy_frontend() {
    log_info "Deploying frontend to $FRONTEND_DIR..."

    # Clean old frontend
    rm -rf "$FRONTEND_DIR"/*

    # Copy built frontend
    cp -r "$GATEWAY_SRC/client/dist"/* "$FRONTEND_DIR/"

    # Set ownership for nginx
    chown -R www-data:www-data "$FRONTEND_DIR"

    log_success "Frontend deployed to $FRONTEND_DIR"
}

# Enable and configure nginx
configure_nginx() {
    log_info "Configuring nginx..."

    NGINX_AVAILABLE="/etc/nginx/sites-available/copilot-gateway"
    NGINX_ENABLED="/etc/nginx/sites-enabled/copilot-gateway"

    if [[ ! -f "$NGINX_AVAILABLE" ]]; then
        log_warn "nginx configuration not found at $NGINX_AVAILABLE"
        log_warn "Skipping nginx configuration"
        return
    fi

    # Check if already enabled
    if [[ -L "$NGINX_ENABLED" ]]; then
        log_success "nginx site already enabled"
    else
        # Enable site
        ln -sf "$NGINX_AVAILABLE" "$NGINX_ENABLED"
        log_success "nginx site enabled"
    fi

    # Test configuration
    if nginx -t 2>/dev/null; then
        log_success "nginx configuration valid"
        systemctl reload nginx
        log_success "nginx reloaded"
    else
        log_error "nginx configuration test failed!"
        log_error "Please fix the configuration and reload manually:"
        log_error "  sudo nano $NGINX_AVAILABLE"
        log_error "  sudo nginx -t"
        log_error "  sudo systemctl reload nginx"
    fi
}

# Start/restart service
restart_service() {
    if [[ "$NO_RESTART" == true ]]; then
        log_warn "Skipping service restart (--no-restart)"
        return
    fi

    log_info "Starting service..."

    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    systemctl start "$SERVICE_NAME"

    # Wait a moment for service to start
    sleep 2

    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log_success "Service started successfully"
    else
        log_error "Service failed to start!"
        log_error "Check logs with: journalctl -u $SERVICE_NAME -f"
        exit 1
    fi
}

# Verify deployment
verify_deployment() {
    log_info "Verifying deployment..."

    # Check backend health
    sleep 1
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null | grep -q "200"; then
        log_success "Backend health check passed"
    else
        log_warn "Backend health check failed (service may still be starting)"
    fi

    # Check frontend files
    if [[ -f "$FRONTEND_DIR/index.html" ]]; then
        log_success "Frontend files deployed"
    else
        log_warn "Frontend index.html not found"
    fi
}

# Print completion message
print_completion() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              Deployment Complete!                        ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Deployed components:"
    echo "  Backend:  $INSTALL_DIR"
    echo "  Frontend: $FRONTEND_DIR"
    echo "  Config:   $CONFIG_DIR/gateway.env"
    echo ""
    echo "Service management:"
    echo "  sudo systemctl status $SERVICE_NAME"
    echo "  sudo systemctl restart $SERVICE_NAME"
    echo "  sudo journalctl -u $SERVICE_NAME -f"
    echo ""

    # Check if SSL is configured
    if [[ -f /etc/letsencrypt/live/*/fullchain.pem ]]; then
        DOMAIN=$(ls /etc/letsencrypt/live/ | head -1)
        echo "Access your gateway at:"
        echo "  https://$DOMAIN"
    else
        echo -e "${YELLOW}SSL not configured yet!${NC}"
        echo "To set up SSL:"
        echo "  1. Edit nginx config: sudo nano /etc/nginx/sites-available/copilot-gateway"
        echo "  2. Set your domain name"
        echo "  3. Run: sudo certbot --nginx -d your-domain.com"
    fi
    echo ""
}

# Main deployment flow
main() {
    check_root
    print_banner
    validate_source
    check_prerequisites

    log_info "Starting deployment..."
    echo ""

    build_backend
    build_frontend
    deploy_backend
    deploy_frontend
    configure_nginx
    restart_service
    verify_deployment

    print_completion
}

main "$@"
