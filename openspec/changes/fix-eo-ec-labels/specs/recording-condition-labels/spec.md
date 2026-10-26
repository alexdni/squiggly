## ADDED Requirements

### Requirement: EO/EC labels from the filename at upload
On upload, the system SHALL label a recording from its filename when the name contains exactly one
of the EO or EC tokens ("EO", "EC", "eyes open", "eyes closed"). A token counts only with no letter
directly before or after it; the extension does not count. The whole file SHALL be labelled with
that condition.

#### Scenario: Condition token in the name
- **WHEN** a file named "Client AGE47EC.edf" or "EC_.edf" is uploaded
- **THEN** it is labelled eyes closed for its whole duration

#### Scenario: Ambiguous or no token
- **WHEN** a filename names both conditions, or neither (including "EOG", "ECG", "SPEC")
- **THEN** the recording is left unlabelled for the analyst

### Requirement: Editable labels
An analyst with upload permission SHALL be able to set a recording's labels to one of: eyes open
(whole file), eyes closed (whole file), timed EO and EC segments, or none. Segments SHALL lie within
the recording, last at least 10 s and not overlap. Saving SHALL re-run the recording's analysis if it
has run before.

#### Scenario: Relabel an eyes-closed file
- **WHEN** the analyst sets an unlabelled file to eyes closed
- **THEN** the labels are stored, the analysis re-runs, and its results are filed under EC

### Requirement: Consistent condition everywhere
The Recordings tab, analysis view, comparisons and MCP tools SHALL show a recording's results under
its labelled condition. Results computed before the recording was labelled, and filed under the
other condition, SHALL be read under the labelled one. The analysis view SHALL say when the labels
changed after the analysis ran.

#### Scenario: Single-condition file in the Recordings tab
- **WHEN** a recording is labelled eyes open for the whole file
- **THEN** the Recordings tab shows "EO", not "Not labeled"

#### Scenario: Comparison across conditions
- **WHEN** two compared recordings share no condition
- **THEN** the comparison warns that it compares eyes open with eyes closed
