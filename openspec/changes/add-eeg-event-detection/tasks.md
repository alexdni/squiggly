## 1. Engine and job
- [x] 1.1 Upgrade biofeedback-core to 0.34.0-beta.0 (exact pin, lockfile)
- [x] 1.2 Enable labels-only event detection in the analysis pipeline config; keep TheraQ off
- [x] 1.3 Pass un-notched EEG, matching ECG lead and dismissed ids as event inputs
- [x] 1.4 Store `results.events` and `results.event_detection` (app-side types, no engine imports in shared files)

## 2. Review decisions
- [x] 2.1 `PUT /api/analyses/[id]/event-reviews` merging one decision into `config.event_reviews`
- [x] 2.2 Process route reads dismissed ids from the analysis config

## 3. UI
- [x] 3.1 Detected Events card (counts, list, evidence, Confirm/Dismiss, not-assessed list, PDF section)
- [x] 3.2 Event bands in the EEG viewer, linked to the card

## 4. Verification
- [x] 4.1 Tests, typecheck, lint, build with client-bundle check
