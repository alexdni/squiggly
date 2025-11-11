# Features Capability

## ADDED Requirements

### Requirement: Power Spectral Density (PSD) Computation
The system SHALL compute absolute and relative power for each channel, band, and condition (EO/EC).

#### Scenario: Absolute power computation
- **GIVEN** preprocessed epochs for EO and EC conditions
- **WHEN** PSD computation runs with Welch method (2-second window, 50% overlap)
- **THEN** absolute power (µV²/Hz) is computed for each of 8 bands (delta, theta, alpha1, alpha2, SMR, beta2, hi-beta, low-gamma) per channel per condition

#### Scenario: Relative power computation
- **GIVEN** absolute power values for all bands
- **WHEN** relative power is calculated
- **THEN** relative power for each band = absolute power / total power (sum of all bands), ensuring sum across bands = 1.0 per channel

#### Scenario: Regional aggregates
- **GIVEN** absolute power computed for all 19 channels
- **WHEN** regional aggregates are calculated
- **THEN** mean power is computed for Frontal (Fp1, Fp2, F3, F4, F7, F8, Fz), Central (C3, C4, Cz), Parietal (P3, P4, P7, P8, Pz), Occipital (O1, O2), and Temporal (T7, T8) regions

---

### Requirement: Band Ratios
The system SHALL compute clinically relevant band ratios at specific sites.

#### Scenario: Theta/Beta ratio
- **GIVEN** absolute power for theta and beta2 bands
- **WHEN** theta/beta ratio is calculated
- **THEN** the ratio is computed for Fz, Cz, F3, and F4 as `theta_power / beta2_power`

#### Scenario: Theta/Alpha ratio
- **GIVEN** absolute power for theta and combined alpha (alpha1 + alpha2)
- **WHEN** theta/alpha ratio is calculated
- **THEN** the ratio is computed globally (mean across all channels)

#### Scenario: Slowing index
- **GIVEN** absolute power for delta, theta, alpha (alpha1 + alpha2), and beta (SMR + beta2 + hi-beta)
- **WHEN** slowing index is calculated
- **THEN** the index is computed as `(delta + theta) / (alpha + beta)` globally

---

### Requirement: Alpha Peak Frequency (APF)
The system SHALL detect the dominant frequency in the alpha band for posterior channels.

#### Scenario: APF detection
- **GIVEN** PSD computed for EC condition at O1, O2, Pz, P3, P4
- **WHEN** APF detection runs using center-of-gravity method in 8-12 Hz range
- **THEN** APF is reported for each posterior channel with values typically in 9-11 Hz range

#### Scenario: EC to EO APF stability
- **GIVEN** APF detected for both EC and EO conditions
- **WHEN** APF shift is calculated
- **THEN** the system reports APF_EC, APF_EO, and delta_APF = APF_EO - APF_EC for each posterior channel

#### Scenario: Absent or flat alpha peak
- **GIVEN** a channel with no clear alpha peak (flat or multi-modal spectrum in 8-12 Hz)
- **WHEN** APF detection runs
- **THEN** the system flags APF as "not detected" and logs a warning

---

### Requirement: Alpha Blocking
The system SHALL quantify posterior alpha suppression from EC to EO conditions.

#### Scenario: Alpha blocking calculation
- **GIVEN** alpha power (alpha1 + alpha2) for EC and EO at posterior channels (O1, O2, Pz, P3, P4)
- **WHEN** alpha blocking is calculated
- **THEN** blocking percentage = `(alpha_EC - alpha_EO) / alpha_EC * 100` is computed per channel and averaged across posterior region

#### Scenario: Normal alpha blocking
- **GIVEN** alpha blocking percentage >20% in posterior region
- **WHEN** the result is evaluated
- **THEN** alpha blocking is flagged as "normal"

#### Scenario: Weak alpha blocking
- **GIVEN** alpha blocking percentage <20% in posterior region
- **WHEN** the result is evaluated
- **THEN** alpha blocking is flagged as "weak" and noted in the QC report

---

### Requirement: SMR Power
The system SHALL compute sensorimotor rhythm (SMR) power at central sites.

#### Scenario: SMR computation
- **GIVEN** absolute power for SMR band (12-15 Hz)
- **WHEN** SMR power is extracted
- **THEN** SMR values are reported for C3, C4, and Cz for both EO and EC conditions

---

### Requirement: Reactivity Metrics
The system SHALL compute EC→EO change for each band and site.

#### Scenario: Absolute change
- **GIVEN** band power for EC and EO at a given channel
- **WHEN** reactivity is calculated
- **THEN** delta = EC_power - EO_power is computed

#### Scenario: Percent change
- **GIVEN** band power for EC and EO at a given channel
- **WHEN** percent reactivity is calculated
- **THEN** percent_change = `(EO_power - EC_power) / EC_power * 100` is computed

---

### Requirement: Coherence Computation
The system SHALL compute magnitude-squared coherence for predefined channel pairs.

#### Scenario: Interhemispheric coherence
- **GIVEN** preprocessed epochs for EO and EC
- **WHEN** coherence is computed for interhemispheric pairs (Fp1-Fp2, F3-F4, C3-C4, P3-P4, O1-O2, T7-T8)
- **THEN** coherence is computed per band per pair per condition using Welch method

#### Scenario: Long-range coherence
- **GIVEN** preprocessed epochs
- **WHEN** coherence is computed for long-range pairs (F3-P3, F3-O1, F4-P4, F4-O2, Fz-Pz, Cz-Pz)
- **THEN** coherence is computed per band per pair per condition

#### Scenario: Hyper-coherence flagging
- **GIVEN** coherence values computed for all pairs in a band
- **WHEN** a pair's coherence exceeds the 90th percentile across all pairs in that band
- **THEN** the pair is flagged as "hyper-coherent" for that band

#### Scenario: Hypo-coherence flagging
- **GIVEN** coherence values computed for all pairs in a band
- **WHEN** a pair's coherence falls below the 10th percentile across all pairs in that band
- **THEN** the pair is flagged as "hypo-coherent" for that band

---

### Requirement: Lempel-Ziv Complexity (LZC)
The system SHALL compute LZC per channel as a measure of signal complexity.

#### Scenario: LZC computation
- **GIVEN** preprocessed epochs for EO and EC
- **WHEN** LZC is computed using binary median-threshold method
- **THEN** LZC is reported per channel per condition (values typically 0.4-0.8)

#### Scenario: EO vs EC LZC delta
- **GIVEN** LZC computed for both conditions
- **WHEN** delta_LZC is calculated
- **THEN** delta_LZC = LZC_EO - LZC_EC is reported per channel

#### Scenario: Anterior-posterior LZC gradient
- **GIVEN** LZC values for all channels
- **WHEN** gradient is calculated
- **THEN** anterior LZC (mean of Fp1, Fp2, F3, F4, Fz) minus posterior LZC (mean of O1, O2, Pz, P3, P4) is reported per condition

---

### Requirement: Power Asymmetry Index (PAI)
The system SHALL compute left-right power asymmetry for homologous channel pairs.

#### Scenario: PAI computation
- **GIVEN** band power for homologous pairs (F3-F4, C3-C4, P3-P4, O1-O2, T7-T8, Fp1-Fp2)
- **WHEN** PAI is calculated per band per pair
- **THEN** PAI = `(Left - Right) / (Left + Right)` is computed (positive = left dominance, negative = right dominance)

#### Scenario: PAI range validation
- **GIVEN** PAI computed for a pair
- **WHEN** the result is validated
- **THEN** PAI values are in range [-1, 1] and the system logs a warning if any value is outside [-0.5, 0.5] indicating extreme asymmetry

---

### Requirement: Frontal Alpha Asymmetry (FAA)
The system SHALL compute FAA as a marker of approach-withdrawal tendencies.

#### Scenario: FAA computation
- **GIVEN** alpha power (alpha1 + alpha2) for F3 and F4 in EC condition
- **WHEN** FAA is calculated
- **THEN** FAA = `log(alpha_F4) - log(alpha_F3)` is computed (positive = greater left activity, negative = greater right activity)

#### Scenario: FAA interpretation flag
- **GIVEN** FAA value computed
- **WHEN** FAA < -0.05 (threshold configurable)
- **THEN** the system flags "left > right alpha" with note "reduced right frontal activity (potential depression marker)"

---

### Requirement: Anterior-Posterior Gradient
The system SHALL compute anterior-posterior alpha power gradients.

#### Scenario: EC gradient
- **GIVEN** alpha power for anterior (Fp1, Fp2, F3, F4, Fz) and posterior (O1, O2, Pz, P3, P4) regions in EC
- **WHEN** gradient is calculated
- **THEN** gradient = posterior_alpha - anterior_alpha is reported (expected: positive, indicating posterior dominance)

#### Scenario: EO attenuation
- **GIVEN** alpha power for posterior region in EO
- **WHEN** compared to EC
- **THEN** attenuation = `(posterior_alpha_EC - posterior_alpha_EO) / posterior_alpha_EC` is reported
