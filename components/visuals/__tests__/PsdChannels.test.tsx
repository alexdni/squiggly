import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AlphaPeakTopomaps from '../AlphaPeakTopomaps';
import PsdChannels from '../PsdChannels';
import PsdSection from '../PsdSection';

const psd = {
  eo: { freqs: [1, 2, 10], channels: { Fz: [4, 2, 1], O1: [3, 2, 5] } },
  ec: { freqs: [1, 2, 10], channels: { Fz: [4, 2, 1], O1: [3, 2, 9] } },
};
const pressed = (html: string) =>
  [...html.matchAll(/aria-pressed="(true|false)"[^>]*>.*?<\/span>([^<]+)<\/button>/g)].map((m) => [m[2], m[1]]);

describe('PsdChannels', () => {
  it('starts on Eyes Open with only the global average shown, as the Divergence webapp', () => {
    const html = renderToStaticMarkup(<PsdChannels psd={psd} />);
    expect(pressed(html)).toEqual([
      ['Global', 'true'],
      ['Fz', 'false'],
      ['O1', 'false'],
    ]);
    expect(html).toContain('Power spectral density, Eyes Open, 1 to 45 Hz');
  });

  it('shows the only channel when there is one, without a global average', () => {
    const html = renderToStaticMarkup(<PsdChannels psd={{ eo: { freqs: [1, 2], channels: { Cz: [1, 2] } } }} />);
    expect(pressed(html)).toEqual([['Cz', 'true']]);
  });
});

describe('PsdSection', () => {
  it('opens on the head map, with the channels chart mounted but hidden', () => {
    const html = renderToStaticMarkup(<PsdSection psd={psd} />);
    const headMap = html.indexOf('at its scalp position, Eyes Open');
    const channels = html.indexOf('aria-label="Channels shown"');
    const hidden = html.indexOf('hidden=""');
    expect(headMap).toBeGreaterThan(-1);
    // the only hidden wrapper is the one around the channels chart
    expect(hidden).toBeGreaterThan(headMap);
    expect(hidden).toBeLessThan(channels);
    expect(html.indexOf('hidden=""', hidden + 1)).toBe(-1);
  });

  it('puts the conditions side by side, or stacked when compact for a comparison column', () => {
    expect(renderToStaticMarkup(<PsdSection psd={psd} />)).toContain('lg:grid-cols-2');
    const compact = renderToStaticMarkup(<PsdSection psd={psd} compact />);
    expect(compact).not.toContain('lg:grid-cols-2');
    expect(compact).toContain('at its scalp position, Eyes Closed');
  });
});

describe('AlphaPeakTopomaps', () => {
  it('lists channels from the front of the head to the back', () => {
    const peak = { peak_frequency: 10, peak_power: 5 };
    const html = renderToStaticMarkup(
      <AlphaPeakTopomaps alphaPeak={{ eo: { C3: peak, F3: peak, O1: peak, P3: peak, Fp1: peak } }} />
    );
    const rows = [...html.matchAll(/<td class="[^"]*font-medium[^"]*">([^<]+)<\/td>/g)].map((m) => m[1]);
    expect(rows).toEqual(['Fp1', 'F3', 'C3', 'P3', 'O1']);
  });
});
