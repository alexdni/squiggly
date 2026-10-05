import 'server-only';
// Main-thread side of an analysis: fetch inputs, hand the CPU work to the job runner, store the
// cleaned file and write the results row. Called after /process has authorized the user and set
// status='processing'; it never throws — failures are written to the analysis row.

import { getStorageClient } from '@/lib/storage';
import { getServiceDatabaseClient } from '@/lib/server/serviceDb';
import { engineId, JobFailedError, runEegJob } from './jobRunner';
import { formatFromPath } from './io/loadRecording';
import type { AnalysisJobInput } from './pipeline';

export interface AnalysisJobParams {
  analysisId: string;
  /**
   * The started_at value /process wrote. Acts as the run token: results are only written while
   * the row still carries it, so a superseded run (restart after a stall) cannot overwrite a newer one.
   */
  startedAt: string;
  filePath: string;
  segments: AnalysisJobInput['segments'];
  preprocessing: AnalysisJobInput['preprocessing'];
  manualArtifacts: { start: number; end: number }[];
}

const CLEANED_CONTENT_TYPE: Record<string, string> = {
  edf: 'application/octet-stream',
  bdf: 'application/octet-stream',
  csv: 'text/csv',
};

/** One year, matching the signed URLs the Python worker issued. */
const CLEANED_URL_TTL_SEC = 365 * 24 * 3600;

export async function runAnalysisJob(params: AnalysisJobParams): Promise<void> {
  const started = Date.now();
  let db: ReturnType<typeof getServiceDatabaseClient> | null = null;
  try {
    db = getServiceDatabaseClient();
    const storage = getStorageClient();
    const format = formatFromPath(params.filePath);
    const file = await storage.download('recordings', params.filePath);
    const bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength).slice();

    const { results, cleaned } = await runEegJob(
      {
        kind: 'analysis',
        input: {
          bytes,
          format,
          segments: params.segments,
          preprocessing: params.preprocessing,
          manualArtifacts: params.manualArtifacts,
          engine: engineId(),
        },
      },
      (stage) => console.log(`[analysis ${params.analysisId}] ${stage}`)
    );

    const cleanedPath = `${params.analysisId}/cleaned_raw.${cleaned.format}`;
    let cleanedUrl: string | undefined;
    const up = await storage.upload('visuals', cleanedPath, cleaned.bytes, {
      contentType: CLEANED_CONTENT_TYPE[cleaned.format],
      upsert: true,
    });
    if (up.error) {
      console.error(`[analysis ${params.analysisId}] cleaned file upload failed`, up.error);
      results.qc_report.warnings = [...(results.qc_report.warnings ?? []), 'Cleaned file could not be stored.'];
    } else {
      cleanedUrl = (await storage.createSignedUrl('visuals', cleanedPath, CLEANED_URL_TTL_SEC)).signedUrl;
    }

    // Keep an AI interpretation written for an earlier run of this analysis.
    const { data: existing } = await db
      .from('analyses')
      .select('results')
      .eq('id', params.analysisId)
      .single();
    const prior = (existing as { results?: { ai_interpretation?: unknown } } | null)?.results;

    const { error } = await db
      .from('analyses')
      .update({
        status: 'completed',
        results: {
          ...results,
          cleaned_file_url: cleanedUrl,
          ...(prior?.ai_interpretation ? { ai_interpretation: prior.ai_interpretation } : {}),
        },
        error_log: null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', params.analysisId)
      .eq('started_at', params.startedAt)
      .execute();
    if (error) throw error;
    console.log(`[analysis ${params.analysisId}] completed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[analysis ${params.analysisId}] failed:`, err);
    const partial = err instanceof JobFailedError ? err.partialReport : undefined;
    if (!db) {
      try {
        db = getServiceDatabaseClient();
      } catch (e) {
        console.error(`[analysis ${params.analysisId}] cannot record failure: no service DB client`, e);
        return;
      }
    }
    await db
      .from('analyses')
      .update({
        status: 'failed',
        error_log: message,
        ...(partial ? { results: { qc_report_partial: partial } } : {}),
        completed_at: new Date().toISOString(),
      })
      .eq('id', params.analysisId)
      .eq('started_at', params.startedAt)
      .execute()
      .catch((e) => console.error(`[analysis ${params.analysisId}] could not record failure`, e));
  }
}
