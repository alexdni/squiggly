// Uploads the sLORETA kernel (the three files published as release assets on
// DivergentNeuro/biofeedback-core v0.31.0-beta.3) to the private `models` bucket, where the
// analysis job loads it from. The kernel is kept out of git: squiggly is a public repo.
//
//   gh release download v0.31.0-beta.3 -R DivergentNeuro/biofeedback-core -p 'fsaverage-5mm-19ch-v1.*' -D /tmp/kernel
//   node --env-file=.env.local scripts/upload-sloreta-kernel.mjs /tmp/kernel
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. For local (Docker) storage, set
// SLORETA_KERNEL_DIR to the directory instead.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const dir = process.argv[2];
const id = process.env.SLORETA_KERNEL_ID || 'fsaverage-5mm-19ch-v1';
const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
if (!dir || !url || !key) {
  console.error('usage: node --env-file=.env.local scripts/upload-sloreta-kernel.mjs <kernel-dir>');
  process.exit(1);
}

const files = ['bin', 'manifest.json', 'voxels.json'].map((ext) => `${id}.${ext}`);
const bytes = Object.fromEntries(files.map((f) => [f, readFileSync(path.join(dir, f))]));
const manifest = JSON.parse(bytes[`${id}.manifest.json`].toString('utf8'));
const sha = createHash('sha256').update(bytes[`${id}.bin`]).digest('hex');
if (sha !== manifest.checksum) {
  console.error(`checksum mismatch: manifest ${manifest.checksum}, ${id}.bin hashes to ${sha}`);
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const { data: buckets, error: listError } = await supabase.storage.listBuckets();
if (listError) throw listError;
if (!buckets.some((b) => b.name === 'models')) {
  const { error } = await supabase.storage.createBucket('models', { public: false });
  if (error) throw error;
  console.log('created private bucket models');
}
for (const f of files) {
  const { error } = await supabase.storage
    .from('models')
    .upload(`sloreta/${f}`, bytes[f], { upsert: true, contentType: 'application/octet-stream' });
  if (error) throw error;
  console.log(`uploaded models/sloreta/${f} (${bytes[f].length} bytes)`);
}
