# Change: Normal-variant detection (beta spindles, fast alpha variant, low-voltage fast EEG)

## Why
These three patterns change how a qEEG should be read:
- **Beta spindles** are usually a medication effect or drowsiness, not anxiety.
- **A fast alpha variant** makes posterior "beta" an alpha harmonic.
- **Low-voltage fast EEG** makes absolute power low everywhere.

Squiggly did not identify any of them. The analyst asked for them alongside the mu and paroxysmal
slowing detectors (sharp waves deferred).

## What Changes
- `lib/server/eeg/features/waveform.ts`: the input every waveform detector reads, built once by the
  pipeline (`waveformInput`):
  - the cleaned keep mask minus manual artifacts;
  - per-channel kept epochs;
  - the engine's artifact events as spans.

  It also holds the shared helpers: band-pass and envelope, kept-chunk Welch PSD, the 1/f residual
  and peak width, line removal, burst finding, cross-channel grouping and the scalp neighbour grid.
  Slowing uses the shared grid.
- `lib/server/eeg/features/variants.ts`: detects the three patterns. Each becomes a `variant` event
  (noted, reviewable, no metric change), and `results.variant_screens` holds the per-condition
  numbers.
- Pipeline stage `'variants'` after slowing. `event_detection` gains coverage rows
  `beta-spindles`, `fast-alpha-variant` and `low-voltage-fast`.
- UI:
  - pattern and evidence names;
  - spindles and fast alpha are highlighted on their channels;
  - low-voltage fast is listed, not drawn across the viewer;
  - all three can be dismissed.
- MCP guidance: what each pattern means and how it changes the reading of the numbers.

## Impact
- Affected specs: new capability `normal-variant-detection`.
- Existing analyses need Re-Analyze.
