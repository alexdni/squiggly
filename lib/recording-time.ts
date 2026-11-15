// When a recording was made, as far as the uploaded file says. Stored in recordings.recorded_at as
// ISO text whose form says how much is known:
//   2025-11-10T21:53:17    EDF/BDF header: clock time at the recording site, time zone not stated
//   2025-11-18T12:24:10Z   CSV timestamps: an absolute time
//   2022-04-02             date only (header time 00.00.00)
// Placeholder, implausible and relative times give null: nothing is better than a wrong date.

const MIN_YEAR = 2000;
/** A device clock may run ahead of the upload, and time zones differ; more than this is not real. */
const MAX_AHEAD_MS = 2 * 24 * 3600 * 1000;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** EDF/BDF header start date "dd.mm.yy" and time "hh.mm.ss" → local ISO text, or null. */
export function edfRecordedAt(startDate: string, startTime: string, uploadedAt: Date): string | null {
  const d = startDate.trim().match(/^(\d\d)\.(\d\d)\.(\d\d)$/);
  if (!d) return null;
  const [day, month, yy] = [Number(d[1]), Number(d[2]), Number(d[3])];
  // EDF clipping year: 85–99 → 1985–1999, 00–84 → 2000–2084
  const year = yy >= 85 ? 1900 + yy : 2000 + yy;
  if (year < MIN_YEAR || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const t = startTime.trim().match(/^(\d\d)\.(\d\d)\.(\d\d)$/);
  const [h, m, s] = t ? [Number(t[1]), Number(t[2]), Number(t[3])] : [0, 0, 0];
  if (h > 23 || m > 59 || s > 59) return null;
  const asUtc = Date.UTC(year, month - 1, day, h, m, s);
  // rejects 31.02 and the like, which Date.UTC rolls over
  if (new Date(asUtc).getUTCDate() !== day) return null;
  if (asUtc - uploadedAt.getTime() > MAX_AHEAD_MS) return null;
  // What writers put when they have no clock: 1 January at 00.00.00 or 01.01.01, in any year
  if (day === 1 && month === 1 && (h + m + s === 0 || (h === 1 && m === 1 && s === 1))) return null;
  const date = `${year}-${pad(month)}-${pad(day)}`;
  return !t || h + m + s === 0 ? date : `${date}T${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** First CSV timestamp → absolute ISO text, or null when it counts from zero or is not a time. */
export function csvRecordedAt(firstTimestamp: string | undefined, uploadedAt: Date): string | null {
  const raw = firstTimestamp?.trim().replace(/^"|"$/g, '') ?? '';
  if (raw === '') return null;
  const n = Number(raw);
  let ms: number;
  if (!Number.isNaN(n)) {
    // epoch in ns / µs / ms / s by magnitude; anything smaller is time since the recording began
    if (n > 1e17) ms = n / 1e6;
    else if (n > 1e14) ms = n / 1e3;
    else if (n > 1e11) ms = n;
    else if (n > 1e8) ms = n * 1e3;
    else return null;
  } else {
    ms = Date.parse(raw);
    if (Number.isNaN(ms)) return null;
  }
  if (new Date(ms).getUTCFullYear() < MIN_YEAR || ms - uploadedAt.getTime() > MAX_AHEAD_MS) return null;
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/** Recording time from the first bytes of an uploaded file (the header is enough). */
export function recordedAtFromFile(head: Uint8Array, extension: string | undefined, uploadedAt: Date): string | null {
  try {
    const text = new TextDecoder('latin1').decode(head.subarray(0, 65536));
    if (extension?.toLowerCase() === 'csv') {
      const [header, first] = text.split(/\r?\n/);
      if (!header || !first) return null;
      const columns = header.split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
      const i = columns.indexOf('timestamp') >= 0 ? columns.indexOf('timestamp') : columns.findIndex((h) => h.includes('time'));
      return i < 0 ? null : csvRecordedAt(first.split(',')[i], uploadedAt);
    }
    if (text.length < 184) return null;
    return edfRecordedAt(text.slice(168, 176), text.slice(176, 184), uploadedAt);
  } catch {
    return null;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Display text for a stored recorded_at. File-local times are shown as written, absolute ones in
 * the viewer's time zone. Null for a missing or unreadable value.
 */
export function formatRecordedAt(recordedAt: string | null | undefined, opts: { dateOnly?: boolean } = {}): string | null {
  const m = recordedAt?.match(/^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d):(\d\d)(Z)?)?$/);
  if (!m) return null;
  let [year, month, day, hour, minute] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5]];
  if (m[7]) {
    const local = new Date(recordedAt!);
    [year, month, day, hour, minute] = [local.getFullYear(), local.getMonth() + 1, local.getDate(), pad(local.getHours()), pad(local.getMinutes())];
  }
  const date = `${day} ${MONTHS[month - 1]} ${year}`;
  return hour === undefined || opts.dateOnly ? date : `${date}, ${hour}:${minute}`;
}
