# Implementation Tasks

## 1. Project Setup & Infrastructure
- [x] 1.1 Initialize Next.js 14+ project with App Router and TypeScript
- [x] 1.2 Configure Tailwind CSS with custom color palette for neuro theme
- [x] 1.3 Set up Supabase project (create organization, enable Auth, Storage, Queue)
- [x] 1.4 Create database schema: `projects`, `recordings`, `analyses`, `export_logs` tables
- [x] 1.5 Set up Supabase Storage buckets: `recordings` (private), `visuals` (private), `exports` (private)
- [x] 1.6 Configure Google OAuth provider in Supabase Auth
- [x] 1.7 Create Vercel project and link to GitHub repository
- [x] 1.8 Set up environment variables (.env.local) for Supabase keys and API URLs
- [x] 1.9 Initialize Python serverless function directory structure (`/api/workers/`)
- [x] 1.10 Create `requirements.txt` for Python dependencies (MNE, NumPy, SciPy, pandas, antropy, matplotlib, Pillow)

## 2. Authentication & Authorization
- [x] 2.1 Implement Google OAuth login flow with Supabase Auth client
- [x] 2.2 Create protected route middleware for authenticated pages
- [x] 2.3 Build role-based access control (RBAC) utilities for Owner/Collaborator/Viewer roles
- [x] 2.4 Implement project membership table and API routes (`POST /api/projects/:id/members`)
- [x] 2.5 Create UI for project sharing and role management
- [x] 2.6 Write unit tests for RBAC logic (verify access control edge cases)

## 3. Upload System
- [x] 3.1 Create upload UI component with drag-and-drop and progress bar
- [x] 3.2 Implement client-side file validation (extension, size <50MB, basic EDF header check)
- [x] 3.3 Build API route `POST /api/upload/init` for signed URL generation
- [x] 3.4 Implement server-side montage validation (Python function: check 19 channels, 10-20 labels, LE reference)
- [x] 3.5 Create EO/EC labeling UI (annotation detection + manual range input fallback)
- [x] 3.6 Build API route `POST /api/recordings` to persist metadata and enqueue analysis job
- [x] 3.7 Implement duplicate detection logic (filename + size + timestamp heuristic)
- [x] 3.8 Add soft-delete lifecycle policy for deleted recordings (30-day retention)
- [x] 3.9 Write integration test: upload valid EDF → verify storage + DB entry
- [x] 3.10 Write integration test: upload invalid montage → verify rejection with correct error message

## 4. Preprocessing Pipeline (Python Worker)
- [x] 4.1 Create Python worker entry point (`/api/workers/preprocess.py`) triggered by Supabase Queue
- [x] 4.2 Implement EDF loading with MNE (`mne.io.read_raw_edf`)
- [ ] 4.3 Build resampling function (target 250 Hz with anti-aliasing)
- [ ] 4.4 Implement configurable filtering (high-pass, low-pass, notch using `mne.filter`)
- [ ] 4.5 Create bad channel detection module (flatline, variance, correlation checks)
- [ ] 4.6 Implement ICA decomposition (FastICA and Infomax options via scikit-learn or MNE)
- [ ] 4.7 Build artifact component labeling heuristics (blink, ECG, EMG, motion detection functions)
- [ ] 4.8 Create auto-rejection logic with configurable confidence threshold
- [ ] 4.9 Implement epoching (2s windows, 50% overlap) and epoch-level artifact rejection (peak-to-peak, z-score, autocorr)
- [ ] 4.10 Build EO/EC segmentation logic (annotation parsing + manual range support)
- [ ] 4.11 Generate QC report data structure (channels dropped, % rejected epochs, ICA components with tags)
- [ ] 4.12 Compute pre/post-ICA power comparison (delta/alpha at Fp1/Fp2/O1/O2)
- [ ] 4.13 Persist preprocessed epoch data (NumPy arrays) to temporary storage for feature extraction
- [ ] 4.14 Write unit tests: validate PSD sums to 1.0, check ICA reduces blink power at Fp1/Fp2
- [ ] 4.15 Write integration test: full preprocessing pipeline on synthetic EDF with injected artifacts

## 5. Feature Extraction (Python Worker)
- [x] 5.1 Create feature extraction worker (`/api/workers/extract_features.py`)
- [x] 5.2 Implement PSD computation (Welch method) for absolute and relative power per channel/band/condition
- [x] 5.3 Build regional aggregation function (mean power per F/C/P/O/T regions)
- [x] 5.4 Implement band ratio calculations (θ/β, θ/α, slowing index at specified sites)
- [ ] 5.5 Create APF detection function (center-of-gravity method in 8-12 Hz range for posterior channels)
- [ ] 5.6 Implement alpha blocking calculation (EC→EO suppression percentage)
- [x] 5.7 Build SMR power extraction (12-15 Hz at C3/C4/Cz) - via band power extraction
- [ ] 5.8 Implement reactivity metrics (absolute delta and percent change EC→EO per band/site)
- [x] 5.9 Create coherence computation function (magnitude-squared coherence for predefined 12 pairs per band)
- [ ] 5.10 Implement hyper/hypo coherence flagging (p90/p10 thresholds)
- [ ] 5.11 Build LZC computation wrapper (antropy library, binary median-threshold per channel)
- [ ] 5.12 Implement LZC delta and anterior-posterior gradient calculations
- [x] 5.13 Create PAI calculation function (Left-Right asymmetry for homologous pairs)
- [x] 5.14 Implement FAA calculation (log(alpha_F4) - log(alpha_F3) for EC)
- [ ] 5.15 Build anterior-posterior alpha gradient function
- [x] 5.16 Persist all features to `analyses.results` JSONB column
- [ ] 5.17 Write unit tests: PSD sum validation, APF detection stability, coherence symmetry
- [ ] 5.18 Write integration test: extract features from preprocessed synthetic data, validate output schema

## 6. Visualization Generation (Python Worker)
- [x] 6.1 Create visualization worker (`/api/workers/generate_visuals.py`)
- [x] 6.2 Implement topomap rendering using MNE (`mne.viz.plot_topomap`) for each band × condition (EO/EC/Delta)
- [x] 6.3 Build consistent color scale logic (global min/max across EO+EC for same band)
- [ ] 6.4 Generate LZC and PAI topomaps with appropriate color maps (diverging for PAI)
- [x] 6.5 Implement spectrogram generation (per-channel and regional using `scipy.signal.spectrogram` or CWT)
- [ ] 6.6 Create coherence matrix visualization (12×12 heatmap with colorbar)
- [ ] 6.7 Build interhemispheric coherence bar chart with EO/EC grouped bars
- [ ] 6.8 Add hyper/hypo badge annotations to coherence visuals
- [ ] 6.9 Implement theta/beta ratio bar chart (Fz/Cz/F3/F4 with p90 reference line)
- [ ] 6.10 Create alpha blocking circular gauge visualization
- [x] 6.11 Build APF scatter plot (per channel, EO vs EC with connecting lines)
- [ ] 6.12 Generate QC dashboard visuals (pie chart for artifact %, table for ICA components, pre/post-ICA line chart)
- [x] 6.13 Compress all PNGs with pngquant (reduce file size while maintaining quality)
- [x] 6.14 Upload visual assets to Supabase Storage and persist URLs to `analyses.results.visuals`
- [ ] 6.15 Write integration test: generate visuals from sample features, verify PNG file sizes <500KB each

## 7. Rule Engine
- [ ] 7.1 Create rule engine module (`/api/workers/evaluate_rules.py`)
- [ ] 7.2 Implement percentile calculation utility (p10/p50/p90 across feature distributions)
- [ ] 7.3 Build configurable threshold loader (read from job config, apply defaults)
- [ ] 7.4 Implement rule evaluation framework (any/optional condition logic with trace logging)
- [ ] 7.5 Create ADHD-like rule definition and evaluation function
- [ ] 7.6 Create anxiety-like rule definition and evaluation function
- [ ] 7.7 Create depression-like rule definition and evaluation function
- [ ] 7.8 Create sleep-dysregulation-like rule definition and evaluation function
- [ ] 7.9 Create hyper-arousal-like rule definition and evaluation function
- [ ] 7.10 Persist rule results to `analyses.results.risks` with level and trace
- [ ] 7.11 Write unit tests: verify percentile calculation accuracy, test each rule with edge cases
- [ ] 7.12 Write integration test: evaluate all rules on sample feature set, validate output structure

## 8. Frontend - Analysis Dashboard
- [ ] 8.1 Create layout component for analysis results page (`/app/analyses/[id]/page.tsx`)
- [ ] 8.2 Build status polling component (poll `GET /api/analyses/:id` every 2s until complete)
- [ ] 8.3 Implement band selector dropdown (delta/theta/alpha1/alpha2/SMR/beta2/hi-beta/low-gamma)
- [ ] 8.4 Create condition toggle (EO/EC/Delta radio buttons)
- [ ] 8.5 Build topomap display component (show PNG with tooltips via Plotly overlay)
- [ ] 8.6 Implement spectrogram display with channel selector
- [ ] 8.7 Create coherence matrix display component with band selector
- [ ] 8.8 Build ratio and reactivity panels (theta/beta bars, alpha blocking gauge, APF scatter using Plotly)
- [ ] 8.9 Implement QC dashboard component (channels dropped, artifact %, ICA components table)
- [ ] 8.10 Create risk assessment panel (5 pattern cards with level/color, expandable trace)
- [ ] 8.11 Add prominent disclaimer banner ("Educational/research use only. Not for clinical diagnosis.")
- [ ] 8.12 Implement responsive layout (mobile-friendly stacking, no horizontal scroll <768px)
- [ ] 8.13 Add keyboard navigation support for all interactive controls
- [ ] 8.14 Write Playwright E2E test: upload EDF → wait for completion → verify visuals load

## 9. Export Functionality
- [ ] 9.1 Create PDF generation worker (`/api/workers/generate_pdf.py`) using ReportLab or WeasyPrint
- [ ] 9.2 Build PDF template with cover page, QC summary, topomaps, coherence matrices, risk panel
- [ ] 9.3 Add disclaimer footer to all PDF pages
- [ ] 9.4 Implement JSON export endpoint (`GET /api/analyses/:id/export/json`) with schema validation
- [ ] 9.5 Create individual PNG export endpoint (`GET /api/analyses/:id/export/png?visual_id=...`)
- [ ] 9.6 Build batch PNG export (ZIP archive generation)
- [ ] 9.7 Implement export access control middleware (verify project membership)
- [ ] 9.8 Create export event logging (persist to `export_logs` table)
- [ ] 9.9 Build export history UI component on recording details page
- [ ] 9.10 Add export configuration options (toggles for raw data tables, visual URLs, band subset)
- [ ] 9.11 Implement retry logic with exponential backoff (3 retries for transient failures)
- [ ] 9.12 Write integration test: request PDF export → verify file size >1MB, contains all sections

## 10. API Routes
- [ ] 10.1 Implement `POST /api/upload/init` (signed URL generation)
- [ ] 10.2 Implement `POST /api/recordings` (metadata persistence, job enqueue)
- [ ] 10.3 Implement `POST /api/analyses` (trigger analysis job)
- [ ] 10.4 Implement `GET /api/analyses/:id` (status and results retrieval)
- [ ] 10.5 Implement `GET /api/analyses/:id/results` (full feature JSON)
- [ ] 10.6 Implement `GET /api/analyses/:id/export/pdf` (PDF download)
- [ ] 10.7 Implement `GET /api/analyses/:id/export/json` (JSON download)
- [ ] 10.8 Implement `GET /api/analyses/:id/export/png` (individual PNG download)
- [ ] 10.9 Add rate limiting middleware (max 10 uploads/hour per user, 50 export requests/hour)
- [ ] 10.10 Write API integration tests using Vitest (test all endpoints with valid/invalid payloads)

## 11. Job Queue & Orchestration
- [ ] 11.1 Configure Supabase Queue with retry policy (3 retries, exponential backoff)
- [ ] 11.2 Create job orchestration function (chain preprocessing → feature extraction → visualization → rules)
- [ ] 11.3 Implement job status updates (update `analyses.status` at each stage: pending/processing/completed/failed)
- [ ] 11.4 Build error handling and failure logging (capture stack traces, persist to `analyses.error_log`)
- [ ] 11.5 Add timeout handling (cancel jobs exceeding 10 min on free tier, 15 min on Pro)
- [ ] 11.6 Implement job cancellation endpoint (`DELETE /api/analyses/:id`) for user-initiated cancels
- [ ] 11.7 Write integration test: enqueue job → verify status transitions → confirm completion

## 12. Testing & Quality Assurance
- [ ] 12.1 Create synthetic EDF generator script (inject known artifacts: blinks, heartbeat, EMG)
- [ ] 12.2 Generate test dataset: 5 synthetic EDFs with varied artifact types and power distributions
- [ ] 12.3 Run full pipeline on test dataset, manually validate outputs (visuals, QC, rules)
- [ ] 12.4 Achieve >80% code coverage for Python workers (pytest with coverage plugin)
- [ ] 12.5 Achieve >70% code coverage for TypeScript frontend/API (Vitest)
- [ ] 12.6 Run Playwright E2E test suite (upload → analyze → export workflow)
- [ ] 12.7 Perform accessibility audit (Lighthouse, axe-core): target WCAG 2.1 AA compliance
- [ ] 12.8 Conduct cross-browser testing (Chrome, Firefox, Safari, Edge)
- [ ] 12.9 Load test API routes (simulate 50 concurrent uploads, verify <10s latency)
- [ ] 12.10 Security audit: check for SQL injection, XSS, CSRF vulnerabilities (OWASP Top 10)

## 13. Documentation & Deployment
- [ ] 13.1 Write README.md with project overview, setup instructions, and usage guide
- [ ] 13.2 Create API documentation (OpenAPI/Swagger spec for all endpoints)
- [ ] 13.3 Document job config JSON schema with examples
- [ ] 13.4 Write user guide for EO/EC labeling and montage requirements (Markdown + screenshots)
- [ ] 13.5 Create troubleshooting guide (common errors, solutions, contact info)
- [ ] 13.6 Set up Sentry for error tracking (frontend + backend)
- [ ] 13.7 Configure Vercel deployment settings (enable Python runtime, set timeout limits)
- [ ] 13.8 Deploy to production (main branch → Vercel, Supabase production project)
- [ ] 13.9 Seed production database with demo project and sample recordings
- [ ] 13.10 Perform smoke test on production: upload → analyze → export → verify

## 14. Post-Launch Monitoring
- [ ] 14.1 Set up monitoring dashboard (Vercel Analytics, Supabase logs)
- [ ] 14.2 Configure alerts for critical errors (Sentry thresholds, Slack integration)
- [ ] 14.3 Monitor storage costs (Supabase Storage usage, set alerts for >80% free tier)
- [ ] 14.4 Collect user feedback (in-app feedback form, GitHub Issues)
- [ ] 14.5 Plan v1.1 roadmap items (PLI/wPLI, ASR toggle, batch comparison)

---

## Dependencies & Parallelizable Work

**Parallel Tracks:**
- Track A (Frontend): Tasks 2, 8 (can start after 1.1-1.8)
- Track B (Python Workers): Tasks 4, 5, 6, 7 (can start after 1.9-1.10)
- Track C (API Routes): Task 10 (depends on 3, 4, 5, 6, 7 being >50% complete)
- Track D (Export): Task 9 (depends on 6, 7 complete)

**Critical Path:**
1 → 3 → 4 → 5 → 6 → 7 → 9 → 10 → 11 → 12 → 13 → 14

**Estimated Timeline:**
- Weeks 1-2: Project setup, auth, upload UI
- Weeks 3-5: Preprocessing, feature extraction, visualization workers
- Week 6: Rule engine, frontend dashboard
- Week 7: Export functionality, API routes
- Week 8: Testing, QA, documentation
- Week 9: Deployment, monitoring, post-launch fixes
