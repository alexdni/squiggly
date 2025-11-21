# Design: Squiggly - The EEG EO/EC Assessment Platform

## Context

This platform enables rapid, reproducible EEG analysis for clinicians and researchers without requiring proprietary software or normative databases. The core scientific requirement is to compare Eyes-Open (EO) vs Eyes-Closed (EC) states within a single subject across multiple neurophysiological domains, with transparent artifact removal and interpretable heuristic risk flags.

**Constraints:**
- Must handle 19-channel 10-20 montage, linked-ears (LE) reference
- Processing time target: <5 minutes for 10-minute EDF (end-to-end)
- Budget: Open-source, serverless-friendly stack (Vercel + Supabase free/hobby tiers for MVP)
- Privacy: All data private by default, project-level sharing only
- No clinical claims: Explicitly non-diagnostic, educational/research only

**Stakeholders:**
- Clinical neurophysiologists (primary users)
- QEEG researchers (data export consumers)
- Open-source contributors (future extensibility)

## Goals / Non-Goals

**Goals:**
- Rapid upload → clean → analyze → visualize → report workflow (<5 min end-to-end)
- Transparent EO/EC comparative biomarkers without normative DB dependency
- Reproducible artifact removal with traceable ICA component tagging
- Exportable results (JSON + PDF) for offline analysis and record-keeping
- Modular capability design to support future extensions (PLI, MSE, 32-ch)

**Non-Goals:**
- Clinical diagnosis or decision support (heuristics are educational flags only)
- Normative z-score comparisons (v1 is within-subject only; v1.1+ may add cohort comparison)
- Real-time streaming or neurofeedback
- Support for non-standard montages, <19 or >19 channels (v1), or non-LE references
- Mobile app (web-only for v1)

## Decisions

### Architecture Pattern: Serverless Python Workers + Next.js Frontend

**Decision:** Use Next.js API Routes as orchestration layer with serverless Python functions for signal processing.

**Rationale:**
- Next.js App Router provides type-safe API routes, server components, and React client state management in a unified framework
- Python ecosystem (MNE, SciPy, antropy) is the de-facto standard for EEG signal processing; rewriting in JS/TS is not viable
- Vercel serverless functions support Python runtime (up to 250MB payload, 10-min timeout on Pro; sufficient for 10-min EDF ~5MB)
- Supabase Queue enables async job processing without dedicated worker infrastructure

**Alternatives Considered:**
- **Full Python stack (Flask/FastAPI + React SPA):** Rejected due to added deployment complexity (need separate services) and less cohesive DX
- **JS-only with WebAssembly (scipy.js, DSP.js):** Rejected due to immaturity of JS scientific stack and lack of MNE equivalent
- **Microservices (separate upload/preprocessing/viz services):** Over-engineered for MVP; adds network latency and operational overhead

**Trade-offs:**
- (+) Unified deployment target (Vercel), simpler auth/storage integration
- (+) Best-of-breed tools for each domain (React for UI, Python for DSP)
- (−) Cold start latency for Python functions (~2-3s); mitigated by Supabase Queue batch processing
- (−) Payload size limits require chunking for large EDFs (>50MB); acceptable for 10-20 min recordings

---

### Data Flow: Storage-First with Queue-Based Processing

**Decision:** EDF → Supabase Storage → Job enqueued → Python worker pulls from Storage → Persist results to Storage + DB.

**Flow:**
1. Client uploads EDF via signed URL to Supabase Storage bucket
2. API route validates montage/metadata, inserts `recordings` row, enqueues `analyses` job
3. Python worker (triggered by queue or polling) fetches EDF from Storage, processes, uploads visual assets (PNGs) to Storage, writes feature JSON to `analyses.results` column
4. Client polls `/api/analyses/:id` for status, fetches results when complete

**Rationale:**
- Decouples upload from processing (user gets instant feedback, processing runs async)
- Supabase Storage handles large binary files; Postgres JSONB handles structured features
- Queue ensures at-least-once processing with retry logic
- Visual assets (topos, spectrograms, matrices) stored as PNGs for PDF export and web display (no client-side re-rendering of large datasets)

**Alternatives Considered:**
- **Inline processing in API route:** Rejected due to Vercel timeout limits (10 min max) and poor UX (blocking upload)
- **Store raw features in DB only, render visuals client-side:** Rejected due to large PSD/coherence matrices (>1MB JSON) and inconsistent client rendering
- **External message queue (RabbitMQ, Redis):** Over-engineered for MVP; Supabase Queue sufficient for <100 concurrent jobs

**Trade-offs:**
- (+) Scalable, non-blocking UX
- (+) Retry logic for transient failures (ICA convergence issues, network errors)
- (−) Eventual consistency (user must poll for results); acceptable for analysis use case
- (−) Storage costs for visual assets; mitigated by PNG compression and lifecycle policies

---

### ICA Artifact Removal: Heuristic Labeling Without External Models

**Decision:** Use composite scoring of ICA components (topography, power spectrum, kurtosis, autocorrelation) to label artifacts (blink, ECG, EMG, motion) without external trained models.

**Heuristics:**
- **Blink/EOG:** Frontal (Fp1/Fp2/Fz) loadings >0.6, kurtosis >5, delta/theta power >80%, time-locked bursts
- **Heartbeat/ECG:** Periodic ~1-1.4 Hz, broad scalp with temporal peaks, low kurtosis
- **Jaw-clench/EMG:** High-beta/low-gamma power >70%, temporal (T7/T8) dominance >0.7
- **Motion:** Step transients (peak-to-peak >100µV), broadband spikes, low autocorrelation

**Rationale:**
- Avoids dependency on ICLabel (MATLAB/EEGLAB), which is not Python-native and requires trained model files
- Heuristics are interpretable and tunable per-project
- Sufficient accuracy for research/educational use (target: >85% precision on blinks/ECG, >70% on EMG/motion)
- Allows future addition of ASR (Artifact Subspace Reconstruction) as hybrid toggle in v1.1

**Alternatives Considered:**
- **ICLabel via MATLAB engine or pre-trained ONNX:** Rejected due to added complexity and licensing concerns
- **Manual component review UI:** Rejected for MVP (future v1.2 feature); reduces automation goal
- **Skip ICA, use only ASR:** Rejected because ASR is better for transient bursts, not periodic artifacts like blinks

**Trade-offs:**
- (+) No external model dependencies, fully reproducible
- (+) Interpretable criteria for QC review
- (−) Lower accuracy than supervised methods (~5-10% more false positives); acceptable for flagging components with confidence scores
- (−) Requires per-project threshold tuning; mitigated by exposing config in job params

---

### Band Definitions: 8 Configurable Bands

**Decision:** Default to 8 bands: δ(1-4), θ(4-8), α1(8-10), α2(10-12), SMR(12-15), β2(15-20), hi-β(20-30), low-γ(30-45).

**Rationale:**
- α1/α2 split captures lower/upper alpha differences (relevant for posterior alpha peak frequency)
- SMR (sensorimotor rhythm) is clinically relevant for C3/C4/Cz analysis
- Hi-β/low-γ distinction improves EMG artifact detection and anxiety-related power elevations
- Configurable via job config for custom research protocols

**Alternatives Considered:**
- **Classic 5 bands (δ/θ/α/β/γ):** Rejected due to loss of granularity in alpha and beta ranges
- **Custom per-user bands in UI:** Deferred to v1.1; MVP uses 8-band default with JSON override

---

### Coherence Computation: Magnitude-Squared Coherence, No Phase

**Decision:** Compute magnitude-squared coherence (Welch method) for predefined pairs; exclude phase-lag index (PLI) and weighted PLI (wPLI) in v1.

**Pairs:**
- Interhemispheric: Fp1-Fp2, F3-F4, C3-C4, P3-P4, O1-O2, T7-T8 (6 pairs)
- Long-range ipsilateral: F3-P3, F3-O1, F4-P4, F4-O2, Fz-Pz, Cz-Pz (6 pairs)
- Total: 12 default pairs per band (96 values for 8 bands)

**Rationale:**
- Magnitude-squared coherence is interpretable, widely used, and computationally efficient
- Predefined pairs reduce output size (19 channels → 171 possible pairs; 12 pairs → 96 values)
- Interhemispheric coherence is key for asymmetry/connectivity flags

**Alternatives Considered:**
- **All-pairs coherence (171):** Rejected due to storage/rendering complexity and reduced interpretability
- **PLI/wPLI in v1:** Deferred to v1.1; PLI is more robust to volume conduction but adds complexity

**Trade-offs:**
- (+) Fast computation, small output size, clear visualizations
- (−) Misses nuanced connectivity patterns detectable with PLI; acceptable for MVP risk flags

---

### Complexity Metric: Binary-Median LZC

**Decision:** Compute Lempel-Ziv Complexity (LZC) using binary median-thresholding baseline (from antropy library).

**Rationale:**
- LZC quantifies signal irregularity/complexity; useful for depression (↓ LZC), anxiety (↑ LZC frontal)
- Binary median threshold is simple, fast, and matches common QEEG literature
- antropy library provides validated implementation

**Alternatives Considered:**
- **Multiscale LZC or MSE (multiscale entropy):** Deferred to v1.2; more robust but slower and harder to interpret
- **Quantized LZC (4-level):** Offered as optional config param; default is binary

**Trade-offs:**
- (+) Single-number complexity score per channel/epoch, easy to visualize
- (−) Sensitive to epoch length and filter settings; mitigated by fixed 2s epochs and consistent preprocessing

---

### Rule Engine: Percentile Thresholds, No Normative DB

**Decision:** Risk flags based on within-subject percentiles (p90, p10, median) across channels/pairs, not population norms.

**Example (ADHD-like):**
```yaml
adhd_like:
  any:
    - ratios.theta_beta.Fz > p90  # Subject's own 90th percentile across channels
    - smr.Cz < p10
  optional:
    - coherence.beta.frontoparietal < p10
```

**Rationale:**
- Avoids licensing/distribution of normative databases (e.g., NxLink, Neuroguide)
- Transparent, reproducible criteria without black-box scoring
- Educational flags, not diagnostic labels (explicit disclaimer in UI/PDF)

**Alternatives Considered:**
- **Normative z-scores:** Deferred to v1.1 (optional cohort upload feature); requires IRB approval for public DB
- **Machine learning classifier:** Rejected due to lack of labeled training data and interpretability requirements

**Trade-offs:**
- (+) No external DB dependencies, fully self-contained
- (+) Interpretable rules traceable to raw features
- (−) Less sensitive than population norms; acceptable for research/educational flags

---

### Visualization: Pre-Rendered PNGs + Interactive Plotly

**Decision:** Server-side PNG generation for topos/matrices/spectrograms using matplotlib, client-side Plotly for interactive overlays (APF chart, ratio panels).

**Rationale:**
- Pre-rendered PNGs ensure consistent appearance in PDF exports and reduce client bundle size
- Plotly provides interactive zoom/tooltip for time-series and scatter plots
- matplotlib (via MNE topomaps) produces publication-quality brainmaps with standard head model

**Alternatives Considered:**
- **All client-side Plotly:** Rejected due to large JSON payloads (PSD matrices >1MB) and inconsistent rendering
- **WebGL canvas for everything:** Rejected due to dev complexity and browser compatibility

**Trade-offs:**
- (+) Consistent PDF exports, fast page loads
- (−) Server-side rendering increases worker execution time (~10-15s for all visuals); acceptable within 5-min target

---

### Export: PDF + JSON

**Decision:** Generate PDF with summary visuals (topos, matrices, rules panel) + link to full JSON export.

**Rationale:**
- PDF is shareable, archivable, and familiar to clinicians
- JSON allows re-analysis, custom scripting, and future batch comparisons
- PNG assets reused from visualization step (no duplicate rendering)

**Alternatives Considered:**
- **Interactive HTML export:** Rejected due to complexity of bundling Plotly dependencies and large file sizes
- **CSV export:** Supplementary to JSON; deferred to v1.1 (simple feature flag)

---

## Risks / Trade-offs

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|----------|
| Vercel function timeout (>10 min for long EDFs) | Medium | High | Chunked processing: split epochs across multiple invocations; or upgrade to Pro tier (60s → 900s limit) |
| ICA convergence failures on noisy data | Medium | Medium | Fallback to non-ICA preprocessing with warning flag; expose max_iter param in config |
| Supabase Storage costs exceed free tier | Low | Low | Lifecycle policy: delete visual assets >90 days; compress PNGs with pngquant |
| Inconsistent EO/EC labeling in EDF annotations | High | High | Validate annotation labels against whitelist (`["EO", "EC", "eyes open", "eyes closed"]`); require manual range input if missing |
| False positive artifact removal (ICA removes alpha) | Medium | Medium | QC panel shows pre/post ICA power comparison; flag excessive alpha suppression (>30% posterior power drop) |
| Legal/compliance risk of misinterpreted risk flags | Medium | High | Prominent disclaimer in UI, PDF footer, and Terms of Service: "Not for clinical diagnosis. Educational/research use only." |

---

## Migration Plan

**Initial Deployment (v1.0):**
1. Deploy Next.js app to Vercel (main branch → production)
2. Initialize Supabase project: create tables, storage buckets, enable Google OAuth
3. Seed sample EDF files (synthetic or anonymized public datasets) for demo
4. Deploy Python worker as Vercel serverless function
5. Enable Supabase Queue with retry policy (3 retries, exponential backoff)

**Rollback Plan:**
- Feature flags for ICA, rule engine, and export (disable via env vars if critical bugs)
- Database migrations are forward-only (no schema changes in v1.0)
- Storage buckets retain 30-day soft delete (can recover accidentally deleted EDFs)

**v1.0 → v1.1 Upgrade Path:**
- Add PLI/wPLI coherence metrics (new columns in `analyses.results.coherence`)
- ASR toggle in job config (new `ica.asr_enabled` boolean)
- Batch comparison UI (new `comparisons` table)

---

---

### Project-Level Client Metadata Storage

**Decision:** Store client demographic and clinical metadata at the project level, not per-recording.

**Rationale:**
- Projects represent unique clients/subjects in this workflow
- Metadata (diagnosis, age, gender, interventions) applies to the entire client, not individual recordings
- Supports longitudinal analysis: multiple EO/EC recordings for the same client over time
- Age can be extracted from EDF headers (patient DOB) or manually entered
- Gender can be extracted from EDF headers or manually entered

**Schema Addition to `projects` table:**
```sql
ALTER TABLE projects ADD COLUMN client_metadata JSONB DEFAULT '{}'::jsonb;
-- Structure:
-- {
--   "diagnosis": "string",
--   "primary_issue": "string",
--   "secondary_issue": "string | null",
--   "gender": "male | female | other | unknown",
--   "age": number,
--   "interventions": ["string", ...]
-- }
```

**Alternatives Considered:**
- **Store metadata per recording:** Rejected due to redundancy and potential inconsistency across recordings for same client
- **Separate `clients` table:** Deferred to v1.1; MVP assumes 1 project = 1 client for simplicity

**Trade-offs:**
- (+) Simple data model for MVP
- (+) Metadata attached to project enables project-level comparative analysis
- (−) No support for multi-client projects; acceptable for v1

---

### EO→EC Comparative Analysis at Project Level

**Decision:** Provide a project-level comparison function that analyzes changes from EO→EC by comparing analysis summaries of recordings labeled as EO vs EC within the same project.

**Flow:**
1. User uploads multiple EDF files to a project, some labeled EO, some labeled EC
2. Each file is analyzed independently
3. Project dashboard includes "Compare EO→EC" view that:
   - Identifies recordings with EO vs EC condition labels
   - Computes deltas between aggregated features (e.g., alpha power change, coherence shifts)
   - Visualizes comparative metrics (side-by-side topomaps, difference maps, bar charts)

**Implementation:**
- Add `condition_type` enum field to `recordings` table: `'EO' | 'EC' | 'BOTH'` (default `'BOTH'` for files with both conditions)
- New API endpoint: `GET /api/projects/:id/compare` returns comparative analysis
- Frontend: New "Comparison" tab on project details page

**Rationale:**
- Many clinical workflows upload separate EO and EC files sequentially
- Enables within-subject longitudinal comparison (e.g., pre/post intervention)
- Leverages existing analysis summaries without re-processing raw data

**Alternatives Considered:**
- **Automatic pairing of EO/EC files:** Rejected due to ambiguity (which files should pair?); user can manually select files for comparison in v1.1
- **Real-time comparison during upload:** Rejected; asynchronous processing is more scalable

**Trade-offs:**
- (+) Flexible comparison selection (user picks which recordings to compare)
- (+) Works with existing analysis pipeline
- (−) Requires user to manually trigger comparison; acceptable for MVP

---

### Automatic Analysis Initiation on Upload

**Decision:** Automatically start analysis job immediately after upload completes, without requiring user to manually click "Analyze."

**Flow:**
1. User uploads EDF file and labels EO/EC segments
2. API route creates `recordings` entry and `analyses` entry with `status: 'pending'`
3. API route immediately calls analysis processing endpoint
4. Frontend shows "Analysis in progress..." animation on upload success page

**Rationale:**
- Reduces friction: users expect results immediately after upload
- Matches user mental model (upload → process → view results)
- Eliminates extra click required in previous design

**UI Changes:**
- Upload success page redirects to analysis details page with polling enabled
- Show animated spinner with message: "Analysis in progress... This may take up to 3 minutes."
- Poll `/api/analyses/:id` every 2 seconds until status is `'completed'` or `'failed'`

**Alternatives Considered:**
- **Manual analysis trigger:** Rejected; adds unnecessary friction
- **Background processing without user feedback:** Rejected; users need to know when results are ready

**Trade-offs:**
- (+) Seamless UX, no extra clicks
- (+) Clear progress feedback
- (−) User must wait on analysis details page; acceptable since analysis is <3 min

---

### Extended Timeout for Railway Backend

**Decision:** Increase backend analysis timeout from 60 seconds to 180 seconds (3 minutes) to accommodate Railway serverless function limits.

**Implementation:**
- Remove hardcoded 60-second timeout in worker client polling logic
- Set configurable timeout via environment variable: `ANALYSIS_TIMEOUT_MS=180000`
- Update frontend polling to continue for up to 3 minutes before showing timeout error
- Add server-side timeout handling: if analysis exceeds 180 seconds, mark as `failed` with timeout error message

**Rationale:**
- Railway serverless functions have longer cold start times than Vercel
- Complex ICA processing can take 90-120 seconds for 10-minute EEG files
- 3-minute timeout provides sufficient buffer while maintaining reasonable UX

**Configuration:**
```env
# .env.local
ANALYSIS_TIMEOUT_MS=180000  # 3 minutes
```

**Alternatives Considered:**
- **Keep 60-second timeout:** Rejected; insufficient for Railway backend
- **Increase to 5+ minutes:** Rejected; too long for acceptable UX

**Trade-offs:**
- (+) Accommodates Railway processing time
- (+) Configurable for different deployment environments
- (−) Longer wait time for users; mitigated by clear progress feedback

---

## Open Questions

1. **Alpha peak frequency (APF) detection method:** Use center-of-gravity or polynomial fit? (Default to COG for simplicity; make configurable)
2. **Regional aggregates:** Average vs median across channels per region? (Default to mean; expose in config)
3. **Coherence hyper/hypo thresholds:** p90/p10 vs fixed percentile across subjects? (Use within-subject percentiles for v1)
4. **EDF file size limit:** 50MB or 100MB? (Start with 50MB; upgrade based on user feedback)
5. **Project sharing granularity:** Role-based (viewer/editor/runner) or simpler (viewer/editor)? (Use 3-role system for flexibility)
6. **QC auto-rejection threshold:** Conservative (reject >20% epochs) or permissive (reject >40%)? (Default to 30% with warning; make configurable)
7. **Age extraction from EDF:** Use patient DOB from header (if available) or require manual entry? (Try auto-extract, fall back to manual)
8. **EO/EC comparison granularity:** Compare only latest EO vs latest EC, or allow user to select specific recordings? (v1: latest only; v1.1: user selection)

**Resolution Plan:** Document decisions in `project.md` after stakeholder review (if applicable) or default to conservative/simple options for MVP.
