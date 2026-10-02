# Squiggly - EEG Assessment Platform

Rapid, transparent, open-source tool for analyzing 19-channel EEG recordings with support for Eyes-Open (EO) and Eyes-Closed (EC) conditions.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Docker](https://img.shields.io/badge/docker-ready-brightgreen.svg)

## Features

- **File Support**: EDF, BDF and CSV upload (10-20 / 10-10 montages)
- **Artifact Pipeline**: Channel QC and interpolation, zero-phase filtering, transient repair, ASR, extended-Infomax ICA with component classification (or blink regression), adaptive epoch rejection — selectable profiles plus a manual-annotation mode
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

All signal processing runs **server-side in Node.js** inside the Next.js server — there is no
separate worker service. `POST /api/analyses/[id]/process` returns immediately and runs the job in a
`worker_threads` thread; the browser polls for completion and draws every visual (topomaps,
connectivity graphs, spectrograms) from the results JSON.

### Docker Mode (Self-Hosted)
All-in-one container for local deployment:

```
┌─────────────────────────────────────────────────────┐
│                 Docker Container                     │
│  ┌──────────────────────────────┐  ┌─────────────┐  │
│  │ Next.js (UI + API routes)    │  │ PostgreSQL  │  │
│  │  └ analysis worker thread    │  │  Database   │  │
│  │   (Port 3000)                │  │ (Port 5432) │  │
│  └──────────────────────────────┘  └─────────────┘  │
│                  │                        │          │
│                  ▼                        ▼          │
│              ┌─────────────────────┐                 │
│              │   Local Storage     │                 │
│              │   /data/storage/    │                 │
│              └─────────────────────┘                 │
└─────────────────────────────────────────────────────┘
```

### Cloud Mode (Vercel + Supabase)
Distributed architecture for multi-user deployment:

```
┌──────────────────────────┐     ┌──────────────┐
│          Vercel          │     │   Supabase   │
│  Next.js UI + API routes │────►│  PostgreSQL  │
│  analysis in functions   │     │   Storage    │
└──────────────────────────┘     └──────────────┘
              Supabase Auth (Google OAuth)
```

### Analysis engine (private dependency)

Artifact cleaning uses `@divergentneuro/biofeedback-core`, a **private** package on GitHub
Packages. It is loaded only on the server and is never sent to the browser (the build fails if
it reaches a client bundle — see `scripts/check-client-bundle.mjs`). To install dependencies you
need a GitHub token with `read:packages` access to the DivergentNeuro organization:

```bash
export NODE_AUTH_TOKEN=ghp_your_token   # used by .npmrc; never commit it
npm ci
```

Without the token the rest of the app installs, but the build stops with a message explaining
that the analysis engine is missing.

## Tech Stack

| Component | Docker Mode | Cloud Mode |
|-----------|-------------|------------|
| Frontend | Next.js 14 (App Router) | Same |
| Backend | Next.js API Routes | Same |
| Database | PostgreSQL (embedded) | Supabase PostgreSQL |
| Storage | Local filesystem | Supabase Storage |
| Auth | Session-based login | Google OAuth |
| Analysis | Node.js worker thread in the Next.js server | Vercel Functions (Node.js) |
| Signal Processing | TypeScript (biofeedback-core artifact pipeline + `lib/server/eeg`) | Same |
| Visuals | Canvas / SVG / Chart.js in the browser | Same |

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

3. **Build and start** (the token is passed as a BuildKit secret and never stored in the image)
   ```bash
   export NODE_AUTH_TOKEN=ghp_your_token
   docker compose up -d --build
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
docker exec squiggly cat /var/log/supervisor/nextjs.log   # look for [analysis <id>] lines
```

**Reset everything:**
```bash
docker compose down -v  # WARNING: Deletes all data
docker compose up -d
```

---

## Cloud Deployment (Vercel + Supabase)

For multi-user deployment with Google OAuth authentication. See [DEPLOYMENT.md](DEPLOYMENT.md)
for details.

### Prerequisites

- Supabase account
- Vercel account (Pro recommended: analyses run up to 300 s with 3 GB memory)
- Google Cloud project (for OAuth)
- GitHub token with `read:packages` for the analysis engine

### Setup Instructions

#### 1. Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Run the schema SQL (SQL Editor → paste contents of `supabase/schema.sql`), then the files in
   `supabase/migrations/`
3. Create Storage buckets: `recordings`, `visuals`, `exports` (private)
4. Enable Google OAuth (Authentication → Providers → Google)

#### 2. Deploy to Vercel

1. Import project in [Vercel](https://vercel.com)
2. Set environment variables:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   # analyses write results with it
   NODE_AUTH_TOKEN=ghp_your_token                     # build-time: installs the analysis engine
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
├── components/                   # React components
│   └── visuals/                  # Client-rendered topomaps, connectivity, spectrograms
├── lib/                          # Shared utilities
│   ├── server/eeg/               # Server-only analysis: IO, pipeline, features, job runner
│   ├── server/theraq/            # TheraQ four-phase metrics engine
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
- Supported formats: EDF, BDF, CSV
- 10-20 / 10-10 channel labels (legacy T3/T4/T5/T6 accepted)
- Auto-detection of EO/EC segments from annotations or filename

### 3. Analysis
Choose an artifact profile (full, conservative, aggressive, rejection-only, legacy) or manual
mode, then start the analysis. The server:
- Cleans the recording (QC, filtering, ASR, ICA, epoch rejection)
- Extracts features across all domains
- Evaluates risk patterns
- Stores the cleaned recording in its original format for download

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
| Setup complexity | Low (single command) | Medium (2 services) |
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

- Artifact pipeline from DivergentNeuro `biofeedback-core`; feature definitions originally implemented with [MNE-Python](https://mne.tools/)
- UI components from [shadcn/ui](https://ui.shadcn.com/)
- Inspired by open-source QEEG research tools
