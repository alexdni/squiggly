## 1. Auth
- [ ] 1.1 Enable Supabase OAuth 2.1 server, dynamic registration, authorization path `/oauth/consent` (dashboard; document in DEPLOYMENT.md)
- [ ] 1.2 `/oauth/consent` page (login redirect with `next`, client details, Approve/Deny)
- [ ] 1.3 `/.well-known/oauth-protected-resource` route; middleware passes MCP, discovery and consent routes through
- [ ] 1.4 `lib/server/mcp/auth.ts`: verify OAuth access token (reject non-OAuth session JWTs), per-request user Supabase client
- [ ] 1.5 DB/RBAC helpers constructible from an explicit Supabase client (cookie path unchanged)
- [ ] 1.6 Connected apps: list and revoke OAuth grants

## 2. Data shaping
- [ ] 2.0 Session pairing (condition from condition_type, then filename token; filename-match, then 24h-nearest; deterministic session ids)
- [ ] 2.1 Allowlist serializers: project, recording, analysis summary, detail sections, with size caps
- [ ] 2.2 Data-quality block and confidence grading
- [ ] 2.3 Extract `computeComparison` to `lib/server/comparison.ts`; compare route uses it unchanged; like-for-like condition handling for MCP
- [ ] 2.4 Trend metric extraction; legacy-analysis detection; engine-version comparability caveat; clinical_flags for epileptiform/rhythmic events
- [ ] 2.5 Leak test: walk every tool output for denylisted keys, URLs, paths, and fixture client metadata/names

## 3. MCP server
- [ ] 3.1 `app/api/mcp/route.ts` with `mcp-handler`, `withMcpAuth` required; 404 in local mode
- [ ] 3.2 Tools: list_projects, list_sessions, get_session_summary, get_analysis_detail, compare_sessions, get_metric_trend (accept pasted URLs)
- [ ] 3.3 Guidance text, server instructions, prompts `interpret_session` / `compare_two_sessions`, guidance resource
- [ ] 3.4 Structured per-call logging without results content

## 4. Verification
- [ ] 4.1 Unit tests (auth rejection paths, RBAC denial as not-found, serializers, confidence, comparison, trend)
- [ ] 4.2 Typecheck, lint, build with client-bundle check
- [ ] 4.3 Ship dark to production (OAuth server enabled in prod Supabase); MCP Inspector end-to-end there (OAuth flow, each tool)
- [ ] 4.4 Connect from Claude.ai and ChatGPT on production; walk one analysis and one comparison
- [ ] 4.5 README "Connect Claude / ChatGPT" section
