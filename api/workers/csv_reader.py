#!/usr/bin/env python3
"""
CSV Reader Module for EEG Data

Handles reading and converting CSV files with EEG data to MNE Raw format
for compatibility with existing preprocessing pipeline.

This module is designed specifically for Divergence/Flex device recordings
which require detrending (DC offset removal) as the raw device data contains
significant baseline drift that must be removed before filtering.

The signal processing matches the mobile app's prefilteredEEG pipeline:
1. Detrend (subtract mean from each channel)
2. Downstream filtering is handled by the preprocessing pipeline
"""

import numpy as np
import pandas as pd
import mne
from scipy import signal as scipy_signal
from typing import Tuple, List
import logging
from montage_registry import get_all_known_eeg_channels, get_montage_channels

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class CSVReader:
    """Read CSV files containing EEG data and convert to MNE Raw format"""

    def __init__(self):
        """Initialize CSV reader"""
        # Canonical EEG channel names are shared with TypeScript validators.
        self.standard_channels = get_montage_channels('10-20-21')
        self.additional_channels = [
            ch for ch in get_montage_channels('10-10-extended')
            if ch not in self.standard_channels
        ]
        self.acticap_64_channels = get_montage_channels('brainproducts-acticap-64')
        self.all_eeg_channels = get_all_known_eeg_channels()

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

    @staticmethod
    def timestamps_to_numeric(series: pd.Series) -> np.ndarray:
        """
        Return the timestamp column as float64.

        Numeric columns (epoch s/ms/us/ns or a relative counter) pass through
        untouched; the unit is auto-detected downstream from the deltas.
        String columns are parsed as ISO 8601 (e.g. "2026-06-24T22:13:59.340Z",
        TheraQ / Divergence exports) and converted to epoch milliseconds so the
        same delta-based detection treats them like any millisecond column.
        Mirrors lib/csv-timestamp.ts on the frontend.
        """
        if pd.api.types.is_numeric_dtype(series):
            return series.to_numpy(dtype=np.float64)

        parsed = pd.to_datetime(series, utc=True, errors='coerce', format='ISO8601')
        n_bad = int(parsed.isna().sum())
        if n_bad == len(parsed):
            raise ValueError(
                "Timestamp column must be numeric or ISO 8601 dates; "
                f"first value was {series.iloc[0]!r}"
            )
        if n_bad:
            raise ValueError(f"{n_bad} rows have unparseable ISO 8601 timestamps")

        logger.info("Parsed ISO 8601 timestamp column to epoch milliseconds")
        epoch_ms = (parsed - pd.Timestamp(0, tz='UTC')) / pd.Timedelta(milliseconds=1)
        return epoch_ms.to_numpy(dtype=np.float64)

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
            raise ValueError("CSV file must have a 'timestamp' column")

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

        # Extract timestamps (numeric or ISO 8601) and auto-detect unit by
        # analyzing differences
        timestamps = self.timestamps_to_numeric(df['timestamp'])
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

        # Detrend each channel (remove DC offset / mean)
        # This matches the mobile app's prefilteredEEG pipeline which applies
        # detrending as the first step before any filtering.
        # Critical for Divergence/Flex device data which has significant baseline drift.
        logger.info("Applying detrending (DC offset removal) to all channels")
        for i in range(data.shape[0]):
            # Use scipy.signal.detrend with type='linear' to remove both DC offset and linear drift
            # This is more robust than 'constant' for signals with slow drift
            data[i, :] = scipy_signal.detrend(data[i, :], type='linear')

        # Convert to volts
        # Divergence/Flex CSV data is already in microvolts (after the mobile app's
        # 1e6 multiplication). We just need to convert µV to V.
        data_volts = data * 1e-6  # µV -> V

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
