import 'server-only';
// Main-thread side of a TheraQ analysis: download the four phase recordings, run the TheraQ job
// in the analysis worker, and write project_analyses. Never throws; failures are recorded on the row.

import type { TheraqPhase } from '@/lib/theraq';
import { getStorageClient } from '@/lib/storage';
import { getServiceDatabaseClient } from '@/lib/server/serviceDb';
import { formatFromPath } from './io/loadRecording';
import { engineId, runEegJob } from './jobRunner';
import type { TheraqJobInput } from './theraqJob';

export interface TheraqJobParams {
  projectAnalysisId: string;
  phaseFiles: Partial<Record<TheraqPhase, string>>;
  preprocessing: TheraqJobInput['preprocessing'];
}

export async function runTheraqJob(params: TheraqJobParams): Promise<void> {
  let db: ReturnType<typeof getServiceDatabaseClient> | null = null;
  try {
    db = getServiceDatabaseClient();
    const storage = getStorageClient();
    const phases: TheraqJobInput['phases'] = {};
    for (const [phase, filePath] of Object.entries(params.phaseFiles) as [TheraqPhase, string][]) {
      const file = await storage.download('recordings', filePath);
      phases[phase] = {
        bytes: new Uint8Array(file.buffer, file.byteOffset, file.byteLength).slice(),
        format: formatFromPath(filePath),
      };
    }
    const results = await runEegJob(
      { kind: 'theraq', input: { phases, preprocessing: params.preprocessing, engine: engineId() } },
      (stage) => console.log(`[theraq ${params.projectAnalysisId}] ${stage}`)
    );
    const { error } = await db
      .from('project_analyses')
      .update({ status: 'completed', results, error_log: null, completed_at: new Date().toISOString() })
      .eq('id', params.projectAnalysisId)
      .execute();
    if (error) throw error;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[theraq ${params.projectAnalysisId}] failed:`, err);
    if (!db) {
      try {
        db = getServiceDatabaseClient();
      } catch (e) {
        console.error(`[theraq ${params.projectAnalysisId}] cannot record failure: no service DB client`, e);
        return;
      }
    }
    await db
      .from('project_analyses')
      .update({ status: 'failed', error_log: message, completed_at: new Date().toISOString() })
      .eq('id', params.projectAnalysisId)
      .execute()
      .catch((e) => console.error(`[theraq ${params.projectAnalysisId}] could not record failure`, e));
  }
}
