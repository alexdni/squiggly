// Shared timestamp parsing for CSV EEG files.
//
// Recorders export the timestamp column in two shapes:
//   - numeric: epoch seconds/milliseconds/microseconds/nanoseconds, or a
//     relative counter (unit is auto-detected downstream from the deltas)
//   - ISO 8601 strings, e.g. "2026-06-24T22:13:59.340Z" (TheraQ / Divergence
//     exports)
//
// ISO strings are converted to epoch milliseconds so the existing
// delta-based unit detection treats them like any other millisecond column.
// parseFloat must NOT be used on this column: it silently truncates an ISO
// string to its leading year, collapsing every delta to zero.

/**
 * Parse one raw timestamp cell. Returns NaN when the cell is empty or
 * neither a number nor a recognisable date.
 */
export function parseCsvTimestamp(raw: string | undefined): number {
  if (raw === undefined) return NaN;
  const s = raw.trim();
  if (s === '') return NaN;

  // Number() rejects partial matches (unlike parseFloat), so an ISO string
  // falls through to the date branch instead of being read as its year.
  const n = Number(s);
  if (!Number.isNaN(n)) return n;

  return Date.parse(s); // NaN when unparseable
}
