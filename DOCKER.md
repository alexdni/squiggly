# Docker Deployment Guide

Run Squiggly EEG Analysis locally using Docker. This single container includes the Next.js frontend, Python worker, and PostgreSQL database.

## Quick Start

```bash
# Run with Docker (replace admin credentials)
docker run -d \
  --name squiggly \
  -p 3000:3000 \
  -e ADMIN_EMAIL=admin@example.com \
  -e ADMIN_PASSWORD=your-secure-password \
  -v squiggly-data:/data \
  ghcr.io/squiggly/squiggly:latest

# Access the application
open http://localhost:3000
```

## Using Docker Compose

1. Copy the example environment file:
```bash
cp .env.docker.example .env.docker
```

2. Edit `.env.docker` with your admin credentials:
```bash
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-secure-password
```

3. Start the container:
```bash
docker-compose up -d
```

4. View logs:
```bash
docker-compose logs -f
```

5. Stop the container:
```bash
docker-compose down
```

## Building from Source

```bash
# Build the image
docker build -t squiggly .

# Run the container
docker run -d \
  --name squiggly \
  -p 3000:3000 \
  -e ADMIN_EMAIL=admin@example.com \
  -e ADMIN_PASSWORD=your-secure-password \
  -v squiggly-data:/data \
  squiggly
```

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `ADMIN_EMAIL` | Admin user email for login |
| `ADMIN_PASSWORD` | Admin user password |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Web server port |
| `MAX_UPLOAD_SIZE` | `52428800` | Max upload size in bytes (50MB) |
| `ENABLE_ICA` | `true` | Enable ICA artifact removal |
| `ENABLE_RULE_ENGINE` | `true` | Enable risk pattern detection |
| `ENABLE_EXPORT` | `true` | Enable PDF/JSON export |

### AI Interpretation (Optional)

To enable AI-powered interpretation of EEG results:

```bash
docker run -d \
  --name squiggly \
  -p 3000:3000 \
  -e ADMIN_EMAIL=admin@example.com \
  -e ADMIN_PASSWORD=your-secure-password \
  -e OPENAI_API_KEY=sk-your-openai-key \
  -v squiggly-data:/data \
  squiggly
```

## Data Persistence

The container stores all data in the `/data` volume:

- `/data/postgres` - PostgreSQL database files
- `/data/storage/recordings` - Uploaded EEG files
- `/data/storage/visuals` - Generated visualizations
- `/data/storage/exports` - Exported reports

Always mount a volume to persist data:

```bash
-v squiggly-data:/data
```

Or use a local directory:

```bash
-v /path/to/local/data:/data
```

## Backup and Restore

### Backup Database

```bash
# Create backup
docker exec squiggly pg_dump -U squiggly squiggly > backup.sql

# Or backup to a file inside the container
docker exec squiggly pg_dump -U squiggly squiggly > /data/backup.sql
```

### Restore Database

```bash
# Restore from backup
docker exec -i squiggly psql -U squiggly squiggly < backup.sql
```

### Backup Storage Files

```bash
# Copy storage directory
docker cp squiggly:/data/storage ./storage-backup
```

## Resource Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 2 GB | 4 GB |
| CPU | 2 cores | 4 cores |
| Disk | 10 GB | 50 GB |

EEG analysis is CPU and memory intensive. For processing multiple files simultaneously, allocate more resources.

## Troubleshooting

### Container won't start

Check logs:
```bash
docker logs squiggly
```

Common issues:
- Missing `ADMIN_EMAIL` or `ADMIN_PASSWORD`
- Port 3000 already in use (use `-p 3001:3000`)
- Insufficient memory

### Analysis fails

Check Python worker logs:
```bash
docker exec squiggly cat /var/log/supervisor/python-worker.log
```

### Database connection issues

Check PostgreSQL logs:
```bash
docker exec squiggly cat /var/log/supervisor/postgresql.log
```

### Reset everything

```bash
# Stop and remove container
docker rm -f squiggly

# Remove data volume (WARNING: deletes all data!)
docker volume rm squiggly-data

# Start fresh
docker run -d ... squiggly
```

## Health Check

The container includes a health check endpoint:

```bash
curl http://localhost:3000/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "squiggly",
  "mode": "docker",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Ports

| Port | Service |
|------|---------|
| 3000 | Web application (exposed) |
| 8000 | Python worker (internal) |
| 5432 | PostgreSQL (internal) |

Only port 3000 is exposed by default. To access PostgreSQL directly:

```bash
docker run -d \
  --name squiggly \
  -p 3000:3000 \
  -p 5432:5432 \
  -e ADMIN_EMAIL=admin@example.com \
  -e ADMIN_PASSWORD=your-secure-password \
  -v squiggly-data:/data \
  squiggly
```

## Security Notes

1. **Change the default password** - Always set a strong `ADMIN_PASSWORD`
2. **Use HTTPS in production** - Place behind a reverse proxy (nginx, traefik)
3. **Firewall** - Restrict access to port 3000 in production
4. **No PHI** - This tool is not HIPAA compliant; don't upload identifiable health data
5. **Local use only** - Docker deployment is designed for local/dev use, not public internet

## Comparison: Docker vs Cloud

| Feature | Docker | Cloud (Vercel+Railway+Supabase) |
|---------|--------|--------------------------------|
| Setup | Single command | Multiple services |
| Cost | Free (self-hosted) | ~$35-60/month |
| Scaling | Single user/team | Multi-user |
| Auth | Local login | Google OAuth |
| Backups | Manual | Automatic |
| Updates | Manual rebuild | Auto-deploy from Git |
| Internet | Not required | Required |
| HIPAA | No | No |
