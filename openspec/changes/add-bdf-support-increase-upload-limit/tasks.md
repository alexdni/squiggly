## 1. Increase upload size limit from 50MB to 200MB
- [x] 1.1 Update `MAX_UPLOAD_SIZE` in `lib/constants.ts` from `52428800` to `209715200`
- [x] 1.2 Update default `maxUploadSize` in `lib/config.ts` from `52428800` to `209715200`
- [x] 1.3 Update `bodySizeLimit` in `next.config.js` from `'50mb'` to `'200mb'`
- [x] 1.4 Update "Maximum file size: 50 MB" text in `components/upload/FileUploadZone.tsx` to "200 MB"
- [x] 1.5 Update EDF file size limit in `openspec/project.md` Important Constraints section

## 2. Add BDF to allowed file extensions and client-side validation
- [x] 2.1 Add `'.bdf'` and `'.BDF'` to `ALLOWED_FILE_EXTENSIONS` in `lib/constants.ts`
- [x] 2.2 Add `validateBDFHeader()` in `lib/upload-validation.ts` that checks first byte is `0xFF` (BDF signature)
- [x] 2.3 Route `.bdf` files through `validateBDFHeader()` in `validateUploadFile()`
- [x] 2.4 Add `.bdf,.BDF` to the `<input accept=...>` attribute in `components/upload/FileUploadZone.tsx`
- [x] 2.5 Update help text in `FileUploadZone.tsx` to mention BDF format alongside EDF and CSV

## 3. Add BDF server-side validation
- [x] 3.1 Create `validateBDFMontage()` in `lib/edf-validator.ts`, sharing montage logic with `validateEDFMontage()` via private `validateMontage()` helper
- [x] 3.2 Add `bdf` case in `app/api/recordings/route.ts` server-side file type routing, calling `validateBDFMontage()`

## 4. Add BDF support in Python preprocessing
- [x] 4.1 Add `.bdf` case in `EEGPreprocessor.load_file()` in `api/workers/preprocess.py` using `mne.io.read_raw_bdf()`
- [x] 4.2 Create `load_bdf()` method in `EEGPreprocessor` (similar to `load_edf()`, calling `mne.io.read_raw_bdf()`)

## 5. Add BDF support in browser-side EEG viewer
- [x] 5.1 Extend `lib/edf-reader-browser.ts` to detect BDF (version byte `0xFF`) and read 24-bit samples instead of 16-bit
- [x] 5.2 Route `.bdf` files through the EDF/BDF reader in `components/eeg-viewer/useEEGData.ts`
- [x] 5.3 Add `'bdf'` to `UnifiedSignalData.fileType` union type in `components/eeg-viewer/types.ts`

## 6. Verification
- [ ] 6.1 Manually test uploading a BDF file through the upload flow
- [ ] 6.2 Verify that files between 50MB and 200MB are accepted
- [ ] 6.3 Verify that BDF files display correctly in the raw EEG viewer
- [ ] 6.4 Verify that BDF files process correctly through the analysis pipeline
