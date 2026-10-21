## ADDED Requirements

### Requirement: Detected EEG Events
The system SHALL run biofeedback-core event detection during analysis in labels-only mode, store the detected events and the detector coverage with the analysis, and show them on the analysis page without changing any metric.

#### Scenario: Recording with blinks and muscle
- **GIVEN** a 19-channel recording containing eye blinks and a muscle burst
- **WHEN** the analysis completes
- **THEN** `results.events` lists them with pattern, time span, channels, evidence and how the cleaning handled them, and the Detected Events card shows them

#### Scenario: Metrics unchanged by detection
- **GIVEN** any recording
- **WHEN** it is analyzed with event detection on
- **THEN** every metric equals the result with event detection off, apart from epochs restored by the analyst's dismissals

#### Scenario: Detector cannot run on this montage
- **GIVEN** a 4-channel recording without frontal-pole sites
- **WHEN** the analysis completes
- **THEN** the card lists the blink detector as not assessed with its reason, rather than implying no blinks were present

### Requirement: Event Review Decisions
The system SHALL let project owners and collaborators confirm or dismiss a detected event, keep the decision across Re-Analyze, and pass dismissals to the engine on the next run.

#### Scenario: Dismiss a rejection
- **GIVEN** an analyst dismisses an amplitude-ceiling rejection event
- **WHEN** the analysis is re-run
- **THEN** the event is shown as dismissed and the epochs only it excluded are back in the metrics

#### Scenario: Viewer cannot review
- **GIVEN** a project member with the viewer role
- **WHEN** they open the analysis
- **THEN** they see events and decisions but no Confirm/Dismiss controls, and the API refuses their decision with 403
