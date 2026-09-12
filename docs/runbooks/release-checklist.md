# Release Checklist

Use this checklist before merging or deploying a meaningful Squiggly change.

## Scope and documentation

- [ ] The change scope is clear.
- [ ] OpenSpec proposal/spec updates exist when required by `AGENTS.md`.
- [ ] Architecture documentation is updated when behavior or architecture changes.
- [ ] A change note exists under `docs/changes/` for non-trivial changes.
- [ ] Rollback steps are documented or confirmed to be standard code rollback.

## Code checks

- [ ] TypeScript tests pass:

  ```bash
  npm test
  ```

- [ ] TypeScript type-check passes:

  ```bash
  npm run type-check
  ```

- [ ] Lint passes or warnings are documented:

  ```bash
  npm run lint
  ```

- [ ] Python worker tests pass when worker code changes:

  ```bash
  PYTHONPATH=api/workers python3 -m unittest discover api/workers/tests
  ```

## EEG-specific checks

- [ ] Existing 19-channel EDF behavior is preserved.
- [ ] Existing BDF behavior is preserved when relevant.
- [ ] Existing CSV behavior is preserved when relevant.
- [ ] Montage/channel normalization changes include tests.
- [ ] Worker deployment package includes any shared manifests or data files.

## Deployment checks

- [ ] Environment variables are documented.
- [ ] Supabase migrations are reviewed and reversible, if present.
- [ ] Worker deployment plan is clear.
- [ ] Web app deployment plan is clear.
- [ ] Smoke test plan is defined.

## Post-deployment smoke tests

- [ ] Sign in.
- [ ] Open a project.
- [ ] Upload or select a known-good recording.
- [ ] Start an analysis.
- [ ] Confirm analysis completes or fails with an expected, actionable error.
- [ ] Confirm analysis results page renders.
