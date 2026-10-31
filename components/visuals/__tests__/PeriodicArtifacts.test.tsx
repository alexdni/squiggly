import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PeriodicArtifactsCard, { alphaPeaksOnLines } from '../PeriodicArtifacts';
import type { PeriodicArtifact } from '@/lib/analysis-results';

const artifact: PeriodicArtifact = {
  fundamental: 8.311,
  harmonics: [1, 2, 4, 5, 6],
  frequencies: [8.36, 16.65, 33.39, 41.26, 49.85],
  channels: [
    { label: 'F3', harmonics: [1, 2, 4, 5, 6], prominence_db: [8, 7, 7, 7, 13], coverage: 0.45 },
    { label: 'P4', harmonics: [2, 4, 5, 6], prominence_db: [8, 8, 7, 13], coverage: 0.45 },
  ],
};
const alphaPeak = {
  eo: { F3: { peak_frequency: 8.4, peak_power: 1 }, P4: { peak_frequency: 10.2, peak_power: 1 } },
};

describe('PeriodicArtifactsCard', () => {
  it('lists the lines in range, the channels and an alpha peak sitting on a line', () => {
    const html = renderToStaticMarkup(
      <PeriodicArtifactsCard periodic={{ removed: false, artifacts: [artifact] }} alphaPeak={alphaPeak} onSetRemoval={() => {}} />
    );
    expect(html).toContain('8.31 Hz fundamental');
    expect(html).toContain('33.4 Hz (×4)');
    expect(html).toContain('and 1 above 45 Hz');
    expect(html).toContain('F3 · 45% of the recording');
    expect(html).toContain('The alpha peak on F3 (Eyes Open)');
    expect(html).toContain('Remove and re-analyze');
  });

  it('offers to put them back once removed, and hides the action from viewers', () => {
    const removed = { removed: true, artifacts: [artifact] };
    expect(renderToStaticMarkup(<PeriodicArtifactsCard periodic={removed} onSetRemoval={() => {}} />)).toContain(
      'Keep them and re-analyze'
    );
    expect(renderToStaticMarkup(<PeriodicArtifactsCard periodic={removed} />)).not.toContain('re-analyze');
  });

  it('renders nothing when none were found', () => {
    expect(renderToStaticMarkup(<PeriodicArtifactsCard periodic={{ removed: false, artifacts: [] }} />)).toBe('');
  });
});

describe('alphaPeaksOnLines', () => {
  it('flags only channels whose peak is within 0.3 Hz of a line', () => {
    expect(alphaPeaksOnLines(artifact, alphaPeak)).toEqual([{ condition: 'eo', channels: ['F3'] }]);
  });
});
