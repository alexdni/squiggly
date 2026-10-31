'use client';

import { useState } from 'react';
import type { AlphaPeak, Condition, PeriodicArtifacts, PsdData } from '@/lib/analysis-results';
import PsdChannels from './PsdChannels';
import PsdHeadMap from './PsdHeadMap';
import SegmentedToggle from './SegmentedToggle';

type PsdView = 'headMap' | 'channels';

/** The power spectra as a head map of mini spectra, or one full-width chart with a channel selector. */
export default function PsdSection({
  psd,
  alphaPeak,
  periodic,
  fileStem,
}: {
  psd: Partial<Record<Condition, PsdData | null>> | null | undefined;
  alphaPeak?: Partial<Record<Condition, AlphaPeak | null>> | null;
  periodic?: PeriodicArtifacts;
  fileStem?: string;
}) {
  const [view, setView] = useState<PsdView>('headMap');

  return (
    <div>
      <div className="flex justify-center mb-4" data-export-ignore>
        <SegmentedToggle
          label="Power spectral density view"
          value={view}
          options={[
            ['headMap', 'Head map'],
            ['channels', 'Channels'],
          ]}
          onChange={setView}
        />
      </div>
      {/* Both stay mounted, so switching back keeps the chosen channels, range and scale */}
      <div hidden={view !== 'headMap'}>
        <PsdHeadMap psd={psd} alphaPeak={alphaPeak} />
      </div>
      <div hidden={view !== 'channels'}>
        <PsdChannels psd={psd} alphaPeak={alphaPeak} periodic={periodic} fileStem={fileStem} />
      </div>
    </div>
  );
}
