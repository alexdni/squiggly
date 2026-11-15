import { describe, expect, it } from 'vitest';
import { buildMontage, combine, montageAvailability, montageAvailable, referenceElectrodes } from '../montage';
import { keyPanSeconds, panStart, wheelPanPixels } from '../pan';
import { computeOriginalOverlay } from '../originalOverlay';

const LE = ['EEG Fp1-LE', 'EEG F3-LE', 'EEG Fz-LE', 'EEG Cz-LE', 'EEG C3-LE', 'EEG P3-LE', 'EEG Pz-LE', 'EEG A2-A1'];
const PLAIN = ['Fp1', 'F7', 'F3', 'Fz', 'Cz', 'C3', 'P3', 'Pz', 'T3', 'T5', 'O1', 'A1', 'A2', 'ECG'];
const all = (names: string[]) => names.map((_, i) => i);
/** one sample per channel: channel i holds 2^i, so every weighted sum is recognisable */
const values = (names: string[]) => names.map((_, i) => [2 ** i]);
const at = (names: string[], montage: Parameters<typeof buildMontage>[0], label: string, ref?: string) => {
  const row = buildMontage(montage, names, all(names), ref).find((r) => r.label === label);
  return row ? combine(values(names), row.terms, 0, 1)[0] : undefined;
};

describe('montage availability', () => {
  it('offers linked ears and single ears on a linked-ears file with an A2-A1 channel', () => {
    const a = montageAvailability(LE);
    expect([a.recorded, a.average, a.linked_ears, a.a1, a.a2, a.ipsilateral, a.contralateral]).toEqual([null, null, null, null, null, null, null]);
    expect(montageAvailable('ch:Cz', LE)).toBe(true);
  });

  it('explains why linked ears is missing on plain labels without ear channels', () => {
    const a = montageAvailability(['Fp1', 'Fp2', 'Cz']);
    expect(a.linked_ears).toMatch(/not labelled linked ears/);
    expect(a.a1).toMatch(/A1 and A2/);
    expect(montageAvailability(['Fp1', 'Fp2', 'Cz'], 'LE').linked_ears).toBeNull();
    expect(montageAvailability(['Fp1', 'Fp2', 'Cz'], 'LE').a1).toMatch(/A2-A1/);
  });

  it('needs Cz, neighbours and chains', () => {
    const a = montageAvailability(['O1', 'T8']);
    expect(montageAvailable('ch:Cz', ['O1', 'T8'])).toBe(false);
    expect(a.bipolar_transverse).toBeTruthy();
    expect(a.laplacian).toBeTruthy();
    expect(a.bipolar).toBeTruthy();
    expect(montageAvailability(PLAIN).bipolar).toBeNull();
    expect(montageAvailability(PLAIN).laplacian).toBeNull();
  });
});

describe('montage rows', () => {
  it('as recorded shows every selected channel unchanged', () => {
    const rows = buildMontage('recorded', LE, [0, 3, 7]);
    expect(rows.map((r) => r.label)).toEqual(['Fp1', 'Cz', 'A2-A1']);
    expect(rows.map((r) => r.channel)).toEqual(['Fp1', 'Cz', null]);
    expect(rows[1].terms).toEqual([[3, 1]]);
  });

  it('average subtracts the mean of the selected scalp channels only', () => {
    const rows = buildMontage('average', LE, [0, 1, 7]);
    const v = values(LE);
    expect(combine(v, rows[0].terms, 0, 1)[0]).toBeCloseTo(1 - (1 + 2) / 2);
    expect(combine(v, rows[1].terms, 0, 1)[0]).toBeCloseTo(2 - (1 + 2) / 2);
    // the ear channel is shown as it is and is not part of the mean
    expect(combine(v, rows[2].terms, 0, 1)[0]).toBe(128);
  });

  it('linked ears is the file itself when labelled, and A1/A2 come from the ear difference', () => {
    expect(at(LE, 'linked_ears', 'Cz')).toBe(8);
    expect(at(LE, 'a1', 'Cz')).toBe(8 + 128 / 2); // X−A1 = X−LE + (A2−A1)/2
    expect(at(LE, 'a2', 'Cz')).toBe(8 - 128 / 2);
  });

  it('linked ears on plain labels subtracts the mean of A1 and A2', () => {
    const [a1, a2] = [PLAIN.indexOf('A1'), PLAIN.indexOf('A2')];
    expect(at(PLAIN, 'linked_ears', 'Cz')).toBe(2 ** 4 - (2 ** a1 + 2 ** a2) / 2);
    // ECG is passed through
    expect(at(PLAIN, 'linked_ears', 'ECG')).toBe(2 ** PLAIN.indexOf('ECG'));
  });

  it('Cz reference drops the Cz row', () => {
    expect(at(PLAIN, 'ch:Cz', 'Fz')).toBe(2 ** 3 - 2 ** 4);
    expect(at(PLAIN, 'ch:Cz', 'Cz')).toBeUndefined();
  });

  it('Laplacian subtracts the neighbour mean and ignores a common signal', () => {
    const rows = buildMontage('laplacian', PLAIN, all(PLAIN));
    const c3 = rows.find((r) => r.label === 'C3')!;
    // C3 neighbours: F3, P3, T7 (labelled T3 here), Cz
    const expected = 2 ** 5 - (2 ** 2 + 2 ** 6 + 2 ** 8 + 2 ** 4) / 4;
    expect(combine(values(PLAIN), c3.terms, 0, 1)[0]).toBeCloseTo(expected);
    const shifted = PLAIN.map((_, i) => [2 ** i + 1000]);
    expect(combine(shifted, c3.terms, 0, 1)[0]).toBeCloseTo(expected);
  });

  it('bipolar rows are the standard chains for the channels switched on', () => {
    const rows = buildMontage('bipolar', PLAIN, all(PLAIN));
    expect(rows.map((r) => r.label)).toEqual([
      'Fp1-F7', 'F7-T7', 'T7-P7', 'P7-O1', 'Fp1-F3', 'F3-C3', 'C3-P3', 'P3-O1', 'Fz-Cz', 'Cz-Pz', 'A1', 'A2', 'ECG',
    ]);
    expect(combine(values(PLAIN), rows[0].terms, 0, 1)[0]).toBe(1 - 2);
    expect(rows[0].channel).toBe('Fp1');
    const without = buildMontage('bipolar', PLAIN, all(PLAIN).filter((i) => PLAIN[i] !== 'F7'));
    expect(without.map((r) => r.label)).not.toContain('Fp1-F7');
  });

  it('references every channel to any one electrode', () => {
    expect(referenceElectrodes(PLAIN)).toEqual(['Fp1', 'F7', 'F3', 'Fz', 'Cz', 'C3', 'P3', 'Pz', 'T7', 'P7', 'O1']);
    expect(at(PLAIN, 'ch:Pz', 'Fz')).toBe(2 ** 3 - 2 ** 7);
    expect(at(PLAIN, 'ch:Pz', 'Pz')).toBeUndefined();
    expect(montageAvailable('ch:Oz', PLAIN)).toBe(false);
  });

  it('ipsilateral and contralateral ears pick the ear by side, midline on linked ears', () => {
    const [a1, a2] = [2 ** PLAIN.indexOf('A1'), 2 ** PLAIN.indexOf('A2')];
    const both = [...PLAIN.slice(0, 11), 'C4', 'A1', 'A2'];
    const [b1, b2] = [2 ** both.indexOf('A1'), 2 ** both.indexOf('A2')];
    expect(a1).toBe(2 ** 11);
    expect(at(both, 'ipsilateral', 'C3')).toBe(2 ** 5 - b1);
    expect(at(both, 'ipsilateral', 'C4')).toBe(2 ** 11 - b2);
    expect(at(both, 'ipsilateral', 'Cz')).toBe(2 ** 4 - (b1 + b2) / 2);
    expect(at(both, 'contralateral', 'C3')).toBe(2 ** 5 - b2);
    expect(at(both, 'contralateral', 'C4')).toBe(2 ** 11 - b1);
    // on a linked-ears file the ears come from the A2-A1 channel
    expect(at(LE, 'ipsilateral', 'F3')).toBe(2 + 128 / 2);
    expect(at(LE, 'contralateral', 'F3')).toBe(2 - 128 / 2);
    expect(at(LE, 'ipsilateral', 'Cz')).toBe(8);
    expect(a2).toBe(2 ** 12);
  });

  it('an ear lead recorded against linked ears is half the ear difference', () => {
    const names = ['EEG F3-LE', 'EEG Cz-LE', 'EEG A2-LE'];
    expect(montageAvailability(names).a1).toBeNull();
    expect(at(names, 'a1', 'F3')).toBe(1 + 4); // X−A1 = X−LE + (A2−LE)
    expect(at(names, 'a2', 'F3')).toBe(1 - 4);
  });

  it('uses TP9/TP10 as the ear leads when there are no A1/A2 channels', () => {
    const names = ['TP9', 'AF7', 'AF8', 'TP10', 'Cz'];
    expect(montageAvailability(names).linked_ears).toBeNull();
    const rows = buildMontage('linked_ears', names, all(names));
    // the mastoid sites are the reference, so they are not drawn against themselves
    expect(rows.map((r) => r.label)).toEqual(['AF7', 'AF8', 'Cz']);
    expect(combine(values(names), rows[0].terms, 0, 1)[0]).toBe(2 - (1 + 8) / 2);
    expect(at(names, 'ipsilateral', 'AF8')).toBe(4 - 8);
  });

  it('transverse and circumferential chains', () => {
    const full = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T3', 'C3', 'Cz', 'C4', 'T4', 'T5', 'P3', 'Pz', 'P4', 'T6', 'O1', 'O2'];
    expect(buildMontage('bipolar_transverse', full, all(full)).map((r) => r.label)).toEqual([
      'Fp1-Fp2', 'F7-F3', 'F3-Fz', 'Fz-F4', 'F4-F8', 'T7-C3', 'C3-Cz', 'Cz-C4', 'C4-T8', 'P7-P3', 'P3-Pz', 'Pz-P4', 'P4-P8', 'O1-O2',
    ]);
    const ring = buildMontage('bipolar_circumferential', full, all(full));
    expect(ring.map((r) => r.label)).toEqual([
      'Fp1-F7', 'F7-T7', 'T7-P7', 'P7-O1', 'O1-O2', 'O2-P8', 'P8-T8', 'T8-F8', 'F8-Fp2', 'Fp2-Fp1',
    ]);
    // a closed ring sums to zero
    const sum = ring.reduce((s, r) => s + combine(values(full), r.terms, 0, 1)[0], 0);
    expect(sum).toBe(0);
  });

  it('falls back to the recording when the montage is not available', () => {
    expect(buildMontage('linked_ears', ['Fp1', 'Cz'], [0, 1]).map((r) => r.terms)).toEqual([[[0, 1]], [[1, 1]]]);
  });
});

describe('original overlay under a montage', () => {
  const fs = 100;
  const n = fs * 20;
  const sig = (hz: number) => Array.from({ length: n }, (_, i) => 10 * Math.sin((2 * Math.PI * hz * i) / fs));
  const raw = { signals: [sig(6), sig(10), sig(14)], sampleRate: fs, duration: 20, channelNames: ['EEG Fz-LE', 'EEG Cz-LE', 'EEG Pz-LE'], fileType: 'edf' as const };
  const targetTimes = Array.from({ length: 200 }, (_, i) => 8 + i / 100);
  const base = { raw, cleanedNames: ['Fz', 'Cz', 'Pz'], selected: [0, 1, 2], timeStart: 8, windowSeconds: 2, filters: { highpassHz: 1, lowpassHz: 45, notchHz: 60 }, targetTimes };

  it('a reference-free row is the same with or without the average', () => {
    const rows: [number, number][][] = [[[0, 1], [1, -1]]];
    const withAvg = computeOriginalOverlay({ ...base, rows })[0]!;
    const without = computeOriginalOverlay({ ...base, rows, subtractAverage: false })[0]!;
    withAvg.forEach((v, i) => expect(v).toBeCloseTo(without[i], 6));
  });

  it('keeps the recording reference when the analysis did', () => {
    const avg = computeOriginalOverlay(base)[1]!;
    const asRecorded = computeOriginalOverlay({ ...base, subtractAverage: false })[1]!;
    expect(Math.max(...asRecorded.map((v, i) => Math.abs(v - avg[i])))).toBeGreaterThan(1);
  });
});

describe('panning', () => {
  it('pans on sideways scroll and Shift+wheel, and leaves vertical scroll to the page', () => {
    expect(wheelPanPixels({ deltaX: 30, deltaY: 2, deltaMode: 0, shiftKey: false })).toBe(30);
    expect(wheelPanPixels({ deltaX: 0, deltaY: 40, deltaMode: 0, shiftKey: false })).toBe(0);
    expect(wheelPanPixels({ deltaX: 0, deltaY: 40, deltaMode: 0, shiftKey: true })).toBe(40);
    expect(wheelPanPixels({ deltaX: 0, deltaY: 3, deltaMode: 1, shiftKey: true })).toBe(48);
  });

  it('maps keys to steps', () => {
    expect(keyPanSeconds('ArrowRight', false, 10)).toBe(1);
    expect(keyPanSeconds('ArrowLeft', true, 10)).toBe(-10);
    expect(keyPanSeconds('PageDown', false, 10)).toBe(10);
    expect(keyPanSeconds('End', false, 10)).toBe(Infinity);
    expect(keyPanSeconds('a', false, 10)).toBeNull();
  });

  it('stays inside the recording', () => {
    expect(panStart(5, -20, 10, 60)).toBe(0);
    expect(panStart(45, 20, 10, 60)).toBe(50);
    expect(panStart(5, 2.5, 10, 60)).toBe(7.5);
    expect(panStart(5, Infinity, 10, 60)).toBe(50);
    expect(panStart(5, -Infinity, 10, 60)).toBe(0);
    expect(panStart(5, 3, 10, 4)).toBe(0);
  });
});
