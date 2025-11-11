# Export Capability

## ADDED Requirements

### Requirement: PDF Report Generation
The system SHALL generate a comprehensive PDF report with summary visuals and risk assessment.

#### Scenario: PDF structure
- **GIVEN** an analysis completes successfully
- **WHEN** a PDF export is requested
- **THEN** the PDF includes: (1) cover page with recording metadata (date, duration, conditions), (2) QC summary, (3) topomaps (one page per band showing EO/EC/Delta), (4) coherence matrices (one page per band), (5) APF and ratio charts, (6) risk assessment panel, (7) footer with disclaimer and generation timestamp

#### Scenario: PDF generation time
- **GIVEN** all visual assets (PNGs) are pre-rendered
- **WHEN** PDF generation starts
- **THEN** the PDF is assembled and available for download within 5 seconds

#### Scenario: PDF visual quality
- **GIVEN** topomap and coherence matrix PNGs are rendered at 300 DPI
- **WHEN** the PDF is generated
- **THEN** all embedded images maintain 300 DPI resolution for print quality

#### Scenario: PDF disclaimer
- **GIVEN** a PDF report is generated
- **WHEN** the PDF is opened
- **THEN** the footer on every page reads: "Educational/research use only. Not for clinical diagnosis. Generated with EEG EO/EC Diagnostics [version] on [date]."

#### Scenario: Metadata inclusion
- **GIVEN** an analysis has associated metadata (subject ID, session date, notes)
- **WHEN** the PDF is generated
- **THEN** the cover page includes all metadata fields provided during upload

---

### Requirement: JSON Data Export
The system SHALL export all computed features and metadata in structured JSON format.

#### Scenario: JSON structure
- **GIVEN** an analysis completes
- **WHEN** JSON export is requested
- **THEN** the JSON includes top-level keys: `metadata`, `config`, `qc`, `features`, `visuals`, `risks`

#### Scenario: Features section completeness
- **GIVEN** JSON export is generated
- **WHEN** the `features` object is inspected
- **THEN** it includes: `psd_abs`, `psd_rel`, `ratios`, `apf`, `reactivity`, `coherence`, `lzc`, `asymmetry`, `faa` with all channel-level and aggregate values

#### Scenario: Visual asset URLs
- **GIVEN** visual assets (topomap PNGs, coherence matrices) are stored in Supabase Storage
- **WHEN** JSON export is generated
- **THEN** the `visuals` object includes signed URLs (valid for 1 hour) for each PNG asset

#### Scenario: JSON download
- **GIVEN** a user clicks "Export JSON" button
- **WHEN** the request is processed
- **THEN** a JSON file named `analysis_[recording_id]_[timestamp].json` is downloaded to the user's device

#### Scenario: JSON validation
- **GIVEN** JSON export is generated
- **WHEN** the JSON is parsed
- **THEN** the structure conforms to a predefined JSON schema (validated server-side before serving)

---

### Requirement: PNG Asset Export
The system SHALL allow individual export of visual assets.

#### Scenario: Export single topomap
- **GIVEN** a topomap is displayed in the UI
- **WHEN** the user clicks "Export PNG" on the topomap
- **THEN** a PNG file named `topomap_[band]_[condition]_[timestamp].png` is downloaded at 300 DPI

#### Scenario: Export coherence matrix
- **GIVEN** a coherence matrix is displayed
- **WHEN** the user clicks "Export PNG"
- **THEN** a PNG file named `coherence_matrix_[band]_[timestamp].png` is downloaded

#### Scenario: Batch export all visuals
- **GIVEN** an analysis has generated 30+ visual assets (topomaps, matrices, spectrograms)
- **WHEN** the user clicks "Export All Visuals"
- **THEN** a ZIP archive containing all PNG files is generated and downloaded

---

### Requirement: Export Access Control
The system SHALL enforce project-level access control for exports.

#### Scenario: Owner/editor export
- **GIVEN** a user is an owner or editor of a project
- **WHEN** the user requests PDF or JSON export for a recording in that project
- **THEN** the export is allowed and generated

#### Scenario: Viewer export
- **GIVEN** a user is a viewer (read-only collaborator) of a project
- **WHEN** the user requests PDF or JSON export
- **THEN** the export is allowed (viewers can download results but not modify or re-run analyses)

#### Scenario: Unauthorized export attempt
- **GIVEN** a user is not a member of a project
- **WHEN** the user attempts to export an analysis from that project
- **THEN** the request is denied with HTTP 403 Forbidden

---

### Requirement: Export Metadata Logging
The system SHALL log all export events for auditing.

#### Scenario: Export event log
- **GIVEN** a user exports a PDF or JSON
- **WHEN** the export completes
- **THEN** a log entry is created with: user_id, recording_id, export_type (PDF/JSON/PNG), timestamp, IP address

#### Scenario: Export history display
- **GIVEN** a user views a recording's details page
- **WHEN** the page loads
- **THEN** an "Export History" section shows past exports with timestamp and type

---

### Requirement: Export Configuration Options
The system SHALL allow users to customize export contents.

#### Scenario: PDF with/without raw data tables
- **GIVEN** a user requests a PDF export
- **WHEN** the user toggles "Include raw data tables" option
- **THEN** the PDF includes (or excludes) appendix pages with per-channel PSD and coherence tables

#### Scenario: JSON with/without visual URLs
- **GIVEN** a user requests a JSON export
- **WHEN** the user toggles "Include visual asset URLs" option
- **THEN** the JSON `visuals` object is included or omitted accordingly

#### Scenario: Export subset of bands
- **GIVEN** a user selects specific bands (e.g., only alpha1, alpha2, beta2) in export settings
- **WHEN** PDF export is requested
- **THEN** only topomaps and coherence matrices for selected bands are included in the PDF

---

### Requirement: Retry and Error Handling
The system SHALL handle export failures gracefully and allow retries.

#### Scenario: Transient export failure
- **GIVEN** PDF generation fails due to temporary storage unavailability
- **WHEN** the failure is detected
- **THEN** the system retries up to 3 times with exponential backoff (1s, 2s, 4s)

#### Scenario: Permanent export failure
- **GIVEN** PDF generation fails after 3 retries
- **WHEN** the final retry fails
- **THEN** the user is shown error message "Export failed. Please try again later or contact support." and the error is logged with full stack trace

#### Scenario: User-initiated retry
- **GIVEN** an export failed
- **WHEN** the user clicks "Retry Export"
- **THEN** the export process is re-initiated immediately

---

### Requirement: Export File Naming
The system SHALL use consistent, descriptive file naming conventions.

#### Scenario: PDF naming
- **GIVEN** a PDF export is generated
- **WHEN** the file is saved
- **THEN** the filename follows format: `eeg_report_[subject_id]_[session_date]_[timestamp].pdf` (e.g., `eeg_report_subj001_2025-11-10_1699633200.pdf`)

#### Scenario: JSON naming
- **GIVEN** a JSON export is generated
- **WHEN** the file is saved
- **THEN** the filename follows format: `eeg_data_[recording_id]_[timestamp].json`

#### Scenario: PNG naming
- **GIVEN** an individual visual asset is exported
- **WHEN** the file is saved
- **THEN** the filename includes visual type, band (if applicable), condition, and timestamp (e.g., `topomap_alpha1_EC_1699633200.png`)

---

### Requirement: Export Performance
The system SHALL optimize export generation for minimal latency.

#### Scenario: PDF generation from cached assets
- **GIVEN** all visual assets are pre-rendered and stored in Supabase Storage
- **WHEN** a PDF export is requested
- **THEN** the PDF is assembled from cached PNGs without re-rendering visuals

#### Scenario: Concurrent export requests
- **GIVEN** multiple users request exports simultaneously
- **WHEN** exports are queued
- **THEN** each export completes independently without blocking others, with <10 second latency under normal load (<50 concurrent requests)

#### Scenario: Large recording export
- **GIVEN** a recording with 20 minutes of EEG data and 50+ visual assets
- **WHEN** a full PDF + JSON + ZIP export is requested
- **THEN** the export completes within 30 seconds
