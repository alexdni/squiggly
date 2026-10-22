# Squiggly MCP Analysis Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only, OAuth-protected MCP server at `/api/mcp`. It lets the user's own Claude or
ChatGPT list their sessions, walk through a session's analysis, compare two sessions and trend
metrics, and it returns EEG numbers only.

**Architecture:**
- Supabase Auth is the OAuth 2.1 authorization server, with a consent page in the app. `/api/mcp`
  (`mcp-handler`, stateless Streamable HTTP) verifies the OAuth access token. It builds a Supabase
  client bound to that token, so RLS and `lib/rbac.ts` run as the user.
- Tools are thin. Pure modules under `lib/server/mcp/` do the work:
  - pairing split EO/EC files into sessions
  - allowlist serializers
  - data-quality confidence
  - session summary, detail sections, comparison and trend
  - one guidance text

**Tech Stack:** Next.js 14 App Router, Supabase (`@supabase/supabase-js` ≥2.81, `@supabase/ssr`),
`mcp-handler` + `@modelcontextprotocol/server` (zod 4), Vitest.

**Spec:** `openspec/changes/add-mcp-analysis-server/design.md` (authoritative), with `proposal.md`
and `specs/mcp-analysis-access/spec.md`. Executors read all three.

## Global Constraints

- **Read-only.** No tool writes anything, and every tool is annotated `readOnlyHint: true`.
- **No service-role key** anywhere under `lib/server/mcp/` or `app/api/mcp/`.
- **Output is EEG numbers and technical metadata only.** Never emit:
  - `client_metadata` (age, gender, primary issue), project `name`, recording `filename`,
    `file_path`, `email`
  - `cleaned_file_url`, any `*_path`, `kernel_id`, `head_model_id`
  - `processing_metadata` (except the bare engine version string inside comparisons), `config`,
    `evidence`, `visuals`
  - any `http(s)://` URL or storage path

  Output is built from allowlisted fields.
- A project is shown to the AI as label `"Project " + id.slice(0, 8)`.
- Confidence rules:
  - `low` if rejection >30% or bad channels >15% of `n_channels`
  - `moderate` if fewer than 20 clean epochs in a condition
  - add a note if more than 5 ICA components were removed
- Comparison rules:
  - Confidence is the worse of the two sides, and drops one step when the engine version,
    montage, sampling rate or available conditions differ.
  - A trend takes `last_n ≤ 20` sessions. `list_sessions` returns up to 100. A connectivity
    detail returns up to 200 pairs. PSD is given in 1 Hz bins up to 45 Hz.
- Session pairing:
  - condition from `condition_type` (EO/EC), else the filename token, else BOTH
  - pair by filename with the EO/EC token removed, else the nearest upload within 24h
  - TheraQ phase files (`EO1`, `EC2`, …) are never paired
- `AUTH_MODE=local` → `/api/mcp` responds 404.
- Analysis band ceiling is 45 Hz (`ANALYSIS_MAX_HZ`).
- Tests are Vitest, in `__tests__/` next to the code. Run with `npx vitest run <path>`.

## Review Focus

1. **A user pastes a URL with a trailing slash, a query string, or `/projects/<p>/compare?a_id=..&b_id=..`.**
   The ids should resolve, and garbage input should return a clear "not found". Tested in Task 4.
2. **The same base filename appears on many days (`Client_EO.edf` uploaded weekly).** Filename
   matching alone would pair the wrong weeks. Filename pairing must also be within 24h, with time
   used as the tiebreak. Tested in Task 4.
3. **The analysis is completed but `results` lacks optional blocks** (no `hrv`, no `sloreta`, no
   `events`, `band_power.ec` null). The summary should omit those sections, not throw. Tested in
   Task 6.
4. **A token is expired or revoked mid-conversation.** The call should get a 401 challenge, not a
   500, so the client re-authenticates. Tested in Task 2.
5. **A project has hundreds of recordings.** `list_sessions` caps at 100 and reports truncation.
   Tested in Task 9.

---

### Task 1: Token-bound DB client and RBAC injection

**Files:**
- Modify: `lib/rbac.ts` (`getUserProjectRole`, `checkProjectPermission`, `canAccessRecording`,
  `canAccessAnalysis`)
- Create: `lib/server/mcp/db.ts`
- Test: `lib/__tests__/rbac-injected-db.test.ts`

**Interfaces:**
- Produces:
  - `createUserDb(accessToken: string): { db: DatabaseClient; supabase: SupabaseClient }`. It
    uses `createClient(URL, ANON_KEY, { global: { headers: { Authorization: 'Bearer ' + token } }, auth: { persistSession: false, autoRefreshToken: false } })`
    wrapped in `new SupabaseDatabaseClient(supabase)`.
  - The RBAC functions above gain an optional last parameter `db: DatabaseClient = getDatabaseClient()`.
    Existing callers are unchanged.

- [ ] **Step 1: Write a failing test.** `checkProjectPermission uses the injected db`: pass a fake
  `DatabaseClient` whose `projects` query returns `{ owner_id: 'u1' }`. Expect
  `checkProjectPermission('p1','u1','analysis:read', fakeDb)` to be `true` and `getDatabaseClient`
  never to be called (mock `@/lib/db`). A second test uses viewer membership and expects
  `analysis:read` → true and `analysis:create` → false.
- [ ] **Step 2:** Run `npx vitest run lib/__tests__/rbac-injected-db.test.ts`. It should FAIL
  (the param is ignored).
- [ ] **Step 3:** Thread `db` through the four functions, and implement `createUserDb`.
- [ ] **Step 4:** Run the new test and `npx vitest run lib/__tests__/rbac.test.ts`. Both should PASS.
- [ ] **Step 5: Commit.** `feat(mcp): token-bound db client; injectable rbac db`

### Task 2: MCP auth: token verification, discovery metadata, 401 challenge

**Files:**
- Modify: `package.json` (add `mcp-handler@2.3.0` and `@modelcontextprotocol/server@2.3.1`
  exact; bump `zod` to `^4.2.0`, which is safe because no app code imports zod today. Check with
  `grep -rl zod app lib components types`.)
- Create: `lib/server/mcp/auth.ts`, `app/.well-known/oauth-protected-resource/route.ts`
- Test: `lib/server/mcp/__tests__/auth.test.ts`

**Interfaces:**
- Produces:
  - `verifyMcpToken(req: Request, bearer?: string): Promise<AuthInfo | undefined>`.
    `AuthInfo.extra = { userId: string }` and `clientId = claims.client_id`.
  - `getMcpUser(authInfo): { userId: string; db: DatabaseClient }`, which calls `createUserDb`
    from Task 1.
  - `AUTH_ISSUER = \`${NEXT_PUBLIC_SUPABASE_URL}/auth/v1\``.
- Verification order:
  1. no bearer → undefined
  2. `supabase.auth.getClaims(token)` (JWKS verify) fails or expired → undefined
  3. claims without `client_id` (a browser session JWT) → undefined
  4. `aud !== 'authenticated'` → undefined
  5. otherwise AuthInfo, with `scopes: ['squiggly:read']`
- An undefined result makes `withMcpAuth({ required: true })` answer 401 with `WWW-Authenticate`.

- [ ] **Step 1:** Install deps, then run `npm ls zod @modelcontextprotocol/server` and confirm
  zod 4 is deduped. If `mcp-handler@2.3.0` fails to install against Next 14, fall back to
  `mcp-handler@1.1.0` + `@modelcontextprotocol/sdk@1.26.0` (zod ^3.25 works there) and note it in
  the commit.
- [ ] **Step 2: Write failing tests.** Mock `getClaims`:
  - `rejects missing bearer`
  - `rejects expired/invalid token` (getClaims returns an error)
  - `rejects session JWT without client_id`
  - `accepts OAuth token` → `extra.userId === claims.sub`, `clientId === claims.client_id`
- [ ] **Step 3:** Run `npx vitest run lib/server/mcp/__tests__/auth.test.ts`. It should FAIL.
- [ ] **Step 4:** Implement `auth.ts`. Write the well-known route with
  `protectedResourceHandler({ authServerUrls: [AUTH_ISSUER] })` and
  `metadataCorsOptionsRequestHandler()`. Return 404 from both when `isLocalAuthMode()`.
- [ ] **Step 5:** Run the tests. They should PASS. Then run `npx tsc --noEmit`, which should be
  clean.
- [ ] **Step 6: Commit.** `feat(mcp): OAuth access-token verification and protected-resource metadata`

### Task 3: Consent page, decision route, login return path, connected apps

**Files:**
- Modify: `app/login/page.tsx`. After a successful login, `router.push(safeRedirect(searchParams.get('redirect')))`
  instead of `/dashboard`. Pass the same value through the OAuth `redirectTo` callback.
- Modify: `lib/supabase-middleware.ts`. An authenticated user hitting `/login?redirect=…` goes to
  `safeRedirect(...)`, not `/dashboard`.
- Create: `lib/safe-redirect.ts`, `app/oauth/consent/page.tsx`, `app/api/oauth/decision/route.ts`,
  `app/settings/connected-apps/page.tsx`, `app/api/oauth/grants/route.ts` (GET list,
  DELETE `?client_id=`)
- Test: `lib/__tests__/safe-redirect.test.ts`

**Interfaces:**
- `safeRedirect(value: string | null): string` returns `value` only when it starts with a single
  `/`, isn't `//` or `/\`, and has no scheme. Otherwise it returns `/dashboard`.
- Consent page:
  - Server component using `lib/supabase-server.ts` `createClient()`.
  - No user → `redirect('/login?redirect=' + encodeURIComponent('/oauth/consent?authorization_id=' + id))`.
  - `supabase.auth.oauth.getAuthorizationDetails(id)`. If the result has no `authorization_id`,
    the user already consented: `redirect(details.redirect_url)`.
  - Shows `client.name`, `redirect_uri`, and this exact copy: "**{client}** wants read-only
    access to analyses in projects you can access in Squiggly. It will see EEG measurements only:
    no client details, project names or file names." The form POSTs to `/api/oauth/decision`.
- Decision route: `approveAuthorization` / `denyAuthorization`, then 303 to `data.redirect_url`.
  On error it returns 400 JSON.
- Grants route: `supabase.auth.oauth.getUserGrants()` and `revokeGrant(clientId)` with the cookie
  client. It returns 401 with no user.
- Connected apps page: a list (client name, approved date, Revoke button). Link it from the
  dashboard header next to logout.

- [ ] **Step 1: Write failing tests for `safeRedirect`:**
  - `'/oauth/consent?authorization_id=x'` → unchanged
  - `'//evil.com'` → `/dashboard`
  - `'https://evil.com'` → `/dashboard`
  - `'/\\evil.com'` → `/dashboard`
  - `null` → `/dashboard`
- [ ] **Step 2:** Run `npx vitest run lib/__tests__/safe-redirect.test.ts`. It should FAIL.
- [ ] **Step 3:** Implement `safeRedirect`, the login and middleware changes, consent, decision,
  grants and the connected-apps page. Use the existing Tailwind styles from `app/login/page.tsx`.
- [ ] **Step 4:** Run the tests. They should PASS. Then `npx tsc --noEmit` should be clean.
- [ ] **Step 5: Commit.** `feat(mcp): OAuth consent page, decision route, connected apps`

### Task 4: Id resolution and session pairing

**Files:**
- Create: `lib/server/mcp/ids.ts`, `lib/server/mcp/sessions.ts`
- Test: `lib/server/mcp/__tests__/ids.test.ts`, `lib/server/mcp/__tests__/sessions.test.ts`

**Interfaces:**
- `parseRef(input: string): { kind: 'analysis' | 'project' | 'recording' | 'session' | 'unknown'; id: string; extra?: { a?: string; b?: string } }`
  - accepts a bare uuid (kind `unknown`), an `s_…` session id, `…/analyses/<uuid>`,
    `…/projects/<uuid>`, `…/projects/<uuid>/compare?a_id=&b_id=`
  - tolerates trailing slashes and query strings
- `interface RecordingRow { id; project_id; filename; condition_type: 'EO'|'EC'|'BOTH'; created_at; duration_seconds; sampling_rate; n_channels; montage; reference; eo_start; eo_end; ec_start; ec_end }`
- `conditionOf(r: RecordingRow): 'EO' | 'EC' | 'BOTH'`
- `isTheraqPhaseFile(filename): boolean`, which matches `/(^|[\s_.-])E[OC]\d(?=$|[\s_.-])/i`
- `pairSessions(rows: RecordingRow[]): Session[]`, sorted newest first, where
  `interface Session { id: string; recordingIds: { eo?: string; ec?: string; both?: string }; date: string; pairing: 'filename' | 'time' | 'single' }`
- `sessionId(recordingIds: string[]): string` returns `'s_' + base64url(sorted ids joined by '.')`
- `decodeSessionId(id): string[] | null`
- Filename token regex: `/(^|[\s_.-])(EO|EC|eyes[\s_-]?open|eyes[\s_-]?closed)(?=$|[\s_.-])/i`.
  The base name is lowercased, has its extension and the token removed, and has separators
  collapsed to `_`.
- Pairing algorithm:
  1. Candidate EO×EC pairs have to be in the same project and less than 24h apart.
  2. Greedy, smallest time gap first. Among candidates, filename-base matches take priority over
     time-only matches.
  3. Each recording is used once. Leftovers become `single`.

- [ ] **Step 1: Write failing tests.**
  - `parseRef`: each URL form above (with a trailing `/` and with `?tab=x`), a bare uuid, and
    `'hello'` → kind `unknown` with id `''`.
  - `pairSessions`:
    - `Anna_0101_EO.edf` + `Anna_0101_EC.edf` 5 min apart → one session, `filename`
    - `Client_EO.edf` and `Client_EC.edf` uploaded weekly for 3 weeks → 3 sessions, each pairing
      same-day files (Review Focus 2)
    - EO and EC with different names 2h apart → `time`
    - 30h apart → two `single`
    - `condition_type='BOTH'` → `single` with `both`
    - `x_EO1.edf` + `x_EC1.edf` → both single (TheraQ)
    - `condition_type='EO'` wins over a filename that says EC
  - `decodeSessionId(sessionId(ids))` round-trips.
- [ ] **Step 2:** Run `npx vitest run lib/server/mcp/__tests__/ids.test.ts lib/server/mcp/__tests__/sessions.test.ts`.
  It should FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. They should PASS.
- [ ] **Step 5: Commit.** `feat(mcp): ref parsing and EO/EC session pairing`

### Task 5: Data quality, confidence, legacy detection

**Files:**
- Create: `lib/server/mcp/quality.ts`
- Test: `lib/server/mcp/__tests__/quality.test.ts`

**Interfaces:**
- `type Confidence = 'high' | 'moderate' | 'low'`
- `isLegacyResults(r: unknown): boolean`. True when `processing_metadata.engine` is absent
  **and**:
  - `visuals` has entries, or
  - there is `coherence` without `connectivity`, or
  - `qc_report.final_epochs_eo` is not a number.
- `qualityBlock(qc: QcReportSummary, condition?: 'eo' | 'ec'): QualityBlock`, with
  `QualityBlock = { rejection_pct; epochs_kept: { eo?: number; ec?: number }; bad_channels: string[]; interpolated_channels: string[]; ica_components_removed; ica_removed_labels: string[]; asr_applied: boolean; warnings: string[]; confidence: Confidence; reasons: string[] }`
  - When `condition` is given, use that condition's rejection rate and epochs.
- `worse(a: Confidence, b: Confidence): Confidence`
- `stepDown(c: Confidence): Confidence`

- [ ] **Step 1: Write failing tests.**
  - rejection 31% → low, with a reason mentioning `30%`
  - 3 bad of 19 channels → low (15.8%)
  - 2 bad of 19 → not low on that rule
  - `final_epochs_eo: 18` → moderate
  - 6 ICA components → the reasons include an ICA note, and confidence is unchanged by that alone
  - clean → high
  - `stepDown('low') === 'low'`
  - `isLegacyResults` is true for a Python-shaped fixture (`visuals: {topo: 'https://…'}`, no
    engine) and false for `lib/server/eeg/__fixtures__/features` output wrapped with
    `processing_metadata.engine`
- [ ] **Step 2:** Run `npx vitest run lib/server/mcp/__tests__/quality.test.ts`. It should FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. They should PASS.
- [ ] **Step 5: Commit.** `feat(mcp): data-quality block and confidence grading`

### Task 6: Session summary

**Files:**
- Create: `lib/server/mcp/summary.ts`, `lib/server/mcp/guidance.ts` (both constants, final text), `lib/server/mcp/__tests__/fixtures.ts` (a full
  `AnalysisResults` builder for EO-only, EC-only and BOTH analyses, plus project and recording
  rows with a name, a filename and `client_metadata: { age: 41, primary_issue: 'ZZ_SECRET_ISSUE' }`)
- Test: `lib/server/mcp/__tests__/summary.test.ts`

**Interfaces:**
- Consumes: `qualityBlock`, `worse`, `isLegacyResults` (Task 5); `Session` (Task 4);
  `parseEventReviews` (`lib/server/eventReviews.ts`); `REGIONAL_CHANNELS` (`lib/constants.ts`);
  `BAND_NAMES`, `CONNECTIVITY_BAND_NAMES` (`lib/analysis-results.ts`).
- `interface AnalysisInput { analysisId: string; recording: RecordingRow; status: string; results: AnalysisResults | null; config: unknown }`
- `buildSessionSummary(session: Session, parts: { eo?: AnalysisInput; ec?: AnalysisInput; both?: AnalysisInput }): SessionSummary`. Each condition is read from the analysis that holds it (`both`
  supplies both).
- `SessionSummary` contains:
  - `session: { id, date, pairing, recordings: RecordingMeta[] }`, where `RecordingMeta = { id, uploaded_at, duration_s, sampling_rate, n_channels, montage, reference, condition, analysis: { id, status } }`
  - `clinical_flags: EventOut[]`: confirmed or unreviewed `epileptiform` / `rhythmic-periodic` events
  - `quality: { eo?: QualityBlock; ec?: QualityBlock; confidence: Confidence }`
  - `conditions: { eo?: ConditionSummary; ec?: ConditionSummary }`
  - `eo_ec_reactivity?: { occipital_alpha_change_pct: number; posterior_alpha_change_pct: number }`.
    This is `(EC−EO)/EO` of `alpha1 + alpha2` absolute, over occipital channels and over
    parietal+occipital channels. It is only present when both conditions exist.
  - `ratios`, `asymmetry`, `risk_patterns` (`label: 'heuristic screens, not diagnoses'`), each
    taken per source analysis
  - `hrv?`: summary, reliable, coverage_pct, beats. No series.
  - `sloreta?`: per condition and band, the stats peak `{ mni, region, value }` and `max`/`mean`
  - `events`: `{ counts: Record<EventCategory, number>; items: EventOut[]; dismissed: EventOut[]; not_assessed: { detector, reason }[] }`
  - `interpretation_guidance: string`, which is `GUIDANCE_SHORT` from `lib/server/mcp/guidance.ts`
    (created in this task; see Task 10 for its content)
  - `unavailable?: { analysisId; reason: 'pending' | 'processing' | 'failed' | 'legacy' }[]`
- `ConditionSummary` contains:
  - `band_power: { by_region: Record<region, Record<BandName, { abs: number; rel: number }>>; by_channel: Record<channel, Record<BandName, [abs, rel]>> }`, values rounded to 3 significant figures
  - `alpha_peak: { mean_hz; by_channel }`
  - `lzc: { mean_normalized; by_channel }`
  - `connectivity: Record<ConnectivityBandName, { global_efficiency; clustering; small_worldness; interhemispheric; strongest: PairOut[5]; weakest: PairOut[5] }>`
- `EventOut = { id, category, pattern, start_s, end_s, channels, confidence, handling, review: 'confirmed' | 'dismissed' | 'unreviewed' }`.
  Never `evidence`. `review` comes from `config.event_reviews`, with `results.events[].dismissed`
  as a fallback.

- [ ] **Step 1: Write failing tests.**
  - split session (EO-only + EC-only analyses) → both conditions present, and reactivity equals
    the hand-computed value from the fixture
  - EO-only single session → no `eo_ec_reactivity`, no `conditions.ec`
  - missing `hrv`, `sloreta` and `events` → those keys absent, no throw (Review Focus 3)
  - a confirmed epileptiform event → in `clinical_flags` with `review: 'confirmed'`
  - an unreviewed rhythmic-periodic event → in `clinical_flags` with `'unreviewed'`
  - a dismissed artifact → in `events.dismissed` and not counted
  - a `processing` analysis → in `unavailable`, and its condition absent
  - legacy results → `unavailable` with `'legacy'`
  - 31% rejection on the EC side → `quality.confidence === 'low'`
  - `JSON.stringify(summary)` length under 32 000 chars for the 19-channel fixture
- [ ] **Step 2:** Run `npx vitest run lib/server/mcp/__tests__/summary.test.ts`. It should FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. They should PASS.
- [ ] **Step 5: Commit.** `feat(mcp): session summary builder`

### Task 7: Analysis detail sections

**Files:**
- Create: `lib/server/mcp/detail.ts`
- Test: `lib/server/mcp/__tests__/detail.test.ts`

**Interfaces:**
- `type DetailSection = 'band_power' | 'connectivity' | 'psd' | 'events' | 'sloreta' | 'hrv' | 'qc'`
- `buildDetail(input: AnalysisInput, section: DetailSection, filter: { condition?: 'eo' | 'ec'; band?: string; channel?: string; region?: string; page?: number }): object`
- Each section:
  - `band_power`: per channel, all bands, abs and rel
  - `connectivity`: `pair_data` for one band (default `alpha`), sorted descending, ≤200 pairs
  - `psd`: one channel or region mean, averaged into 1 Hz bins, 1–45 Hz
  - `events`: `EventOut[]`, 100 per page, plus `next_page`
  - `sloreta`: every band's stats per condition, without `kernel_id`, `head_model_id`,
    `values_path` or `timeline.spectra_path`
  - `hrv`: summary plus each series downsampled to ≤120 points
  - `qc`: the quality block, the rejected spans (`timeline.spans`) capped at 200, and bad
    channels with reasons

- [ ] **Step 1: Write failing tests.**
  - a connectivity fixture with 300 pairs → 200 returned, sorted
  - PSD at 0.25 Hz resolution → 45 bins, the first covering 1–2 Hz
  - 250 events → page 0 returns 100 with `next_page: 1`
  - `sloreta` output contains none of `kernel_id`, `head_model_id`, `values_path`
  - an unknown section → throws `McpUserError('Unknown section …')` (a class in
    `lib/server/mcp/errors.ts`, created here)
- [ ] **Step 2:** Run `npx vitest run lib/server/mcp/__tests__/detail.test.ts`. It should FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. They should PASS.
- [ ] **Step 5: Commit.** `feat(mcp): analysis detail sections`

### Task 8: Session comparison and metric trend

Decision: the existing `/api/projects/[id]/compare` route and its `computeComparison` stay
untouched, so the page output can't change. The MCP gets its own condition-aware comparison
here, which covers design §5's "apply only on the MCP path". It doesn't extract the old function.

**Files:**
- Create: `lib/server/mcp/compare.ts`, `lib/server/mcp/trend.ts`
- Test: `lib/server/mcp/__tests__/compare.test.ts`, `lib/server/mcp/__tests__/trend.test.ts`

**Interfaces:**
- `compareSessions(a: SessionSummary, b: SessionSummary, engines: { a?: string; b?: string }): SessionComparison`. It is built from two Task 6 summaries, so pairing and source rules are
  shared. The output has:
  - `a`/`b`: `{ id, date, conditions, quality }`
  - `days_between`
  - `confidence` (worse of the two, then `stepDown` per mismatch, once)
  - `caveats: string[]`, e.g. `engine version differs (x vs y)`, `montage differs`,
    `sampling rate differs`, `EC missing in A, EC deltas omitted`
  - `engine_versions?: { a, b }`, only when they differ, carrying only the version substring
    after `@`
  - per shared condition:
    - `region_deltas: Record<region, Record<BandName, { abs_pct: number; rel_delta: number }>>`
    - `top_channel_changes: { channel, band, abs_pct }[10]` (largest |abs_pct|)
    - `alpha_peak_delta_hz`, `lzc_delta`
  - `ratio_deltas`, `asymmetry_deltas`
  - `risk_pattern_flips: { pattern, from, to }[]`
  - `reactivity_delta?`
- `TREND_METRICS = ['theta_beta_frontal','theta_beta_central','faa','alpha_peak_eo','alpha_peak_ec','alpha_reactivity','rel_alpha_occipital_ec','rel_theta_frontal_eo','lzc_mean_eo','lzc_mean_ec','rejection_pct'] as const`
- `buildTrend(summaries: SessionSummary[], metrics: TrendMetric[], lastN: number): { metric: TrendMetric; points: { session_id; date; value: number | null; confidence }[] }[]`.
  Sorted by date ascending. `lastN` is clamped to 1..20.

- [ ] **Step 1: Write failing tests.**
  - A has EO+EC and B has EO only → EO deltas present, EC omitted, and a caveat names it
  - engines `hybrid-asr-ica@0.33.0` vs `@0.34.0-beta.0` → caveat present, confidence `high` →
    `moderate`, `engine_versions` = `{ a: '0.33.0', b: '0.34.0-beta.0' }`
  - FAA crosses −0.15 → `risk_pattern_flips` includes `depression_like false→true`
  - `top_channel_changes` has length 10, sorted by |abs_pct|
  - trend with `lastN: 50` → clamped to 20
  - a session missing EC → `alpha_peak_ec` value `null`
- [ ] **Step 2:** Run `npx vitest run lib/server/mcp/__tests__/compare.test.ts lib/server/mcp/__tests__/trend.test.ts`.
  It should FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. They should PASS.
- [ ] **Step 5: Commit.** `feat(mcp): condition-aware session comparison and metric trend`

### Task 9: Data access (user-scoped loaders)

**Files:**
- Create: `lib/server/mcp/data.ts`
- Test: `lib/server/mcp/__tests__/data.test.ts` (with a fake `DatabaseClient`)

**Interfaces:**
- Consumes: `checkProjectPermission(..., db)` (Task 1), `pairSessions` and `decodeSessionId`
  (Task 4), `AnalysisInput` (Task 6).
- `listProjects(db, userId): { id; label; role; recording_count; first_upload; last_upload }[]`.
  This covers projects owned plus memberships. `label` = `'Project ' + id.slice(0,8)`.
- `listSessions(db, userId, projectId): { sessions: Session[]; truncated: boolean }`. It
  requires `project:read`, takes recordings newest first, caps at 100 sessions, and attaches the
  latest analysis per recording.
- `loadSession(db, userId, ref): { session: Session; parts: { eo?; ec?; both? }; engines: Record<'eo'|'ec'|'both', string | undefined> }`.
  - A `ref` may be a session id, analysis id, recording id or URL.
  - For an analysis or recording, pair the project's recordings and find the session containing
    it.
  - It requires `analysis:read`.
  - On a denial, or a missing row, it throws `McpUserError('Not found')`. Both cases have
    identical text.
- `loadAnalysis(db, userId, analysisRef): AnalysisInput`, with the same not-found rule.
- `loadProjectSummaries(db, userId, projectId, lastN): SessionSummary[]`, used for the trend.
- Queries select only the columns the serializers allowlist, plus `filename` (needed for pairing).
  They never select `client_metadata`.

- [ ] **Step 1: Write failing tests.**
  - an analysis in a project with no membership → throws `Not found`, the same message as a
    random uuid
  - a viewer → `loadAnalysis` succeeds
  - 150 recordings → `truncated: true` and 100 sessions (Review Focus 5)
  - an analysis id resolves to its paired session (EO analysis → session with both parts)
  - no query selects `client_metadata` (assert on the fake db's recorded `select` strings)
- [ ] **Step 2:** Run `npx vitest run lib/server/mcp/__tests__/data.test.ts`. It should FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. They should PASS.
- [ ] **Step 5: Commit.** `feat(mcp): user-scoped loaders`

### Task 10: Guidance, MCP route, tools, prompts, logging, leak test

**Files:**
- Create: `lib/server/mcp/server.ts`, `app/api/mcp/route.ts` (the text in `guidance.ts` comes from Task 6; its content rules are defined here)
- Test: `lib/server/mcp/__tests__/server.test.ts`, `lib/server/mcp/__tests__/leak.test.ts`

**Interfaces:**
- `guidance.ts` exports `GUIDANCE` (full text) and `GUIDANCE_SHORT` (≤400 chars).
  - `GUIDANCE` follows the design's "Interpretation guidance" bullets point by point: be direct,
    confidence from quality, patterns not diagnoses, the event rules by category, ≤45 Hz,
    comparison caveats, one closing line.
  - It also carries the clinical-correlation list and confidence rules ported from
    `git show 6dc11d0^:lib/prompts/eo-ec-comparison.ts` and
    `git show a7406fd^:lib/prompts/eeg-interpretation.ts`, dropping the persona and the
    per-section disclaimers.
  - The closing line is exactly: "Pattern-level interpretation from EEG features — not a diagnosis."
- `registerSquigglyTools(server, getCtx: (extra) => { userId; db; clientId })` in `server.ts`.
  - Tools, each zod-validated and with `annotations: { readOnlyHint: true }`:
    - `list_projects()`
    - `list_sessions({ project })`
    - `get_session_summary({ ref })`
    - `get_analysis_detail({ analysis, section, condition?, band?, channel?, region?, page? })`
    - `compare_sessions({ a, b })`
    - `get_metric_trend({ project, metrics: z.array(z.enum(TREND_METRICS)).min(1), last_n })`
  - Each returns `{ content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out }`.
  - An `McpUserError` becomes `{ isError: true, content: [{ type: 'text', text: message }] }`.
    Any other error is logged and returns `isError` with "Internal error".
  - Descriptions:
    - `get_session_summary` and `compare_sessions` include `GUIDANCE_SHORT`.
    - `list_sessions` says the date is the upload date.
    - Every tool says it accepts pasted Squiggly links.
  - Prompts:
    - `interpret_session({ ref })`: a user message telling the assistant to call
      `get_session_summary` and interpret it with the guidance
    - `compare_two_sessions({ a, b })`
  - Resource: `squiggly://guidance/interpretation` → `GUIDANCE`
  - Server `instructions` = `GUIDANCE`
  - Each call logs `console.info(JSON.stringify({ evt: 'mcp_call', user: userId, client: clientId, tool, ids, ms, ok }))`.
    No results content.
- `route.ts`:
  - `createMcpHandler(server => registerSquigglyTools(server, ctxFromAuth), { serverInfo: { name: 'squiggly', version } , instructions: GUIDANCE }, { basePath: '/api' })`
  - wrapped with `withMcpAuth(handler, verifyMcpToken, { required: true, resourceMetadataPath: '/.well-known/oauth-protected-resource' })`
  - exports GET, POST and DELETE; `isLocalAuthMode()` → 404
  - check option names against `node_modules/mcp-handler/README.md` for the installed version

- [ ] **Step 1: Write failing tests.**
  - `server.test.ts`: register tools on an in-memory `McpServer` with a fake ctx backed by
    fixtures. Then:
    - `tools/list` returns exactly the 6 names, all with `readOnlyHint: true`
    - `get_session_summary` with an `/analyses/<id>/` URL works (Review Focus 1)
    - a denied id → `isError` with text `Not found`
    - `prompts/list` has both prompts
    - `GUIDANCE` contains the exact closing line
  - `leak.test.ts`: run every tool on the fixture whose project has `name: 'Anna Smith Clinic'`,
    recording filename `Anna_Smith_2026-10-01_EO.edf`, `client_metadata.primary_issue: 'ZZ_SECRET_ISSUE'`,
    a `cleaned_file_url`, and sloreta `kernel_id: 'KERN_SECRET'`. Then deep-walk every output and
    assert:
    - no key in the denylist (Global Constraints)
    - no string contains `Anna`, `Smith`, `ZZ_SECRET_ISSUE`, `KERN_SECRET`, `.edf`, `http://`,
      `https://`, or `/storage/`
  - Route test: a POST with no bearer → 401, and the `WWW-Authenticate` header contains
    `oauth-protected-resource`. A POST with an expired token → 401, not 500 (Review Focus 4).
- [ ] **Step 2:** Run `npx vitest run lib/server/mcp/__tests__/server.test.ts lib/server/mcp/__tests__/leak.test.ts`.
  It should FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. They should PASS. Then `npx vitest run` should have no failures.
- [ ] **Step 5: Commit.** `feat(mcp): MCP route, tools, prompts and guidance`

### Task 11: Docs, build, ship dark, end-to-end

**Files:**
- Modify: `README.md` (a "Connect Claude / ChatGPT" section: URL `https://<prod-domain>/api/mcp`,
  steps for Claude.ai Settings → Connectors → Add custom connector, and ChatGPT Settings →
  Connectors / developer mode, plus what the consent screen grants and how to revoke)
- Modify: `DEPLOYMENT.md` (Supabase dashboard: Authentication → OAuth Server → enable; allow
  dynamic registration; authorization path `/oauth/consent`; Site URL = production origin)
- Modify: `openspec/changes/add-mcp-analysis-server/tasks.md` (tick items)

- [ ] **Step 1:** Run `npx tsc --noEmit && npm run lint && npm run build`. All should exit 0,
  including `scripts/check-client-bundle.mjs`, so no MCP or engine code lands in the client
  bundle.
- [ ] **Step 2:** Commit the docs (`docs(mcp): connect instructions and Supabase OAuth setup`).
- [ ] **Step 3 (user):** Enable the OAuth server in the production Supabase project as described
  in DEPLOYMENT.md. This is a production dashboard change, so confirm with the user before doing
  it or ask them to do it.
- [ ] **Step 4:** Push to `main` and deploy, **with the user's go-ahead**. It ships dark: nothing
  announces it.
- [ ] **Step 5:** End-to-end with `npx @modelcontextprotocol/inspector` against
  `https://<prod>/api/mcp`. Pass means:
  - unauthenticated → 401
  - the OAuth flow → login → consent → token
  - each of the 6 tools returns data on a real split EO/EC project
  - revoking in Connected apps → the next call 401s
- [ ] **Step 6:** Connect from Claude.ai, then ChatGPT. Walk one session ("what does this
  suggest clinically, what are the risks?") and one comparison. Check that the answers are direct,
  cite QC confidence, and contain no names.
- [ ] **Step 7:** Report the results to the user. Archiving the OpenSpec change is a separate
  step later.
