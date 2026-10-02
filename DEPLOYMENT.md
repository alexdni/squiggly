# Deployment Guide

Squiggly is a single Next.js application. EEG analysis runs server-side in Node.js (a
`worker_threads` thread inside the Next.js server or Vercel function); there is no separate worker
service to deploy. Two targets are supported:

| Target | Database / Storage / Auth | Guide |
|--------|---------------------------|-------|
| Docker (self-hosted, single container) | PostgreSQL + local disk + email/password | [DOCKER.md](DOCKER.md) |
| Vercel | Supabase (Postgres, Storage, Google OAuth) | below |

## Analysis engine access

Artifact cleaning uses the private package `@divergentneuro/biofeedback-core` from GitHub
Packages. Every install needs `NODE_AUTH_TOKEN` set to a GitHub token with `read:packages`
on the DivergentNeuro organization. `.npmrc` reads the variable; never commit the token.

The package is server-only:
- `next.config.js` marks it as an external server package so it is never bundled for the browser.
- `npm run build` ends with `scripts/check-client-bundle.mjs`, which fails the build if engine code
  or a source map appears in `.next/static`.

## Vercel + Supabase

### 1. Supabase

1. Create a project and run `supabase/schema.sql`, then every file in `supabase/migrations/`.
2. Create private Storage buckets `recordings`, `visuals`, `exports` (or run
   `supabase/setup_storage_buckets.sql`).
3. Enable Google OAuth under Authentication → Providers.

### 2. Vercel project

Environment variables (Production and Preview):

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser/session client |
| `SUPABASE_SERVICE_ROLE_KEY` | Background analysis jobs write results with the service role |
| `NODE_AUTH_TOKEN` | Build-time install of the analysis engine (mark as sensitive) |
| `OPENAI_API_KEY` | Optional, AI interpretation |

`vercel.json` already sets:
- `installCommand: npm ci` and `buildCommand: npm run build` (bundles the analysis worker, builds
  Next.js, then runs the client-bundle check)
- `maxDuration: 300` for `app/api/analyses/[id]/process` and
  `app/api/projects/[id]/theraq-analysis`, where analyses run after the response via `waitUntil`

### 3. How an analysis runs

1. The browser PATCHes the analysis config and POSTs `/api/analyses/[id]/process`.
2. The route checks project permissions, sets `status = processing`, responds **202**, and keeps
   running the job in the background.
3. The job downloads the recording from Storage, cleans it, extracts features, uploads the cleaned
   file to `visuals/{analysis_id}/cleaned_raw.{edf|bdf|csv}` and writes `analyses.results`.
4. The browser polls `GET /api/analyses/[id]` and renders all visuals from the JSON.

Runs still `processing` after 10 minutes (e.g. the instance was recycled) are shown as stalled and
can be restarted.

### Sizing

A 20-minute 19-channel recording takes roughly 30–60 s of CPU and about 200–400 MB of memory.
Recordings above ~300 Hz are decimated to ~250 Hz before cleaning. Very long recordings may exceed
the 300 s function budget; use Docker for those.

## Local development

```bash
export NODE_AUTH_TOKEN=ghp_your_token
npm ci
npm run dev        # builds .eeg-worker/worker.mjs, then starts next dev
npm test
```

If `.eeg-worker/worker.mjs` is missing, analyses run inline on the request thread (slower dev
server, same results). Rebuild it after changing `lib/server/eeg/**` with `npm run build:worker`.
