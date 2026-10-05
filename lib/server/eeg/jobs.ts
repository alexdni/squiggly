// Job dispatch shared by the worker thread and the inline fallback.

import type { TheraqResults } from '@/lib/theraq';
import { runAnalysis, type AnalysisJobInput, type AnalysisJobOutput, type ProgressFn } from './pipeline';
import { runTheraq, type TheraqJobInput } from './theraqJob';

export type JobRequest =
  | { kind: 'analysis'; input: AnalysisJobInput }
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

export function runJob(req: JobRequest, progress: ProgressFn): { output: JobOutput; transfer: ArrayBuffer[] } {
  switch (req.kind) {
    case 'analysis': {
      const output = runAnalysis(req.input, progress);
      return { output, transfer: [output.cleaned.bytes.buffer as ArrayBuffer] };
    }
    case 'theraq':
      return { output: runTheraq(req.input, progress), transfer: [] };
    default:
      throw new Error(`Unknown job kind ${(req as { kind: string }).kind}`);
  }
}
