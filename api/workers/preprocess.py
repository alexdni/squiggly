#!/usr/bin/env python3
"""
EEG Preprocessing Module

Handles preprocessing of EDF and CSV files using MNE-Python:
- Loading and resampling
- Filtering (bandpass and notch)
- Artifact rejection
- ICA for artifact removal
- Epoching based on EO/EC segments
"""

import numpy as np
import mne
from typing import Dict, List, Tuple, Optional
import logging
import os
from csv_reader import load_csv_as_raw

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class EEGPreprocessor:
    """Preprocess EEG data from EDF files"""

    def __init__(
        self,
        resample_freq: int = 250,
        filter_low: float = 0.5,
        filter_high: float = 45.0,
        notch_freq: float = 60.0,
        epoch_duration: float = 2.0,
        ica_n_components: int = 15,
        rejection_threshold: Dict[str, float] = None
    ):
        """
        Initialize preprocessor with configuration

        Args:
            resample_freq: Target sampling rate (Hz)
            filter_low: High-pass filter cutoff (Hz)
            filter_high: Low-pass filter cutoff (Hz)
            notch_freq: Notch filter frequency (Hz) - 60 for US, 50 for EU
            epoch_duration: Duration of epochs in seconds
            ica_n_components: Number of ICA components to compute
            rejection_threshold: Amplitude thresholds for artifact rejection
        """
        self.resample_freq = resample_freq
        self.filter_low = filter_low
        self.filter_high = filter_high
        self.notch_freq = notch_freq
        self.epoch_duration = epoch_duration
        self.ica_n_components = ica_n_components

        # Default rejection thresholds (in μV)
        self.rejection_threshold = rejection_threshold or {
            'eeg': 150e-6,  # 150 μV
        }

        # Standard 10-20 channel names
        self.expected_channels = [
            'Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8',
            'T7', 'C3', 'Cz', 'C4', 'T8',
            'P7', 'P3', 'Pz', 'P4', 'P8',
            'O1', 'O2'
        ]

    def load_file(self, file_path: str) -> mne.io.Raw:
        """
        Load EDF or CSV file and prepare raw data

        Args:
            file_path: Path to EDF or CSV file

        Returns:
            MNE Raw object
        """
        # Detect file type from extension
        _, ext = os.path.splitext(file_path)
        ext_lower = ext.lower()

        if ext_lower == '.csv':
            logger.info(f"Loading CSV file: {file_path}")
            # Load CSV file (already preprocessed by csv_reader)
            raw = load_csv_as_raw(file_path)
            logger.info(f"Loaded CSV data: {raw.info['sfreq']} Hz, {len(raw.ch_names)} channels, {raw.times[-1]:.1f}s duration")
            return raw
        elif ext_lower == '.edf':
            return self.load_edf(file_path)
        else:
            raise ValueError(f"Unsupported file format: {ext}. Supported formats: .edf, .csv")

    def load_edf(self, file_path: str) -> mne.io.Raw:
        """
        Load EDF file and prepare raw data

        Args:
            file_path: Path to EDF file

        Returns:
            MNE Raw object
        """
        logger.info(f"Loading EDF file: {file_path}")

        # Load EDF file
        raw = mne.io.read_raw_edf(file_path, preload=True, verbose=False)

        # Get channel names and normalize
        channel_names = raw.ch_names
        logger.info(f"Found {len(channel_names)} channels: {channel_names}")

        # Standardize channel names
        raw = self._standardize_channel_names(raw)

        # Select only EEG channels (exclude non-EEG like EOG, ECG)
        raw = self._select_eeg_channels(raw)

        # Set montage for electrode positions
        montage = mne.channels.make_standard_montage('standard_1020')
        raw.set_montage(montage, on_missing='warn')

        # Set reference to average
        raw.set_eeg_reference('average', projection=False)

        logger.info(f"Loaded raw data: {raw.info['sfreq']} Hz, {len(raw.ch_names)} channels, {raw.times[-1]:.1f}s duration")

        return raw

    def _standardize_channel_names(self, raw: mne.io.Raw) -> mne.io.Raw:
        """Standardize channel names to match 10-20 convention"""

        # Common aliases
        channel_aliases = {
            'FP1': 'Fp1', 'FP2': 'Fp2',
            'T3': 'T7', 'T4': 'T8', 'T5': 'P7', 'T6': 'P8',
            'M1': 'A1', 'M2': 'A2',
            'TP9': 'A1', 'TP10': 'A2'
        }

        # Remove common prefixes and suffixes
        mapping = {}
        for ch_name in raw.ch_names:
            # Strip whitespace
            clean_name = ch_name.strip()

            # Remove common prefixes
            for prefix in ['EEG ', 'ECG ', 'EMG ', 'EOG ']:
                if clean_name.startswith(prefix):
                    clean_name = clean_name[len(prefix):]

            # Remove reference suffixes
            for suffix in ['-LE', '-REF', '-AVG', '-A1', '-A2', '-CZ', '-M1', '-M2']:
                if clean_name.endswith(suffix):
                    clean_name = clean_name[:clean_name.index(suffix)]

            # Apply aliases
            if clean_name in channel_aliases:
                clean_name = channel_aliases[clean_name]

            if clean_name != ch_name:
                mapping[ch_name] = clean_name

        if mapping:
            logger.info(f"Renaming channels: {mapping}")
            raw.rename_channels(mapping)

        return raw

    def _select_eeg_channels(self, raw: mne.io.Raw) -> mne.io.Raw:
        """Select only EEG channels that match 10-20 montage"""

        available_channels = [ch for ch in raw.ch_names if ch in self.expected_channels]

        if len(available_channels) < 19:
            missing = set(self.expected_channels) - set(available_channels)
            logger.warning(f"Missing channels: {missing}")

        logger.info(f"Selecting {len(available_channels)} EEG channels")
        raw.pick_channels(available_channels)

        return raw

    def preprocess(self, raw: mne.io.Raw) -> mne.io.Raw:
        """
        Apply preprocessing pipeline

        Args:
            raw: MNE Raw object

        Returns:
            Preprocessed Raw object
        """
        logger.info("Starting preprocessing pipeline")

        # 1. Resample if needed
        if raw.info['sfreq'] != self.resample_freq:
            logger.info(f"Resampling from {raw.info['sfreq']} Hz to {self.resample_freq} Hz")
            raw.resample(self.resample_freq)

        # 2. Apply bandpass filter
        logger.info(f"Applying bandpass filter: {self.filter_low}-{self.filter_high} Hz")
        raw.filter(
            l_freq=self.filter_low,
            h_freq=self.filter_high,
            fir_design='firwin',
            verbose=False
        )

        # 3. Apply notch filter (remove power line noise)
        logger.info(f"Applying notch filter at {self.notch_freq} Hz")
        raw.notch_filter(
            freqs=self.notch_freq,
            notch_widths=2,
            verbose=False
        )

        logger.info("Preprocessing complete")
        return raw

    def detect_bad_channels(self, raw: mne.io.Raw) -> List[str]:
        """
        Detect bad channels based on variance and correlation

        Args:
            raw: Preprocessed Raw object

        Returns:
            List of bad channel names
        """
        logger.info("Detecting bad channels")

        # Get data
        data = raw.get_data()

        # Calculate channel-wise variance
        variances = np.var(data, axis=1)
        mean_var = np.mean(variances)
        std_var = np.std(variances)

        # Channels with unusually high or low variance
        bad_channels = []
        for i, ch_name in enumerate(raw.ch_names):
            if variances[i] > mean_var + 3 * std_var or variances[i] < mean_var - 3 * std_var:
                bad_channels.append(ch_name)
                logger.info(f"Bad channel detected: {ch_name} (variance: {variances[i]:.2e})")

        return bad_channels

    def apply_ica(self, raw: mne.io.Raw, n_components: int = None) -> Tuple[mne.io.Raw, int]:
        """
        Apply ICA for artifact removal (eye blinks, muscle artifacts)

        Args:
            raw: Preprocessed Raw object
            n_components: Number of ICA components (defaults to self.ica_n_components)

        Returns:
            Tuple of (cleaned Raw object, number of components removed)
        """
        n_components = n_components or self.ica_n_components

        logger.info(f"Running ICA with {n_components} components")

        # Fit ICA
        ica = mne.preprocessing.ICA(
            n_components=n_components,
            random_state=42,
            max_iter='auto',
            method='fastica'
        )

        ica.fit(raw, verbose=False)

        # Detect artifacts automatically
        # EOG artifacts (eye blinks/movements) - skip if no EOG channels
        eog_indices = []
        try:
            eog_indices, eog_scores = ica.find_bads_eog(raw, threshold=3.0, verbose=False)
            logger.info(f"Detected {len(eog_indices)} EOG artifact components")
        except RuntimeError as e:
            logger.warning(f"Skipping EOG detection: {e}")

        # Muscle artifacts (using high-frequency band)
        muscle_indices = []
        try:
            muscle_indices, muscle_scores = ica.find_bads_muscle(raw, threshold=0.8, verbose=False)
            logger.info(f"Detected {len(muscle_indices)} muscle artifact components")
        except Exception as e:
            logger.warning(f"Skipping muscle artifact detection: {e}")

        # Combine all bad components
        bad_components = list(set(eog_indices + muscle_indices))
        ica.exclude = bad_components

        logger.info(f"Identified {len(bad_components)} total artifact components: {bad_components}")

        # Apply ICA to remove artifacts
        raw_clean = ica.apply(raw.copy(), verbose=False)

        return raw_clean, len(bad_components)

    def create_epochs(
        self,
        raw: mne.io.Raw,
        segment_start: float,
        segment_end: float,
        segment_name: str = 'segment'
    ) -> mne.Epochs:
        """
        Create epochs from a time segment

        Args:
            raw: Preprocessed Raw object
            segment_start: Start time in seconds
            segment_end: End time in seconds
            segment_name: Name for the segment (e.g., 'EO', 'EC')

        Returns:
            MNE Epochs object
        """
        # Clamp segment_end to actual recording duration to avoid rounding errors
        max_time = raw.times[-1]
        segment_end_clamped = min(segment_end, max_time)

        logger.info(f"Creating {segment_name} epochs from {segment_start}s to {segment_end_clamped}s")

        # Crop to segment
        raw_segment = raw.copy().crop(tmin=segment_start, tmax=segment_end_clamped)

        # Create fixed-length events
        events = mne.make_fixed_length_events(
            raw_segment,
            duration=self.epoch_duration,
            overlap=0.0
        )

        # Create epochs
        epochs = mne.Epochs(
            raw_segment,
            events,
            tmin=0,
            tmax=self.epoch_duration,
            baseline=None,
            preload=True,
            reject=self.rejection_threshold,
            verbose=False
        )

        logger.info(f"Created {len(epochs)} epochs ({len(epochs.drop_log)} dropped due to artifacts)")

        return epochs

    def get_qc_metrics(
        self,
        raw_original: mne.io.Raw,
        raw_clean: mne.io.Raw,
        bad_channels: List[str],
        ica_components_removed: int,
        epochs_eo: mne.Epochs = None,
        epochs_ec: mne.Epochs = None
    ) -> Dict:
        """
        Generate quality control metrics

        Args:
            raw_original: Original raw data
            raw_clean: Cleaned raw data
            bad_channels: List of bad channels
            ica_components_removed: Number of ICA components removed
            epochs_eo: Eyes open epochs (optional)
            epochs_ec: Eyes closed epochs (optional)

        Returns:
            Dictionary of QC metrics
        """
        # Calculate rejection rates for EO
        if epochs_eo is not None:
            eo_dropped = len(epochs_eo.drop_log)
            eo_total = len(epochs_eo) + eo_dropped
            eo_rejection_rate = (eo_dropped / eo_total * 100) if eo_total > 0 else 0
            final_epochs_eo = len(epochs_eo)
        else:
            eo_dropped = 0
            eo_total = 0
            eo_rejection_rate = 0.0
            final_epochs_eo = 0

        # Calculate rejection rates for EC
        if epochs_ec is not None:
            ec_dropped = len(epochs_ec.drop_log)
            ec_total = len(epochs_ec) + ec_dropped
            ec_rejection_rate = (ec_dropped / ec_total * 100) if ec_total > 0 else 0
            final_epochs_ec = len(epochs_ec)
        else:
            ec_dropped = 0
            ec_total = 0
            ec_rejection_rate = 0.0
            final_epochs_ec = 0

        overall_rejection_rate = ((eo_dropped + ec_dropped) / (eo_total + ec_total) * 100) if (eo_total + ec_total) > 0 else 0

        qc_metrics = {
            'artifact_rejection_rate': round(overall_rejection_rate, 2),
            'bad_channels': bad_channels,
            'ica_components_removed': ica_components_removed,
            'final_epochs_eo': final_epochs_eo,
            'final_epochs_ec': final_epochs_ec,
            'eo_rejection_rate': round(eo_rejection_rate, 2),
            'ec_rejection_rate': round(ec_rejection_rate, 2),
            'original_sfreq': raw_original.info['sfreq'],
            'final_sfreq': raw_clean.info['sfreq'],
            'n_channels': len(raw_clean.ch_names),
        }

        return qc_metrics


def preprocess_eeg(
    file_path: str,
    eo_start: float,
    eo_end: float,
    ec_start: float,
    ec_end: float,
    config: Dict = None
) -> Dict:
    """
    Main preprocessing function

    Args:
        file_path: Path to EDF file
        eo_start: Eyes open segment start (seconds)
        eo_end: Eyes open segment end (seconds)
        ec_start: Eyes closed segment start (seconds)
        ec_end: Eyes closed segment end (seconds)
        config: Preprocessing configuration dict

    Returns:
        Dictionary containing preprocessed epochs and QC metrics
    """
    # Initialize preprocessor with config
    config = config or {}
    preprocessor = EEGPreprocessor(**config)

    # Load data (auto-detects EDF or CSV)
    raw_original = preprocessor.load_file(file_path)

    # Preprocess
    raw = preprocessor.preprocess(raw_original.copy())

    # Detect bad channels
    bad_channels = preprocessor.detect_bad_channels(raw)
    if bad_channels:
        logger.info(f"Interpolating {len(bad_channels)} bad channels")
        raw.info['bads'] = bad_channels
        raw.interpolate_bads(reset_bads=True)

    # Apply ICA
    raw_clean, ica_components = preprocessor.apply_ica(raw)

    # Create epochs only for conditions that have data
    epochs_eo = None
    epochs_ec = None

    if eo_start is not None and eo_end is not None:
        logger.info(f"Creating EO epochs from {eo_start}s to {eo_end}s")
        epochs_eo = preprocessor.create_epochs(raw_clean, eo_start, eo_end, 'EO')
    else:
        logger.info("Skipping EO epochs (no EO segment defined)")

    if ec_start is not None and ec_end is not None:
        logger.info(f"Creating EC epochs from {ec_start}s to {ec_end}s")
        epochs_ec = preprocessor.create_epochs(raw_clean, ec_start, ec_end, 'EC')
    else:
        logger.info("Skipping EC epochs (no EC segment defined)")

    # Get QC metrics
    qc_metrics = preprocessor.get_qc_metrics(
        raw_original,
        raw_clean,
        bad_channels,
        ica_components,
        epochs_eo,
        epochs_ec
    )

    return {
        'epochs_eo': epochs_eo,
        'epochs_ec': epochs_ec,
        'raw_clean': raw_clean,
        'qc_metrics': qc_metrics
    }


if __name__ == '__main__':
    import sys
    import json

    if len(sys.argv) < 6:
        print("Usage: python preprocess.py <edf_file> <eo_start> <eo_end> <ec_start> <ec_end>")
        sys.exit(1)

    file_path = sys.argv[1]
    eo_start = float(sys.argv[2])
    eo_end = float(sys.argv[3])
    ec_start = float(sys.argv[4])
    ec_end = float(sys.argv[5])

    try:
        result = preprocess_eeg(file_path, eo_start, eo_end, ec_start, ec_end)
        print(json.dumps(result['qc_metrics'], indent=2))
    except Exception as e:
        logger.error(f"Preprocessing failed: {e}")
        sys.exit(1)
