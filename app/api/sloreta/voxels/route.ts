import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { loadSloretaKernel } from '@/lib/server/eeg/sloreta/kernel';

/**
 * GET /api/sloreta/voxels - where each sLORETA value belongs: MNI coordinates, coarse region
 * labels and low-sensitivity flags of the kernel's voxel grid. The kernel matrix itself stays on
 * the server.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { manifest, voxels } = await loadSloretaKernel();
    return NextResponse.json(
      {
        kernel_id: manifest.kernelId,
        head_model_id: manifest.headModelId,
        coords_mni: voxels.coordsMni,
        labels: voxels.labels,
        low_sensitivity: voxels.lowSensitivity,
      },
      { headers: { 'Cache-Control': 'private, max-age=86400' } }
    );
  } catch (error) {
    console.error('Error loading sLORETA voxel grid:', error);
    return NextResponse.json({ error: 'Source localization grid unavailable' }, { status: 503 });
  }
}
