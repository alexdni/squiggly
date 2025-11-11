# Squiggly - EEG EO/EC Diagnostics Platform

Rapid, transparent, open-source tool for analyzing 19-channel EEG recordings comparing Eyes-Open (EO) and Eyes-Closed (EC) states.

## Features

- **Upload System**: EDF file upload (19-channel 10-20 montage, LE reference) with validation and storage management
- **Preprocessing Pipeline**: Python-based signal processing with configurable filtering, ICA artifact removal, and epoching
- **Multi-Domain Analysis**:
  - Amplitude/Power: PSD, band ratios, APF, alpha blocking
  - Coherence: Magnitude-squared coherence with hyper/hypo flagging
  - Complexity: Lempel-Ziv Complexity (LZC) per channel
  - Asymmetry: Power Asymmetry Index (PAI), Frontal Alpha Asymmetry (FAA)
- **Interactive Visualizations**: Topobrainmaps, spectrograms, coherence matrices, ratio panels
- **Heuristic Risk Assessment**: Pattern flagging for ADHD-like, anxiety-like, depression-like, sleep dysregulation, and hyper-arousal patterns
- **Export**: PDF reports and JSON data export
- **Authentication**: Google OAuth with project-level collaboration

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes + Python serverless functions
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage
- **Auth**: Supabase Auth (Google OAuth)
- **Signal Processing**: MNE, NumPy, SciPy, antropy, scikit-learn
- **Visualization**: Plotly, matplotlib

## Prerequisites

- Node.js 18+ and npm
- Python 3.9+
- Supabase account
- Google Cloud project (for OAuth)

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

## Important Disclaimers

**This platform is for educational and research use only. It is NOT a diagnostic tool and should NOT be used for clinical decision-making.**

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
