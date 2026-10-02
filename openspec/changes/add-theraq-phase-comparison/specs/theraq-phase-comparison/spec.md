# Spec Delta: TheraQ Phase Comparison

## ADDED Requirements

### Requirement: Recording Phase Labeling
The system SHALL allow each recording in a project to be assigned exactly one TheraQ phase role from the set {`EO1`, `EC`, `EO2`, `TASK`}, and SHALL leave the phase unassigned (null) by default.

#### Scenario: Auto-suggest phase from filename
- **WHEN** a recording is uploaded with a filename matching a known phase token (e.g. `subject_EO1.edf`, `*_EC*`, `*_EO2*`, `*_TASK*`)
- **THEN** the system suggests the corresponding phase role for that recording
- **AND** the user can override the suggested phase

#### Scenario: Reassign phase
- **WHEN** a user sets the phase of a recording to a role already held by another recording in the same project
- **THEN** the system rejects the change with a conflict error identifying the other recording
- **AND** the existing phase assignment is unchanged

### Requirement: Four-Phase Analysis Eligibility
The system SHALL permit creation of a TheraQ four-phase analysis only when the project contains exactly one recording for each of the four phase roles, and every phase recording passes montage validation (channels O1, Cz, F3, F4 present).

#### Scenario: All four phases present and valid
- **WHEN** a project has one montage-valid recording each for `EO1`, `EC`, `EO2`, and `TASK`
- **THEN** the system allows a TheraQ analysis to be created for the project

#### Scenario: Missing a phase
- **WHEN** a project is missing a recording for one or more phase roles
- **THEN** the system refuses to create the analysis
- **AND** returns which phase roles are missing

#### Scenario: Required channels absent
- **WHEN** a phase recording's montage lacks any of O1, Cz, F3, or F4
- **THEN** the system refuses to create the analysis
- **AND** names the recording and the missing channels

### Requirement: Per-Phase Cleaned Spectra
The system SHALL compute, for each of the four phases, a mean amplitude spectrum per channel from cleaned data using the project's existing preprocessing pipeline (filtering, artifact rejection, epoching), at 1 Hz resolution over 1–45 Hz.

#### Scenario: Spectra computed on cleaned data
- **WHEN** a TheraQ analysis runs
- **THEN** each phase's recording is preprocessed (artifact-rejected) before spectrum computation
- **AND** the resulting per-channel amplitude spectra are stored under the analysis results keyed by condition (`eo1`, `ec`, `eo2`, `eoload`)

#### Scenario: Insufficient clean epochs in a phase
- **WHEN** a phase yields fewer than the minimum required clean epochs after artifact rejection
- **THEN** the analysis fails with status `failed`
- **AND** the error log identifies the phase and the clean-epoch count

### Requirement: Cross-Phase Metric Computation
The system SHALL compute the TheraQ comparative metrics across the four phases using TheraQ band edges (theta 3.5–7.5 Hz, alpha 7.5–12.5 Hz, beta 15.5–25.5 Hz; alpha-peak search 7–13 Hz), including alpha reactivity (EC vs EO1), alpha flexibility (EO1 vs EO2), peak alpha frequency (EC), theta/beta ratios per phase and their phase-to-phase shifts, task-induced shifts (TASK vs rest), frontal ratios, and frontal symmetry (F3 vs F4 in EC).

#### Scenario: Alpha reactivity metric
- **WHEN** metrics are computed
- **THEN** Alpha Shift at O1 equals `(meanAlpha(EC,O1) − meanAlpha(EO1,O1)) / meanAlpha(EO1,O1) × 100`
- **AND** each metric is assigned a green/yellow/red colour by matching its value against its norm ranges

#### Scenario: Value outside all norm ranges
- **WHEN** a computed metric value falls outside every defined norm range
- **THEN** the outermost matching range is extended so the value still receives a colour classification

### Requirement: Dysregulation Index Scoring
The system SHALL compute the four TheraQ dysregulation indices (Emotional Dysregulation, Cognitive Performance, Potential Stress/Trauma Markers, Sleep Dysregulation) by scoring each index's metric subset (green = 0.0, yellow = 0.5, red = 1.0), normalizing to a 0–10 scale as `round(sum / count × 10, 1)`, and assigning a band (green < 3.33, yellow 3.33–6.66, red > 6.66).

#### Scenario: Index score derived from member metrics
- **WHEN** an index is computed
- **THEN** its score equals the rounded mean colour-weight of its member metrics scaled to 0–10
- **AND** higher scores indicate greater dysregulation

### Requirement: TheraQ Analysis Results and Retrieval
The system SHALL persist TheraQ analysis results (per-phase QC, spectra, metrics with norms and colours, and the four index scores) and expose creation and status/result retrieval via the API, scoped to project membership.

#### Scenario: Poll until complete
- **WHEN** a client requests a TheraQ analysis that is still processing
- **THEN** the system returns its current status
- **AND** once complete, returns the full metric and index results

#### Scenario: Access control
- **WHEN** a user who is not a member of the project requests its TheraQ analysis
- **THEN** the system denies access

### Requirement: Non-Diagnostic Framing
The system SHALL present TheraQ results as educational/research-only and explicitly non-diagnostic.

#### Scenario: Disclaimer present
- **WHEN** TheraQ results are returned or displayed
- **THEN** a non-diagnostic, educational/research-use disclaimer accompanies them
