import { describe, expect, it } from 'vitest';
import { findEcgChannel, isEcgLabel } from '@/lib/eeg-labels';
import { writeCsv, writeEdf } from '../export/writers';
import { computeHrv } from '../hrv';
import { loadRecording } from '../io/loadRecording';

const FS = 250;

/**
 * Synthetic ECG: QRS spikes at beat times whose RR interval is 800 ms modulated ±40 ms at
 * 0.25 Hz (respiratory sinus arrhythmia), plus P/T waves, baseline drift, mains and noise.
 * Known answers: HR ≈ 75 bpm, SDNN ≈ 40/√2 ≈ 28 ms, RMSSD ≈ 33 ms, power concentrated in HF.
 */
function syntheticEcg(seconds: number, opts: { offsetUv?: number; inverted?: boolean } = {}) {
  const n = seconds * FS;
  const x = new Float64Array(n);
  const beats: number[] = [];
  let t = 0.5;
  while (t < seconds - 0.5) {
    beats.push(t);
    t += (800 + 40 * Math.sin(2 * Math.PI * 0.25 * t)) / 1000;
  }
  let seed = 11;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5;
  for (let i = 0; i < n; i++) {
    const ti = i / FS;
    x[i] = (opts.offsetUv ?? 0) + 300 * Math.sin(2 * Math.PI * 0.1 * ti) + 30 * Math.sin(2 * Math.PI * 60 * ti) + 20 * rand();
  }
  for (const b of beats) {
    const wave = (center: number, width: number, amp: number) => {
      const c = Math.round((b + center) * FS);
      const w = Math.ceil((width * FS) / 1000) * 4;
      for (let k = -w; k <= w; k++) {
        const i = c + k;
        if (i >= 0 && i < n) x[i] += amp * Math.exp(-(((k / FS) * 1000) ** 2) / (2 * width ** 2));
      }
    };
    wave(-0.16, 25, 120); // P
    wave(0, 8, 1200); // R
    wave(0.025, 10, -250); // S
    wave(0.3, 60, 250); // T
  }
  if (opts.inverted) for (let i = 0; i < n; i++) x[i] = -x[i];
  return { data: x, beats };
}

describe('ECG labels', () => {
  it.each(['ECG', 'ecg', 'EKG', 'ECG1', 'ECG I', 'ECG-LA', 'EEG ECG'])('%s is an ECG lead', (l) =>
    expect(isEcgLabel(l)).toBe(true)
  );
  it.each(['z-ECG', 'Cz', 'EXG1', 'EEG Fp1-LE', 'ECGlike-noise'])('%s is not', (l) => expect(isEcgLabel(l)).toBe(false));
  it('finds the first ECG lead', () => expect(findEcgChannel(['Fp1', 'z-ECG', 'ECG', 'EKG'])).toBe(2));
});

describe('computeHrv', () => {
  it('recovers heart rate, time-domain HRV and an HF-dominant spectrum', () => {
    const { data } = syntheticEcg(240, { offsetUv: -90_000 });
    const hrv = computeHrv({ label: 'ECG', data, sampleRate: FS });
    expect(hrv.reliable).toBe(true);
    expect(hrv.coverage_pct).toBeGreaterThan(90);
    expect(hrv.summary.mean_hr_bpm!).toBeGreaterThan(72);
    expect(hrv.summary.mean_hr_bpm!).toBeLessThan(78);
    expect(hrv.summary.sdnn_ms!).toBeGreaterThan(20);
    expect(hrv.summary.sdnn_ms!).toBeLessThan(40);
    expect(hrv.summary.rmssd_ms!).toBeGreaterThan(22);
    expect(hrv.summary.rmssd_ms!).toBeLessThan(45);
    expect(hrv.summary.hf_ms2!).toBeGreaterThan(hrv.summary.lf_ms2!);
    expect(hrv.summary.lf_hf!).toBeLessThan(1);
    expect(hrv.series.heart_rate_bpm!.v.length).toBeGreaterThan(200);
    expect(hrv.series.rmssd_ms!.t.length).toBeGreaterThan(5);
    expect(hrv.series.lf_hf!.v.every((v) => v > 0)).toBe(true);
    expect(hrv.notes.some((n) => /VLF/.test(n))).toBe(true); // 4 min < 4.5 min
  }, 60_000);

  it('does not depend on lead polarity', () => {
    const up = computeHrv({ label: 'ECG', data: syntheticEcg(150).data, sampleRate: FS });
    const down = computeHrv({ label: 'ECG', data: syntheticEcg(150, { inverted: true }).data, sampleRate: FS });
    expect(Math.abs(up.beats - down.beats)).toBeLessThanOrEqual(1);
    expect(Math.abs(up.summary.mean_hr_bpm! - down.summary.mean_hr_bpm!)).toBeLessThan(1);
  }, 60_000);

  it('withholds metrics when no heartbeat can be found (electrode off)', () => {
    let seed = 3;
    const noise = Float64Array.from({ length: 120 * FS }, () => 20_000 * (((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5));
    const hrv = computeHrv({ label: 'ECG', data: noise, sampleRate: FS });
    expect(hrv.reliable).toBe(false);
    expect(hrv.summary.mean_hr_bpm).toBeNull();
    expect(hrv.series).toEqual({});
    expect(hrv.notes[0]).toMatch(/electrode contact/);
  }, 60_000);
});

describe('ECG in uploaded files', () => {
  it('EDF/BDF: decodes the ECG lead at its own rate, apart from the EEG', () => {
    const fs = 500;
    const eeg = Float64Array.from({ length: fs * 4 }, (_, i) => 20 * Math.sin((2 * Math.PI * 10 * i) / fs));
    const ecg = Float64Array.from({ length: fs * 4 }, (_, i) => (i % fs === 0 ? 1000 : 0));
    const bytes = writeEdf({ labels: ['EEG Fp1-LE', 'EEG Cz-LE', 'ECG'], data: [eeg, eeg, ecg], sampleRate: fs }, { bdf: true });
    const rec = loadRecording(bytes, 'bdf');
    expect(rec.labels).toEqual(['Fp1', 'Cz']);
    expect(rec.ignored).not.toContain('ECG');
    expect(rec.ecg?.label).toBe('ECG');
    expect(rec.ecg?.sampleRate).toBe(250);
    expect(rec.ecg?.data.length).toBe(250 * 4);
  });

  it('CSV: keeps the ecg column, ignores z-ecg', () => {
    const fs = 250;
    const data = [Float64Array.from({ length: fs * 2 }, (_, i) => Math.sin(i)), Float64Array.from({ length: fs * 2 }, (_, i) => 5 * Math.cos(i))];
    const text = new TextDecoder().decode(writeCsv({ labels: ['Cz', 'ecg'], data, sampleRate: fs }));
    const rec = loadRecording(new TextEncoder().encode(text), 'csv');
    expect(rec.labels).toEqual(['Cz']);
    expect(rec.ecg?.label).toBe('ecg');
    expect(rec.ecg?.data.length).toBe(fs * 2);
  });
});
