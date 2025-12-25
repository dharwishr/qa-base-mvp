# ============================================
# Stage 1: Build Stage
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Build-time argument for API URL (fallback for local dev)
ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=${VITE_API_URL}

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# ============================================
# Stage 2: Production Stage
# ============================================
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Create entrypoint script for runtime environment injection
RUN echo '#!/bin/sh' > /docker-entrypoint.d/40-inject-env.sh && \
    echo 'set -e' >> /docker-entrypoint.d/40-inject-env.sh && \
    echo 'API_URL="${VITE_API_URL:-http://localhost:8000}"' >> /docker-entrypoint.d/40-inject-env.sh && \
    echo 'echo "Injecting runtime config: API_URL=${API_URL}"' >> /docker-entrypoint.d/40-inject-env.sh && \
    echo 'sed -i "s|__API_URL__|${API_URL}|g" /usr/share/nginx/html/config.js' >> /docker-entrypoint.d/40-inject-env.sh && \
    echo 'echo "Runtime config injected successfully"' >> /docker-entrypoint.d/40-inject-env.sh && \
    chmod +x /docker-entrypoint.d/40-inject-env.sh

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
