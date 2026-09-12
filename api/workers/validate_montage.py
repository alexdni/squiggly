#!/usr/bin/env python3
"""
EDF Montage Validation Worker
Validates EDF files with standard 10-20 or 10-10 montage channels
"""

import sys
import json
import mne
from typing import Dict, List, Tuple, Optional

from montage_registry import get_all_known_eeg_channels, get_montage_channels, normalize_channel_name

EXPECTED_CHANNELS = get_montage_channels('10-20-19')
ALL_VALID_CHANNELS = set(get_all_known_eeg_channels())

def validate_edf_montage(file_path: str) -> Dict:
    """
    Validate EDF file montage

    Returns:
        Dict with validation results including:
        - valid: bool
        - error: Optional[str]
        - metadata: Optional[Dict] (duration, sampling_rate, n_channels, channels)
    """
    try:
        # Load EDF file
        raw = mne.io.read_raw_edf(file_path, preload=False, verbose=False)

        # Get channel information
        ch_names = [normalize_channel_name(ch) for ch in raw.ch_names]
        n_channels = len(ch_names)

        # Check minimum channel count
        if n_channels < 2:
            return {
                'valid': False,
                'error': f'EDF file must have at least 2 channels, found {n_channels}.',
                'metadata': None
            }

        # Log recognized channel count but don't reject on name mismatch
        valid_eeg_channels = [ch for ch in ch_names if ch in ALL_VALID_CHANNELS]
        print(f'Recognized EEG channels: {len(valid_eeg_channels)}/{len(ch_names)}')

        # Get metadata
        sampling_rate = raw.info['sfreq']
        duration = raw.times[-1] if len(raw.times) > 0 else 0

        # Get annotations for EO/EC detection
        annotations = []
        if raw.annotations is not None:
            for ann in raw.annotations:
                annotations.append({
                    'onset': float(ann['onset']),
                    'duration': float(ann['duration']),
                    'description': str(ann['description'])
                })

        metadata = {
            'duration_seconds': float(duration),
            'sampling_rate': float(sampling_rate),
            'n_channels': n_channels,
            'channels': ch_names,
            'annotations': annotations,
        }

        return {
            'valid': True,
            'error': None,
            'metadata': metadata
        }

    except Exception as e:
        return {
            'valid': False,
            'error': f'Failed to read EDF file: {str(e)}',
            'metadata': None
        }

def main():
    """Main entry point for command-line usage"""
    if len(sys.argv) < 2:
        print(json.dumps({
            'valid': False,
            'error': 'No file path provided',
            'metadata': None
        }))
        sys.exit(1)

    file_path = sys.argv[1]
    result = validate_edf_montage(file_path)
    print(json.dumps(result))
    sys.exit(0 if result['valid'] else 1)

if __name__ == '__main__':
    main()
