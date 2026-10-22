// Request checks shared by the OAuth consent page and the decision route.

/** Supabase authorization ids are opaque tokens; anything else is refused before it reaches Auth. */
const AUTHORIZATION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** The authorization id, or null when missing, malformed or repeated (a string[] query param). */
export function parseAuthorizationId(v: unknown): string | null {
  return typeof v === 'string' && AUTHORIZATION_ID_RE.test(v) ? v : null;
}

/** A form POST from this origin: Origin matches, or (when Origin is absent) Sec-Fetch-Site says so. */
export function isSameOriginPost(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin) return origin === new URL(request.url).origin;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}
