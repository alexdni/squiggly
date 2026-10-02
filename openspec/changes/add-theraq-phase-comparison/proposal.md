# Change: Add TheraQ Four-Phase Comparison Analysis

## Why

Today an `analysis` in Squiggly is scoped to a **single recording** (`analyses.recording_id` is `NOT NULL`) and compares only the Eyes-Open vs Eyes-Closed segments *within that one file*. The Divergence "TheraQ" assessment instead derives its clinical-style biomarkers by comparing **four separate recording phases** of the same subject — EO1 (eyes-open baseline), EC (eyes-closed rest), EO2 (eyes-open re-test), and TASK (eyes-open under cognitive load). The most informative TheraQ metrics are *cross-phase* (e.g. alpha reactivity EC→EO1, alpha flexibility EO1→EO2, task-induced beta/TBR shift), which the current per-recording model cannot express.

This change adds a **project-level, four-phase analysis** that reuses Squiggly's existing clean-data pipeline (filter → ICA/manual artifact rejection → epoching) to produce one amplitude spectrum per phase, then computes the same comparative metrics and dysregulation indices that TheraQ produces in the Divergence webapp.

## What Changes

- **Phase labeling on recordings**: recordings can be tagged with a TheraQ phase role (`EO1`, `EC`, `EO2`, `TASK`) so the four uploaded parts of a project can be identified as the four phases. **BREAKING**: adds a nullable `phase` column to `recordings` (non-breaking to existing rows; existing single-file EO/EC analyses are untouched).
- **New project-scoped analysis type**: a TheraQ analysis is created against a **project** (not a single recording) and references the four phase recordings. Introduced via a new `project_analyses` table rather than overloading `analyses` (which mandates a single `recording_id`).
- **Eligibility gate**: a TheraQ analysis can only be created when the project has exactly four recordings covering all four phase roles, each passing montage validation (O1, Cz, F3, F4 present).
- **Per-phase cleaned spectra**: a new Python worker step runs the existing preprocessing per phase recording and produces a mean amplitude spectrum (1 Hz resolution) per channel per phase, on **cleaned** data.
- **Cross-phase metric engine**: a declarative metric/norm/dysregulation-index engine (ported from the Divergence `getAssessmentMetrics` definitions) computes the TheraQ metrics and the four dysregulation indices (Emotional, Cognitive, Stress/Trauma, Sleep) with 0–10 scoring.
- **Results storage + API + UI**: results persist to `project_analyses.results` (JSONB); a new API route creates/polls the analysis; a new frontend view renders metric bars (green/yellow/red norm ranges) and dysregulation gauges, consistent with the existing analysis UI.
- **Non-diagnostic disclaimer**: results carry the same educational/research-only, non-diagnostic framing as the rest of the platform.

## Impact

- **Affected specs**: new capability `theraq-phase-comparison` (no existing specs to modify; `openspec/specs/` is currently empty).
- **Affected code**:
  - DB: `supabase/schema.sql` (add `recordings.phase`, new `project_analyses` table + RLS + indexes)
  - Frontend types/constants: `lib/constants.ts` (TheraQ band edges, phase enum, metric/norm definitions), `lib/types`
  - API routes: `app/api/recordings/[id]` (set phase), new `app/api/projects/[id]/theraq-analysis` (create + get)
  - Python workers: `api/workers/extract_features.py` (per-phase amplitude spectrum), new `api/workers/theraq_metrics.py` (metric engine + indices), `api/workers/analyze_eeg.py` / `server.py` (new job type), `api/workers/generate_visuals.py` (optional per-phase spectrum + gauge images)
  - Frontend UI: new `components/TheraQReportClient.tsx` and a project-level entry point
- **Out of scope**: changing the existing per-recording EO/EC analysis; normative-database comparisons; PDF export of the TheraQ report (can be a follow-up).
