# Design: MCP server for AI-assisted analysis walkthroughs

## Intent
The user is an analyst reviewing EEG recordings of their clients, mostly for themselves. After a
recording has been analyzed, they want to open Claude or ChatGPT and say "walk me through this
analysis: what does it suggest clinically, what are the risks?" They also want "what changed
between these two sessions?" and "how has this moved across my last N sessions?". The assistant is
theirs. Squiggly supplies trustworthy, compact, well-labeled numbers plus guidance on how to read
them, and enforces who may see what.

## Goals
- Any MCP client that supports remote servers with OAuth can connect: Claude.ai and Claude Desktop
  connectors, Claude Code, ChatGPT connectors/apps, MCP Inspector.
- Nothing works until the user has authenticated and approved the client. Access is exactly the
  user's existing project access.
- Answers are **useful, not hedged**. The assistant names patterns, their literature-associated
  functional correlates and risks, and says how confident it is based on data quality.
- Over-time comparison of two recordings is a first-class tool. A multi-session trend is the
  stretched version (the builder added it; the user may drop it).

## Non-goals
- No write actions: no confirm/dismiss events, no re-analysis, no edits. Read and explain only
  ("for now", per the user).
- No in-app LLM calls, no Squiggly-paid AI.
- No raw signal or waveform access. No PSD or spectrogram arrays beyond small summaries.
- No EO-vs-EC or TheraQ four-phase comparison tools for now. The per-condition data in the summary
  still lets the assistant discuss EO vs EC within one recording.
- No support for Docker/`AUTH_MODE=local`.

## Anti-goals (failure even if it technically works)
- Client-identifying or client context data reaches the AI provider. The user chose **EEG numbers
  only**: no age, gender, primary issue, names, filenames, or notes.
- Boilerplate hedging that makes answers useless ("consult a professional" on every line).
- The assistant builds conclusions on artifacts the user already dismissed, or on noisy data
  without saying so.
- Private engine internals (`@divergentneuro/biofeedback-core` parameters and detector evidence)
  leak out. The repo is public and the engine is private.
- A token or a forged request reads another user's data.

## Constraints
- Next.js 14 App Router on Vercel (Node runtime, Fluid Compute). Supabase Auth/Postgres/Storage.
- The existing permission model is authoritative: `checkProjectPermission` / `canAccessAnalysis` in
  `lib/rbac.ts`, plus RLS (member-scoped, `supabase/schema.sql`,
  `migrations/restrict_analyses_rls_to_project_members.sql`). MCP uses `analysis:read` /
  `recording:read` / `project:read`.
- `results` JSON is large (spectrograms, PSD, connectivity matrices, HRV series). Tool responses
  must be trimmed and bounded.
- Public repo: tool descriptions and guidance text are visible to anyone. That's fine, because
  they hold no secrets.

## Decided

### Auth (user: "require authentication before MCP / plugin is authorized"; mechanism is the builder's call)
- **Supabase Auth as the OAuth 2.1 authorization server.** Supabase publishes
  `/.well-known/oauth-authorization-server` and supports dynamic client registration and PKCE,
  which is what the MCP spec and Claude/ChatGPT connectors expect.
  - Dashboard settings: Authentication → OAuth Server → enable, allow dynamic registration,
    authorization path `/oauth/consent`. The Site URL is the production origin.
- **Consent page `app/oauth/consent/page.tsx`.** It requires a Squiggly session and redirects to
  `/login?next=...` if there isn't one. It shows the requesting client's name and redirect URI and
  states plainly what it grants: "read-only access to analyses in projects you can access; EEG
  numbers only, no client details or names". It has Approve and Deny buttons and uses the
  supabase-js OAuth server helpers for authorization details, approve and deny. Start from the
  Supabase "OAuth Consent" Next.js block, restyled to the app.
- **Protected resource metadata** at `app/.well-known/oauth-protected-resource/route.ts`
  (`protectedResourceHandler` from `mcp-handler`, `authorization_servers` = the Supabase auth
  issuer URL, with CORS).
- **Token verification** in `lib/server/mcp/auth.ts`:
  - Read the bearer token and verify it with Supabase (`auth.getUser(token)`, or `getClaims` with
    JWKS).
  - Reject a token that isn't an OAuth-issued access token (its `client_id` claim is missing), so
    a scraped browser session JWT can't be replayed as an MCP credential. Verify the claim name
    against the Supabase docs.
  - Build a **per-request Supabase client** with `global.headers.Authorization = Bearer <token>`,
    so RLS runs as the user.
  - Wrap the handler with `withMcpAuth(..., { required: true })`.
- **DB access**: `lib/db` currently builds its Supabase client from cookies
  (`lib/db/supabase-db.ts:247`). Add a way to construct the DB/RBAC helpers from an explicit
  Supabase client or access token. The cookie path stays unchanged. Never use the service-role key
  in MCP code paths.
- **Revocation**: a "Connected apps" section, under a new account settings page or the dashboard,
  lists the user's OAuth grants (client name, approved date) with Revoke. It uses Supabase's
  grant-management API. If that API can't list or revoke from the app, fall back to a link to the
  instructions and record the gap in this doc.
- `middleware.ts` must not redirect `/api/mcp`, `/.well-known/*` or `/oauth/consent` (the consent
  page does its own login redirect, preserving the query string).

### Transport
- `mcp-handler` `createMcpHandler` at `app/api/mcp/route.ts`, Streamable HTTP, stateless, no
  Redis/SSE. GET/POST/DELETE exported. `maxDuration` is the default.

### Sessions: pairing split EO/EC uploads (user: "two files, one for EO and one for EC; filename usually contains EO/EC, parse for it")
- A **session** is the unit the assistant works with. It has an EO recording, an EC recording, or
  both. A single file holding both conditions (`condition_type = 'BOTH'`) is a session on its own.
- Pairing runs **server-side only**, in `lib/server/mcp/sessions.ts`. Filenames are read for
  pairing and never returned.
- A recording's condition is:
  - `recordings.condition_type` when it is EO or EC;
  - otherwise the filename's EO/EC token (case-insensitive; `EO`/`EC` delimited by start/end,
    space, `_`, `-` or `.`, or `eyes open` / `eyes closed`), following
    `supabase/migrations/fix_eo_ec_recordings.sql`;
  - otherwise `BOTH`/unknown, kept as-is.
- Pairing is done within one project. An EO and an EC recording are paired when:
  1. their filenames match once the EO/EC token is removed (normalized: lowercased, separators
     collapsed, extension dropped); or, failing that,
  2. they were uploaded within 24h of each other, taking the nearest-in-time match first.

  Each recording belongs to at most one session. Unpaired recordings become single-condition
  sessions. If TheraQ phase-numbered files (`EO1`, `EC2`, ...) are present, they are left
  unpaired and labeled as TheraQ (out of scope). This is the builder's call.
- A session id is deterministic and opaque: `s_` + the sorted recording ids, encoded (builder's
  choice of encoding), so it is stable across calls without a table. Its date is the earlier of the
  two uploads. The output includes `pairing: 'filename' | 'time' | 'single'` so the assistant
  knows how sure the grouping is.
- Session-level views take EO metrics from the EO recording's analysis and EC metrics from the EC
  recording's analysis. Each side keeps its own data-quality block. Session confidence is the worse
  of the two.

### Identifiers and privacy (user: "keep it to the EEG numbers only")
- Projects are exposed as `{ id, label }`, where `label` is `"Project " + first 8 chars of the
  uuid`. The real project name is never sent. Recordings are exposed as `{ id, uploaded_at,
  duration_s, sampling_rate, n_channels, montage, reference, conditions: ['EO','EC'] with
  segment lengths, analysis: { id, status, analyzed_at } }`. No filename, file path, labels, or
  uploader.
  - `uploaded_at` is `recordings.created_at`. There is no separate recording-date column. Say so in
    the tool description so the assistant doesn't call it a session date with false confidence.
    The builder may add EDF header start date later if it is already parsed and stored. It isn't
    today.
- Every tool that takes an id also accepts a pasted Squiggly URL (`/analyses/<id>`,
  `/projects/<id>`, and the comparison page URL if it carries ids) and extracts the uuid. This is
  how the user points at a specific recording without names.
- Hard denylist in the serializer, enforced by a test that walks every tool output:
  - `client_metadata`, `name`, `filename`, `file_path`, `email`, `cleaned_file_url`, `*_path`,
    `kernel_id`, `head_model_id`, `processing_metadata`, `config`, `evidence`, `visuals`
  - any string that looks like an http(s) URL or storage path.
  - Output is built from **allowlisted** fields, not by deleting from the raw object.

### Tools (all read-only, annotated `readOnlyHint: true`)
1. `list_projects()`: projects the user can read, with role, recording count, and first/last
   upload date.
2. `list_sessions(project)`: sessions in a project, newest first, each with its recordings
   (technical metadata as above) and analysis status. Up to 100, plus a cursor if the builder
   wants one. This replaces a flat `list_recordings`.
3. `get_session_summary(session | analysis | recording)`: the main tool, compact (target under
   ~8k tokens). Given an analysis or recording id, or a pasted URL, it resolves to that
   recording's session.
   - **Data quality block first**:
     - epochs kept/rejected per condition, rejection %, bad and interpolated channels, ICA
       components removed, ASR applied, QC warnings
     - a computed `confidence` (`high | moderate | low`) with reasons. The rules carry over from
       the old prompt: low if rejection >30% or bad channels >15%; moderate if <20 clean epochs;
       note if >5 ICA components were removed.
   - Per condition (EO, EC):
     - band power absolute and relative, by region (frontal, central, temporal, parietal,
       occipital) and per channel for the 19 10-20 sites
     - alpha peak, LZC
     - connectivity network metrics per band, and the top 5 strongest and weakest pairs per band
   - Band ratios, asymmetry (FAA and others present), `risk_patterns` flags, labeled
     "heuristic screens, not diagnoses".
   - HRV summary (no series), when present.
   - sLORETA: the top peaks per band with MNI coordinates and region, when present.
   - Detected events: counts by category, and the list (category, pattern, time, channels,
     confidence) with each event's **review status**. Confirmed or unreviewed `epileptiform` /
     `rhythmic-periodic` events go into a `clinical_flags` list at the top of the summary.
     Dismissed events are listed separately and excluded from counts. No `evidence`. `event_detection` coverage gives detectors that didn't
     run and why.
   - EO→EC reactivity (alpha change %) computed from per-condition data, with EO and EC taken from
     the two paired analyses when the session is split. The old comparison prompt leaned on it.
   - `interpretation_guidance`: a short pointer to the prompt or resource below, plus the one-line
     framing.
4. `get_analysis_detail(analysis, section, filter?)`. This works per analysis, since each file has
   its own analysis.: drill-down when the summary isn't enough.
   - Sections: `band_power` (per channel, all bands), `connectivity` (pair list for one band,
     capped at 200 pairs), `psd` (one channel or region, downsampled to 1 Hz bins, ≤45 Hz),
     `events` (full list with paging), `sloreta` (all peaks), `hrv`, `qc` (rejected spans).
   - Every section is capped in size.
5. `compare_sessions(a, b)`: over-time comparison, B minus A. Inputs are sessions, or
   analysis/recording ids or URLs, which resolve to their sessions.
   - Reuses `computeComparison`, extracted from `app/api/projects/[id]/compare/route.ts` into
     `lib/server/comparison.ts`. The route then calls the shared module, with behavior unchanged.
   - Returns:
     - both sessions' date, duration and conditions, and the days between them
     - both data-quality blocks and a combined confidence (the worse of the two, plus a penalty
       when montage, sampling rate or available conditions differ)
     - deltas condensed to region level, plus the top 10 largest per-channel changes
     - asymmetry and ratio deltas, and a `risk_patterns` flip list
   - Fixes the existing quirk where `eo || ec` silently mixes conditions: compare EO to EO and EC
     to EC, and say when a condition is missing on one side. Put this in the shared module only if
     the route's output stays compatible. Otherwise apply the fix only on the MCP path and note it.
   - Like-for-like is by condition: EO(A) vs EO(B) and EC(A) vs EC(B), pulled from whichever
     paired analysis holds each condition.
   - Both sessions must be in projects the user can read. They do not have to be in the same
     project.
   - **Engine version**: if the two sides' `processing_metadata.engine` versions differ, add a
     comparability caveat and lower the combined confidence one step. The output carries only the
     two version strings, no other engine metadata.
6. `get_metric_trend(project, metrics[], last_n ≤ 20)`: a time series of selected summary metrics
   across sessions in a project, by session date, with each point's confidence. Metrics
   are an enum such as `theta_beta_frontal`, `faa`, `alpha_peak_ec`, `alpha_reactivity`,
   `rel_alpha_occipital_ec`, `lzc_mean_eo`, `rejection_pct`.

**Legacy analyses**: results from the old Python engine are detected by shape (legacy `visuals`,
`coherence` without `connectivity`, or a missing `qc_report` shape). They return "produced by the
old engine; Re-Analyze in Squiggly to use it here". There is no second parsing path. This is the
builder's call.

When an analysis isn't completed, its status is `pending`, `processing` or `failed`. Tools then
return a clear message and no data. Failed analyses don't return error internals.

### Interpretation guidance (user: "too hedged to be useful" is the failure to avoid)
- One source text in `lib/server/mcp/guidance.ts`, exposed three ways:
  - in the MCP server `instructions`
  - as MCP prompts, which embed the relevant tool calls (names below)
  - as the resource `squiggly://guidance/interpretation`

  ChatGPT mostly ignores prompts, so the essentials also live in `get_session_summary` and
  `compare_sessions` tool descriptions and in `interpretation_guidance` in their outputs.
- The content to write:
  - Be direct and specific. Name the pattern, the sites, the magnitude, and the
    literature-associated functional correlates. Examples: "elevated frontal theta/beta at Fz/Cz,
    associated with an ADHD-like/inattentive phenotype"; "reduced EO→EC alpha reactivity <30%,
    associated in literature with depression or cognitive decline"; "left-dominant frontal alpha
    (negative FAA), associated with withdrawal/low approach motivation".
  - State risks worth watching and what would firm a finding up or rule it out (repeat recording,
    better montage, specific clinical evaluation).
  - Tie confidence to the data-quality block, not to boilerplate. With low confidence, say which
    findings are fragile and why.
  - Patterns, never diagnoses. `risk_patterns` are heuristic screens. Squiggly uses no normative
    database, so "elevated" is relative to typical literature ranges and within-subject contrasts
    (EO vs EC, session vs session). Say that once, not on every line.
  - Detected events, by category (user: "flag risks"):
    - `artifact`:
      - dismissed: the analyst ruled the detection wrong, so ignore it;
      - confirmed: a real artifact, so mention it only as a data-quality factor;
      - unreviewed: a candidate artifact.
    - `epileptiform` and `rhythmic-periodic`, plus any non-artifact category judged clinically
      relevant:
      - **confirmed**: raise as a clinical risk, near the top, with time, channels and pattern, and
        recommend follow-up such as a clinical EEG review;
      - **unreviewed**: raise as "detector flagged, not yet reviewed by the analyst", with its
        detector confidence. Say it may be a false positive, and suggest the analyst review it in
        Squiggly;
      - dismissed: ignore.
    - `variant`: a normal variant. Mention it neutrally so it isn't over-read.
    - "Confirm" in Squiggly means "agree with this label". It does not mean "is an artifact".
    - Event review state doesn't change the data-quality confidence. Only QC does.
  - Analysis is band-limited to ≤45 Hz. Don't interpret gamma above that.
  - Comparisons: separate real change from changes in data quality, recording conditions, or time
    of day. Flag when the two sessions aren't comparable.
  - End with a single line saying this is not a diagnosis.
- The MCP prompts are `interpret_session(session)` and `compare_two_sessions(a, b)`.
- Port the useful clinical-correlation list from the old EO/EC prompt
  (`git show 6dc11d0^:lib/prompts/eo-ec-comparison.ts`) and the confidence rules from
  `git show a7406fd^:lib/prompts/eeg-interpretation.ts`. Drop the persona and the
  disclaimer-every-section style.

### Limits and logging
- Response size caps per tool, as above.
- Structured server log line per tool call: user id, client id, tool, ids, duration, outcome. No
  results content.
- Rate limiting is left to Vercel Firewall rules for now (builder's call whether a simple per-user
  limit is worth adding).

## Left to the builder
- File layout under `lib/server/mcp/`, how summarizers are split, exact token budgets.
- Whether the Connected-apps UI is a new `/settings` page or a dashboard panel.
- Exact metric enum for trends, beyond the listed examples.
- How to present per-channel tables compactly (arrays vs objects).
- **Rollout** (user's choice): turn on the OAuth server in the production Supabase project and
  ship `/api/mcp` and the consent page to production unannounced. Test there (MCP Inspector, then
  Claude.ai, then ChatGPT) before telling anyone. There is no staging project, and preview deploys
  aren't used for the OAuth flow. Turning on OAuth and dynamic registration doesn't change existing
  password login.
- Doc for users: a short "Connect Claude / ChatGPT" section in README with the server URL
  (`https://<prod-domain>/api/mcp`).

## Pre-existing issue found during scoping (out of scope, fix separately)
In `AUTH_MODE=local`, `lib/auth/local-auth.ts:76-110` trusts an unsigned JSON cookie (`userId`)
without checking the session token. Anyone can forge a login. Production on Supabase isn't
affected. MCP is disabled in local mode anyway.
