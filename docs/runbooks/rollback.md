# Rollback Runbook

This runbook describes how to roll back a Squiggly change when a release causes
validation, preprocessing, analysis, upload, or deployment failures.

## Before rollback

1. Identify the failing release, PR, or commit.
2. Capture the failure mode in the incident notes or PR discussion.
3. Check whether the change included any of the following:
   - database migrations;
   - storage layout changes;
   - worker deployment changes;
   - environment variable changes;
   - third-party integration changes.

## Code-only rollback

Use this path when a change only modified application/worker code and did not
change database schema or stored data formats.

### Revert a single commit

```bash
git checkout main
git pull
git checkout -b rollback/<short-description>
git revert <commit_sha>
git push -u origin rollback/<short-description>
```

Open a pull request from the rollback branch, then merge and deploy it.

### Revert a merge commit

```bash
git checkout main
git pull
git checkout -b rollback/<short-description>
git revert -m 1 <merge_commit_sha>
git push -u origin rollback/<short-description>
```

### Emergency reset

Only use this if the team agrees to rewrite history or if operating on an
unshared deployment branch:

```bash
git reset --hard <known_good_sha>
git push --force-with-lease
```

Prefer `git revert` for shared branches.

## Deployment rollback

### Next.js / web app

1. Revert the code or select the previous known-good deployment in the hosting
   provider.
2. Verify auth, upload, recording creation, and analysis pages load.
3. Run smoke tests for the affected workflow.

### Python worker

1. Redeploy the worker from the known-good commit or image.
2. Verify the worker health endpoint if available.
3. Run a known-good analysis job or local worker test.
4. Confirm results are written back to Supabase as expected.

## Database rollback

If a release included Supabase migrations, create a migration-specific rollback
plan before deployment. Include:

- forward migration file name;
- rollback SQL;
- whether data loss is possible;
- backup/snapshot location;
- verification queries.

Do not run destructive rollback SQL without a database backup.

## Verification after rollback

Run the relevant checks for the changed area. For general application changes,
use:

```bash
npm test
npm run type-check
npm run lint
PYTHONPATH=api/workers python3 -m unittest discover api/workers/tests
```

For EEG ingestion/preprocessing changes, also verify at least one existing EDF,
BDF, or CSV workflow manually.

## Rollback notes for the canonical montage registry

The canonical montage registry change is code-only. It added no database
migrations and did not add new upload formats. If it breaks deployment or worker
execution, revert the registry PR/commit and redeploy both the app/API and the
Python worker.

A specific packaging risk is that Python workers must be deployed with
`lib/montages/canonical-montages.json` available at the expected repository path.
If the worker package excludes that file, restore the previous worker deployment
or update packaging before redeploying.
