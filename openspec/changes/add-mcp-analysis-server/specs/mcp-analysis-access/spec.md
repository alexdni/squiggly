## ADDED Requirements

### Requirement: Authenticated MCP endpoint
The system SHALL expose a read-only MCP server at `/api/mcp` over Streamable HTTP. It SHALL serve
no tool, prompt or resource to a request without a valid OAuth access token that Supabase Auth
issued to an approved client.

#### Scenario: Unauthenticated request
- **WHEN** an MCP client calls `/api/mcp` without a bearer token, or with an invalid or expired one
- **THEN** the server responds 401 with a `WWW-Authenticate` header pointing to
  `/.well-known/oauth-protected-resource`
- **AND** returns no data

#### Scenario: Client connects for the first time
- **WHEN** a user adds the Squiggly MCP URL to Claude or ChatGPT
- **THEN** the client discovers the authorization server and registers dynamically
- **AND** the user is sent to `/oauth/consent`, after signing in to Squiggly if needed
- **AND** the client gets a token only after the user clicks Approve

#### Scenario: Browser session token replayed
- **WHEN** a request presents a Supabase session JWT that was not issued through the OAuth server
- **THEN** the server rejects it as unauthenticated

#### Scenario: Local auth mode
- **WHEN** `AUTH_MODE=local`
- **THEN** `/api/mcp` responds 404

### Requirement: Access limited to the user's projects
Every MCP tool SHALL run with the authenticated user's identity under RLS and the existing project
permission checks. It SHALL NOT use the service-role key.

#### Scenario: Analysis in another user's project
- **WHEN** a tool is called with an analysis id from a project the user is not a member of
- **THEN** the tool returns a not-found result indistinguishable from a nonexistent id

#### Scenario: Viewer role
- **WHEN** a project viewer calls `get_session_summary`
- **THEN** the summary is returned, because viewers hold `analysis:read`

### Requirement: Revocable client authorizations
Users SHALL be able to see which MCP clients they authorized and revoke them.

#### Scenario: Revoke a client
- **WHEN** the user revokes a client under Connected apps
- **THEN** that client's tokens stop working on `/api/mcp`

### Requirement: EEG-only data exposure
MCP responses SHALL contain only EEG-derived measurements and recording technical metadata. They
SHALL NOT contain any of:
- client metadata (age, gender, primary issue)
- project names, recording filenames, user emails
- storage paths, signed or file URLs
- processing configuration, detector evidence, or source-model identifiers

#### Scenario: Session listing
- **WHEN** `list_sessions` is called
- **THEN** each recording carries id, upload date, duration, sampling rate, channel count,
  montage, reference, condition segments and analysis status
- **AND** no filename

#### Scenario: Project with client metadata
- **WHEN** a project has `client_metadata` with age and primary issue
- **THEN** no tool output contains those values

### Requirement: Sessions pair split EO and EC uploads
The system SHALL group recordings into sessions server-side. Each session holds one EO recording,
one EC recording, or a single both-condition recording. A recording's condition comes from
`condition_type`, or from the filename's EO/EC token when `condition_type` is BOTH. EO and EC
recordings in the same project are paired by matching filenames once the token is removed, or
failing that by nearest upload within 24 hours. Filenames SHALL NOT appear in any output.

#### Scenario: Split upload with matching names
- **WHEN** a project has `..._EO.edf` and `..._EC.edf` with the same base name
- **THEN** they form one session with `pairing: 'filename'`

#### Scenario: Unpaired file
- **WHEN** an EO recording has no EC partner
- **THEN** it forms a single-condition session with `pairing: 'single'`

### Requirement: Session summary with data-quality confidence
The system SHALL provide `get_session_summary`. It SHALL return a bounded summary of a session's
completed analyses that leads with a data-quality block and a confidence grade derived from QC.

#### Scenario: Low-quality recording
- **WHEN** more than 30% of epochs were rejected or more than 15% of channels were bad
- **THEN** confidence is `low` and the reasons are listed

#### Scenario: Epileptiform event flagged
- **WHEN** an analysis has a confirmed or unreviewed epileptiform or rhythmic-periodic event
- **THEN** the event appears in `clinical_flags` at the top of the summary with its review status

#### Scenario: Legacy analysis
- **WHEN** the analysis was produced by the old Python engine
- **THEN** the tool asks the user to Re-Analyze and returns no metrics

#### Scenario: Dismissed events
- **WHEN** the analyst dismissed detected events
- **THEN** the summary lists them separately as dismissed
- **AND** excludes them from event counts

#### Scenario: Analysis not completed
- **WHEN** the analysis status is pending, processing or failed
- **THEN** the tool returns the status and no metrics

#### Scenario: Pasted link
- **WHEN** the id argument is a Squiggly analysis URL
- **THEN** the tool resolves the analysis id from it

### Requirement: Session comparison over time
The system SHALL provide `compare_sessions(a, b)`. It SHALL return B-minus-A changes along with
both sessions' data quality and the interval between them, and it SHALL compare like conditions
only.

#### Scenario: Two sessions of the same client
- **WHEN** two sessions with completed analyses are compared
- **THEN** the result includes:
  - days between uploads
  - both quality blocks and a combined confidence
  - region-level band power deltas and the largest per-channel changes
  - asymmetry and ratio deltas
  - risk-pattern flips

#### Scenario: Different engine versions
- **WHEN** the two sessions were analyzed with different engine versions
- **THEN** the result carries a comparability caveat
- **AND** the combined confidence is lowered one step

#### Scenario: Mismatched conditions
- **WHEN** one session has EC data and the other does not
- **THEN** EC deltas are omitted
- **AND** the result says why

### Requirement: Metric trend across sessions
The system SHALL provide `get_metric_trend`. It SHALL return selected summary metrics across up to
20 recent sessions in a project, ordered by upload date, each with its confidence.

#### Scenario: Trend request
- **WHEN** a user asks for frontal theta/beta across their last 8 sessions
- **THEN** the tool returns up to 8 dated points with confidence per point

### Requirement: Interpretation guidance
The server SHALL give clients interpretation guidance through:
- server instructions
- prompts `interpret_session` and `compare_two_sessions`
- tool descriptions

The guidance SHALL direct the assistant to:
- name patterns, sites, magnitudes, and literature-associated correlates and risks directly
- tie confidence to data quality
- raise confirmed epileptiform and rhythmic-periodic events as clinical risks, and unreviewed ones
  as detector flags awaiting review
- frame findings as patterns rather than diagnoses, with a single closing not-a-diagnosis line

#### Scenario: Prompt use
- **WHEN** a client invokes the `interpret_session` prompt with a session or analysis id
- **THEN** the prompt instructs the assistant to fetch the summary and interpret it using the
  guidance
