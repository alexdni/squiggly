# Multi-stage Dockerfile for Squiggly EEG Analysis
# Combines Next.js frontend, Python worker, and PostgreSQL in a single container

# ============================================
# Stage 1: Build Next.js application
# ============================================
FROM node:20-alpine AS nextjs-builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY . .

# Build Next.js application
ENV NEXT_TELEMETRY_DISABLED=1
# Set auth mode at build time for client-side detection
ENV NEXT_PUBLIC_AUTH_MODE=local
RUN npm run build

# ============================================
# Stage 2: Python dependencies
# ============================================
FROM python:3.11-slim AS python-builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    gfortran \
    libopenblas-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY api/workers/requirements.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir --user -r requirements.txt

# ============================================
# Stage 3: Runtime image
# ============================================
FROM python:3.11-slim

# Install Node.js, PostgreSQL, and supervisor
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    lsb-release \
    supervisor \
    libopenblas0 \
    libgomp1 \
    postgresql \
    postgresql-contrib \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Python dependencies from builder
COPY --from=python-builder /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH

# Copy Next.js build from builder
COPY --from=nextjs-builder /app/.next ./.next
COPY --from=nextjs-builder /app/node_modules ./node_modules
COPY --from=nextjs-builder /app/public ./public
COPY --from=nextjs-builder /app/package.json ./package.json
COPY --from=nextjs-builder /app/next.config.js ./next.config.js

# Copy source files needed at runtime
COPY lib ./lib
COPY app ./app
COPY types ./types
COPY middleware.ts ./middleware.ts
COPY tailwind.config.ts ./tailwind.config.ts
COPY postcss.config.js ./postcss.config.js
COPY tsconfig.json ./tsconfig.json

# Copy Python worker files
COPY api/workers ./api/workers

# Copy scripts and configuration
COPY scripts ./scripts
COPY docker ./docker
# Copy Docker-specific schema (not Supabase schema which has auth.users references)
COPY scripts/schema-docker.sql ./scripts/schema.sql

# Create data directories
RUN mkdir -p /data/storage/recordings /data/storage/visuals /data/storage/exports /data/postgres

# Copy supervisor configuration
COPY docker/supervisor/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Environment variables for Docker mode
ENV DEPLOYMENT_MODE=docker
ENV DATABASE_MODE=postgres
ENV STORAGE_MODE=local
ENV AUTH_MODE=local
ENV NEXT_PUBLIC_AUTH_MODE=local
ENV STORAGE_PATH=/data/storage
ENV DATABASE_URL=postgresql://squiggly:squiggly@localhost:5432/squiggly
ENV WORKER_MODE=http
ENV WORKER_SERVICE_URL=http://localhost:8000
ENV NODE_ENV=production
ENV PORT=3000
ENV PYTHONUNBUFFERED=1

# Expose ports
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Volumes for persistent data
VOLUME ["/data"]

# Entry point
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
