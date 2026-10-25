## ADDED Requirements

### Requirement: Spectral mu rhythm screen
The system SHALL compute mu rhythm indicators for a session from stored band power and power
spectra, without re-analysis. The verdict SHALL be one of `likely`, `possible`, `not_detected` or
`insufficient_data`, and SHALL come with the reasons behind it.

#### Scenario: Mu with eyes open
- **WHEN** C3 or C4 has an alpha peak at least 3 dB above the 1/f background
- **AND** eyes-open central alpha is at least 0.6× occipital alpha
- **AND** central alpha falls on eye opening by a factor at least 1.5× smaller than occipital alpha
- **THEN** the verdict is `likely`

#### Scenario: Only one supporting check
- **WHEN** the central peak is present and only one of central dominance or spared reactivity holds
- **THEN** the verdict is `possible`

#### Scenario: Eyes-open data only
- **WHEN** the session has no eyes-closed data
- **THEN** reactivity is not assessed, the reasons say so, and the verdict is at most `possible`

#### Scenario: Band power suggests mu but no spectrum is stored
- **WHEN** the analysis has no stored power spectrum
- **THEN** the verdict is `insufficient_data` and the reasons ask for Re-Analyze

#### Scenario: Harmonic without other evidence
- **WHEN** a harmonic near twice the central peak frequency is the only supporting finding
- **THEN** the verdict is `not_detected`

### Requirement: Mu indicators in the MCP session summary
`get_session_summary` SHALL include `mu_indicators` when any condition is available. The
interpretation guidance SHALL describe mu as a normal sensorimotor rhythm, and SHALL say when the
verdict is spectral only because the analysis predates the waveform detector.

#### Scenario: Assistant reads central alpha
- **WHEN** a summary has a `likely` or `possible` mu verdict
- **THEN** the guidance directs the assistant not to read central alpha as spread posterior alpha
  or drowsiness, and points to the reviewable mu events

### Requirement: Mu bursts as reviewable events
Every analysis SHALL look for arch-shaped 8–13 Hz trains at C3 and C4 in the cleaned signal and
store each one as a `variant` event with pattern `mu-rhythm` on its own channel. The detector SHALL
NOT change any metric.

#### Scenario: Recording with mu
- **WHEN** C3 or C4 carries recurring arch-shaped 8–13 Hz trains, with sharp surface-negative
  half-waves, that are not simultaneous occipital alpha
- **THEN** each train is stored as a `mu-rhythm` event on that channel with its time span and
  evidence
- **AND** `mu_morphology` summarizes the bursts per condition and site

#### Scenario: Sinusoidal or sporadic activity
- **WHEN** central 8–13 Hz activity is sinusoidal, or sharp waves occur sporadically rather than
  in regular trains
- **THEN** no mu event is stored

#### Scenario: Montage without neighbours
- **WHEN** neither C3 nor C4 has at least 3 neighbouring electrodes
- **THEN** no mu event is stored and the detector coverage says why

#### Scenario: Analyst dismisses a mu event
- **WHEN** the analyst dismisses a mu event
- **THEN** the decision is stored, survives Re-Analyze, and changes no metric

### Requirement: Mu highlighted on its channel
The EEG viewer SHALL draw each mu event's span of its own channel's trace in the variant colour
while detected events are shown. It SHALL NOT draw dismissed mu events this way.

#### Scenario: Viewing a mu train
- **WHEN** the window contains a mu event on C4
- **THEN** that span of the C4 trace is drawn in colour, and no other channel is
