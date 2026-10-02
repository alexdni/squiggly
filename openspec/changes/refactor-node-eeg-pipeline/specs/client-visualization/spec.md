## ADDED Requirements

### Requirement: Client-Rendered Visuals
The system SHALL render all analysis visuals in the browser from the results JSON: band topomap grid per condition, LZC topomaps, peak-alpha topomaps with a per-channel table, connectivity head graphs per band, network-metric bar charts, and spectrograms for Fp1/Fz/Cz/Pz/O1.

#### Scenario: New analysis visuals
- **GIVEN** a completed Node-engine analysis
- **WHEN** the analysis page loads
- **THEN** every visual is drawn with Canvas/SVG/chart.js and no image is fetched from storage

#### Scenario: Comparison view
- **WHEN** two analyses are compared
- **THEN** both sides render live visuals on shared color scales per band, with a warning if the two analyses used different engines

### Requirement: Legacy Visual Compatibility
The system SHALL keep displaying PNG visuals for analyses produced by the former Python worker.

#### Scenario: Legacy analysis
- **GIVEN** an analysis whose `results.visuals.topomap_grid` is a URL
- **WHEN** the page loads
- **THEN** the stored image is shown in place of the live topomap grid
