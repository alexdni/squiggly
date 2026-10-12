# Change: sLORETA source maps from the cleaned EEG

## Why
biofeedback-core's sLORETA module states that its biggest gap is artifact handling: "a source
estimate computed on uncleaned EEG is not a weaker result, it is a confidently wrong one." Squiggly
now runs the core artifact pipeline (channel QC, ASR, ICA, epoch rejection) server-side, so it can
feed sLORETA only the epochs the pipeline kept. The Divergence webapp (DWEB-2266) already has slice
and 3D voxel-cloud views for sLORETA output, but it computes on prefiltered, uncleaned data.

## What Changes
- biofeedback-core `0.33.0-beta.2` is `feature/artifact-pipeline` merged with `feature/sLoreta`:
  one engine for both cleaning and source localization.
- The analysis job computes, for each EO/EC condition and each analysis band, the sLORETA
  standardized current density averaged over the kept, cleaned, average-referenced 2 s epochs.
  The cross-spectrum is averaged over epochs and the kernel is applied once per band, which equals
  the mean of per-epoch estimates.
- Gates: all 19 kernel channels must be present after QC (interpolated channels count and are
  reported); data not at the kernel's 250 Hz is resampled to exactly 250 Hz for this step only.
  Failure never fails the analysis; it becomes a QC note.
- The kernel (fsaverage-5mm-19ch-v1) is never committed and never reaches the browser. It is
  loaded server-side from a private storage bucket (`models/sloreta/…`), or from
  `SLORETA_KERNEL_DIR` locally, and verified with `parseKernelAsset` (SHA-256).
- Values are stored as a Float32 binary in storage next to the cleaned file; `results.sloreta`
  holds metadata (bands, conditions, epochs used, interpolated channels, peaks, scale).
- `GET /api/sloreta/voxels` serves voxel MNI coordinates and low-sensitivity flags;
  `GET /api/analyses/[id]/sloreta` serves the values to project members.
- The analysis page gets a "Source Localization (sLORETA)" section, ported from the webapp:
  orthogonal MNI slices and a 3D voxel cloud in the fsaverage cortex mesh, band and condition
  selectors, functional-network seed masks, low-sensitivity dimming, and a limitations banner.

## Impact
- Affected code: `package.json` (core 0.33.0-beta.2, three), `lib/server/eeg/sloreta/*`,
  `lib/server/eeg/{pipeline,jobs,runAnalysisJob}.ts`, `lib/analysis-results.ts`,
  `app/api/sloreta/voxels`, `app/api/analyses/[id]/sloreta`, `components/sloreta/*`,
  `components/AnalysisDetailsClient.tsx`, `next.config.js`, `public/models/brain.glb`.
- Ops: upload the three kernel files to the `models` bucket once
  (`node scripts/upload-sloreta-kernel.mjs <dir>`).
- Existing analyses show the section only after a re-run.
