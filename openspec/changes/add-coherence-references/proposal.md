# Change: Coherence on linked-ears and Laplacian references

## Why
Coherence depends heavily on the reference. It is currently computed only on the pipeline's average
reference, so values cannot be compared with linked-ears clinical work, and global activity reaches
every pair. Analysts need the linked-ears and Laplacian views as well.

## What Changes
- Linked ears: for recordings whose EEG channels are all labelled `-LE`, restore the file's reference
  by adding back the common mode the average reference subtracted, then compute coherence.
- Laplacian: a nearest-neighbour (Hjorth) derivation on the 10-20 montage, each channel minus the mean
  of its neighbours, then coherence. Reference-free. Interpolated channels are left out as targets.
- `results.connectivity[condition].coherence_refs`: `{ linked_ears?, laplacian? }`, alongside the
  existing average-reference `coherence`.
- A reference toggle in the coherence section on the analysis page and in the comparison view, where
  it applies to both recordings.
- wPLI, band power, PSD and every other feature stay on the average reference.

## Impact
- Affected specs: `coherence-connectivity`.
- Affected code: `lib/server/eeg/io/loadRecording.ts`, `lib/server/eeg/pipeline.ts`,
  `lib/server/eeg/features/reference.ts`, `lib/analysis-results.ts`, `components/visuals/*`,
  `components/AnalysisDetailsClient.tsx`, `components/ComparisonView.tsx`.
- Known limits: linked ears is not built from separate A1 and A2 leads, and recordings with plain
  labels are not assumed to be linked ears. 10-10 channels have no Laplacian.
