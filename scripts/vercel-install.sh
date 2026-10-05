#!/bin/sh
# Vercel install step. The analysis engine is a private GitHub Packages module, so npm needs a
# token (see .npmrc). Accepts NODE_AUTH_TOKEN or GITHUB_PACKAGES_TOKEN (the name the other
# DivergentNeuro apps use) and fails with a clear message instead of an npm 401 when neither is set.
NODE_AUTH_TOKEN="${NODE_AUTH_TOKEN:-$GITHUB_PACKAGES_TOKEN}"
export NODE_AUTH_TOKEN
if [ -z "$NODE_AUTH_TOKEN" ]; then
  echo "NODE_AUTH_TOKEN (or GITHUB_PACKAGES_TOKEN) is not set for this environment;" >&2
  echo "add it in Vercel > Project Settings > Environment Variables (Preview and Production)." >&2
  exit 1
fi
exec npm ci
