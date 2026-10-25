# Change: Mu rhythm indicators

## Why
Squiggly reports central alpha (C3/C4 alpha power, central asymmetry, central theta/beta) without
saying whether it is mu, the normal 8–13 Hz sensorimotor rhythm. Mu and spread posterior alpha mean
different things, so an assistant reading the numbers over MCP, or an analyst reading the report,
can misread mu as anteriorized alpha or drowsiness. Analysts also want mu identified the way they
identify it visually: arch-shaped trains with sharp negative peaks at C3/C4.

## What Changes
- **Phase 1 (this change, built):** `lib/mu-indicators.ts` computes a spectral mu screen from the
  stored `band_power` and `psd`, so it works on existing analyses without re-analysis. It covers:
  - a 1/f-corrected central peak (required)
  - eyes-open central vs occipital alpha
  - EO→EC reactivity at central vs occipital sites
  - a harmonic near 2f
  - central peak frequency vs the posterior rhythm

  The MCP session summary carries it as `mu_indicators`, and the interpretation guidance explains it.
- **Phase 2 (built):** a waveform detector that runs during analysis on the cleaned signal. It finds
  arch-shaped 8–13 Hz trains at C3/C4 on a local Laplacian and stores each one as a reviewable
  `mu-rhythm` normal-variant event on its channel, which the analyst can confirm or dismiss. The EEG
  viewer draws those trains in colour on the C3/C4 traces. Its evidence outranks the spectral screen.
  Existing analyses need Re-Analyze to get the events.

## Impact
- Affected specs: new capability `mu-rhythm-detection`; MCP summary gains a field (additive).
- Affected code: `lib/mu-indicators.ts`, `lib/server/mcp/summary.ts`, `lib/server/mcp/guidance.ts`.
  Phase 2 adds `lib/server/eeg/features/muMorphology.ts` and a results field.
- No pipeline or metric changes in phase 1.
