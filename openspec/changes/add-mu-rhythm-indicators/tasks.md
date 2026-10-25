## 1. Spectral screen (phase 1)
- [x] 1.1 `computeMuIndicators` from stored band_power + psd; verdict likely / possible / not_detected / insufficient_data with reasons
- [x] 1.2 MCP `get_session_summary` carries `mu_indicators`; guidance explains mu as a normal variant and asks for visual confirmation
- [x] 1.3 Unit tests on synthetic spectra; summary test
- [x] 1.4 Validate on real recordings: indicators vs visual review of cleaned EEG (results in design.md)

## 2. Waveform detector (phase 2)
- [x] 2.1 `detectMuBursts` (lib/server/eeg/features/muBursts.ts): C3/C4 Laplacian, 8–13 Hz trains, consistent-cycle cores, arch sharpness, occipital overlap, site gates
- [x] 2.2 Runs during analysis after features; results.mu_morphology per condition; never changes a metric
- [x] 2.3 Bursts stored as reviewable `variant` events (`mu-rhythm`, one per site); coverage row and variant count in event_detection; dismissed mu ids no longer counted as unknown
- [x] 2.4 Verdict: arch-shaped trains → likely; spectral likely without trains → possible; pre-detector analyses keep the spectral verdict
- [x] 2.5 Review: Confirm and Dismiss on mu events (Dismiss = label wrong; no metric change)
- [x] 2.6 Viewer: mu trains drawn in colour on their own channel's trace; dismissed ones are not
- [x] 2.7 Validation on tuning and held-out recordings (design.md)
- [ ] 2.8 Analyst-labelled bursts (confirm/dismiss over several sessions) to re-tune thresholds
