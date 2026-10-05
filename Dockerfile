# Multi-stage Dockerfile for Squiggly EEG Analysis
# Combines Next.js (UI + server-side analysis engine) and PostgreSQL in a single container.
#
# The analysis engine (@divergentneuro/biofeedback-core) is a private GitHub Packages module.
# Build with a token that has read:packages, passed as a BuildKit secret so it never lands in a layer:
#   NODE_AUTH_TOKEN=ghp_... docker compose build      (compose forwards it, see docker-compose.yml)
#   docker build --secret id=npm_token,env=NODE_AUTH_TOKEN .

# ============================================
# Stage 1: Build Next.js application
# ============================================
FROM node:20-alpine AS nextjs-builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (token only exists for this RUN step)
COPY .npmrc ./
RUN --mount=type=secret,id=npm_token \
    NODE_AUTH_TOKEN="$(cat /run/secrets/npm_token 2>/dev/null)" npm ci \
    || (echo "npm ci failed: is the npm_token build secret (NODE_AUTH_TOKEN) set?" && exit 1)

# Copy source files
COPY . .

# Build Next.js application
ENV NEXT_TELEMETRY_DISABLED=1
# Set auth mode at build time for client-side detection
ENV NEXT_PUBLIC_AUTH_MODE=local
RUN npm run build

# ============================================
# Stage 2: Runtime image
# ============================================
FROM node:20-bookworm-slim

# Install PostgreSQL and supervisor
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    supervisor \
    postgresql \
    postgresql-contrib \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Next.js build from builder
COPY --from=nextjs-builder /app/.next ./.next
COPY --from=nextjs-builder /app/node_modules ./node_modules
COPY --from=nextjs-builder /app/public ./public
COPY --from=nextjs-builder /app/package.json ./package.json
COPY --from=nextjs-builder /app/next.config.js ./next.config.js
COPY --from=nextjs-builder /app/.eeg-worker ./.eeg-worker

# Copy source files needed at runtime
COPY lib ./lib
COPY app ./app
COPY types ./types
COPY middleware.ts ./middleware.ts
COPY tailwind.config.ts ./tailwind.config.ts
COPY postcss.config.js ./postcss.config.js
COPY tsconfig.json ./tsconfig.json

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
ENV NODE_ENV=production
ENV PORT=3000

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
