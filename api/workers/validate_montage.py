#!/usr/bin/env python3
"""
EDF Montage Validation Worker
Validates 19-channel 10-20 montage with LE (linked-ears) reference
"""

import sys
import json
import mne
from typing import Dict, List, Tuple, Optional

# Expected 19-channel 10-20 montage
EXPECTED_CHANNELS = [
    'Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8',
    'T7', 'C3', 'Cz', 'C4', 'T8',
    'P7', 'P3', 'Pz', 'P4', 'P8',
    'O1', 'O2'
]

# Allowed variations in channel naming
CHANNEL_ALIASES = {
    'FP1': 'Fp1', 'FP2': 'Fp2',
    'T3': 'T7', 'T4': 'T8',
    'T5': 'P7', 'T6': 'P8',
}

def normalize_channel_name(ch: str) -> str:
    """Normalize channel name to standard format"""
    ch = ch.strip().replace(' ', '')
    return CHANNEL_ALIASES.get(ch, ch)

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

        # Check number of channels
        if n_channels != 19:
            return {
                'valid': False,
                'error': f'Expected 19 channels, found {n_channels}. This tool requires 19-channel 10-20 montage.',
                'metadata': None
            }

        # Check if all expected channels are present
        missing_channels = [ch for ch in EXPECTED_CHANNELS if ch not in ch_names]
        if missing_channels:
            return {
                'valid': False,
                'error': f'Missing required channels: {", ".join(missing_channels)}. Expected 10-20 montage.',
                'metadata': None
            }

        # Check for extra channels
        extra_channels = [ch for ch in ch_names if ch not in EXPECTED_CHANNELS]
        if extra_channels:
            return {
                'valid': False,
                'error': f'Unexpected channels found: {", ".join(extra_channels)}. Only 19-channel 10-20 montage is supported.',
                'metadata': None
            }

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
