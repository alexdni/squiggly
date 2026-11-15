## ADDED Requirements
### Requirement: Viewer Montage Selection
The EEG viewer SHALL offer the traces as recorded, on the average reference, linked ears, either ear, ipsilateral or contralateral ears, any one scalp electrode, a nearest-neighbour Laplacian, and longitudinal, transverse and circumferential bipolar montages, computed in the browser without re-analysis. It SHALL use TP9/TP10 as the ear leads when the file has no A1/A2 channels. It SHALL disable any montage the recording cannot support and state why.

#### Scenario: Average
- **WHEN** the analyst selects the average montage
- **THEN** each displayed trace is the channel minus the mean of the displayed scalp channels

#### Scenario: Linked ears from ear channels
- **GIVEN** a recording with plain labels and separate A1 and A2 channels
- **WHEN** the analyst selects linked ears
- **THEN** each trace is the channel minus the mean of A1 and A2

#### Scenario: Linked ears unavailable
- **GIVEN** a recording with plain labels and no ear channels, not declared linked ears
- **WHEN** the analyst opens the montage selector
- **THEN** linked ears is disabled with the reason

#### Scenario: Ipsilateral ears
- **GIVEN** a linked-ears recording with an `A2-A1` channel
- **WHEN** the analyst selects ipsilateral ears
- **THEN** left-side channels are referenced to A1, right-side channels to A2, and midline channels stay on linked ears

#### Scenario: One electrode
- **WHEN** the analyst selects Pz under "One electrode"
- **THEN** every other scalp channel is shown minus Pz and the Pz row is not drawn

#### Scenario: Bipolar
- **WHEN** the analyst selects the longitudinal bipolar montage on a 19-channel recording
- **THEN** the rows are the standard chains (Fp1-F7, F7-T7, … , Cz-Pz), labelled as pairs

### Requirement: Time Scrolling
The EEG viewer SHALL let the analyst move through the recording by horizontal wheel or trackpad scroll, Shift+wheel, click-drag on the traces, and the arrow and Page keys, clamped to the recording. Vertical wheel scrolling without Shift SHALL keep scrolling the page.

#### Scenario: Trackpad scroll
- **WHEN** the analyst scrolls horizontally over the traces
- **THEN** the window moves by the scrolled distance in seconds and the time slider follows

#### Scenario: Drag versus click
- **WHEN** the analyst presses, moves less than 4 px and releases on an event band
- **THEN** the band is selected and the window does not move

#### Scenario: Annotate mode
- **WHEN** annotate mode is on
- **THEN** dragging draws an annotation and does not pan
