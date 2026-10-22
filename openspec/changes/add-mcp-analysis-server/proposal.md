# Change: MCP server for AI-assisted analysis walkthroughs

## Why
The in-app OpenAI interpretation was removed (a7406fd, 6dc11d0): Squiggly paid for it, owned the
prompt, and the output was too hedged to help. Analysts want to bring their own assistant (Claude,
ChatGPT, or any MCP client) to walk through a finished analysis ("what does this suggest clinically,
what are the risks?") and to compare two sessions over time, without Squiggly running or paying for
an LLM. Design: `design.md` in this change.

## What Changes
- New remote MCP endpoint `/api/mcp` (Streamable HTTP) inside the Next.js app on Vercel,
  **read-only**.
- **Authentication required before anything works**: MCP clients connect through OAuth 2.1 with
  Supabase Auth as the authorization server (dynamic client registration on). The user signs in to
  Squiggly and approves the client on a new `/oauth/consent` page. Unauthenticated requests get a
  401 challenge that points the client at the OAuth discovery metadata.
- Every tool call runs as the signed-in user, so RLS and `lib/rbac.ts` decide what the assistant
  can see. Viewers, collaborators and owners see exactly what they see in the app.
- New "Connected apps" section in the app where the user can list and revoke authorized clients.
- Split EO/EC uploads are paired into **sessions** server-side (condition from `condition_type`,
  else the filename's EO/EC token).
- Tools: list projects, list sessions, session summary, analysis detail by section, compare two
  sessions, metric trend across sessions. Confirmed or unreviewed epileptiform and
  rhythmic-periodic events are flagged as clinical risks. Also MCP prompts that carry the interpretation
  guidance.
- **Privacy**: responses carry EEG-derived numbers only. They never include client metadata (age,
  gender, primary issue), project names, recording filenames, user emails, storage paths, or signed
  URLs.
- Engine internals stay out: no `processing_metadata`, pipeline `config`, event `evidence`, or
  sLORETA kernel/head-model ids.
- Supabase mode only. The endpoint is disabled when `AUTH_MODE=local`.

## Impact
- Affected specs: new capability `mcp-analysis-access`.
- Affected code: new `app/api/mcp/route.ts`, `app/.well-known/oauth-protected-resource/route.ts`,
  `app/oauth/consent/page.tsx`, a connected-apps settings page, new `lib/server/mcp/*` (auth,
  summarizers, tools, guidance), a bearer-token path in the server DB/auth helpers,
  `middleware.ts` (let `/api/mcp` and the `.well-known` routes through), and comparison logic
  extracted from `app/api/projects/[id]/compare/route.ts` into a shared module.
- New dependencies: `mcp-handler`, `@modelcontextprotocol/sdk`.
- Supabase dashboard: enable OAuth 2.1 server and dynamic registration, and set the authorization
  path to `/oauth/consent`. No database migration.
