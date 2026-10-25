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
interpretation guidance SHALL describe mu as a normal sensorimotor rhythm and say that the screen
does not assess waveform shape.

#### Scenario: Assistant reads central alpha
- **WHEN** a summary has a `likely` or `possible` mu verdict
- **THEN** the guidance directs the assistant not to read central alpha as spread posterior alpha
  or drowsiness, and to suggest visual confirmation
