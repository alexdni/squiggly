# Preprocessing Capability

## ADDED Requirements

### Requirement: Signal Filtering
The system SHALL apply configurable high-pass, low-pass, and notch filtering to raw EEG data.

#### Scenario: Default filter settings
- **GIVEN** a raw .edf recording is queued for analysis
- **WHEN** no custom filter config is provided
- **THEN** the system applies 0.5 Hz high-pass, 45 Hz low-pass, and 60 Hz notch filter (or 50 Hz based on region setting)

#### Scenario: Custom filter configuration
- **GIVEN** a user specifies custom filter parameters in job config: `{"hp_lp": [1.0, 40.0], "notch_hz": 50}`
- **WHEN** the analysis job runs
- **THEN** the system applies the custom 1-40 Hz bandpass and 50 Hz notch filter

#### Scenario: Filter validation
- **GIVEN** a user specifies invalid filter parameters (e.g., high-pass > low-pass)
- **WHEN** the job is submitted
- **THEN** the system rejects the job with error "Invalid filter config: high-pass must be less than low-pass"

---

### Requirement: Resampling
The system SHALL resample all recordings to a consistent sampling rate.

#### Scenario: Resample to 250 Hz
- **GIVEN** a .edf file with 500 Hz sampling rate
- **WHEN** the preprocessing job runs
- **THEN** the signal is downsampled to 250 Hz using anti-aliasing lowpass filter

#### Scenario: Skip resampling if already 250 Hz
- **GIVEN** a .edf file already sampled at 250 Hz
- **WHEN** the preprocessing job runs
- **THEN** resampling is skipped and a log entry notes "Sampling rate already 250 Hz"

---

### Requirement: Bad Channel Detection
The system SHALL automatically detect and exclude bad channels based on flatline, variance, and correlation criteria.

#### Scenario: Flatline detection
- **GIVEN** a channel has zero variance for >1 second
- **WHEN** bad channel detection runs
- **THEN** the channel is flagged as "flatline" and excluded from further analysis

#### Scenario: Extreme variance detection
- **GIVEN** a channel's variance is >5 standard deviations above the median channel variance
- **WHEN** bad channel detection runs
- **THEN** the channel is flagged as "extreme variance" and excluded

#### Scenario: Low correlation detection
- **GIVEN** a channel's mean correlation with neighboring channels is <0.3
- **WHEN** bad channel detection runs
- **THEN** the channel is flagged as "low correlation" and excluded

#### Scenario: Manual override
- **GIVEN** a user specifies a list of channels to force-exclude in job config: `{"exclude_channels": ["T7", "P8"]}`
- **WHEN** the analysis runs
- **THEN** the specified channels are excluded regardless of automated detection results

---

### Requirement: ICA Artifact Removal
The system SHALL apply Independent Component Analysis (ICA) to identify and remove artifact components (blinks, heartbeat, jaw-clench, motion).

#### Scenario: ICA decomposition
- **GIVEN** preprocessed EEG data with 17 good channels (2 excluded)
- **WHEN** ICA is enabled in job config (`{"ica": {"enabled": true, "method": "fastica"}}`)
- **THEN** the system computes up to 17 independent components using FastICA

#### Scenario: Blink artifact detection
- **GIVEN** an ICA component with frontal (Fp1/Fp2) loadings >0.6, kurtosis >5, and delta/theta power >80%
- **WHEN** component labeling runs
- **THEN** the component is tagged as "blink" with confidence score (0-1)

#### Scenario: Heartbeat artifact detection
- **GIVEN** an ICA component with periodic ~1-1.4 Hz activity and broad scalp topography with temporal peaks
- **WHEN** component labeling runs
- **THEN** the component is tagged as "ECG" with confidence score

#### Scenario: EMG artifact detection
- **GIVEN** an ICA component with high-beta/low-gamma power >70% and temporal (T7/T8) dominance >0.7
- **WHEN** component labeling runs
- **THEN** the component is tagged as "EMG" with confidence score

#### Scenario: Motion artifact detection
- **GIVEN** an ICA component with step-like transients (peak-to-peak >100µV) and broadband spikes
- **WHEN** component labeling runs
- **THEN** the component is tagged as "motion" with confidence score

#### Scenario: Auto-rejection of artifact components
- **GIVEN** ICA components tagged with confidence scores
- **WHEN** auto-rejection threshold is set (default 0.7)
- **THEN** components with confidence >0.7 are removed from the data and listed in the QC report

#### Scenario: ICA disabled
- **GIVEN** a job config with `{"ica": {"enabled": false}}`
- **WHEN** the analysis runs
- **THEN** ICA is skipped and a warning is logged "ICA disabled: artifact removal may be incomplete"

---

### Requirement: Epoching and Artifact Rejection
The system SHALL segment continuous data into epochs and reject epochs with excessive artifacts.

#### Scenario: Epoch segmentation
- **GIVEN** preprocessed continuous EEG data
- **WHEN** epoching is configured with 2-second duration and 50% overlap
- **THEN** the data is segmented into 2-second epochs with 1-second step size

#### Scenario: Peak-to-peak artifact rejection
- **GIVEN** an epoch with peak-to-peak amplitude >150µV in any channel
- **WHEN** artifact rejection runs
- **THEN** the epoch is marked as rejected with reason "peak-to-peak threshold exceeded"

#### Scenario: Z-score artifact rejection
- **GIVEN** an epoch with z-score >3 relative to the mean epoch variance
- **WHEN** artifact rejection runs
- **THEN** the epoch is marked as rejected with reason "z-score threshold exceeded"

#### Scenario: Autocorrelation artifact rejection
- **GIVEN** an epoch with autocorrelation <0.5 at 1-sample lag (indicating high noise)
- **WHEN** artifact rejection runs
- **THEN** the epoch is marked as rejected with reason "low autocorrelation"

#### Scenario: Excessive rejection warning
- **GIVEN** artifact rejection excludes >40% of epochs
- **WHEN** the preprocessing job completes
- **THEN** a warning is logged "Excessive artifact rejection: >40% epochs excluded. Review data quality."

---

### Requirement: EO/EC Segmentation
The system SHALL separate preprocessed epochs into Eyes-Open (EO) and Eyes-Closed (EC) datasets.

#### Scenario: Annotation-based segmentation
- **GIVEN** a .edf file with annotations marking EO (0-300s) and EC (300-600s) ranges
- **WHEN** epoching completes
- **THEN** epochs are labeled as "EO" or "EC" based on their midpoint timestamp

#### Scenario: Separate file segmentation
- **GIVEN** two separate .edf files labeled "EO" and "EC" for the same recording
- **WHEN** preprocessing completes
- **THEN** all epochs from the EO file are labeled "EO" and all from the EC file are labeled "EC"

#### Scenario: Manual range segmentation
- **GIVEN** a user specifies EO range (0-300s) and EC range (300-600s) in job config
- **WHEN** epoching completes
- **THEN** epochs are labeled based on the specified ranges

#### Scenario: Insufficient EO or EC data
- **GIVEN** after artifact rejection, fewer than 30 epochs remain for EO or EC
- **WHEN** segmentation completes
- **THEN** a warning is logged "Insufficient data: <30 epochs for [EO|EC]. Results may be unreliable."

---

### Requirement: QC Reporting
The system SHALL generate a quality control report summarizing preprocessing steps and data quality.

#### Scenario: QC report contents
- **GIVEN** preprocessing completes for a recording
- **WHEN** the QC report is generated
- **THEN** the report includes: (1) list of excluded channels with reasons, (2) percentage of rejected epochs, (3) list of ICA components removed with tags and confidence scores, (4) pre/post-ICA power comparison for each band at Fp1/Fp2 and O1/O2

#### Scenario: QC warning flags
- **GIVEN** preprocessing completes with >30% artifact rejection or >3 channels excluded
- **WHEN** the QC report is generated
- **THEN** a warning flag is set and displayed prominently in the UI and PDF export

#### Scenario: Pre/post-ICA power validation
- **GIVEN** ICA removed a "blink" component
- **WHEN** the QC report is generated
- **THEN** the report shows that delta power at Fp1/Fp2 decreased by >20% and alpha power at O1/O2 changed by <10% (validating that ICA removed blinks without over-suppressing posterior alpha)
