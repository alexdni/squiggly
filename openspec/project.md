# Project Context

## Purpose

EEG EO/EC Diagnostics is an open-source web application for rapid, transparent analysis of 19-channel EEG recordings comparing Eyes-Open (EO) and Eyes-Closed (EC) states. The platform computes within-subject comparative biomarkers across amplitude, coherence, complexity (LZC), and asymmetry domains, with ICA-based artifact removal and heuristic risk flagging for neurophysiological patterns (ADHD-like, anxiety-like, depression-like, sleep dysregulation, hyper-arousal). The tool is designed for educational and research use only, explicitly non-diagnostic.

**Key Goals:**
- Rapid upload→clean→analyze→visualize→report workflow (<5 minutes end-to-end)
- Transparent EO/EC comparative analysis without normative database dependency
- Reproducible artifact removal with traceable ICA component tagging
- Exportable results (JSON + PDF) for offline analysis and record-keeping

## Tech Stack

**Frontend:**
- Next.js 14+ (App Router, React Server Components)
- TypeScript (strict mode)
- Tailwind CSS (custom neuro theme with accessible color palettes)
- Plotly.js (interactive charts: APF, ratios, reactivity)
- WebGL canvas (spectrograms)

**Backend:**
- Next.js API Routes (orchestration layer)
- Python 3.11+ serverless functions (Vercel runtime)
- Supabase (Postgres, Storage, Auth, Queue)

**Python Libraries:**
- MNE (EEG processing, ICA, topomaps)
- NumPy, SciPy (signal processing, filtering, PSD, coherence)
- pandas (data manipulation)
- antropy (Lempel-Ziv Complexity)
- scikit-learn (ICA, utilities)
- matplotlib, Pillow (PNG generation)
- ReportLab or WeasyPrint (PDF export)

**Tooling:**
- OpenSpec (spec-driven development)
- Claude Code 4.5 (AI-assisted implementation)
- Vitest (TypeScript unit tests)
- pytest (Python unit tests)
- Playwright (E2E tests)
- Sentry (error tracking)
- Vercel (deployment)

## Project Conventions

### Code Style

**TypeScript:**
- ESLint with Airbnb config + TypeScript plugin
- Prettier (2-space indents, 100-char line length, single quotes)
- Naming: PascalCase for components, camelCase for functions/variables, SCREAMING_SNAKE_CASE for constants
- Prefer functional components with hooks over class components
- Explicit return types for all exported functions

**Python:**
- Black formatter (88-char line length)
- isort for import ordering
- Type hints for all function signatures (PEP 484)
- Naming: snake_case for functions/variables, PascalCase for classes
- Docstrings for all public functions (Google style)

**File Organization:**
- Frontend: `/app` (Next.js App Router pages), `/components` (reusable UI), `/lib` (utilities)
- Backend: `/api/workers` (Python serverless functions), `/api/routes` (Next.js API routes)
- Tests: `/__tests__` (TypeScript), `/tests` (Python), `/e2e` (Playwright)

### Architecture Patterns

**Serverless Python Workers:**
- Each major processing step (preprocess, extract_features, generate_visuals, evaluate_rules) is a separate serverless function
- Workers are stateless; intermediate data is stored in Supabase Storage or DB JSONB columns
- Jobs are orchestrated via Supabase Queue with retry logic (3 attempts, exponential backoff)

**Data Flow:**
1. Client uploads EDF → Supabase Storage
2. API route validates montage → inserts `recordings` row → enqueues `analyses` job
3. Python workers pull from queue → process → persist results to Storage + DB
4. Client polls `GET /api/analyses/:id` for status → fetches results when complete

**Storage Strategy:**
- Large binary files (EDFs, PNGs) → Supabase Storage with project-scoped buckets
- Structured features (PSD, coherence, LZC, etc.) → Postgres JSONB columns
- Visual assets pre-rendered server-side to ensure consistency in PDF exports

**Access Control:**
- Row-level security (RLS) in Supabase for project-scoped data
- Role-based access: Owner (full access), Editor (can upload/analyze), Viewer (read-only)
- All API routes verify project membership via middleware

### Testing Strategy

**Unit Tests:**
- TypeScript: Vitest for utilities, API route logic, UI components (>70% coverage target)
- Python: pytest for preprocessing, feature extraction, rule evaluation (>80% coverage target)
- Critical validations: PSD sums to 1.0, ICA reduces artifact power without over-suppressing signal

**Integration Tests:**
- Full pipeline tests on synthetic EDF data (generated with known artifacts)
- API route tests with valid/invalid payloads
- Verify database state, storage objects, and queue jobs after each operation

**E2E Tests:**
- Playwright scenarios: upload EDF → wait for analysis → verify visuals load → export PDF
- Cross-browser testing (Chrome, Firefox, Safari, Edge)
- Accessibility testing (WCAG 2.1 AA compliance via axe-core)

**Load Testing:**
- Simulate 50 concurrent uploads, verify <10s latency
- Verify queue handles backlog without dropping jobs

### Git Workflow

**Branching:**
- `main` branch → production (protected, requires PR + CI pass)
- Feature branches: `feature/[change-id]` (e.g., `feature/add-eeg-eoec-diagnostics`)
- Hotfix branches: `hotfix/[issue-number]` (merged directly to main after review)

**Commit Conventions:**
- Conventional Commits format: `type(scope): description`
- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
- Example: `feat(upload): add EO/EC annotation parsing`

**PR Process:**
1. Create PR from feature branch → `main`
2. Require at least 1 approval (if team >1)
3. CI must pass (linting, tests, build)
4. Squash and merge (keep history clean)

**OpenSpec Workflow:**
1. Create change proposal in `openspec/changes/[change-id]/`
2. Implement tasks sequentially, updating `tasks.md` with `[x]` as completed
3. After deployment, archive change: `openspec archive [change-id]` and update `openspec/specs/` to reflect new truth

## Domain Context

**EEG Fundamentals:**
- 10-20 International System: standardized electrode placement (19 channels in this project)
- Linked-ears (LE) reference: average of mastoid electrodes (A1, A2) as reference
- Eyes-Open (EO) vs Eyes-Closed (EC): EC typically shows higher posterior alpha power; EO shows alpha suppression (blocking)
- Frequency bands: delta (1-4 Hz), theta (4-8 Hz), alpha (8-12 Hz), beta (12-30 Hz), gamma (30-45 Hz)

**Common Artifacts:**
- Blink/EOG: frontal spikes from eye blinks, high kurtosis, delta/theta dominant
- Heartbeat/ECG: periodic ~1 Hz, broad scalp distribution
- Jaw-clench/EMG: high-beta/gamma power, temporal dominance
- Motion: transient broadband spikes, step-like changes

**Clinical Context (Educational Only):**
- Elevated theta/beta ratio (frontal) is associated with ADHD in research literature (not diagnostic)
- Elevated hi-beta, reduced alpha blocking are research markers for anxiety
- Reduced right frontal alpha (FAA < 0) is associated with depression in EEG literature
- Elevated slow-wave (delta/theta) during wakefulness suggests sleep dysregulation
- High beta/low alpha suggests hyper-arousal

**Disclaimer:** This tool does NOT diagnose conditions. Heuristic flags are educational pattern detectors based on published research, not validated clinical instruments.

## Important Constraints

**Technical:**
- Supabase free tier limits: 500MB storage, 2GB bandwidth/month (monitor usage)
- Vercel free tier limits: 100GB bandwidth, 100 hours serverless execution/month
- Vercel function timeout: 10s (Hobby), 60s (Pro), 900s (Enterprise) → require Pro or higher for long EDFs
- EEG file size limit: 200MB (configurable; supports EDF, BDF, and CSV formats)
- Python serverless payload limit: 250MB (sufficient for 10-min EDF ~5MB compressed)

**Regulatory:**
- **Not a medical device:** Explicitly disclaim clinical use in UI, PDF, Terms of Service
- HIPAA compliance not required (users responsible for de-identifying data before upload)
- GDPR compliance: provide data export (JSON) and deletion (soft-delete 30-day retention)

**Scientific:**
- No normative z-scores in v1 (requires normative DB licensing or IRB-approved cohort)
- ICA heuristics have ~85% precision (not as accurate as supervised ICLabel); acceptable for research
- Percentile-based rules are within-subject only (less sensitive than population norms)

**Business:**
- Open-source (MIT License)
- No monetization in v1 (hobby project or grant-funded)
- Future: potential SaaS tiers for batch processing, custom rules, multi-session comparisons

## External Dependencies

**Supabase Services:**
- Postgres (database)
- Storage (EDF files, visual assets, exports)
- Auth (Google OAuth provider)
- Queue (job orchestration)

**Third-Party APIs:**
- Google OAuth (user authentication)

**Python Libraries:**
- MNE: BSD-3-Clause license, maintained by MNE-Python community
- antropy: BSD-3-Clause, maintained by Raphael Vallat
- SciPy, NumPy, pandas, scikit-learn: BSD/MIT licenses, stable

**Frontend Libraries:**
- Plotly.js: MIT license
- Tailwind CSS: MIT license

**Monitoring/Logging:**
- Sentry (error tracking, free tier 5k events/month)
- Vercel Analytics (included in Pro tier)

## Decision Log

### Resolved Open Questions (from design.md):

1. **APF detection method:** Center-of-gravity (COG) in 8-12 Hz range (configurable in v1.1 to polynomial fit)
2. **Regional aggregates:** Mean (not median) across channels per region
3. **Coherence hyper/hypo thresholds:** Within-subject percentiles (p90/p10)
4. **EDF file size limit:** 50MB for v1 (can increase to 100MB based on storage costs)
5. **Project sharing roles:** Three roles (Owner, Editor, Viewer)
6. **QC auto-rejection threshold:** 30% with warning (configurable via job config)

### Future Considerations (v1.1+):

- PLI/wPLI coherence metrics (more robust to volume conduction)
- ASR (Artifact Subspace Reconstruction) as hybrid toggle with ICA
- Batch comparison across sessions (new `comparisons` table)
- Multiscale LZC/MSE (multiscale entropy)
- Per-network summaries (DMN, ECN, SN)
- 32-channel support (expand montage validation)
- Alternative references (average reference, Laplacian)
