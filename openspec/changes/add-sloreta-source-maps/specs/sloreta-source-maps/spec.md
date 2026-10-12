## ADDED Requirements

### Requirement: sLORETA Maps From Cleaned EEG
The system SHALL compute sLORETA standardized current density per voxel for each analysis band and each EO/EC condition, using only epochs the artifact pipeline kept, and SHALL never compute it from uncleaned data.

#### Scenario: Full 19-channel recording
- **GIVEN** a recording with all 19 standard 10-20 channels and kept EO and EC epochs
- **WHEN** the analysis completes
- **THEN** `results.sloreta` lists both conditions and five bands with the number of epochs used, and a values file holds one voxel map per condition and band

#### Scenario: Missing channel
- **GIVEN** a recording whose cleaned channel set lacks a kernel channel (for example a bad channel that was not interpolated)
- **WHEN** the analysis runs
- **THEN** the analysis succeeds without sLORETA and a QC warning names the missing channels

#### Scenario: Recording not at 250 Hz
- **GIVEN** a 256 Hz recording
- **WHEN** sLORETA is computed
- **THEN** the cleaned data is resampled to exactly 250 Hz for this step and `results.sloreta.resampled_from_hz` is 256

#### Scenario: Kernel unavailable
- **GIVEN** the kernel cannot be loaded or fails checksum verification
- **WHEN** the analysis runs
- **THEN** the analysis succeeds without sLORETA and a QC warning says so

### Requirement: Kernel Stays Server-Side
The sLORETA kernel matrix SHALL be loaded and applied only on the server; only voxel coordinates, low-sensitivity flags and computed values SHALL be sent to the browser.

#### Scenario: Browser bundle
- **WHEN** the app is built
- **THEN** no client chunk contains biofeedback-core or the kernel matrix

### Requirement: Source Map View
The analysis page SHALL show sLORETA maps as orthogonal MNI slices and a 3D voxel cloud, with band, condition and network selection, dimmed low-sensitivity voxels, a dimensionless colour scale, and a banner stating the template head model and method limits.

#### Scenario: Viewing a map
- **GIVEN** a completed analysis with `results.sloreta`
- **WHEN** the user selects EC and Alpha
- **THEN** the slices and the cloud show that map on one fixed scale, the crosshair starts at the peak voxel, and the legend reports the peak's MNI coordinate

#### Scenario: Analysis without sLORETA
- **GIVEN** an analysis run before this change or on a recording with fewer than 19 channels
- **WHEN** the page loads
- **THEN** no source localization section is shown
