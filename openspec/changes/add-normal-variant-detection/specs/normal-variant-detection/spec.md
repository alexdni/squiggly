## ADDED Requirements

### Requirement: Beta spindle events
Every analysis SHALL look for recurring waxing-and-waning beta bursts over frontocentral sites at
the recording's own beta peak. It SHALL store each one as a noted `variant` event with pattern
`beta-spindles` on its channels, and SHALL NOT change any metric.

#### Scenario: Medication-type beta
- **WHEN** frontocentral channels carry 0.5–3 s spindle-shaped bursts at a 14–30 Hz beta peak,
  recurring at least once a minute
- **THEN** each spindle is stored as a `beta-spindles` event with its frequency and channels

#### Scenario: Harmonic of sharp alpha or mu
- **WHEN** the fast bursts ride on large alpha or mu trains at twice their frequency
- **THEN** no beta spindle event is stored

### Requirement: Fast alpha variant events
Eyes-closed analyses SHALL look for a posterior rhythm at twice the alpha frequency that stands
in for alpha, and SHALL store each run as a noted `variant` event with pattern
`fast-alpha-variant` on its posterior channels.

#### Scenario: Harmonic rhythm replacing alpha
- **WHEN** posterior channels show runs of a rhythm at 2× the alpha frequency that exceeds the
  alpha in those runs
- **THEN** each run is stored as a `fast-alpha-variant` event

#### Scenario: Ordinary alpha with a harmonic, or a device line
- **WHEN** the posterior spectrum shows a small 2× harmonic of an otherwise normal alpha, or a
  one-bin line
- **THEN** no fast alpha variant event is stored

### Requirement: Low-voltage fast EEG
Each condition SHALL be checked for low-voltage fast EEG. Its amplitude, its alpha and beta shares
and its alpha peak SHALL be stored in `variant_screens`. When the pattern is present, one noted
`variant` event with pattern `low-voltage-fast` SHALL cover the condition.

#### Scenario: Low-voltage eyes-closed recording
- **WHEN** eyes-closed data stays under 20 µV, with beta at least equal to alpha and no clear
  alpha peak
- **THEN** a `low-voltage-fast` event covers the condition, with `eyesClosed: true`

#### Scenario: Implausible units
- **WHEN** the amplitude is under 2 µV
- **THEN** no low-voltage fast event is stored
