'use client';

import { useState } from 'react';
import type { Condition, Connectivity } from '@/lib/analysis-results';
import ConnectivityHead from './ConnectivityHead';
import type { CoherenceMeasure } from './data';
import SegmentedToggle from './SegmentedToggle';

const NOTES: Record<CoherenceMeasure, string> = {
  coherence:
    'Average reference: each channel minus the mean of all channels. Strong activity anywhere spreads to every pair, so distant pairs can read high.',
  coherence_linked_ears:
    "Linked ears: the recording's own reference. Every channel shares the ear signal, so activity at the ears raises coherence across pairs.",
  coherence_laplacian:
    'Laplacian: each channel minus the mean of its nearest 10-20 neighbours (Hjorth). Reference-free and mostly local, so volume conduction is reduced and values read lower. Interpolated channels are left out.',
};

/** Picks the reference. The note stays visible in exports, which leave the toggle out. */
export function CoherenceReference({
  value,
  onChange,
}: {
  value: CoherenceMeasure;
  onChange: (v: CoherenceMeasure) => void;
}) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-3 mb-2" data-export-ignore>
        <span className="text-sm font-medium text-gray-900">Reference</span>
        <SegmentedToggle
          label="Coherence reference"
          value={value}
          options={[
            ['coherence', 'Average'],
            ['coherence_linked_ears', 'Linked ears'],
            ['coherence_laplacian', 'Laplacian'],
          ]}
          onChange={onChange}
        />
      </div>
      <p className="text-sm text-gray-600">{NOTES[value]}</p>
    </div>
  );
}

/** Coherence head graphs for one analysis, with a reference choice. */
export default function CoherenceSection({
  connectivity,
}: {
  connectivity: Partial<Record<Condition, Connectivity | null>> | null | undefined;
}) {
  const [measure, setMeasure] = useState<CoherenceMeasure>('coherence');
  return (
    <div>
      <CoherenceReference value={measure} onChange={setMeasure} />
      {/* Remounted so the threshold returns to this reference's default */}
      <ConnectivityHead key={measure} connectivity={connectivity} measure={measure} />
    </div>
  );
}
