# Design: Paroxysmal slowing detection

## Context
Paroxysmal slowing is a burst of delta or theta that stands out from the background and begins
and ends abruptly. EEGers name it by rhythm and location:

| Pattern | What it looks like | Usual association |
|---|---|---|
| FIRDA | Rhythmic 2–3 Hz, frontal, bilateral | Nonspecific: diffuse or deep midline dysfunction, metabolic states, drowsiness |
| OIRDA | Rhythmic delta, occipital | Children; absence epilepsy |
| TIRDA | Rhythmic delta, temporal, lateralized | Temporal lobe epilepsy (near-epileptiform) |
| Polymorphic delta | Irregular delta, focal or lateralized | Focal dysfunction (lesion, injury, post-ictal) |
| Intermittent / rhythmic theta | Theta bursts | Nonspecific; often drowsiness |

Squiggly records short, awake resting EO/EC sessions, high-passed at 1 Hz, mostly from
neurofeedback clients. True slowing will be rare, and ocular and movement artifact is the main
false-positive risk.

## Algorithm (`lib/server/eeg/features/slowing.ts`)
1. **Input:** the cleaned, average-referenced channels.
   - Samples are kept when the whole epoch was kept and the channel's own epoch was kept
     (`channelEpochMask`, e.g. a per-channel amplitude ceiling), and they are outside manual
     artifacts and outside eye, movement, pop or jump events (±0.25 s).
   - EO/EC segments of at least 10 s are processed separately.
   - At least 8 standard 10-20 sites are required.
2. **Bands:**
   - Delta is 1.5–4 Hz and theta is 4–7.5 Hz. The envelope is the Hilbert magnitude of each band.
   - A channel is "over" while its envelope is above 3× its own median over kept samples.
3. **Bursts:**
   - Spans where any channel is over, with gaps under 0.25 s bridged.
   - Each span is trimmed to where the most active channel's envelope is at least half its maximum.
   - The trimmed burst must last 1–20 s. Longer means continuous slowing, not paroxysmal.
4. **Field:**
   - A channel is involved when it is over for at least half the burst.
   - The burst keeps the peak channel and the involved channels connected to it through scalp
     neighbours (a flattened 10-20 grid, diagonals included, plus Fp1–Fp2 and O1–O2). At least 2
     channels are needed.
5. **Mimics:**
   - Fp1/Fp2/F7/F8 alone is dropped as eye movement.
   - An Fp peak more than 2× F3/F4/Fz is dropped as a vertical eye-movement field.
   - Any involved homologous pair (Fp1/Fp2, F7/F8, F3/F4, T7/T8, P7/P8) correlated below −0.5 is
     dropped as a horizontal eye-movement dipole.
6. **Stand-out:** on the peak channel:
   - the band carries at least 0.5 of the 1–30 Hz variance;
   - the 1–30 Hz RMS is at least 2× the channel's median 1 s RMS.
7. **Rhythm:**
   - Waves are segmented between rising zero-crossings of the band signal and measured on a
     1 Hz to (band top + 2 Hz) signal.
   - A burst is rhythmic when all of these hold: at least 3 waves, period CV ≤ 0.2, amplitude
     CV ≤ 0.35, and peak autocorrelation over one-period lags ≥ 0.6.
   - The autocorrelation guards against a filter making irregular waves look periodic.
8. **Pattern:**
   - Delta and rhythmic: frontal or generalized → FIRDA; occipital → OIRDA; temporal and
     lateralized → TIRDA; anything else → IRDA.
   - Delta and irregular → polymorphic-delta.
   - Theta → rhythmic-theta or intermittent-theta.
   - A theta burst that overlaps a delta burst on shared channels is dropped.
9. **Drowsiness hint:** O1/O2 alpha envelope during the burst ÷ its median. Below 0.5 sets
   `alphaDropout` and lowers confidence.

## Output
- **Events:** one `slowing` event per burst.
  - Channels are the involved channels, peak first.
  - Handling is `noted`; source is `detector`.
  - The id is deterministic: a hash of pattern, peak channel and span.
  - Evidence: band, Hz, waves, rhythmic, location, side, peak channel, × background, band share,
    broadband ratio, amplitude, period CV, rhythmicity, posterior alpha ratio, alpha dropout.
- **`results.paroxysmal_slowing[cond]`:** analyzed seconds, bursts, bursts per minute, burst time %,
  and counts per pattern.
- **Review:** the same as mu. Confirm agrees with the label; Dismiss says the label is wrong and
  changes no metric.

## Validation (2026-10-25, the analyst's account)
**Specificity.**
- The full local pipeline ran on all 42 completed analyses (raw files, their own segments and
  settings).
- The first pass flagged 12 events in 8 recordings. Every one was plotted (1–30 Hz, average
  reference, negative up) and reviewed. None was cerebral slowing:
  - 3 were F7/F8/T7/T8 bursts in opposite phase (lateral eye movements) inside per-channel
    rejected epochs;
  - 6 were non-adjacent channel sets (electrode artifact on single channels);
  - 1 came from a 4-channel montage;
  - 2 were small theta at the background level.
- Fixes: per-channel rejection masks, the field (neighbour) rule, the homologous-dipole rule, the
  8-site minimum, and a 2× broadband stand-out.
- Final thresholds: **0 events in 42 recordings**.

**Sensitivity (injected into 6 real cleaned recordings, every 30 s).**

| Injected | Amplitude | Found | Labelled |
|---|---|---|---|
| FIRDA (2.5 Hz, frontal field, 2 s) | 30 µV | 68/84 (81%) | 60 FIRDA, 8 polymorphic |
| Left temporal polymorphic delta (3 s) | 40 µV | 56/84 (67%) | all polymorphic |

Most misses fall in artifact-heavy recordings, where blink and movement spans are skipped. This
is deliberate: the detector prefers missing a burst to flagging an artifact.

## Not covered
- Real positive cases: no recording in the account contains slowing. Tune against TUH EEG
  (Slowing / Events) or analyst-confirmed events (task 3.4).
- Posterior slow waves of youth are not separated from OIRDA or posterior polymorphic delta.
  Glossokinetic and sweat artifact are only handled by the stand-out and field rules.
- Mu detection does not yet use per-channel rejection masks either. It is less exposed because it
  works at C3/C4 with a Laplacian, but it should get the same input.
