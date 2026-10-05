# Squiggly - EEG Assessment Platform

Rapid, transparent, open-source tool for analyzing 19-channel EEG recordings with support for Eyes-Open (EO) and Eyes-Closed (EC) conditions.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Docker](https://img.shields.io/badge/docker-ready-brightgreen.svg)

## Demo

[![Squiggly Demo](https://img.youtube.com/vi/dMbyHhDVys0/maxresdefault.jpg)](https://youtu.be/dMbyHhDVys0)

[Watch the full demo on YouTube](https://youtu.be/dMbyHhDVys0)

---

## Features

### File Support
- **EDF / BDF** - Standard clinical EEG (16-bit) and BioSemi (24-bit) files; 10-20 / 10-10 labels (legacy T3/T4/T5/T6 accepted), high-rate recordings decimated to ~250 Hz
- **CSV Format** - Divergence/Flex device recordings; `timestamp` column first or last, numeric (s/ms/µs/ns) or ISO 8601

### Interactive EEG Viewer
- Real-time waveform display with per-channel rendering
- Adjustable gain and time scale; zero-phase 4th-order Butterworth high/low-pass and mains notch (same design as the cleaning pipeline)
- **Raw / Cleaned toggle**: view the recording as the analysis cleaned it (filtered, re-referenced, ASR/ICA-corrected)
- Time slider for quick navigation across the recording
- Channel selection for focused review

### Annotation & Artifact Marking
- Draw artifact regions directly on the EEG waveform
- Annotations persist across sessions (stored in database)
- Add artifact, event, or note annotations with start/end times
- Remove annotations individually

### De-Artifacting Options
- **Automatic pipeline** with selectable profiles: *full* (channel QC and interpolation, zero-phase filtering, transient repair, ASR, ICA with component classification or blink regression, adaptive epoch rejection), *conservative*, *aggressive*, *rejection-only* and *legacy* (160 µV gate)
- Adjustable rejection ceiling (µV), ASR cutoff and mains frequency
- **Manual** - Use your hand-drawn artifact annotations to exclude marked segments, skipping ASR/ICA
- Choose the method before each analysis run

### Multi-Domain Analysis

| Domain | Metrics |
|--------|---------|
| **Power Spectral** | Absolute & relative band power (Delta, Theta, Alpha1, Alpha2, SMR, Beta2, HiBeta, LowGamma) |
| **Connectivity** | Weighted Phase-Lag Index (wPLI), network graph metrics |
| **Network Metrics** | Global efficiency, clustering coefficient, small-worldness, interhemispheric connectivity |
| **Complexity** | Lempel-Ziv Complexity (LZC) per channel with normalization |
| **Asymmetry** | Frontal Alpha Asymmetry (FAA), Power Asymmetry Index (PAI) |
| **Band Ratios** | Theta/Beta, Alpha/Theta (frontal and posterior averages) |
| **Alpha Peak** | Individual Alpha Frequency (IAF) per channel |

### Heuristic Risk Assessment
Pattern flagging based on within-subject thresholds:
- **ADHD-like**: Elevated frontal theta/beta ratio (>2.5)
- **Anxiety-like**: Elevated frontal beta ratio (>0.25)
- **Depression-like**: Frontal alpha asymmetry (<-0.15)
- **Sleep Dysregulation**: Elevated delta power (>0.25)
- **Hyper-arousal**: Elevated high-beta (>0.15)

### Interactive Visualizations
Rendered in the browser from the analysis results:
- Topomaps per band and condition
- Spectrograms for key channels (Fp1, Fz, Cz, Pz, O1)
- Brain connectivity graphs (wPLI-based)
- Network metrics summary charts
- Alpha peak frequency topomaps
- LZC complexity topomaps

### AI Interpretation (Optional)
- GPT-4 powered analysis summaries
- Structured interpretation covering all domains
- Cached results for instant retrieval

### Comparison Mode
- Compare any two recordings within a project
- Power change analysis (absolute and percent)
- Coherence and asymmetry deltas
- Side-by-side visualization comparison
- AI interpretation for comparative results

### Analysis Workflow
- Upload a recording and review it in the EEG viewer
- Optionally mark artifact segments by hand
- Choose an automatic profile or Manual de-artifacting
- Click "Start Analysis" when ready (no auto-trigger on upload)
- Re-analyze at any time with a different method

### Export
- Full analysis results as JSON
- Cleaned recording in its original format (EDF, BDF or CSV)
- All data accessible via API

### Collaboration
- Google OAuth authentication
- Project-level access control
- Member sharing and permissions

---

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
- Vercel account (analyses run up to 300 s inside the function; the default 2 GB memory is enough)
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
Projects organize recordings for a subject/client. Add optional metadata (age, gender, primary concern).

### 2. Upload EEG Recording
- Drag and drop an EDF, BDF or CSV file
- The file is checked for at least 2 EEG channels
- Mark EO/EC segments (auto-detected from annotations or filename)
- Analysis is created in pending state (not auto-triggered)

### 3. Review EEG & Mark Artifacts
- Use the interactive EEG viewer to inspect the raw waveform
- Adjust filters and gain for clarity
- Draw annotation regions over artifact segments (blinks, muscle, movement)
- Annotations save automatically and persist across sessions

### 4. Choose De-Artifacting & Analyze
- Select the **Automatic pipeline** (pick a profile; *full* is recommended) or **Manual** to use only your marked artifact segments
- Click "Start Analysis"; processing runs on the server and usually takes under a minute

### 5. Review Results
Interactive dashboard showing:
- Quality control metrics (artifact rejection rate, bad channels, epochs)
- Band power topomaps
- Spectrograms
- Connectivity graphs
- Network metrics
- Asymmetry indices
- Risk assessment flags

### 6. AI Interpretation (Optional)
Click "Generate AI Interpretation" for GPT-4 powered analysis summary.

### 7. Re-Analyze
Click "Re-Analyze" to reset to pending, adjust annotations or switch de-artifacting method, and re-run.

### 8. Compare Recordings
Select two recordings to compare:
- Power change analysis
- Delta visualizations
- AI interpretation of changes

### 9. Export
Download the cleaned recording from the QC panel, or the JSON results via the API.

### 10. TheraQ Phase Comparison
Assign EO1 / EC / EO2 / TASK roles to four recordings in a project (auto-detected from file names) and run the four-phase TheraQ report from the project's TheraQ tab.

---

## API Reference

### Analyses
- `GET /api/analyses/[id]` - Get analysis details
- `PATCH /api/analyses/[id]` - Update the analysis config, or reset it to pending for a re-run
- `POST /api/analyses/[id]/process` - Start the server-side analysis (responds 202; poll `GET /api/analyses/[id]`)
- `GET /api/analyses/[id]/ai-interpretation` - Get cached AI interpretation
- `POST /api/analyses/[id]/ai-interpretation` - Generate AI interpretation

### Projects
- `GET /api/projects` - List user's projects
- `POST /api/projects` - Create project
- `GET /api/projects/[id]/compare` - Compare two recordings
- `GET` / `POST /api/projects/[id]/theraq-analysis` - List / start TheraQ four-phase analyses

### Recordings
- `GET /api/recordings?projectId=...` - List recordings
- `POST /api/recordings` - Create recording entry
- `PATCH /api/recordings/[id]` - Set the recording's TheraQ phase role
- `GET /api/recordings/[id]/download` - Short-lived signed URL for the recording file

### Annotations
- `GET /api/recordings/[id]/annotations` - List annotations for a recording
- `POST /api/recordings/[id]/annotations` - Create an annotation
- `DELETE /api/recordings/[id]/annotations?annotationId=...` - Delete an annotation

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
