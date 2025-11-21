# EO→EC Comparison Capability

## ADDED Requirements

### Requirement: Condition Type Classification
The system SHALL classify recordings as Eyes-Open (EO), Eyes-Closed (EC), or BOTH based on segment labeling.

#### Scenario: Auto-detect EO-only recording
- **GIVEN** a recording has EO segment times (eo_start, eo_end) but no EC segment times
- **WHEN** the recording is created
- **THEN** the system sets `condition_type = 'EO'`

#### Scenario: Auto-detect EC-only recording
- **GIVEN** a recording has EC segment times (ec_start, ec_end) but no EO segment times
- **WHEN** the recording is created
- **THEN** the system sets `condition_type = 'EC'`

#### Scenario: Auto-detect combined EO/EC recording
- **GIVEN** a recording has both EO and EC segment times
- **WHEN** the recording is created
- **THEN** the system sets `condition_type = 'BOTH'`

---

### Requirement: Pairwise EO→EC Comparison
The system SHALL compute comparative metrics between selected EO and EC recordings within a project.

#### Scenario: Compare two recordings
- **GIVEN** a project has at least one EO recording and one EC recording, both with completed analyses
- **WHEN** the user selects an EO recording and an EC recording for comparison
- **THEN** the system computes feature deltas (power changes, coherence shifts, asymmetry differences) and returns comparison results

#### Scenario: Power delta calculation
- **GIVEN** two recordings are being compared
- **WHEN** the comparison is computed
- **THEN** for each band and channel, the system calculates: `delta_power = power_EC - power_EO` and `percent_change = (delta_power / power_EO) * 100`

#### Scenario: Coherence shift calculation
- **GIVEN** two recordings are being compared
- **WHEN** the comparison is computed
- **THEN** for each coherence pair and band, the system calculates: `delta_coherence = coherence_EC - coherence_EO`

#### Scenario: Asymmetry difference calculation
- **GIVEN** two recordings are being compared
- **WHEN** the comparison is computed
- **THEN** for each asymmetry metric (PAI, FAA), the system calculates: `delta_asymmetry = asymmetry_EC - asymmetry_EO`

---

### Requirement: Comparison UI on Project Page
The system SHALL provide a dedicated "Comparison" view on the project details page.

#### Scenario: Comparison tab visibility
- **GIVEN** a project has at least one completed EO analysis and one completed EC analysis
- **WHEN** the user views the project details page
- **THEN** a "Comparison" tab is visible alongside "Recordings" and "Overview" tabs

#### Scenario: Recording selector for comparison
- **GIVEN** the user is on the "Comparison" tab
- **WHEN** the tab loads
- **THEN** two dropdown selectors are displayed: "Select EO Recording" and "Select EC Recording", populated with recordings where `condition_type = 'EO'` or `'EC'` respectively

#### Scenario: Quick compare with single EO and EC
- **GIVEN** a project has exactly one EO recording and one EC recording, both analyzed
- **WHEN** the user navigates to the "Comparison" tab
- **THEN** the system automatically selects both recordings and displays comparison results without requiring manual selection

---

### Requirement: Comparison Visualizations
The system SHALL display comparative visualizations for selected EO and EC recordings.

#### Scenario: Side-by-side topomaps
- **GIVEN** a comparison is computed
- **WHEN** the comparison results are displayed
- **THEN** for each band, the UI shows three topomaps side-by-side: EO power, EC power, and Delta (EC - EO)

#### Scenario: Delta bar charts
- **GIVEN** a comparison is computed
- **WHEN** the comparison results are displayed
- **THEN** bar charts display power deltas for key metrics (theta/beta ratio, alpha blocking, SMR power) with positive/negative color coding

#### Scenario: Coherence shift heatmap
- **GIVEN** a comparison is computed
- **WHEN** the comparison results are displayed
- **THEN** a heatmap displays coherence changes (EC - EO) for all predefined pairs, with diverging colormap (red = increase, blue = decrease)

#### Scenario: Summary statistics table
- **GIVEN** a comparison is computed
- **WHEN** the comparison results are displayed
- **THEN** a summary table shows key metrics: mean alpha power change (%), alpha blocking EC vs EO, FAA shift, theta/beta ratio change

---

### Requirement: Comparison API Endpoint
The system SHALL provide an API endpoint for retrieving comparison results.

#### Scenario: Fetch comparison via API
- **GIVEN** a user has access to a project
- **WHEN** they send a GET request to `/api/projects/:id/compare?eo_id=<recording_id>&ec_id=<recording_id>`
- **THEN** the API fetches analyses for both recordings, computes deltas, and returns comparison results in JSON format

#### Scenario: Missing analysis error
- **GIVEN** a user requests a comparison
- **WHEN** one or both selected recordings do not have completed analyses
- **THEN** the API returns HTTP 400 with error "Both recordings must have completed analyses for comparison"

#### Scenario: Access control enforcement
- **GIVEN** a user does not have access to the project
- **WHEN** they attempt to fetch comparison results via API
- **THEN** the request is denied with HTTP 403 Forbidden

---

### Requirement: Longitudinal Comparison Support
The system SHALL support comparison of multiple recording pairs over time (e.g., pre/post intervention).

#### Scenario: Multiple EO and EC recordings
- **GIVEN** a project has multiple EO recordings and multiple EC recordings (e.g., baseline, 3-month, 6-month sessions)
- **WHEN** the user selects specific EO and EC recordings for comparison
- **THEN** the system computes the comparison for the selected pair only, not all combinations

#### Scenario: Comparison history
- **GIVEN** a user has compared multiple recording pairs over time
- **WHEN** they view the "Comparison" tab
- **THEN** a dropdown shows previously compared pairs (e.g., "Baseline: EO1 vs EC1", "3-Month: EO2 vs EC2") for quick re-selection

---

### Requirement: Comparison Result Structure
The system SHALL return comparison results in a structured format.

#### Scenario: JSON response structure
- **GIVEN** a comparison is requested
- **WHEN** the API returns results
- **THEN** the response includes top-level keys: `eo_recording_id`, `ec_recording_id`, `power_deltas`, `coherence_deltas`, `asymmetry_deltas`, `summary_metrics`

#### Scenario: Power deltas structure
- **GIVEN** a comparison result is returned
- **WHEN** the `power_deltas` object is inspected
- **THEN** it includes per-channel, per-band absolute and percent change values

#### Scenario: Summary metrics structure
- **GIVEN** a comparison result is returned
- **WHEN** the `summary_metrics` object is inspected
- **THEN** it includes: `mean_alpha_change_percent`, `alpha_blocking_eo`, `alpha_blocking_ec`, `faa_shift`, `theta_beta_change`
