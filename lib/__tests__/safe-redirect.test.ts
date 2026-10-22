import { describe, it, expect } from 'vitest';
import { safeRedirect } from '../safe-redirect';

describe('safeRedirect', () => {
  it('keeps a same-origin path with query', () => {
    expect(safeRedirect('/oauth/consent?authorization_id=x')).toBe('/oauth/consent?authorization_id=x');
  });
  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', '@evil.com', 'javascript:alert(1)', '', '/ok\nx', null])(
    'rejects %j',
    (v) => {
      expect(safeRedirect(v as string | null)).toBe('/dashboard');
    }
  );
});
