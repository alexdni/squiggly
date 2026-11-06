import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONNECTIVITY_BAND_NAMES, type Connectivity } from '@/lib/analysis-results';
import ConnectivityHead from '../ConnectivityHead';
import { connectivityScale } from '../data';

const channels = ['F3', 'F4'];
const byBand = (value: number) =>
  Object.fromEntries(
    CONNECTIVITY_BAND_NAMES.map((band) => [band, { matrix: [[0, value], [value, 0]], channels }])
  ) as Connectivity['connectivity_matrices'];
const wpliOnly = { connectivity_matrices: byBand(0.2), network_metrics: {}, pair_data: [] } as unknown as Connectivity;
const both: Connectivity = { ...wpliOnly, coherence: { n_epochs: 50, matrices: byBand(0.7) } };

describe('ConnectivityHead', () => {
  it('shows coherence values, its epoch count and chance level', () => {
    const html = renderToStaticMarkup(<ConnectivityHead connectivity={{ eo: both }} measure="coherence" />);
    expect(html).toContain('F3–F4: 0.700');
    expect(html).toContain('Coherence threshold');
    expect(html).toContain('50 epochs, chance level about 0.020');
    expect(html).not.toContain('wPLI');
  });

  it('still shows wPLI by default, with no epoch note', () => {
    const html = renderToStaticMarkup(<ConnectivityHead connectivity={{ eo: both }} />);
    expect(html).toContain('F3–F4: 0.200');
    expect(html).toContain('wPLI threshold');
    expect(html).not.toContain('chance level');
  });

  it('asks for a re-analysis when an older analysis has no coherence', () => {
    const html = renderToStaticMarkup(<ConnectivityHead connectivity={{ eo: wpliOnly }} measure="coherence" />);
    expect(html).toContain('need a re-analysis');
  });
});

describe('connectivityScale', () => {
  it('uses the chosen measure', () => {
    expect(connectivityScale([both], 0.1).vmax).toBeCloseTo(0.25);
    expect(connectivityScale([both], 0.1, 'coherence').vmax).toBeCloseTo(0.75);
  });
});
