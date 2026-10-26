# Change: Paroxysmal slowing detection

## Why
Squiggly's event model has clinical categories (`epileptiform`, `rhythmic-periodic`), but no detector
feeds them: only artifacts and mu are found. Paroxysmal slowing (bursts of delta or theta that stand
out from the background, such as FIRDA, TIRDA or focal polymorphic delta) is the most common
non-epileptiform abnormality an EEGer looks for. Band power averages it away. Analysts and the MCP
assistants should see each burst, where it is and what kind it is, and be able to confirm or dismiss
it.

## What Changes
- New detector `lib/server/eeg/features/slowing.ts`. It runs during analysis on the cleaned,
  average-referenced signal, after mu, and finds delta (1.5–4 Hz) and theta (4–7.5 Hz) bursts.
  Each burst is classed as rhythmic or polymorphic, and placed by its peak channel and spread.
- New event category `slowing`. Its patterns are `firda`, `oirda`, `tirda`, `irda`,
  `polymorphic-delta`, `rhythmic-theta` and `intermittent-theta`. Events are `noted`, `detector`,
  reviewable, and highlighted on every involved channel in the viewer. They change no metric.
- `results.paroxysmal_slowing`: per-condition summary. `event_detection` gains a
  `paroxysmal-slowing` coverage row and a `slowing` count.
- MCP: `slowing` is a clinical category (it goes in `clinical_flags`), and the guidance gives the
  clinical correlates of each pattern.
- The app-side detectors share `withAppDetectors` (it replaces `withMuDetection`).

## Impact
- Affected specs: new capability `paroxysmal-slowing-detection`.
- Affected code: `lib/server/eeg/features/slowing.ts`, `lib/server/eeg/pipeline.ts` (new
  `'slowing'` progress stage), `lib/analysis-results.ts`, `components/visuals/detected-events/format.ts`,
  `lib/server/mcp/{events,summary,guidance,relabel}.ts`.
- Existing analyses need Re-Analyze to get slowing events. Older `event_detection.counts` have no
  `slowing` key, and readers treat it as 0.
