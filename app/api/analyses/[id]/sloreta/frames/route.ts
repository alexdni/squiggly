import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDatabaseClient } from '@/lib/db';
import { getStorageClient } from '@/lib/storage';
import { checkProjectPermission } from '@/lib/rbac';
import type { SloretaResults } from '@/lib/analysis-results';
import { encodeFrames, triSize } from '@/lib/server/eeg/sloreta/frames';
import { loadSloretaGram } from '@/lib/server/eeg/sloreta/kernel';

/** Frames per request: 200 × 15k voxels ≈ 3 MB, under the 4.5 MB function response limit. */
const MAX_FRAMES = 200;

// A few recent analyses' cross-spectra (~5 MB each), so a band's chunks don't refetch them.
const g = globalThis as typeof globalThis & { __sloretaSpectra?: Map<string, Float32Array> };
const spectraCache = (g.__sloretaSpectra ??= new Map());

async function loadSpectra(path: string): Promise<Float32Array> {
  const hit = spectraCache.get(path);
  if (hit) return hit;
  const file = await getStorageClient().download('visuals', path);
  const copy = new Uint8Array(file); // aligned copy for the Float32 view
  const spectra = new Float32Array(copy.buffer, 0, copy.byteLength / 4);
  spectraCache.set(path, spectra);
  while (spectraCache.size > 4) spectraCache.delete(spectraCache.keys().next().value!);
  return spectra;
}

/**
 * GET /api/analyses/[id]/sloreta/frames?band=alpha2&start=0&count=200 - time-lapse frames of one
 * band: `count` Float32 frame maxima (-1 for a rejected window), then `count` × voxel bytes,
 * value ≈ byte / 255 × frame maximum.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const db = getDatabaseClient();
    const { data: analysis } = await db
      .from('analyses')
      .select('recording_id, results')
      .eq('id', params.id)
      .single();
    const row = analysis as { recording_id: string; results?: { sloreta?: SloretaResults } } | null;
    if (!row) return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });

    const { data: recording } = await db.from('recordings').select('project_id').eq('id', row.recording_id).single();
    const projectId = (recording as { project_id?: string } | null)?.project_id;
    if (!projectId || !(await checkProjectPermission(projectId, user.id, 'analysis:read'))) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    const sloreta = row.results?.sloreta;
    const timeline = sloreta?.timeline;
    if (!sloreta || !timeline?.spectra_path) {
      return NextResponse.json({ error: 'No source-localization time lapse for this analysis' }, { status: 404 });
    }

    const url = new URL(request.url);
    const band = sloreta.bands.findIndex((b) => b.name === url.searchParams.get('band'));
    const start = Number(url.searchParams.get('start') ?? 0);
    const count = Math.min(MAX_FRAMES, Number(url.searchParams.get('count') ?? MAX_FRAMES), timeline.n_windows - start);
    if (band < 0 || !Number.isInteger(start) || start < 0 || !(count > 0)) {
      return NextResponse.json({ error: 'Invalid band or frame range' }, { status: 400 });
    }

    const [gram, spectra] = await Promise.all([loadSloretaGram(), loadSpectra(timeline.spectra_path)]);
    if (gram.kernelId !== sloreta.kernel_id) {
      return NextResponse.json({ error: `Computed with kernel ${sloreta.kernel_id}, server has ${gram.kernelId}` }, { status: 409 });
    }
    if (spectra.length !== timeline.n_windows * sloreta.bands.length * triSize(gram.nCh)) {
      return NextResponse.json({ error: 'Stored time lapse does not match the analysis metadata' }, { status: 500 });
    }

    const body = encodeFrames({
      G: gram.G,
      nVox: gram.nVox,
      spectra,
      nBands: sloreta.bands.length,
      band,
      rejected: new Set(timeline.rejected),
      start,
      count,
    });
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
        'X-Frame-Count': String(count),
      },
    });
  } catch (error) {
    console.error('Error computing sLORETA frames:', error);
    return NextResponse.json({ error: 'Failed to compute source-localization frames' }, { status: 500 });
  }
}
