import { describe, it, expect } from 'vitest';
const nextConfig = require('../../next.config.js');

describe('next.config headers', () => {
  it("forbids framing the consent and connected-apps pages", async () => {
    const rules: { source: string; headers: { key: string; value: string }[] }[] = await nextConfig.headers();
    for (const source of ['/oauth/consent', '/settings/connected-apps']) {
      const rule = rules.find((r) => r.source === source);
      expect(rule, source).toBeDefined();
      const h = Object.fromEntries(rule!.headers.map((x) => [x.key, x.value]));
      expect(h['Content-Security-Policy']).toBe("frame-ancestors 'none'");
      expect(h['X-Frame-Options']).toBe('DENY');
    }
  });
});
