# Capability: Local Deployment

## ADDED Requirements

### Requirement: Docker Container Deployment

The system SHALL provide a Docker container that bundles all application components (Next.js frontend, Python worker, PostgreSQL database) into a single deployable unit.

#### Scenario: Single command startup

- **WHEN** a user runs `docker run -p 3000:3000 -v squiggly-data:/data ghcr.io/squiggly/squiggly`
- **THEN** the container starts all services (Next.js on 3000, Python worker on 8000, PostgreSQL on 5432)
- **AND** the application becomes accessible at `http://localhost:3000`
- **AND** data persists in the mounted volume

#### Scenario: Environment configuration

- **WHEN** a user provides `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables
- **THEN** an admin user is created on first container startup
- **AND** the user can log in with those credentials

#### Scenario: Missing required configuration

- **WHEN** a user starts the container without `ADMIN_EMAIL` or `ADMIN_PASSWORD`
- **THEN** the container logs a clear error message explaining required variables
- **AND** the container exits with a non-zero status code

### Requirement: Local File Storage

The system SHALL support local filesystem storage as an alternative to Supabase Storage when running in Docker mode.

#### Scenario: EDF file upload in Docker mode

- **WHEN** a user uploads an EDF file while `STORAGE_MODE=local`
- **THEN** the file is saved to `/data/storage/recordings/{project_id}/{filename}`
- **AND** the file path is stored in the database
- **AND** the Python worker can access the file at this path

#### Scenario: Visual asset storage in Docker mode

- **WHEN** the Python worker generates visualization PNGs
- **AND** `STORAGE_MODE=local`
- **THEN** the PNGs are saved to `/data/storage/visuals/{analysis_id}/{visual_name}.png`
- **AND** the frontend can retrieve them via the API

#### Scenario: Export file storage in Docker mode

- **WHEN** a user exports analysis results (PDF, JSON)
- **AND** `STORAGE_MODE=local`
- **THEN** the export file is saved to `/data/storage/exports/{analysis_id}/`
- **AND** the user can download the file

### Requirement: Local PostgreSQL Database

The system SHALL use an embedded PostgreSQL database when running in Docker mode.

#### Scenario: Database initialization

- **WHEN** the container starts for the first time
- **AND** the PostgreSQL data directory is empty
- **THEN** the database is initialized with the application schema
- **AND** required tables (projects, recordings, analyses, etc.) are created
- **AND** indices and triggers are applied

#### Scenario: Database persistence

- **WHEN** the container is stopped and restarted
- **AND** the data volume was mounted
- **THEN** all previously stored data (projects, recordings, analyses) remains available

#### Scenario: Schema migration

- **WHEN** a new container version includes schema changes
- **THEN** migrations are applied automatically on startup
- **AND** existing data is preserved

### Requirement: Local Authentication

The system SHALL support session-based authentication with username/password when running in Docker mode.

#### Scenario: User login

- **WHEN** a user submits valid credentials on the login page
- **AND** `AUTH_MODE=local`
- **THEN** a session cookie is created
- **AND** the user is redirected to the dashboard

#### Scenario: Invalid credentials

- **WHEN** a user submits invalid credentials
- **THEN** an error message is displayed
- **AND** no session is created

#### Scenario: Session persistence

- **WHEN** a logged-in user closes and reopens the browser
- **AND** the session has not expired
- **THEN** the user remains authenticated

#### Scenario: Protected routes

- **WHEN** an unauthenticated user accesses a protected route
- **THEN** the user is redirected to the login page

### Requirement: In-Container Worker Communication

The system SHALL communicate with the Python worker via HTTP on localhost when running in Docker mode.

#### Scenario: Analysis job submission

- **WHEN** a user triggers EEG analysis in Docker mode
- **THEN** the Next.js API route calls `http://localhost:8000/analyze`
- **AND** the Python worker processes the job
- **AND** results are stored in the local PostgreSQL database

#### Scenario: Worker health check

- **WHEN** the application performs a worker health check in Docker mode
- **THEN** it calls `http://localhost:8000/health`
- **AND** receives a healthy status if the worker is running

### Requirement: Docker Compose Development Configuration

The system SHALL provide a docker-compose.yml for development that supports hot-reloading and debugging.

#### Scenario: Development mode startup

- **WHEN** a developer runs `docker-compose -f docker-compose.dev.yml up`
- **THEN** the application starts in development mode
- **AND** changes to source files trigger automatic reloading
- **AND** logs from all services are visible in the terminal

#### Scenario: Volume mounting for development

- **WHEN** running in development mode
- **THEN** the source code directory is mounted into the container
- **AND** changes are reflected without rebuilding the container

### Requirement: Cloud Mode Compatibility

The system SHALL maintain full compatibility with existing cloud deployment (Vercel/Railway/Supabase) when `DEPLOYMENT_MODE=cloud`.

#### Scenario: Cloud mode operation

- **WHEN** `DEPLOYMENT_MODE=cloud` (or unset, defaulting to cloud)
- **THEN** the application uses Supabase for database, storage, and auth
- **AND** the application calls the Railway-hosted Python worker
- **AND** behavior is identical to current production deployment

#### Scenario: Mode switching

- **WHEN** switching from cloud to Docker mode (or vice versa)
- **THEN** only environment variables need to change
- **AND** no code modifications are required
