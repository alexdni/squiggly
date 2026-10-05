#!/usr/bin/env python3
"""
Generate TheraQ parity fixtures for the TypeScript port (lib/server/theraq).

Runs the real Python implementation (api/workers/theraq_metrics.py and
api/workers/theraq_analyze.py) on deterministic synthetic inputs and writes the
inputs plus outputs to lib/server/theraq/__fixtures__/*.json. The MNE
preprocessing step is stubbed so the cleaned epochs we generate are exactly what
the orchestrator sees.

NOTE: the Python worker was removed in refactor-node-eeg-pipeline. To regenerate, check out
a commit that still has api/workers/ (e.g. c2c48f7 on the docker branch) next to this script.

Needs numpy + mne (the squiggly Docker image has both):

  docker run --rm --entrypoint python3 -v "$PWD":/repo -w /repo \
    squiggly-squiggly:latest scripts/fixtures/gen_theraq_fixtures.py
"""

import json
import math
import os
import sys
import types

import numpy as np

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
WORKERS = os.path.join(REPO, 'api', 'workers')
OUT_DIR = os.path.join(REPO, 'lib', 'server', 'theraq', '__fixtures__')
sys.path.insert(0, WORKERS)

# Stub the MNE preprocessing module before theraq_analyze imports it. The stub
# returns the synthetic epochs registered for the phase named by `local_file`.
_PHASE_EPOCHS = {}


def _fake_preprocess_eeg(local_file, **_kwargs):
    return _PHASE_EPOCHS[local_file]


_fake = types.ModuleType('preprocess')
_fake.preprocess_eeg = _fake_preprocess_eeg
sys.modules['preprocess'] = _fake

import mne  # noqa: E402
import theraq_analyze  # noqa: E402
from theraq_metrics import (  # noqa: E402
    SPECTRUM_DOMAIN,
    TheraqEngine,
    _load_definitions,
    compute_theraq_metrics,
)

mne.set_log_level('ERROR')

PHASES = ['EO1', 'EC', 'EO2', 'TASK']
CONDITIONS = ['eo1', 'ec', 'eo2', 'eoload']
ENGINE_CHANNELS = ['O1', 'Cz', 'F3', 'F4']


def _clean(obj):
    """JSON-safe copy: NaN/inf -> None, numpy scalars -> Python."""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        return f if math.isfinite(f) else None
    if isinstance(obj, np.integer):
        return int(obj)
    return obj


def _write(name, payload):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name)
    with open(path, 'w') as f:
        json.dump(_clean(payload), f, separators=(',', ':'), allow_nan=False)
    print(f'wrote {path} ({os.path.getsize(path) / 1024:.1f} KB)')


# --- Engine fixtures (spectra -> metrics/indices) ---------------------------

def _band_spec(alpha=1.0, theta=1.0, beta=1.0, delta=1.0, base=0.5):
    # Same shape as api/workers/tests/test_theraq_metrics.py::_spec
    out = []
    for f in SPECTRUM_DOMAIN:
        if 1 <= f <= 4:
            out.append(delta)
        elif 4 <= f < 7.5:
            out.append(theta)
        elif 7.5 <= f <= 12.5:
            out.append(alpha)
        elif 15.5 <= f <= 25.5:
            out.append(beta)
        else:
            out.append(base)
    return out


def _test_cond(alpha_o1):
    return [
        _band_spec(alpha=alpha_o1),
        _band_spec(alpha=1.5, theta=1.2),
        _band_spec(),
        _band_spec(),
    ]


def _random_spectra(rs):
    """1/f background with random theta/alpha/beta gains, rounded to 1e-6."""
    spectra = {}
    f = np.array(SPECTRUM_DOMAIN, dtype=float)
    for cond in CONDITIONS:
        chans = []
        for _ in ENGINE_CHANNELS:
            spec = 8.0 / (f ** rs.uniform(0.6, 1.2))
            spec *= 1.0 + 0.15 * rs.rand(len(f))
            theta = (f >= 4) & (f <= 7)
            alpha = (f >= 8) & (f <= 12)
            beta = (f >= 16) & (f <= 25)
            spec[theta] *= rs.uniform(0.5, 3.0)
            peak = rs.randint(8, 13)
            spec[alpha] *= rs.uniform(0.5, 4.0)
            spec[f == peak] *= rs.uniform(1.0, 2.0)
            spec[beta] *= rs.uniform(0.3, 3.0)
            chans.append([round(float(v), 6) for v in spec])
        spectra[cond] = chans
    return spectra


def engine_cases():
    cases = []
    cases.append(('py_test_default', {
        'eo1': _test_cond(1.0), 'ec': _test_cond(2.0),
        'eo2': _test_cond(1.1), 'eoload': _test_cond(1.0),
    }))
    cases.append(('py_test_no_alpha_shift', {
        'eo1': _test_cond(1.0), 'ec': _test_cond(1.0),
        'eo2': _test_cond(1.1), 'eoload': _test_cond(1.0),
    }))
    flat = [[1.0] * len(SPECTRUM_DOMAIN) for _ in ENGINE_CHANNELS]
    cases.append(('flat', {c: [list(s) for s in flat] for c in CONDITIONS}))

    rs = np.random.RandomState(20261002)
    for i in range(24):
        cases.append((f'random_{i:02d}', _random_spectra(rs)))

    # Zero beta at F4 in EC -> quotient by zero -> NaN metrics (serialized null).
    zb = _random_spectra(rs)
    zb['ec'][3] = [0.0 if 15.5 <= f <= 25.5 else v for f, v in zip(SPECTRUM_DOMAIN, zb['ec'][3])]
    cases.append(('zero_beta_f4_ec', zb))

    # Peak-frequency quirk: the in-band (7..13 Hz) maximum value also occurs at
    # 2 Hz, and Python's list.index() searches the whole spectrum -> returns 2.
    pk = _random_spectra(rs)
    o1 = pk['ec'][0]
    band_max = max(o1[6:13])
    o1[1] = band_max
    cases.append(('peak_quirk_ec_o1', pk))

    # Values far outside every norm range (exercise range adaptation).
    ext = _random_spectra(rs)
    ext['ec'][0] = [v * (50.0 if 8 <= f <= 12 else 1.0) for f, v in zip(SPECTRUM_DOMAIN, ext['ec'][0])]
    ext['eoload'][1] = [v * (0.01 if 16 <= f <= 25 else 1.0) for f, v in zip(SPECTRUM_DOMAIN, ext['eoload'][1])]
    cases.append(('extreme_values', ext))

    defs = _load_definitions()
    out = []
    for name, spectra in cases:
        res = compute_theraq_metrics(ENGINE_CHANNELS, spectra, SPECTRUM_DOMAIN)
        engine = TheraqEngine(ENGINE_CHANNELS, spectra, SPECTRUM_DOMAIN)
        selected = {d['name']: engine.compute(d) for d in defs['dysregulatedIndexMetrics']}
        out.append({
            'name': name,
            'spectra': spectra,
            'expected': res,
            'expected_selected': selected,
        })
    _write('engine_cases.json', {
        'channels': ENGINE_CHANNELS,
        'domain': SPECTRUM_DOMAIN,
        'cases': out,
    })


# --- Pipeline fixtures (epochs -> full results) -----------------------------

PHASE_SETUP = {
    # phase: (sfreq, channel order, alpha gain at O1, theta gain, beta gain, bad_channels, artifact epochs)
    'EO1': (128.0, ['O1', 'Cz', 'F3', 'F4', 'Pz'], 1.0, 1.0, 1.0, [], [3]),
    'EC': (128.0, ['F4', 'F3', 'Cz', 'O1', 'Pz'], 2.4, 1.1, 0.9, ['Pz'], [0]),
    'EO2': (100.0, ['O1', 'Cz', 'F3', 'F4'], 1.2, 1.0, 1.0, [], [6]),
    'TASK': (100.0, ['Fz', 'O1', 'Cz', 'F3', 'F4'], 0.8, 1.3, 1.6, [], [2, 5]),
}
N_EPOCHS = 8
EPOCH_SECONDS = 2.0


def _synth_phase(rs, sfreq, channels, alpha_gain, theta_gain, beta_gain, artifact_epochs):
    n = int(round(EPOCH_SECONDS * sfreq))
    t = np.arange(n) / sfreq
    data = np.zeros((N_EPOCHS, len(channels), n))
    for e in range(N_EPOCHS):
        for c, ch in enumerate(channels):
            posterior = ch in ('O1', 'Pz')
            a_amp = (12.0 if posterior else 5.0) * alpha_gain
            x = a_amp * np.sin(2 * np.pi * rs.uniform(9.5, 10.5) * t + rs.uniform(0, 2 * np.pi))
            x += 6.0 * theta_gain * np.sin(2 * np.pi * rs.uniform(5.0, 6.5) * t + rs.uniform(0, 2 * np.pi))
            x += 3.0 * beta_gain * np.sin(2 * np.pi * rs.uniform(18.0, 22.0) * t + rs.uniform(0, 2 * np.pi))
            # 1/f-ish noise: cumulative sum of white noise, detrended, plus white noise
            walk = np.cumsum(rs.randn(n))
            walk -= np.linspace(walk[0], walk[-1], n)
            x += 1.5 * walk + 2.0 * rs.randn(n)
            if e in artifact_epochs and c == 0:
                x += 400.0 * np.sin(2 * np.pi * 0.7 * t)  # large slow drift
            data[e, c] = x
    # Quantize so the stored µV inputs are exactly what Python consumes.
    return np.round(data, 3)


def _stub_phase(phase, data_uv, sfreq, channels, bad):
    info = mne.create_info(channels, sfreq, 'eeg')
    epochs = mne.EpochsArray(data_uv * 1e-6, info, verbose=False)
    _PHASE_EPOCHS[phase] = {'epochs_eo': epochs, 'qc_metrics': {'bad_channels': list(bad)}}


def _phase_input(data_uv, sfreq, channels, bad):
    return {
        'sfreq': sfreq,
        'channels': channels,
        'badChannels': list(bad),
        'epochs': [[[float(v) for v in ch] for ch in ep] for ep in data_uv],
    }


def _run(phase_inputs, config=None):
    _PHASE_EPOCHS.clear()
    for phase, inp in phase_inputs.items():
        _stub_phase(phase, np.array(inp['epochs'], dtype=float), inp['sfreq'],
                    inp['channels'], inp['badChannels'])
    phase_files = {p: {'local_file': p, 'duration': 0.0} for p in phase_inputs}
    try:
        res = theraq_analyze.analyze_theraq_project(phase_files, config or {}, 'ica')
    except ValueError as e:
        return {'error': str(e)}
    res['processing_metadata'].pop('processing_time_seconds', None)
    return {'result': res}


def _apply(inputs, mutation):
    """Apply one of the mutations the TS test replays (keep the two in sync)."""
    out = json.loads(json.dumps(inputs))
    kind = mutation['kind']
    if kind == 'drop_phase':
        del out[mutation['phase']]
    elif kind == 'drop_channel':
        p = out[mutation['phase']]
        ci = p['channels'].index(mutation['channel'])
        p['channels'].pop(ci)
        for ep in p['epochs']:
            ep.pop(ci)
    elif kind == 'keep_epochs':
        p = out[mutation['phase']]
        p['epochs'] = p['epochs'][:mutation['n']]
    elif kind == 'none':
        pass
    else:
        raise ValueError(kind)
    return out


def pipeline_cases():
    rs = np.random.RandomState(7)
    inputs = {}
    for phase in PHASES:
        sfreq, chans, ag, tg, bg, bad, art = PHASE_SETUP[phase]
        data = _synth_phase(rs, sfreq, chans, ag, tg, bg, art)
        inputs[phase] = _phase_input(data, sfreq, chans, bad)

    variants = [
        {'name': 'default', 'mutation': {'kind': 'none'}, 'config': {}},
        {'name': 'mad_k_1', 'mutation': {'kind': 'none'},
         'config': {'theraq_reject_mad_k': 1.0, 'theraq_min_epochs': 3}},
        {'name': 'min_epochs_8', 'mutation': {'kind': 'none'}, 'config': {'theraq_min_epochs': 8}},
        {'name': 'missing_phase', 'mutation': {'kind': 'drop_phase', 'phase': 'EO2'}, 'config': {}},
        {'name': 'missing_channel_ec_f3', 'mutation': {'kind': 'drop_channel', 'phase': 'EC', 'channel': 'F3'},
         'config': {}},
        {'name': 'too_few_epochs_task', 'mutation': {'kind': 'keep_epochs', 'phase': 'TASK', 'n': 5},
         'config': {}},
    ]
    out = []
    for v in variants:
        res = _run(_apply(inputs, v['mutation']), v['config'])
        out.append({**v, 'expected': res})
    _write('pipeline_cases.json', {'inputs': inputs, 'variants': out})


if __name__ == '__main__':
    print('numpy', np.__version__, 'mne', mne.__version__)
    engine_cases()
    pipeline_cases()
