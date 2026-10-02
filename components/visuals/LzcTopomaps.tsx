'use client';

import { useMemo } from 'react';
import type { Condition, Lzc } from '@/lib/analysis-results';
import { rdYlBuR, type Scale } from './topo';
import Topomap, { ColorLegend } from './Topomap';
import { CONDITIONS, CONDITION_LABELS, computeLzcScale, lzcValues } from './data';

export interface LzcTopomapsProps {
  lzc: Partial<Record<Condition, Lzc | null>> | null | undefined;
  /** Shared scale (comparison view); defaults to 2nd–98th percentile pooled over EO and EC. */
  scale?: Scale | null;
}

/** Normalized Lempel-Ziv complexity maps, EO and EC on one RdYlBu_r scale (red = high). */
export default function LzcTopomaps({ lzc, scale: scaleOverride }: LzcTopomapsProps) {
  const conditions = CONDITIONS.filter((c) => lzc?.[c] && Object.keys(lzc[c]!).length > 0);
  const values = useMemo(
    () => Object.fromEntries(CONDITIONS.map((c) => [c, lzcValues(lzc?.[c])])) as Record<Condition, Record<string, number>>,
    [lzc]
  );
  const ownScale = useMemo(() => computeLzcScale(CONDITIONS.map((c) => lzc?.[c])), [lzc]);
  const scale = scaleOverride ?? ownScale;

  if (conditions.length === 0) {
    return <p className="text-sm text-gray-600">No complexity data available.</p>;
  }
  return (
    <div>
      <div className={`grid grid-cols-1 gap-6 ${conditions.length > 1 ? 'md:grid-cols-2' : ''}`}>
        {conditions.map((c) => (
          <figure key={c} className="border border-gray-200 rounded-lg p-4">
            <figcaption className="text-lg font-semibold text-gray-900 mb-3 text-center">{CONDITION_LABELS[c]}</figcaption>
            <Topomap
              values={values[c]}
              scale={scale}
              colormap={rdYlBuR}
              contours={6}
              showLabels
              label={`Normalized Lempel-Ziv complexity, ${CONDITION_LABELS[c]}`}
              maxSize={300}
            />
          </figure>
        ))}
      </div>
      <ColorLegend className="mt-3 max-w-sm mx-auto" scale={scale} colormap={rdYlBuR} label="Normalized LZC" />
    </div>
  );
}
