# Squiggly - EEG Assessment Platform

Rapid, transparent, open-source tool for analyzing 19-channel EEG recordings with support for Eyes-Open (EO) and Eyes-Closed (EC) conditions.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Docker](https://img.shields.io/badge/docker-ready-brightgreen.svg)

## Features

- **File Support**: EDF and CSV file upload (19-channel 10-20 montage)
- **Preprocessing Pipeline**: Configurable filtering, ICA artifact removal, and epoching
- **Multi-Domain Analysis**:
  - **Power Spectral**: Absolute/relative band power, alpha peak frequency
  - **Connectivity**: Weighted Phase-Lag Index (wPLI), network metrics
  - **Complexity**: Lempel-Ziv Complexity (LZC) per channel
  - **Asymmetry**: Power Asymmetry Index (PAI), Frontal Alpha Asymmetry (FAA)
  - **Band Ratios**: Theta/Beta, Alpha/Theta, and more
- **Interactive Visualizations**: Topomaps, spectrograms, connectivity graphs, network metrics
- **AI Interpretation**: GPT-4 powered analysis summaries (optional)
- **Comparison Mode**: Compare two recordings side-by-side with delta analysis
- **Heuristic Risk Assessment**: Pattern flagging for ADHD-like, anxiety-like, depression-like patterns
- **Export**: PDF reports and JSON data export

## Architecture

Squiggly supports two deployment modes:

### Docker Mode (Self-Hosted)
All-in-one container for local deployment:

```
┌─────────────────────────────────────────────────────┐
│                 Docker Container                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   Next.js   │  │   Python    │  │ PostgreSQL  │  │
│  │  Frontend   │◄─┤   Worker    │  │  Database   │  │
│  │  (Port 3000)│  │ (Port 8000) │  │ (Port 5432) │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│         │                │                │          │
│         └────────────────┼────────────────┘          │
│                          ▼                           │
│              ┌─────────────────────┐                 │
│              │   Local Storage     │                 │
│              │   /data/storage/    │                 │
│              └─────────────────────┘                 │
└─────────────────────────────────────────────────────┘
```

### Cloud Mode (Vercel + Railway + Supabase)
Distributed architecture for multi-user deployment:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    Vercel    │     │   Railway    │     │   Supabase   │
│   Next.js    │────►│    Python    │     │  PostgreSQL  │
│   Frontend   │     │    Worker    │     │   Storage    │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │
       └────────────────────┴────────────────────┘
                     Supabase Auth (Google OAuth)
```

## Tech Stack

| Component | Docker Mode | Cloud Mode |
|-----------|-------------|------------|
| Frontend | Next.js 14 (App Router) | Same |
| Backend | Next.js API Routes | Same |
| Database | PostgreSQL (embedded) | Supabase PostgreSQL |
| Storage | Local filesystem | Supabase Storage |
| Auth | Session-based login | Google OAuth |
| Worker | Python (embedded) | Railway container |
| Signal Processing | MNE, NumPy, SciPy, antropy | Same |

---

## Docker Deployment (Recommended for Local Use)

### Prerequisites

- Docker and Docker Compose
- 4GB RAM minimum (8GB recommended for large files)
- 10GB disk space

### Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/alexdni/squiggly.git
   cd squiggly
   git checkout docker
   ```

2. **Configure environment**
   ```bash
   cp .env.docker.example .env.docker
   ```

   Edit `.env.docker` and set your credentials:
   ```env
   ADMIN_EMAIL=your-email@example.com
   ADMIN_PASSWORD=your-secure-password

   # Optional: Enable AI interpretation
   OPENAI_API_KEY=sk-your-openai-api-key
   ```

3. **Build and start**
   ```bash
   docker compose up -d
   ```

4. **Access the application**

   Open [http://localhost:3000](http://localhost:3000) and log in with your admin credentials.

### Docker Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ADMIN_EMAIL` | Yes | - | Admin login email |
| `ADMIN_PASSWORD` | Yes | - | Admin login password |
| `OPENAI_API_KEY` | No | - | OpenAI API key for AI interpretation |
| `PORT` | No | `3000` | Web server port |
| `MAX_UPLOAD_SIZE` | No | `52428800` | Max upload size (50MB) |

### Data Persistence

All data is stored in the `/data` volume:

```
/data/
├── postgres/           # PostgreSQL database
└── storage/
    ├── recordings/     # Uploaded EEG files
    ├── visuals/        # Generated images
    └── exports/        # PDF/JSON exports
```

Mount a named volume or local directory:
```bash
# Named volume (recommended)
docker compose up -d

# Or local directory
docker run -v /path/to/data:/data squiggly
```

### Common Docker Commands

```bash
# View logs
docker compose logs -f

# Stop the container
docker compose down

# Rebuild after code changes
docker compose build --no-cache
docker compose up -d

# Access PostgreSQL
docker exec -it squiggly psql -U squiggly

# Backup database
docker exec squiggly pg_dump -U squiggly squiggly > backup.sql

# Check health
curl http://localhost:3000/api/health
```

### Troubleshooting Docker

**Container won't start:**
```bash
docker logs squiggly
```

**Analysis fails:**
```bash
docker exec squiggly cat /var/log/supervisor/python-worker-error.log
```

**Reset everything:**
```bash
docker compose down -v  # WARNING: Deletes all data
docker compose up -d
```

---

## Cloud Deployment (Vercel + Railway + Supabase)

For multi-user deployment with Google OAuth authentication.

### Prerequisites

- Supabase account
- Vercel account
- Railway account
- Google Cloud project (for OAuth)

### Setup Instructions

#### 1. Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Run the schema SQL (SQL Editor → paste contents of `supabase/schema.sql`)
3. Create Storage buckets: `recordings`, `visuals`, `exports` (private)
4. Enable Google OAuth (Authentication → Providers → Google)

#### 2. Deploy Python Worker to Railway

1. Create new project in [Railway](https://railway.app)
2. Connect to your GitHub repository
3. Set root directory: `api/workers`
4. Set environment variables:
   - `WORKER_AUTH_TOKEN`: Generate a secure random token
5. Copy the generated Railway URL

#### 3. Deploy Frontend to Vercel

1. Import project in [Vercel](https://vercel.com)
2. Set environment variables:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   WORKER_MODE=http
   WORKER_SERVICE_URL=https://your-railway-app.railway.app
   WORKER_AUTH_TOKEN=your-secure-token
   OPENAI_API_KEY=sk-your-key  # Optional
   ```
3. Deploy

---

## Project Structure

```
squiggly/
├── app/                          # Next.js App Router
│   ├── api/                      # API routes
│   │   ├── analyses/             # Analysis endpoints
│   │   ├── projects/             # Project management
│   │   ├── recordings/           # Recording endpoints
│   │   └── storage/              # File storage endpoints
│   ├── dashboard/                # Dashboard page
│   ├── login/                    # Login page
│   └── projects/                 # Project pages
├── api/workers/                  # Python signal processing
│   ├── analyze_eeg.py            # Main analysis orchestrator
│   ├── preprocess.py             # Signal preprocessing
│   ├── extract_features.py       # Feature extraction
│   ├── generate_visuals.py       # Visualization generation
│   ├── local_database.py         # Docker database functions
│   ├── local_storage.py          # Docker storage functions
│   └── server.py                 # Flask HTTP server
├── components/                   # React components
├── lib/                          # Shared utilities
│   ├── auth/                     # Authentication abstraction
│   ├── db/                       # Database abstraction
│   ├── storage/                  # Storage abstraction
│   └── prompts/                  # AI prompt templates
├── docker/                       # Docker configuration
├── scripts/                      # Setup scripts
│   └── schema-docker.sql         # Docker PostgreSQL schema
└── docker-compose.yml            # Docker Compose config
```

## Usage

### 1. Create a Project
Projects organize recordings for a subject/client.

### 2. Upload EEG Recording
- Supported formats: EDF (European Data Format), CSV
- 19-channel 10-20 montage with linked-ears reference
- Auto-detection of EO/EC segments from annotations or filename

### 3. Analysis
The system automatically:
- Preprocesses data (filtering, ICA artifact removal)
- Extracts features across all domains
- Generates visualizations
- Evaluates risk patterns

### 4. Review Results
Interactive dashboard with:
- Topomaps per band and condition
- Spectrograms for key channels
- Connectivity graphs and network metrics
- Band ratios and asymmetry indices
- Quality control metrics
- Risk pattern flags

### 5. AI Interpretation (Optional)
Generate GPT-4 powered summaries of the analysis results.

### 6. Compare Recordings
Select two recordings to compare with delta analysis and side-by-side visualizations.

### 7. Export
Download PDF reports or raw JSON data.

---

## Comparison: Docker vs Cloud

| Feature | Docker | Cloud |
|---------|--------|-------|
| Setup complexity | Low (single command) | Medium (3 services) |
| Cost | Free (self-hosted) | ~$35-60/month |
| Users | Single user/team | Multi-user |
| Authentication | Email/password | Google OAuth |
| Internet required | No | Yes |
| Scaling | Limited | Horizontal |
| Backups | Manual | Automatic |
| Updates | Manual rebuild | Auto-deploy |

---

## Important Disclaimers

**This EEG assessment platform is for educational and research use only.**

- ⚠️ NOT for medical use or clinical decision-making
- ⚠️ Risk flags are heuristic-based, not clinically validated
- ⚠️ Results should be interpreted by qualified professionals only
- ⚠️ Not HIPAA compliant - do not upload identifiable health data

---

## Contributing

Contributions are welcome! Please open an issue or pull request.

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- Built with [MNE-Python](https://mne.tools/) for EEG signal processing
- UI components from [shadcn/ui](https://ui.shadcn.com/)
- Inspired by open-source QEEG research tools
