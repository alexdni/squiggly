import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
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
});
