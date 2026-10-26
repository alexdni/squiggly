# Change: Reliable EO/EC labels

## Why
- **Wrong table status.** The Recordings tab showed "Not labeled" for every single-condition file,
  because it required both an EO and an EC segment. That included files correctly labelled at upload
  ('… AGE 35 EO.edf').
- **Missed filenames.** Upload detection used `\beo\b` / `\bec\b`, which misses common names
  ('…AGE47EC.edf', 'EC_.edf'). Those files were stored unlabelled and analyzed as eyes open, so an
  eyes-closed file's graphs said "Eyes Open". Only the MCP layer corrected for it.
- **No editing.** Labels could not be edited.
- **Mismatched comparisons.** Comparisons took `eo || ec` from each side, so they could compare EO
  with EC silently.

## What Changes
- **Shared module.** `lib/eeg-condition.ts`:
  - parses EO/EC from filenames (a token with no letter either side, extension excluded);
  - reads, validates and stores labels;
  - says whether results match the labels.

  The upload route, process route, label editor, analysis view and MCP all use it.
- **Labels are the single source of truth.** The filename is read only at upload, and by a one-off
  backfill. The backfill labelled 106 unlabelled recordings whose names name the condition, and made
  `condition_type` follow the segments.
- **Editing.** `PATCH /api/recordings/[id]` accepts
  `labels: { eo: {start,end}|null, ec: {start,end}|null }`. It validates them: within the recording,
  at least 10 s, no overlap.
- **UI.**
  - The Recordings tab shows EO / EC / EO+EC / Not labeled, with Edit.
  - The analysis page has "Edit EO/EC labels".
  - Saving re-runs the analysis.
- **Analyses.**
  - Each analysis stores `results.segments`.
  - The analysis view warns when the labels changed since the run.
  - Results filed under the other condition (runs made before a recording was labelled) are read
    under the recording's own condition everywhere: the analysis page and API, comparisons and MCP
    (`lib/server/relabel.ts`).
- **Comparisons** use the same condition on both sides, and warn when the two recordings share none.
- **Removed:** the unused `POST /api/recordings/[id]/detect-segments`. It could not write under RLS
  and did not set `condition_type`.

## Impact
- Affected specs: new capability `recording-condition-labels`.
- Affected code: `lib/eeg-condition.ts`, `lib/server/relabel.ts` (moved from `lib/server/mcp`),
  `app/api/recordings/**`, `app/api/analyses/[id]/{route,process/route}.ts`, `app/analyses/[id]/page.tsx`,
  `app/api/projects/[id]/compare/route.ts`, `components/{ConditionLabelEditor,ProjectDetailsClient,AnalysisDetailsClient,ComparisonView}.tsx`,
  `lib/server/eeg/pipeline.ts`, `lib/server/mcp/sessions.ts`.
- Data: migration `label_eo_ec_from_filenames.sql`, applied 2026-10-25.
