# 2026-06-01 Canonical Montage Registry

## Summary

Introduced a shared EEG montage/channel registry for Squiggly. The registry keeps
TypeScript validation and Python worker channel selection aligned while adding a
Brain Products actiCAP 64-channel profile for future ingestion work.

## Motivation

The project needed a single place to define supported EEG channels. Previously,
channel lists and aliases were duplicated across TypeScript and Python modules.
That duplication increased the risk that upload validation would accept a channel
set that worker preprocessing later handled differently, or vice versa.

## Files added

- `lib/montages/canonical-montages.json`
- `lib/montage-registry.ts`
- `api/workers/montage_registry.py`
- `lib/__tests__/montage-registry.test.ts`
- `api/workers/tests/test_montage_registry.py`

## Files refactored

- `lib/constants.ts`
- `lib/edf-validator.ts`
- `api/workers/preprocess.py`
- `api/workers/csv_reader.py`
- `api/workers/validate_montage.py`
- `api/workers/validate_montage_lite.py`

## Behavior preserved

- Existing EDF, BDF, and CSV workflows remain the supported upload formats.
- Existing 19-channel 10-20 channel behavior remains available through legacy
  constants derived from the registry.
- Existing old-name aliases such as `T3` → `T7`, `T4` → `T8`, `T5` → `P7`, and
  `T6` → `P8` are preserved.

## New behavior

- TypeScript and Python now read the same montage definitions.
- The known-channel set includes a Brain Products actiCAP 64-channel profile.
- Tests assert the 19-channel profile, actiCAP-64 profile, and common channel
  normalization cases.

## Not included

- BrainVision `.vhdr` / `.vmrk` / `.eeg` upload support.
- Firebase integration.
- Unity VR game repository changes.
- Database schema changes.

## Test commands

```bash
npm test
PYTHONPATH=api/workers python3 -m unittest api.workers.tests.test_montage_registry
PYTHONPATH=api/workers python3 -m unittest discover api/workers/tests
npm run type-check
npm run lint
```

## Rollback plan

Because this change did not introduce database migrations, rollback is a standard
code rollback:

1. Revert the commit or PR that introduced the registry.
2. Redeploy the Next.js app/API.
3. Redeploy the Python worker service.
4. Run the release checklist and verify EDF/BDF/CSV upload + analysis still work.

See `docs/runbooks/rollback.md` for the general rollback process.
