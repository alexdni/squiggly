# ADR-0001: Canonical EEG Montage Registry

## Status

Accepted

## Date

2026-06-01

## Context

Squiggly validates EEG uploads in TypeScript and preprocesses EEG data in Python.
Before this decision, supported EEG channels and channel-name aliases were
maintained in multiple places, including TypeScript constants, TypeScript EDF/BDF
validation, Python preprocessing, Python CSV reading, and Python montage
validators.

This duplication made it easy for supported channel names to drift between upload
validation and worker preprocessing. It also made future high-density montage
support, such as Brain Products actiCAP 64-channel data, harder to maintain.

## Decision

Use `lib/montages/canonical-montages.json` as the canonical source of truth for
EEG montage profiles and channel aliases.

TypeScript consumes that manifest through `lib/montage-registry.ts`. Python
workers consume the same manifest through `api/workers/montage_registry.py`.
Legacy TypeScript constants remain available but are derived from the registry.

## Consequences

### Positive

- New montage profiles are added in one manifest.
- TypeScript validation and Python preprocessing use the same channel definitions.
- Existing 19-channel EDF/BDF/CSV workflows remain supported.
- Brain Products actiCAP 64-channel channel names can be recognized before
  BrainVision upload is implemented.

### Negative / risks

- Python worker packaging must include `lib/montages/canonical-montages.json`.
- A malformed registry file can affect both TypeScript and Python channel
  selection.
- Channel aliases are now a shared policy; changing an alias may affect multiple
  ingestion paths.

## Rollback

Rollback is a code-only rollback for this decision because no database schema or
storage migration was introduced. Follow `docs/runbooks/rollback.md` and revert
the commit or PR that introduced the registry.
