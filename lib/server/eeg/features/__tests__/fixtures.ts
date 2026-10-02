import inputs from '../../__fixtures__/features/synthetic_eeg.json';
import type { EpochSet } from '../types';

type Cond = 'eo' | 'ec';

/** Decode the int16-quantised synthetic EEG written by scripts/fixtures/gen_feature_fixtures.py. */
export function loadEpochs(cond: Cond): EpochSet {
  const meta = inputs[cond];
  const buf = Buffer.from(meta.data_b64, 'base64');
  const q = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const nCh = inputs.channels.length;
  const { n_epochs: nEp, n_times: nT } = meta;
  const epochs: Float64Array[][] = [];
  for (let e = 0; e < nEp; e++) {
    const row: Float64Array[] = [];
    for (let c = 0; c < nCh; c++) {
      const base = (e * nCh + c) * nT;
      row.push(Float64Array.from(q.subarray(base, base + nT), (v) => v * inputs.scale_uv));
    }
    epochs.push(row);
  }
  return { sfreq: inputs.sfreq, channels: [...inputs.channels], epochs };
}

export function subsetEpochs(set: EpochSet, channels: string[], nEpochs: number): EpochSet {
  const idx = channels.map((ch) => set.channels.indexOf(ch));
  return {
    sfreq: set.sfreq,
    channels: [...channels],
    epochs: set.epochs.slice(0, nEpochs).map((ep) => idx.map((i) => ep[i])),
  };
}

/** Running max-error tracker so tests can report what they observed. */
export class ErrorLog {
  private readonly max = new Map<string, number>();
  note(metric: string, err: number): void {
    this.max.set(metric, Math.max(this.max.get(metric) ?? 0, err));
  }
  get(metric: string): number {
    return this.max.get(metric) ?? 0;
  }
  entries(): [string, number][] {
    return [...this.max.entries()];
  }
}

/** |a-b| / |b|, or |a-b| when |b| is below `absFloor`. */
export function relOrAbs(a: number, b: number, absFloor = 1e-9): number {
  const d = Math.abs(a - b);
  return Math.abs(b) < absFloor ? d : d / Math.abs(b);
}
