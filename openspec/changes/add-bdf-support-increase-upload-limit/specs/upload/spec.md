## MODIFIED Requirements

### Requirement: EDF File Upload
The system SHALL accept EEG recordings in European Data Format (.edf) or BioSemi Data Format (.bdf) with 19-channel 10-20 montage and linked-ears reference.

#### Scenario: Valid EDF upload
- **GIVEN** a user is authenticated
- **WHEN** the user uploads a .edf file with 19 channels matching standard 10-20 labels (Fp1, Fp2, F3, F4, C3, C4, P3, P4, O1, O2, F7, F8, T7, T8, P7, P8, Fz, Cz, Pz) and linked-ears reference annotation
- **THEN** the file is stored in Supabase Storage with a unique recording ID

#### Scenario: Valid BDF upload
- **GIVEN** a user is authenticated
- **WHEN** the user uploads a .bdf file with 19 channels matching standard 10-20 labels and a valid BDF header (version byte 0xFF followed by "BIOSEMI")
- **THEN** the file is stored in storage with a unique recording ID and processed identically to an EDF file

#### Scenario: Invalid montage rejection
- **GIVEN** a user uploads a .edf or .bdf file
- **WHEN** the file contains fewer than 19 channels or channel labels do not match 10-20 standard
- **THEN** the upload is rejected with error message "Invalid montage: expected 19-channel 10-20 system with LE reference"

#### Scenario: File size limit
- **GIVEN** a user uploads a .edf, .bdf, or .csv file
- **WHEN** the file size exceeds 200MB
- **THEN** the upload is rejected with error message "File too large: maximum 200MB"

#### Scenario: Invalid BDF header rejection
- **GIVEN** a user uploads a .bdf file
- **WHEN** the file does not contain a valid BDF header (version byte is not 0xFF)
- **THEN** the upload is rejected with error message "Invalid BDF file format"

## MODIFIED Requirements

### Requirement: Upload Progress and Validation
The system SHALL provide real-time upload progress and immediate validation feedback.

#### Scenario: Upload progress tracking
- **GIVEN** a user initiates a file upload
- **WHEN** the upload is in progress
- **THEN** a progress bar displays percentage complete and estimated time remaining

#### Scenario: Immediate montage validation
- **GIVEN** a .edf or .bdf file is uploaded
- **WHEN** the file reaches the server
- **THEN** montage validation (channel count, labels, reference) completes within 2 seconds and returns success or error

#### Scenario: Duplicate detection
- **GIVEN** a user uploads a .edf, .bdf, or .csv file
- **WHEN** an identical file (same filename, size, and upload timestamp within 1 hour) already exists for the same project
- **THEN** the system warns "Possible duplicate detected" and asks for confirmation to proceed
