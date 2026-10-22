import 'server-only';
// Small numeric helpers shared by the MCP output builders.

/** 3 significant figures. */
export function sig3(n: number): number {
  return n === 0 || !Number.isFinite(n) ? n : Number(n.toPrecision(3));
}

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
