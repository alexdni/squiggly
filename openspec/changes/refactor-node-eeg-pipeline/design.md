# Design: Server-side Node EEG pipeline

## Context
- The analysis engine (`@divergentneuro/biofeedback-core`) is proprietary. squiggly depends only on its documented entry
  point (run the artifact pipeline on a channel-major µV recording with a profile/config; get back the cleaned
  recording, keep/reject masks, annotations and a QC report). Its internals are deliberately not described here.
- A full-profile run on a 20 min / 19 ch recording takes tens of seconds of CPU and a few hundred MB, synchronously,
  so it must run off the request thread.
- squiggly is public on GitHub, so nothing from the engine may be committed or shipped to browsers.
- Deployments: Vercel (Fluid Compute, Node 24, default 300 s max duration, 4.5 MB body limit) and a single Docker image
  (Next.js server, Postgres, local storage, supervisord).

## Decisions
1. **Confidentiality boundary**: proprietary code lives only under `lib/server/eeg/` and `lib/server/theraq/`. Each
   entry module begins with `import 'server-only'`. `next.config.js` sets
   `experimental.serverComponentsExternalPackages: ['@divergentneuro/biofeedback-core']`, so the package is
   `require`d from `node_modules` at runtime instead of being bundled. `scripts/check-client-bundle.mjs` runs after
   `next build`, derives marker identifiers from the installed package at check time (so the public repo never lists
   them), and fails the build if browser assets contain them or any source map.
2. **Dependency**: `@divergentneuro/biofeedback-core@0.33.0-beta.1` from `npm.pkg.github.com`. `.npmrc` contains
   `@divergentneuro:registry=https://npm.pkg.github.com` and `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}`.
   On Vercel the token is a sensitive env var available at build time. Docker uses
   `RUN --mount=type=secret,id=npm_token` so the token never lands in an image layer.
3. **Execution**:
   - `lib/server/eeg/jobRunner.ts` runs jobs in a `worker_threads` worker (`lib/server/eeg/worker.ts`), so the 30 s CPU
     burst does not block other requests. Concurrency is 1 per process, with a FIFO queue.
   - `/process` responds `202` after setting `status=processing`, then runs the job:
     - Vercel: `waitUntil()` from `@vercel/functions`, with `maxDuration: 300` on that route only.
     - Docker: the same promise, kept alive by the long-running server.
   - The job writes `completed`/`failed` itself. Polling stays as it is.
   - Analyses stuck in `processing` for more than 10 min are shown as failed with a retry button.
   - If worker threads turn out to be unsupported in the Vercel bundle, fall back to running inline in the function
     (the request is already detached).
4. **Pipeline flow (in the worker)**:
   1. Download the file from Storage (Supabase or local).
   2. Parse it: EDF/BDF/CSV via shared parsers moved to `lib/eeg-io/` (isomorphic, non-proprietary).
   3. Standardize labels with the alias map from `preprocess.py` and select 10-20/10-10 EEG channels.
   4. Run the engine's artifact pipeline with the profile config.
   5. Re-reference to the average of the channels that survived QC.
   6. Crop the EO/EC segments.
   7. Build 2 s epochs: an epoch is kept only if all of its samples lie in data the pipeline kept and no
      manual artifact overlaps it.
   8. Extract features.
   9. Compute spectrogram summaries (about 1 s × 1 Hz, 0.5–45 Hz, Fp1/Fz/Cz/Pz/O1).
   10. Export the cleaned file to Storage.
   11. Write the results row, merging `ai_interpretation`.
5. **DSP**: a non-exported numerics module is needed for features, so `lib/server/eeg/dsp/` holds Welch, Butterworth
   SOS/filtfilt, FFT/Hilbert and STFT, with scipy-parity tests. A follow-up is to export these from biofeedback-core and
   delete the copies.
6. **Parity fixtures**: before Python is deleted, a one-off script runs the current `extract_features.py` and
   `theraq_metrics.py` on synthetic epochs and commits the JSON outputs. The TS tests assert tolerances against them.
7. **Results schema**: a zod schema in `lib/analysis-results.ts` (shared with the client as types only) replaces the
   stale `AnalysisResults`. It adds `spectrograms` and `processing_metadata.engine`. `visuals` remains, for legacy URLs
   only.
8. **Visuals**: `components/visuals/*`:
   - Canvas IDW topomap with head outline and colorbar (following DivergenceWebapp's `topoRender.ts`)
   - SVG connectivity head graph
   - chart.js network bars
   - Canvas spectrogram heatmap
   - a `LegacyOrLive` wrapper that shows `<img>` when `results.visuals[key]` is a URL

## Risks / Trade-offs
- Server CPU and memory on Vercel: about 200 MB peak for 20 min recordings. Long BDF files (up to 200 MB) can exceed
  this. Mitigation: decode only selected EEG channels as Float32, set function memory to 3 GB on `/process`, and fail
  fast with a clear error above a duration cap (default 60 min).
- `waitUntil` work is bounded by `maxDuration`. Jobs that exceed it are left `processing`, and the stale-processing
  guard resolves them.
- Public contributors cannot build without the token. This is accepted, and documented.
- Component labels come from the engine's classifier, not ICLabel. This is noted in the QC panel.

## Migration
Existing `analyses` rows are unchanged, and legacy PNG URLs keep rendering. The only schema work is the existing TheraQ
migration, mirrored into `scripts/schema-docker.sql`.
