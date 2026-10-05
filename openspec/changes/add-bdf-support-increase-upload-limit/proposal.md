# Change: Add BDF file format support and increase upload size limit to 200MB

## Why
BDF (BioSemi Data Format) is a common 24-bit EEG format used by BioSemi recording systems. Users capturing data in BDF format currently cannot upload their files. Additionally, the 50MB upload limit is too restrictive for longer recordings, especially in 24-bit BDF format which produces larger files than 16-bit EDF.

## What Changes
- Add `.bdf` / `.BDF` as accepted file extensions throughout the upload pipeline
- Add BDF header validation (version byte `0xFF BIOSEMI` vs EDF's `0`) in both client-side and server-side validators
- Add BDF loading in Python preprocessing via MNE's `mne.io.read_raw_bdf()`
- Add BDF parsing in browser-side EEG viewer (24-bit samples instead of 16-bit)
- Increase maximum upload size from 50MB to 200MB across all configuration points (`constants.ts`, `config.ts`, `next.config.js`, UI text)
- Update `openspec/project.md` constraints to reflect the new 200MB limit

## Impact
- Affected specs: `upload`, `preprocessing`
- Affected code:
  - `lib/constants.ts` — add `.bdf` extensions, increase `MAX_UPLOAD_SIZE`
  - `lib/upload-validation.ts` — add `validateBDFHeader()`, route `.bdf` through it
  - `lib/edf-validator.ts` — extend or clone for BDF header parsing (version `0xFF`, 24-bit samples per record)
  - `lib/edf-reader-browser.ts` — add BDF support (24-bit `getInt24` reading)
  - `lib/config.ts` — update default `maxUploadSize` to 200MB
  - `components/upload/FileUploadZone.tsx` — add `.bdf` to accept attribute, update help text
  - `components/eeg-viewer/useEEGData.ts` — route `.bdf` through the EDF/BDF reader
  - `app/api/recordings/route.ts` — add `bdf` case to server-side file type routing
  - `api/workers/preprocess.py` — add `.bdf` case using `mne.io.read_raw_bdf()`
  - `next.config.js` — increase `bodySizeLimit` to `200mb`
  - `openspec/project.md` — update constraint from 50MB to 200MB
