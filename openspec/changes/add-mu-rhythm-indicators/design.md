# Design: Mu rhythm indicators

## Context
Mu is an 8–13 Hz rhythm over the sensorimotor cortex (C3/C4, CP3/CP4). It differs from posterior
alpha in these ways:
- it persists when the eyes open, and blocks with movement, motor imagery or watching movement
- it often peaks at a slightly different frequency from posterior alpha
- it has an arch-shaped ("comb", "wicket") waveform: sharp surface-negative peaks and rounded positive
  troughs, which puts a harmonic near 2f

The pipeline re-references to the channel average. That smears posterior alpha into central
channels, so central alpha power alone does not mean mu.

## Phase 1: spectral screen (built)
`computeMuIndicators({ eo, ec })` reads the stored `band_power` and `psd` (0.5 Hz bins) per
condition:

| Check | Definition | Threshold |
|---|---|---|
| Central peak (required) | max 10·log10(PSD / 1/f fit) in 7–13.5 Hz at C3 or C4. Fit is log-log over 3–40 Hz, excluding 7–14 and 17–28 Hz | ≥ 3 dB |
| Central dominance (EO) | mean C3/C4 alpha (8–12 Hz abs) ÷ mean O1/O2 | ≥ 0.6 |
| Spared reactivity | (central EO/EC alpha) ÷ (occipital EO/EC alpha) | ≥ 1.5 |
| Harmonic (supporting) | max residual within 2f ± 1.5 Hz | ≥ 3 dB |
| Frequency offset (supporting) | central peak vs mean O1/O2 peak (EC when available) | ≥ 0.5 Hz |

The verdict is:
- **likely:** central peak + central dominance + spared reactivity
- **possible:** central peak + one of those two
- **not_detected:** otherwise
- **insufficient_data:** no stored PSD (older engines), or no C3/C4

### Validation (2026-10-25, the analyst's account)
42 completed analyses, which paired into 16 EO/EC sessions plus singles. Cleaned EEG for the
candidates was plotted (1–30 Hz, average reference plus a C3/C4 nearest-neighbour Laplacian,
negative up) and reviewed by eye.

| Session (EO analysis) | Spectral | Visual review |
|---|---|---|
| 44daeae0 | likely (dom 0.74, sel 2.37, harmonic 9 dB) | Clear mu: ~10 Hz arch-shaped trains at C4/C3 Laplacian with sharp negative peaks |
| 8923df63 (same client, earlier) | likely (0.82, 1.76, 5.6 dB) | Clear mu at C3 Laplacian, same morphology; replicates across sessions |
| c7e41cb8 | likely (0.75, 4.6) | Rhythmic ~10 Hz trains at C4 Laplacian, partly arch-shaped; plausible |
| ce8e063c | possible (0.26, 2.6) | Steady ~10 Hz C3 rhythm, sinusoidal, not arch-shaped; plausible central alpha |
| 75d022b7 | possible (0.47, 1.91) | Irregular sharp transients at C4, not a rhythmic train; not mu |
| 954e3739 | not_detected (0.37, 0.75) | Diffuse alpha, central similar to posterior; correct |
| dbd157c3, 6c6178cd | insufficient_data (no PSD) | Band power alone said mu (selectivity 4.8 / 3.0). Visually: electrode pops at C3, and low-level fast activity. Both false positives, hence the PSD-peak requirement |

What we learned:
- A 1/f-corrected central peak must be required.
- A harmonic alone is not specific: diffuse 12 Hz alpha had a 7 dB "harmonic" at 24 Hz (beta).
- "Likely" needs both dominance and spared reactivity.
- Spectra cannot separate a rhythmic arch-shaped train from sporadic sharp transients (75d022b7).
  Phase 2 is for that.

## Phase 2: waveform morphology (planned)
Goal: identify mu the way an EEGer does, by looking at the waveform, and point to where it is.

### Input
- Cleaned continuous EEG from the pipeline, before epoching, excluding the rejection timeline
  spans. Run it per condition segment; EO is primary.
- Spatial filter: a nearest-neighbour surface Laplacian at C3 and C4. For example
  C3 − mean(F3, P3, T7, Cz). Use available neighbours (≥ 3); otherwise fall back to the
  average-reference channel and mark it. O1/O2 Laplacians serve as the control. In validation, the
  Laplacian isolated mu trains that were mixed with posterior alpha on the average reference.

### Bursts
- Narrowband: band-pass ±2 Hz around the site's phase-1 peak (fallback 8–13 Hz), zero-phase.
- Amplitude: Hilbert envelope. A burst is where the envelope is > median + 2·(1.4826·MAD) for
  ≥ 3 consecutive cycles (≥ ~0.3 s), merged across gaps < 1 cycle, and capped at a duration that
  flags non-stop rhythm (> 10 s noted separately).
- Cycle segmentation, bycycle-style (Cole & Voytek 2019): zero-crossings of the narrowband signal
  bracket each half-cycle. Find extrema on the broadband (1–40 Hz) signal within each half-cycle.
- Burst consistency gates (on the broadband cycles), which reject sporadic transients:
  - period CV < 0.25
  - amplitude CV < 0.4
  - monotonic rise/decay fraction > 0.8

### Shape features (per cycle, summarized per burst and per site)
- **Sharpness ratio:** trough sharpness ÷ peak sharpness. Sharpness is the mean |V(extremum) −
  V(extremum ± 5 ms)|. With positive-up voltage, mu's sharp surface-negative component is the
  trough, so the ratio is > 1. Phase-1 exploration over the top-20% envelope periods gave:
  - mu sessions: C3/C4 Laplacian 1.23/1.41 (44daeae0) and 1.33/1.22 (8923df63)
  - non-mu: 0.93–1.08
- **Rise/decay asymmetry:** rise time ÷ period. Arch shape gives values away from 0.5.
- **Harmonic phase coupling:** bicoherence b(f, f) within bursts. It confirms the 2f peak comes
  from the waveform, not separate beta.
- **Independence from posterior alpha:** the fraction of central burst time overlapping O1/O2
  bursts, and the envelope correlation central vs occipital. Mu bursts are largely independent.
- **Laterality:** C3 vs C4 burst rate. Mu is often asymmetric and independent between hemispheres.

### Mimics and how they are excluded
| Mimic | Separation |
|---|---|
| Volume-conducted posterior alpha | Laplacian; burst overlap with O1/O2; dominance check (phase 1) |
| Drowsy anteriorized alpha | EO-only bursts required; EC theta increase noted |
| Wicket spikes (temporal, drowsy) | Same shape but max at T7/T8: compare temporal Laplacian |
| Electrode pops / EMG / sporadic sharp transients | Consistency gates (period/amplitude CV); not rhythmic |
| Epileptiform sharp waves | Isolated, with aftergoing slow wave, fail the gates. Never relabelled as mu; event detection owns them |

### Output (`results.mu_morphology`, per condition)
```
{ sites: { C3: { bursts_per_min, burst_time_pct, median_burst_s, sharpness_ratio,
                 rise_decay_asym, harmonic_bicoherence, occipital_overlap_pct },
           C4: {...} },
  spatial_filter: 'laplacian' | 'average',
  bursts: [{ site, start_s, end_s, freq_hz, sharpness_ratio }]   // top 20 by amplitude
}
```
Phase-1 verdict upgrade: *likely* when the spectral checks pass **and** a site has
bursts_per_min ≥ N, sharpness_ratio ≥ 1.15 and occipital_overlap_pct ≤ 50 (thresholds to be set
in task 2.5). A spectral *likely* with no consistent bursts drops to *possible*.

### Review in the UI
Burst times link into the existing EEG viewer, so the analyst can confirm by eye. The 75d022b7
case shows why: spectra alone flagged it, and the trace showed sharp transients worth a look for
other reasons.

### Open questions
- Should bursts surface as `variant` events (event-review UI, confirm/dismiss)? Or as a separate
  overlay? Events are produced by the engine today; Squiggly-side events would need a source tag.
- Should morphology run at analysis time (needs re-analysis for old data), or on demand from the
  cleaned file? The cleaned file is stored, so on demand avoids a re-run.
- Polarity: the sharpness ratio sign assumes the Laplacian keeps local polarity. CSD-montage
  uploads already are Laplacians and could use the same path.
