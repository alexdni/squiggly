## ADDED Requirements

### Requirement: No Python Runtime
The system SHALL build, deploy and run without Python: no Python worker service, pip dependencies, or `WORKER_*` configuration.

#### Scenario: Docker image
- **WHEN** the Docker image is built with the npm token secret
- **THEN** it has no Python stage or gunicorn process, no token in any layer, and analysis works end to end in local mode

#### Scenario: Vercel deployment
- **WHEN** the app is deployed to Vercel with `NODE_AUTH_TOKEN` set
- **THEN** analysis completes without any external worker URL
