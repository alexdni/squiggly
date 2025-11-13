# Squiggly - EEG Assessment Platform

Rapid, transparent, open-source tool for analyzing 19-channel EEG recordings with support for Eyes-Open (EO) and Eyes-Closed (EC) states.

## Features

- **Upload System**: EDF file upload (19-channel 10-20 montage, LE reference) with validation and storage management
- **Preprocessing Pipeline**: Python-based signal processing with configurable filtering, ICA artifact removal, and epoching
- **Multi-Domain Analysis**:
  - Amplitude/Power: PSD, band ratios, APF, alpha blocking
  - Coherence: Magnitude-squared coherence with hyper/hypo flagging
  - Complexity: Lempel-Ziv Complexity (LZC) per channel
  - Asymmetry: Power Asymmetry Index (PAI), Frontal Alpha Asymmetry (FAA)
- **Interactive Visualizations**: Topomaps, spectrograms, coherence matrices, ratio panels
- **Heuristic Risk Assessment**: Pattern flagging for ADHD-like, anxiety-like, depression-like, sleep dysregulation, and hyper-arousal patterns
- **Export**: PDF reports and JSON data export
- **Authentication**: Google OAuth with project-level collaboration

## Architecture

- **Frontend (Vercel)**: Next.js 14 with App Router, deployed on Vercel
- **Database**: Supabase PostgreSQL with Row Level Security (RLS)
- **Storage**: Supabase Storage for EDF files and exports
- **Auth**: Supabase Auth with Google OAuth
- **Python Worker (Railway)**: Dedicated Python container for EEG signal processing
  - Flask/Gunicorn HTTP server
  - MNE-Python for signal processing
  - Auto-deploy from GitHub
  - Environment-based configuration

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes + Railway Python Worker
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage
- **Auth**: Supabase Auth (Google OAuth)
- **Signal Processing**: MNE, NumPy, SciPy, antropy, scikit-learn
- **Visualization**: Plotly, matplotlib
- **Deployment**: Vercel (frontend) + Railway (Python worker)

## Prerequisites

- Node.js 18+ and npm
- Python 3.11+ (for local development)
- Supabase account
- Google Cloud project (for OAuth)
- Railway account (for Python worker deployment)
- Vercel account (for frontend deployment)

## Setup Instructions

### 1. Clone and Install Dependencies

\`\`\`bash
git clone <repository-url>
cd squiggly
npm install
\`\`\`

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Run the schema SQL:
   - Navigate to SQL Editor in Supabase dashboard
   - Copy and paste contents of `supabase/schema.sql`
   - Execute the script
3. Create Storage buckets:
   - Go to Storage in Supabase dashboard
   - Create three private buckets: `recordings`, `visuals`, `exports`
4. Enable Google OAuth:
   - Go to Authentication > Providers
   - Enable Google provider
   - Add your Google OAuth credentials

### 3. Configure Environment Variables

Copy `.env.example` to `.env.local`:

\`\`\`bash
cp .env.example .env.local
\`\`\`

Fill in your Supabase credentials:

\`\`\`env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
\`\`\`

### 4. Install Python Dependencies

\`\`\`bash
cd api/workers
pip install -r requirements.txt
cd ../..
\`\`\`

### 5. Run Development Server

\`\`\`bash
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

\`\`\`
squiggly/
├── app/                    # Next.js App Router pages
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Home page
│   └── analyses/          # Analysis dashboard pages
├── api/                   # API routes and workers
│   └── workers/           # Python signal processing workers
│       ├── preprocess.py  # Preprocessing pipeline
│       ├── extract_features.py  # Feature extraction
│       ├── generate_visuals.py  # Visualization generation
│       ├── evaluate_rules.py    # Rule engine
│       └── generate_pdf.py      # PDF export
├── components/            # React components
├── lib/                   # Utility functions
│   ├── supabase.ts       # Supabase client
│   └── constants.ts      # Application constants
├── types/                 # TypeScript type definitions
│   └── database.ts       # Database schema types
├── supabase/             # Supabase configuration
│   └── schema.sql        # Database schema
└── public/               # Static assets
\`\`\`

## Usage

### 1. Upload EEG Recording

- Upload a 19-channel EDF file with 10-20 montage and linked-ears reference
- Label EO and EC segments (auto-detected from annotations if available)

### 2. Analysis

- System automatically:
  - Preprocesses data (filtering, ICA artifact removal)
  - Extracts features across all domains
  - Generates visualizations
  - Evaluates risk patterns

### 3. Review Results

- Explore interactive dashboard with:
  - Topomaps per band and condition
  - Spectrograms per channel
  - Coherence matrices
  - Ratio charts and metrics
  - Quality control panel
  - Risk assessment flags

### 4. Export

- Download PDF report with visuals and assessment
- Export raw JSON data for further analysis

## Deployment

### Deploy Frontend to Vercel

1. Push your code to GitHub
2. Import project in Vercel dashboard
3. Set environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `WORKER_MODE=http`
   - `WORKER_SERVICE_URL` (Railway URL after next step)
4. Deploy

### Deploy Python Worker to Railway

1. Create new project in Railway dashboard
2. Connect to your GitHub repository
3. Select `api/workers` as root directory
4. Set environment variables:
   - `WORKER_AUTH_TOKEN` (generate a secure random token)
   - `PORT` (automatically set by Railway)
5. Railway will auto-detect `Procfile` and deploy with Gunicorn
6. Copy the generated Railway URL and add it as `WORKER_SERVICE_URL` in Vercel

### Environment Variables

**Vercel (Next.js Frontend)**:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
WORKER_MODE=http
WORKER_SERVICE_URL=https://your-railway-app.railway.app
WORKER_AUTH_TOKEN=your-secure-token
```

**Railway (Python Worker)**:
```env
WORKER_AUTH_TOKEN=your-secure-token
PORT=8080  # Automatically set by Railway
```

## Important Disclaimers

**This EEG assessment platform is for educational and research use only. It is NOT for medical use and should NOT be used for clinical decision-making.**

- Heuristic risk flags are based on within-subject percentile thresholds, not normative data
- Results should be interpreted by qualified professionals only
- No clinical claims or diagnostic labels are provided

## Contributing

Contributions are welcome! Please see CONTRIBUTING.md for guidelines.

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions, please open a GitHub issue.

## Acknowledgments

- Built with MNE-Python for EEG signal processing
- Inspired by open-source QEEG research tools
- Designed for clinical neurophysiologists and researchers

## Roadmap

### v1.1 (Planned)
- Phase-Lag Index (PLI) and weighted PLI (wPLI) coherence metrics
- Artifact Subspace Reconstruction (ASR) toggle
- Batch analysis comparison
- CSV export option

### v1.2 (Future)
- Multiscale entropy (MSE)
- Support for 32-channel montages
- Manual ICA component review UI
- Normative database integration (optional)
