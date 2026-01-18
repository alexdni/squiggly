# Design: Docker Local Deployment

## Context

The Squiggly EEG Analysis platform is currently deployed across three cloud services:
1. **Vercel**: Hosts Next.js 14 frontend with API routes (60s timeout limit)
2. **Railway**: Hosts Python Flask worker for long-running EEG analysis (no timeout limit)
3. **Supabase**: Provides PostgreSQL database, file storage, and Google OAuth authentication

This architecture works well for cloud deployment but creates friction for:
- Local development requiring multiple services running simultaneously
- Self-hosted deployments (universities, clinics, air-gapped environments)
- Users who want to try the application without setting up cloud accounts
- Offline usage scenarios

**Stakeholders**: Developers, self-hosters, research institutions, privacy-conscious users

## Goals / Non-Goals

**Goals**:
- Enable single-command local deployment via `docker run` or `docker-compose up`
- Maintain full feature parity with cloud deployment (EDF upload, analysis, visualization, export)
- Keep all existing Python libraries (MNE, SciPy, scikit-learn, etc.)
- Preserve cloud deployment path without modification
- Support both development and production Docker configurations
- Keep container size reasonable (<3GB compressed)

**Non-Goals**:
- Replacing cloud deployment - Vercel/Railway/Supabase remains the primary deployment target
- Kubernetes/Helm charts - out of scope for initial implementation
- Horizontal scaling - single container serves single-user or small team use cases
- High availability or redundancy - local deployment is for development/small deployments
- OAuth integration in Docker mode - simplified authentication only

## Decisions

### D1: Single Container vs Multi-Container

**Decision**: Single container with supervisor managing multiple processes

**Alternatives considered**:
1. **Multi-container with Docker Compose** - More complex for end users, requires understanding of service dependencies
2. **Single container with single process** - Would require major refactoring to run everything in Node.js or Python

**Rationale**: Single container provides the simplest UX (`docker run -p 3000:3000 squiggly`) while still running all required services (Next.js, Python worker, PostgreSQL). Supervisor (or s6-overlay) manages process lifecycle.

### D2: Database Strategy

**Decision**: Embed PostgreSQL 15 in the container using official postgres base image, with schema auto-initialization

**Alternatives considered**:
1. **SQLite** - Simpler but lacks JSONB support used heavily for results storage
2. **External PostgreSQL** - Adds complexity for local deployment
3. **Supabase local (supabase-local)** - Heavy dependency, overkill for self-contained deployment

**Rationale**: PostgreSQL provides full compatibility with existing schema (JSONB columns, UUID functions, RLS concepts). Embedded PostgreSQL in Docker is well-documented and reliable.

### D3: Storage Strategy

**Decision**: Local filesystem storage in a mounted volume (`/data/storage/`) with abstract storage interface

**Alternatives considered**:
1. **MinIO** - S3-compatible but adds container complexity
2. **Direct filesystem without abstraction** - Would require extensive code changes

**Rationale**: Create a `StorageClient` interface that works with both Supabase Storage (cloud) and local filesystem (Docker). File paths remain consistent.

### D4: Authentication Strategy

**Decision**: Session-based authentication with username/password, configurable via environment variable

**Alternatives considered**:
1. **No authentication** - Security risk even for local deployment
2. **Keycloak/OAuth** - Too complex for single-container deployment
3. **API key only** - Less user-friendly for web interface

**Rationale**: Simple form-based login with bcrypt-hashed passwords stored in PostgreSQL. Users are created via CLI command or environment variable. In Docker mode, `AUTH_MODE=local` switches from Supabase Auth to local auth.

### D5: Worker Communication

**Decision**: In-process HTTP call on localhost within container

**Alternatives considered**:
1. **Direct Python import in Node.js** - Not feasible without major refactoring
2. **Unix socket** - More complex than needed
3. **Message queue** - Overkill for single-container

**Rationale**: The Python Flask worker already exposes HTTP endpoints. Within the container, Next.js calls `http://localhost:8000/analyze` directly. No code changes needed to worker; only environment configuration.

### D6: Container Base Image

**Decision**: Multi-stage build with:
- Stage 1: Node.js 20 alpine for building Next.js
- Stage 2: Python 3.11 slim with Node.js runtime + PostgreSQL 15
- Final: Combined runtime with supervisor

**Alternatives considered**:
1. **Single base image** - Would result in larger image
2. **Distroless** - Lacks debugging tools useful for self-hosters

**Rationale**: Multi-stage keeps image size manageable while including all required runtimes.

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                     Docker Container                                │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Supervisor (s6-overlay)                    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│           │                    │                    │               │
│           ▼                    ▼                    ▼               │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │
│  │   Next.js      │  │ Python Worker  │  │   PostgreSQL   │        │
│  │   (Port 3000)  │  │   (Port 8000)  │  │   (Port 5432)  │        │
│  └────────────────┘  └────────────────┘  └────────────────┘        │
│           │                    │                    │               │
│           └────────────────────┼────────────────────┘               │
│                                ▼                                    │
│                    ┌────────────────┐                               │
│                    │  Local Volume  │                               │
│                    │  /data/storage │                               │
│                    │  /data/postgres│                               │
│                    └────────────────┘                               │
└────────────────────────────────────────────────────────────────────┘
                                 │
                         Port 3000 exposed
                                 ▼
                          ┌──────────┐
                          │  Browser │
                          └──────────┘
```

## Environment Configuration

```bash
# Mode selection
DEPLOYMENT_MODE=docker  # or 'cloud' for Vercel/Railway/Supabase

# Database (Docker mode)
DATABASE_URL=postgresql://squiggly:squiggly@localhost:5432/squiggly

# Storage (Docker mode)
STORAGE_MODE=local
STORAGE_PATH=/data/storage

# Auth (Docker mode)
AUTH_MODE=local
ADMIN_EMAIL=admin@local
ADMIN_PASSWORD=changeme

# Worker (Docker mode)
WORKER_MODE=http
WORKER_SERVICE_URL=http://localhost:8000

# Cloud mode (existing variables remain unchanged)
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
WORKER_SERVICE_URL=https://railway-app.railway.app
```

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Large container size (~2-3GB) due to MNE/NumPy/SciPy | Use multi-stage build, strip dev dependencies, consider slim Python packages |
| PostgreSQL data loss on container recreation | Document volume mounting clearly, provide backup scripts |
| Memory usage with all services in one container | Document minimum requirements (4GB RAM recommended) |
| Different behavior between Docker and cloud modes | Comprehensive integration tests for both modes |
| Simplified auth less secure than OAuth | Document security considerations, recommend for local/dev use only |

## Migration Plan

No migration required - this is an additive feature. Existing cloud deployment continues to work unchanged.

**Rollout**:
1. Implement storage abstraction layer
2. Implement local auth mode
3. Create Dockerfile and docker-compose.yml
4. Create database initialization scripts
5. Update documentation
6. Test both cloud and Docker modes
7. Release Docker image to GitHub Container Registry

**Rollback**: Simply don't use Docker mode; cloud deployment is unaffected.

## Open Questions

1. **Container registry**: Should we publish to Docker Hub, GitHub Container Registry, or both?
   - *Recommendation*: GitHub Container Registry (ghcr.io) for initial release

2. **Default admin credentials**: Should container create default admin on first run or require explicit setup?
   - *Recommendation*: Require `ADMIN_EMAIL` and `ADMIN_PASSWORD` env vars, fail loudly if missing

3. **Data persistence**: Should we include automatic backup scripts in the container?
   - *Recommendation*: Document pg_dump commands, consider adding backup cron job in v1.1

4. **ARM support**: Should Dockerfile support both amd64 and arm64 (Apple Silicon)?
   - *Recommendation*: Yes, use multi-platform build in GitHub Actions
