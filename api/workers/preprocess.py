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
        ica_n_components: int = None,
        ica_method: str = 'sobi',
        rejection_threshold: Dict[str, float] = None,
        sobi_delta_threshold: float = 0.70,
        sobi_hf_threshold: float = 0.40,
        sobi_frontal_corr: float = 0.6,
    ):
        """
        Initialize preprocessor with configuration

        Args:
            resample_freq: Target sampling rate (Hz)
            filter_low: High-pass filter cutoff (Hz)
            filter_high: Low-pass filter cutoff (Hz)
            notch_freq: Notch filter frequency (Hz) - 60 for US, 50 for EU
            epoch_duration: Duration of epochs in seconds
            ica_n_components: Number of ICA components (None = use n_channels)
            ica_method: ICA algorithm - 'fastica', 'infomax', 'picard', or 'sobi'
            rejection_threshold: Amplitude thresholds for artifact rejection
            sobi_delta_threshold: SOBI delta-band power ratio threshold (0-1)
            sobi_hf_threshold: SOBI high-frequency power ratio threshold (0-1)
            sobi_frontal_corr: SOBI frontal channel correlation threshold (0-1)
        """
        self.resample_freq = resample_freq
        self.filter_low = filter_low
        self.filter_high = filter_high
        self.notch_freq = notch_freq
        self.epoch_duration = epoch_duration
        self.ica_n_components = ica_n_components  # None = auto (n_channels)
        self.ica_method = ica_method if ica_method in ('fastica', 'infomax', 'picard', 'sobi') else 'sobi'
        self.sobi_delta_threshold = sobi_delta_threshold
        self.sobi_hf_threshold = sobi_hf_threshold
        self.sobi_frontal_corr = sobi_frontal_corr

        # Default rejection thresholds (in μV)
        self.rejection_threshold = rejection_threshold or {
            'eeg': 150e-6,  # 150 μV
        }

        # Standard 10-20 channel names (base 19 channels)
        self.expected_channels_10_20 = [
            'Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8',
            'T7', 'C3', 'Cz', 'C4', 'T8',
            'P7', 'P3', 'Pz', 'P4', 'P8',
            'O1', 'O2'
        ]

        # Extended 10-10 channels (additional positions beyond 10-20)
        self.additional_10_10_channels = [
            # Midline
            'Fpz', 'AFz', 'FCz', 'CPz', 'POz', 'Oz', 'Iz',
            # Anterior frontal
            'AF3', 'AF4', 'AF7', 'AF8',
            # Frontocentral
            'FC1', 'FC2', 'FC3', 'FC4', 'FC5', 'FC6',
            # Frontotemporal
            'FT7', 'FT8', 'FT9', 'FT10',
            # Centroparietal
            'CP1', 'CP2', 'CP3', 'CP4', 'CP5', 'CP6',
            # Temporoparietal
            'TP7', 'TP8', 'TP9', 'TP10',
            # Parieto-occipital
            'PO3', 'PO4', 'PO7', 'PO8',
            # Ear references
            'A1', 'A2',
        ]

        # All valid EEG channels (combined)
        self.all_valid_channels = self.expected_channels_10_20 + self.additional_10_10_channels

        # Legacy: expected_channels for backward compatibility
        self.expected_channels = self.expected_channels_10_20

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
            # Load CSV file - csv_reader applies detrending (DC offset removal)
            # to match the mobile app's prefilteredEEG pipeline
            raw = load_csv_as_raw(file_path)
            logger.info(f"Loaded CSV data (detrended): {raw.info['sfreq']} Hz, {len(raw.ch_names)} channels, {raw.times[-1]:.1f}s duration")
            return raw
        elif ext_lower == '.edf':
            return self.load_edf(file_path)
        elif ext_lower == '.bdf':
            return self.load_bdf(file_path)
        else:
            raise ValueError(f"Unsupported file format: {ext}. Supported formats: .edf, .bdf, .csv")

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

    def load_bdf(self, file_path: str) -> mne.io.Raw:
        """
        Load BDF (BioSemi Data Format) file and prepare raw data.
        BioSemi files typically contain many non-EEG channels (EXG, Rail,
        Status, impedance, etc.) which are filtered out automatically.

        Args:
            file_path: Path to BDF file

        Returns:
            MNE Raw object
        """
        logger.info(f"Loading BDF file: {file_path}")

        # Load BDF file (24-bit format used by BioSemi systems)
        raw = mne.io.read_raw_bdf(file_path, preload=True, verbose=False)

        # Get channel names and normalize
        channel_names = raw.ch_names
        logger.info(f"Found {len(channel_names)} total channels: {channel_names}")

        # Standardize channel names
        raw = self._standardize_channel_names(raw)

        # Log which channels will be dropped (non-EEG: EXG, Rail, Status, etc.)
        non_eeg = [ch for ch in raw.ch_names if ch not in self.all_valid_channels]
        if non_eeg:
            logger.info(f"Dropping {len(non_eeg)} non-EEG channels: {non_eeg}")

        # Select only EEG channels (exclude non-EEG like EXG, Rail, Status, impedance)
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
        """Select only EEG channels that match 10-20 or 10-10 montage"""

        # First, find all valid EEG channels (both 10-20 and 10-10)
        available_channels = [ch for ch in raw.ch_names if ch in self.all_valid_channels]

        # Check if we have at least the base 10-20 channels
        base_channels_present = [ch for ch in raw.ch_names if ch in self.expected_channels_10_20]

        if len(base_channels_present) < 19:
            missing = set(self.expected_channels_10_20) - set(base_channels_present)
            logger.warning(f"Missing base 10-20 channels: {missing}")

        # Find additional 10-10 channels present
        additional_present = [ch for ch in raw.ch_names if ch in self.additional_10_10_channels]
        if additional_present:
            logger.info(f"Found {len(additional_present)} additional 10-10 channels: {additional_present}")

        logger.info(f"Selecting {len(available_channels)} EEG channels ({len(base_channels_present)} base + {len(additional_present)} extended)")
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
        Detect bad channels based on:
        1. Overall variance (broadband outliers)
        2. Low-frequency power (delta-band drift / electrode noise)

        Args:
            raw: Preprocessed Raw object

        Returns:
            List of bad channel names
        """
        logger.info("Detecting bad channels")

        data = raw.get_data()
        bad_channels = []
        seen = set()

        # --- Check 1: broadband variance outliers (3 SD) ---
        variances = np.var(data, axis=1)
        mean_var = np.mean(variances)
        std_var = np.std(variances)

        for i, ch_name in enumerate(raw.ch_names):
            if variances[i] > mean_var + 3 * std_var or variances[i] < mean_var - 3 * std_var:
                bad_channels.append(ch_name)
                seen.add(ch_name)
                logger.info(f"Bad channel (variance): {ch_name} (var={variances[i]:.2e}, mean={mean_var:.2e})")

        # --- Check 2: low-frequency power outliers ---
        # Channels with abnormally high delta-band power often have electrode
        # contact issues or slow drift that ICA can't fully remove.
        try:
            from scipy.signal import welch
            sfreq = raw.info['sfreq']
            delta_powers = []
            for i in range(data.shape[0]):
                freqs, psd = welch(data[i], fs=sfreq, nperseg=min(int(4 * sfreq), data.shape[1]))
                # Delta band: 0.5 - 4 Hz
                delta_mask = (freqs >= 0.5) & (freqs <= 4.0)
                delta_powers.append(np.mean(psd[delta_mask]))

            delta_powers = np.array(delta_powers)
            median_delta = np.median(delta_powers)

            for i, ch_name in enumerate(raw.ch_names):
                if ch_name in seen:
                    continue
                # Flag if delta power is > 5x the median (very aggressive drift)
                if delta_powers[i] > median_delta * 5:
                    bad_channels.append(ch_name)
                    seen.add(ch_name)
                    logger.info(f"Bad channel (delta power): {ch_name} (delta={delta_powers[i]:.2e}, median={median_delta:.2e}, ratio={delta_powers[i]/median_delta:.1f}x)")

        except Exception as e:
            logger.warning(f"Low-frequency bad channel check failed: {e}")

        return bad_channels

    def apply_ica(self, raw: mne.io.Raw, n_components: int = None) -> Tuple[mne.io.Raw, int, List[int]]:
        """
        Apply ICA for artifact removal (eye blinks, muscle artifacts)

        Args:
            raw: Preprocessed Raw object
            n_components: Number of ICA components (None = use n_channels)

        Returns:
            Tuple of (cleaned Raw object, number of components removed, list of excluded component indices)
        """
        n_channels = len(raw.ch_names)
        n_components = n_components or self.ica_n_components

        # If still None (no config override), default to n_channels
        if n_components is None:
            n_components = n_channels

        # ICA components cannot exceed the number of channels
        if n_components > n_channels:
            logger.info(f"Reducing ICA components from {n_components} to {n_channels} (number of channels)")
            n_components = n_channels

        # Need at least 2 components for ICA to be meaningful
        if n_components < 2:
            logger.warning(f"Too few channels ({n_channels}) for ICA, skipping artifact removal")
            return raw.copy(), 0, []

        method = self.ica_method
        logger.info(f"Running ICA: method={method}, n_components={n_components}")

        if method == 'sobi':
            return self._apply_sobi(raw, n_components)

        # Build ICA kwargs based on method
        fit_params = {}
        if method == 'infomax':
            # Extended Infomax handles both sub- and super-Gaussian sources,
            # which is better for separating slow drift from cortical signals
            fit_params = {'extended': True}

        ica = mne.preprocessing.ICA(
            n_components=n_components,
            random_state=42,
            max_iter='auto',
            method=method,
            fit_params=fit_params if fit_params else None,
        )

        ica.fit(raw, verbose=False)

        # Detect artifacts automatically
        # EOG artifacts (eye blinks/movements)
        eog_indices = []
        try:
            eog_indices, eog_scores = ica.find_bads_eog(raw, threshold=3.0, verbose=False)
            logger.info(f"Detected {len(eog_indices)} EOG artifact components: {eog_indices}")
        except RuntimeError as e:
            logger.warning(f"Skipping EOG detection: {e}")

        # Muscle artifacts (using high-frequency band)
        muscle_indices = []
        try:
            muscle_indices, muscle_scores = ica.find_bads_muscle(raw, threshold=0.8, verbose=False)
            logger.info(f"Detected {len(muscle_indices)} muscle artifact components: {muscle_indices}")
        except Exception as e:
            logger.warning(f"Skipping muscle artifact detection: {e}")

        # Combine all bad components
        bad_components = list(set(eog_indices + muscle_indices))
        ica.exclude = bad_components

        logger.info(f"Excluding {len(bad_components)} artifact components: {bad_components}")

        # Apply ICA to remove artifacts
        raw_clean = ica.apply(raw.copy(), verbose=False)

        return raw_clean, len(bad_components), bad_components

    def _apply_sobi(
        self,
        raw: mne.io.Raw,
        n_components: int
    ) -> Tuple[mne.io.Raw, int, List[int]]:
        """
        Apply SOBI (Second Order Blind Identification) using coroICA.

        SOBI uses time-lagged covariance matrices (second-order statistics) rather than
        higher-order statistics, making it particularly effective for separating sources
        with distinct temporal autocorrelation patterns — e.g., slow electrode drift
        vs. cortical rhythms vs. fast muscle noise.
        """
        from coroica import UwedgeICA
        from scipy.signal import welch

        sfreq = raw.info['sfreq']
        picks = mne.pick_types(raw.info, eeg=True)
        data = raw.get_data(picks=picks)  # (n_channels, n_samples)

        # Configure SOBI: partition size = 2 seconds, time lags up to 50 samples
        sobi = UwedgeICA(
            n_components=min(n_components, data.shape[0]),
            partitionsize=int(sfreq * 2),
            timelags=list(range(1, min(51, int(sfreq // 5)))),
        )
        sobi.fit(data.T)

        W = sobi.V_       # unmixing matrix: sources = data.T @ W.T
        A = np.linalg.pinv(W)  # mixing matrix

        sources = (data.T @ W.T)  # (n_samples, n_components)
        n_comp = sources.shape[1]

        # Artifact detection for SOBI components:
        # 1. Low-frequency dominance (slow drift / electrode pop)
        # 2. High-frequency dominance (muscle)
        # 3. Correlation with frontal channels (eye blinks)
        bad_components = []

        for ci in range(n_comp):
            comp = sources[:, ci]
            freqs, psd = welch(comp, fs=sfreq, nperseg=min(int(4 * sfreq), len(comp)))

            total_power = np.sum(psd)
            if total_power == 0:
                continue

            # Delta band (0.5-4 Hz) ratio
            delta_mask = (freqs >= 0.5) & (freqs <= 4.0)
            delta_ratio = np.sum(psd[delta_mask]) / total_power
            if delta_ratio > self.sobi_delta_threshold:
                bad_components.append(ci)
                logger.info(f"SOBI component {ci}: delta ratio {delta_ratio:.2f} > {self.sobi_delta_threshold} — flagged as slow drift")
                continue

            # High-frequency (30-45 Hz) ratio
            hf_mask = (freqs >= 30) & (freqs <= 45)
            hf_ratio = np.sum(psd[hf_mask]) / total_power
            if hf_ratio > self.sobi_hf_threshold:
                bad_components.append(ci)
                logger.info(f"SOBI component {ci}: HF ratio {hf_ratio:.2f} > {self.sobi_hf_threshold} — flagged as muscle")
                continue

        # Also check correlation with frontal channels for eye blinks
        frontal_names = {'fp1', 'fp2', 'fpz', 'af3', 'af4'}
        frontal_indices = [
            i for i, ch in enumerate(raw.ch_names)
            if ch.lower().replace('eeg ', '').replace('-le', '').replace('-ref', '').split('-')[0].strip() in frontal_names
            and i in picks
        ]

        if frontal_indices:
            frontal_data = data[frontal_indices].mean(axis=0)  # average frontal
            for ci in range(n_comp):
                if ci in bad_components:
                    continue
                corr = np.abs(np.corrcoef(sources[:, ci], frontal_data)[0, 1])
                if corr > self.sobi_frontal_corr:
                    bad_components.append(ci)
                    logger.info(f"SOBI component {ci}: frontal correlation {corr:.2f} > {self.sobi_frontal_corr} — flagged as EOG")

        bad_components = sorted(set(bad_components))
        logger.info(f"SOBI: excluding {len(bad_components)} artifact components: {bad_components}")

        # Zero out bad components and reconstruct
        sources_cleaned = sources.copy()
        sources_cleaned[:, bad_components] = 0
        data_cleaned = sources_cleaned @ A.T  # (n_samples, n_channels)

        # Put cleaned data back into raw
        raw_clean = raw.copy()
        raw_clean._data[picks] = data_cleaned.T

        return raw_clean, len(bad_components), bad_components

    def create_epochs(
        self,
        raw: mne.io.Raw,
        segment_start: float,
        segment_end: float,
        segment_name: str = 'segment',
        reject: bool = True
    ) -> Tuple[mne.Epochs, List[Dict]]:
        """
        Create epochs from a time segment

        Args:
            raw: Preprocessed Raw object
            segment_start: Start time in seconds
            segment_end: End time in seconds
            segment_name: Name for the segment (e.g., 'EO', 'EC')
            reject: Whether to apply amplitude-based rejection threshold.
                    Set to False for manual artifact mode (BAD annotations
                    are still respected by MNE automatically).

        Returns:
            Tuple of (MNE Epochs object, list of rejected epoch dicts)
            Each rejected epoch dict has: {start, end, reason, condition}
        """
        # Clamp segment_end to actual recording duration to avoid rounding errors
        max_time = raw.times[-1]
        segment_end_clamped = min(segment_end, max_time)

        logger.info(f"Creating {segment_name} epochs from {segment_start}s to {segment_end_clamped}s (reject={reject})")

        # Crop to segment
        raw_segment = raw.copy().crop(tmin=segment_start, tmax=segment_end_clamped)

        # Create fixed-length events
        events = mne.make_fixed_length_events(
            raw_segment,
            duration=self.epoch_duration,
            overlap=0.0
        )

        # Create epochs
        # When reject=False (manual mode), MNE still respects BAD annotations
        # and will drop epochs overlapping with BAD-annotated segments
        rejection = self.rejection_threshold if reject else None
        epochs = mne.Epochs(
            raw_segment,
            events,
            tmin=0,
            tmax=self.epoch_duration,
            baseline=None,
            preload=True,
            reject=rejection,
            verbose=False
        )

        # Collect rejected epoch time ranges (in original recording time)
        rejected_epochs = []
        sfreq = raw_segment.info['sfreq']
        for idx, log_entry in enumerate(epochs.drop_log):
            if len(log_entry) > 0:
                # This epoch was dropped; compute its time range in the
                # original recording coordinate system
                epoch_onset_sample = events[idx, 0]
                epoch_start_local = epoch_onset_sample / sfreq
                epoch_end_local = epoch_start_local + self.epoch_duration
                rejected_epochs.append({
                    'start': round(segment_start + epoch_start_local, 3),
                    'end': round(segment_start + epoch_end_local, 3),
                    'reason': ', '.join(log_entry),
                    'condition': segment_name,
                })

        n_dropped = len(rejected_epochs)
        logger.info(f"Created {len(epochs)} epochs ({n_dropped} dropped)")

        return epochs, rejected_epochs

    def get_qc_metrics(
        self,
        raw_original: mne.io.Raw,
        raw_clean: mne.io.Raw,
        bad_channels: List[str],
        ica_components_removed: int,
        epochs_eo: mne.Epochs = None,
        epochs_ec: mne.Epochs = None,
        ica_excluded_indices: List[int] = None,
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
        # NOTE: len(epochs.drop_log) = total epochs attempted (kept + dropped)
        #       len(epochs) = kept epochs only
        #       dropped = total - kept
        if epochs_eo is not None:
            eo_total = len(epochs_eo.drop_log)
            final_epochs_eo = len(epochs_eo)
            eo_dropped = eo_total - final_epochs_eo
            eo_rejection_rate = (eo_dropped / eo_total * 100) if eo_total > 0 else 0
        else:
            eo_dropped = 0
            eo_total = 0
            eo_rejection_rate = 0.0
            final_epochs_eo = 0

        # Calculate rejection rates for EC
        if epochs_ec is not None:
            ec_total = len(epochs_ec.drop_log)
            final_epochs_ec = len(epochs_ec)
            ec_dropped = ec_total - final_epochs_ec
            ec_rejection_rate = (ec_dropped / ec_total * 100) if ec_total > 0 else 0
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
            'ica_method': self.ica_method,
            'ica_excluded_components': ica_excluded_indices or [],
            'sobi_delta_threshold': self.sobi_delta_threshold if self.ica_method == 'sobi' else None,
            'sobi_hf_threshold': self.sobi_hf_threshold if self.ica_method == 'sobi' else None,
            'sobi_frontal_corr': self.sobi_frontal_corr if self.ica_method == 'sobi' else None,
            'final_epochs_eo': final_epochs_eo,
            'final_epochs_ec': final_epochs_ec,
            'eo_rejection_rate': round(eo_rejection_rate, 2),
            'ec_rejection_rate': round(ec_rejection_rate, 2),
            'original_sfreq': raw_original.info['sfreq'],
            'final_sfreq': raw_clean.info['sfreq'],
            'n_channels': len(raw_clean.ch_names),
        }

        return qc_metrics


def _annotate_manual_artifacts(raw: mne.io.Raw, manual_epochs: list) -> None:
    """
    Mark manual artifact epochs as BAD annotations in MNE Raw object.
    MNE will automatically exclude these segments when creating epochs.

    Args:
        raw: MNE Raw object to annotate
        manual_epochs: List of dicts with 'start' and 'end' keys (seconds)
    """
    if not manual_epochs:
        return

    onsets = []
    durations = []
    descriptions = []

    for epoch in manual_epochs:
        start = float(epoch['start'])
        end = float(epoch['end'])
        duration = end - start
        if duration > 0:
            onsets.append(start)
            durations.append(duration)
            descriptions.append('BAD_manual')

    if onsets:
        annotations = mne.Annotations(
            onset=onsets,
            duration=durations,
            description=descriptions,
            orig_time=raw.annotations.orig_time
        )
        raw.set_annotations(raw.annotations + annotations)
        logger.info(f"Annotated {len(onsets)} manual artifact segments as BAD")


def preprocess_eeg(
    file_path: str,
    eo_start: float,
    eo_end: float,
    ec_start: float,
    ec_end: float,
    config: Dict = None,
    artifact_mode: str = 'ica',
    manual_artifact_epochs: list = None
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
        artifact_mode: 'ica' for automatic ICA artifact removal,
                       'manual' for user-marked artifact epochs only
        manual_artifact_epochs: List of {'start': float, 'end': float} for manual mode

    Returns:
        Dictionary containing preprocessed epochs and QC metrics
    """
    # Initialize preprocessor with config
    # Filter out keys that EEGPreprocessor doesn't accept
    config = config or {}
    IGNORED_CONFIG_KEYS = {'artifact_mode'}
    # Only pass kwargs that EEGPreprocessor.__init__ actually accepts
    VALID_KEYS = {
        'resample_freq', 'filter_low', 'filter_high', 'notch_freq',
        'epoch_duration', 'ica_n_components', 'ica_method', 'rejection_threshold',
        'sobi_delta_threshold', 'sobi_hf_threshold', 'sobi_frontal_corr',
    }
    preprocessor_kwargs = {k: v for k, v in config.items()
                          if k in VALID_KEYS}
    preprocessor = EEGPreprocessor(**preprocessor_kwargs)

    # Load data (auto-detects EDF, BDF, or CSV)
    raw_original = preprocessor.load_file(file_path)

    # Preprocess (filtering, resampling)
    raw = preprocessor.preprocess(raw_original.copy())

    # Detect bad channels (broadband variance + low-frequency power)
    bad_channels = preprocessor.detect_bad_channels(raw)
    if bad_channels:
        logger.info(f"Interpolating {len(bad_channels)} bad channels")
        raw.info['bads'] = bad_channels
        raw.interpolate_bads(reset_bads=True)

    ica_excluded_indices = []
    if artifact_mode == 'manual':
        # MANUAL MODE: Skip ICA, use user-marked artifact segments
        logger.info("Manual artifact mode: skipping ICA")
        raw_clean = raw.copy()
        ica_components = 0

        # Mark manual artifact epochs as BAD annotations
        _annotate_manual_artifacts(raw_clean, manual_artifact_epochs or [])
    else:
        # ICA MODE: Automatic artifact removal (default)
        logger.info(f"ICA artifact mode ({preprocessor.ica_method}): running automatic artifact removal")
        raw_clean, ica_components, ica_excluded_indices = preprocessor.apply_ica(raw)

    # Create epochs only for conditions that have data
    # In manual mode, skip amplitude-based rejection (user controls artifacts)
    use_reject = artifact_mode != 'manual'
    epochs_eo = None
    epochs_ec = None
    all_rejected_epochs = []

    if eo_start is not None and eo_end is not None:
        logger.info(f"Creating EO epochs from {eo_start}s to {eo_end}s")
        epochs_eo, rejected_eo = preprocessor.create_epochs(
            raw_clean, eo_start, eo_end, 'EO', reject=use_reject
        )
        all_rejected_epochs.extend(rejected_eo)
    else:
        logger.info("Skipping EO epochs (no EO segment defined)")

    if ec_start is not None and ec_end is not None:
        logger.info(f"Creating EC epochs from {ec_start}s to {ec_end}s")
        epochs_ec, rejected_ec = preprocessor.create_epochs(
            raw_clean, ec_start, ec_end, 'EC', reject=use_reject
        )
        all_rejected_epochs.extend(rejected_ec)
    else:
        logger.info("Skipping EC epochs (no EC segment defined)")

    # Get QC metrics
    qc_metrics = preprocessor.get_qc_metrics(
        raw_original,
        raw_clean,
        bad_channels,
        ica_components,
        epochs_eo,
        epochs_ec,
        ica_excluded_indices=ica_excluded_indices,
    )
    qc_metrics['artifact_mode'] = artifact_mode
    if artifact_mode == 'manual':
        qc_metrics['manual_artifact_epochs_count'] = len(manual_artifact_epochs or [])

    return {
        'epochs_eo': epochs_eo,
        'epochs_ec': epochs_ec,
        'raw_clean': raw_clean,
        'qc_metrics': qc_metrics,
        'rejected_epochs': all_rejected_epochs,
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
