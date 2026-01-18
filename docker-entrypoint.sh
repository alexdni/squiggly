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
    su - postgres -s /bin/bash -c "initdb -D $PGDATA"

    # Configure PostgreSQL
    echo "host all all 127.0.0.1/32 md5" >> "$PGDATA/pg_hba.conf"
    echo "local all all trust" >> "$PGDATA/pg_hba.conf"

    # Start PostgreSQL temporarily for setup
    su - postgres -s /bin/bash -c "pg_ctl -D $PGDATA -l /tmp/postgres.log start"
    sleep 3

    # Create database and user
    su - postgres -s /bin/bash -c "psql -c \"CREATE USER squiggly WITH PASSWORD 'squiggly';\""
    su - postgres -s /bin/bash -c "psql -c \"CREATE DATABASE squiggly OWNER squiggly;\""
    su - postgres -s /bin/bash -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE squiggly TO squiggly;\""

    # Apply schema
    echo "Applying database schema..."
    su - postgres -s /bin/bash -c "psql -d squiggly -f /app/scripts/schema.sql"

    # Create users table for local auth
    su - postgres -s /bin/bash -c "psql -d squiggly -c \"
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            email TEXT UNIQUE NOT NULL,
            name TEXT,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    \""

    # Stop PostgreSQL (supervisor will start it)
    su - postgres -s /bin/bash -c "pg_ctl -D $PGDATA stop"

    echo "PostgreSQL initialized successfully"
else
    echo "PostgreSQL data directory exists, skipping initialization"
fi

# Ensure correct permissions
chown -R postgres:postgres "$PGDATA"
chmod 700 "$PGDATA"

# Create storage directories
mkdir -p /data/storage/recordings /data/storage/visuals /data/storage/exports
chmod -R 755 /data/storage

echo "Starting services..."
exec "$@"
