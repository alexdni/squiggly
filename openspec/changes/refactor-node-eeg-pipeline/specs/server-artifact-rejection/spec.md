## ADDED Requirements

### Requirement: Server-Side Artifact Rejection
The system SHALL clean EEG recordings on the server in Node.js using the biofeedback-core artifact pipeline (channel QC and interpolation, zero-phase filtering, transient repair, ASR, extended-Infomax ICA with IC classification or blink regression, adaptive epoch rejection), executed off the request event loop.

#### Scenario: Analysis runs on the server
- **GIVEN** a stored EDF, BDF or CSV recording with at least 8 positioned 10-20 EEG channels
- **WHEN** the user starts an analysis
- **THEN** `/process` responds 202, the server runs the pipeline in a worker thread, and the analysis becomes `completed` with results

#### Scenario: Insufficient channels
- **GIVEN** a recording where channel QC marks more than the allowed fraction of channels bad
- **WHEN** the pipeline runs
- **THEN** the analysis is marked failed with the engine's insufficient-channels message and the partial QC report is stored

#### Scenario: Stale job
- **GIVEN** an analysis that has been `processing` for more than 10 minutes
- **WHEN** the analysis page loads
- **THEN** it is shown as failed with a retry action

### Requirement: Implementation Confidentiality
The system SHALL NOT deliver biofeedback-core code, types or source maps to the browser, and SHALL NOT include the package in the public repository.

#### Scenario: Client bundle check
- **WHEN** `npm run build` completes
- **THEN** a post-build check scans `.next/static` for biofeedback-core marker identifiers, and the build fails if any is found

#### Scenario: Repository contents
- **WHEN** the repository is cloned
- **THEN** it contains no biofeedback-core source, tarball or dist, and `.npmrc` references the auth token only by environment variable

### Requirement: Artifact Profiles and Manual Mode
The system SHALL offer biofeedback-core profiles (full, conservative, aggressive, rejectionOnly, legacy) with editable rejection ceiling (µV), ASR cutoff k and line frequency, and SHALL keep a manual mode in which only user-marked artifact annotations are excluded.

#### Scenario: Profile selection
- **WHEN** the user selects the `conservative` profile and starts analysis
- **THEN** the pipeline runs with ASR k=30 and at most 2 ICs removed, and `qc_report.profile` records `conservative`

#### Scenario: Configurable threshold honored
- **WHEN** the user sets the rejection ceiling to 120 µV
- **THEN** epochs exceeding 120 µV peak-to-peak after cleaning are rejected and the value appears in `processing_metadata.config`

#### Scenario: Manual mode
- **GIVEN** artifact-mode `manual` and two user artifact annotations
- **WHEN** the analysis runs
- **THEN** ASR and ICA are skipped, and every 2 s epoch overlapping an annotation is excluded and listed in `rejected_epochs` with reason `manual`

### Requirement: Rejected Epoch Reporting
The system SHALL report rejected epochs as `{start, end, reason, condition}` in recording seconds so the EEG viewer can overlay them.

#### Scenario: Rejected epochs overlay
- **WHEN** an analysis completes with rejected epochs
- **THEN** the EEG viewer shows each as a read-only `rejected` annotation labelled with its reason (e.g. `amplitude`, `asr-extreme`, `manual`, `bad-channels`)

### Requirement: Cleaned File Export
The system SHALL store the cleaned recording in its original format (EDF, BDF or CSV), generated on the server, and expose it as a download link.

#### Scenario: Export BDF
- **GIVEN** a completed analysis of a BDF recording
- **WHEN** the user clicks "Download cleaned file"
- **THEN** a valid 24-bit BDF with the cleaned channels downloads with content-type `application/octet-stream`
