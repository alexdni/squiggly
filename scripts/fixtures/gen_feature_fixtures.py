#!/usr/bin/env python3
"""
Generate parity fixtures for the TypeScript port of api/workers/extract_features.py
(lib/server/eeg/features) and its DSP helpers (lib/server/eeg/dsp).

NOTE: the Python worker was removed in refactor-node-eeg-pipeline. To regenerate, check out
a commit that still has api/workers/ (e.g. c2c48f7 on the docker branch) next to this script.

Run inside the legacy worker image, which has numpy/scipy/mne pinned to the versions
the Python worker used:

    docker run --rm --entrypoint python3 -v "$PWD":/repo -w /repo \
        squiggly-squiggly:latest scripts/fixtures/gen_feature_fixtures.py

Outputs (lib/server/eeg/__fixtures__/features/):
    synthetic_eeg.json      int16-quantized synthetic 19-channel EEG epochs (EO + EC)
    python_features.json    extract_features() output plus per-method wPLI, the
                            channel-correct alpha peak, EO-only and channel-subset runs
    python_spectrogram.json scipy.signal.spectrogram as used by generate_spectrogram_grid
    dsp.json                scipy reference values for welch/csd/butter/filtfilt/hilbert/...
"""

import base64
import json
import os
import sys

import numpy as np
import mne
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'api', 'workers'))

from extract_features import FeatureExtractor, extract_features, CONNECTIVITY_BANDS  # noqa: E402

OUT_DIR = os.path.join(REPO, 'lib', 'server', 'eeg', '__fixtures__', 'features')

SFREQ = 250.0
CHANNELS = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T7', 'C3', 'Cz', 'C4', 'T8',
            'P7', 'P3', 'Pz', 'P4', 'P8', 'O1', 'O2']
N_EPOCHS = 30
EPOCH_SAMPLES = 500  # 2 s
SCALE_UV = 0.01  # int16 quantization step (µV)

mne.set_log_level('ERROR')


def narrowband(rng, n, sfreq, lo, hi):
    """Complex analytic narrowband noise with unit RMS (FFT masking of white noise)."""
    spec = np.fft.fft(rng.standard_normal(n))
    f = np.fft.fftfreq(n, 1 / sfreq)
    spec[(f < lo) | (f > hi)] = 0  # keep positive band only -> analytic signal
    a = np.fft.ifft(spec)
    return a / np.sqrt(np.mean(np.abs(a) ** 2))


def pink(rng, n, sfreq, exponent=1.0):
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / sfreq)
    f[0] = f[1]
    spec /= f ** (exponent / 2)
    x = np.fft.irfft(spec, n)
    return x / np.std(x)


def make_condition(rng, eyes_closed):
    n = N_EPOCHS * EPOCH_SAMPLES
    t = np.arange(n) / SFREQ
    x = np.zeros((len(CHANNELS), n))
    idx = {ch: i for i, ch in enumerate(CHANNELS)}

    # 1/f background, independent per channel, plus a weak common component
    common = pink(rng, n, SFREQ, 1.2)
    for i in range(len(CHANNELS)):
        x[i] += 9.0 * pink(rng, n, SFREQ, 1.0 + 0.05 * (i % 5)) + 2.0 * common

    # Posterior alpha with channel-specific peak frequency and slow AM
    alpha_amp = 22.0 if eyes_closed else 6.0
    alpha_freqs = {'O1': 10.2, 'O2': 10.0, 'Pz': 9.8, 'P3': 10.4, 'P4': 9.6, 'P7': 10.0,
                   'P8': 10.1, 'Cz': 9.9}
    env = 1.0 + 0.4 * np.sin(2 * np.pi * 0.13 * t) + 0.2 * np.sin(2 * np.pi * 0.31 * t + 1.0)
    for ch, f0 in alpha_freqs.items():
        gain = 0.4 if ch == 'Cz' else 1.0
        x[idx[ch]] += gain * alpha_amp * env * np.sin(2 * np.pi * f0 * t + 0.3 * idx[ch])
    # volume-conducted weak alpha frontally
    for ch in ['Fp1', 'Fp2', 'F3', 'F4']:
        x[idx[ch]] += 0.15 * alpha_amp * env * np.sin(2 * np.pi * 10.0 * t + 0.1)

    # Shared theta source with consistent phase lags (drives wPLI)
    theta = narrowband(rng, n, SFREQ, 5.0, 7.0)
    theta_lags = {'F3': 0.0, 'Fz': 0.5, 'F4': 1.0, 'C3': 0.8, 'Cz': 1.3, 'C4': 1.8, 'Fp1': 0.3}
    theta_amp = 9.0 if eyes_closed else 12.0
    for ch, lag in theta_lags.items():
        x[idx[ch]] += theta_amp * np.real(theta * np.exp(-1j * lag))

    # Shared lagged alpha between the occipital pair
    alpha_src = narrowband(rng, n, SFREQ, 9.0, 11.0)
    x[idx['O1']] += 5.0 * np.real(alpha_src)
    x[idx['O2']] += 5.0 * np.real(alpha_src * np.exp(-1j * 0.7))

    # Beta, stronger frontally in EO
    beta = narrowband(rng, n, SFREQ, 16.0, 24.0)
    beta_amp = 7.0 if not eyes_closed else 3.5
    for ch in ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'C3', 'C4']:
        x[idx[ch]] += beta_amp * np.real(beta * np.exp(-1j * 0.2 * idx[ch]))
        x[idx[ch]] += 2.0 * rng.standard_normal(n) * (1 if not eyes_closed else 0.5)

    # Slow delta drift on frontal poles (eye-ish)
    delta = narrowband(rng, n, SFREQ, 1.0, 3.0)
    for ch, g in [('Fp1', 1.0), ('Fp2', 0.9), ('F7', 0.4), ('F8', 0.4)]:
        x[idx[ch]] += g * 10.0 * np.real(delta)

    q = np.clip(np.round(x / SCALE_UV), -32767, 32767).astype('<i2')
    # [epoch][channel][time]
    q = q.reshape(len(CHANNELS), N_EPOCHS, EPOCH_SAMPLES).transpose(1, 0, 2).copy()
    return q


def to_epochs(data_uv, ch_names, sfreq):
    info = mne.create_info(list(ch_names), sfreq, 'eeg')
    return mne.EpochsArray(data_uv * 1e-6, info, verbose=False)


def b64_i16(q):
    return base64.b64encode(np.ascontiguousarray(q, dtype='<i2').tobytes()).decode('ascii')


def tolist(v):
    return np.asarray(v).tolist()


def fixed_alpha_peak(extractor, epochs):
    """compute_alpha_peak with per-channel concatenation (what the code intends)."""
    data = epochs.get_data()
    e, c, t = data.shape
    relaid = np.ascontiguousarray(data.transpose(1, 0, 2)).reshape(e, c, t)

    class _Fake:
        ch_names = epochs.ch_names

        def get_data(self):
            return relaid

    return extractor.compute_alpha_peak(_Fake())


def per_method_wpli(extractor, epochs):
    data = epochs.get_data()
    n_ch = data.shape[1]
    out = {}
    for band, (lo, hi) in CONNECTIVITY_BANDS.items():
        filt = extractor._bandpass_filter(data, lo, hi)
        csd_vals, hil_vals = [], []
        for i in range(n_ch):
            for j in range(i + 1, n_ch):
                csd_vals.append(extractor._compute_wpli_csd(data[:, i, :], data[:, j, :], lo, hi))
                hil_vals.append(extractor._compute_wpli_hilbert(filt[:, i, :], filt[:, j, :]))
        out[band] = {'csd': csd_vals, 'hilbert': hil_vals}
    return out


def gen_features():
    rng = np.random.default_rng(20261002)
    q_eo = make_condition(rng, eyes_closed=False)
    q_ec = make_condition(rng, eyes_closed=True)
    uv_eo = q_eo.astype(np.float64) * SCALE_UV
    uv_ec = q_ec.astype(np.float64) * SCALE_UV

    inputs = {
        'sfreq': SFREQ,
        'channels': CHANNELS,
        'scale_uv': SCALE_UV,
        'layout': 'int16 little-endian, [epoch][channel][time], value_uv = q * scale_uv',
        'eo': {'n_epochs': N_EPOCHS, 'n_times': EPOCH_SAMPLES, 'data_b64': b64_i16(q_eo)},
        'ec': {'n_epochs': N_EPOCHS, 'n_times': EPOCH_SAMPLES, 'data_b64': b64_i16(q_ec)},
    }

    ep_eo = to_epochs(uv_eo, CHANNELS, SFREQ)
    ep_ec = to_epochs(uv_ec, CHANNELS, SFREQ)
    feats = extract_features(ep_eo, ep_ec)

    extractor = FeatureExtractor(SFREQ)
    extra = {
        'alpha_peak_fixed': {
            'eo': fixed_alpha_peak(extractor, ep_eo),
            'ec': fixed_alpha_peak(extractor, ep_ec),
        },
        'wpli_methods': {
            'eo': per_method_wpli(extractor, ep_eo),
            'ec': per_method_wpli(extractor, ep_ec),
        },
    }

    # EO-only: derived metrics fall back to EO band power
    bp_eo = feats['band_power']['eo']
    ratios_eo = extractor.compute_band_ratios(bp_eo)
    asym_eo = extractor.compute_asymmetry(bp_eo)
    extra['eo_only'] = {
        'band_ratios': ratios_eo,
        'asymmetry': asym_eo,
        'risk_patterns': {k: bool(v) for k, v in
                          extractor.detect_risk_patterns(bp_eo, ratios_eo, asym_eo).items()},
    }

    # Channel subset (missing Fz, T8, O2) on the first 8 EC epochs: exercises "if ch in" paths
    subset_ch = [ch for ch in CHANNELS if ch not in ('Fz', 'T8', 'O2')]
    sel = [CHANNELS.index(ch) for ch in subset_ch]
    ep_sub = to_epochs(uv_ec[:8][:, sel, :], subset_ch, SFREQ)
    sub = extract_features(None, ep_sub)
    extra['subset'] = {
        'channels': subset_ch,
        'source': 'ec',
        'n_epochs': 8,
        'features': sub,
    }

    feats['risk_patterns'] = {k: bool(v) for k, v in feats['risk_patterns'].items()}
    extra['subset']['features']['risk_patterns'] = {
        k: bool(v) for k, v in sub['risk_patterns'].items()}
    return inputs, {'features': feats, **extra}, (ep_eo, ep_ec)


def gen_spectrogram(ep_eo, ep_ec):
    """Mirror of generate_visuals.generate_spectrogram_grid, kept as data (µV²/Hz)."""
    out = {'channels': ['Fp1', 'O1'], 'eo': {}, 'ec': {}}
    for cond, ep in (('eo', ep_eo), ('ec', ep_ec)):
        sfreq = ep.info['sfreq']
        for ch in out['channels']:
            ch_idx = ep.ch_names.index(ch)
            continuous = ep.get_data()[:, ch_idx, :].ravel()
            f, t, sxx = signal.spectrogram(continuous, fs=sfreq, nperseg=int(2 * sfreq),
                                           noverlap=int(1.5 * sfreq), scaling='density')
            mask = (f >= 0.5) & (f <= 45)
            sxx_uv = sxx[mask, :] * 1e12
            out[cond][ch] = {
                'freqs': tolist(f[mask]),
                'times': tolist(t),
                # dB re 1 µV²/Hz. The worker itself plotted 10*log10(Sxx_V + 1e-12); see
                # lib/server/eeg/features/spectrogram.ts
                'power_db': np.round(10 * np.log10(sxx_uv + 1e-12), 6).tolist(),
            }
    return out


def gen_dsp():
    rng = np.random.default_rng(7)
    out = {}

    x = rng.standard_normal(1000) * 10 + np.sin(2 * np.pi * 10 * np.arange(1000) / 250) * 5
    y = np.roll(x, 3) * 0.5 + rng.standard_normal(1000)
    out['signals'] = {'x': tolist(x), 'y': tolist(y)}

    out['windows'] = {
        'hann_250': tolist(signal.get_window('hann', 250)),
        'hann_125': tolist(signal.get_window('hann', 125)),
        'tukey_500': tolist(signal.get_window(('tukey', 0.25), 500)),
        'tukey_77': tolist(signal.get_window(('tukey', 0.25), 77)),
    }

    welch_cases = []
    for fs, nperseg, noverlap in [(250.0, 250, None), (250.0, 256, None), (250.0, 125, 60),
                                  (256.0, 300, 150), (250.0, 2000, None)]:
        f, p = signal.welch(x, fs=fs, nperseg=nperseg, noverlap=noverlap)
        welch_cases.append({'fs': fs, 'nperseg': nperseg, 'noverlap': noverlap,
                            'freqs': tolist(f), 'psd': tolist(p)})
    out['welch'] = welch_cases

    csd_cases = []
    for fs, nperseg, noverlap in [(250.0, 250, 125), (250.0, 125, 62)]:
        f, pxy = signal.csd(x[:500], y[:500], fs=fs, nperseg=nperseg, noverlap=noverlap)
        csd_cases.append({'fs': fs, 'nperseg': nperseg, 'noverlap': noverlap, 'n': 500,
                          'freqs': tolist(f), 're': tolist(pxy.real), 'im': tolist(pxy.imag)})
    out['csd'] = csd_cases

    f, t, sxx = signal.spectrogram(x, fs=250.0, nperseg=500, noverlap=375, scaling='density')
    out['spectrogram'] = {'fs': 250.0, 'nperseg': 500, 'noverlap': 375,
                          'freqs': tolist(f), 'times': tolist(t), 'sxx': tolist(sxx)}

    butter_cases = []
    for fs in (250.0, 256.0, 500.0):
        nyq = fs / 2
        for band, (lo, hi) in CONNECTIVITY_BANDS.items():
            lo_n = max(0.001, min(lo / nyq, 0.99))
            hi_n = max(lo_n + 0.01, min(hi / nyq, 0.99))
            b, a = signal.butter(4, [lo_n, hi_n], btype='band')
            zi = signal.lfilter_zi(b, a)
            case = {'fs': fs, 'band': band, 'wn': [lo_n, hi_n], 'b': tolist(b), 'a': tolist(a),
                    'zi': tolist(zi)}
            if fs == 250.0:
                case['filtfilt_x500'] = tolist(signal.filtfilt(b, a, x[:500]))
            butter_cases.append(case)
    out['butter'] = butter_cases
    out['butter_low'] = {}
    b, a = signal.butter(4, 0.2)
    out['butter_low'] = {'wn': 0.2, 'b': tolist(b), 'a': tolist(a),
                         'filtfilt_x100': tolist(signal.filtfilt(b, a, x[:100]))}
    b, a = signal.butter(3, 0.1, btype='high')
    out['butter_high'] = {'wn': 0.1, 'order': 3, 'b': tolist(b), 'a': tolist(a)}

    out['hilbert'] = {}
    for n in (500, 77, 64):
        h = signal.hilbert(x[:n])
        out['hilbert'][str(n)] = {'re': tolist(h.real), 'im': tolist(h.imag)}

    out['fft'] = {}
    for n in (1, 2, 3, 7, 64, 100, 250, 500, 1000):
        X = np.fft.fft(x[:n] + 1j * y[:n])
        out['fft'][str(n)] = {'re': tolist(X.real), 'im': tolist(X.imag)}

    xs = np.array([0.0, 0.5, 1.5, 3.0, 3.25])
    ys = np.array([1.0, 2.0, -1.0, 4.0, 0.5])
    out['trapz'] = {'x': tolist(xs), 'y': tolist(ys), 'value': float(np.trapz(ys, xs))}
    return out


def write(name, obj):
    path = os.path.join(OUT_DIR, name)
    with open(path, 'w') as fh:
        json.dump(obj, fh, separators=(',', ':'))
    print(f'wrote {os.path.relpath(path, REPO)} ({os.path.getsize(path) / 1024:.0f} KiB)')


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    inputs, features, (ep_eo, ep_ec) = gen_features()
    write('synthetic_eeg.json', inputs)
    write('python_features.json', {
        'versions': {'numpy': np.__version__, 'mne': mne.__version__,
                     'scipy': __import__('scipy').__version__},
        **features,
    })
    write('python_spectrogram.json', gen_spectrogram(ep_eo, ep_ec))
    write('dsp.json', gen_dsp())


if __name__ == '__main__':
    main()
