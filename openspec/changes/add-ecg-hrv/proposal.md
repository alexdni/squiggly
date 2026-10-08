# Change: HRV analysis from an ECG lead

## Why
Many recordings (Divergence/Flex CSV exports, clinical EDFs) carry an ECG lead next to the EEG.
Users want heart-rate variability alongside the EEG analysis, computed the same way the
Divergence apps compute it.

## What Changes
- Loaders detect an ECG lead (`ECG`, `EKG`, `ECG I`, `ECG-LA`, ...; not `z-ECG`) in EDF, BDF and
  CSV files and decode it at its own rate (decimated to ~250 Hz like the EEG).
- The analysis job preconditions the ECG (0.5 Hz high-pass, mains notch) and runs
  biofeedback-core's `hrvFeatureDefs` graph server-side: NN intervals, heart rate, RMSSD, SDNN,
  pNN50 (cumulative and 1-minute windows), VLF/LF/HF power, LF/HF and normalized units.
- Quality gate: metrics are withheld (with a note) unless detected beats cover >= 60 % of the
  recording and number >= 30.
- Results: `analyses.results.hrv`; the analysis page shows a "Heart Rate Variability (ECG)"
  section (summary cards and time-series charts, Divergence webapp colours).
- Never fails the EEG analysis: HRV errors become QC warnings.

## Impact
- Affected code: `lib/eeg-labels.ts`, `lib/server/eeg/io/{csv,loadRecording}.ts`,
  `lib/server/eeg/hrv.ts`, `lib/server/eeg/pipeline.ts`, `lib/analysis-results.ts`,
  `components/visuals/HrvSection.tsx`, `components/AnalysisDetailsClient.tsx`.
