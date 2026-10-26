## 1. Labels
- [x] 1.1 Shared filename parser and label helpers (`lib/eeg-condition.ts`) with tests
- [x] 1.2 Upload uses the parser; process route uses the shared "unlabelled = whole file EO" rule
- [x] 1.3 PATCH labels with validation; condition_type derived from the segments
- [x] 1.4 Backfill unlabelled recordings from filenames (SQL/TS parity checked on all 302 unlabelled rows); condition_type made consistent

## 2. UI
- [x] 2.1 Recordings tab: EO / EC / EO+EC / Not labeled badge and Edit dialog; saving re-runs the latest analysis
- [x] 2.2 Analysis page: Edit EO/EC labels; banner when results no longer match the labels
- [x] 2.3 Comparison: same condition on both sides; warning when they differ

## 3. Consistency
- [x] 3.1 `results.segments` stored by the pipeline
- [x] 3.2 Relabel-on-read in the analysis page and API and the compare route, as well as MCP; covers `segments` and the sLORETA time-lapse segments
- [x] 3.3 MCP conditions come from the stored labels, not the filename
- [x] 3.4 Removed the unused detect-segments route
