# Change: Replace the Python worker with a server-side Node pipeline (biofeedback-core) and client-rendered visuals

## Why
All analysis runs in a Python/Flask worker (MNE, scipy, coroICA, matplotlib), so the product carries a second runtime, a
gunicorn process, a pip build stage, and a synchronous `/analyze` HTTP hop. The DivergentNeuro `biofeedback-core`
0.33.0-beta.1 artifact pipeline (channel QC, ASR, extended-Infomax ICA with IC classification, blink regression,
adaptive epoch rejection) is plain TypeScript, so it runs in Node inside the Next.js server. It is proprietary and must
not be exposed: squiggly is a **public** repository and the package ships unminified with source maps. Running it on the
server keeps the implementation private while still removing Python entirely.

## What Changes
- **Artifact rejection on the server (Node)**: a server-only module (`lib/server/eeg/`, guarded by `server-only`) runs
  the artifact pipeline from the private `@divergentneuro/biofeedback-core` package in a `worker_threads` worker so the
  Next.js event loop stays free. The recording is read from Storage by the server (it is already uploaded at upload time).
  No biofeedback-core code, types or source maps are sent to the browser.
- **Private dependency handling**: install from GitHub Packages with `NODE_AUTH_TOKEN` (Vercel env secret / Docker
  BuildKit secret). `.npmrc` references the variable only. The package is listed in
  `experimental.serverComponentsExternalPackages` so it is never bundled into client chunks. A build check fails if
  any `.next/static` asset contains biofeedback-core identifiers.
- **Artifact settings**: replace the ICA-method dropdown (SOBI/FastICA/Infomax/Picard) and SOBI thresholds with
  biofeedback-core profiles (`full`, `conservative`, `aggressive`, `rejectionOnly`, `legacy`) plus knobs (rejection µV
  ceiling, ASR k, line frequency). Manual mode is kept. **BREAKING**: SOBI/FastICA/Picard are removed.
- **Feature extraction in TS on the server** (`lib/server/eeg/features/*`), keeping the `extract_features.py` result
  shape: band power, 1/f-corrected peak alpha, ratios, asymmetry, wPLI connectivity + network metrics, LZC, risk patterns,
  and downsampled spectrogram data.
- **Execution model**: `POST /api/analyses/[id]/process` validates the request, marks the analysis `processing`, and runs
  the job after the response (`waitUntil` on Vercel, an in-process queue in Docker). The client keeps polling as today.
  The process route gets `maxDuration: 300`.
- **Visuals rendered client-side** from the results JSON (Canvas/SVG/chart.js): band topomap grid, LZC and PAF
  topomaps, connectivity head graphs, network-metric bars, spectrograms. No PNGs for new analyses. The rendering code
  contains no proprietary logic.
- **Cleaned-file export** generated server-side in the original format (EDF/BDF/CSV) and stored at
  `visuals/{analysis_id}/cleaned_raw.{ext}` (the existing location), with the correct content-type.
- **TheraQ**: port `theraq_metrics.py` + `theraq_analyze.py` to `lib/server/theraq/*`, run through the same job runner,
  and persist to `project_analyses`. Remove the missing `submitTheraqJob` import.
- **Legacy compatibility**: analyses whose `results.visuals` holds PNG URLs keep rendering those images.
- **Remove Python**: delete `api/workers/`, `lib/worker-client.ts`, `WORKER_*` env/config and mock mode, Python stages in
  the `Dockerfile`/supervisord, `railway.json`, `nixpacks.toml`, root `Procfile`; update docs and `openspec/project.md`.

## Impact
- Affected specs: `server-artifact-rejection`, `ts-feature-extraction`, `client-visualization`, `python-removal` (new).
  Supersedes the Python preprocessing and visualization requirements in the unarchived `add-eeg-eoec-diagnostics`,
  `add-bdf-support-increase-upload-limit` and `add-theraq-phase-comparison` changes.
- Affected code: `app/api/analyses/[id]/process/route.ts`, `app/api/projects/[id]/theraq-analysis/**`,
  `components/AnalysisDetailsClient.tsx`, `components/ComparisonView.tsx`, `components/TheraQReportClient.tsx`, new
  `components/visuals/*`, new `lib/server/eeg/**`, `lib/constants.ts`, `lib/config.ts`, `types/database.ts`,
  `next.config.js`, `vercel.json`, `.npmrc`, `package.json`, `Dockerfile`, `docker/supervisor/supervisord.conf`, deploy
  configs.
- **Build access**: public cloners without a GitHub Packages token can no longer build the analysis engine. The README
  documents this, and the build fails with a clear message when the package is missing.
- Numerical results differ from the Python output. `processing_metadata.engine` records the engine, and comparisons
  across engines show a warning.
