## ADDED Requirements
### Requirement: Coherence Reference Options
The system SHALL offer magnitude-squared coherence on the average reference and on a nearest-neighbour Laplacian, and on linked ears when every EEG channel of the source recording is labelled as linked-ears referenced. It SHALL NOT present any other recording as linked ears.

#### Scenario: Linked-ears recording
- **GIVEN** a recording whose EEG channels are all labelled `-LE`
- **WHEN** it is analyzed
- **THEN** linked-ears coherence is computed on the file's own reference, with the same epochs as the average reference

#### Scenario: Reference unknown
- **GIVEN** a recording with plain channel labels
- **WHEN** it is analyzed
- **THEN** no linked-ears coherence is stored, and selecting it explains why

#### Scenario: Laplacian is reference-free
- **GIVEN** the same signals with a common signal added to every channel
- **WHEN** the Laplacian is derived
- **THEN** the result is unchanged

#### Scenario: Interpolated channels
- **GIVEN** an interpolated channel
- **WHEN** the Laplacian is derived
- **THEN** that channel has no Laplacian value but still serves as a neighbour

#### Scenario: Comparison
- **WHEN** two recordings are compared
- **THEN** one reference selection and one colour scale apply to both
