import 'server-only';
import { waitUntil } from '@vercel/functions';

/**
 * Keep `task` running after the response is sent. On Vercel the function instance stays alive
 * until it settles (bounded by the route's maxDuration); on a long-running Node server (Docker)
 * the promise simply continues.
 */
export function runInBackground(task: () => Promise<void>): void {
  const p = task().catch((err) => console.error('[background] task failed', err));
  waitUntil(p);
}
