// One-off: set recordings.reference from each file's channel labels. Until this change every row
// was stored as 'LE' whatever the file said. Reads only the file headers.
//
//   npx vite-node -c vitest.config.ts scripts/backfill-recording-reference.ts            (dry run)
//   npx vite-node -c vitest.config.ts scripts/backfill-recording-reference.ts -- --apply
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from .env.local if unset).

import fs from 'node:fs';
import { detectReference } from '@/lib/eeg-labels';

const HEADER_BYTES = 65536; // 256 + 256 per signal: enough for 250 signals
const apply = process.argv.includes('--apply');

function env(name: string): string {
  if (process.env[name]) return process.env[name]!;
  const line = fs.existsSync('.env.local')
    ? fs.readFileSync('.env.local', 'utf8').split('\n').find((l) => l.startsWith(`${name}=`))
    : undefined;
  const value = line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const base = env('NEXT_PUBLIC_SUPABASE_URL').replace(/^(?!https?:\/\/)/, 'https://');
const key = env('SUPABASE_SERVICE_ROLE_KEY');
const headers = { apikey: key, Authorization: `Bearer ${key}` };

function labelsOf(filename: string, head: Uint8Array): string[] {
  const text = new TextDecoder('latin1').decode(head);
  if (filename.toLowerCase().endsWith('.csv')) {
    return text.split(/\r?\n/)[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  }
  const n = parseInt(text.slice(252, 256), 10);
  if (!(n > 0)) throw new Error('unreadable EDF/BDF header');
  return Array.from({ length: n }, (_, i) => text.slice(256 + i * 16, 256 + (i + 1) * 16).trim());
}

interface Row {
  id: string;
  filename: string;
  file_path: string;
  reference: string;
}

async function main() {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(
      `${base}/rest/v1/recordings?select=id,filename,file_path,reference&order=created_at&offset=${offset}&limit=1000`,
      { headers }
    );
    if (!res.ok) throw new Error(`listing recordings failed: ${res.status}`);
    const page = (await res.json()) as Row[];
    rows.push(...page);
    if (page.length < 1000) break;
  }

  const changes = new Map<string, number>();
  let unchanged = 0;
  let failed = 0;
  let written = 0;
  for (const row of rows) {
    try {
      const path = row.file_path.split('/').map(encodeURIComponent).join('/');
      const file = await fetch(`${base}/storage/v1/object/recordings/${path}`, {
        headers: { ...headers, Range: `bytes=0-${HEADER_BYTES - 1}` },
      });
      if (!file.ok) throw new Error(`download ${file.status}`);
      const kind = detectReference(labelsOf(row.filename, new Uint8Array(await file.arrayBuffer()))).kind;
      if (kind === row.reference) {
        unchanged++;
        continue;
      }
      const change = `${row.reference} → ${kind}`;
      changes.set(change, (changes.get(change) ?? 0) + 1);
      if (!apply) continue;
      const res = await fetch(`${base}/rest/v1/recordings?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ reference: kind }),
      });
      if (!res.ok) throw new Error(`update ${res.status}`);
      written++;
    } catch (err) {
      failed++;
      console.error(`${row.id}: ${(err as Error).message}`);
    }
  }

  console.log(`${rows.length} recordings: ${unchanged} already correct, ${failed} failed`);
  for (const [change, n] of [...changes].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${change}`);
  console.log(apply ? `${written} rows updated` : 'Dry run: nothing was written. Re-run with -- --apply to update.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
