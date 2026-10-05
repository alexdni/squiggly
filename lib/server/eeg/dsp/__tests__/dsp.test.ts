import { describe, expect, it } from 'vitest';
import fixture from '../../__fixtures__/features/dsp.json';
import {
  butter,
  csd,
  fft,
  filtfilt,
  getWindow,
  hilbert,
  ifft,
  lfilter,
  lfilterZi,
  median,
  rfft,
  spectrogram,
  trapz,
  welch,
} from '../index';

/** max |a-b| / max(|b|) over the vector */
function relErr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  expect(a.length).toBe(b.length);
  let num = 0;
  let den = 0;
  for (let i = 0; i < b.length; i++) {
    num = Math.max(num, Math.abs(a[i] - b[i]));
    den = Math.max(den, Math.abs(b[i]));
  }
  return den === 0 ? num : num / den;
}

const x = Float64Array.from(fixture.signals.x);
const y = Float64Array.from(fixture.signals.y);

describe('fft', () => {
  it.each(Object.keys(fixture.fft))('matches numpy.fft.fft for n=%s', (key) => {
    const n = Number(key);
    const ref = fixture.fft[key as keyof typeof fixture.fft];
    const out = fft(x.subarray(0, n), y.subarray(0, n));
    expect(relErr(out.re, ref.re)).toBeLessThan(1e-13);
    expect(relErr(out.im, ref.im)).toBeLessThan(1e-13);
  });

  it('round-trips through ifft for prime and composite lengths', () => {
    for (const n of [97, 251, 360, 1009, 1024]) {
      const re = x.subarray(0, Math.min(n, x.length));
      const src = new Float64Array(n);
      src.set(re);
      const spec = fft(src);
      const back = ifft(spec.re, spec.im);
      expect(relErr(back.re, src)).toBeLessThan(1e-13);
    }
  });

  it('rfft agrees with the complex fft for odd and even lengths', () => {
    for (const n of [250, 251, 500, 77]) {
      const full = fft(x.subarray(0, n));
      const half = rfft(x.subarray(0, n));
      expect(half.re.length).toBe(Math.floor(n / 2) + 1);
      expect(relErr(half.re, full.re.subarray(0, half.re.length))).toBeLessThan(1e-13);
      expect(relErr(half.im, full.im.subarray(0, half.im.length))).toBeLessThan(1e-13);
    }
  });
});

describe('windows', () => {
  it('hann and tukey(0.25) match scipy.signal.get_window (periodic)', () => {
    expect(relErr(getWindow('hann', 250), fixture.windows.hann_250)).toBeLessThan(1e-15);
    expect(relErr(getWindow('hann', 125), fixture.windows.hann_125)).toBeLessThan(1e-15);
    expect(relErr(getWindow({ tukey: 0.25 }, 500), fixture.windows.tukey_500)).toBeLessThan(1e-15);
    expect(relErr(getWindow({ tukey: 0.25 }, 77), fixture.windows.tukey_77)).toBeLessThan(1e-15);
  });
});

describe('welch / csd / spectrogram', () => {
  it.each(fixture.welch.map((c) => [c.fs, c.nperseg, c.noverlap, c] as const))(
    'welch fs=%s nperseg=%s noverlap=%s',
    (fs, nperseg, noverlap, ref) => {
      const out = welch(x, { fs, nperseg, noverlap: noverlap ?? undefined });
      expect(Array.from(out.freqs)).toEqual(ref.freqs);
      expect(relErr(out.psd, ref.psd)).toBeLessThan(1e-12);
    }
  );

  it.each(fixture.csd.map((c) => [c.nperseg, c.noverlap, c] as const))('csd nperseg=%s noverlap=%s', (nperseg, noverlap, ref) => {
    const out = csd(x.subarray(0, ref.n), y.subarray(0, ref.n), { fs: ref.fs, nperseg, noverlap });
    expect(Array.from(out.freqs)).toEqual(ref.freqs);
    expect(relErr(out.re, ref.re)).toBeLessThan(1e-12);
    expect(relErr(out.im, ref.im)).toBeLessThan(1e-12);
  });

  it('spectrogram (tukey 0.25) matches scipy', () => {
    const ref = fixture.spectrogram;
    const out = spectrogram(x, { fs: ref.fs, nperseg: ref.nperseg, noverlap: ref.noverlap });
    expect(Array.from(out.freqs)).toEqual(ref.freqs);
    expect(Array.from(out.times)).toEqual(ref.times);
    expect(out.sxx.length).toBe(ref.sxx.length);
    let worst = 0;
    for (let k = 0; k < ref.sxx.length; k++) worst = Math.max(worst, relErr(out.sxx[k], ref.sxx[k]));
    expect(worst).toBeLessThan(1e-12);
  });
});

describe('butter / filtfilt', () => {
  it.each(fixture.butter.map((c) => [c.fs, c.band, c] as const))('bandpass coefficients fs=%s %s', (_fs, _band, ref) => {
    const { b, a } = butter(4, ref.wn as [number, number], 'bandpass');
    expect(relErr(b, ref.b)).toBeLessThan(1e-14);
    expect(relErr(a, ref.a)).toBeLessThan(1e-14);
  });

  it('lfilterZi is a steady state of the filter and matches scipy where well conditioned', () => {
    for (const ref of fixture.butter) {
      const zi = lfilterZi(ref.b, ref.a);
      // one DF2T step with unit input must reproduce the state
      const y0 = zi[0] + ref.b[0];
      for (let i = 0; i < zi.length; i++) {
        const next = (i + 1 < zi.length ? zi[i + 1] : 0) + ref.b[i + 1] - ref.a[i + 1] * y0;
        expect(Math.abs(next - zi[i])).toBeLessThan(1e-13 * Math.max(...zi.map(Math.abs)));
      }
      if (ref.band === 'beta') expect(relErr(zi, ref.zi)).toBeLessThan(1e-9);
    }
  });

  it('filtfilt matches scipy for every connectivity band at 250 Hz', () => {
    // 1-4 Hz is the worst case: the 8th-order transfer function amplifies rounding (see lfilterZi)
    const tol: Record<string, number> = { delta: 1e-4, theta: 1e-6, alpha: 1e-7, beta: 1e-10 };
    for (const ref of fixture.butter.filter((c) => c.filtfilt_x500)) {
      const own = butter(4, ref.wn as [number, number], 'bandpass');
      expect(relErr(filtfilt(own.b, own.a, x.subarray(0, 500)), ref.filtfilt_x500!)).toBeLessThan(tol[ref.band]);
    }
  });

  it('lowpass and highpass designs match scipy', () => {
    const lp = butter(4, fixture.butter_low.wn, 'lowpass');
    expect(relErr(lp.b, fixture.butter_low.b)).toBeLessThan(1e-12);
    expect(relErr(lp.a, fixture.butter_low.a)).toBeLessThan(1e-12);
    expect(relErr(filtfilt(lp.b, lp.a, x.subarray(0, 100)), fixture.butter_low.filtfilt_x100)).toBeLessThan(1e-12);
    const hp = butter(fixture.butter_high.order, fixture.butter_high.wn, 'highpass');
    expect(relErr(hp.b, fixture.butter_high.b)).toBeLessThan(1e-12);
    expect(relErr(hp.a, fixture.butter_high.a)).toBeLessThan(1e-12);
  });

  it('lfilter with zero state is a plain difference equation', () => {
    const { y: out } = lfilter([0.5, 0.5], [1, -0.5], [1, 0, 0, 0]);
    expect(Array.from(out)).toEqual([0.5, 0.75, 0.375, 0.1875]);
  });

  it('filtfilt rejects inputs shorter than padlen', () => {
    expect(() => filtfilt([1, 1], [1, 0.5], [1, 2, 3])).toThrow(/padlen/);
  });
});

describe('hilbert / trapz / median', () => {
  it.each(Object.keys(fixture.hilbert))('hilbert n=%s', (key) => {
    const n = Number(key);
    const ref = fixture.hilbert[key as keyof typeof fixture.hilbert];
    const out = hilbert(x.subarray(0, n));
    expect(relErr(out.re, ref.re)).toBeLessThan(1e-13);
    expect(relErr(out.im, ref.im)).toBeLessThan(1e-13);
  });

  it('trapz matches numpy', () => {
    expect(trapz(fixture.trapz.y, fixture.trapz.x)).toBeCloseTo(fixture.trapz.value, 14);
  });

  it('median averages the middle pair for even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
