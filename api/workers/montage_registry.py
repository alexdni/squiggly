"""Canonical EEG montage registry shared with the TypeScript layer.

The source of truth is ``lib/montages/canonical-montages.json`` at the
repository root. Python workers load it directly so channel support stays in
sync with upload/validation code.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Set


_REGISTRY_PATH = Path(__file__).resolve().parents[2] / 'lib' / 'montages' / 'canonical-montages.json'


@lru_cache(maxsize=1)
def load_registry() -> Dict:
    with _REGISTRY_PATH.open('r', encoding='utf-8') as f:
        return json.load(f)


def _unique(channels: List[str]) -> List[str]:
    seen: Set[str] = set()
    unique_channels: List[str] = []
    for channel in channels:
        if channel not in seen:
            seen.add(channel)
            unique_channels.append(channel)
    return unique_channels


@lru_cache(maxsize=None)
def get_montage_channels(montage_id: str) -> List[str]:
    registry = load_registry()
    montages = registry['montages']
    if montage_id not in montages:
        raise KeyError(f'Unknown montage profile: {montage_id}')

    montage = montages[montage_id]
    parent_id: Optional[str] = montage.get('base') or montage.get('extends')
    parent_channels = get_montage_channels(parent_id) if parent_id else []
    own_channels = montage.get('channels') or []
    additional_channels = montage.get('additionalChannels') or []

    return _unique([*parent_channels, *own_channels, *additional_channels])


@lru_cache(maxsize=1)
def get_all_known_eeg_channels() -> List[str]:
    registry = load_registry()
    all_channels: List[str] = []
    for montage_id in registry['montages'].keys():
        all_channels.extend(get_montage_channels(montage_id))
    return _unique(all_channels)


def get_channel_aliases() -> Dict[str, str]:
    return load_registry().get('channelAliases', {})


def normalize_channel_name(channel_name: str) -> str:
    normalized = ''.join(channel_name.strip().split())

    if normalized.upper() == 'A2-A1':
        return 'A1'

    for prefix in ('EEG', 'ECG', 'EMG', 'EOG'):
        if normalized.upper().startswith(prefix):
            normalized = normalized[len(prefix):]
            break

    for suffix in ('-LE', '-REF', '-AVG', '-A1', '-A2', '-CZ', '-M1', '-M2'):
        if normalized.upper().endswith(suffix):
            normalized = normalized[: -len(suffix)]
            break

    return get_channel_aliases().get(normalized.upper(), normalized)


def is_known_eeg_channel(channel_name: str) -> bool:
    normalized = normalize_channel_name(channel_name).lower()
    return any(channel.lower() == normalized for channel in get_all_known_eeg_channels())
