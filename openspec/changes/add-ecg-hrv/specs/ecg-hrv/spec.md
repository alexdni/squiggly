## ADDED Requirements

### Requirement: HRV From ECG Lead
The system SHALL compute heart-rate variability from an ECG lead present in an uploaded EDF, BDF or CSV recording, using the biofeedback-core HRV feature graph, and SHALL display it on the analysis page.

#### Scenario: Recording with a usable ECG lead
- **GIVEN** a recording with an `ECG` column and a clean ECG signal of at least 2 minutes
- **WHEN** the analysis completes
- **THEN** `results.hrv` contains heart rate, SDNN, RMSSD, pNN50, LF, HF, LF/HF and normalized LF/HF, and the page shows summary cards and time-series charts

#### Scenario: ECG electrode not attached
- **GIVEN** a recording whose ECG lead contains no detectable heartbeats
- **WHEN** the analysis completes
- **THEN** the EEG analysis succeeds, `results.hrv.reliable` is false, no HRV metrics are shown, and a note explains that heartbeats could not be detected

#### Scenario: Short recording
- **GIVEN** an ECG recording shorter than 4.5 minutes
- **WHEN** HRV is computed
- **THEN** VLF is empty and the page notes the minimum duration
