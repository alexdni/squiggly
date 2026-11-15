// One-off: set recordings.recorded_at from each file's header (EDF/BDF start date and time, or
// the first CSV timestamp when it is an absolute time). Reads only the first bytes of each file.
//
//   npx vite-node -c vitest.config.ts scripts/backfill-recording-recorded-at.ts            (dry run)
//   npx vite-node -c vitest.config.ts scripts/backfill-recording-recorded-at.ts -- --apply
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from .env.local if unset).

import fs from 'node:fs';
import { recordedAtFromFile } from '@/lib/recording-time';

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

interface Row {
  id: string;
  filename: string;
  file_path: string;
  created_at: string;
  recorded_at: string | null;
}

async function main() {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(
      `${base}/rest/v1/recordings?select=id,filename,file_path,created_at,recorded_at&order=created_at&offset=${offset}&limit=1000`,
      { headers }
    );
    if (!res.ok) throw new Error(`listing recordings failed: ${res.status}`);
    const page = (await res.json()) as Row[];
    rows.push(...page);
    if (page.length < 1000) break;
  }

  const kinds = new Map<string, number>();
  const bump = (k: string) => kinds.set(k, (kinds.get(k) ?? 0) + 1);
  let failed = 0;
  let written = 0;
  let earliest = '';
  let latest = '';
  for (const row of rows) {
    try {
      const path = row.file_path.split('/').map(encodeURIComponent).join('/');
      const file = await fetch(`${base}/storage/v1/object/recordings/${path}`, {
        headers: { ...headers, Range: 'bytes=0-4095' },
      });
      if (!file.ok) throw new Error(`download ${file.status}`);
      const ext = row.filename.split('.').pop();
      const recordedAt = recordedAtFromFile(new Uint8Array(await file.arrayBuffer()), ext, new Date(row.created_at));
      bump(
        `${ext?.toLowerCase()}: ${
          recordedAt === null ? 'none' : recordedAt.endsWith('Z') ? 'absolute time' : recordedAt.includes('T') ? 'date and time' : 'date only'
        }`
      );
      if (recordedAt) {
        const day = recordedAt.slice(0, 10);
        if (!earliest || day < earliest) earliest = day;
        if (!latest || day > latest) latest = day;
      }
      if (recordedAt === row.recorded_at || !apply) continue;
      const res = await fetch(`${base}/rest/v1/recordings?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ recorded_at: recordedAt }),
      });
      if (!res.ok) throw new Error(`update ${res.status}`);
      written++;
    } catch (err) {
      failed++;
      console.error(`${row.id}: ${(err as Error).message}`);
    }
  }

  console.log(`${rows.length} recordings, ${failed} failed; recording dates from ${earliest} to ${latest}`);
  for (const [kind, n] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${kind}`);
  console.log(apply ? `${written} rows updated` : 'Dry run: nothing was written. Re-run with -- --apply to update.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
