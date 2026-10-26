// Job dispatch shared by the worker thread and the inline fallback.

import type { TheraqResults } from '@/lib/theraq';
import { runAnalysis, type AnalysisJobInput, type AnalysisJobOutput, type ProgressFn } from './pipeline';
import { ensureKernel, type SloretaKernelFiles } from './sloreta/compute';
import { runTheraq, type TheraqJobInput } from './theraqJob';

export type JobRequest =
  | {
      kind: 'analysis';
      input: AnalysisJobInput;
      /** loaded on the main thread (sloreta/kernel.ts); verified and registered in the worker */
      sloretaKernel?: SloretaKernelFiles | { unavailable: string };
    }
  | { kind: 'theraq'; input: TheraqJobInput };

export type JobOutputFor<K extends JobRequest['kind']> = K extends 'analysis' ? AnalysisJobOutput : TheraqResults;
export type JobOutput = AnalysisJobOutput | TheraqResults;

/** ArrayBuffers in the request that can be transferred to the worker instead of copied. */
export function requestTransferables(req: JobRequest): ArrayBuffer[] {
  const bufs =
    req.kind === 'analysis'
      ? [req.input.bytes.buffer]
      : Object.values(req.input.phases).map((p) => p!.bytes.buffer);
  return [...new Set(bufs)] as ArrayBuffer[];
}

async function resolveSloreta(kernel: SloretaKernelFiles | { unavailable: string } | undefined): Promise<AnalysisJobInput['sloreta']> {
  if (!kernel || 'unavailable' in kernel) return kernel;
  try {
    return { kernelId: await ensureKernel(kernel) };
  } catch (err) {
    return { unavailable: `the head-model kernel failed verification (${(err as Error).message})` };
  }
}

export async function runJob(req: JobRequest, progress: ProgressFn): Promise<{ output: JobOutput; transfer: ArrayBuffer[] }> {
  switch (req.kind) {
    case 'analysis': {
      const sloreta = await resolveSloreta(req.sloretaKernel);
      const output = runAnalysis({ ...req.input, sloreta }, progress);
      const transfer = [
        output.cleaned.bytes.buffer,
        output.sloretaValues?.buffer,
        output.sloretaSpectra?.buffer,
        output.spectrogramFile?.buffer,
      ].filter(Boolean);
      return { output, transfer: transfer as ArrayBuffer[] };
    }
    case 'theraq':
      return { output: runTheraq(req.input, progress), transfer: [] };
    default:
      throw new Error(`Unknown job kind ${(req as { kind: string }).kind}`);
  }
}
