#!/usr/bin/env python3
"""
EEG Feature Extraction Module

Extracts neurological features from preprocessed EEG epochs:
- Band power (absolute and relative) for all channels
- Band ratios (theta/beta, alpha/theta)
- Hemispheric asymmetry indices
- wPLI (weighted Phase Lag Index) connectivity analysis
- Graph-theoretic network metrics (global efficiency, clustering, small-worldness)
- Complexity measures
- Risk pattern detection
"""

import numpy as np
import mne
from scipy import signal
from scipy.signal import hilbert
from typing import Dict, List, Tuple, Optional
import logging
from itertools import combinations

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

# Connectivity-specific frequency bands (broader for wPLI analysis)
CONNECTIVITY_BANDS = {
    'delta': (1, 4),
    'theta': (4, 8),
    'alpha': (8, 13),
    'beta': (13, 30),
}

# Interhemispheric channel pairs for connectivity analysis
INTERHEMISPHERIC_PAIRS = [
    ('Fp1', 'Fp2'),
    ('F7', 'F8'),
    ('F3', 'F4'),
    ('T7', 'T8'),
    ('C3', 'C4'),
    ('P7', 'P8'),
    ('P3', 'P4'),
    ('O1', 'O2'),
]


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

        logger.info(f"Data shape: {data.shape}, sfreq: {self.sfreq}")

        # Compute PSD using Welch's method
        # nperseg should be smaller than signal length to allow proper windowing
        # Using 1-second windows (half the epoch duration) for good frequency resolution
        nperseg = min(int(self.sfreq), n_times)  # 1 second or signal length, whichever is smaller

        logger.info(f"Using nperseg={nperseg} for Welch PSD calculation")

        freqs, psd = signal.welch(
            data,
            fs=self.sfreq,
            nperseg=nperseg,
            axis=-1
        )

        logger.info(f"Freqs shape: {freqs.shape}, range: {freqs.min():.2f}-{freqs.max():.2f} Hz")
        logger.info(f"PSD shape: {psd.shape}, sample values in V²/Hz (first channel, first epoch): {psd[0, 0, :5]}")

        # Average across epochs
        psd_mean = np.mean(psd, axis=0)  # Shape: (n_channels, n_freqs)

        # Convert from V²/Hz to μV²/Hz (multiply by 1e12)
        # MNE stores data in Volts, but EEG power is conventionally reported in μV²/Hz
        psd_mean = psd_mean * 1e12

        logger.info(f"PSD mean shape: {psd_mean.shape}, sample values in μV²/Hz (first channel): {psd_mean[0, :5]}")

        # Extract band power for each channel
        band_power = {}

        # Debug: Log first channel's band powers
        first_channel_logged = False

        for ch_idx, ch_name in enumerate(epochs.ch_names):
            band_power[ch_name] = {}

            # Compute absolute power for each band
            for band_name, (low, high) in BANDS.items():
                freq_idx = np.logical_and(freqs >= low, freqs < high)

                # Debug logging for first channel
                if not first_channel_logged:
                    logger.info(f"Band {band_name} ({low}-{high} Hz): {freq_idx.sum()} frequencies selected")
                    if freq_idx.sum() > 0:
                        logger.info(f"  Selected freqs: {freqs[freq_idx][:5]}")
                        logger.info(f"  PSD values: {psd_mean[ch_idx, freq_idx][:5]}")
                        logger.info(f"  Integration range: {freqs[freq_idx].min():.2f}-{freqs[freq_idx].max():.2f} Hz")

                absolute = np.trapz(psd_mean[ch_idx, freq_idx], freqs[freq_idx])

                if not first_channel_logged:
                    logger.info(f"  Integrated power: {absolute}")

                band_power[ch_name][band_name] = {'absolute': float(absolute)}

            first_channel_logged = True

            # Compute total power for relative calculation
            total_power = sum(bp['absolute'] for bp in band_power[ch_name].values())

            # Add relative power
            for band_name in BANDS.keys():
                relative = band_power[ch_name][band_name]['absolute'] / total_power if total_power > 0 else 0
                band_power[ch_name][band_name]['relative'] = float(relative)

        logger.info(f"Band power computation complete. Sample channel ({epochs.ch_names[0]}): {band_power[epochs.ch_names[0]]}")

        return band_power

    def compute_alpha_peak(self, epochs: mne.Epochs) -> Dict[str, Dict[str, float]]:
        """
        Compute Individual Alpha Frequency (IAF) - the frequency with maximum power
        in the alpha band (8-12 Hz) after removing 1/f background.

        Uses 1/f normalization to remove aperiodic (background) component and isolate
        the true alpha peak from the periodic component.

        Args:
            epochs: MNE Epochs object

        Returns:
            Dictionary: {channel: {'peak_frequency': Hz, 'peak_power': μV²/Hz}}
        """
        logger.info("Computing alpha peak frequency with 1/f normalization")

        data = epochs.get_data()  # Shape: (n_epochs, n_channels, n_times)
        n_epochs, n_channels, n_times = data.shape

        # For alpha peak detection, we need fine frequency resolution (0.1 Hz)
        # To achieve 0.1 Hz resolution: nperseg = sfreq / 0.1
        # For 250 Hz: nperseg = 2500 samples = 10 seconds
        # Since epochs are only 2 seconds, we concatenate them for each channel

        # Concatenate all epochs for each channel to get longer signal
        data_concat = data.reshape(n_channels, -1)  # (n_channels, n_epochs * n_times)

        # Use 4-second window for better than 0.1 Hz resolution
        # 4 seconds at 250 Hz = 1000 samples, giving 0.25 Hz resolution
        # But we can use longer window if we have enough data
        total_length = data_concat.shape[1]
        desired_nperseg = int(self.sfreq / 0.1)  # For 0.1 Hz resolution (10 seconds)

        # Use the desired window size if we have enough data, otherwise use max available
        nperseg = min(desired_nperseg, total_length)

        # Ensure nperseg is reasonable (at least 2 seconds)
        nperseg = max(nperseg, int(2 * self.sfreq))

        freq_resolution = self.sfreq / nperseg
        logger.info(f"Alpha peak: using nperseg={nperseg} for {freq_resolution:.2f} Hz frequency resolution")

        freqs, psd = signal.welch(
            data_concat,
            fs=self.sfreq,
            nperseg=nperseg,
            noverlap=nperseg // 2,  # 50% overlap
            axis=-1
        )

        # No need to average across epochs since we concatenated
        # psd shape is now (n_channels, n_freqs)

        # Convert from V²/Hz to μV²/Hz
        psd = psd * 1e12

        # Define alpha range (8-12 Hz for individual alpha frequency)
        alpha_range = (8, 12)

        # Define broader range for 1/f fitting (3-40 Hz to avoid DC and high-freq noise)
        fit_range = (3, 40)
        fit_idx = np.logical_and(freqs >= fit_range[0], freqs <= fit_range[1])
        fit_freqs = freqs[fit_idx]

        alpha_peaks = {}

        for ch_idx, ch_name in enumerate(epochs.ch_names):
            # Get PSD for fitting range
            fit_psd = psd[ch_idx, fit_idx]

            # Fit 1/f background: log(PSD) = log(A) - beta * log(freq)
            # Using robust linear regression in log-log space
            try:
                log_freqs = np.log10(fit_freqs)
                log_psd = np.log10(fit_psd + 1e-10)  # Add small constant to avoid log(0)

                # Fit line to log-log data
                coeffs = np.polyfit(log_freqs, log_psd, deg=1)
                slope = coeffs[0]
                intercept = coeffs[1]

                # Predict 1/f background across all frequencies
                log_freqs_all = np.log10(freqs[freqs > 0])
                predicted_log_psd = slope * log_freqs_all + intercept
                predicted_psd = 10 ** predicted_log_psd

                # Compute residual (observed - predicted) in original space
                # This isolates the periodic (oscillatory) component
                psd_residual = psd[ch_idx, freqs > 0] - predicted_psd

                # Extract alpha band from residual
                freq_idx_alpha = np.logical_and(freqs >= alpha_range[0], freqs <= alpha_range[1])
                alpha_freqs = freqs[freq_idx_alpha]
                alpha_residual = psd_residual[np.logical_and(freqs[freqs > 0] >= alpha_range[0],
                                                             freqs[freqs > 0] <= alpha_range[1])]

                if len(alpha_residual) == 0 or np.all(alpha_residual <= 0):
                    # No clear alpha peak above background
                    logger.warning(f"No alpha peak found for {ch_name} after 1/f correction")
                    alpha_peaks[ch_name] = {
                        'peak_frequency': 0.0,
                        'peak_power': 0.0
                    }
                    continue

                # Find peak in residual (corrected for 1/f)
                peak_idx = np.argmax(alpha_residual)
                peak_freq = alpha_freqs[peak_idx]

                # Get original power at peak frequency (not residual)
                peak_power = psd[ch_idx, freq_idx_alpha][peak_idx]

                alpha_peaks[ch_name] = {
                    'peak_frequency': float(peak_freq),
                    'peak_power': float(peak_power)
                }

            except Exception as e:
                logger.warning(f"Error computing alpha peak for {ch_name}: {e}")
                alpha_peaks[ch_name] = {
                    'peak_frequency': 0.0,
                    'peak_power': 0.0
                }

        logger.info(f"Alpha peak computation complete. Sample: {list(alpha_peaks.items())[:3]}")

        return alpha_peaks

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

    def _bandpass_filter(self, data: np.ndarray, low: float, high: float) -> np.ndarray:
        """
        Apply band-pass filter to data.

        Args:
            data: Signal data (n_epochs, n_channels, n_times) or (n_channels, n_times)
            low: Low frequency cutoff (Hz)
            high: High frequency cutoff (Hz)

        Returns:
            Band-pass filtered data
        """
        nyq = self.sfreq / 2
        low_norm = low / nyq
        high_norm = high / nyq

        # Ensure frequencies are within valid range
        low_norm = max(0.001, min(low_norm, 0.99))
        high_norm = max(low_norm + 0.01, min(high_norm, 0.99))

        # Design butterworth filter
        b, a = signal.butter(4, [low_norm, high_norm], btype='band')

        # Apply filter
        return signal.filtfilt(b, a, data, axis=-1)

    def _compute_wpli(self, sig1: np.ndarray, sig2: np.ndarray) -> float:
        """
        Compute weighted Phase Lag Index (wPLI) between two signals.

        wPLI is robust to volume conduction and noise, measuring the consistency
        of phase relationships between signals while weighting by the magnitude
        of the imaginary component.

        wPLI = |E[Im(S)]| / E[|Im(S)|]
        where S is the cross-spectrum and Im() is the imaginary part.

        Args:
            sig1: First signal (n_epochs, n_times)
            sig2: Second signal (n_epochs, n_times)

        Returns:
            wPLI value between 0 and 1
        """
        n_epochs = sig1.shape[0]

        # Compute analytic signal using Hilbert transform
        analytic1 = hilbert(sig1, axis=-1)
        analytic2 = hilbert(sig2, axis=-1)

        # Compute cross-spectrum
        cross_spectrum = analytic1 * np.conj(analytic2)

        # Get imaginary part of cross-spectrum
        imag_cross = np.imag(cross_spectrum)

        # Average across time within each epoch
        imag_mean_per_epoch = np.mean(imag_cross, axis=-1)  # (n_epochs,)
        imag_abs_mean_per_epoch = np.mean(np.abs(imag_cross), axis=-1)  # (n_epochs,)

        # Average across epochs
        numerator = np.abs(np.mean(imag_mean_per_epoch))
        denominator = np.mean(imag_abs_mean_per_epoch)

        if denominator < 1e-10:
            return 0.0

        wpli = numerator / denominator

        return float(np.clip(wpli, 0, 1))

    def compute_connectivity(self, epochs: mne.Epochs) -> Dict:
        """
        Compute wPLI (weighted Phase Lag Index) connectivity between all channel pairs.

        wPLI is preferred over coherence for EEG because it:
        - Is robust to volume conduction artifacts
        - Measures true phase-lagged interactions
        - Is less sensitive to common sources

        Args:
            epochs: MNE Epochs object

        Returns:
            Dictionary containing:
            - connectivity_matrices: {band: 2D numpy array of wPLI values}
            - network_metrics: graph-theoretic metrics per band
            - pair_data: list of dicts with per-pair wPLI values
        """
        logger.info("Computing wPLI connectivity")

        data = epochs.get_data()  # (n_epochs, n_channels, n_times)
        n_epochs, n_channels, n_times = data.shape
        ch_names = list(epochs.ch_names)

        logger.info(f"Computing wPLI for {n_channels} channels, {n_epochs} epochs")

        # Initialize connectivity matrices for each band
        connectivity_matrices = {}

        for band_name, (low, high) in CONNECTIVITY_BANDS.items():
            logger.info(f"Processing {band_name} band ({low}-{high} Hz)")

            # Band-pass filter the data
            filtered_data = self._bandpass_filter(data, low, high)

            # Initialize connectivity matrix
            conn_matrix = np.zeros((n_channels, n_channels))

            # Compute wPLI for all channel pairs
            for i in range(n_channels):
                for j in range(i + 1, n_channels):
                    wpli = self._compute_wpli(filtered_data[:, i, :], filtered_data[:, j, :])
                    conn_matrix[i, j] = wpli
                    conn_matrix[j, i] = wpli  # Symmetric

            connectivity_matrices[band_name] = conn_matrix

        # Compute network metrics for each band
        network_metrics = {}
        for band_name, conn_matrix in connectivity_matrices.items():
            metrics = self._compute_network_metrics(conn_matrix, ch_names)
            network_metrics[band_name] = metrics

        # Generate pair-wise data for backwards compatibility and visualization
        pair_data = self._generate_pair_data(connectivity_matrices, ch_names)

        # Convert matrices to serializable format
        matrices_serializable = {
            band: {
                'matrix': matrix.tolist(),
                'channels': ch_names
            }
            for band, matrix in connectivity_matrices.items()
        }

        return {
            'connectivity_matrices': matrices_serializable,
            'network_metrics': network_metrics,
            'pair_data': pair_data,
        }

    def _compute_network_metrics(self, conn_matrix: np.ndarray, ch_names: List[str]) -> Dict:
        """
        Compute graph-theoretic network metrics from connectivity matrix.

        Args:
            conn_matrix: NxN connectivity matrix (wPLI values)
            ch_names: List of channel names

        Returns:
            Dictionary of network metrics
        """
        n = conn_matrix.shape[0]

        # Threshold the connectivity matrix to create binary adjacency
        # Use median as threshold for binary graph
        threshold = np.median(conn_matrix[np.triu_indices(n, k=1)])
        adj_matrix = (conn_matrix > threshold).astype(float)

        # Also keep weighted matrix for weighted metrics
        weighted_matrix = conn_matrix.copy()

        # 1. Global Efficiency
        # E_global = (1/N(N-1)) * sum(1/d_ij) where d_ij is shortest path
        global_efficiency = self._compute_global_efficiency(weighted_matrix)

        # 2. Clustering Coefficient (weighted)
        clustering_coef = self._compute_clustering_coefficient(weighted_matrix)

        # 3. Small-worldness
        # σ = (C/C_rand) / (L/L_rand) where C=clustering, L=path length
        small_worldness = self._compute_small_worldness(weighted_matrix, adj_matrix)

        # 4. Interhemispheric Connectivity
        interhemispheric = self._compute_interhemispheric_connectivity(conn_matrix, ch_names)

        # 5. Node-level metrics
        node_strength = np.sum(weighted_matrix, axis=1) / (n - 1)  # Normalized strength
        node_metrics = {ch: float(node_strength[i]) for i, ch in enumerate(ch_names)}

        # 6. Regional connectivity averages
        regional_connectivity = self._compute_regional_connectivity(conn_matrix, ch_names)

        return {
            'global_efficiency': float(global_efficiency),
            'mean_clustering_coefficient': float(np.mean(clustering_coef)),
            'clustering_by_channel': {ch: float(clustering_coef[i]) for i, ch in enumerate(ch_names)},
            'small_worldness': float(small_worldness),
            'interhemispheric_connectivity': float(interhemispheric),
            'node_strength': node_metrics,
            'regional_connectivity': regional_connectivity,
        }

    def _compute_global_efficiency(self, weighted_matrix: np.ndarray) -> float:
        """
        Compute global efficiency of the network.

        Global efficiency measures how efficiently information can be exchanged
        across the network. Lower values post-concussion indicate reduced
        network integration.

        Args:
            weighted_matrix: Weighted connectivity matrix

        Returns:
            Global efficiency value (0-1)
        """
        n = weighted_matrix.shape[0]

        # Convert weights to distances (inverse relationship)
        # Higher connectivity = shorter distance
        with np.errstate(divide='ignore'):
            distance_matrix = 1.0 / (weighted_matrix + 1e-10)
        np.fill_diagonal(distance_matrix, 0)

        # Compute shortest paths using Floyd-Warshall
        dist = distance_matrix.copy()
        for k in range(n):
            for i in range(n):
                for j in range(n):
                    if dist[i, k] + dist[k, j] < dist[i, j]:
                        dist[i, j] = dist[i, k] + dist[k, j]

        # Global efficiency = mean of inverse shortest paths
        with np.errstate(divide='ignore', invalid='ignore'):
            inv_dist = 1.0 / dist
        np.fill_diagonal(inv_dist, 0)
        inv_dist = np.nan_to_num(inv_dist, nan=0.0, posinf=0.0)

        global_efficiency = np.sum(inv_dist) / (n * (n - 1))

        return global_efficiency

    def _compute_clustering_coefficient(self, weighted_matrix: np.ndarray) -> np.ndarray:
        """
        Compute weighted clustering coefficient for each node.

        Uses the Onnela et al. (2005) definition for weighted networks.

        Args:
            weighted_matrix: Weighted connectivity matrix

        Returns:
            Array of clustering coefficients per node
        """
        n = weighted_matrix.shape[0]
        clustering = np.zeros(n)

        # Normalize weights to [0, 1]
        max_weight = np.max(weighted_matrix)
        if max_weight > 0:
            W = weighted_matrix / max_weight
        else:
            return clustering

        # Cube root of weights for weighted triangles
        W_third = np.power(W, 1/3)

        for i in range(n):
            neighbors = np.where(W[i, :] > 0)[0]
            neighbors = neighbors[neighbors != i]
            k = len(neighbors)

            if k >= 2:
                # Count weighted triangles
                triangles = 0
                for j in neighbors:
                    for h in neighbors:
                        if j < h:
                            triangles += W_third[i, j] * W_third[j, h] * W_third[h, i]

                # Normalize by possible triangles
                clustering[i] = 2 * triangles / (k * (k - 1))

        return clustering

    def _compute_small_worldness(self, weighted_matrix: np.ndarray, adj_matrix: np.ndarray) -> float:
        """
        Compute small-worldness index (sigma).

        Small-world networks have high clustering and short path lengths.
        σ > 1 indicates small-world topology.

        Args:
            weighted_matrix: Weighted connectivity matrix
            adj_matrix: Binary adjacency matrix

        Returns:
            Small-worldness sigma value
        """
        n = weighted_matrix.shape[0]

        # Observed clustering
        C_obs = np.mean(self._compute_clustering_coefficient(weighted_matrix))

        # Observed characteristic path length
        L_obs = self._compute_characteristic_path_length(weighted_matrix)

        # Generate random network with same degree distribution
        # Using configuration model approximation
        k = np.sum(adj_matrix, axis=1)  # Degree sequence
        p = np.sum(k) / (n * (n - 1))  # Connection probability

        # Expected clustering for random network: C_rand ≈ p
        C_rand = max(p, 1e-10)

        # Expected path length for random network: L_rand ≈ ln(n)/ln(k_mean)
        k_mean = np.mean(k)
        if k_mean > 1:
            L_rand = np.log(n) / np.log(k_mean)
        else:
            L_rand = float('inf')

        # Small-worldness: σ = (C/C_rand) / (L/L_rand)
        if C_rand > 0 and L_rand > 0 and L_obs > 0:
            gamma = C_obs / C_rand  # Normalized clustering
            lambd = L_obs / L_rand  # Normalized path length
            sigma = gamma / lambd if lambd > 0 else 0
        else:
            sigma = 0

        return sigma

    def _compute_characteristic_path_length(self, weighted_matrix: np.ndarray) -> float:
        """
        Compute characteristic path length of the network.

        Args:
            weighted_matrix: Weighted connectivity matrix

        Returns:
            Mean shortest path length
        """
        n = weighted_matrix.shape[0]

        # Convert weights to distances
        with np.errstate(divide='ignore'):
            distance_matrix = 1.0 / (weighted_matrix + 1e-10)
        np.fill_diagonal(distance_matrix, 0)

        # Floyd-Warshall for shortest paths
        dist = distance_matrix.copy()
        for k in range(n):
            for i in range(n):
                for j in range(n):
                    if dist[i, k] + dist[k, j] < dist[i, j]:
                        dist[i, j] = dist[i, k] + dist[k, j]

        # Mean path length (excluding self-connections and infinite paths)
        mask = ~np.eye(n, dtype=bool)
        finite_paths = dist[mask]
        finite_paths = finite_paths[np.isfinite(finite_paths)]

        if len(finite_paths) > 0:
            return np.mean(finite_paths)
        return float('inf')

    def _compute_interhemispheric_connectivity(self, conn_matrix: np.ndarray, ch_names: List[str]) -> float:
        """
        Compute mean interhemispheric connectivity.

        Measures the strength of connections between left and right hemisphere,
        which is particularly relevant for concussion assessment.

        Args:
            conn_matrix: Connectivity matrix
            ch_names: List of channel names

        Returns:
            Mean interhemispheric wPLI
        """
        interhemispheric_values = []

        for left_ch, right_ch in INTERHEMISPHERIC_PAIRS:
            if left_ch in ch_names and right_ch in ch_names:
                left_idx = ch_names.index(left_ch)
                right_idx = ch_names.index(right_ch)
                interhemispheric_values.append(conn_matrix[left_idx, right_idx])

        if interhemispheric_values:
            return float(np.mean(interhemispheric_values))
        return 0.0

    def _compute_regional_connectivity(self, conn_matrix: np.ndarray, ch_names: List[str]) -> Dict:
        """
        Compute mean connectivity within and between brain regions.

        Args:
            conn_matrix: Connectivity matrix
            ch_names: List of channel names

        Returns:
            Dictionary of regional connectivity values
        """
        regional = {}

        # Within-region connectivity
        for region, channels in CHANNEL_GROUPS.items():
            if region in ['left', 'right']:
                continue  # Skip hemisphere groupings

            indices = [ch_names.index(ch) for ch in channels if ch in ch_names]
            if len(indices) >= 2:
                # Extract submatrix for this region
                submatrix = conn_matrix[np.ix_(indices, indices)]
                # Get upper triangle (excluding diagonal)
                n = len(indices)
                upper_tri = submatrix[np.triu_indices(n, k=1)]
                if len(upper_tri) > 0:
                    regional[f'{region}_within'] = float(np.mean(upper_tri))

        # Between-region connectivity (frontal-posterior)
        frontal_idx = [ch_names.index(ch) for ch in CHANNEL_GROUPS['frontal'] if ch in ch_names]
        posterior_idx = [ch_names.index(ch) for ch in
                        CHANNEL_GROUPS['parietal'] + CHANNEL_GROUPS['occipital']
                        if ch in ch_names]

        if frontal_idx and posterior_idx:
            fp_values = [conn_matrix[i, j] for i in frontal_idx for j in posterior_idx]
            regional['frontal_posterior'] = float(np.mean(fp_values))

        return regional

    def _generate_pair_data(self, connectivity_matrices: Dict[str, np.ndarray], ch_names: List[str]) -> List[Dict]:
        """
        Generate pair-wise connectivity data for visualization and backwards compatibility.

        Args:
            connectivity_matrices: Dictionary of connectivity matrices per band
            ch_names: List of channel names

        Returns:
            List of dictionaries with per-pair connectivity values
        """
        n = len(ch_names)
        pair_data = []

        for i in range(n):
            for j in range(i + 1, n):
                ch1, ch2 = ch_names[i], ch_names[j]

                # Determine pair type
                pair_type = 'other'
                region = 'mixed'

                if (ch1, ch2) in INTERHEMISPHERIC_PAIRS or (ch2, ch1) in INTERHEMISPHERIC_PAIRS:
                    pair_type = 'interhemispheric'
                    # Determine region from channel names
                    if ch1.startswith('F') or ch2.startswith('F'):
                        region = 'frontal'
                    elif ch1.startswith('C') or ch2.startswith('C'):
                        region = 'central'
                    elif ch1.startswith('P') or ch2.startswith('P'):
                        region = 'parietal'
                    elif ch1.startswith('O') or ch2.startswith('O'):
                        region = 'occipital'
                    elif ch1.startswith('T') or ch2.startswith('T'):
                        region = 'temporal'
                elif ch1 in CHANNEL_GROUPS['left'] and ch2 in CHANNEL_GROUPS['left']:
                    pair_type = 'intrahemispheric'
                    region = 'left'
                elif ch1 in CHANNEL_GROUPS['right'] and ch2 in CHANNEL_GROUPS['right']:
                    pair_type = 'intrahemispheric'
                    region = 'right'

                # Get wPLI values for each band
                band_values = {}
                for band_name, matrix in connectivity_matrices.items():
                    band_values[band_name] = float(matrix[i, j])

                pair_data.append({
                    'ch1': ch1,
                    'ch2': ch2,
                    'type': pair_type,
                    'region': region,
                    **band_values
                })

        return pair_data

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
    connectivity_eo = None
    lzc_eo = None
    alpha_peak_eo = None
    if epochs_eo is not None:
        logger.info("Extracting features for Eyes Open condition")
        band_power_eo = extractor.compute_band_power(epochs_eo)
        connectivity_eo = extractor.compute_connectivity(epochs_eo)
        lzc_eo = extractor.compute_lzc(epochs_eo)
        alpha_peak_eo = extractor.compute_alpha_peak(epochs_eo)
    else:
        logger.info("Skipping Eyes Open feature extraction (no EO epochs)")

    # Extract features for EC condition if available
    band_power_ec = None
    connectivity_ec = None
    lzc_ec = None
    alpha_peak_ec = None
    if epochs_ec is not None:
        logger.info("Extracting features for Eyes Closed condition")
        band_power_ec = extractor.compute_band_power(epochs_ec)
        connectivity_ec = extractor.compute_connectivity(epochs_ec)
        lzc_ec = extractor.compute_lzc(epochs_ec)
        alpha_peak_ec = extractor.compute_alpha_peak(epochs_ec)
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
        'connectivity': {
            'eo': connectivity_eo,
            'ec': connectivity_ec,
        },
        'lzc': {
            'eo': lzc_eo,
            'ec': lzc_ec,
        },
        'alpha_peak': {
            'eo': alpha_peak_eo,
            'ec': alpha_peak_ec,
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
