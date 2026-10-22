// Id parsing for pasted Squiggly URLs and opaque session ids.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RefKind = 'analysis' | 'project' | 'recording' | 'session' | 'unknown';

export interface ParsedRef {
  kind: RefKind;
  id: string;
  extra?: { a?: string; b?: string };
}

const UNKNOWN: ParsedRef = { kind: 'unknown', id: '' };

/** Session ids are 's_' + base64url of the sorted recording ids joined by '.'. */
export function sessionId(recordingIds: string[]): string {
  return 's_' + Buffer.from([...recordingIds].sort().join('.'), 'utf8').toString('base64url');
}

export function decodeSessionId(id: string): string[] | null {
  if (typeof id !== 'string' || !id.startsWith('s_')) return null;
  const body = id.slice(2);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(body, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const parts = decoded.split('.');
  if (parts.length === 0 || !parts.every((p) => UUID_RE.test(p))) return null;
  return parts;
}

function uuidOrUndef(v: string | null): string | undefined {
  return v && UUID_RE.test(v) ? v : undefined;
}

export function parseRef(input: string): ParsedRef {
  const raw = (input ?? '').trim();
  if (!raw) return UNKNOWN;
  if (UUID_RE.test(raw)) return { kind: 'unknown', id: raw };
  if (raw.startsWith('s_')) {
    return decodeSessionId(raw) ? { kind: 'session', id: raw } : UNKNOWN;
  }

  let url: URL;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) url = new URL(raw);
    else if (raw.startsWith('/')) url = new URL(raw, 'https://squiggly.invalid');
    else return UNKNOWN;
  } catch {
    return UNKNOWN;
  }

  const segs = url.pathname.split('/').filter(Boolean);
  for (let i = 0; i < segs.length - 1; i++) {
    const id = segs[i + 1];
    if (!UUID_RE.test(id)) continue;
    if (segs[i] === 'analyses') return { kind: 'analysis', id };
    if (segs[i] === 'projects') {
      if (segs[i + 2] === 'compare') {
        const a = uuidOrUndef(url.searchParams.get('a_id'));
        const b = uuidOrUndef(url.searchParams.get('b_id'));
        return { kind: 'project', id, extra: { a, b } };
      }
      return { kind: 'project', id };
    }
  }
  return UNKNOWN;
}
