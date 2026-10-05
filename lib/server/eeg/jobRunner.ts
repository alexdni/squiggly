import 'server-only';
// Runs analysis jobs off the request path. One worker thread per server process handles jobs in
// FIFO order (each is CPU-bound for tens of seconds and allocates a few hundred MB, so running
// them concurrently would only thrash). Falls back to running inline when the worker bundle is
// missing (e.g. `next dev` before `npm run build:worker`), which blocks the event loop for the
// duration of the job but still completes.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { requestTransferables, type JobOutput, type JobOutputFor, type JobRequest } from './jobs';

type Pending = {
  resolve: (out: JobOutput) => void;
  reject: (err: Error) => void;
  onProgress?: (stage: string) => void;
};

export class JobFailedError extends Error {
  partialReport?: unknown;
  constructor(message: string, partialReport?: unknown) {
    super(message);
    this.name = 'JobFailedError';
    this.partialReport = partialReport;
  }
}

const g = globalThis as typeof globalThis & {
  __eegJobRunner?: { worker: Worker | null; pending: Map<number, Pending>; nextId: number; queue: Promise<unknown> };
};
const state = (g.__eegJobRunner ??= { worker: null, pending: new Map(), nextId: 1, queue: Promise.resolve() });

export function workerBundlePath(): string {
  return process.env.EEG_WORKER_PATH || path.join(process.cwd(), '.eeg-worker', 'worker.mjs');
}

let engineCache: string | null = null;
/** e.g. "node/biofeedback-core@0.33.0-beta.1" — stored in processing_metadata.engine */
export function engineId(): string {
  if (engineCache) return engineCache;
  let version = 'unknown';
  try {
    const pkg = path.join(process.cwd(), 'node_modules', '@divergentneuro', 'biofeedback-core', 'package.json');
    version = JSON.parse(readFileSync(pkg, 'utf8')).version ?? version;
  } catch {
    // package.json not traced into the deployment; keep 'unknown'
  }
  engineCache = `node/biofeedback-core@${version}`;
  return engineCache;
}

function failAll(err: Error) {
  state.pending.forEach((p) => p.reject(err));
  state.pending.clear();
}

function getWorker(): Worker | null {
  if (state.worker) return state.worker;
  const file = workerBundlePath();
  if (!existsSync(file)) return null;
  const w = new Worker(file, { resourceLimits: { maxOldGenerationSizeMb: 1536 } });
  w.on('message', (msg: { id: number; progress?: string; ok?: boolean; output?: JobOutput; error?: string; partialReport?: unknown }) => {
    const p = state.pending.get(msg.id);
    if (!p) return;
    if (msg.progress) {
      p.onProgress?.(msg.progress);
      return;
    }
    state.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.output as JobOutput);
    else p.reject(new JobFailedError(msg.error ?? 'Analysis failed', msg.partialReport));
  });
  w.on('error', (err) => {
    console.error('[eeg-worker] crashed', err);
    failAll(new JobFailedError(`Analysis worker crashed: ${err.message}`));
    if (state.worker === w) state.worker = null;
  });
  w.on('exit', (code) => {
    if (code !== 0) failAll(new JobFailedError(`Analysis worker exited with code ${code}`));
    if (state.worker === w) state.worker = null;
  });
  w.unref();
  state.worker = w;
  return w;
}

async function runInline(req: JobRequest, onProgress?: (stage: string) => void): Promise<JobOutput> {
  console.warn(`[eeg-worker] ${workerBundlePath()} not found; running analysis inline`);
  const { runJob } = await import('./jobs');
  try {
    return runJob(req, (s) => onProgress?.(s)).output;
  } catch (err) {
    const e = err as Error & { partialReport?: unknown };
    throw new JobFailedError(e.message, e.partialReport);
  }
}

/**
 * Longest a single job may run before the worker is terminated. Keeps one pathological input
 * from blocking the serial queue for everyone. Vercel stops the function at 300 s anyway.
 */
export function jobTimeoutMs(): number {
  const v = Number(process.env.EEG_JOB_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 8 * 60 * 1000;
}

function dispatch(req: JobRequest, onProgress?: (stage: string) => void): Promise<JobOutput> {
  const worker = getWorker();
  if (!worker) return runInline(req, onProgress);
  const id = state.nextId++;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<JobOutput>((resolve, reject) => {
    state.pending.set(id, { resolve, reject, onProgress });
    timer = setTimeout(() => {
      if (!state.pending.has(id)) return;
      console.error(`[eeg-worker] job ${id} exceeded ${jobTimeoutMs()} ms; terminating worker`);
      // Detach the stuck worker first so the next queued job gets a fresh one instead of being
      // sent to (and failed by the exit of) the worker being torn down. Jobs are serial, so
      // this is the only job it holds.
      if (state.worker === worker) state.worker = null;
      worker.removeAllListeners();
      state.pending.get(id)?.reject(new JobFailedError(`Analysis timed out after ${Math.round(jobTimeoutMs() / 1000)} s`));
      state.pending.delete(id);
      worker.terminate().catch(() => undefined);
    }, jobTimeoutMs());
    worker.ref();
    try {
      worker.postMessage({ id, ...req }, requestTransferables(req));
    } catch (err) {
      state.pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  }).finally(() => {
    clearTimeout(timer);
    if (state.pending.size === 0) state.worker?.unref();
  });
}

/** Queue a job; jobs run one at a time per server process. */
export function runEegJob<R extends JobRequest>(
  req: R,
  onProgress?: (stage: string) => void
): Promise<JobOutputFor<R['kind']>> {
  const run = state.queue.then(() => dispatch(req, onProgress));
  state.queue = run.catch(() => undefined);
  return run as Promise<JobOutputFor<R['kind']>>;
}
