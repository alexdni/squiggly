# Upload Capability

## ADDED Requirements

### Requirement: EDF File Upload
The system SHALL accept EEG recordings in European Data Format (.edf) with 19-channel 10-20 montage and linked-ears reference.

#### Scenario: Valid EDF upload
- **GIVEN** a user is authenticated
- **WHEN** the user uploads a .edf file with 19 channels matching standard 10-20 labels (Fp1, Fp2, F3, F4, C3, C4, P3, P4, O1, O2, F7, F8, T7, T8, P7, P8, Fz, Cz, Pz) and linked-ears reference annotation
- **THEN** the file is stored in Supabase Storage with a unique recording ID

#### Scenario: Invalid montage rejection
- **GIVEN** a user uploads a .edf file
- **WHEN** the file contains fewer than 19 channels or channel labels do not match 10-20 standard
- **THEN** the upload is rejected with error message "Invalid montage: expected 19-channel 10-20 system with LE reference"

#### Scenario: File size limit
- **GIVEN** a user uploads a .edf file
- **WHEN** the file size exceeds 50MB
- **THEN** the upload is rejected with error message "File too large: maximum 50MB"

---

### Requirement: EO/EC Labeling
The system SHALL support Eyes-Open (EO) and Eyes-Closed (EC) state segmentation via annotations or separate files.

#### Scenario: Annotation-based segmentation
- **GIVEN** a .edf file with annotations containing labels "EO" or "eyes open" and "EC" or "eyes closed"
- **WHEN** the file is uploaded
- **THEN** the system extracts time ranges for EO and EC states from annotations

#### Scenario: Separate file upload
- **GIVEN** two separate .edf files for the same subject
- **WHEN** the user uploads both and labels one as "EO" and the other as "EC"
- **THEN** the system associates both files with a single recording ID

#### Scenario: Missing EO/EC labels
- **GIVEN** a .edf file without annotations or labels
- **WHEN** the file is uploaded
- **THEN** the system prompts the user to manually specify EO/EC time ranges (start_time, duration in seconds)

---

### Requirement: Upload Progress and Validation
The system SHALL provide real-time upload progress and immediate validation feedback.

#### Scenario: Upload progress tracking
- **GIVEN** a user initiates a file upload
- **WHEN** the upload is in progress
- **THEN** a progress bar displays percentage complete and estimated time remaining

#### Scenario: Immediate montage validation
- **GIVEN** a .edf file is uploaded
- **WHEN** the file reaches the server
- **THEN** montage validation (channel count, labels, reference) completes within 2 seconds and returns success or error

#### Scenario: Duplicate detection
- **GIVEN** a user uploads a .edf file
- **WHEN** an identical file (same filename, size, and upload timestamp within 1 hour) already exists for the same project
- **THEN** the system warns "Possible duplicate detected" and asks for confirmation to proceed

---

### Requirement: Storage Management
The system SHALL organize uploaded files by project and user with access control.

#### Scenario: Project-scoped storage
- **GIVEN** a user belongs to multiple projects
- **WHEN** the user uploads a .edf file
- **THEN** the file is stored in a project-specific bucket path `projects/{project_id}/recordings/{recording_id}.edf`

#### Scenario: Access control enforcement
- **GIVEN** a recording belongs to Project A
- **WHEN** a user without access to Project A attempts to download the file
- **THEN** the request is denied with HTTP 403 Forbidden

#### Scenario: Soft delete retention
- **GIVEN** a user deletes a recording
- **WHEN** the deletion is confirmed
- **THEN** the file is moved to a soft-delete bucket and retained for 30 days before permanent deletion
