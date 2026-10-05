# Tasks: TheraQ Four-Phase Comparison Analysis

## 1. Data model & migrations
- [x] 1.1 Add nullable `phase` column to `recordings` (supabase + docker schema + migration)
- [x] 1.2 Add `project_analyses` table (id, project_id, kind, status, phase_map, config, results, error_log, timestamps) with indexes
- [x] 1.3 Add RLS policies for `project_analyses` mirroring project-membership policies (supabase schema + migration)
- [x] 1.4 Idempotent ALTER/CREATE in `scripts/schema-docker.sql` so existing Docker volumes auto-migrate on boot

## 2. Shared constants & types
- [x] 2.1 TheraQ band edges + phase enum + helpers in `lib/theraq.ts`
- [x] 2.2 Port metric/norm/index definitions verbatim from Divergence into `api/workers/theraq_definitions.json`
- [x] 2.3 TypeScript types (`ProjectAnalysis`, `TheraqMetricResult`, `TheraqIndexResult`, results shape) in `lib/theraq.ts`

## 3. Phase labeling (recordings)
- [x] 3.1 Filename-heuristic phase suggestion on upload (`detectTheraqPhase` in recordings POST)
- [x] 3.2 `PATCH /api/recordings/[id]` to set/override phase, rejecting duplicate phase within a project (409)
- [x] 3.3 UI control (phase-assignment table with dropdowns) in `TheraQReportClient`

## 4. Eligibility gate & analysis creation API
- [x] 4.1 `POST /api/projects/[id]/theraq-analysis`: verify all four phases present (422 with missing/duplicated)
- [x] 4.2 Insert `project_analyses` row (`pending`), mark `processing`, enqueue worker job (`submitTheraqJob`)
- [x] 4.3 `GET /api/projects/[id]/theraq-analysis` (list) and `/[analysisId]` (status + results), membership-scoped

## 5. Python worker: per-phase cleaned spectra
- [x] 5.1 `compute_amplitude_spectrum(epochs)` (1 Hz, 1–45 Hz) in `theraq_metrics.py`
- [x] 5.2 `analyze_theraq_project` runs existing `preprocess_eeg` per phase, assembles condition-keyed spectra
- [x] 5.3 Minimum clean-epoch threshold per phase → `failed` with per-phase reason

## 6. Python worker: metric & index engine
- [x] 6.1 `TheraqEngine` recursive evaluator (mean/sum amplitude, quotient, difference, peak frequency, percent)
- [x] 6.2 Norm-range colour assignment incl. outermost-range extension (`_adapt_norms`)
- [x] 6.3 Four dysregulation indices with 0–10 scoring and green/yellow/red banding
- [x] 6.4 Assemble results JSON and persist to `project_analyses` (local + supabase); set status `completed`

## 7. Frontend report
- [x] 7.1 `TheraQReportClient` metric bars with norm bands grouped by region tag
- [x] 7.2 Dysregulation index gauges (4 indices, 0–10) with colour banding
- [x] 7.3 Project-level TheraQ tab + create/poll flow + resolved phase→file mapping
- [x] 7.4 Non-diagnostic disclaimer on the report view

## 8. Optional visuals
- [ ] 8.1 Server-side per-phase amplitude-spectrum image — NOT NEEDED: rendered client-side in React
- [ ] 8.2 Server-side index gauge images — NOT NEEDED: rendered client-side in React

## 9. Tests
- [x] 9.1 Python: synthetic four-phase spectra reproduce metric vector + index scores (`test_theraq_metrics.py`)
- [x] 9.1b TS: `detectTheraqPhase` covers the four standard filenames (`lib/__tests__/theraq.test.ts`)
- [ ] 9.2 Python: insufficient-clean-epochs path — implemented in orchestrator; not unit-tested (needs MNE in CI)
- [ ] 9.3 API test: eligibility gate errors — not added (needs auth/db vitest mocking harness)
- [ ] 9.4 API test: membership-scoped access control — not added (same harness gap)
- [ ] 9.5 E2E (Playwright): upload 4 parts → run → render — not added (manual verification path documented)

## 10. Docs
- [x] 10.1 README TheraQ section: upload four phases, run, band edges, index definitions, non-diagnostic note
