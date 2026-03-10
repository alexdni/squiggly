#!/usr/bin/env python3
"""
EDF Montage Validation Worker
Validates EDF files with standard 10-20 or 10-10 montage channels
"""

import sys
import json
import mne
from typing import Dict, List, Tuple, Optional

# Standard 10-20 montage channels
EXPECTED_CHANNELS = [
    'Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8',
    'T7', 'C3', 'Cz', 'C4', 'T8',
    'P7', 'P3', 'Pz', 'P4', 'P8',
    'O1', 'O2'
]

# Extended 10-10 channels also accepted
EXTENDED_CHANNELS = [
    'Fpz', 'AFz', 'FCz', 'CPz', 'POz', 'Oz', 'Iz',
    'AF3', 'AF4', 'AF7', 'AF8',
    'FC1', 'FC2', 'FC3', 'FC4', 'FC5', 'FC6',
    'FT7', 'FT8', 'FT9', 'FT10',
    'CP1', 'CP2', 'CP3', 'CP4', 'CP5', 'CP6',
    'TP7', 'TP8', 'TP9', 'TP10',
    'PO3', 'PO4', 'PO7', 'PO8',
    'A1', 'A2',
]

ALL_VALID_CHANNELS = set(EXPECTED_CHANNELS + EXTENDED_CHANNELS)

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

        # Check minimum channel count
        if n_channels < 2:
            return {
                'valid': False,
                'error': f'EDF file must have at least 2 channels, found {n_channels}.',
                'metadata': None
            }

        # Check that at least some recognized EEG channels are present
        valid_eeg_channels = [ch for ch in ch_names if ch in ALL_VALID_CHANNELS]
        if len(valid_eeg_channels) < 2:
            return {
                'valid': False,
                'error': f'No recognized EEG channels found. Expected standard 10-20 or 10-10 channel names.',
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
