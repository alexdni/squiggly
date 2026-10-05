// TheraQ four-phase analysis as pure computation (runs in the analysis worker thread). Each phase
// recording is cleaned with the artifact pipeline but WITHOUT fixed-µV epoch rejection: TheraQ
// recordings arrive at very different amplitude scales, so the TheraQ engine applies its own
// scale-invariant MAD rejection to the 2 s epochs (as the former Python worker did).

import type { PartialPipelineConfig } from '@divergentneuro/biofeedback-core';
import type { TheraqPhase, TheraqResults } from '@/lib/theraq';
import { analyzeTheraq, TheraqAnalysisError } from '@/lib/server/theraq';
import { loadRecording, type SourceFormat } from './io/loadRecording';
import { AnalysisJobError, cleanEeg, resolvePreprocessing, type PreprocessingConfig, type ProgressFn } from './pipeline';

export interface TheraqJobInput {
  phases: Partial<Record<TheraqPhase, { bytes: Uint8Array; format: SourceFormat }>>;
  preprocessing: Partial<PreprocessingConfig> & { artifact_mode?: string };
  minCleanEpochs?: number;
  rejectMadK?: number;
  engine: string;
}

export function theraqPipelineConfig(cfg: PreprocessingConfig, sampleRate: number): PartialPipelineConfig {
  const filter = {
    lineHz: cfg.line_freq,
    highPassHz: cfg.high_pass_hz,
    lowPassHz: Math.min(cfg.low_pass_hz, 0.45 * sampleRate),
  };
  if (cfg.artifact_mode === 'manual' || cfg.profile === 'legacy' || cfg.profile === 'rejectionOnly') {
    return { profile: 'full', stages: ['channelQc', 'temporalFilter', 'qcReport'], asr: { enabled: false }, filter };
  }
  return {
    profile: cfg.profile,
    stages: ['channelQc', 'temporalFilter', 'transientRepair', 'asr', 'physiological', 'qcReport'],
    filter,
    ...(cfg.asr_k != null ? { asr: { k: cfg.asr_k } } : {}),
  };
}

export function runTheraq(input: TheraqJobInput, progress: ProgressFn = () => {}): TheraqResults {
  const cfg = resolvePreprocessing(input.preprocessing);
  const epochsByPhase: Parameters<typeof analyzeTheraq>[0] = {};
  for (const [phase, file] of Object.entries(input.phases) as [TheraqPhase, { bytes: Uint8Array; format: SourceFormat }][]) {
    progress(`cleaning ${phase}`);
    const eeg = loadRecording(file.bytes, file.format);
    const { labels, data, result } = cleanEeg(eeg, theraqPipelineConfig(cfg, eeg.sampleRate));
    const len = Math.round(cfg.epoch_duration * eeg.sampleRate);
    if (!(len >= 1)) throw new AnalysisJobError(`Invalid epoch length ${cfg.epoch_duration}s`);
    const epochs: Float64Array[][] = [];
    for (let s = 0; s + len <= data[0].length; s += len) epochs.push(data.map((d) => d.subarray(s, s + len)));
    epochsByPhase[phase] = {
      sfreq: eeg.sampleRate,
      channels: labels,
      epochs,
      badChannels: result.report.channels.filter((c) => c.bad && !c.interpolated).map((c) => c.label),
    };
  }
  progress('metrics');
  try {
    return analyzeTheraq(epochsByPhase, {
      minCleanEpochs: input.minCleanEpochs,
      rejectMadK: input.rejectMadK,
      artifactMode: cfg.artifact_mode === 'manual' ? 'manual' : `pipeline:${cfg.profile}`,
      engine: input.engine,
    });
  } catch (err) {
    if (err instanceof TheraqAnalysisError) throw new AnalysisJobError(err.message);
    throw err;
  }
}
