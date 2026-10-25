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

## Phase 2: waveform detector (built)
Goal: identify mu the way an EEGer does, by its waveform, and show where it is.

Decisions (analyst, 2026-10-25):
- bursts are reviewable events
- detection runs during analysis
- mu trains are highlighted on their own channels in the viewer

### Algorithm (`lib/server/eeg/features/muBursts.ts`)
1. **Input:** the cleaned, average-referenced data the features use. Samples outside kept epochs
   and inside manual artifact spans are excluded. Each EO/EC segment of at least 10 s is
   processed separately.
2. **Spatial filter:** a nearest-neighbour Laplacian.
   - C3 − mean(F3, P3, T7, Cz), and C4 likewise; at least 3 neighbours are required.
   - Occipital control: an O1/O2 Laplacian with at least 2 neighbours, else the raw channel.
3. **Filters:** 8–13 Hz narrowband and 1–40 Hz broadband, both zero-phase. The envelope is the
   Hilbert magnitude of the narrowband signal. Its threshold is 1.5 × the median envelope over the
   kept samples.
4. **Cycles** (bycycle-style):
   - rising zero-crossings of the narrowband signal bound each cycle;
   - the extrema come from the broadband signal;
   - a cycle counts when it is fully kept and its mid-point envelope is above threshold.
5. **Trains:** runs of counted cycles, trimmed to consistent cores. A core cycle has amplitude
   ≥ 0.5 × the run median and a period within 25% of the run median. A core is kept with
   ≥ 5 cycles, period CV < 0.25 and amplitude CV < 0.4.
6. **Shape:**
   - arch sharpness = median trough sharpness ÷ median peak sharpness;
   - sharpness = mean |V(ext) − V(ext ± 5 ms)|, on the positive-up broadband Laplacian;
   - mu's sharp surface-negative half-wave is the trough, so arch shape gives a ratio > 1.
7. **Mu burst:** sharpness ≥ 1.2, and O1/O2 carry their own alpha burst for ≤ 60% of it.
8. **Site gates:** without these, short arch-like snippets turned up in non-mu recordings. A site
   yields bursts only when both hold:
   - its median sharpness over all regular trains is ≥ 1.2;
   - its mu bursts recur at ≥ 2 per minute.

### Output
- `results.mu_morphology[cond].sites.{C3,C4}`: bursts, bursts/min, burst time %, median burst
  length, site sharpness, regular trains of any shape.
- One `variant` event per burst, with:
  - pattern `mu-rhythm` and channels `[site]`
  - handling `noted`, source `detector`
  - evidence: Hz, cycles, arch sharpness, occipital overlap, amplitude
  - a deterministic id (hash of site and span), so review decisions survive Re-Analyze
  - confidence from sharpness and length
- `event_detection` gets a `mu-rhythm` coverage row and adds the bursts to the variant count. Mu ids
  the analyst dismissed are handed to the engine with the other dismissals; they are no longer
  counted as unknown.
- Review:
  - **Confirm** agrees with the label.
  - **Dismiss** says it is not mu: no metric changes, and the viewer stops highlighting it.
- Viewer: each mu event draws its span of its own channel's trace in the variant colour, over the
  trace, as well as the usual event band.
- Verdict (`computeMuIndicators`): mu trains in any condition → `likely`. Detector ran with no
  trains → a spectral `likely` becomes `possible`. Analyses from before the detector keep the
  spectral verdict and say shape was not assessed.

### Validation (cleaned EEG from the analyst's account; plots reviewed by eye)
| Set | Recording | Bursts (C3/C4) | Visual |
|---|---|---|---|
| tuning | 44daeae0 EO | 17 / 35 | clear mu trains, 17–31 cycles |
| tuning | 8923df63 EO | 17 / 12 | clear mu, same client |
| tuning | c7e41cb8, ce8e063c, 75d022b7, 954e3739, dbd157c3, 6c6178cd, 8ea85db8, 1e078991 | 0 | not mu, or equivocal (ce8e063c: short arch-shaped C3 bursts, site sharpness 1.19) |
| held out | 75920793 EC (mu client) | 30 / 31 | expected positive |
| held out | 64d7326c EC | 23 / 29 | textbook ~12 Hz comb-shaped mu; the spectral screen missed it (no EO) |
| held out | b3289cec EC | 0 / 10 | partly arch-shaped C4 trains; plausible (its EO pair is c7e41cb8) |
| held out | 0552cb56, a0843d5e, 4407affe, 23155bca, 91b8ef18, 921cb445, 779f9755, 03ebe9dc, 99485430, 36c8bcc6, a79d445a | 0 | none flagged. 0552cb56 (EC of the mu client) is missed: its central trains overlap posterior alpha |

The full pipeline run locally on the raw 44daeae0 and 64d7326c files reproduced the harness counts
(52 events each, about 7 s per analysis).

### Mimics
| Mimic | Separation |
|---|---|
| Volume-conducted posterior alpha | Laplacian; occipital-overlap cap |
| Diffuse sinusoidal alpha | arch sharpness (site and burst) |
| Electrode pops / EMG / sporadic sharp transients | consistent-cycle cores, period/amplitude CV |
| Wicket spikes (temporal, drowsy) | not separated yet: same shape, max at T7/T8. Candidate follow-up: compare temporal Laplacians |
| Epileptiform sharp waves | isolated, fail the regularity gates; event detection owns them |

### Open
- Thresholds were tuned on 10 recordings and checked on 14. Re-tune once the analyst has
  confirmed or dismissed mu events across several sessions (task 2.8).
