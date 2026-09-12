# Squiggly Internal Documentation

This folder contains implementation notes, architecture decisions, change records,
and operational runbooks for Squiggly. It is intended to preserve context that is
otherwise easy to lose after a pull request is merged.

## Architecture

- [EEG montage registry](architecture/eeg-montage-registry.md) explains the
  shared TypeScript/Python channel registry used by upload validation and worker
  preprocessing.

## Architecture decision records

- [ADR-0001: Canonical EEG montage registry](architecture/decisions/ADR-0001-canonical-montage-registry.md)

## Change notes

- [2026-06-01 canonical montage registry](changes/2026-06-01-canonical-montage-registry.md)

## Runbooks

- [Rollback runbook](runbooks/rollback.md)
- [Release checklist](runbooks/release-checklist.md)
