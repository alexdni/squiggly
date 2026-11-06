# Change: Classical magnitude-squared coherence

## Why
Squiggly's only connectivity measure is wPLI, which deliberately ignores zero-lag coupling. Clinical
qEEG "coherence" means magnitude-squared coherence (MSC), which keeps it, so wPLI values cannot be
read against what clinicians expect from coherence. Analysts need both, labelled clearly.

## What Changes
- New `lib/server/eeg/features/coherence.ts`: per frequency bin,
  `MSC(f) = |Σ_k X_k(f) Y_k*(f)|² / (Σ_k |X_k(f)|² · Σ_k |Y_k(f)|²)` over the kept epochs, one Hann
  window per epoch with per-epoch mean removal, then the mean over the bins of each connectivity
  band (delta, theta, alpha, beta). This is the definition in
  https://divergentneuro.github.io/demos/coherence_flavours_brainstar.html
- `results.connectivity[condition].coherence`: `{ n_epochs, matrices }`. It is nested, because the
  top-level `results.coherence` name already marks legacy pre-wPLI analyses.
- A "Coherence (magnitude-squared)" section directly after wPLI on the analysis page and in the
  comparison view, with its own threshold and colour scale. It states the epoch count and chance
  level, and that the values include volume conduction and depend on the reference.
- wPLI, `pair_data`, network metrics and the MCP tools are unchanged. Analyses made before this
  change need a re-analysis to show coherence.

## Impact
- Affected specs: new capability `coherence-connectivity`.
- Affected code: `lib/server/eeg/features/{coherence,connectivity}.ts`, `lib/analysis-results.ts`,
  `components/visuals/{data.ts,ConnectivityHead.tsx}`, `components/AnalysisDetailsClient.tsx`,
  `components/ComparisonView.tsx`.
- Known limits: computed on the pipeline's average reference, not linked ears, so values will not
  match systems that use another reference. Interpolated channels read artificially high with their
  neighbours. MSC is biased upward by about 1/N for N epochs.
