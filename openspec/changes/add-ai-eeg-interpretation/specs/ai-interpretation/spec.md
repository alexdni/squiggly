## ADDED Requirements

### Requirement: AI-Powered EEG Interpretation Generation

The system SHALL provide AI-powered interpretation of completed EEG analysis results using GPT-4, generating expert-level narrative assessments of biomarkers, frequency patterns, and clinical observations.

#### Scenario: User requests AI interpretation for completed analysis

- **GIVEN** an analysis with status "completed" and valid results data
- **WHEN** user clicks the "AI Analysis" button
- **THEN** the system extracts band power, ratios, asymmetry, and LZC data
- **AND** sends structured data to GPT-4 with expert neurotech prompt
- **AND** displays loading indicator during generation
- **AND** stores the interpretation in `results.ai_interpretation`
- **AND** displays structured interpretation with sections for amplitude patterns, frequency ratios, asymmetry analysis, complexity/connectivity, and observations
- **AND** displays a prominent disclaimer about educational/non-diagnostic nature

#### Scenario: User views previously generated interpretation

- **GIVEN** an analysis with existing `ai_interpretation` in results
- **WHEN** user navigates to the analysis page
- **THEN** the system displays the cached interpretation immediately
- **AND** shows "Regenerate" button to request fresh interpretation

#### Scenario: User regenerates interpretation

- **GIVEN** an analysis with existing AI interpretation
- **WHEN** user clicks "Regenerate" button
- **THEN** the system generates a new interpretation via GPT-4
- **AND** overwrites the previous interpretation
- **AND** updates the `generated_at` timestamp

### Requirement: Expert Neurotech Prompt Engineering

The system SHALL use a carefully engineered system prompt that frames GPT-4 as an expert qEEG analyst with clinical experience, producing professional-grade interpretations suitable for educational review.

#### Scenario: GPT-4 receives expert framing prompt

- **WHEN** the system sends a request to GPT-4
- **THEN** the system prompt establishes the role as "expert neurophysiologist and qEEG specialist with 20+ years of clinical experience"
- **AND** instructs the model to interpret quantitative EEG metrics
- **AND** specifies structured output format with defined sections
- **AND** emphasizes educational context without clinical diagnosis
- **AND** requests citations to research patterns where applicable

#### Scenario: Analysis data is formatted for LLM consumption

- **WHEN** preparing the user prompt payload
- **THEN** the system includes recording metadata (duration, channels, montage)
- **AND** includes QC report summary (artifact rejection, epochs)
- **AND** includes band power values for all channels in EO and EC conditions
- **AND** includes theta/beta and alpha/theta ratio values
- **AND** includes hemispheric asymmetry metrics
- **AND** optionally includes LZC complexity values if available
- **AND** optionally includes client metadata (age, gender, primary issue) if available

### Requirement: AI Interpretation API Endpoint

The system SHALL expose an API endpoint for generating and retrieving AI interpretations of EEG analysis results.

#### Scenario: POST request generates new interpretation

- **GIVEN** authenticated user with access to the analysis
- **WHEN** POST request is made to `/api/analyses/[id]/ai-interpretation`
- **THEN** the system validates the analysis exists and is completed
- **AND** extracts relevant data from analysis results
- **AND** calls OpenAI GPT-4 API with structured prompt
- **AND** parses response into structured sections
- **AND** stores interpretation in database
- **AND** returns interpretation JSON with 200 status

#### Scenario: GET request retrieves cached interpretation

- **GIVEN** authenticated user with access to the analysis
- **WHEN** GET request is made to `/api/analyses/[id]/ai-interpretation`
- **AND** interpretation exists in `results.ai_interpretation`
- **THEN** the system returns cached interpretation with 200 status

#### Scenario: GET request when no interpretation exists

- **GIVEN** authenticated user with access to the analysis
- **WHEN** GET request is made to `/api/analyses/[id]/ai-interpretation`
- **AND** no interpretation exists
- **THEN** the system returns 404 with message "No AI interpretation available"

#### Scenario: Unauthorized access attempt

- **WHEN** unauthenticated request is made to the endpoint
- **THEN** the system returns 401 Unauthorized

### Requirement: AI Interpretation Display

The system SHALL display AI-generated interpretations in a dedicated section of the analysis view with clear structure and disclaimers.

#### Scenario: AI interpretation section rendering

- **GIVEN** analysis has AI interpretation data
- **WHEN** rendering the analysis details page
- **THEN** the system displays "AI-Powered Interpretation" section
- **AND** shows disclaimer banner: "This interpretation is for educational purposes only and does not constitute medical diagnosis or advice. Consult a qualified healthcare professional for clinical interpretation."
- **AND** displays interpretation subsections with headers
- **AND** uses distinct visual styling (e.g., AI icon, subtle background)

#### Scenario: AI Analysis button visibility

- **GIVEN** analysis with status "completed"
- **WHEN** rendering the analysis details page
- **THEN** "AI Analysis" button is visible in the actions area
- **AND** button is disabled with "Generating..." text while request is in progress

#### Scenario: Analysis not completed

- **GIVEN** analysis with status other than "completed"
- **WHEN** rendering the analysis details page
- **THEN** "AI Analysis" button is not visible

### Requirement: Error Handling for AI Interpretation

The system SHALL gracefully handle errors during AI interpretation generation and display appropriate messages to users.

#### Scenario: OpenAI API timeout

- **WHEN** GPT-4 API request exceeds 60 second timeout
- **THEN** the system returns 504 Gateway Timeout
- **AND** displays "AI interpretation timed out. Please try again."

#### Scenario: OpenAI API rate limit

- **WHEN** GPT-4 API returns rate limit error
- **THEN** the system returns 429 Too Many Requests
- **AND** displays "AI service is busy. Please try again in a few minutes."

#### Scenario: Invalid API key

- **WHEN** OpenAI API returns authentication error
- **THEN** the system logs error for administrators
- **AND** returns 503 Service Unavailable
- **AND** displays "AI interpretation service is currently unavailable."

#### Scenario: Incomplete analysis data

- **WHEN** analysis results lack required fields for interpretation
- **THEN** the system returns 400 Bad Request
- **AND** displays "Analysis data is incomplete. Cannot generate AI interpretation."
