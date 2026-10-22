import { describe, it, expect } from 'vitest';
import { parseRef, sessionId, decodeSessionId } from '@/lib/server/mcp/ids';

const A = '11111111-2222-3333-4444-555555555555';
const B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('parseRef', () => {
  it('parses analysis urls with trailing slash and query', () => {
    expect(parseRef(`https://squiggly.app/analyses/${A}`)).toEqual({ kind: 'analysis', id: A });
    expect(parseRef(`https://squiggly.app/analyses/${A}/`)).toEqual({ kind: 'analysis', id: A });
    expect(parseRef(`https://squiggly.app/analyses/${A}?tab=x`)).toEqual({ kind: 'analysis', id: A });
    expect(parseRef(`/analyses/${A}`)).toEqual({ kind: 'analysis', id: A });
  });
  it('parses project urls', () => {
    expect(parseRef(`https://squiggly.app/projects/${A}`)).toEqual({ kind: 'project', id: A });
    expect(parseRef(`https://squiggly.app/projects/${A}/?tab=x`)).toEqual({ kind: 'project', id: A });
  });
  it('parses compare urls', () => {
    expect(parseRef(`https://squiggly.app/projects/${A}/compare?a_id=${B}&b_id=${A}`)).toEqual({
      kind: 'project',
      id: A,
      extra: { a: B, b: A },
    });
    expect(parseRef(`https://squiggly.app/projects/${A}/compare/?a_id=${B}&b_id=${A}&tab=x`).extra).toEqual({ a: B, b: A });
  });
  it('treats a bare uuid as unknown kind', () => {
    expect(parseRef(A)).toEqual({ kind: 'unknown', id: A });
    expect(parseRef(A.toUpperCase())).toEqual({ kind: 'unknown', id: A.toUpperCase() });
  });
  it('parses session ids', () => {
    const s = sessionId([A, B]);
    expect(parseRef(s)).toEqual({ kind: 'session', id: s });
  });
  it('returns unknown with empty id for junk', () => {
    expect(parseRef('hello')).toEqual({ kind: 'unknown', id: '' });
    expect(parseRef('')).toEqual({ kind: 'unknown', id: '' });
  });
});

describe('sessionId', () => {
  it('round-trips and sorts', () => {
    expect(decodeSessionId(sessionId([B, A]))).toEqual([A, B]);
    expect(sessionId([B, A])).toBe(sessionId([A, B]));
    expect(sessionId([A])).toMatch(/^s_[A-Za-z0-9_-]+$/);
  });
  it('returns null for malformed input', () => {
    expect(decodeSessionId('nope')).toBeNull();
    expect(decodeSessionId('s_')).toBeNull();
    expect(decodeSessionId('s_' + Buffer.from('not-a-uuid').toString('base64url'))).toBeNull();
    expect(decodeSessionId('s_' + Buffer.from(`${A}.zzz`).toString('base64url'))).toBeNull();
  });
});
