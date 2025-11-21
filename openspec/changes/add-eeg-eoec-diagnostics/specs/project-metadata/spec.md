# Project Metadata Capability

## ADDED Requirements

### Requirement: Client Demographic Storage
The system SHALL store client demographic and clinical metadata at the project level.

#### Scenario: Store basic client information
- **GIVEN** a project owner or collaborator views a project
- **WHEN** they enter client metadata (diagnosis, primary issue, secondary issue, gender, age, interventions)
- **THEN** the metadata is persisted to the `projects.client_metadata` JSONB column

#### Scenario: Age validation
- **GIVEN** a user enters client age
- **WHEN** the age is less than 0 or greater than 150
- **THEN** the system rejects the input with error "Age must be between 0 and 150"

#### Scenario: Gender enum validation
- **GIVEN** a user selects client gender
- **WHEN** the selected value is not one of ('male', 'female', 'other', 'unknown')
- **THEN** the system rejects the input with error "Invalid gender value"

---

### Requirement: EDF Header Auto-Extraction
The system SHALL attempt to extract patient demographic data from EDF headers when available.

#### Scenario: Extract age from EDF patient DOB
- **GIVEN** an EDF file with patient date of birth in the header
- **WHEN** the file is uploaded as the first recording in a project
- **THEN** the system calculates age from DOB and auto-populates the project's age field

#### Scenario: Extract gender from EDF header
- **GIVEN** an EDF file with patient gender in the header ('M', 'F', 'Male', 'Female')
- **WHEN** the file is uploaded as the first recording in a project
- **THEN** the system maps the header value to the gender enum and auto-populates the project's gender field

#### Scenario: Manual override of auto-extracted values
- **GIVEN** age and gender were auto-extracted from EDF header
- **WHEN** the user manually edits these fields
- **THEN** the manual values override the auto-extracted values

#### Scenario: Missing demographic data in EDF
- **GIVEN** an EDF file without patient DOB or gender in the header
- **WHEN** the file is uploaded
- **THEN** the system leaves age and gender fields empty and prompts user to enter manually

---

### Requirement: Access Control for Metadata Editing
The system SHALL enforce role-based access control for client metadata editing.

#### Scenario: Owner and collaborator edit permissions
- **GIVEN** a user is an owner or collaborator of a project
- **WHEN** they access the project details page
- **THEN** they can edit all client metadata fields

#### Scenario: Viewer read-only access
- **GIVEN** a user is a viewer of a project
- **WHEN** they access the project details page
- **THEN** they can view client metadata but cannot edit any fields

#### Scenario: Unauthenticated user access denial
- **GIVEN** a user is not authenticated
- **WHEN** they attempt to access project metadata via API
- **THEN** the request is denied with HTTP 401 Unauthorized

---

### Requirement: Metadata Display in UI
The system SHALL display client metadata in a dedicated section on the project details page.

#### Scenario: Collapsible client information section
- **GIVEN** a user views a project details page
- **WHEN** the page loads
- **THEN** a "Client Information" section is displayed with collapsible toggle

#### Scenario: Read-only display for viewers
- **GIVEN** a user is a viewer of a project
- **WHEN** they view the "Client Information" section
- **THEN** all fields are displayed in read-only mode with no edit buttons

#### Scenario: Editable form for owners and collaborators
- **GIVEN** a user is an owner or collaborator
- **WHEN** they view the "Client Information" section
- **THEN** an "Edit" button is displayed, and clicking it enables inline editing of all metadata fields

---

### Requirement: Interventions as Multi-Value Field
The system SHALL support multiple intervention entries for a single client.

#### Scenario: Add multiple interventions
- **GIVEN** a user is editing client metadata
- **WHEN** they enter interventions as comma-separated values or tags (e.g., "Neurofeedback, Medication, CBT")
- **THEN** the system stores interventions as an array in the JSONB structure

#### Scenario: Display interventions as tags
- **GIVEN** client metadata includes multiple interventions
- **WHEN** the "Client Information" section is displayed
- **THEN** interventions are shown as individual tags or pills

---

### Requirement: Metadata Persistence and Validation
The system SHALL validate and persist client metadata via API endpoints.

#### Scenario: Update metadata via API
- **GIVEN** an authenticated user with edit permissions
- **WHEN** they send a PATCH request to `/api/projects/:id/metadata` with updated metadata
- **THEN** the metadata is validated and persisted to the database, and a success response is returned

#### Scenario: Validation errors returned
- **GIVEN** a user submits invalid metadata (e.g., age = -5)
- **WHEN** the API validates the request
- **THEN** the API returns HTTP 400 with detailed validation errors

#### Scenario: Concurrent update handling
- **GIVEN** two users edit metadata simultaneously
- **WHEN** both submit updates
- **THEN** the last write wins, and both users see the updated metadata after refresh
