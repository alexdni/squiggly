# Change: Detect the recorded reference, re-reference on request, and scroll the EEG viewer

## Why
Every recording is stored as `reference: 'LE'` and every analysis is forced onto the average
reference, whatever the file says. A survey of the 557 uploaded recordings (headers only) shows
that is wrong for about half of them:

| What the labels say | Files | Share |
|---|---|---|
| Linked ears (`Fp1-LE`) | 240 (14 of them with two channels labelled `-A1`) | 43% |
| Nothing (plain `Fp1`, `C3`): 202 EDF, all 84 CSV, 4 BDF | 290 | 52% |
| `-Ref` (device reference, not named) | 8 | 1.4% |
| Single / ipsilateral ear (`-A1`, `-A2`) | 6 | 1.1% |
| Already derived: CSD (2), bipolar (1) | 3 | 0.5% |
| No recognisable scalp labels (5 EDF, 5 BDF) | 10 | 1.8% |

No file is labelled average or Cz. EDF/BDF have no reference field: the label suffix is the only
indicator, and the transducer field is blank or a placeholder in every file. CSV exports carry
nothing. 190 linked-ears files also carry an `A2-A1` channel and 19 files carry separate A1 and A2
channels, which is what makes exact ear re-referencing possible.

Analysts read linked-ears, average and Laplacian views for different questions and compare against
work done on a particular reference, so the reference has to be known, shown and selectable.

## What Changes
- **Detect** the recorded reference from the channel labels at upload and at analysis: linked ears,
  A1, A2, ipsilateral ears, device reference (unnamed), CSD, bipolar, or unknown. Store it on the
  recording in place of the hard-coded `'LE'`, and let the analyst state it ("Recorded as…", kept
  with the analysis settings), since half the files say nothing.
- **Analysis reference setting** (`preprocessing.reference`): `average` (default, today's
  behaviour), `linked_ears`, or `as_recorded`. Cleaning is unchanged; the chosen reference is applied
  after it, and band power, PSD, ratios, asymmetry, IAF, complexity,
  wPLI and the exported cleaned file all use it. Coherence keeps its own reference switch. Linked
  ears is offered only when the recording is linked ears (detected or stated).
- Event detectors (mu, slowing, variants) and sLORETA keep running on the average reference: their
  thresholds and the source model assume it.
- Results record the detected and applied reference; the analysis page, comparison view, PDF and
  MCP summaries show it, and the comparison view warns when the two analyses differ.
- **Viewer montage selector**, applied in the browser with no re-analysis: as recorded, average,
  linked ears, either ear, ipsilateral / contralateral ears, any one electrode, Laplacian (Hjorth),
  and longitudinal, transverse and circumferential bipolar. Options the recording cannot
  support are disabled with the reason. In the viewer, linked ears is also derived from separate
  A1/A2 channels, and A1 or A2 from an `A2-A1` channel.
- **Scrolling**: the trace graph pans through time with horizontal wheel/trackpad scroll,
  Shift+wheel, click-drag, and the arrow / Page keys. Plain vertical wheel still scrolls the page.
- Backfill `recordings.reference` for the existing rows from their file headers (one-off script).

## Impact
- Affected specs: `reference-selection` (new), `eeg-viewer` (new).
- Affected code: `lib/eeg-labels.ts`, `lib/server/eeg/io/loadRecording.ts`,
  `lib/server/eeg/pipeline.ts`, `lib/server/eeg/features/reference.ts`, `lib/constants.ts`,
  `lib/analysis-results.ts`, `components/analysis-settings.ts`, `components/AnalysisDetailsClient.tsx`,
  `components/ComparisonView.tsx`, `components/eeg-viewer/*`, `app/api/recordings/route.ts`,
  `lib/server/mcp/*`, a backfill script.
- Existing analyses are unchanged (they are average-referenced and will say so); a different
  reference needs a re-analysis.
- Known limits: linked ears for the analysis is not derived from separate A1/A2 channels (they would
  have to go through artifact cleaning first); a file with no indicator stays "unknown" until the
  owner declares it; 10-10 channels have no Laplacian or bipolar chain.
