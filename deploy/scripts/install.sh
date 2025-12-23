#!/bin/bash
#
# Copilot Web Gateway - One-Time Installation Script
# This script sets up all system prerequisites and installs dependencies
#
# Usage: sudo ./install.sh [--skip-node] [--skip-nginx] [--skip-certbot]
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
LOG_DIR="/var/log/copilot-gateway"
FRONTEND_DIR="/var/www/copilot-gateway"
SERVICE_USER="copilot-gateway"

# Flags
SKIP_NODE=false
SKIP_NGINX=false
SKIP_CERTBOT=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-node)
            SKIP_NODE=true
            shift
            ;;
        --skip-nginx)
            SKIP_NGINX=true
            shift
            ;;
        --skip-certbot)
            SKIP_CERTBOT=true
            shift
            ;;
        --help|-h)
            echo "Usage: sudo ./install.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --skip-node      Skip Node.js installation"
            echo "  --skip-nginx     Skip nginx installation"
            echo "  --skip-certbot   Skip Certbot installation"
            echo "  --help, -h       Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
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

print_banner() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║       Copilot Web Gateway - Installation Script          ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# Update package lists
update_packages() {
    log_info "Updating package lists..."
    apt-get update -qq
    log_success "Package lists updated"
}

# Install build essentials
install_build_tools() {
    log_info "Installing build tools..."
    apt-get install -y -qq build-essential python3 curl wget ca-certificates gnupg
    log_success "Build tools installed"
}

# Install Node.js
install_nodejs() {
    if [[ "$SKIP_NODE" == true ]]; then
        log_warn "Skipping Node.js installation (--skip-node)"
        return
    fi

    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
        if [[ $NODE_VERSION -ge 18 ]]; then
            log_success "Node.js v$(node -v) already installed"
            return
        fi
    fi

    log_info "Installing Node.js 20.x..."

    # Add NodeSource repository
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

    NODE_MAJOR=20
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list

    apt-get update -qq
    apt-get install -y -qq nodejs

    log_success "Node.js $(node -v) installed"
    log_success "npm $(npm -v) installed"
}

# Install nginx
install_nginx() {
    if [[ "$SKIP_NGINX" == true ]]; then
        log_warn "Skipping nginx installation (--skip-nginx)"
        return
    fi

    if command -v nginx &> /dev/null; then
        log_success "nginx already installed"
    else
        log_info "Installing nginx..."
        apt-get install -y -qq nginx
        log_success "nginx installed"
    fi

    # Enable and start nginx
    systemctl enable nginx
    systemctl start nginx || true
    log_success "nginx service enabled"
}

# Install Certbot
install_certbot() {
    if [[ "$SKIP_CERTBOT" == true ]]; then
        log_warn "Skipping Certbot installation (--skip-certbot)"
        return
    fi

    if command -v certbot &> /dev/null; then
        log_success "Certbot already installed"
    else
        log_info "Installing Certbot..."
        apt-get install -y -qq certbot python3-certbot-nginx
        log_success "Certbot installed"
    fi
}

# Create system user
create_user() {
    if id "$SERVICE_USER" &>/dev/null; then
        log_success "User '$SERVICE_USER' already exists"
    else
        log_info "Creating system user '$SERVICE_USER'..."
        useradd --system --no-create-home --shell /bin/false "$SERVICE_USER"
        log_success "User '$SERVICE_USER' created"
    fi
}

# Create directory structure
create_directories() {
    log_info "Creating directory structure..."

    # Application directory
    mkdir -p "$INSTALL_DIR"
    chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

    # Configuration directory
    mkdir -p "$CONFIG_DIR"
    chmod 750 "$CONFIG_DIR"

    # Log directory
    mkdir -p "$LOG_DIR"
    chown "$SERVICE_USER:$SERVICE_USER" "$LOG_DIR"
    chmod 750 "$LOG_DIR"

    # Frontend static files directory
    mkdir -p "$FRONTEND_DIR"
    chown www-data:www-data "$FRONTEND_DIR"

    log_success "Directories created:"
    log_info "  Application: $INSTALL_DIR"
    log_info "  Config:      $CONFIG_DIR"
    log_info "  Logs:        $LOG_DIR"
    log_info "  Frontend:    $FRONTEND_DIR"
}

# Generate JWT secret
generate_secrets() {
    if [[ -f "$CONFIG_DIR/gateway.env" ]]; then
        log_warn "Configuration file already exists at $CONFIG_DIR/gateway.env"
        log_warn "Skipping secret generation to preserve existing config"
        return
    fi

    log_info "Generating secrets..."

    JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')

    # Create config from template
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    TEMPLATE_FILE="$SCRIPT_DIR/../systemd/gateway.env.example"

    if [[ -f "$TEMPLATE_FILE" ]]; then
        cp "$TEMPLATE_FILE" "$CONFIG_DIR/gateway.env"
        # Replace the empty JWT_SECRET with generated one
        sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" "$CONFIG_DIR/gateway.env"
    else
        # Create minimal config if template not found
        cat > "$CONFIG_DIR/gateway.env" << EOF
# Copilot Web Gateway Configuration
# Generated on $(date)

PORT=3000
NODE_ENV=production
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=24h
EXTENSION_API_URL=http://localhost:19847
CORS_ORIGINS=
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
ENABLE_LOGGING=false
EOF
    fi

    chmod 640 "$CONFIG_DIR/gateway.env"
    chown root:"$SERVICE_USER" "$CONFIG_DIR/gateway.env"

    log_success "Configuration created at $CONFIG_DIR/gateway.env"
    log_warn "Review and update the configuration before deploying!"
}

# Install systemd service
install_systemd_service() {
    log_info "Installing systemd service..."

    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    SERVICE_FILE="$SCRIPT_DIR/../systemd/copilot-gateway.service"

    if [[ -f "$SERVICE_FILE" ]]; then
        cp "$SERVICE_FILE" /etc/systemd/system/copilot-gateway.service
        systemctl daemon-reload
        log_success "systemd service installed"
    else
        log_warn "Service file not found at $SERVICE_FILE"
        log_warn "You'll need to install the systemd service manually"
    fi
}

# Create nginx site configuration (disabled by default)
create_nginx_config() {
    log_info "Creating nginx configuration template..."

    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    NGINX_CONF="$SCRIPT_DIR/../nginx/copilot-gateway.conf"

    if [[ -f "$NGINX_CONF" ]]; then
        cp "$NGINX_CONF" /etc/nginx/sites-available/copilot-gateway
        log_success "nginx configuration copied to /etc/nginx/sites-available/copilot-gateway"
        log_warn "Site is NOT enabled yet - run deploy.sh to enable after configuring domain/SSL"
    else
        log_warn "nginx config not found at $NGINX_CONF"
    fi
}

# Print completion message
print_completion() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           Installation Complete!                         ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Next steps:"
    echo ""
    echo "1. Edit the configuration file:"
    echo "   sudo nano $CONFIG_DIR/gateway.env"
    echo ""
    echo "2. Configure your domain in nginx:"
    echo "   sudo nano /etc/nginx/sites-available/copilot-gateway"
    echo "   - Replace 'your-domain.com' with your actual domain"
    echo ""
    echo "3. Obtain SSL certificate:"
    echo "   sudo certbot certonly --nginx -d your-domain.com"
    echo ""
    echo "4. Run the deployment script to build and deploy:"
    echo "   sudo ./deploy.sh /path/to/source"
    echo ""
}

# Main installation flow
main() {
    check_root
    print_banner

    log_info "Starting installation..."
    echo ""

    update_packages
    install_build_tools
    install_nodejs
    install_nginx
    install_certbot
    create_user
    create_directories
    generate_secrets
    install_systemd_service
    create_nginx_config

    print_completion
}

main "$@"
