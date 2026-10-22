import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

// The MCP modules hold allowlists and data loaders that belong on the server only.
describe('lib/server/mcp modules', () => {
  it("each imports 'server-only' first", () => {
    const dir = path.resolve(__dirname, '..');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      expect(readFileSync(path.join(dir, f), 'utf8').startsWith("import 'server-only';"), f).toBe(true);
    }
  });
});
