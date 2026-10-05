#!/bin/bash
set -e

echo "========================================"
echo "Squiggly EEG Analysis - Docker Startup"
echo "========================================"

# Check required environment variables
if [ "$AUTH_MODE" = "local" ]; then
    if [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASSWORD" ]; then
        echo "ERROR: ADMIN_EMAIL and ADMIN_PASSWORD are required in local auth mode"
        echo "Please set these environment variables when starting the container:"
        echo "  docker run -e ADMIN_EMAIL=admin@example.com -e ADMIN_PASSWORD=yourpassword ..."
        exit 1
    fi
fi

# Initialize PostgreSQL data directory if needed
PGDATA="/data/postgres"
if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "Initializing PostgreSQL database..."

    # Create postgres user if it doesn't exist
    if ! id -u postgres > /dev/null 2>&1; then
        useradd -r -s /bin/false postgres
    fi

    # Initialize database
    chown -R postgres:postgres "$PGDATA"
    chmod 700 "$PGDATA"
    su - postgres -s /bin/bash -c "/usr/lib/postgresql/*/bin/initdb -D $PGDATA"

    # Configure PostgreSQL
    echo "host all all 127.0.0.1/32 md5" >> "$PGDATA/pg_hba.conf"
    echo "local all all trust" >> "$PGDATA/pg_hba.conf"

    # Find PostgreSQL bin directory
    PG_BIN=$(dirname $(ls -d /usr/lib/postgresql/*/bin/postgres | head -1))

    # Start PostgreSQL temporarily for setup
    su - postgres -s /bin/bash -c "$PG_BIN/pg_ctl -D $PGDATA -l /tmp/postgres.log start"
    sleep 3

    # Create database and user
    su - postgres -s /bin/bash -c "$PG_BIN/psql -c \"CREATE USER squiggly WITH PASSWORD 'squiggly';\""
    su - postgres -s /bin/bash -c "$PG_BIN/psql -c \"CREATE DATABASE squiggly OWNER squiggly;\""
    su - postgres -s /bin/bash -c "$PG_BIN/psql -c \"GRANT ALL PRIVILEGES ON DATABASE squiggly TO squiggly;\""

    # Apply schema (includes users table for local auth)
    echo "Applying database schema..."
    su - postgres -s /bin/bash -c "$PG_BIN/psql -d squiggly -f /app/scripts/schema.sql"

    # Grant permissions to squiggly user
    echo "Granting permissions..."
    su - postgres -s /bin/bash -c "$PG_BIN/psql -d squiggly -c \"
        GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO squiggly;
        GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO squiggly;
        GRANT USAGE ON SCHEMA public TO squiggly;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO squiggly;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO squiggly;
    \""

    # Stop PostgreSQL (supervisor will start it)
    su - postgres -s /bin/bash -c "$PG_BIN/pg_ctl -D $PGDATA stop"

    echo "PostgreSQL initialized successfully"
else
    echo "PostgreSQL data directory exists, skipping initialization"

    # Apply schema migrations for existing databases
    # Uses IF NOT EXISTS so safe to run repeatedly
    PG_BIN=$(dirname $(ls -d /usr/lib/postgresql/*/bin/postgres | head -1))
    su - postgres -s /bin/bash -c "$PG_BIN/pg_ctl -D $PGDATA -l /tmp/postgres.log start"
    sleep 3

    echo "Applying schema migrations..."
    su - postgres -s /bin/bash -c "$PG_BIN/psql -d squiggly -f /app/scripts/schema.sql" 2>/dev/null || true

    # Ensure permissions on any new tables
    su - postgres -s /bin/bash -c "$PG_BIN/psql -d squiggly -c \"
        GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO squiggly;
        GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO squiggly;
    \"" 2>/dev/null || true

    su - postgres -s /bin/bash -c "$PG_BIN/pg_ctl -D $PGDATA stop"
    echo "Schema migrations applied"
fi

# Ensure correct permissions
chown -R postgres:postgres "$PGDATA"
chmod 700 "$PGDATA"

# Create storage directories
mkdir -p /data/storage/recordings /data/storage/visuals /data/storage/exports
chmod -R 755 /data/storage

echo "Starting services..."
exec "$@"
