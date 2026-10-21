import type { DatabaseClient } from '@/lib/db/types';

/** Project that owns an analysis (via its recording), or null. */
export async function projectIdForRecording(db: DatabaseClient, recordingId: string): Promise<string | null> {
  const { data } = await db.from('recordings').select('project_id').eq('id', recordingId).single();
  return (data as { project_id?: string } | null)?.project_id ?? null;
}
