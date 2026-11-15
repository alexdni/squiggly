## 1. Detection
- [x] 1.1 `detectReference(rawLabels)` in `lib/eeg-labels.ts` with tests for every label family in the survey
- [x] 1.2 Loader returns the detected reference
- [x] 1.3 Upload route stores the detected reference
- [x] 1.4 "Recorded as…" control, stored with the analysis settings
- [x] 1.5 Backfill script (dry-run output reviewed; `--apply` not run)

## 2. Analysis reference
- [x] 2.1 `preprocessing.reference` in constants, settings form state and `resolvePreprocessing`
- [x] 2.2 Apply the reference after cleaning; detectors, sLORETA and coherence stay on average
- [x] 2.3 `results.reference` (recorded, applied); cleaned file written on the applied reference
- [x] 2.4 Settings UI option with availability reasons; reference note on the analysis page (included in the PDF)
- [x] 2.5 Comparison view and MCP summary/compare: show the reference, flag mismatches
- [ ] 2.6 MCP metric trend: flag points on a different reference
- [x] 2.7 Pipeline tests: average unchanged; LE equals source; unavailable LE falls back with a warning

## 3. Viewer montage
- [x] 3.1 Pure montage functions (as recorded, average, LE, A1, A2, ipsilateral, contralateral, one electrode, Laplacian, three bipolar chains) with availability, tested
- [x] 3.2 Montage selector; overlay in Correct-noise mode follows it
- [x] 3.3 Labels, tooltips and highlights for derived rows

## 4. Scrolling
- [x] 4.1 Wheel / Shift+wheel / drag / keyboard panning, coalesced per frame, clamped to the recording
- [x] 4.2 Tests for wheel, key and clamp logic

## 5. Verify
- [x] 5.1 `npm test`, typecheck, lint
- [x] 5.2 Browser check of montage and scrolling (local harness, synthetic linked-ears and plain files)
- [x] 5.3 Three reference settings run on 4 real recordings (2 linked ears, 1 plain EDF, 1 CSV)
- [ ] 5.4 Browser check on the signed-in analysis page (settings, reference note, Correct-noise overlay)
