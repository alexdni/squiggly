// Bundles lib/server/eeg/worker.ts into .eeg-worker/worker.mjs for node:worker_threads.
// biofeedback-core stays external (resolved from node_modules at runtime) so the private package
// is never copied into build output that could be served or committed.
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(path.join(root, 'node_modules/@divergentneuro/biofeedback-core/package.json'))) {
  console.error(
    '\n@divergentneuro/biofeedback-core is not installed. It is a private package on GitHub Packages:\n' +
      'set NODE_AUTH_TOKEN to a token with read:packages and run `npm ci`. See README "Analysis engine".\n'
  );
  process.exit(1);
}

await build({
  entryPoints: [path.join(root, 'lib/server/eeg/worker.ts')],
  outfile: path.join(root, '.eeg-worker/worker.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  minify: true,
  external: ['@divergentneuro/biofeedback-core'],
  alias: { 'server-only': path.join(root, 'test/server-only-stub.ts') },
  tsconfig: path.join(root, 'tsconfig.json'),
  logLevel: 'warning',
});
console.log('built .eeg-worker/worker.mjs');
