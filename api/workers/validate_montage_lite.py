#!/usr/bin/env python3
"""
Lightweight EDF Montage Validation (No MNE dependency)
Validates EDF header structure without loading the full file
"""

import sys
import json
import struct
from typing import Dict, List, Optional

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

def parse_edf_header(file_path: str) -> Dict:
    """
    Parse EDF header without MNE (lightweight validation)

    EDF Header Structure (256 bytes):
    - 0-7: Version (8 bytes, should be "0       ")
    - 8-87: Patient ID (80 bytes)
    - 88-167: Recording ID (80 bytes)
    - 168-175: Start date (8 bytes, dd.mm.yy)
    - 176-183: Start time (8 bytes, hh.mm.ss)
    - 184-191: Header size (8 bytes, number of bytes)
    - 192-235: Reserved (44 bytes)
    - 236-243: Number of data records (8 bytes)
    - 244-251: Duration of data record (8 bytes, in seconds)
    - 252-255: Number of signals/channels (4 bytes)
    """
    try:
        with open(file_path, 'rb') as f:
            # Read fixed header (256 bytes)
            header = f.read(256)

            if len(header) < 256:
                return {
                    'valid': False,
                    'error': 'File too small to be valid EDF',
                    'metadata': None
                }

            # Parse header fields
            version = header[0:8].decode('ascii', errors='ignore').strip()
            if not version.startswith('0'):
                return {
                    'valid': False,
                    'error': 'Invalid EDF format: version field incorrect',
                    'metadata': None
                }

            # Get number of channels
            n_channels = int(header[252:256].decode('ascii', errors='ignore').strip())

            if n_channels != 19:
                return {
                    'valid': False,
                    'error': f'Expected 19 channels, found {n_channels}. This tool requires 19-channel 10-20 montage.',
                    'metadata': None
                }

            # Get duration info
            n_records = int(header[236:244].decode('ascii', errors='ignore').strip())
            record_duration = float(header[244:252].decode('ascii', errors='ignore').strip())
            duration = n_records * record_duration

            # Read channel labels (16 bytes each)
            channel_labels = []
            for i in range(n_channels):
                label = f.read(16).decode('ascii', errors='ignore').strip()
                channel_labels.append(normalize_channel_name(label))

            # Check if all expected channels are present
            missing_channels = [ch for ch in EXPECTED_CHANNELS if ch not in channel_labels]
            if missing_channels:
                return {
                    'valid': False,
                    'error': f'Missing required channels: {", ".join(missing_channels)}. Expected 10-20 montage.',
                    'metadata': None
                }

            # Check for extra channels
            extra_channels = [ch for ch in channel_labels if ch not in EXPECTED_CHANNELS]
            if extra_channels:
                return {
                    'valid': False,
                    'error': f'Unexpected channels found: {", ".join(extra_channels)}. Only 19-channel 10-20 montage is supported.',
                    'metadata': None
                }

            # Read sampling info (skip transducer type, physical dimension, etc.)
            # Each field is n_channels * field_size
            f.read(80 * n_channels)  # Transducer type
            f.read(8 * n_channels)   # Physical dimension
            f.read(8 * n_channels)   # Physical minimum
            f.read(8 * n_channels)   # Physical maximum
            f.read(8 * n_channels)   # Digital minimum
            f.read(8 * n_channels)   # Digital maximum
            f.read(80 * n_channels)  # Prefiltering

            # Read number of samples per record
            samples_per_record = []
            for i in range(n_channels):
                samples = int(f.read(8).decode('ascii', errors='ignore').strip())
                samples_per_record.append(samples)

            # Calculate sampling rate (assume all channels same rate)
            sampling_rate = samples_per_record[0] / record_duration if record_duration > 0 else 0

            # Note: Annotations are not parsed in lite version
            # This keeps the validation fast and lightweight

            metadata = {
                'duration_seconds': float(duration),
                'sampling_rate': float(sampling_rate),
                'n_channels': n_channels,
                'channels': channel_labels,
                'annotations': [],  # Empty in lite version
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
    result = parse_edf_header(file_path)
    print(json.dumps(result))
    sys.exit(0 if result['valid'] else 1)

if __name__ == '__main__':
    main()
