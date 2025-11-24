#!/usr/bin/env python3
"""
CSV Reader Module for EEG Data

Handles reading and converting CSV files with EEG data to MNE Raw format
for compatibility with existing preprocessing pipeline.
"""

import numpy as np
import pandas as pd
import mne
from typing import Tuple, List
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class CSVReader:
    """Read CSV files containing EEG data and convert to MNE Raw format"""

    def __init__(self):
        """Initialize CSV reader"""
        # Standard 10-20 channel names we support
        self.standard_channels = [
            'Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8',
            'T7', 'C3', 'Cz', 'C4', 'T8',
            'P7', 'P3', 'Pz', 'P4', 'P8',
            'O1', 'O2', 'A1', 'A2'
        ]

        # Additional EEG channels (10-10 system, old nomenclature)
        self.additional_channels = [
            'T3', 'T4', 'T5', 'T6',  # Old nomenclature
            'Fpz', 'AFz', 'FCz', 'CPz', 'POz', 'Oz', 'Iz',
            'AF3', 'AF4', 'AF7', 'AF8',
            'FC1', 'FC2', 'FC3', 'FC4', 'FC5', 'FC6',
            'FT7', 'FT8', 'FT9', 'FT10',
            'CP1', 'CP2', 'CP3', 'CP4', 'CP5', 'CP6',
            'TP7', 'TP8', 'TP9', 'TP10',
            'PO3', 'PO4', 'PO7', 'PO8',
        ]

        # All valid EEG channels
        self.all_eeg_channels = self.standard_channels + self.additional_channels

        # ECG channel patterns
        self.ecg_patterns = ['ecg', 'ECG', 'EKG', 'ekg']

        # Excluded channel patterns (accelerometer, gyroscope, impedance)
        self.excluded_patterns = [
            r'^a[XYZ]$',     # Accelerometer: aX, aY, aZ
            r'^g[XYZ]$',     # Gyroscope: gX, gY, gZ
            r'^acc',         # acc, Acc, ACC
            r'^gyro',        # gyro, Gyro, GYRO
            r'^mag',         # Magnetometer
            r'^temp',        # Temperature
            r'^batt',        # Battery
            r'^z-',          # Impedance measurements: z-Cz, z-F3, etc.
        ]

    def is_excluded_channel(self, channel_name: str) -> bool:
        """Check if a channel should be excluded"""
        import re
        for pattern in self.excluded_patterns:
            if re.match(pattern, channel_name, re.IGNORECASE):
                return True
        return False

    def is_ecg_channel(self, channel_name: str) -> bool:
        """Check if a channel is an ECG channel"""
        return channel_name.lower() in [p.lower() for p in self.ecg_patterns]

    def is_eeg_channel(self, channel_name: str) -> bool:
        """Check if a channel is a valid EEG channel (case-insensitive)"""
        channel_lower = channel_name.lower()
        return any(ch.lower() == channel_lower for ch in self.all_eeg_channels)

    def read_csv(self, file_path: str) -> Tuple[mne.io.RawArray, float]:
        """
        Read CSV file and convert to MNE Raw format

        Args:
            file_path: Path to CSV file

        Returns:
            Tuple of (MNE Raw object, sampling rate in Hz)
        """
        logger.info(f"Reading CSV file: {file_path}")

        # Read CSV file
        try:
            df = pd.read_csv(file_path)
        except Exception as e:
            logger.error(f"Failed to read CSV file: {e}")
            raise ValueError(f"Invalid CSV file: {e}")

        # Validate structure
        if 'timestamp' not in df.columns:
            raise ValueError("CSV file must have 'timestamp' column as first column")

        # Get channel columns (all except timestamp)
        channel_cols = [col for col in df.columns if col.lower() != 'timestamp']

        if len(channel_cols) == 0:
            raise ValueError("CSV file must have at least one channel column")

        logger.info(f"Found {len(channel_cols)} channels: {channel_cols}")

        # Filter channels: include EEG and ECG, exclude motion sensors and impedance
        valid_channels = []
        ecg_channels = []
        channel_types = []

        for col in channel_cols:
            # Skip excluded channels
            if self.is_excluded_channel(col):
                logger.info(f"Excluding channel: {col} (motion sensor or impedance)")
                continue

            # Check if EEG channel
            if self.is_eeg_channel(col):
                valid_channels.append(col)
                channel_types.append('eeg')
                continue

            # Check if ECG channel
            if self.is_ecg_channel(col):
                valid_channels.append(col)
                ecg_channels.append(col)
                channel_types.append('ecg')
                logger.info(f"Including ECG channel: {col}")
                continue

            logger.info(f"Skipping unknown channel: {col}")

        if len(valid_channels) == 0:
            raise ValueError(
                f"No valid EEG or ECG channels found. "
                f"Expected channels like: {', '.join(self.standard_channels[:10])}"
            )

        logger.info(f"Using {len(valid_channels)} channels: {valid_channels}")
        if ecg_channels:
            logger.info(f"Found {len(ecg_channels)} ECG channels: {ecg_channels}")

        # Extract timestamps and auto-detect unit by analyzing differences
        timestamps = df['timestamp'].values
        first_ts = timestamps[0]

        # Sample first 20 time differences to detect unit
        time_diffs_raw = np.diff(timestamps[:min(20, len(timestamps))])
        valid_diffs_raw = time_diffs_raw[time_diffs_raw > 0]

        if len(valid_diffs_raw) == 0:
            raise ValueError("Cannot determine sampling pattern from timestamps")

        median_raw_diff = np.median(valid_diffs_raw)

        # Determine scale based on typical sampling intervals
        if median_raw_diff < 0.1:
            # Very small differences, likely already in seconds
            time_scale = 1
            logger.info("Detected second timestamps")
        elif median_raw_diff < 100:
            # Small differences (0.1 to 100), likely milliseconds
            time_scale = 1_000
            logger.info("Detected millisecond timestamps")
        elif median_raw_diff < 100_000:
            # Medium differences, likely microseconds
            time_scale = 1_000_000
            logger.info("Detected microsecond timestamps")
        else:
            # Large differences
            time_scale = 1_000_000_000
            logger.info("Detected nanosecond timestamps")

        logger.info(f"First timestamp: {first_ts}, median diff: {median_raw_diff}, scale: 1/{time_scale}")

        timestamps_sec = timestamps / time_scale  # Convert to seconds

        # Calculate sampling rate from timestamps
        time_diffs = np.diff(timestamps_sec[:min(100, len(timestamps_sec))])
        valid_diffs = time_diffs[time_diffs > 0]

        if len(valid_diffs) == 0:
            raise ValueError("Cannot determine sampling rate from timestamps")

        median_diff = np.median(valid_diffs)
        sfreq = 1.0 / median_diff
        logger.info(f"Median time diff: {median_diff:.6f}s, sampling rate: {sfreq:.2f} Hz")

        # Extract channel data
        data = df[valid_channels].values.T  # Transpose to [channels, samples]

        # Handle missing values (forward fill, then backward fill, then zero)
        for i in range(data.shape[0]):
            channel_data = data[i, :]
            mask = np.isnan(channel_data)

            if np.any(mask):
                # Forward fill
                indices = np.arange(len(channel_data))
                valid_indices = indices[~mask]
                valid_values = channel_data[~mask]

                if len(valid_values) > 0:
                    channel_data[mask] = np.interp(
                        indices[mask], valid_indices, valid_values,
                        left=valid_values[0], right=valid_values[-1]
                    )
                else:
                    # All NaN, fill with zeros
                    channel_data[:] = 0.0

                data[i, :] = channel_data

        # Convert to volts (assuming data is in microvolts)
        # You may need to adjust this based on your data units
        data_volts = data * 1e-6  # Convert µV to V

        # Create MNE info structure with appropriate channel types
        info = mne.create_info(
            ch_names=valid_channels,
            sfreq=sfreq,
            ch_types=channel_types
        )

        # Create Raw object
        raw = mne.io.RawArray(data_volts, info, verbose=False)

        # Set montage for electrode positions (only for EEG channels)
        eeg_only_channels = [ch for ch, ch_type in zip(valid_channels, channel_types) if ch_type == 'eeg']
        if eeg_only_channels:
            montage = mne.channels.make_standard_montage('standard_1020')
            raw.set_montage(montage, on_missing='warn')

            # Set reference to average (only for EEG channels)
            raw.set_eeg_reference('average', projection=False)

        logger.info(
            f"Created MNE Raw object: {raw.info['sfreq']:.2f} Hz, "
            f"{len(raw.ch_names)} channels, {raw.times[-1]:.1f}s duration"
        )

        return raw, sfreq


def load_csv_as_raw(file_path: str) -> mne.io.Raw:
    """
    Load CSV file and return MNE Raw object

    Args:
        file_path: Path to CSV file

    Returns:
        MNE Raw object
    """
    reader = CSVReader()
    raw, _ = reader.read_csv(file_path)
    return raw


if __name__ == '__main__':
    import sys

    if len(sys.argv) < 2:
        print("Usage: python csv_reader.py <csv_file>")
        sys.exit(1)

    file_path = sys.argv[1]

    try:
        raw = load_csv_as_raw(file_path)
        print(f"Successfully loaded CSV file")
        print(f"Channels: {raw.ch_names}")
        print(f"Sampling rate: {raw.info['sfreq']} Hz")
        print(f"Duration: {raw.times[-1]:.2f} seconds")
    except Exception as e:
        logger.error(f"Failed to load CSV: {e}")
        sys.exit(1)
