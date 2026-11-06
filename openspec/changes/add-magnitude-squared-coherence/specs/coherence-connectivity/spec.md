## ADDED Requirements
### Requirement: Magnitude-Squared Coherence
The system SHALL compute magnitude-squared coherence for every channel pair, per condition and connectivity band, as `|Σ_k X_k(f) Y_k*(f)|² / (Σ_k |X_k(f)|² · Σ_k |Y_k(f)|²)` over the kept epochs, using one Hann-windowed spectrum per epoch and the mean over the band's frequency bins. It SHALL store the result under `results.connectivity[condition].coherence` with the number of epochs used, and SHALL leave wPLI values unchanged.

#### Scenario: Zero-lag coupling is kept
- **GIVEN** two channels sharing a zero-lag source plus independent noise
- **WHEN** features are computed
- **THEN** coherence for the pair is high while wPLI stays low

#### Scenario: Independent channels
- **GIVEN** independent channels over N epochs
- **WHEN** features are computed
- **THEN** coherence for the pair is close to the chance level of 1/N

#### Scenario: High-amplitude epochs weigh more
- **GIVEN** coupled high-amplitude epochs and uncoupled low-amplitude epochs
- **WHEN** features are computed
- **THEN** coherence for the pair is high

#### Scenario: Too few epochs
- **GIVEN** fewer than two kept epochs in a condition
- **WHEN** features are computed
- **THEN** no coherence is stored for that condition

### Requirement: Coherence Display
The system SHALL show coherence directly after wPLI on the analysis page and in the comparison view, with its own threshold and colour scale, the epoch count and chance level, and a statement that values include volume conduction and depend on the reference.

#### Scenario: Comparison scale
- **WHEN** two recordings are compared
- **THEN** both sides' coherence graphs share one threshold and colour scale

#### Scenario: Analysis made before coherence existed
- **GIVEN** an analysis with wPLI but no coherence
- **WHEN** the section is shown
- **THEN** it asks for a re-analysis instead of showing empty graphs
