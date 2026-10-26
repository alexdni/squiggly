import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SpectrogramGrid from '../Spectrogram';
import type { SpectrogramData } from '@/lib/analysis-results';

const spec: SpectrogramData = { times: [1, 2], freqs: [1, 2], power_db: [[0, 1], [1, 0]] };
const headings = (html: string) => [...html.matchAll(/mb-1">([^<]+)<\/div>/g)].map((m) => m[1]);
const optionsOf = (html: string) => [...html.matchAll(/<option value="([^"]*)">/g)].map((m) => m[1]).filter(Boolean);

describe('SpectrogramGrid', () => {
  it('starts with the first channel and offers the rest one at a time (older five-channel analyses)', () => {
    const five = Object.fromEntries(['O1', 'Fz', 'Fp1', 'Pz', 'Cz'].map((c) => [c, spec]));
    const html = renderToStaticMarkup(<SpectrogramGrid spectrograms={{ eo: five, ec: null }} />);
    expect(headings(html)).toEqual(['Fp1']);
    expect(optionsOf(html)).toEqual(['Fz', 'Cz', 'Pz', 'O1']);
  });

  it('offers every channel of the spectrograms file when there is one', () => {
    const channels = ['Fp1', 'Fp2', 'F7', 'F3', 'C3', 'T7'];
    const html = renderToStaticMarkup(
      <SpectrogramGrid spectrograms={{ eo: { Fp1: spec }, ec: { Fp1: spec } }} channels={channels} analysisId="a1" />
    );
    expect(headings(html)).toEqual(['Fp1', 'Fp1']); // Eyes Open and Eyes Closed
    expect(optionsOf(html)).toEqual(channels.slice(1));
  });
});
