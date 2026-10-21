# Change: Detected EEG events (artifacts named and labeled)

## Why
Analysts and students want to see which artifacts were in a recording, where, and what the
cleaning did about each one, instead of only "epoch rejected". biofeedback-core 0.34.0-beta.0
adds an event-detection pass (S6) that names what the cleaning stages handled and detects
blinks, eye flutter, lateral eye movements, muscle, chewing, electrode pops, movement, and
cardiac and line-noise contamination. Design: biofeedback-core
`docs/superpowers/specs/2026-10-20-eeg-event-detection-design.md` (section 8.4 covers this app).

## What Changes
- Upgrade `@divergentneuro/biofeedback-core` to `0.34.0-beta.0`.
- The analysis job enables event detection in **labels-only** mode (`exclude: false`): events
  are detected and stored but S6 adds no exclusions, so metrics are unchanged until the
  detector thresholds are validated on the TUAR corpus. Applies to every artifact mode.
- The job passes the un-notched EEG (before `removeMains`) and, when its rate and length match
  the EEG, the ECG lead as event inputs, plus the analyst's dismissed event ids.
- Results: `results.events` (detected events) and `results.event_detection` (coverage per
  detector with skip reasons, counts, dismissal stats).
- Review decisions: Confirm/Dismiss per event, stored in `analyses.config.event_reviews`
  (`{ [eventId]: 'confirmed' | 'dismissed' }`) through `PUT /api/analyses/[id]/event-reviews`
  (same edit permission as the analysis PATCH). Decisions carry over Re-Analyze because event
  ids are deterministic; dismissals are passed to the engine, which can then restore epochs
  that only dismissed rejections excluded.
- UI: a "Detected Events" card on the analysis page (counts by category, event list with
  evidence and Confirm/Dismiss, detectors not assessed and why; included in the PDF report),
  and read-only event bands in the EEG viewer, linked to the card.
- TheraQ jobs keep event detection off.

## Impact
- Affected code: `package.json`, `lib/server/eeg/pipeline.ts`, `lib/server/eeg/runAnalysisJob.ts`,
  `app/api/analyses/[id]/process/route.ts`, new `app/api/analyses/[id]/event-reviews/route.ts`,
  `lib/analysis-results.ts`, new `components/visuals/DetectedEvents*.tsx`,
  `components/eeg-viewer/*`, `components/AnalysisDetailsClient.tsx`.
- No database migration. Existing analyses show no events until Re-Analyze.
