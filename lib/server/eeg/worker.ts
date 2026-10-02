// worker_threads entry for analysis jobs. Bundled separately by scripts/build-eeg-worker.mjs into
// .eeg-worker/worker.mjs so the Next.js server can hand off the ~30 s CPU-bound pipeline without
// blocking its event loop. Messages: {id, kind:'analysis'|'theraq', input} → progress*, then
// {id, ok:true, output} or {id, ok:false, error, partialReport}.

import { parentPort } from 'node:worker_threads';
import { runJob, type JobRequest } from './jobs';

if (!parentPort) throw new Error('eeg worker must run inside worker_threads');
const port = parentPort;

port.on('message', (msg: { id: number } & JobRequest) => {
  try {
    const { output, transfer } = runJob(msg, (stage) => port.postMessage({ id: msg.id, progress: stage }));
    port.postMessage({ id: msg.id, ok: true, output }, transfer);
  } catch (err) {
    const e = err as Error & { partialReport?: unknown };
    port.postMessage({ id: msg.id, ok: false, error: e?.message ?? String(err), partialReport: e?.partialReport });
  }
});
