# Change: Show when a recording was made, when the file says

## Why
The app only knows when a file was uploaded. Sessions are often uploaded days later or in batches,
so upload time misorders them and says nothing about time of day. Most files carry the real time:
of 557 uploads, 458 EDF/BDF headers hold a plausible start date (438 with a time of day, 20 date
only) and 8 CSVs have absolute timestamps. 76 CSVs count time from zero and 15 EDFs hold a
placeholder (`01.01.85`) or nothing, so for those there is nothing to show.

## What Changes
- Read the recording start at upload: the EDF/BDF header start date and time, or the first CSV
  timestamp when it is an absolute time (epoch seconds/ms/µs/ns or ISO 8601).
- Reject values that are not real: placeholder dates (including 1 January at `00.00.00` or
  `01.01.01`), dates before 2000, dates more than two days
  after the upload, CSV timestamps that count from zero.
- Store it in a new nullable `recordings.recorded_at` text column, in ISO form that says how much
  is known: `2025-11-10T21:53:17` (EDF: clock time at the recording site, time zone not stated),
  `2025-11-18T12:24:10Z` (CSV: an absolute time), `2022-04-02` (date only, header time `00.00.00`).
- Show "Recorded" beside the upload date in the recordings list, on the analysis page and in the
  PDF, on both sides of the comparison view, and in MCP recording metadata. EDF times are shown as
  written, without time-zone conversion; absolute times in the viewer's time zone.
- Backfill existing rows from their file headers (one-off script, dry run first).
- Ordering and session grouping keep using upload time for now.

## Impact
- Affected specs: `recording-timestamp` (new).
- Affected code: `lib/recording-time.ts` (new), `app/api/recordings/route.ts`, a migration,
  `components/ProjectDetailsClient.tsx`, `components/AnalysisDetailsClient.tsx`,
  `components/ComparisonView.tsx`, `lib/server/mcp/data.ts`, `lib/server/mcp/summary.ts`,
  `types/database.ts`, a backfill script.
- Schema: `ALTER TABLE recordings ADD COLUMN recorded_at TEXT` (nullable, no default).
