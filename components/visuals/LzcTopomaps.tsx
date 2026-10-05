'use client';

import { useMemo } from 'react';
import type { Condition, Lzc } from '@/lib/analysis-results';
import type { Scale } from './topo';
import Topomap from './Topomap';
import { qeegSequential } from './topoRender';
import { CONDITIONS, CONDITION_LABELS, computeLzcScale, lzcValues } from './data';

export interface LzcTopomapsProps {
  lzc: Partial<Record<Condition, Lzc | null>> | null | undefined;
  /** Shared scale (comparison view); defaults to the min/max pooled over EO and EC. */
  scale?: Scale | null;
}

const fmt = (v: number) => v.toFixed(2);

/** Normalized Lempel-Ziv complexity maps (DivergenceWebapp's sequential QEEG ramp), EO and EC on one scale. */
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
    <div className="flex flex-wrap justify-center gap-6">
      {conditions.map((c) => (
        <div key={c} style={{ width: 180 }}>
          <Topomap
            values={values[c]}
            scale={scale}
            colormap={qeegSequential}
            label={CONDITION_LABELS[c]}
            sublabel="LZC, normalized"
            legend={{ format: fmt }}
            ariaLabel={`Normalized Lempel-Ziv complexity, ${CONDITION_LABELS[c]}`}
          />
        </div>
      ))}
    </div>
  );
}
