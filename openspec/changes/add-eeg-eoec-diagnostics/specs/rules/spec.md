# Rules Capability

## ADDED Requirements

### Requirement: Rule Engine Framework
The system SHALL evaluate heuristic rules for neurophysiological patterns using within-subject percentile thresholds.

#### Scenario: Percentile calculation
- **GIVEN** a feature set (e.g., theta/beta ratios across all channels)
- **WHEN** percentiles are computed
- **THEN** the system calculates p10 (10th percentile), p50 (median), and p90 (90th percentile) across the feature distribution for the subject

#### Scenario: Threshold configuration
- **GIVEN** a rule requiring a configurable threshold (e.g., `t_alpha_block_min`)
- **WHEN** the rule is evaluated
- **THEN** the threshold value is loaded from job config (default: `t_alpha_block_min=20`, `t_faa_abs=0.05`)

#### Scenario: Rule evaluation
- **GIVEN** a rule with "any" conditions (at least one must be true) and "optional" conditions (increase confidence if true)
- **WHEN** the rule is evaluated
- **THEN** the system returns "high" if ≥1 "any" condition + ≥1 "optional" condition are met, "medium" if only "any" conditions met, "low" if no "any" conditions met

#### Scenario: Traceable criteria
- **GIVEN** a rule evaluation completes
- **WHEN** the result is stored
- **THEN** the system logs which specific conditions fired (e.g., "ratios.theta_beta.Fz=5.2 > p90=4.8") to enable transparency

---

### Requirement: ADHD-Like Pattern Rule
The system SHALL evaluate patterns consistent with ADHD-like EEG signatures.

#### Scenario: Elevated theta/beta at Fz
- **GIVEN** theta/beta ratio at Fz is above the 90th percentile (p90) across all sites
- **WHEN** the ADHD-like rule is evaluated
- **THEN** this condition is marked as true and contributes to "any" criteria

#### Scenario: Elevated theta/beta at Cz
- **GIVEN** theta/beta ratio at Cz is above p90
- **WHEN** the ADHD-like rule is evaluated
- **THEN** this condition is marked as true and contributes to "any" criteria

#### Scenario: Low SMR at Cz
- **GIVEN** SMR power at Cz is below the 10th percentile (p10) across all channels
- **WHEN** the ADHD-like rule is evaluated
- **THEN** this condition is marked as true and contributes to "any" criteria

#### Scenario: Low frontoparietal beta coherence
- **GIVEN** beta coherence for frontoparietal pairs (e.g., F3-P3, F4-P4) is below p10
- **WHEN** the ADHD-like rule is evaluated
- **THEN** this condition is marked as true and contributes to "optional" criteria

#### Scenario: Weak alpha blocking
- **GIVEN** posterior alpha blocking percentage is below `t_alpha_block_min` (default 20%)
- **WHEN** the ADHD-like rule is evaluated
- **THEN** this condition is marked as true and contributes to "optional" criteria

#### Scenario: ADHD-like result reporting
- **GIVEN** ADHD-like rule evaluation completes with 1 "any" + 1 "optional" condition true
- **WHEN** the result is displayed
- **THEN** the system shows level "high" with trace listing the fired conditions

---

### Requirement: Anxiety-Like Pattern Rule
The system SHALL evaluate patterns consistent with anxiety-like EEG signatures.

#### Scenario: Elevated global hi-beta power
- **GIVEN** global (mean across channels) hi-beta power is above p90
- **WHEN** the anxiety-like rule is evaluated
- **THEN** this condition is marked as true and contributes to "any" criteria

#### Scenario: Elevated interhemispheric beta coherence
- **GIVEN** mean beta coherence for interhemispheric pairs is above p90
- **WHEN** the anxiety-like rule is evaluated
- **THEN** this condition is marked as true and contributes to "any" criteria

#### Scenario: Weak posterior alpha reactivity
- **GIVEN** posterior alpha suppression (EC→EO) is below `t_alpha_block_min`
- **WHEN** the anxiety-like rule is evaluated
- **THEN** this condition is marked as true and contributes to "optional" criteria

#### Scenario: Elevated frontal LZC, reduced posterior LZC
- **GIVEN** frontal LZC (EO) is above p90 AND posterior LZC (EC) is below median
- **WHEN** the anxiety-like rule is evaluated
- **THEN** this condition is marked as true and contributes to "optional" criteria

---

### Requirement: Depression-Like Pattern Rule
The system SHALL evaluate patterns consistent with depression-like EEG signatures.

#### Scenario: Negative FAA
- **GIVEN** Frontal Alpha Asymmetry (FAA) value is less than `-t_faa_abs` (default -0.05, indicating left > right alpha, reduced right activity)
- **WHEN** the depression-like rule is evaluated
- **THEN** this condition is marked as true and contributes to "any" criteria

#### Scenario: Low posterior APF
- **GIVEN** mean posterior APF is below p10 across posterior channels
- **WHEN** the depression-like rule is evaluated
- **THEN** this condition is marked as true and contributes to "any" criteria

#### Scenario: Elevated slowing index
- **GIVEN** global slowing index (delta+theta)/(alpha+beta) is above p90
- **WHEN** the depression-like rule is evaluated
- **THEN** this condition is marked as true and contributes to "any" criteria

#### Scenario: Low EC alpha with weak blocking
- **GIVEN** global EC alpha power is below median AND alpha blocking is below `t_alpha_block_min`
- **WHEN** the depression-like rule is evaluated
- **THEN** this condition is marked as true and contributes to "optional" criteria

---

### Requirement: Sleep Dysregulation-Like Pattern Rule
The system SHALL evaluate patterns consistent with sleep dysregulation signatures.

#### Scenario: Elevated global delta during wakefulness
- **GIVEN** global delta power (mean across channels) is above p90
- **WHEN** the sleep dysregulation rule is evaluated
- **THEN** this condition is marked as true and contributes to "any" criteria

#### Scenario: Elevated global theta during wakefulness
- **GIVEN** global theta power is above p90
- **WHEN** the sleep dysregulation rule is evaluated
- **THEN** this condition is marked as true and contributes to "any" criteria

#### Scenario: Low posterior APF
- **GIVEN** mean posterior APF is below p10
- **WHEN** the sleep dysregulation rule is evaluated
- **THEN** this condition is marked as true and contributes to "any" criteria

#### Scenario: Weak posterior alpha reactivity
- **GIVEN** posterior alpha suppression (EC→EO) is below `t_alpha_block_min`
- **WHEN** the sleep dysregulation rule is evaluated
- **THEN** this condition is marked as true and contributes to "optional" criteria

#### Scenario: Low posterior alpha coherence
- **GIVEN** mean alpha coherence for posterior pairs (P3-P4, O1-O2) is below p10
- **WHEN** the sleep dysregulation rule is evaluated
- **THEN** this condition is marked as true and contributes to "optional" criteria

---

### Requirement: Hyper-Arousal-Like Pattern Rule
The system SHALL evaluate patterns consistent with hyper-arousal signatures.

#### Scenario: Elevated global hi-beta
- **GIVEN** global hi-beta power is above p90
- **WHEN** the hyper-arousal rule is evaluated
- **THEN** this condition is marked as true and contributes to "any" criteria

#### Scenario: Elevated frontal beta2
- **GIVEN** frontal beta2 power (mean across frontal channels) is above p90
- **WHEN** the hyper-arousal rule is evaluated
- **THEN** this condition is marked as true and contributes to "any" criteria

#### Scenario: Low EC alpha globally
- **GIVEN** global EC alpha power is below median
- **WHEN** the hyper-arousal rule is evaluated
- **THEN** this condition is marked as true and contributes to "optional" criteria

#### Scenario: Very weak posterior alpha reactivity
- **GIVEN** posterior alpha suppression is much less than `t_alpha_block_min` (e.g., <10% when threshold is 20%)
- **WHEN** the hyper-arousal rule is evaluated
- **THEN** this condition is marked as true and contributes to "optional" criteria

#### Scenario: Elevated global EO LZC
- **GIVEN** global LZC in EO condition is above p90
- **WHEN** the hyper-arousal rule is evaluated
- **THEN** this condition is marked as true and contributes to "optional" criteria

---

### Requirement: Risk Panel Visualization
The system SHALL display a summary panel showing risk levels for all patterns.

#### Scenario: Risk panel layout
- **GIVEN** all five rules have been evaluated
- **WHEN** the risk panel is displayed
- **THEN** the panel shows a card for each pattern (ADHD-like, Anxiety-like, Depression-like, Sleep Dysregulation, Hyper-Arousal) with level (Low/Medium/High) and color coding (green/yellow/red)

#### Scenario: Expandable criteria trace
- **GIVEN** a rule evaluated as "high"
- **WHEN** the user clicks on the pattern card
- **THEN** the panel expands to show the traceable criteria (which "any" and "optional" conditions fired, with values and thresholds)

#### Scenario: Disclaimer notice
- **GIVEN** the risk panel is displayed
- **WHEN** the page loads
- **THEN** a prominent disclaimer is shown above the panel: "Educational/research use only. Not for clinical diagnosis."

---

### Requirement: Rule Configuration
The system SHALL allow users to customize rule thresholds via job configuration.

#### Scenario: Custom threshold in job config
- **GIVEN** a user specifies `{"ruleset": "v1", "thresholds": {"t_alpha_block_min": 25, "t_faa_abs": 0.08}}`
- **WHEN** the analysis runs
- **THEN** rules use the custom thresholds instead of defaults

#### Scenario: Rule version validation
- **GIVEN** a user specifies `{"ruleset": "v2"}`
- **WHEN** the job is submitted
- **THEN** the system rejects the job with error "Unsupported ruleset version: v2. Available: v1."

---

### Requirement: Rule Export in Results
The system SHALL include rule evaluation results in JSON and PDF exports.

#### Scenario: JSON export of rules
- **GIVEN** an analysis completes with rule evaluations
- **WHEN** the JSON export is generated
- **THEN** the JSON includes a `risks` object with structure:
```json
{
  "adhd_like": {"level": "high", "trace": ["ratios.theta_beta.Fz=5.2 > p90=4.8", ...]},
  "anxiety_like": {"level": "medium", "trace": [...]},
  ...
}
```

#### Scenario: PDF export of rules panel
- **GIVEN** an analysis completes
- **WHEN** the PDF export is generated
- **THEN** the PDF includes a "Risk Assessment" section with the visual risk panel (cards with levels and expanded traces) and disclaimer
