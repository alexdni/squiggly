# Change: Add EEG EO/EC Diagnostics Platform

## Why

Clinicians and researchers need a rapid, transparent, open-source tool to analyze 19-channel EEG recordings comparing Eyes-Open (EO) and Eyes-Closed (EC) states. Current solutions are either proprietary, require normative databases, or lack comprehensive comparative biomarker analysis across amplitude, coherence, complexity, and asymmetry domains. This platform provides within-subject EO↔EC comparative analysis with ICA-based artifact removal and heuristic risk flagging for common neurophysiological patterns (ADHD-like, anxiety-like, depression-like, sleep dysregulation, hyper-arousal), without claiming clinical diagnosis.

## What Changes

This is a foundational change that introduces the complete EEG EO/EC Diagnostics platform:

- **Upload System**: EDF file upload (19-channel 10-20 montage, LE reference) with validation, storage management, and job queuing
- **Preprocessing Pipeline**: Python-based signal processing with configurable filtering (0.5-45 Hz), bad channel detection, ICA artifact removal (blinks, heartbeat, jaw-clench, motion), epoching, and EO/EC segmentation
- **Feature Extraction**: Multi-domain biomarker computation including:
  - Amplitude/Power: absolute/relative PSD, band ratios (θ/β, θ/α, slowing index), APF, alpha blocking, SMR, regional aggregates
  - Coherence: magnitude-squared coherence with interhemispheric and long-range pairs, hyper/hypo flagging
  - Complexity: Lempel-Ziv Complexity (LZC) per channel with EO/EC deltas
  - Asymmetry: Power Asymmetry Index (PAI), Frontal Alpha Asymmetry (FAA), anterior-posterior gradients
  - Reactivity: EC→EO change metrics per band/site
- **Visualization**: Interactive topo brainmaps (per band × condition), spectrograms (per-channel & regional), coherence matrices, LZC/asymmetry maps, ratio panels, APF charts, QC dashboard
- **Rule Engine**: Percentile-based heuristic risk assessment for 5 neurophysiological patterns with transparent criteria tracing
- **Export**: PDF reports with visuals + rules panel, JSON data export, PNG asset generation
- **Authentication & Authorization**: Google OAuth with role-based access (Owner, Collaborator) and project-level data privacy

## Impact

**Affected specs:**
- New: `upload`, `preprocessing`, `features`, `visualization`, `rules`, `export`

**Affected code:**
- Frontend: New Next.js App Router application with React, TypeScript, Tailwind, Plotly visualizations
- Backend: New Next.js API routes + Python worker functions
- Infrastructure: New Supabase project (Postgres, Storage, Auth, Queue)
- Dependencies: MNE, NumPy/SciPy, pandas, antropy, scikit-learn, Plotly, Tailwind

**Data Schema:**
- `recordings` table: metadata, file references, EO/EC labeling
- `analyses` table: job config, status, computed features, visual asset URLs
- `projects` table: ownership, sharing, collaboration roles
- Storage buckets: EDF files, visual assets (PNGs), exported PDFs/JSON

**Non-Goals:**
- Clinical diagnosis or decision support (explicitly non-diagnostic)
- Normative z-score comparisons (within-subject only)
- Real-time streaming analysis
- Support for non-10-20 montages or channels other than 19
- Alternative reference schemes beyond linked-ears (LE) in v1
