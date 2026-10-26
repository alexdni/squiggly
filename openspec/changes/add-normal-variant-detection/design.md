# Design: Normal-variant detection

## Input
All three detectors read `WaveformInput`:
- the cleaned, average-referenced channels;
- the cleaning keep mask minus manual artifacts;
- each channel's kept epochs;
- the engine's artifact events.

They skip eye, movement, pop, jump, muscle and chewing spans (±0.25 s). Spectra are Welch PSDs
(2 s Hann windows) over fully kept chunks. Lines are removed before measuring peaks: a bin whose
neighbours are both under 35% of it, or a two-bin run whose outer neighbours are under 20%. A
spectral peak counts only when it is at least 3 dB above a 1/f fit and at least 1 Hz wide.

## Beta spindles
1. **Beta peak.** The recording's beta peak is the frontal average's highest residual in 14–30 Hz.
   It is rejected when:
   - it sits at the edge of the range (the shoulder of alpha or muscle);
   - it lies within 1 Hz of twice the alpha frequency and is stronger posteriorly (that is the fast
     alpha variant).
2. **Band.** Peak ± 3 Hz, starting at least 2.5 Hz above the posterior alpha.
3. **Bursts.** Taken on frontocentral channels. A burst:
   - stays above 2× the channel's median envelope for 0.5–3 s;
   - has a period CV of at most 0.2;
   - has its envelope peak at 15–85% of its length (waxing and waning);
   - is not muscle (30–45 Hz variance at most 0.5× the band's);
   - is not an alpha/mu harmonic: rejected when 7–13 Hz variance is at least 2× the band's and the
     burst frequency is within 1.5 Hz of twice the concurrent alpha frequency.
4. **Grouping.** Bursts on neighbouring channels that overlap in time form one spindle; at least 2
   channels are needed.
5. **Recurrence.** Events are reported when spindles recur at least 1 per minute.

## Fast alpha variant (eyes closed)
1. **Spectral gate.** On the posterior average, all of:
   - a peak in 14–21 Hz within 1 Hz of twice the alpha peak;
   - fast-band power at least 0.6× alpha-band power (±1.5 Hz each);
   - posterior fast power at least 1.5× frontal;
   - when the same file has eyes-open data, EO/EC fast power at most 0.6.
2. **Bursts.** Per posterior channel: stretches where the fast envelope exceeds the alpha envelope
   and is at least 2× its own 20th percentile, for at least 1 s, with regular cycles. The
   percentile, not the median, is used because the variant can last most of the recording.
3. **Grouping.** At least 2 neighbouring channels.

## Low-voltage fast EEG
Per condition, with at least 8 standard sites:
- **Amplitude:** the median over channels of each channel's 95th-percentile 1 s peak-to-peak
  (1–30 Hz) must be 2–20 µV. Below 2 µV the units are suspect.
- **Spectrum:** posterior beta share (13–30 Hz) at least equal to alpha share (8–12 Hz).
- **Eyes closed also:** alpha share at most 0.15 and alpha peak under 4 dB.
- **Eyes open only:** a flag on eyes-open data is reported with `eyesClosed: false` and lower
  confidence.

One event covers the condition. It is listed in the Detected Events card, not drawn across the
viewer.

## Validation (2026-10-25, the analyst's account: 42 analyses)
- **Calibration.** A table of alpha and fast peaks, harmonic ratio, posterior/frontal ratio, band
  shares and amplitude for every recording. Candidates were plotted (traces and PSDs) and reviewed.
- **Findings with final thresholds:**
  - low-voltage fast in 36c8bcc6 (EC: 10 µV, no alpha peak) and 8ea85db8 (EO: 9 µV);
  - beta spindles in e5bb8a82 (24.5 Hz frontal spindles, 1.2/min);
  - no fast alpha variant.
  Plots agreed.
- **Mimics found on the way, and fixed:**
  - **40f70bfc:** a 14 Hz "beta" peak at the edge of the range was alpha → edge rule and alpha
    clearance.
  - **44daeae0 and 8923df63 (mu client):** fast bursts were harmonics of large arch-shaped
    alpha/mu → burst harmonic rule.
  - **36c8bcc6, 8ea85db8:** a 16 Hz device line in both → line removal; the residual shoulder is
    too broad to remove safely and does not change any finding.
  - **954e3739 and 23155bca:** widespread 16 Hz beta, not at 2× alpha, and present in EO → not a
    fast alpha variant (harmonic and posterior rules).
  - **4f38f0f4:** a strong continuous 24.5 Hz beta without spindles → not called spindles (it is
    excess beta, a different finding).
- **Sensitivity (injected into 8 real eyes-closed recordings):**
  - 22 Hz, 1 s waxing-waning spindles at 10 µV every 12 s: all 8 recordings flagged, 67% of
    spindles found.
  - A 2× alpha posterior rhythm in 5 s runs every 8 s, at about alpha's amplitude, with the
    original signal damped to 30% inside the runs: 8/8 recordings flagged, 92% of runs found.
    Weaker than the existing alpha, it is (correctly) not a variant.

## Open
- No real fast alpha variant case exists to tune on.
- Beta spindle thresholds rest on one positive recording. Re-tune from analyst reviews.
