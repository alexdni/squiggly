## 1. Dependency and confidentiality
- [ ] 1.1 (BLOCKED on NODE_AUTH_TOKEN: regenerate package-lock.json) Publish or confirm `@divergentneuro/biofeedback-core@0.33.0-beta.1` on GitHub Packages; add `.npmrc` (env-var token only) and the dependency
- [x] 1.2 `next.config.js`: `serverComponentsExternalPackages`; `server-only` guards; `scripts/check-client-bundle.mjs` wired into `build`
- [x] 1.3 Docker: BuildKit `npm_token` secret for `npm ci`; document `NODE_AUTH_TOKEN` for Vercel/local in README
- [x] 1.4 Generate Python parity fixtures (features + TheraQ) into `lib/server/eeg/__fixtures__/` before deleting Python

## 2. IO and DSP
- [x] 2.1 Move EDF/BDF/CSV parsers to isomorphic `lib/eeg-io/` (keep viewer working); add label standardization and aliases
- [x] 2.2 `lib/server/eeg/dsp/`: Welch, Butterworth SOS + filtfilt, FFT/Hilbert, STFT, with scipy-parity tests
- [x] 2.3 `lib/server/eeg/export/`: EDF, BDF and CSV writers with round-trip tests

## 3. Pipeline and job runner
- [x] 3.1 `lib/server/eeg/pipeline.ts`: profile/config mapping, manual mode, EO/EC crop, 2 s epoch mask, `rejected_epochs`, `qc_report`
- [x] 3.2 `worker.ts` (`worker_threads`) + `jobRunner.ts` (FIFO, concurrency 1, inline fallback); storage download and upload for Supabase and local modes
- [x] 3.3 Tests on synthetic recordings (blink/EMG/pop injection)

## 4. Features
- [x] 4.1 Band power, ratios, asymmetry
- [x] 4.2 1/f-corrected peak alpha
- [x] 4.3 wPLI (CSD + Hilbert) and network metrics
- [x] 4.4 LZC, risk patterns, spectrogram summaries
- [x] 4.5 Parity tests against the 1.4 fixtures

## 5. API and types
- [x] 5.1 `/process`: 202 plus `waitUntil`/background job, `maxDuration: 300` and memory override in `vercel.json`; stale-processing handling
- [x] 5.2 Remove `lib/worker-client.ts`, `WORKER_*` config and mock mode; fix `DEFAULT_PREPROCESSING_CONFIG` keys
- [x] 5.3 zod results schema in `lib/analysis-results.ts`; replace `AnalysisResults`; fix `computeComparison` (connectivity)

## 6. UI
- [x] 6.1 `AnalysisDetailsClient`: profiles + knobs + manual mode; status, failure and retry
- [x] 6.2 `components/visuals/*`: topomap grid, LZC/PAF topomaps, connectivity head, network bars, spectrogram, `LegacyOrLive`
- [x] 6.3 `ComparisonView` with live visuals, shared scales and the mixed-engine warning
- [x] 6.4 Cleaned-file download link (server-generated)

## 7. TheraQ
- [x] 7.1 Port `theraq_metrics.py` / `theraq_analyze.py` to `lib/server/theraq/` with tests ported from pytest
- [x] 7.2 Wire the theraq-analysis POST to the job runner; add recordings PATCH for phase; mount `TheraQReportClient`; add tables to `schema-docker.sql`

## 8. Remove Python and infra
- [x] 8.1 Delete `api/workers/`, root `Procfile`, `railway.json`, `nixpacks.toml`
- [x] 8.2 Dockerfile without Python stages; supervisord without python-worker; compose env cleanup
- [x] 8.3 Update README, DOCKER.md, deployment docs and `openspec/project.md`

## 9. Verification
- [x] 9.1 `npm run type-check`, `npm test`, `npm run build` (including the bundle check)
- [ ] 9.2 (partially done: `next start` local mode + Postgres e2e for BDF analysis, TheraQ, export, PATCH guards; Docker image build blocked on token) Docker local end to end: upload EDF, BDF and CSV → analyze → visuals → export → compare → AI interpretation
- [x] 9.3 Confirm in the browser's network/sources panel that no biofeedback-core code is served
- [ ] 9.4 (unit-tested via LegacyOrLive; not checked against a real Python-era row) Legacy analysis still renders PNGs
