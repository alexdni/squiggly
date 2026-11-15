## ADDED Requirements
### Requirement: Recording Start Time
The system SHALL read the time a recording was made from the uploaded file when the file states it, store it with the recording, and show it wherever the upload date is shown. It SHALL NOT present a placeholder, implausible or relative time as the recording time.

#### Scenario: EDF with a start date and time
- **GIVEN** an EDF whose header start is `10.11.25` `21.53.17`
- **WHEN** it is uploaded
- **THEN** the recording shows "Recorded 10 Nov 2025, 21:53" as written in the file, with no time-zone conversion

#### Scenario: Date without a time
- **GIVEN** an EDF whose header start time is `00.00.00`
- **WHEN** it is uploaded
- **THEN** only the date is stored and shown

#### Scenario: Placeholder date
- **GIVEN** an EDF whose header start date is `01.01.85`
- **WHEN** it is uploaded
- **THEN** no recording time is stored and only the upload date is shown

#### Scenario: CSV with absolute timestamps
- **GIVEN** a CSV whose first timestamp is epoch seconds or an ISO 8601 time
- **WHEN** it is uploaded
- **THEN** that instant is stored and shown in the viewer's time zone

#### Scenario: CSV counting from zero
- **GIVEN** a CSV whose timestamps start near zero
- **WHEN** it is uploaded
- **THEN** no recording time is stored
