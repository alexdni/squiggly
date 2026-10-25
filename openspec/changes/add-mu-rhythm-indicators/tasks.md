## 1. Spectral screen (phase 1)
- [x] 1.1 `computeMuIndicators` from stored band_power + psd; verdict likely / possible / not_detected / insufficient_data with reasons
- [x] 1.2 MCP `get_session_summary` carries `mu_indicators`; guidance explains mu as a normal variant and asks for visual confirmation
- [x] 1.3 Unit tests on synthetic spectra; summary test
- [x] 1.4 Validate on real recordings: indicators vs visual review of cleaned EEG (results in design.md)

## 2. Waveform morphology (phase 2)
- [ ] 2.1 `muMorphology(cleaned, channels, sfreq, rejectedSpans)`: local Laplacian at C3/C4 (O1/O2 as control), 8–13 Hz burst detection, cycle features
- [ ] 2.2 Store `results.mu_morphology` (per site: burst count/rate, burst durations, median sharpness ratio, rise/decay asymmetry, cycle regularity; top bursts with times)
- [ ] 2.3 Verdict uses morphology when present; spectral-only verdict otherwise
- [ ] 2.4 Analysis view: mu card with verdict, reasons and links to burst times in the viewer
- [ ] 2.5 Labeled validation set from the analyst's recordings (burst-level mu / not-mu marks); report sensitivity/precision before enabling the verdict upgrade
