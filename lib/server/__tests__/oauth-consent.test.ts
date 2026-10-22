import { describe, it, expect } from 'vitest';
import { parseAuthorizationId } from '@/lib/server/oauth-consent';

describe('parseAuthorizationId', () => {
  it('accepts a 1-128 char id of letters, digits, _ and -', () => {
    expect(parseAuthorizationId('auth_AbC-123')).toBe('auth_AbC-123');
    expect(parseAuthorizationId('a'.repeat(128))).toBe('a'.repeat(128));
  });

  it('rejects missing, empty, overlong, odd-character and repeated values', () => {
    for (const v of [undefined, null, '', 'a'.repeat(129), '../x', 'a b', 'a?b=c', ['a', 'b'], ['a'], 42]) {
      expect(parseAuthorizationId(v), JSON.stringify(v)).toBeNull();
    }
  });
});
