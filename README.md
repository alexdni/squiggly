# Squiggly - EEG Assessment Platform

Rapid, transparent, open-source tool for analyzing 19-channel EEG recordings with support for Eyes-Open (EO) and Eyes-Closed (EC) conditions.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Features

### File Support
- **EDF (European Data Format)** - Standard clinical EEG format with 19-channel 10-20 montage validation
- **CSV Format** - Support for Divergence/Flex device recordings with automatic timestamp detection

### Preprocessing Pipeline
- Configurable bandpass filtering (0.5-45 Hz default)
- Notch filtering (50/60 Hz)
- ICA-based artifact removal (configurable components)
- Amplitude-based artifact rejection
- Automatic resampling to target rate (250 Hz default)
- Quality control metrics per condition

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
- Topomaps per band and condition
- Spectrograms for key channels (Fp1, Fz, Cz, Pz, O1)
- Brain connectivity graphs (wPLI-based)
- Network metrics summary charts
- Alpha peak frequency topomaps
- LZC complexity topomaps
- Raw EEG waveform viewer

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

### Export
- Full analysis results as JSON
- Visual assets as PNG images
- All data accessible via API

### Collaboration
- Google OAuth authentication
- Project-level access control
- Member sharing and permissions

---

## Architecture

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

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 14 (App Router), React, TypeScript, Tailwind CSS |
| Backend | Next.js API Routes |
| Database | Supabase PostgreSQL with Row-Level Security |
| Storage | Supabase Storage (recordings, visuals, exports) |
| Auth | Supabase Auth with Google OAuth |
| Worker | Python Flask/Gunicorn on Railway |
| Signal Processing | MNE-Python, NumPy, SciPy, antropy, scikit-learn |
| Visualization | Plotly, matplotlib, Chart.js |

---

## Prerequisites

- Node.js 18+ and npm
- Python 3.11+ (for local development)
- Supabase account
- Google Cloud project (for OAuth)
- Railway account (for Python worker)
- Vercel account (for frontend)
- OpenAI API key (optional, for AI interpretation)

---

## Setup Instructions

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/alexdni/squiggly.git
cd squiggly
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Run the schema SQL:
   - Navigate to SQL Editor in Supabase dashboard
   - Copy and paste contents of `supabase/schema.sql`
   - Execute the script
3. Create Storage buckets:
   - Go to Storage in Supabase dashboard
   - Create three **private** buckets: `recordings`, `visuals`, `exports`
4. Enable Google OAuth:
   - Go to Authentication > Providers
   - Enable Google provider
   - Add your Google OAuth credentials

### 3. Configure Environment Variables

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Worker (configure after Railway deployment)
WORKER_MODE=http
WORKER_SERVICE_URL=https://your-railway-app.railway.app
WORKER_AUTH_TOKEN=your-secure-token

# Optional: AI Interpretation
OPENAI_API_KEY=sk-your-openai-key
```

### 4. Install Python Dependencies (for local development)

```bash
cd api/workers
pip install -r requirements.txt
cd ../..
```

### 5. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Deployment

### Deploy Python Worker to Railway

1. Create new project in [Railway](https://railway.app)
2. Connect to your GitHub repository
3. Set root directory: `api/workers`
4. Set environment variables:
   - `WORKER_AUTH_TOKEN`: Generate a secure random token
5. Railway auto-detects `Procfile` and deploys with Gunicorn
6. Copy the generated Railway URL

### Deploy Frontend to Vercel

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
│   │   ├── analyses/             # Analysis CRUD & AI interpretation
│   │   ├── projects/             # Project management & comparison
│   │   ├── recordings/           # Recording management
│   │   └── upload/               # File upload handling
│   ├── dashboard/                # Main dashboard
│   ├── login/                    # Authentication
│   ├── projects/                 # Project pages
│   └── analyses/                 # Analysis detail pages
├── api/workers/                  # Python signal processing
│   ├── analyze_eeg.py            # Main orchestrator
│   ├── preprocess.py             # Signal preprocessing
│   ├── extract_features.py       # Feature extraction
│   ├── generate_visuals.py       # Visualization generation
│   ├── evaluate_rules.py         # Risk pattern detection
│   └── server.py                 # Flask HTTP server
├── components/                   # React components
│   ├── AnalysisDetailsClient.tsx # Full analysis dashboard
│   ├── ComparisonView.tsx        # Recording comparison
│   ├── RawEEGViewer.tsx          # Waveform viewer
│   └── FileUploadZone.tsx        # Upload interface
├── lib/                          # Utilities
│   ├── supabase.ts               # Supabase client
│   ├── openai-client.ts          # OpenAI integration
│   ├── prompts/                  # AI prompt templates
│   └── constants.ts              # Configuration
├── types/                        # TypeScript definitions
└── supabase/                     # Database schema
```

---

## Usage

### 1. Create a Project
Projects organize recordings for a subject/client. Add optional metadata (age, gender, primary concern).

### 2. Upload EEG Recording
- Drag and drop EDF or CSV file
- System validates 19-channel 10-20 montage
- Mark EO/EC segments (auto-detected from annotations or filename)

### 3. Automatic Analysis
System processes the recording:
- Preprocessing (filtering, ICA, artifact rejection)
- Feature extraction across all domains
- Visualization generation
- Risk pattern evaluation

### 4. Review Results
Interactive dashboard showing:
- Band power topomaps
- Spectrograms
- Connectivity graphs
- Network metrics
- Asymmetry indices
- Quality control metrics
- Risk assessment flags

### 5. AI Interpretation (Optional)
Click "Generate AI Interpretation" for GPT-4 powered analysis summary.

### 6. Compare Recordings
Select two recordings to compare:
- Power change analysis
- Delta visualizations
- AI interpretation of changes

### 7. Export
Download JSON data via API for further analysis.

---

## API Reference

### Analyses
- `GET /api/analyses/[id]` - Get analysis details
- `POST /api/analyses/[id]/process` - Trigger analysis processing
- `GET /api/analyses/[id]/ai-interpretation` - Get cached AI interpretation
- `POST /api/analyses/[id]/ai-interpretation` - Generate AI interpretation

### Projects
- `GET /api/projects` - List user's projects
- `POST /api/projects` - Create project
- `GET /api/projects/[id]/compare` - Compare two recordings

### Recordings
- `GET /api/recordings?projectId=...` - List recordings
- `POST /api/recordings` - Create recording entry

---

## Important Disclaimers

**This EEG assessment platform is for educational and research use only.**

⚠️ **NOT for medical use or clinical decision-making**

- Heuristic risk flags are based on within-subject percentile thresholds, not normative data
- Results should be interpreted by qualified professionals only
- No clinical claims or diagnostic labels are provided
- Not HIPAA compliant - do not upload identifiable health data

---

## Docker Deployment

For self-hosted local deployment without cloud dependencies, see the [`docker` branch](https://github.com/alexdni/squiggly/tree/docker).

Features:
- All-in-one container (Next.js + Python + PostgreSQL)
- No internet required
- Local file storage
- Session-based authentication

---

## Contributing

Contributions are welcome! Please open an issue or pull request.

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- Built with [MNE-Python](https://mne.tools/) for EEG signal processing
- UI components from [shadcn/ui](https://ui.shadcn.com/)
- Designed for clinical neurophysiologists and researchers
