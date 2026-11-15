## Context
The loader keeps the file's reference, the artifact pipeline cleans on it (`reference: 'source'`),
and `cleanEeg` then subtracts the average of the usable channels. `linkedEars` is already detected
(all labels `-LE`) and used only to restore linked ears for coherence. The viewer shows the raw file
on whatever reference it has.

## Goals / Non-Goals
- Goals: know and show the recorded reference; let the analyst choose the reference of the metrics;
  let the viewer switch montage instantly; never present a reference the data cannot support.
- Non-Goals: REST or other model-based references; re-tuning detectors per reference; per-reference
  interpretation thresholds; guessing the reference of unlabelled files from the signal.

## Decisions
- **Re-reference after cleaning, not before.** ASR/ICA thresholds were validated on source-referenced
  input; changing the input reference would change what gets rejected. Any reference that is a
  linear combination of the cleaned channels is exact after cleaning.
- **Linked ears = the source data, when the source is linked ears.** Average reference then
  as-recorded differ only by the common mode, which is already kept. `as_recorded` skips the
  re-reference entirely. For a recording declared (not labelled) linked ears, the same path applies.
- **Mixed `-LE` / `-A1` files (14)** are detected as linked ears but are not offered a linked-ears
  analysis. Converting the two `-A1` channels with the file's `A2-A1` channel was tested on four of
  them: the ear difference did not show up in those channels the way the labels imply, so the labels
  are not trusted enough to rewrite data.
- **Detectors and sLORETA stay on average.** They get the average-referenced data regardless of the
  setting. Alternative, re-tuning per reference, has no validation data.
- **Viewer montages are computed per visible window in the browser**, before the display filters
  (all are linear, so order does not matter). Average and Laplacian use the selected scalp channels
  only. Bipolar rows are not channels, so trace highlights and channel toggles apply to their first
  electrode.
- **Scrolling**: wheel `deltaX` (or `deltaY` with Shift) and drag map pixels to seconds through the
  x scale; updates are coalesced per animation frame. A drag shorter than 4 px is still a click, so
  band selection keeps working. Annotate mode keeps drag for drawing.
- **Stored values**: `recordings.reference` holds what the labels say, one of `LE | A1 | A2 |
  ipsilateral | REF | AVG | CZ | CSD | bipolar | unknown`. What the analyst states ("Recorded as")
  is stored with the analysis settings (`preprocessing.recorded_reference`, default `auto`), not on
  the recording: the existing column is `'LE'` on every old row and cannot be told apart from a
  real declaration, and keeping it in the settings needs no migration and travels with the
  re-analysis that uses it.
- **Coherence keeps its own reference switch.** `connectivity.coherence` stays average-referenced
  whatever the setting, with linked ears and Laplacian beside it as before; wPLI follows the setting.

## Risks / Trade-offs
- Metrics on different references are not comparable → the reference is shown wherever numbers are,
  and the comparison view and MCP trend tools flag a mismatch.
- `as_recorded` on a single-ear or Cz reference produces lateralised or centrally-flattened maps →
  the option carries a one-line warning naming the detected reference.
- Wheel capture could trap page scrolling → only horizontal intent is consumed.

## Migration Plan
Additive: new config keys default to `average` / `auto`; old analyses read as average. No schema
change. `scripts/backfill-recording-reference.ts` reads file headers, writes `recordings.reference`
only, is a dry run unless `--apply` is passed, and is run by hand after review.
