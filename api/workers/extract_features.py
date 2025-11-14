#!/usr/bin/env python3
"""
EEG Feature Extraction Module

Extracts neurological features from preprocessed EEG epochs:
- Band power (absolute and relative) for all channels
- Band ratios (theta/beta, alpha/theta)
- Hemispheric asymmetry indices
- Coherence analysis (interhemispheric and long-range)
- Complexity measures
- Risk pattern detection
"""

import numpy as np
import mne
from scipy import signal
from typing import Dict, List, Tuple
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Frequency bands (Hz)
BANDS = {
    'delta': (1, 4),
    'theta': (4, 8),
    'alpha1': (8, 10),
    'alpha2': (10, 12),
    'smr': (12, 15),
    'beta2': (15, 20),
    'hibeta': (20, 30),
    'lowgamma': (30, 45),
}

# Channel groups for region-specific analysis
CHANNEL_GROUPS = {
    'frontal': ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8'],
    'central': ['C3', 'Cz', 'C4'],
    'temporal': ['T7', 'T8'],
    'parietal': ['P7', 'P3', 'Pz', 'P4', 'P8'],
    'occipital': ['O1', 'O2'],
    'left': ['Fp1', 'F7', 'F3', 'T7', 'C3', 'P7', 'P3', 'O1'],
    'right': ['Fp2', 'F8', 'F4', 'T8', 'C4', 'P8', 'P4', 'O2'],
}

# Interhemispheric pairs for asymmetry
ASYMMETRY_PAIRS = {
    'frontal_alpha': ('F3', 'F4'),
    'parietal_alpha': ('P3', 'P4'),
    'frontal_theta': ('F3', 'F4'),
}


class FeatureExtractor:
    """Extract features from preprocessed EEG epochs"""

    def __init__(self, sfreq: float):
        """
        Initialize feature extractor

        Args:
            sfreq: Sampling frequency in Hz
        """
        self.sfreq = sfreq

    def compute_band_power(self, epochs: mne.Epochs) -> Dict[str, Dict[str, Dict[str, float]]]:
        """
        Compute absolute and relative band power for all channels

        Args:
            epochs: MNE Epochs object

        Returns:
            Dictionary: {channel: {band: {'absolute': val, 'relative': val}}}
        """
        logger.info("Computing band power")

        data = epochs.get_data()  # Shape: (n_epochs, n_channels, n_times)
        n_epochs, n_channels, n_times = data.shape

        # Compute PSD using Welch's method
        freqs, psd = signal.welch(
            data,
            fs=self.sfreq,
            nperseg=int(2 * self.sfreq),  # 2-second windows
            axis=-1
        )

        # Average across epochs
        psd_mean = np.mean(psd, axis=0)  # Shape: (n_channels, n_freqs)

        # Extract band power for each channel
        band_power = {}
        for ch_idx, ch_name in enumerate(epochs.ch_names):
            band_power[ch_name] = {}

            # Compute absolute power for each band
            for band_name, (low, high) in BANDS.items():
                freq_idx = np.logical_and(freqs >= low, freqs < high)
                absolute = np.trapz(psd_mean[ch_idx, freq_idx], freqs[freq_idx])
                band_power[ch_name][band_name] = {'absolute': float(absolute)}

            # Compute total power for relative calculation
            total_power = sum(bp['absolute'] for bp in band_power[ch_name].values())

            # Add relative power
            for band_name in BANDS.keys():
                relative = band_power[ch_name][band_name]['absolute'] / total_power if total_power > 0 else 0
                band_power[ch_name][band_name]['relative'] = float(relative)

        return band_power

    def compute_band_ratios(self, band_power: Dict) -> Dict:
        """
        Compute clinically relevant band ratios

        Args:
            band_power: Band power dictionary from compute_band_power

        Returns:
            Dictionary of band ratios
        """
        logger.info("Computing band ratios")

        def get_regional_average(channels: List[str], band: str) -> float:
            """Average power across channels for a specific band"""
            values = []
            for ch in channels:
                if ch in band_power and band in band_power[ch]:
                    values.append(band_power[ch][band]['absolute'])
            return np.mean(values) if values else 0.0

        # Theta/Beta ratio (ADHD marker)
        frontal_theta = get_regional_average(CHANNEL_GROUPS['frontal'], 'theta')
        frontal_beta = get_regional_average(CHANNEL_GROUPS['frontal'], 'beta2')
        frontal_tbr = frontal_theta / frontal_beta if frontal_beta > 0 else 0

        central_theta = get_regional_average(CHANNEL_GROUPS['central'], 'theta')
        central_beta = get_regional_average(CHANNEL_GROUPS['central'], 'beta2')
        central_tbr = central_theta / central_beta if central_beta > 0 else 0

        # Alpha/Theta ratio (cognitive processing)
        occipital_alpha = get_regional_average(CHANNEL_GROUPS['occipital'], 'alpha1') + \
                         get_regional_average(CHANNEL_GROUPS['occipital'], 'alpha2')
        occipital_theta = get_regional_average(CHANNEL_GROUPS['occipital'], 'theta')
        occipital_atr = occipital_alpha / occipital_theta if occipital_theta > 0 else 0

        parietal_alpha = get_regional_average(CHANNEL_GROUPS['parietal'], 'alpha1') + \
                        get_regional_average(CHANNEL_GROUPS['parietal'], 'alpha2')
        parietal_theta = get_regional_average(CHANNEL_GROUPS['parietal'], 'theta')
        parietal_atr = parietal_alpha / parietal_theta if parietal_theta > 0 else 0

        return {
            'theta_beta_ratio': {
                'frontal_avg': float(frontal_tbr),
                'central_avg': float(central_tbr),
            },
            'alpha_theta_ratio': {
                'occipital_avg': float(occipital_atr),
                'parietal_avg': float(parietal_atr),
            }
        }

    def compute_asymmetry(self, band_power: Dict) -> Dict:
        """
        Compute hemispheric asymmetry indices

        Asymmetry = ln(Right) - ln(Left)
        Negative = left dominance, Positive = right dominance

        Args:
            band_power: Band power dictionary

        Returns:
            Dictionary of asymmetry indices
        """
        logger.info("Computing hemispheric asymmetry")

        asymmetry = {}

        for asym_name, (left_ch, right_ch) in ASYMMETRY_PAIRS.items():
            # Determine which band to use
            if 'alpha' in asym_name:
                band = 'alpha2'  # Use upper alpha
            elif 'theta' in asym_name:
                band = 'theta'
            else:
                continue

            # Get power values
            if left_ch in band_power and right_ch in band_power:
                left_power = band_power[left_ch][band]['absolute']
                right_power = band_power[right_ch][band]['absolute']

                # Compute asymmetry index (log-transformed)
                if left_power > 0 and right_power > 0:
                    asym_index = np.log(right_power) - np.log(left_power)
                    asymmetry[asym_name] = float(asym_index)
                else:
                    asymmetry[asym_name] = 0.0
            else:
                asymmetry[asym_name] = 0.0

        return asymmetry

    def compute_coherence(self, epochs: mne.Epochs) -> List[Dict]:
        """
        Compute coherence between channel pairs

        Args:
            epochs: MNE Epochs object

        Returns:
            List of coherence dictionaries for each pair
        """
        logger.info("Computing coherence")

        # Define channel pairs for analysis
        pairs = [
            {'ch1': 'Fp1', 'ch2': 'Fp2', 'type': 'interhemispheric', 'region': 'frontal'},
            {'ch1': 'F3', 'ch2': 'F4', 'type': 'interhemispheric', 'region': 'frontal'},
            {'ch1': 'C3', 'ch2': 'C4', 'type': 'interhemispheric', 'region': 'central'},
            {'ch1': 'P3', 'ch2': 'P4', 'type': 'interhemispheric', 'region': 'parietal'},
            {'ch1': 'O1', 'ch2': 'O2', 'type': 'interhemispheric', 'region': 'occipital'},
            {'ch1': 'F3', 'ch2': 'P3', 'type': 'long_range', 'region': 'left'},
            {'ch1': 'F4', 'ch2': 'P4', 'type': 'long_range', 'region': 'right'},
        ]

        coherence_results = []

        for pair in pairs:
            ch1, ch2 = pair['ch1'], pair['ch2']

            # Check if channels exist
            if ch1 not in epochs.ch_names or ch2 not in epochs.ch_names:
                continue

            # Get indices
            ch1_idx = epochs.ch_names.index(ch1)
            ch2_idx = epochs.ch_names.index(ch2)

            # Get data for both channels
            data = epochs.get_data()  # (n_epochs, n_channels, n_times)
            sig1 = data[:, ch1_idx, :]
            sig2 = data[:, ch2_idx, :]

            # Compute coherence for each epoch and average
            coherence_by_band = {}

            for band_name, (low, high) in BANDS.items():
                band_coherences = []

                for epoch_idx in range(sig1.shape[0]):
                    # Compute coherence using Welch's method
                    freqs, coh = signal.coherence(
                        sig1[epoch_idx],
                        sig2[epoch_idx],
                        fs=self.sfreq,
                        nperseg=int(2 * self.sfreq)
                    )

                    # Extract coherence for this band
                    freq_idx = np.logical_and(freqs >= low, freqs < high)
                    if np.any(freq_idx):
                        band_coh = np.mean(coh[freq_idx])
                        band_coherences.append(band_coh)

                # Average across epochs
                coherence_by_band[band_name] = float(np.mean(band_coherences)) if band_coherences else 0.0

            result = {
                'ch1': ch1,
                'ch2': ch2,
                'type': pair['type'],
                'region': pair['region'],
                **coherence_by_band
            }

            coherence_results.append(result)

        return coherence_results

    def compute_lzc(self, epochs: mne.Epochs) -> Dict[str, Dict[str, float]]:
        """
        Compute Lempel-Ziv Complexity (LZC) for each channel

        LZC measures signal complexity by counting the number of distinct patterns
        in the binary representation of the signal. Higher values indicate more
        complex, less predictable signals.

        Args:
            epochs: Preprocessed epochs

        Returns:
            Dictionary: {channel: {'lzc': value, 'normalized_lzc': value}}
        """
        logger.info("Computing Lempel-Ziv Complexity")

        data = epochs.get_data()  # Shape: (n_epochs, n_channels, n_times)
        ch_names = epochs.ch_names
        n_epochs, n_channels, n_times = data.shape

        lzc_results = {}

        for ch_idx, ch_name in enumerate(ch_names):
            epoch_lzc_values = []

            for epoch_idx in range(n_epochs):
                # Get signal for this epoch and channel
                signal_data = data[epoch_idx, ch_idx, :]

                # Calculate LZC
                lzc = self._lempel_ziv_complexity(signal_data)
                epoch_lzc_values.append(lzc)

            # Average LZC across epochs
            mean_lzc = np.mean(epoch_lzc_values)

            # Normalize by theoretical maximum (log2(n))
            # Maximum complexity occurs for random sequences
            max_complexity = np.log2(n_times) if n_times > 1 else 1.0
            normalized_lzc = mean_lzc / max_complexity if max_complexity > 0 else 0.0

            lzc_results[ch_name] = {
                'lzc': float(mean_lzc),
                'normalized_lzc': float(normalized_lzc)
            }

        logger.info(f"Computed LZC for {len(lzc_results)} channels")
        return lzc_results

    def _lempel_ziv_complexity(self, signal_data: np.ndarray) -> float:
        """
        Calculate Lempel-Ziv Complexity using the LZ76 algorithm

        The signal is first binarized using the median as threshold,
        then the number of distinct subsequences is counted.

        Args:
            signal_data: 1D array of signal values

        Returns:
            LZC value (number of distinct patterns)
        """
        # Binarize signal using median threshold
        median = np.median(signal_data)
        binary_string = ''.join(['1' if x > median else '0' for x in signal_data])

        # LZ76 algorithm: count number of distinct subsequences
        n = len(binary_string)
        complexity = 0
        ind = 0
        inc = 1

        while ind + inc <= n:
            # Check if current subsequence is new
            subsequence = binary_string[ind:ind + inc]

            # Look for this pattern in the prefix
            if subsequence in binary_string[0:ind + inc - 1]:
                # Pattern exists, extend the window
                inc += 1
            else:
                # New pattern found, increment complexity
                complexity += 1
                ind += inc
                inc = 1

        # Account for the last incomplete pattern
        if ind < n:
            complexity += 1

        return float(complexity)

    def detect_risk_patterns(
        self,
        band_power: Dict,
        band_ratios: Dict,
        asymmetry: Dict
    ) -> Dict[str, bool]:
        """
        Detect patterns associated with various conditions

        Note: These are research-based patterns, not diagnostic criteria

        Args:
            band_power: Band power dictionary
            band_ratios: Band ratios dictionary
            asymmetry: Asymmetry indices

        Returns:
            Dictionary of detected patterns
        """
        logger.info("Detecting risk patterns")

        patterns = {}

        # ADHD-like pattern: Elevated frontal theta/beta ratio
        # Research threshold: TBR > 2.5 may indicate attention difficulties
        frontal_tbr = band_ratios['theta_beta_ratio']['frontal_avg']
        patterns['adhd_like'] = frontal_tbr > 2.5

        # Anxiety-like pattern: Elevated frontal beta
        frontal_beta = np.mean([
            band_power[ch]['beta2']['absolute']
            for ch in CHANNEL_GROUPS['frontal']
            if ch in band_power
        ])
        frontal_total = np.mean([
            sum(band_power[ch][b]['absolute'] for b in BANDS.keys())
            for ch in CHANNEL_GROUPS['frontal']
            if ch in band_power
        ])
        frontal_beta_ratio = frontal_beta / frontal_total if frontal_total > 0 else 0
        patterns['anxiety_like'] = frontal_beta_ratio > 0.25

        # Depression-like pattern: Frontal alpha asymmetry (left hypoactivation)
        # Negative asymmetry = left < right (approach withdrawal)
        frontal_asym = asymmetry.get('frontal_alpha', 0)
        patterns['depression_like'] = frontal_asym < -0.15

        # Sleep dysregulation: Elevated delta in wake state
        avg_delta = np.mean([
            band_power[ch]['delta']['relative']
            for ch in band_power.keys()
        ])
        patterns['sleep_dysregulation'] = avg_delta > 0.25

        # Hyper-arousal: Elevated high beta across all regions
        avg_hibeta = np.mean([
            band_power[ch]['hibeta']['relative']
            for ch in band_power.keys()
        ])
        patterns['hyper_arousal'] = avg_hibeta > 0.15

        return patterns


def extract_features(
    epochs_eo: mne.Epochs = None,
    epochs_ec: mne.Epochs = None
) -> Dict:
    """
    Main feature extraction function

    Args:
        epochs_eo: Eyes open epochs (optional)
        epochs_ec: Eyes closed epochs (optional)

    Returns:
        Dictionary of extracted features
    """
    # Determine which epochs to use for sampling rate
    if epochs_eo is not None:
        extractor = FeatureExtractor(epochs_eo.info['sfreq'])
    elif epochs_ec is not None:
        extractor = FeatureExtractor(epochs_ec.info['sfreq'])
    else:
        raise ValueError("At least one of epochs_eo or epochs_ec must be provided")

    # Extract features for EO condition if available
    band_power_eo = None
    coherence_eo = None
    lzc_eo = None
    if epochs_eo is not None:
        logger.info("Extracting features for Eyes Open condition")
        band_power_eo = extractor.compute_band_power(epochs_eo)
        coherence_eo = extractor.compute_coherence(epochs_eo)
        lzc_eo = extractor.compute_lzc(epochs_eo)
    else:
        logger.info("Skipping Eyes Open feature extraction (no EO epochs)")

    # Extract features for EC condition if available
    band_power_ec = None
    coherence_ec = None
    lzc_ec = None
    if epochs_ec is not None:
        logger.info("Extracting features for Eyes Closed condition")
        band_power_ec = extractor.compute_band_power(epochs_ec)
        coherence_ec = extractor.compute_coherence(epochs_ec)
        lzc_ec = extractor.compute_lzc(epochs_ec)
    else:
        logger.info("Skipping Eyes Closed feature extraction (no EC epochs)")

    # Compute derived metrics (prefer EC if available, otherwise use EO)
    # EC is more stable for clinical metrics, but we'll use what we have
    primary_band_power = band_power_ec if band_power_ec is not None else band_power_eo

    band_ratios = extractor.compute_band_ratios(primary_band_power)
    asymmetry = extractor.compute_asymmetry(primary_band_power)
    risk_patterns = extractor.detect_risk_patterns(primary_band_power, band_ratios, asymmetry)

    return {
        'band_power': {
            'eo': band_power_eo,
            'ec': band_power_ec,
        },
        'coherence': {
            'eo': coherence_eo,
            'ec': coherence_ec,
        },
        'lzc': {
            'eo': lzc_eo,
            'ec': lzc_ec,
        },
        'band_ratios': band_ratios,
        'asymmetry': asymmetry,
        'risk_patterns': risk_patterns,
    }


if __name__ == '__main__':
    import sys
    import json

    print("Feature extraction module loaded successfully")
    print(f"Supported bands: {list(BANDS.keys())}")
    print(f"Channel groups: {list(CHANNEL_GROUPS.keys())}")
