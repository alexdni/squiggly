# Visualization Capability

## ADDED Requirements

### Requirement: Topographic Brainmaps
The system SHALL render topographic head maps showing spatial distribution of power, LZC, and asymmetry.

#### Scenario: Band power topomaps
- **GIVEN** absolute power computed for all channels and bands
- **WHEN** topomaps are generated for a selected band (e.g., alpha1)
- **THEN** three topomap PNGs are rendered: (1) EO condition, (2) EC condition, (3) delta (EC - EO), using standard 10-20 head model with interpolation

#### Scenario: Consistent color scales
- **GIVEN** topomaps for EO and EC conditions in the same band
- **WHEN** the maps are rendered
- **THEN** both maps use the same color scale (min/max determined by global min/max across EO+EC) to allow direct comparison

#### Scenario: Tooltips on interactive view
- **GIVEN** a topomap is displayed in the web UI
- **WHEN** the user hovers over a channel location
- **THEN** a tooltip displays the channel label and exact power value in µV²

#### Scenario: LZC headmaps
- **GIVEN** LZC computed for all channels
- **WHEN** LZC topomaps are generated
- **THEN** three topomap PNGs are rendered: (1) EO LZC, (2) EC LZC, (3) delta_LZC (EO - EC)

#### Scenario: Asymmetry (PAI) headmaps
- **GIVEN** PAI computed for a band
- **WHEN** asymmetry topomaps are generated
- **THEN** a single topomap PNG is rendered showing PAI values with diverging color scale (blue = left dominance, red = right dominance)

---

### Requirement: Spectrograms
The system SHALL generate time-frequency spectrograms for individual channels and regional averages.

#### Scenario: Per-channel spectrogram
- **GIVEN** preprocessed continuous data for a channel
- **WHEN** spectrogram is generated using Welch or CWT method (0.5-45 Hz, time resolution 1 second)
- **THEN** a PNG heatmap is rendered with time on X-axis, frequency on Y-axis, and power in color scale

#### Scenario: Regional spectrograms
- **GIVEN** preprocessed data for all channels
- **WHEN** regional spectrograms are requested (Frontal, Central, Parietal, Occipital, Temporal)
- **THEN** average spectrograms are computed by averaging power across channels in each region and rendered as separate PNGs

#### Scenario: EO vs EC overlay
- **GIVEN** spectrograms for EO and EC conditions
- **WHEN** overlay view is selected
- **THEN** the UI displays both spectrograms side-by-side or as an overlaid plot with distinct color maps

#### Scenario: Epoch rejection overlay
- **GIVEN** epoch rejection markers from preprocessing
- **WHEN** a per-channel spectrogram is displayed
- **THEN** rejected epochs are marked with semi-transparent red vertical bars on the time axis

---

### Requirement: Coherence Visualizations
The system SHALL display coherence matrices and pair-wise coherence bars.

#### Scenario: Band-specific coherence matrix
- **GIVEN** coherence computed for all predefined pairs in a band (e.g., alpha1)
- **WHEN** a coherence matrix is generated
- **THEN** a 12×12 matrix PNG is rendered (rows/cols = 12 default pairs) with color-coded coherence values (0-1 scale)

#### Scenario: Interhemispheric coherence bars
- **GIVEN** coherence for interhemispheric pairs (Fp1-Fp2, F3-F4, C3-C4, P3-P4, O1-O2, T7-T8)
- **WHEN** bar chart is generated
- **THEN** horizontal bars show coherence per pair, with EO and EC as grouped bars for comparison

#### Scenario: Hyper/hypo badges
- **GIVEN** coherence pairs flagged as hyper or hypo (>p90 or <p10)
- **WHEN** the coherence matrix or bar chart is displayed
- **THEN** flagged pairs are annotated with badge icons (upward arrow for hyper, downward arrow for hypo)

---

### Requirement: Ratio and Reactivity Panels
The system SHALL visualize key band ratios and EO/EC reactivity metrics.

#### Scenario: Theta/Beta panels
- **GIVEN** theta/beta ratios computed for Fz, Cz, F3, F4
- **WHEN** the ratio panel is displayed
- **THEN** a bar chart shows ratios per site with EO and EC as grouped bars, and a horizontal reference line at the subject's 90th percentile

#### Scenario: Alpha blocking gauge
- **GIVEN** alpha blocking percentage computed for posterior region
- **WHEN** the gauge is displayed
- **THEN** a circular gauge (0-100%) shows the blocking percentage with color zones: green (>30%), yellow (20-30%), red (<20%)

#### Scenario: APF distribution chart
- **GIVEN** APF detected for posterior channels (O1, O2, Pz, P3, P4)
- **WHEN** the APF chart is displayed
- **THEN** a scatter plot shows APF per channel for EO and EC conditions, with lines connecting the same channel across conditions

---

### Requirement: QC Dashboard
The system SHALL provide a visual quality control summary.

#### Scenario: Channels dropped
- **GIVEN** bad channels detected during preprocessing
- **WHEN** the QC dashboard is displayed
- **THEN** a list shows excluded channel labels with reasons (flatline, extreme variance, low correlation)

#### Scenario: Artifact epoch percentage
- **GIVEN** artifact rejection statistics
- **WHEN** the QC dashboard is displayed
- **THEN** a pie chart shows percentage of kept vs rejected epochs, with color-coded warning if >40% rejected

#### Scenario: ICA components removed
- **GIVEN** ICA components flagged for removal
- **WHEN** the QC dashboard is displayed
- **THEN** a table lists each removed component with: (1) index, (2) artifact tag (blink/ECG/EMG/motion), (3) confidence score, and (4) thumbnail of component topography

#### Scenario: Pre/post ICA power comparison
- **GIVEN** power computed before and after ICA removal
- **WHEN** the QC dashboard is displayed
- **THEN** a line chart shows delta and alpha power at Fp1/Fp2 (frontal) and O1/O2 (posterior) before and after ICA, with annotations if delta decreased >20% or alpha changed >10%

---

### Requirement: Interactive Visualization Controls
The system SHALL provide user controls to customize visualizations.

#### Scenario: Band selection
- **GIVEN** topomaps and coherence matrices available for all 8 bands
- **WHEN** the user selects a band from a dropdown (delta, theta, alpha1, alpha2, SMR, beta2, hi-beta, low-gamma)
- **THEN** all band-dependent visuals (topomaps, coherence matrix) update to show the selected band

#### Scenario: Condition toggle
- **GIVEN** visuals available for EO, EC, and delta (EC-EO)
- **WHEN** the user toggles a radio button (EO / EC / Delta)
- **THEN** topomaps and spectrograms update to show the selected condition

#### Scenario: Channel selection for spectrogram
- **GIVEN** per-channel spectrograms available for all 19 channels
- **WHEN** the user selects a channel from a dropdown or headmap click
- **THEN** the spectrogram panel updates to display the selected channel's time-frequency plot

#### Scenario: Export individual visuals
- **GIVEN** a topomap or coherence matrix is displayed
- **WHEN** the user clicks an "Export PNG" button
- **THEN** the system downloads the current visualization as a high-resolution PNG file

---

### Requirement: Responsive and Accessible Design
The system SHALL ensure visualizations are readable across devices and accessible to users with visual impairments.

#### Scenario: Mobile responsiveness
- **GIVEN** the visualization dashboard is accessed on a mobile device (screen width <768px)
- **WHEN** the page loads
- **THEN** charts and topomaps scale to fit the screen width and stack vertically without horizontal scrolling

#### Scenario: Color-blind friendly palettes
- **GIVEN** topomaps and coherence matrices use color scales
- **WHEN** color palettes are selected
- **THEN** the system uses perceptually uniform and color-blind safe palettes (e.g., viridis, plasma) by default, with option to toggle to grayscale

#### Scenario: Keyboard navigation
- **GIVEN** interactive controls (band selector, channel selector)
- **WHEN** a user navigates using keyboard (Tab, Enter)
- **THEN** all controls are reachable and operable without a mouse

#### Scenario: Alt text for visual assets
- **GIVEN** topomap and coherence matrix PNGs rendered for PDF export
- **WHEN** the images are embedded in HTML or PDF
- **THEN** each image includes descriptive alt text (e.g., "Alpha1 power topographic map, Eyes Closed condition")
