## 1. Shared input and helpers
- [x] 1.1 `WaveformInput` built once in the pipeline (keep, per-channel keep, artifact spans); mu and slowing read it
- [x] 1.2 Helpers: kept-chunk PSD, 1/f residual, peak width, line removal, narrowband bursts, cross-channel grouping, neighbour grid

## 2. Detectors
- [x] 2.1 Beta spindles: frontal beta peak (≥ 3 dB, ≥ 1 Hz wide, not at the range edge, ≥ 2.5 Hz above alpha); waxing-waning bursts 0.5–3 s at ≥ 2× median envelope, regular, not muscle, not an alpha/mu harmonic; ≥ 2 neighbouring channels; ≥ 1/min
- [x] 2.2 Fast alpha variant (eyes closed): posterior peak at 2× alpha ± 1 Hz, ≥ 0.6× alpha power, posterior ≥ 1.5× frontal, blocks on eye opening when the file has EO; bursts where the fast envelope exceeds alpha's and 2× its 20th percentile, ≥ 1 s, regular, ≥ 2 neighbouring posterior channels
- [x] 2.3 Low-voltage fast: ≥ 8 standard sites; 95th-percentile 1 s peak-to-peak (median over channels) 2–20 µV; beta share ≥ alpha share; eyes closed also alpha share ≤ 0.15 and alpha peak < 4 dB; eyes-open-only flags are marked as such
- [x] 2.4 Events, `variant_screens`, coverage rows, relabel of `variant_screens`

## 3. UI and MCP
- [x] 3.1 Names, evidence labels, highlights, dismissal; low-voltage fast not drawn as a viewer band
- [x] 3.2 Guidance text

## 4. Validation
- [x] 4.1 Unit tests (synthetic positives and mimics)
- [x] 4.2 The analyst's 42 analyses: every candidate plotted and reviewed (design.md)
- [x] 4.3 Sensitivity by injection into real recordings
- [ ] 4.4 Real positive cases for the fast alpha variant (none in the account); re-tune from analyst reviews
