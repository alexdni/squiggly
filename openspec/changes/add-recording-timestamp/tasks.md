## 1. Implementation
- [x] 1.1 `lib/recording-time.ts`: parse EDF/BDF header start and CSV first timestamp, with the plausibility rules, tested
- [x] 1.2 Migration adding `recordings.recorded_at` (applied to production)
- [x] 1.3 Upload route stores it
- [x] 1.4 Show it in the recordings list, analysis page, PDF, comparison view
- [x] 1.5 MCP recording metadata carries `recorded_at`
- [x] 1.6 Backfill script; dry run reviewed, then applied (464 rows)
- [x] 1.7 `npm test`, typecheck, lint, build
