# Design: TheraQ Four-Phase Comparison Analysis

## Context

Divergence's TheraQ assessment compares four recording conditions of one subject and emits ~21 comparative metrics rolled into four dysregulation indices. Squiggly already has the hard part — a clean-data pipeline (Butterworth bandpass + notch, ICA/SOBI or manual artifact rejection, epoching, peak-to-peak rejection) producing MNE `Epochs`. What is missing is (a) a way to relate four recordings as the four phases, and (b) the cross-phase metric/index math. This change adds both while leaving the existing single-recording EO/EC analysis fully intact.

Canonical references in the Divergence codebases (for porting fidelity):
- `divergence-serverless/api/src/assessments/getAssessmentMetrics.mjs` — metric definitions, norm ranges, dysregulation-index definitions, scoring engine.
- `divergence-serverless/api/python/generateSpectra.py` — FFT amplitude-spectrum generation per condition.
- `DivergenceWebapp/src/views/AssessmentReport/*` — display (MetricBar norm bands, DysregulationIndex gauge).

## Goals / Non-Goals

**Goals**
- Reuse Squiggly's existing preprocessing to produce one cleaned amplitude spectrum per phase.
- Reproduce TheraQ metric values and dysregulation index scores faithfully (same band edges, same norm ranges, same 0–10 scoring).
- Keep the existing per-recording analysis path unchanged.

**Non-Goals**
- No normative/age-matched database (TheraQ is within-subject, and so is this).
- No PDF export in this change (follow-up).
- No change to artifact-rejection algorithms; this consumes their cleaned output.

## Key Decisions

### Decision 1 — Project-level analysis via a new `project_analyses` table (not overloading `analyses`)
`analyses.recording_id` is `NOT NULL` and one-to-one with a recording. A TheraQ analysis spans four recordings. Rather than make `recording_id` nullable and bolt a phase map onto the existing table (which would weaken the per-recording invariant and complicate RLS and the existing UI), introduce a sibling table:

```sql
CREATE TABLE IF NOT EXISTS project_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'theraq',            -- future-proof for other project-level analyses
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed')),
  phase_map JSONB NOT NULL,                        -- {"EO1": <rec_id>, "EC": <rec_id>, "EO2": <rec_id>, "TASK": <rec_id>}
  config JSONB NOT NULL,
  results JSONB,
  error_log TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_project_analyses_project ON project_analyses(project_id);
CREATE INDEX idx_project_analyses_status  ON project_analyses(status);
```
RLS mirrors the existing project-scoped policies (membership via `project_members`).

**Alternative considered**: nullable `recording_id` + `phase_map` on `analyses`. Rejected — erodes the single-recording invariant the existing UI and queries rely on.

### Decision 2 — Phase identity stored on `recordings.phase`
Add `phase TEXT CHECK (phase IN ('EO1','EC','EO2','TASK'))` (nullable) to `recordings`. The four "parts" of a project are just four recordings, each tagged with its phase. This reuses the existing upload flow; the only new surface is a phase setter (defaulted by filename heuristic, e.g. `*_EO1*`, `*_EC*`, `*_EO2*`, `*_TASK*`, user-overridable).

**Alternative considered**: derive phases from within-file annotations (as Divergence does from a single multi-segment recording). Rejected for v1 — the user's model is explicitly four *separately uploaded parts*, which is simpler and matches Squiggly's one-file-per-recording storage.

### Decision 3 — Phase→condition mapping aligns with TheraQ's internal condition keys
| Project phase | TheraQ condition key | Meaning |
|---|---|---|
| `EO1` | `eo1` | eyes-open baseline |
| `EC`  | `ec`  | eyes-closed rest |
| `EO2` | `eo2` | eyes-open re-test |
| `TASK`| `eoload` | eyes-open under cognitive load |

### Decision 4 — TheraQ band edges defined separately from Squiggly's `DEFAULT_BANDS`
Squiggly's bands (`alpha1` 8–10, `alpha2` 10–12, etc.) differ from TheraQ's operative edges. To reproduce values, define TheraQ-specific edges used only by this engine:
`theta = [3.5, 7.5]`, `alpha = [7.5, 12.5]`, `beta = [15.5, 25.5]`, plus alpha-peak search window `[7, 13]`. Spectrum resolution: 1 Hz bins, 1–45 Hz, mean amplitude per band = mean of the bins within the band.

### Decision 5 — Declarative metric engine ported as data, not rewritten ad hoc
Port the metric/norm/index definitions as a Python data structure mirroring `getAssessmentMetrics.mjs`. Each metric is `{name, electrode, band, condition(s), op, display, norms:[{range:[lo,hi], colour}]}`. A small evaluator computes `mean_amplitude`, `quotient`, `difference`, `peak_frequency`, `percent`. This keeps fidelity auditable against the source and makes the norm tables reviewable.

## Metric & Index Formulas (port targets)

Per-phase, per-channel mean amplitude `A(cond, ch, band) = mean(spectrum[cond][ch][bins∈band])`.

- **Alpha Shift** (EC reactivity): `(A(ec,ch,alpha) − A(eo1,ch,alpha)) / A(eo1,ch,alpha) × 100` — at O1 and Cz.
- **Alpha Flexibility** (EO1↔EO2): `(A(eo2,ch,alpha) − A(eo1,ch,alpha)) / A(eo1,ch,alpha) × 100`.
- **Peak Alpha** (EC): `domain[argmax(spectrum[ec][ch][7..13Hz])]` at O1.
- **TBR** per phase: `A(cond,ch,theta) / A(cond,ch,beta)` at O1, Cz, F3, F4.
- **TBR Shift / Beta Shift Task**: difference of the above between phases (e.g. Cz TASK vs EO).
- **Theta/Alpha**, **Theta/Low-Beta** ratios at frontal/central sites.
- **Symmetry** (EC, F3 vs F4): theta, alpha, beta, frontal-TBR proportion.

**Dysregulation index scoring** (per index, over its metric subset):
```
score = Σ_metrics colour_weight(value within its norm range)
        where green=0.0, yellow=0.5, red=1.0
final  = round((score / n_metrics) × 10, 1)      # 0..10, higher = more dysregulation
band   = green (<3.33) | yellow (3.33–6.66) | red (>6.66)
```
Four indices and their metric subsets are copied verbatim from the Divergence definitions: Emotional Dysregulation, Cognitive Performance, Potential Stress/Trauma Markers, Sleep Dysregulation. If a value falls outside all norm ranges, extend the outermost range to classify it (matches Divergence behavior).

## Data Flow

1. User uploads 4 files to a project; each recording gets a `phase` (heuristic + override).
2. User triggers a TheraQ analysis on the project → API verifies all four phases present + montage-valid → inserts `project_analyses` row (`pending`) with `phase_map` → enqueues job.
3. Python worker, for each phase: load recording → run existing `preprocess` (clean) → compute mean amplitude spectrum per channel → assemble `spectra[cond]`.
4. `theraq_metrics.py` evaluates all metrics + four indices against the four-phase spectra.
5. Persist `{spectra, metrics, indices, qc_per_phase, disclaimer}` to `project_analyses.results`; status → `completed`.
6. Frontend polls and renders metric bars + dysregulation gauges.

## Results JSON shape (sketch)
```json
{
  "phases": { "EO1": {...qc}, "EC": {...}, "EO2": {...}, "TASK": {...} },
  "spectra": { "eo1": { "O1": [..45 bins..] }, "ec": {...}, "eo2": {...}, "eoload": {...} },
  "metrics": [ { "name": "Alpha Shift O1 (EO EC)", "value": 62.4, "display": "percent",
                 "colour": "yellow", "norms": [...], "tags": ["posterior"] } ],
  "indices": { "emotional_dysregulation": { "score": 4.5, "colour": "yellow", "metrics": [...] },
               "cognitive_performance": {...}, "stress_trauma": {...}, "sleep_dysregulation": {...} },
  "disclaimer": "Educational/research use only — non-diagnostic.",
  "processing_metadata": { "theraq_bands": {...}, "mne_version": "..." }
}
```

## Risks / Mitigations
- **Band-edge / scoring drift from source** → port norm tables as data and add a unit test that reproduces a known TheraQ vector within tolerance on a synthetic spectrum.
- **Phase mislabeling** → require explicit phase assignment before analysis; show the resolved phase→file mapping in the UI before running.
- **Insufficient clean epochs in a phase** (e.g. TASK heavily artifacted) → fail the analysis with a per-phase QC reason rather than silently producing skewed metrics (min clean-epoch threshold, mirroring existing pipeline).
- **Montage variance** (CSV/Flex devices lacking O1/Cz/F3/F4) → eligibility gate rejects with a clear message listing missing channels.

## Open Questions (proceeding with the recommended default unless told otherwise)
1. Phase assignment UX: auto-from-filename with manual override (recommended) vs. manual-only.
2. Whether TASK is strictly required, or an analysis can run with EO1/EC/EO2 only and skip task-dependent metrics (recommended: require all four for v1; partial mode is a follow-up).
