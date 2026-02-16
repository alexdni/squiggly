## ADDED Requirements

### Requirement: BDF File Loading
The system SHALL load BDF (BioSemi Data Format) files using MNE-Python's `read_raw_bdf()` and apply the same preprocessing pipeline as EDF files.

#### Scenario: BDF file loaded successfully
- **GIVEN** a .bdf file with valid BioSemi header and 19+ channels in 10-20 montage
- **WHEN** the preprocessing job runs
- **THEN** the file is loaded via `mne.io.read_raw_bdf()`, channels are standardized, and the data enters the same filtering/resampling/ICA pipeline as EDF files

#### Scenario: BDF file with 24-bit resolution
- **GIVEN** a .bdf file with 24-bit sample resolution (3 bytes per sample)
- **WHEN** the file is loaded
- **THEN** MNE correctly reads the 24-bit data and converts to physical units (microvolts) using the digital-to-physical scaling from the BDF header

#### Scenario: Unsupported format rejection
- **GIVEN** a file with an extension other than .edf, .bdf, or .csv
- **WHEN** the file is submitted for preprocessing
- **THEN** the system raises an error "Unsupported file format: .{ext}. Supported formats: .edf, .bdf, .csv"
