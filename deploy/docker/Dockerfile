# =============================================================================
# VS Code Copilot Web Gateway - Multi-stage Docker Build
# =============================================================================
#
# This Dockerfile creates a production-ready image for the web gateway.
# It uses multi-stage builds to minimize final image size.
#
# Build:
#   docker build -t copilot-gateway:latest -f deploy/docker/Dockerfile .
#
# Run:
#   docker run -p 3000:3000 --env-file .env copilot-gateway:latest
#
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build Backend
# -----------------------------------------------------------------------------
FROM node:20-alpine AS backend-builder

WORKDIR /build

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files for backend
COPY src/web-gateway/package*.json ./

# Install all dependencies (including dev dependencies for TypeScript)
RUN npm ci

# Copy backend source
COPY src/web-gateway/tsconfig.json ./
COPY src/web-gateway/src ./src

# Build TypeScript
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# -----------------------------------------------------------------------------
# Stage 2: Build Frontend
# -----------------------------------------------------------------------------
FROM node:20-alpine AS frontend-builder

WORKDIR /build

# Copy package files for frontend
COPY src/web-gateway/client/package*.json ./

# Install all dependencies
RUN npm ci

# Copy frontend source
COPY src/web-gateway/client/tsconfig*.json ./
COPY src/web-gateway/client/vite.config.ts ./
COPY src/web-gateway/client/postcss.config.js ./
COPY src/web-gateway/client/tailwind.config.js ./
COPY src/web-gateway/client/index.html ./
COPY src/web-gateway/client/src ./src

# Build frontend for production
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 3: Production Runtime
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runtime

# Add labels for container metadata
LABEL org.opencontainers.image.title="Copilot Web Gateway"
LABEL org.opencontainers.image.description="Web gateway for VS Code Copilot remote access"
LABEL org.opencontainers.image.vendor="Microsoft"
LABEL org.opencontainers.image.source="https://github.com/microsoft/vscode-copilot"

# Create non-root user for security
RUN addgroup -g 1001 -S gateway && \
    adduser -u 1001 -S gateway -G gateway

# Install runtime dependencies
RUN apk add --no-cache curl tini

WORKDIR /app

# Copy backend build artifacts
COPY --from=backend-builder /build/dist ./dist
COPY --from=backend-builder /build/node_modules ./node_modules
COPY --from=backend-builder /build/package.json ./

# Copy frontend build artifacts
COPY --from=frontend-builder /build/dist ./public

# Create directory for logs
RUN mkdir -p /app/logs && chown gateway:gateway /app/logs

# Switch to non-root user
USER gateway

# Expose the gateway port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the server
CMD ["node", "dist/server.js"]
