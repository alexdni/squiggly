/**
 * TheraQ metric engine. Port of api/workers/theraq_metrics.py (itself a port of
 * Divergence getAssessmentMetrics.mjs). The metric/norm/index definitions are
 * loaded verbatim from definitions.json so the math stays auditable against the
 * original; this module only evaluates them.
 *
 * Educational/research use only — non-diagnostic.
 */

import type {
  TheraqColour,
  TheraqIndexResult,
  TheraqMetricResult,
} from '@/lib/theraq';
import definitionsJson from './definitions.json';
import { pairwiseMean, pairwiseSum, pyRound } from './numeric';
import { SPECTRUM_DOMAIN } from './spectrum';

export interface TheraqNormDef {
  range: [number, number];
  colour?: TheraqColour;
  direction?: string;
}

export interface TheraqMetricDef {
  name?: string;
  operation: string;
  display?: TheraqMetricResult['display'];
  tags?: string[];
  norms?: TheraqNormDef[];
  args?: TheraqMetricDef[];
  condition?: string;
  electrode?: string;
  band?: [number, number];
}

export interface TheraqDefinitions {
  standardMetrics: TheraqMetricDef[];
  dysregulationIndices: TheraqMetricDef[];
  dysregulatedIndexMetrics: TheraqMetricDef[];
}

export const THERAQ_DEFINITIONS = definitionsJson as unknown as TheraqDefinitions;

/** Index name -> stable result key. */
export const INDEX_KEYS: Record<string, string> = {
  'Emotional Dysregulation Index': 'emotional_dysregulation',
  'Cognitive Performance Index': 'cognitive_performance',
  'Potential Stress/Trauma Markers Index': 'stress_trauma',
  'Sleep Dysregulation Index': 'sleep_dysregulation',
};

/** {condition: [channel-indexed spectrum]} for eo1/ec/eo2/eoload. */
export type ConditionSpectra = Record<string, number[][]>;

export interface AbnormalMetric {
  name: string | null;
  value: number;
  display: TheraqMetricDef['display'] | null;
  norms: TheraqNormDef[] | null;
}

/** Replicate the Divergence band->slice mapping (stop is exclusive). */
export function bandToIndices(domain: number[], bandStart: number, bandStop: number): [number, number] {
  let start = domain.findIndex((f) => f >= bandStart);
  if (start < 0) start = 0;
  let stop = domain.findIndex((f) => f > bandStop);
  if (stop < 0) stop = domain.length;
  return [start, stop];
}

/** Extend the outermost norm range so an out-of-range value still classifies. */
export function adaptNorms(norms: TheraqNormDef[] | undefined, value: number): TheraqNormDef[] | undefined {
  if (!norms || norms.length === 0) return norms;
  const copy: TheraqNormDef[] = norms.map((n) => ({ ...n, range: [n.range[0], n.range[1]] }));
  // Python min()/max() keep the first of equal keys.
  let lowest = copy[0];
  let highest = copy[0];
  for (const n of copy) {
    if (n.range[0] < lowest.range[0]) lowest = n;
    if (n.range[1] > highest.range[1]) highest = n;
  }
  if (value < lowest.range[0]) lowest.range[0] = value;
  if (value > highest.range[1]) highest.range[1] = value;
  return copy;
}

/**
 * First norm whose closed range contains the value. Directional "dial" norms
 * (range + direction, no colour) are not colour-classified and give null.
 */
export function colourFor(norms: TheraqNormDef[], value: number): TheraqColour | null {
  for (const n of norms) {
    const [lo, hi] = n.range;
    if (lo <= value && value <= hi) return n.colour ?? null;
  }
  return null;
}

/** Recursive evaluator over the loaded metric definitions. */
export class TheraqEngine {
  constructor(
    private readonly channelNames: string[],
    private readonly spectra: ConditionSpectra,
    private readonly domain: number[] = SPECTRUM_DOMAIN,
  ) {}

  private channelIndex(electrode: string): number {
    const i = this.channelNames.indexOf(electrode);
    if (i < 0) throw new Error(`Required channel '${electrode}' not found in recording`);
    return i;
  }

  private conditionSpectrum(condition: string, electrode: string): number[] {
    if (!(condition in this.spectra)) throw new Error(`Missing spectra for condition '${condition}'`);
    return this.spectra[condition][this.channelIndex(electrode)];
  }

  private bandWindow(metric: TheraqMetricDef): { spec: number[]; window: number[] } {
    const spec = this.conditionSpectrum(metric.condition!, metric.electrode!);
    const [start, stop] = bandToIndices(this.domain, metric.band![0], metric.band![1]);
    return { spec, window: spec.slice(start, stop) };
  }

  private classify(sub: TheraqMetricDef, value: number): TheraqColour | null {
    const norms = adaptNorms(sub.norms, value);
    return norms && norms.length > 0 ? colourFor(norms, value) : null;
  }

  /** Numeric operations (everything except 'select abnormal metrics'). */
  compute(metric: TheraqMetricDef): number {
    const args = metric.args ?? [];
    switch (metric.operation) {
      case 'quotient': {
        const denom = this.compute(args[1]);
        return denom !== 0 ? this.compute(args[0]) / denom : NaN;
      }
      case 'difference':
        return this.compute(args[0]) - this.compute(args[1]);
      case 'sum amplitude':
        return pairwiseSum(this.bandWindow(metric).window);
      case 'mean amplitude':
        return pairwiseMean(this.bandWindow(metric).window);
      case 'peak frequency': {
        const { spec, window } = this.bandWindow(metric);
        if (window.length === 0) return NaN;
        let peak = window[0];
        for (const v of window) if (v > peak) peak = v;
        // Faithful to the Python source: the peak value is looked up in the
        // whole spectrum, so an equal value below the band wins.
        return this.domain[spec.indexOf(peak)];
      }
      case 'decimal to percent':
        return this.compute(args[0]) * 100;
      case 'count abnormalities': {
        let score = 0;
        for (const sub of args) {
          const colour = this.classify(sub, this.compute(sub));
          if (colour === 'red') score += 1.0;
          else if (colour === 'yellow') score += 0.5;
        }
        return pyRound((score / args.length) * 10, 1);
      }
      default:
        throw new Error(`Undefined TheraQ operation: ${metric.operation}`);
    }
  }

  /** 'select abnormal metrics': the red/yellow sub-metrics of a group. */
  selectAbnormal(metric: TheraqMetricDef): AbnormalMetric[] {
    if (metric.operation !== 'select abnormal metrics') {
      throw new Error(`Not a 'select abnormal metrics' definition: ${metric.operation}`);
    }
    const out: AbnormalMetric[] = [];
    for (const sub of metric.args ?? []) {
      const value = this.compute(sub);
      const colour = this.classify(sub, value);
      if (colour === 'red' || colour === 'yellow') {
        out.push({
          name: sub.name ?? null,
          value: pyRound(value, 2),
          display: sub.display ?? null,
          norms: sub.norms ?? null,
        });
      }
    }
    return out;
  }
}

const finiteOrNull = (v: number): number | null => (Number.isFinite(v) ? v : null);

export interface TheraqMetricsOutput {
  metrics: TheraqMetricResult[];
  indices: Record<string, TheraqIndexResult>;
}

/**
 * Evaluate all standard metrics and dysregulation indices. Non-finite values
 * (e.g. a quotient with a zero denominator) are returned as null, which is what
 * the Python NaN became once stored as JSON.
 */
export function computeTheraqMetrics(
  channelNames: string[],
  spectra: ConditionSpectra,
  domain: number[] = SPECTRUM_DOMAIN,
  defs: TheraqDefinitions = THERAQ_DEFINITIONS,
): TheraqMetricsOutput {
  const engine = new TheraqEngine(channelNames, spectra, domain);

  const metrics: TheraqMetricResult[] = defs.standardMetrics.map((metric) => {
    const value = pyRound(engine.compute(metric), 2);
    const norms = adaptNorms(metric.norms, value);
    const colour = norms && norms.length > 0 ? colourFor(norms, value) : null;
    return {
      name: metric.name ?? '',
      value: finiteOrNull(value),
      display: metric.display ?? 'decimal',
      colour,
      norms: (norms ?? []) as TheraqMetricResult['norms'],
      tags: metric.tags ?? [],
    };
  });

  const indices: Record<string, TheraqIndexResult> = {};
  for (const index of defs.dysregulationIndices) {
    const name = index.name ?? '';
    const score = engine.compute(index);
    // band: green <3.33, yellow 3.33-6.66, red >6.66
    let colour: TheraqColour | null;
    if (Number.isNaN(score)) colour = null;
    else if (score > 6.66) colour = 'red';
    else if (score >= 3.33) colour = 'yellow';
    else colour = 'green';
    indices[INDEX_KEYS[name] ?? name] = {
      name,
      score: finiteOrNull(score),
      colour,
      metrics: (index.args ?? []).map((m) => m.name ?? ''),
    };
  }

  return { metrics, indices };
}
