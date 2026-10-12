## 1. Implementation
- [x] 1.1 biofeedback-core 0.33.0-beta.2 (artifact pipeline + sLORETA) published and pinned
- [x] 1.2 Kernel loading (storage bucket or SLORETA_KERNEL_DIR), checksum-verified, server-only
- [x] 1.3 Exact 250 Hz resampling and per-condition band maps over kept epochs in the analysis job
- [x] 1.4 Values file in storage, `results.sloreta` metadata, API routes for voxels and values
- [x] 1.5 Analysis-page section: slices, 3D cloud, band/condition/network selectors, banner
- [x] 1.6 Tests: resampler, montage gate, epoch-averaged equals mean of per-epoch estimates, localization
- [x] 1.7 Upload the kernel to the `models` bucket; verify on real recordings (pipeline) and in the browser (preview of real output)
- [x] 1.8 Time lapse over the whole recording: per-window cross-spectra in the job, chunked frames API, transport with smoothing
- [ ] 1.9 Re-run a 19-channel analysis on the deployed app and check the section end to end
