#!/bin/bash
#
# Copilot Web Gateway - Prerequisites Checker
# Run this script to validate all requirements are met before installation
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
ERRORS=0
WARNINGS=0

print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  Copilot Web Gateway Prerequisites${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

check_pass() {
    echo -e "  ${GREEN}✓${NC} $1"
}

check_fail() {
    echo -e "  ${RED}✗${NC} $1"
    ((ERRORS++))
}

check_warn() {
    echo -e "  ${YELLOW}!${NC} $1"
    ((WARNINGS++))
}

check_info() {
    echo -e "  ${BLUE}i${NC} $1"
}

# Check if running as root
check_root() {
    echo -e "${BLUE}Checking user permissions...${NC}"
    if [[ $EUID -eq 0 ]]; then
        check_warn "Running as root - consider using a non-root user with sudo"
    else
        if sudo -n true 2>/dev/null; then
            check_pass "User has sudo privileges"
        else
            check_fail "User does not have sudo privileges (required for installation)"
        fi
    fi
}

# Check OS
check_os() {
    echo -e "\n${BLUE}Checking operating system...${NC}"

    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        check_pass "OS: $PRETTY_NAME"

        # Check for systemd
        if command -v systemctl &> /dev/null; then
            check_pass "systemd is available"
        else
            check_fail "systemd not found - required for service management"
        fi
    else
        check_warn "Could not detect OS version"
    fi
}

# Check Node.js
check_nodejs() {
    echo -e "\n${BLUE}Checking Node.js...${NC}"

    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | sed 's/v//')
        NODE_MAJOR=$(echo $NODE_VERSION | cut -d. -f1)

        if [[ $NODE_MAJOR -ge 18 ]]; then
            check_pass "Node.js v$NODE_VERSION (>= 18 required)"
        else
            check_fail "Node.js v$NODE_VERSION is too old (>= 18 required)"
        fi
    else
        check_fail "Node.js not installed"
        check_info "Install with: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
    fi

    if command -v npm &> /dev/null; then
        NPM_VERSION=$(npm -v)
        check_pass "npm v$NPM_VERSION"
    else
        check_fail "npm not installed"
    fi
}

# Check nginx
check_nginx() {
    echo -e "\n${BLUE}Checking nginx...${NC}"

    if command -v nginx &> /dev/null; then
        NGINX_VERSION=$(nginx -v 2>&1 | sed 's/.*nginx\///')
        check_pass "nginx $NGINX_VERSION"

        # Check if nginx is running
        if systemctl is-active --quiet nginx 2>/dev/null; then
            check_pass "nginx service is running"
        else
            check_warn "nginx service is not running"
        fi
    else
        check_fail "nginx not installed"
        check_info "Install with: sudo apt-get install -y nginx"
    fi
}

# Check build tools
check_build_tools() {
    echo -e "\n${BLUE}Checking build tools...${NC}"

    if command -v gcc &> /dev/null; then
        GCC_VERSION=$(gcc --version | head -n1)
        check_pass "GCC: $GCC_VERSION"
    else
        check_fail "GCC not installed (required for native npm modules)"
        check_info "Install with: sudo apt-get install -y build-essential"
    fi

    if command -v make &> /dev/null; then
        check_pass "make is available"
    else
        check_fail "make not installed"
    fi

    if command -v python3 &> /dev/null; then
        PYTHON_VERSION=$(python3 --version)
        check_pass "$PYTHON_VERSION"
    else
        check_warn "Python 3 not found (may be needed for some npm modules)"
    fi
}

# Check SSL/Certbot
check_ssl() {
    echo -e "\n${BLUE}Checking SSL tools...${NC}"

    if command -v certbot &> /dev/null; then
        CERTBOT_VERSION=$(certbot --version 2>&1)
        check_pass "$CERTBOT_VERSION"
    else
        check_warn "Certbot not installed (needed for Let's Encrypt SSL)"
        check_info "Install with: sudo apt-get install -y certbot python3-certbot-nginx"
    fi

    if command -v openssl &> /dev/null; then
        check_pass "OpenSSL is available"
    else
        check_fail "OpenSSL not installed"
    fi
}

# Check ports
check_ports() {
    echo -e "\n${BLUE}Checking port availability...${NC}"

    # Check port 80
    if ss -tuln | grep -q ':80 '; then
        PROC=$(ss -tulnp | grep ':80 ' | awk '{print $7}' | head -1)
        if [[ $PROC == *"nginx"* ]]; then
            check_pass "Port 80 in use by nginx (expected)"
        else
            check_warn "Port 80 in use by: $PROC"
        fi
    else
        check_pass "Port 80 is available"
    fi

    # Check port 443
    if ss -tuln | grep -q ':443 '; then
        PROC=$(ss -tulnp | grep ':443 ' | awk '{print $7}' | head -1)
        if [[ $PROC == *"nginx"* ]]; then
            check_pass "Port 443 in use by nginx (expected)"
        else
            check_warn "Port 443 in use by: $PROC"
        fi
    else
        check_pass "Port 443 is available"
    fi

    # Check port 3000 (gateway)
    if ss -tuln | grep -q ':3000 '; then
        check_warn "Port 3000 is already in use (gateway default port)"
    else
        check_pass "Port 3000 is available"
    fi
}

# Check disk space
check_disk() {
    echo -e "\n${BLUE}Checking disk space...${NC}"

    AVAILABLE=$(df -BM /opt 2>/dev/null | tail -1 | awk '{print $4}' | sed 's/M//')
    if [[ -z "$AVAILABLE" ]]; then
        AVAILABLE=$(df -BM / | tail -1 | awk '{print $4}' | sed 's/M//')
    fi

    if [[ $AVAILABLE -ge 500 ]]; then
        check_pass "Available disk space: ${AVAILABLE}MB (>= 500MB required)"
    elif [[ $AVAILABLE -ge 100 ]]; then
        check_warn "Available disk space: ${AVAILABLE}MB (500MB recommended)"
    else
        check_fail "Available disk space: ${AVAILABLE}MB (at least 100MB required)"
    fi
}

# Check memory
check_memory() {
    echo -e "\n${BLUE}Checking memory...${NC}"

    TOTAL_MEM=$(free -m | awk '/^Mem:/{print $2}')
    AVAIL_MEM=$(free -m | awk '/^Mem:/{print $7}')

    if [[ $TOTAL_MEM -ge 1024 ]]; then
        check_pass "Total memory: ${TOTAL_MEM}MB (>= 1GB recommended)"
    elif [[ $TOTAL_MEM -ge 512 ]]; then
        check_warn "Total memory: ${TOTAL_MEM}MB (1GB recommended)"
    else
        check_fail "Total memory: ${TOTAL_MEM}MB (at least 512MB required)"
    fi

    check_info "Available memory: ${AVAIL_MEM}MB"
}

# Check git
check_git() {
    echo -e "\n${BLUE}Checking git...${NC}"

    if command -v git &> /dev/null; then
        GIT_VERSION=$(git --version)
        check_pass "$GIT_VERSION"
    else
        check_warn "git not installed (optional, for cloning source)"
    fi
}

# Print summary
print_summary() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  Summary${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    if [[ $ERRORS -eq 0 && $WARNINGS -eq 0 ]]; then
        echo -e "${GREEN}All prerequisites met! Ready to install.${NC}"
        echo ""
        echo "Run the installation script:"
        echo "  sudo ./install.sh"
        exit 0
    elif [[ $ERRORS -eq 0 ]]; then
        echo -e "${YELLOW}Prerequisites met with $WARNINGS warning(s).${NC}"
        echo "You may proceed with installation, but review warnings above."
        echo ""
        echo "Run the installation script:"
        echo "  sudo ./install.sh"
        exit 0
    else
        echo -e "${RED}$ERRORS error(s) and $WARNINGS warning(s) found.${NC}"
        echo "Please resolve the errors above before installing."
        exit 1
    fi
}

# Main
print_header
check_root
check_os
check_nodejs
check_nginx
check_build_tools
check_ssl
check_ports
check_disk
check_memory
check_git
print_summary
