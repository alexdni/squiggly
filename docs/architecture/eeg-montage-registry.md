# EEG Montage Registry

## Purpose

Squiggly needs the TypeScript upload/validation layer and the Python EEG worker
layer to agree on which EEG channel names are supported. Historically, channel
lists and aliases were duplicated across TypeScript and Python files. The
canonical montage registry centralizes those definitions so a montage can be
added once and consumed from both runtimes.

## Source of truth

The source-of-truth manifest is:

- `lib/montages/canonical-montages.json`

It defines:

- channel aliases used during normalization;
- the existing 19-channel 10-20 profile;
- the existing 21-channel 10-20 profile with ear references;
- Squiggly's existing extended 10-10 channel support;
- the Brain Products actiCAP 64-channel profile.

## TypeScript consumption

TypeScript code reads the manifest through `lib/montage-registry.ts`, which
exposes helpers for resolving profiles, listing all known EEG channels, and
normalizing channel names. `lib/constants.ts` preserves legacy exports such as
`MONTAGE_10_20_19CH` and `ALL_EEG_CHANNELS`, but derives them from the registry.

The server-side EDF/BDF validator uses the same normalization helper so upload
validation follows the same alias policy as the registry.

## Python consumption

Python workers read the same JSON file through `api/workers/montage_registry.py`.
This keeps preprocessing, CSV channel selection, and montage validation aligned
with the TypeScript validation layer.

Current Python consumers include:

- `api/workers/preprocess.py`
- `api/workers/csv_reader.py`
- `api/workers/validate_montage.py`
- `api/workers/validate_montage_lite.py`

## Supported profiles

| Profile ID | Purpose |
| --- | --- |
| `10-20-19` | Existing standard 19-channel clinical EEG workflow. |
| `10-20-21` | 19-channel profile plus `A1`/`A2` ear references. |
| `10-10-extended` | Existing Squiggly extended 10-10 channel support. |
| `brainproducts-acticap-64` | Brain Products actiCAP 64-channel 10-10 profile. |

## Current limitations

This registry only defines channel names and normalization behavior. It does not
implement BrainVision upload or parsing. In particular, it does not yet support
uploading or grouping `.vhdr`, `.vmrk`, and `.eeg` files.

It also does not implement Firebase integration or any Unity VR game changes.
Future Firebase/game-adaptation work should consume structured EEG analysis
outputs rather than depending directly on montage registry internals.

## Operational notes

When adding a new montage profile:

1. Update `lib/montages/canonical-montages.json`.
2. Add TypeScript tests in `lib/__tests__/montage-registry.test.ts`.
3. Add Python tests in `api/workers/tests/test_montage_registry.py`.
4. Run the release checklist in `docs/runbooks/release-checklist.md`.
5. Update this document if the registry semantics change.
