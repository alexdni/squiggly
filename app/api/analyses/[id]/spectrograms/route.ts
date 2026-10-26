import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';
import { getStorageClient } from '@/lib/storage';
import { checkProjectPermission } from '@/lib/rbac';
import { recordingCondition } from '@/lib/eeg-condition';
import type { AnalysisResults, Condition, SpectrogramData } from '@/lib/analysis-results';

/**
 * GET /api/analyses/[id]/spectrograms?channel=C3 - one channel's spectrogram per condition,
 * { eo: SpectrogramData | null, ec: SpectrogramData | null }, from the analysis's spectrograms
 * file. Results filed under the other condition (an unlabelled run of an EO or EC recording) come
 * back under the recording's own, as the analysis view shows them.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const channel = new URL(request.url).searchParams.get('channel');
    if (!channel || channel.length > 32) return NextResponse.json({ error: 'channel is required' }, { status: 400 });

    const db = getDatabaseClient();
    const { data: analysis } = await db
      .from('analyses')
      .select('recording_id, results')
      .eq('id', params.id)
      .single();
    const row = analysis as { recording_id: string; results?: Pick<AnalysisResults, 'spectrograms_path'> | null } | null;
    if (!row) return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });

    const { data: recording } = await db
      .from('recordings')
      .select('project_id, condition_type, eo_start, eo_end, ec_start, ec_end')
      .eq('id', row.recording_id)
      .single();
    const rec = recording as ({ project_id?: string } & Parameters<typeof recordingCondition>[0]) | null;
    if (!rec?.project_id || !(await checkProjectPermission(rec.project_id, user.id, 'analysis:read'))) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }
    const path = row.results?.spectrograms_path;
    if (!path) {
      return NextResponse.json({ error: 'This analysis has no per-channel spectrograms; Re-Analyze to add them' }, { status: 404 });
    }

    const file = await getStorageClient().download('visuals', path);
    const all = JSON.parse(new TextDecoder().decode(file)) as Partial<Record<Condition, Record<string, SpectrogramData> | null>>;
    const out: Record<Condition, SpectrogramData | null> = { eo: all.eo?.[channel] ?? null, ec: all.ec?.[channel] ?? null };

    const cond = recordingCondition(rec);
    if (cond === 'EC' && !out.ec && out.eo) [out.eo, out.ec] = [null, out.eo];
    if (cond === 'EO' && !out.eo && out.ec) [out.eo, out.ec] = [out.ec, null];
    if (!out.eo && !out.ec) return NextResponse.json({ error: `No spectrogram for ${channel}` }, { status: 404 });

    return NextResponse.json(out, { headers: { 'Cache-Control': 'private, max-age=3600' } });
  } catch (error) {
    console.error('Error fetching spectrogram:', error);
    return NextResponse.json({ error: 'Failed to fetch spectrogram' }, { status: 500 });
  }
}
