// Mu rhythm indicators from stored spectral features. Mu is the 8–13 Hz sensorimotor rhythm over
// C3/C4: it stays when the eyes open (posterior alpha drops), often peaks at a slightly different
// frequency from posterior alpha, and its arch-shaped waveform gives a harmonic near twice its
// frequency. Everything here reads `band_power` and `psd`, so it works on stored analyses without
// re-analysis. A 1/f-corrected central peak is required: on the validation set, band power alone
// flagged electrode pops at C3 as mu.

import type { BandPower, PsdData } from '@/lib/analysis-results';

export type MuVerdict = 'likely' | 'possible' | 'not_detected' | 'insufficient_data';

export interface MuSite {
  /** frequency of the largest 1/f-corrected peak in 7–13.5 Hz */
  peak_hz: number;
  /** that peak's height above the fitted 1/f background, dB */
  peak_db: number;
  /** largest height above background within 2f ± 1.5 Hz, dB */
  harmonic_db: number;
}

export interface MuIndicators {
  verdict: MuVerdict;
  /** which checks passed, or why none could run */
  reasons: string[];
  /** condition the site peaks come from (eyes open when available) */
  condition: 'eo' | 'ec' | null;
  sites: Partial<Record<'C3' | 'C4', MuSite>>;
  /** posterior dominant rhythm, mean of O1/O2 peaks (EC when available) */
  occipital_peak_hz: number | null;
  /** EO mean C3/C4 alpha (8–12 Hz) power ÷ mean O1/O2 alpha power */
  central_occipital_alpha_eo: number | null;
  /** (central EO/EC alpha) ÷ (occipital EO/EC alpha); above 1 means central alpha blocks less on eye opening */
  reactivity_selectivity: number | null;
}

export interface MuConditionInput {
  band_power?: BandPower | null;
  psd?: PsdData | null;
}

export const MU = {
  PEAK_MIN_DB: 3,
  HARMONIC_MIN_DB: 3,
  CENTRAL_DOMINANCE_MIN: 0.6,
  SELECTIVITY_MIN: 1.5,
  FREQ_OFFSET_MIN_HZ: 0.5,
} as const;

const CENTRAL = ['C3', 'C4'] as const;
const OCCIPITAL = ['O1', 'O2'] as const;
const PEAK_BAND: [number, number] = [7, 13.5];
// 1/f fit range, leaving out the alpha band and its harmonic so neither inflates the background
const FIT_BAND: [number, number] = [3, 40];
const FIT_EXCLUDE: [number, number][] = [[7, 14], [17, 28]];

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** log10 residual of a channel's PSD above a log-log line fitted outside alpha and its harmonic. */
function residual(psd: PsdData, ch: string): { freqs: number[]; res: number[] } | null {
  const p = psd.channels?.[ch];
  const f = psd.freqs;
  if (!Array.isArray(p) || !Array.isArray(f) || p.length !== f.length) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  f.forEach((hz, k) => {
    if (hz < FIT_BAND[0] || hz > FIT_BAND[1] || FIT_EXCLUDE.some(([lo, hi]) => hz >= lo && hz <= hi)) return;
    if (!finite(p[k]) || p[k] <= 0) return;
    xs.push(Math.log10(hz));
    ys.push(Math.log10(p[k]));
  });
  if (xs.length < 4) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const res = f.map((hz, k) => (hz > 0 && finite(p[k]) && p[k] > 0 ? Math.log10(p[k]) - (my + slope * (Math.log10(hz) - mx)) : NaN));
  return { freqs: f, res };
}

function maxIn(r: { freqs: number[]; res: number[] }, lo: number, hi: number): { hz: number; db: number } | null {
  let best: { hz: number; db: number } | null = null;
  r.freqs.forEach((hz, k) => {
    if (hz < lo || hz > hi || !finite(r.res[k])) return;
    const db = 10 * r.res[k];
    if (!best || db > best.db) best = { hz, db };
  });
  return best;
}

function site(psd: PsdData, ch: string): MuSite | null {
  const r = residual(psd, ch);
  if (!r) return null;
  const pk = maxIn(r, ...PEAK_BAND);
  if (!pk) return null;
  const h = maxIn(r, 2 * pk.hz - 1.5, 2 * pk.hz + 1.5);
  return { peak_hz: pk.hz, peak_db: round(pk.db, 1), harmonic_db: round(h?.db ?? 0, 1) };
}

function alphaMean(bp: BandPower | null | undefined, chs: readonly string[]): number | null {
  if (!bp) return null;
  const v = chs.map((ch) => (bp[ch]?.alpha1?.absolute ?? NaN) + (bp[ch]?.alpha2?.absolute ?? NaN));
  return v.every(finite) ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Mu rhythm indicators for one session (either condition may be missing). */
export function computeMuIndicators(input: { eo?: MuConditionInput | null; ec?: MuConditionInput | null }): MuIndicators {
  const eo = input.eo ?? null;
  const ec = input.ec ?? null;
  const out: MuIndicators = {
    verdict: 'insufficient_data',
    reasons: [],
    condition: null,
    sites: {},
    occipital_peak_hz: null,
    central_occipital_alpha_eo: null,
    reactivity_selectivity: null,
  };

  const peakCond = eo?.psd ? 'eo' : ec?.psd ? 'ec' : null;
  if (!peakCond) {
    out.reasons.push('no stored spectrum: Re-Analyze to get mu indicators');
    return out;
  }
  const psd = (peakCond === 'eo' ? eo : ec)!.psd!;
  out.condition = peakCond;
  for (const ch of CENTRAL) {
    const s = site(psd, ch);
    if (s) out.sites[ch] = s;
  }
  if (!out.sites.C3 && !out.sites.C4) {
    out.reasons.push('C3/C4 not in the recording');
    return out;
  }
  const occPsd = ec?.psd ?? eo?.psd!;
  const occ = OCCIPITAL.map((ch) => site(occPsd, ch)).filter((s): s is MuSite => !!s);
  if (occ.length) out.occipital_peak_hz = round(occ.reduce((a, s) => a + s.peak_hz, 0) / occ.length, 2);

  const cEo = alphaMean(eo?.band_power, CENTRAL);
  const oEo = alphaMean(eo?.band_power, OCCIPITAL);
  if (cEo !== null && oEo !== null && oEo > 0) out.central_occipital_alpha_eo = round(cEo / oEo, 2);
  const cEc = alphaMean(ec?.band_power, CENTRAL);
  const oEc = alphaMean(ec?.band_power, OCCIPITAL);
  if (cEo !== null && oEo !== null && cEc && oEc && oEo > 0) {
    out.reactivity_selectivity = round(cEo / cEc / (oEo / oEc), 2);
  }

  const peaked = Object.entries(out.sites).filter(([, s]) => s.peak_db >= MU.PEAK_MIN_DB);
  if (!peaked.length) {
    out.verdict = 'not_detected';
    out.reasons.push(`no central alpha peak ≥ ${MU.PEAK_MIN_DB} dB above background`);
    return out;
  }
  out.reasons.push(`central alpha peak at ${peaked.map(([ch, s]) => `${ch} ${s.peak_hz} Hz (${s.peak_db} dB)`).join(', ')}`);

  const dominance = out.central_occipital_alpha_eo !== null && out.central_occipital_alpha_eo >= MU.CENTRAL_DOMINANCE_MIN;
  const spared = out.reactivity_selectivity !== null && out.reactivity_selectivity >= MU.SELECTIVITY_MIN;
  const harmonic = peaked.some(([, s]) => s.harmonic_db >= MU.HARMONIC_MIN_DB);
  const offset =
    out.occipital_peak_hz !== null && peaked.some(([, s]) => Math.abs(s.peak_hz - out.occipital_peak_hz!) >= MU.FREQ_OFFSET_MIN_HZ);
  if (dominance) out.reasons.push(`eyes-open central alpha is ${out.central_occipital_alpha_eo}× occipital`);
  if (spared) out.reasons.push(`central alpha blocks less than occipital on eye opening (selectivity ${out.reactivity_selectivity})`);
  if (harmonic) out.reasons.push('harmonic near twice the peak frequency (arch-shaped waveform)');
  if (offset) out.reasons.push(`central peak differs from the posterior rhythm (${out.occipital_peak_hz} Hz)`);
  if (out.reactivity_selectivity === null) out.reasons.push('reactivity not assessed: needs both eyes-open and eyes-closed data');

  // Harmonic and frequency offset are supporting evidence only: on the validation set both also
  // fired on diffuse alpha and on sharp non-rhythmic transients.
  out.verdict = dominance && spared ? 'likely' : dominance || spared ? 'possible' : 'not_detected';
  return out;
}
