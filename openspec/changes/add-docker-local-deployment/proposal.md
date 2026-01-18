# Change: Add Docker-based Local Deployment

## Why

The application currently requires three separate cloud services (Vercel for Next.js frontend, Railway for Python worker, Supabase for database/storage/auth) making it difficult for users to run locally for development, testing, or self-hosted production. Consolidating all components into a single Docker container enables anyone to download and run the complete application locally with a single `docker run` command.

## What Changes

- **ADDED**: Multi-stage Dockerfile combining Next.js frontend, Python worker, and PostgreSQL database into a single container
- **ADDED**: Docker Compose configuration for development and production deployments
- **ADDED**: Local file storage backend to replace Supabase Storage
- **ADDED**: Local PostgreSQL database to replace Supabase Database
- **ADDED**: Supervisor or similar process manager to run Next.js and Python worker services concurrently
- **ADDED**: Environment variable configuration for switching between cloud (Supabase) and local modes
- **ADDED**: Database initialization scripts for schema setup and migrations
- **ADDED**: Local authentication mode to replace Supabase Auth (session-based or simplified auth)
- **MODIFIED**: Next.js API routes to support local file storage alongside Supabase Storage
- **MODIFIED**: Python worker to support local file access alongside Supabase Storage download
- **MODIFIED**: Database access layer to support direct PostgreSQL connection alongside Supabase client
- **MODIFIED**: Worker client to use in-process communication when running in Docker container

## Impact

- **Affected specs**: None existing (this adds new `local-deployment` capability)
- **Affected code**:
  - `Dockerfile` (new, root level)
  - `docker-compose.yml` (new, root level)
  - `docker-entrypoint.sh` (new, scripts for container startup)
  - `lib/supabase-server.ts` - Modify to support local DB mode
  - `lib/supabase-client.ts` - Modify to support local DB mode
  - `lib/worker-client.ts` - Modify to support in-process mode
  - `lib/storage-client.ts` (new) - Abstract storage layer
  - `api/workers/analyze_eeg.py` - Modify to support local file access
  - `api/workers/server.py` - Modify for container deployment
  - `.env.example` - Add Docker-specific configuration
- **Breaking changes**: None - existing cloud deployment remains fully functional
- **Migration**: None required - Docker deployment is additive
