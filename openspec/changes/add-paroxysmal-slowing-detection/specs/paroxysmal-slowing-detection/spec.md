## ADDED Requirements

### Requirement: Paroxysmal slowing events
Every analysis SHALL look for bursts of delta (1.5–4 Hz) or theta (4–7.5 Hz) in the cleaned
signal. A burst must stand out from each channel's own background and have a field over
neighbouring electrodes. Each burst SHALL be stored as a `slowing` event on its involved channels,
with a pattern naming its rhythm and location. The detector SHALL NOT change any metric.

#### Scenario: Frontal rhythmic delta
- **WHEN** frontal channels carry a 1–20 s burst of regular 2–3 Hz waves at least 3× their
  background delta and 2× their broadband background
- **THEN** a `slowing` event with pattern `firda` is stored on the involved frontal channels, with
  its evidence

#### Scenario: Irregular lateralized delta
- **WHEN** neighbouring temporal channels on one side carry a burst of irregular delta waves
- **THEN** the event's pattern is `polymorphic-delta` and its evidence gives side `left` or `right`

#### Scenario: Eye movements
- **WHEN** slow waves are confined to Fp1/Fp2/F7/F8, fall off steeply from Fp to F, or are in
  opposite phase at homologous frontal or temporal sites
- **THEN** no slowing event is stored

#### Scenario: Rejected or artifact data
- **WHEN** a burst lies in a channel's rejected epochs or in an eye, movement or electrode-pop span
- **THEN** that data does not contribute to a slowing event

#### Scenario: Continuous or background slowing
- **WHEN** slow activity lasts longer than 20 s, or does not reach twice the channel's broadband
  background
- **THEN** no slowing event is stored

#### Scenario: Sparse montage
- **WHEN** the recording has fewer than 8 standard 10-20 electrodes
- **THEN** no slowing event is stored and the detector coverage says why

### Requirement: Slowing review and display
Slowing events SHALL be reviewable like mu events: Dismiss marks the label wrong, survives
Re-Analyze and changes no metric. The viewer SHALL draw each slowing event's span on every
involved channel's trace, unless the event is dismissed.

#### Scenario: Viewing a FIRDA burst
- **WHEN** the window contains a FIRDA event on F3, Fz and F4
- **THEN** those three traces are drawn in the slowing colour over the burst

### Requirement: Slowing in the MCP summary
`get_session_summary` SHALL treat `slowing` as a clinical category. Confirmed events are clinical
risks; unreviewed ones are "detector flagged, not yet reviewed". The guidance SHALL give each
pattern's clinical correlates.

#### Scenario: Unreviewed TIRDA
- **WHEN** a session has an unreviewed `tirda` event
- **THEN** it appears in `clinical_flags` with review `unreviewed` and counts under `slowing`
