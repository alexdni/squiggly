## ADDED Requirements
### Requirement: Recorded Reference Detection
The system SHALL determine a recording's reference from its channel labels and SHALL report it as unknown when the labels carry no indicator. It SHALL NOT assume linked ears.

#### Scenario: Linked-ears labels
- **GIVEN** a file whose EEG channels are labelled `EEG Fp1-LE`, `EEG Fp2-LE`, …
- **WHEN** it is uploaded
- **THEN** the recording's reference is stored as linked ears, detected

#### Scenario: Plain labels
- **GIVEN** a file whose channels are labelled `Fp1`, `Fp2`, …
- **WHEN** it is uploaded
- **THEN** the recording's reference is stored as unknown

#### Scenario: Analyst states the reference
- **GIVEN** a recording with an unknown reference
- **WHEN** the analyst sets "Recorded as" to linked ears in the analysis settings
- **THEN** the analysis records the reference as linked ears, declared, and linked-ears options become available

#### Scenario: Mixed ear labels
- **GIVEN** a linked-ears file with two channels labelled `-A1`
- **WHEN** it is loaded
- **THEN** the reference is detected as linked ears, the data is left as recorded, and a linked-ears analysis is not offered

### Requirement: Analysis Reference Setting
The system SHALL let the analyst choose the reference the analysis metrics are computed on: average (default), linked ears, or as recorded. It SHALL apply the reference after artifact cleaning and SHALL record the detected and applied reference in the results.

#### Scenario: Default
- **WHEN** an analysis runs with no reference setting
- **THEN** the results are identical to the average-reference results produced before this change

#### Scenario: Linked ears chosen
- **GIVEN** a linked-ears recording
- **WHEN** it is analyzed with the linked-ears reference
- **THEN** band power, PSD, ratios, asymmetry, IAF, complexity and wPLI are computed on linked ears, the cleaned file is written on linked ears, and coherence keeps its average, linked-ears and Laplacian views

#### Scenario: Linked ears not derivable
- **GIVEN** a recording whose reference is unknown
- **WHEN** the analyst opens the reference setting
- **THEN** linked ears is disabled with the reason, and a stored linked-ears setting falls back to average with a warning in the results

#### Scenario: Detectors unaffected
- **WHEN** the same recording is analyzed on average and on linked ears
- **THEN** the detected events and sLORETA maps are the same

### Requirement: Reference Disclosure
The system SHALL show the applied reference wherever analysis metrics are shown or exported, and SHALL flag comparisons between analyses on different references.

#### Scenario: Mismatched comparison
- **GIVEN** one analysis on average and one on linked ears
- **WHEN** they are compared
- **THEN** the comparison states both references and warns that the values are not directly comparable
