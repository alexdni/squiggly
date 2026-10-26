// EO/EC labels of a recording: read from the filename at upload, edited by the analyst afterwards,
// and stored as segments (eo_start/eo_end, ec_start/ec_end) plus condition_type. Shared by the
// upload route, the label editor, the analysis view and the MCP server, so they agree on what a
// recording is.

export type ConditionType = 'EO' | 'EC' | 'BOTH';

export interface Segment {
  start: number;
  end: number;
}

export interface ConditionLabels {
  eo: Segment | null;
  ec: Segment | null;
}

/** Segment columns of a recordings row. */
export interface SegmentColumns {
  eo_start: number | string | null;
  eo_end: number | string | null;
  ec_start: number | string | null;
  ec_end: number | string | null;
}

// A token is EO/EC (or "eyes open/closed") with no letter either side: '…AGE 35 EO.edf',
// '…AGE47EC.edf', 'EC_.edf' and TheraQ's 'EO1' all match; 'EOG', 'ECG', 'spec', 'Dec' do not.
const TOKEN_RE = /(^|[^a-z])(eo|ec|eyes[\s_-]?open|eyes[\s_-]?closed)(?=$|[^a-z])/gi;

/** The condition a filename names, or null when it names neither or both. */
export function conditionFromFilename(filename: string): 'EO' | 'EC' | null {
  const base = filename.replace(/\.[^.\s]{1,5}$/, '');
  const found = new Set<'EO' | 'EC'>();
  for (const m of base.matchAll(TOKEN_RE)) {
    const t = m[2].toLowerCase();
    found.add(t === 'eo' || t.includes('open') ? 'EO' : 'EC');
  }
  return found.size === 1 ? [...found][0] : null;
}

const num = (v: number | string | null | undefined) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The labelled segments of a recordings row (numeric columns may arrive as strings). */
export function labelsOf(rec: SegmentColumns): ConditionLabels {
  const seg = (s: number | string | null, e: number | string | null) => {
    const a = num(s);
    const b = num(e);
    return a !== null && b !== null && b > a ? { start: a, end: b } : null;
  };
  return { eo: seg(rec.eo_start, rec.eo_end), ec: seg(rec.ec_start, rec.ec_end) };
}

/** 'EO' / 'EC' for single-condition recordings, 'EO+EC' with both segments, null when unlabelled. */
export function labelSummary(labels: ConditionLabels): 'EO' | 'EC' | 'EO+EC' | null {
  if (labels.eo && labels.ec) return 'EO+EC';
  if (labels.eo) return 'EO';
  if (labels.ec) return 'EC';
  return null;
}

export function conditionTypeOf(labels: ConditionLabels): ConditionType {
  if (labels.eo && !labels.ec) return 'EO';
  if (labels.ec && !labels.eo) return 'EC';
  return 'BOTH';
}

/** Whole-file labels for a single-condition recording. */
export function wholeFile(condition: 'EO' | 'EC', durationSec: number): ConditionLabels {
  const seg = { start: 0, end: durationSec };
  return condition === 'EO' ? { eo: seg, ec: null } : { eo: null, ec: seg };
}

/** The recordings columns that store `labels`. */
export function labelColumns(labels: ConditionLabels) {
  return {
    eo_start: labels.eo?.start ?? null,
    eo_end: labels.eo?.end ?? null,
    eo_label: labels.eo ? 'EO' : null,
    ec_start: labels.ec?.start ?? null,
    ec_end: labels.ec?.end ?? null,
    ec_label: labels.ec ? 'EC' : null,
    condition_type: conditionTypeOf(labels),
  };
}

/** Why `labels` cannot be stored for a recording `durationSec` long, or null when they can. */
export function labelsProblem(labels: ConditionLabels, durationSec: number | null): string | null {
  const max = durationSec !== null && durationSec > 0 ? durationSec + 1 : Infinity;
  for (const [name, s] of [['EO', labels.eo], ['EC', labels.ec]] as const) {
    if (!s) continue;
    if (!Number.isFinite(s.start) || !Number.isFinite(s.end)) return `${name} start and end must be numbers`;
    if (s.start < 0 || s.end <= s.start) return `${name} must end after it starts`;
    if (s.end > max) return `${name} ends after the recording (${Math.round(durationSec!)} s)`;
    if (s.end - s.start < 10) return `${name} must be at least 10 s long`;
  }
  if (labels.eo && labels.ec && labels.eo.start < labels.ec.end && labels.ec.start < labels.eo.end) {
    return 'EO and EC must not overlap';
  }
  return null;
}

/**
 * The segments an analysis runs on: the labels, or with none the whole recording as EO
 * (the baseline).
 */
export function analyzedSegments(labels: ConditionLabels, durationSec: number | null): ConditionLabels {
  if (labels.eo || labels.ec) return labels;
  return { eo: { start: 0, end: durationSec && durationSec > 0 ? durationSec : Number.MAX_SAFE_INTEGER }, ec: null };
}

/** True when two label sets cover the same spans (to the tenth of a second). */
export function sameLabels(a: ConditionLabels, b: ConditionLabels): boolean {
  const eq = (x: Segment | null, y: Segment | null) =>
    x === null || y === null ? x === y : Math.abs(x.start - y.start) < 0.1 && Math.abs(x.end - y.end) < 0.1;
  return eq(a.eo, b.eo) && eq(a.ec, b.ec);
}

/**
 * A recording's condition, from its stored labels (the single source of truth: filenames are only
 * read at upload, and by the backfill for rows uploaded before detection caught them).
 */
export function recordingCondition(rec: SegmentColumns & { condition_type?: string | null }): ConditionType {
  const labels = labelsOf(rec);
  if (labels.eo || labels.ec) return conditionTypeOf(labels);
  return rec.condition_type === 'EO' || rec.condition_type === 'EC' ? rec.condition_type : 'BOTH';
}

/**
 * Whether stored results still match the recording's labels: the segments they ran on (or, for
 * analyses that did not store them, the conditions they hold) against the segments a run would
 * use now.
 */
export function resultsMatchLabels(
  results: { segments?: Partial<Record<'eo' | 'ec', Segment>>; band_power?: Partial<Record<'eo' | 'ec', unknown>> | null },
  rec: SegmentColumns & { duration_seconds?: number | string | null }
): boolean {
  const duration = rec.duration_seconds !== null && rec.duration_seconds !== undefined ? Number(rec.duration_seconds) : null;
  const expected = analyzedSegments(labelsOf(rec), duration);
  if (results.segments) {
    return sameLabels({ eo: results.segments.eo ?? null, ec: results.segments.ec ?? null }, expected);
  }
  const has = (c: 'eo' | 'ec') => Boolean(results.band_power?.[c]);
  return has('eo') === Boolean(expected.eo) && has('ec') === Boolean(expected.ec);
}
