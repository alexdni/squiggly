# Tasks: Add Docker Local Deployment

## 1. Storage Abstraction Layer

- [x] 1.1 Create `lib/storage/types.ts` - Define `StorageClient` interface with methods: `upload`, `download`, `delete`, `getSignedUrl`, `list`
- [x] 1.2 Create `lib/storage/supabase-storage.ts` - Implement `StorageClient` wrapping existing Supabase Storage calls
- [x] 1.3 Create `lib/storage/local-storage.ts` - Implement `StorageClient` using local filesystem
- [x] 1.4 Create `lib/storage/index.ts` - Factory function that returns appropriate client based on `STORAGE_MODE` env var
- [x] 1.5 Update `api/workers/analyze_eeg.py` - Add `download_local_file()` function alongside `download_from_supabase()`
- [x] 1.6 Update `api/workers/analyze_eeg.py` - Add `upload_local_file()` function alongside `upload_results_to_supabase()`
- [x] 1.7 Update API routes to use storage abstraction: `app/api/upload/init/route.ts`
- [x] 1.8 Update API routes to use storage abstraction: `app/api/recordings/[id]/route.ts`
- [ ] 1.9 Write unit tests for local storage client

## 2. Database Abstraction Layer

- [x] 2.1 Create `lib/db/types.ts` - Define database client interface
- [x] 2.2 Create `lib/db/supabase-db.ts` - Wrap existing Supabase client for database operations
- [x] 2.3 Create `lib/db/postgres-db.ts` - Direct PostgreSQL client using `pg` package
- [x] 2.4 Create `lib/db/index.ts` - Factory function based on `DATABASE_MODE` env var
- [ ] 2.5 Update `lib/supabase-server.ts` to use database abstraction
- [ ] 2.6 Update `lib/supabase-client.ts` to use database abstraction
- [x] 2.7 Create `scripts/init-db.sql` - Combined schema initialization script (using existing schema.sql)
- [ ] 2.8 Create `scripts/migrate.js` - Simple migration runner for schema updates
- [ ] 2.9 Write integration tests for direct PostgreSQL client

## 3. Local Authentication

- [x] 3.1 Create `lib/auth/types.ts` - Define auth client interface
- [x] 3.2 Create `lib/auth/supabase-auth.ts` - Wrap existing Supabase Auth
- [x] 3.3 Create `lib/auth/local-auth.ts` - Session-based auth with bcrypt passwords
- [x] 3.4 Create `lib/auth/index.ts` - Factory function based on `AUTH_MODE` env var
- [x] 3.5 Create `app/api/auth/login/route.ts` - Local login endpoint
- [x] 3.6 Create `app/api/auth/logout/route.ts` - Local logout endpoint
- [x] 3.7 Create `app/api/auth/me/route.ts` - Get current user endpoint
- [ ] 3.8 Update `middleware.ts` to support both auth modes
- [ ] 3.9 Create local login UI component `components/ui/LocalLoginForm.tsx`
- [x] 3.10 Add `users` table to schema for local auth mode (in docker-entrypoint.sh)
- [x] 3.11 Create CLI script `scripts/create-admin.js` for creating local users
- [ ] 3.12 Write unit tests for local auth

## 4. Docker Configuration

- [x] 4.1 Create `Dockerfile` - Multi-stage build (Node.js build, Python deps, combined runtime)
- [x] 4.2 Create `docker-compose.yml` - Production configuration with volume mounts
- [x] 4.3 Create `docker-compose.dev.yml` - Development configuration with hot-reload
- [x] 4.4 Create `docker/supervisor/supervisord.conf` - Process manager configuration
- [ ] 4.5 Create `docker/s6/` - Alternative s6-overlay service definitions
- [x] 4.6 Create `docker-entrypoint.sh` - Container startup script (init DB, create admin, start services)
- [x] 4.7 Create `.dockerignore` - Exclude node_modules, .next, .git, etc.
- [x] 4.8 Add healthcheck to Dockerfile
- [ ] 4.9 Test multi-platform build (amd64, arm64)

## 5. Python Worker Updates

- [x] 5.1 Update `api/workers/analyze_eeg.py` - Detect storage mode from environment
- [x] 5.2 Update `api/workers/analyze_eeg.py` - Implement local file download/upload
- [x] 5.3 Update `api/workers/server.py` - Add startup checks for required directories
- [ ] 5.4 Update `api/workers/requirements.txt` - Add `psycopg2-binary` for direct Postgres access
- [x] 5.5 Create `api/workers/local_storage.py` - Local storage utility functions
- [ ] 5.6 Test worker with local storage mode

## 6. Environment Configuration

- [x] 6.1 Update `.env.example` with Docker-specific variables
- [x] 6.2 Create `.env.docker.example` - Template for Docker deployment
- [ ] 6.3 Update `lib/worker-client.ts` - Add `WORKER_MODE=local` for in-container communication
- [x] 6.4 Create `lib/config.ts` - Centralized configuration with validation
- [ ] 6.5 Add runtime validation for required env vars in Docker mode

## 7. Documentation

- [x] 7.1 Create `DOCKER.md` - Docker deployment guide
- [ ] 7.2 Update `README.md` - Add Docker quick start section
- [ ] 7.3 Add troubleshooting section for common Docker issues
- [ ] 7.4 Document backup and restore procedures
- [ ] 7.5 Document resource requirements (RAM, disk space)

## 8. Testing and Validation

- [ ] 8.1 Create `e2e/docker.spec.ts` - End-to-end tests for Docker deployment
- [ ] 8.2 Test full workflow: login -> upload EDF -> analyze -> view results -> export
- [ ] 8.3 Test data persistence across container restarts
- [ ] 8.4 Test cloud mode still works after changes (regression testing)
- [ ] 8.5 Test on Linux, macOS (Intel and Apple Silicon), Windows with Docker Desktop
- [ ] 8.6 Verify container size is reasonable (<3GB compressed)

## 9. CI/CD

- [ ] 9.1 Create `.github/workflows/docker-build.yml` - Build and test Docker image
- [ ] 9.2 Create `.github/workflows/docker-publish.yml` - Publish to ghcr.io on release
- [ ] 9.3 Add Docker build to existing CI pipeline
- [ ] 9.4 Set up automated multi-platform builds

## Dependencies

- Tasks in Section 1 (Storage) can run in parallel with Section 2 (Database) and Section 3 (Auth)
- Section 4 (Docker) depends on Sections 1-3 being complete
- Section 5 (Python Worker) depends on Section 1 (Storage)
- Section 6 (Environment) can run in parallel with Sections 1-3
- Section 7 (Documentation) should be updated as features are completed
- Section 8 (Testing) depends on all previous sections
- Section 9 (CI/CD) can start after Section 4 basics are complete

## Summary

**Completed:**
- Storage abstraction layer (TypeScript and Python)
- Database abstraction layer (types and clients)
- Local authentication system
- Docker configuration (Dockerfile, docker-compose, supervisor)
- Python worker local storage support
- Environment configuration
- Core documentation (DOCKER.md)
- API route updates for storage abstraction

**Remaining:**
- Unit and integration tests
- Middleware updates for local auth
- Local login UI component
- CI/CD workflows
- README updates
- Multi-platform testing
