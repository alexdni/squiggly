## 1. Detector
- [x] 1.1 `detectSlowing`: per-channel delta/theta envelope against the channel's own median (×3), with per-channel rejected epochs and artifact spans (eye, movement, pop, jump) excluded
- [x] 1.2 Bursts 1–20 s, trimmed to the peak channel's half-maximum; involved channels must form a contiguous field (at least 2 neighbours)
- [x] 1.3 Mimic rejection: frontal-pole/lateral-frontal-only bursts, steep Fp→F gradient, anti-phase homologous frontal/temporal sites (horizontal eye dipole)
- [x] 1.4 Stand-out gates: band share ≥ 0.5 of 1–30 Hz variance and 1–30 Hz RMS ≥ 2× the channel's median 1 s RMS
- [x] 1.5 Rhythmic vs polymorphic: ≥ 3 waves, period CV ≤ 0.2, amplitude CV ≤ 0.35, autocorrelation one period on ≥ 0.6
- [x] 1.6 Pattern from band, rhythm, peak region and spread; evidence includes alpha dropout (drowsiness hint)

## 2. Pipeline, results, review
- [x] 2.1 `'slowing'` stage after mu; `results.paroxysmal_slowing`; events appended with deterministic ids
- [x] 2.2 `withAppDetectors`: coverage rows, category counts and dismissed ids for mu and slowing
- [x] 2.3 UI: category label and colour, pattern names, evidence labels, Dismiss, trace highlights
- [x] 2.4 MCP: `slowing` in clinical flags; guidance correlates (FIRDA, OIRDA, TIRDA, polymorphic delta, theta)

## 3. Validation
- [x] 3.1 Synthetic unit tests (FIRDA, lateralized polymorphic delta, posterior theta, ocular mimics, artifact spans, continuous slowing, background)
- [x] 3.2 Specificity: full local pipeline on the analyst's 42 analyses; every first-pass detection plotted and reviewed; final thresholds give 0 events
- [x] 3.3 Sensitivity: FIRDA and polymorphic delta injected into real cleaned recordings
- [ ] 3.4 Real positive cases (TUH EEG Slowing / Events corpus, or analyst-confirmed events) to re-tune thresholds
