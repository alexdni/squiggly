// Parity against the Python worker (api/workers/extract_features.py, numpy 1.26 / scipy 1.13 /
// mne 1.8). Fixtures: scripts/fixtures/gen_feature_fixtures.py.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BAND_NAMES,
  CONNECTIVITY_BAND_NAMES,
  type AlphaPeak,
  type BandPower,
  type Connectivity,
  type Lzc,
  type NetworkMetrics,
} from '@/lib/analysis-results';
import py from '../../__fixtures__/features/python_features.json';
import { computeAlphaPeak } from '../alphaPeak';
import { computeWpliByMethod } from '../connectivity';
import { extractFeatures, type ExtractedFeatures } from '../index';
import { ErrorLog, loadEpochs, relOrAbs, subsetEpochs } from './fixtures';

type Cond = 'eo' | 'ec';
const CONDS: Cond[] = ['eo', 'ec'];

// Required tolerances were: band power / ratios / asymmetry 2% rel, peak alpha 0.2 Hz, wPLI 0.05,
// network metrics 5%, normalized LZC 0.02. The deterministic parts agree to rounding error, so
// the tests pin much tighter bounds. wPLI (and the network metrics built on it) carries ~1e-4
// from the 1-4 Hz Butterworth bandpass: its 8th-order transfer function amplifies rounding
// differences in the filter state (see dsp/filter.ts lfilterZi). Observed maxima are printed by
// afterAll.
const TOL = {
  bandRel: 1e-9,
  alphaHz: 1e-9,
  wpli: 1e-3,
  network: 1e-3,
  lzcNorm: 1e-12,
  ratio: 1e-9,
};

const errors = new ErrorLog();
const eo = loadEpochs('eo');
const ec = loadEpochs('ec');
let ts: ExtractedFeatures;
const pyF = py.features as unknown as ExtractedFeatures;

beforeAll(() => {
  ts = extractFeatures(eo, ec);
});

afterAll(() => {
  const lines = errors.entries().map(([k, v]) => `  ${k.padEnd(34)} ${v.toExponential(2)}`);
  console.log(`max observed error vs Python:\n${lines.join('\n')}`);
});

function checkBandPower(actual: BandPower, expected: BandPower, tag: string) {
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  for (const ch of Object.keys(expected)) {
    for (const band of BAND_NAMES) {
      for (const kind of ['absolute', 'relative'] as const) {
        const err = relOrAbs(actual[ch][band][kind], expected[ch][band][kind]);
        errors.note(`band_power.${kind}${tag}`, err);
        expect(err, `${ch} ${band} ${kind}`).toBeLessThan(TOL.bandRel);
      }
    }
  }
}

function checkAlphaPeak(actual: AlphaPeak, expected: AlphaPeak, tag: string) {
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  for (const ch of Object.keys(expected)) {
    const df = Math.abs(actual[ch].peak_frequency - expected[ch].peak_frequency);
    errors.note(`alpha_peak.frequency_hz${tag}`, df);
    expect(df, ch).toBeLessThanOrEqual(TOL.alphaHz);
    const dp = relOrAbs(actual[ch].peak_power, expected[ch].peak_power);
    errors.note(`alpha_peak.power_rel${tag}`, dp);
    expect(dp, ch).toBeLessThan(TOL.bandRel);
  }
}

function checkLzc(actual: Lzc, expected: Lzc, tag: string) {
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  for (const ch of Object.keys(expected)) {
    const d = Math.abs(actual[ch].normalized_lzc - expected[ch].normalized_lzc);
    errors.note(`lzc.normalized_abs${tag}`, d);
    expect(d, ch).toBeLessThan(TOL.lzcNorm);
    errors.note(`lzc.raw_abs${tag}`, Math.abs(actual[ch].lzc - expected[ch].lzc));
  }
}

function checkNetwork(actual: NetworkMetrics, expected: NetworkMetrics, tag: string) {
  const scalar = [
    'global_efficiency',
    'mean_clustering_coefficient',
    'small_worldness',
    'interhemispheric_connectivity',
  ] as const;
  for (const k of scalar) {
    const err = relOrAbs(actual[k], expected[k]);
    errors.note(`network.${k}${tag}`, err);
    expect(err, k).toBeLessThan(TOL.network);
  }
  for (const k of ['clustering_by_channel', 'node_strength', 'regional_connectivity'] as const) {
    expect(Object.keys(actual[k])).toEqual(Object.keys(expected[k]));
    for (const key of Object.keys(expected[k])) {
      const err = relOrAbs(actual[k][key], expected[k][key]);
      errors.note(`network.${k}${tag}`, err);
      expect(err, `${k}.${key}`).toBeLessThan(TOL.network);
    }
  }
}

function checkConnectivity(actual: Connectivity, expected: Connectivity, tag: string) {
  for (const band of CONNECTIVITY_BAND_NAMES) {
    const a = actual.connectivity_matrices[band];
    const e = expected.connectivity_matrices[band];
    expect(a.channels).toEqual(e.channels);
    for (let i = 0; i < e.matrix.length; i++) {
      for (let j = 0; j < e.matrix.length; j++) {
        const d = Math.abs(a.matrix[i][j] - e.matrix[i][j]);
        errors.note(`wpli.matrix_abs${tag}`, d);
        expect(d, `${band} ${i},${j}`).toBeLessThan(TOL.wpli);
      }
    }
    checkNetwork(actual.network_metrics[band], expected.network_metrics[band], tag);
  }
  expect(actual.pair_data.length).toBe(expected.pair_data.length);
  actual.pair_data.forEach((p, i) => {
    const q = expected.pair_data[i];
    expect(Object.keys(p)).toEqual(Object.keys(q));
    expect([p.ch1, p.ch2, p.type, p.region]).toEqual([q.ch1, q.ch2, q.type, q.region]);
    for (const band of CONNECTIVITY_BAND_NAMES) expect(Math.abs(p[band]! - q[band]!)).toBeLessThan(TOL.wpli);
  });
}

describe.each(CONDS)('%s condition', (cond) => {
  it('band power (absolute µV², relative)', () => {
    checkBandPower(ts.band_power[cond]!, pyF.band_power[cond]!, '');
  });

  it('peak alpha frequency (legacy channel-mixing variant equals Python output)', () => {
    checkAlphaPeak(computeAlphaPeak(cond === 'eo' ? eo : ec, { legacyChannelMixing: true }), pyF.alpha_peak[cond]!, '');
  });

  it('peak alpha frequency (default, per-channel) equals Python run on per-channel concatenation', () => {
    checkAlphaPeak(ts.alpha_peak[cond]!, py.alpha_peak_fixed[cond] as AlphaPeak, '.fixed');
  });

  it('wPLI by method (CSD and Hilbert) per pair', () => {
    const byMethod = computeWpliByMethod(cond === 'eo' ? eo : ec);
    for (const band of CONNECTIVITY_BAND_NAMES) {
      for (const method of ['csd', 'hilbert'] as const) {
        const expected = py.wpli_methods[cond][band][method];
        const actual = byMethod[band][method];
        expected.forEach((v, p) => {
          const d = Math.abs(actual[p] - v);
          errors.note(`wpli.${method}.${band}_abs`, d);
          expect(d, `${band} pair ${p}`).toBeLessThan(TOL.wpli);
        });
      }
    }
  });

  it('connectivity matrices, network metrics and pair data', () => {
    checkConnectivity(ts.connectivity[cond]!, pyF.connectivity[cond]!, '');
  });

  it('LZC', () => {
    checkLzc(ts.lzc[cond]!, pyF.lzc[cond]!, '');
  });
});

describe('derived metrics', () => {
  function checkDerived(actual: Pick<ExtractedFeatures, 'band_ratios' | 'asymmetry' | 'risk_patterns'>, expected: typeof actual) {
    for (const [group, vals] of Object.entries(expected.band_ratios)) {
      for (const [k, v] of Object.entries(vals as Record<string, number>)) {
        const err = relOrAbs((actual.band_ratios as never)[group][k], v);
        errors.note('band_ratios_rel', err);
        expect(err, `${group}.${k}`).toBeLessThan(TOL.ratio);
      }
    }
    expect(Object.keys(actual.asymmetry)).toEqual(Object.keys(expected.asymmetry));
    for (const [k, v] of Object.entries(expected.asymmetry)) {
      // asymmetry is a log difference that can be ~0, so compare absolutely
      const err = Math.abs(actual.asymmetry[k] - v);
      errors.note('asymmetry_abs', err);
      expect(err, k).toBeLessThan(TOL.ratio);
    }
    expect(actual.risk_patterns).toEqual(expected.risk_patterns);
  }

  it('ratios, asymmetry and risk patterns (EC primary)', () => {
    checkDerived(ts, pyF);
  });

  it('falls back to EO when EC is missing', () => {
    const onlyEo = extractFeatures(eo, null);
    expect(onlyEo.band_power.ec).toBeNull();
    expect(onlyEo.connectivity.ec).toBeNull();
    checkDerived(onlyEo, py.eo_only as never);
  });
});

describe('channel subset (missing Fz, T8, O2), EC only, 8 epochs', () => {
  it('matches Python for every output', () => {
    const sub = py.subset;
    const set = subsetEpochs(ec, sub.channels, sub.n_epochs);
    const out = extractFeatures(null, set);
    const exp = sub.features as unknown as ExtractedFeatures;
    expect(out.band_power.eo).toBeNull();
    checkBandPower(out.band_power.ec!, exp.band_power.ec!, '.subset');
    checkConnectivity(out.connectivity.ec!, exp.connectivity.ec!, '.subset');
    checkLzc(out.lzc.ec!, exp.lzc.ec!, '.subset');
    checkAlphaPeak(computeAlphaPeak(set, { legacyChannelMixing: true }), exp.alpha_peak.ec!, '.subset');
    expect(out.band_ratios).toEqual(expect.any(Object));
    expect(out.risk_patterns).toEqual(exp.risk_patterns);
    expect(Object.keys(out.asymmetry)).toEqual(Object.keys(exp.asymmetry));
    for (const k of Object.keys(exp.asymmetry)) expect(Math.abs(out.asymmetry[k] - exp.asymmetry[k])).toBeLessThan(TOL.ratio);
  });
});

describe('input validation', () => {
  it('requires at least one condition', () => {
    expect(() => extractFeatures(null, null)).toThrow(/At least one/);
  });
  it('rejects ragged epochs', () => {
    const bad = { ...ec, epochs: [ec.epochs[0], [ec.epochs[1][0].subarray(0, 100), ...ec.epochs[1].slice(1)]] };
    expect(() => extractFeatures(null, bad)).toThrow(/equal length/);
  });
});
