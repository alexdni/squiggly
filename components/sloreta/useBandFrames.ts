'use client';

import { useEffect, useRef, useState } from 'react';
import { addChunk, type BandFrames, emptyBandFrames } from './timelapse';

/** Matches the API's per-request cap (~3 MB per chunk). */
const CHUNK = 200;

/**
 * Time-lapse frames of one band, fetched chunk by chunk so playback can start on the first
 * chunk. Loaded bands are kept, so switching back is instant. `loaded` changes as chunks arrive.
 */
export function useBandFrames(params: {
  analysisId: string;
  band: string | null;
  nFrames: number;
  nVox: number;
}): { frames: BandFrames | null; loaded: number; error: string | null } {
  const { analysisId, band, nFrames, nVox } = params;
  const cache = useRef(new Map<string, BandFrames>());
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!band || !nFrames || !nVox) return undefined;
    let alive = true;
    setError(null);
    let frames = cache.current.get(band);
    if (!frames || frames.nVox !== nVox || frames.scales.length !== nFrames) {
      frames = emptyBandFrames(nFrames, nVox);
      cache.current.set(band, frames);
    }
    const store = frames;
    setLoaded(store.loaded);

    (async () => {
      while (alive && store.loaded < nFrames) {
        const start = store.loaded;
        const res = await fetch(
          `/api/analyses/${analysisId}/sloreta/frames?band=${encodeURIComponent(band)}&start=${start}&count=${CHUNK}`
        );
        if (!res.ok) throw new Error(`frames ${start}+: HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        addChunk(store, start, buf);
        if (alive) setLoaded(store.loaded);
      }
    })().catch((e: Error) => alive && setError(e.message));

    return () => {
      alive = false;
    };
  }, [analysisId, band, nFrames, nVox]);

  return { frames: band ? cache.current.get(band) ?? null : null, loaded, error };
}
