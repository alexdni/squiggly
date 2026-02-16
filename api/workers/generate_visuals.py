#!/usr/bin/env python3
"""
EEG Visualization Generation Module

Generates publication-quality visualizations for EEG analysis results:
- Topographic brainmaps (topomaps) for each band and condition
- Spectrograms for each channel
- Power Spectral Density (PSD) plots
- Alpha Peak Frequency (APF) visualizations
- Brain connectivity graphs (wPLI-based)
- QC dashboards
"""

import numpy as np
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend for server-side rendering
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap, Normalize
from matplotlib.collections import LineCollection
import matplotlib.cm as cm
import mne
from scipy import signal
from typing import Dict, List, Tuple, Optional
import logging
import io
from PIL import Image

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Frequency bands (Hz) - must match extract_features.py
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

# Standard 10-20 19-channel montage
CHANNEL_NAMES = [
    'Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8',
    'T7', 'C3', 'Cz', 'C4', 'T8',
    'P7', 'P3', 'Pz', 'P4', 'P8',
    'O1', 'O2'
]

# Connectivity-specific frequency bands (matches extract_features.py)
CONNECTIVITY_BANDS = {
    'delta': (1, 4),
    'theta': (4, 8),
    'alpha': (8, 13),
    'beta': (13, 30),
}

# Electrode positions for 2D head plot (normalized coordinates)
# Origin at center of head, x positive to right, y positive to front
# Includes standard 10-20, legacy names (T3/T4/T5/T6), and extended 10-10 positions
ELECTRODE_POSITIONS = {
    # Standard 10-20 (19 channels)
    'Fp1': (-0.15, 0.45),
    'Fp2': (0.15, 0.45),
    'F7': (-0.45, 0.25),
    'F3': (-0.22, 0.22),
    'Fz': (0.0, 0.25),
    'F4': (0.22, 0.22),
    'F8': (0.45, 0.25),
    'T7': (-0.50, 0.0),
    'C3': (-0.25, 0.0),
    'Cz': (0.0, 0.0),
    'C4': (0.25, 0.0),
    'T8': (0.50, 0.0),
    'P7': (-0.45, -0.25),
    'P3': (-0.22, -0.22),
    'Pz': (0.0, -0.25),
    'P4': (0.22, -0.22),
    'P8': (0.45, -0.25),
    'O1': (-0.15, -0.45),
    'O2': (0.15, -0.45),
    # Legacy 10-20 names (T3/T4/T5/T6 -> T7/T8/P7/P8)
    'T3': (-0.50, 0.0),   # Same as T7
    'T4': (0.50, 0.0),    # Same as T8
    'T5': (-0.45, -0.25), # Same as P7
    'T6': (0.45, -0.25),  # Same as P8
    # Midline extended 10-10
    'Fpz': (0.0, 0.45),
    'AFz': (0.0, 0.35),
    'FCz': (0.0, 0.12),
    'CPz': (0.0, -0.12),
    'POz': (0.0, -0.35),
    'Oz': (0.0, -0.45),
    'Iz': (0.0, -0.52),
    # Anterior frontal row
    'AF3': (-0.12, 0.38),
    'AF4': (0.12, 0.38),
    'AF7': (-0.30, 0.38),
    'AF8': (0.30, 0.38),
    # Frontocentral row
    'FC1': (-0.12, 0.12),
    'FC2': (0.12, 0.12),
    'FC3': (-0.22, 0.12),
    'FC4': (0.22, 0.12),
    'FC5': (-0.35, 0.12),
    'FC6': (0.35, 0.12),
    # Frontotemporal
    'FT7': (-0.50, 0.12),
    'FT8': (0.50, 0.12),
    'FT9': (-0.55, 0.08),
    'FT10': (0.55, 0.08),
    # Centroparietal row
    'CP1': (-0.12, -0.12),
    'CP2': (0.12, -0.12),
    'CP3': (-0.22, -0.12),
    'CP4': (0.22, -0.12),
    'CP5': (-0.35, -0.12),
    'CP6': (0.35, -0.12),
    # Temporoparietal
    'TP7': (-0.50, -0.12),
    'TP8': (0.50, -0.12),
    'TP9': (-0.55, -0.08),
    'TP10': (0.55, -0.08),
    # Parieto-occipital row
    'PO3': (-0.12, -0.38),
    'PO4': (0.12, -0.38),
    'PO7': (-0.30, -0.38),
    'PO8': (0.30, -0.38),
    # Ear references (mastoid)
    'A1': (-0.55, 0.0),
    'A2': (0.55, 0.0),
    'M1': (-0.55, 0.0),  # Same as A1
    'M2': (0.55, 0.0),   # Same as A2
}

def normalize_channel_name(ch_name: str) -> str:
    """
    Normalize a channel name to match ELECTRODE_POSITIONS keys and MNE montage names.
    Handles common prefixes, suffixes, and case variations.
    """
    # Canonical channel names (MNE standard_1020 + extras) for case-insensitive matching
    _CANONICAL_CHANNELS = {
        name.upper(): name for name in [
            'Fp1', 'Fp2', 'Fpz', 'F7', 'F3', 'Fz', 'F4', 'F8',
            'T7', 'C3', 'Cz', 'C4', 'T8',
            'P7', 'P3', 'Pz', 'P4', 'P8',
            'O1', 'O2', 'Oz',
            'AF3', 'AF4', 'AF7', 'AF8', 'AFz',
            'FC1', 'FC2', 'FC3', 'FC4', 'FC5', 'FC6', 'FCz',
            'FT7', 'FT8', 'FT9', 'FT10',
            'CP1', 'CP2', 'CP3', 'CP4', 'CP5', 'CP6', 'CPz',
            'TP7', 'TP8', 'TP9', 'TP10',
            'PO3', 'PO4', 'PO7', 'PO8', 'POz',
            'A1', 'A2', 'Iz',
            # Legacy names
            'T3', 'T4', 'T5', 'T6', 'M1', 'M2',
        ]
    }

    # Strip whitespace
    clean = ch_name.strip()

    # Remove common prefixes
    for prefix in ['EEG ', 'EEG-', 'ECG ', 'EMG ', 'EOG ']:
        if clean.upper().startswith(prefix.upper()):
            clean = clean[len(prefix):]

    # Remove reference suffixes
    for suffix in ['-LE', '-REF', '-AVG', '-A1', '-A2', '-CZ', '-M1', '-M2', '-Ref', '-ref']:
        if clean.endswith(suffix):
            clean = clean[:len(clean) - len(suffix)]

    # Look up canonical capitalization (case-insensitive)
    canonical = _CANONICAL_CHANNELS.get(clean.upper())
    if canonical:
        return canonical

    return clean

def get_electrode_position(ch_name: str) -> tuple:
    """
    Get electrode position for a channel name, with normalization.
    Returns None if channel not found.
    """
    # Try direct lookup first
    if ch_name in ELECTRODE_POSITIONS:
        return ELECTRODE_POSITIONS[ch_name]

    # Try normalized name
    normalized = normalize_channel_name(ch_name)
    if normalized in ELECTRODE_POSITIONS:
        return ELECTRODE_POSITIONS[normalized]

    return None


def normalize_channel_names_for_mne(ch_names: List[str]) -> Tuple[List[str], Dict[str, str]]:
    """
    Normalize channel names to be compatible with MNE's standard_1020 montage.

    Args:
        ch_names: List of channel names from the data

    Returns:
        Tuple of (normalized_names, mapping from original to normalized)
    """
    # MNE's standard_1020 montage channel names
    mne_standard_channels = [
        'Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8',
        'T7', 'C3', 'Cz', 'C4', 'T8',
        'P7', 'P3', 'Pz', 'P4', 'P8',
        'O1', 'O2', 'Fpz', 'Oz',
        # Extended positions that MNE supports
        'AF3', 'AF4', 'AF7', 'AF8', 'AFz',
        'FC1', 'FC2', 'FC3', 'FC4', 'FC5', 'FC6', 'FCz',
        'CP1', 'CP2', 'CP3', 'CP4', 'CP5', 'CP6', 'CPz',
        'PO3', 'PO4', 'PO7', 'PO8', 'POz',
        'FT7', 'FT8', 'FT9', 'FT10',
        'TP7', 'TP8', 'TP9', 'TP10',
        'A1', 'A2',
    ]

    # Legacy to modern mappings
    legacy_mapping = {
        'T3': 'T7', 'T4': 'T8', 'T5': 'P7', 'T6': 'P8',
        'M1': 'A1', 'M2': 'A2',
    }

    normalized = []
    mapping = {}

    for ch in ch_names:
        # First normalize the name
        clean = normalize_channel_name(ch)

        # Apply legacy mapping if applicable
        if clean in legacy_mapping:
            clean = legacy_mapping[clean]

        # Check if it's a valid MNE channel
        if clean in mne_standard_channels:
            normalized.append(clean)
            mapping[ch] = clean
        else:
            # Keep original if we can't map it (MNE will handle missing)
            normalized.append(clean)
            mapping[ch] = clean
            logger.debug(f"Channel {ch} normalized to {clean} - may not be in MNE montage")

    return normalized, mapping

# Create custom blue->red colormap for topomaps
def create_blue_red_cmap():
    """Create a custom colormap from blue (low) to red (high)"""
    colors = ['#0000FF', '#4169E1', '#87CEEB', '#FFFF00', '#FFA500', '#FF0000']
    n_bins = 256
    cmap = LinearSegmentedColormap.from_list('blue_red', colors, N=n_bins)
    return cmap


def generate_topomap(
    power_values: np.ndarray,
    ch_names: List[str],
    band_name: str,
    condition: str,
    vmin: Optional[float] = None,
    vmax: Optional[float] = None,
    title: Optional[str] = None,
    dpi: int = 300
) -> bytes:
    """
    Generate a topographic brainmap for a specific band and condition.

    Args:
        power_values: Array of power values per channel (length = 19)
        ch_names: List of channel names (must match standard 10-20)
        band_name: Name of frequency band (e.g., 'alpha1')
        condition: Condition label (e.g., 'EO', 'EC')
        vmin: Minimum value for color scale (if None, use data min)
        vmax: Maximum value for color scale (if None, use data max)
        title: Custom title (if None, auto-generated)
        dpi: Resolution in DPI (default 300 for print quality)

    Returns:
        PNG image as bytes
    """
    logger.info(f"Generating topomap for {band_name} - {condition}")

    # Normalize channel names for MNE compatibility
    normalized_ch_names, ch_mapping = normalize_channel_names_for_mne(ch_names)

    # Create MNE Info object with normalized names
    info = mne.create_info(ch_names=normalized_ch_names, sfreq=250, ch_types='eeg')
    montage = mne.channels.make_standard_montage('standard_1020')
    info.set_montage(montage, on_missing='warn')

    # Set color scale
    if vmin is None:
        vmin = np.min(power_values)
    if vmax is None:
        vmax = np.max(power_values)

    # Create figure
    fig, ax = plt.subplots(figsize=(6, 5), dpi=dpi)

    # Generate topomap
    im, _ = mne.viz.plot_topomap(
        power_values,
        info,
        axes=ax,
        show=False,
        vlim=(vmin, vmax),  # Use vlim tuple instead of separate vmin/vmax
        cmap=create_blue_red_cmap(),
        contours=6,
        res=128,  # Resolution
        sensors=True,
        names=ch_names if len(ch_names) < 20 else None,  # Show labels for 19 ch
    )

    # Add colorbar
    cbar = plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    cbar.set_label('Power (μV²/Hz)', rotation=270, labelpad=20)

    # Set title
    if title is None:
        title = f'{band_name.capitalize()} Band - {condition}'
    ax.set_title(title, fontsize=14, fontweight='bold')

    # Save to bytes buffer
    buf = io.BytesIO()
    plt.tight_layout()
    plt.savefig(buf, format='png', dpi=dpi, bbox_inches='tight')
    plt.close(fig)
    buf.seek(0)

    return buf.read()


def generate_spectrogram(
    epochs_data: np.ndarray,
    sfreq: float,
    ch_name: str,
    condition: str,
    dpi: int = 300
) -> bytes:
    """
    Generate a spectrogram for a single channel.

    Args:
        epochs_data: 2D array of shape (n_epochs, n_times)
        sfreq: Sampling frequency in Hz
        ch_name: Channel name
        condition: Condition label (e.g., 'EO', 'EC')
        dpi: Resolution in DPI

    Returns:
        PNG image as bytes
    """
    logger.info(f"Generating spectrogram for {ch_name} - {condition}")

    # Concatenate epochs to create continuous signal
    continuous_data = epochs_data.ravel()

    # Compute spectrogram
    f, t, Sxx = signal.spectrogram(
        continuous_data,
        fs=sfreq,
        nperseg=int(2 * sfreq),  # 2-second windows
        noverlap=int(1.5 * sfreq),  # 75% overlap
        scaling='density'
    )

    # Limit frequency range to 0.5-45 Hz
    freq_mask = (f >= 0.5) & (f <= 45)
    f = f[freq_mask]
    Sxx = Sxx[freq_mask, :]

    # Convert to dB scale
    Sxx_db = 10 * np.log10(Sxx + 1e-12)

    # Create figure
    fig, ax = plt.subplots(figsize=(10, 4), dpi=dpi)

    # Plot spectrogram
    im = ax.pcolormesh(
        t, f, Sxx_db,
        shading='gouraud',
        cmap='jet',
        vmin=np.percentile(Sxx_db, 5),
        vmax=np.percentile(Sxx_db, 95)
    )

    ax.set_ylabel('Frequency (Hz)', fontsize=12)
    ax.set_xlabel('Time (s)', fontsize=12)
    ax.set_title(f'Spectrogram - {ch_name} ({condition})', fontsize=14, fontweight='bold')

    # Add colorbar
    cbar = plt.colorbar(im, ax=ax)
    cbar.set_label('Power (dB)', rotation=270, labelpad=20)

    # Save to bytes buffer
    buf = io.BytesIO()
    plt.tight_layout()
    plt.savefig(buf, format='png', dpi=dpi, bbox_inches='tight')
    plt.close(fig)
    buf.seek(0)

    return buf.read()


def generate_spectrogram_grid(
    epochs: mne.Epochs,
    condition: str,
    key_channels: List[str] = None,
    dpi: int = 300
) -> bytes:
    """
    Generate a grid of spectrograms for key channels.

    Args:
        epochs: MNE Epochs object
        condition: Condition label (e.g., 'EO', 'EC')
        key_channels: List of channels to plot (default: ['Fp1', 'Fz', 'Cz', 'Pz', 'O1'])
        dpi: Resolution in DPI

    Returns:
        PNG image as bytes containing spectrograms in a grid
    """
    logger.info(f"Generating spectrogram grid for {condition}")

    if key_channels is None:
        key_channels = ['Fp1', 'Fz', 'Cz', 'Pz', 'O1']

    # Filter to only channels that exist
    available_channels = [ch for ch in key_channels if ch in epochs.ch_names]
    n_channels = len(available_channels)

    if n_channels == 0:
        logger.warning("No key channels available for spectrogram")
        return b''

    sfreq = epochs.info['sfreq']

    # Create figure with subplots
    fig, axes = plt.subplots(
        n_channels, 1,
        figsize=(12, n_channels * 2),
        dpi=dpi
    )

    # Ensure axes is iterable
    if n_channels == 1:
        axes = [axes]

    for idx, ch_name in enumerate(available_channels):
        ch_idx = epochs.ch_names.index(ch_name)
        epochs_data = epochs.get_data()[:, ch_idx, :]  # (n_epochs, n_times)

        # Concatenate epochs
        continuous_data = epochs_data.ravel()

        # Compute spectrogram
        f, t, Sxx = signal.spectrogram(
            continuous_data,
            fs=sfreq,
            nperseg=int(2 * sfreq),
            noverlap=int(1.5 * sfreq),
            scaling='density'
        )

        # Limit frequency range
        freq_mask = (f >= 0.5) & (f <= 45)
        f = f[freq_mask]
        Sxx = Sxx[freq_mask, :]

        # Convert to dB
        Sxx_db = 10 * np.log10(Sxx + 1e-12)

        # Plot
        ax = axes[idx]
        im = ax.pcolormesh(
            t, f, Sxx_db,
            shading='gouraud',
            cmap='jet',
            vmin=np.percentile(Sxx_db, 5),
            vmax=np.percentile(Sxx_db, 95)
        )

        ax.set_ylabel('Frequency (Hz)', fontsize=10)
        if idx == n_channels - 1:
            ax.set_xlabel('Time (s)', fontsize=10)
        ax.set_title(f'{ch_name}', fontsize=11, fontweight='bold', loc='left')

        # Add colorbar to right
        cbar = plt.colorbar(im, ax=ax, pad=0.01)
        cbar.set_label('dB', rotation=0, labelpad=10, fontsize=8)

    # Add overall title
    fig.suptitle(f'Spectrograms - {condition}', fontsize=14, fontweight='bold', y=0.995)

    # Save to bytes buffer
    buf = io.BytesIO()
    plt.tight_layout(rect=[0, 0, 1, 0.99])
    plt.savefig(buf, format='png', dpi=dpi, bbox_inches='tight')
    plt.close(fig)
    buf.seek(0)

    return buf.read()


def generate_psd_plot(
    psd_data: Dict[str, np.ndarray],
    freqs: np.ndarray,
    ch_name: str,
    conditions: List[str] = ['EO', 'EC'],
    dpi: int = 300
) -> bytes:
    """
    Generate Power Spectral Density plot for a channel across conditions.

    Args:
        psd_data: Dict mapping condition -> PSD array
        freqs: Frequency bins
        ch_name: Channel name
        conditions: List of conditions to plot
        dpi: Resolution in DPI

    Returns:
        PNG image as bytes
    """
    logger.info(f"Generating PSD plot for {ch_name}")

    # Create figure
    fig, ax = plt.subplots(figsize=(10, 5), dpi=dpi)

    # Plot PSD for each condition
    colors = {'EO': '#1f77b4', 'EC': '#ff7f0e', 'Delta': '#2ca02c'}
    for condition in conditions:
        if condition in psd_data:
            ax.plot(
                freqs,
                10 * np.log10(psd_data[condition] + 1e-12),
                label=condition,
                color=colors.get(condition, 'gray'),
                linewidth=2,
                alpha=0.8
            )

    # Shade frequency bands
    for band_name, (fmin, fmax) in BANDS.items():
        ax.axvspan(fmin, fmax, alpha=0.1, color='gray')
        # Add band label
        ax.text(
            (fmin + fmax) / 2,
            ax.get_ylim()[1] * 0.95,
            band_name[:5],
            ha='center',
            va='top',
            fontsize=8,
            rotation=0
        )

    ax.set_xlabel('Frequency (Hz)', fontsize=12)
    ax.set_ylabel('Power (dB)', fontsize=12)
    ax.set_title(f'Power Spectral Density - {ch_name}', fontsize=14, fontweight='bold')
    ax.set_xlim(0.5, 45)
    ax.grid(True, alpha=0.3)
    ax.legend(loc='upper right')

    # Save to bytes buffer
    buf = io.BytesIO()
    plt.tight_layout()
    plt.savefig(buf, format='png', dpi=dpi, bbox_inches='tight')
    plt.close(fig)
    buf.seek(0)

    return buf.read()


def generate_apf_plot(
    apf_values: Dict[str, Dict[str, float]],
    posterior_channels: List[str] = ['O1', 'O2', 'P3', 'P4', 'Pz'],
    dpi: int = 300
) -> bytes:
    """
    Generate Alpha Peak Frequency (APF) scatter plot comparing EO vs EC.

    Args:
        apf_values: Dict with structure {condition: {ch_name: apf_value}}
        posterior_channels: List of posterior channels to plot
        dpi: Resolution in DPI

    Returns:
        PNG image as bytes
    """
    logger.info("Generating APF comparison plot")

    # Extract APF values for EO and EC
    eo_apf = []
    ec_apf = []
    labels = []

    for ch in posterior_channels:
        if 'EO' in apf_values and ch in apf_values['EO']:
            eo_val = apf_values['EO'][ch]
            ec_val = apf_values.get('EC', {}).get(ch, None)

            if eo_val is not None and ec_val is not None:
                eo_apf.append(eo_val)
                ec_apf.append(ec_val)
                labels.append(ch)

    if not eo_apf:
        logger.warning("No APF values found for plotting")
        return b''

    # Create figure
    fig, ax = plt.subplots(figsize=(8, 6), dpi=dpi)

    # Scatter plot
    ax.scatter(ec_apf, eo_apf, s=100, alpha=0.6, color='#1f77b4', edgecolors='black')

    # Add connecting lines
    for i in range(len(ec_apf)):
        ax.plot([ec_apf[i], ec_apf[i]], [ec_apf[i], eo_apf[i]],
                color='gray', linestyle='--', alpha=0.5, linewidth=1)

    # Add channel labels
    for i, label in enumerate(labels):
        ax.annotate(label, (ec_apf[i], eo_apf[i]),
                   xytext=(5, 5), textcoords='offset points',
                   fontsize=10, fontweight='bold')

    # Add diagonal reference line (no change)
    min_val = min(min(ec_apf), min(eo_apf)) - 0.5
    max_val = max(max(ec_apf), max(eo_apf)) + 0.5
    ax.plot([min_val, max_val], [min_val, max_val],
            'r--', alpha=0.5, linewidth=2, label='No change')

    ax.set_xlabel('APF Eyes Closed (Hz)', fontsize=12)
    ax.set_ylabel('APF Eyes Open (Hz)', fontsize=12)
    ax.set_title('Alpha Peak Frequency: EC vs EO', fontsize=14, fontweight='bold')
    ax.grid(True, alpha=0.3)
    ax.legend()
    ax.set_xlim(min_val, max_val)
    ax.set_ylim(min_val, max_val)
    ax.set_aspect('equal')

    # Save to bytes buffer
    buf = io.BytesIO()
    plt.tight_layout()
    plt.savefig(buf, format='png', dpi=dpi, bbox_inches='tight')
    plt.close(fig)
    buf.seek(0)

    return buf.read()


def generate_lzc_topomap(
    lzc_values: Dict[str, Dict[str, float]],
    ch_names: List[str],
    condition: str,
    use_normalized: bool = True,
    title: Optional[str] = None,
    dpi: int = 300
) -> bytes:
    """
    Generate a topographic brainmap for Lempel-Ziv Complexity (LZC).

    Args:
        lzc_values: Dict mapping channel -> {'lzc': value, 'normalized_lzc': value}
        ch_names: List of channel names (must match standard 10-20)
        condition: Condition label (e.g., 'EO', 'EC')
        use_normalized: If True, use normalized LZC values (0-1 range)
        title: Custom title (if None, auto-generated)
        dpi: Resolution in DPI (default 300 for print quality)

    Returns:
        PNG image as bytes
    """
    logger.info(f"Generating LZC topomap for {condition}")

    # Normalize channel names for MNE compatibility
    normalized_ch_names, ch_mapping = normalize_channel_names_for_mne(ch_names)

    # Extract LZC values in channel order (use original names for lookup, normalized for MNE)
    key = 'normalized_lzc' if use_normalized else 'lzc'
    complexity_values = np.array([
        lzc_values[ch][key] if ch in lzc_values else 0.0
        for ch in ch_names
    ])

    # Create MNE Info object with normalized names
    info = mne.create_info(ch_names=normalized_ch_names, sfreq=250, ch_types='eeg')
    montage = mne.channels.make_standard_montage('standard_1020')
    info.set_montage(montage, on_missing='warn')

    # Set color scale
    vmin = np.percentile(complexity_values, 2)
    vmax = np.percentile(complexity_values, 98)

    # Create figure
    fig, ax = plt.subplots(figsize=(6, 5), dpi=dpi)

    # Generate topomap with diverging colormap (RdYlBu_r: red = high complexity)
    im, _ = mne.viz.plot_topomap(
        complexity_values,
        info,
        axes=ax,
        show=False,
        vlim=(vmin, vmax),
        cmap='RdYlBu_r',  # Red-Yellow-Blue reversed (red = high)
        contours=6,
        res=128,
        sensors=True,
        names=ch_names if len(ch_names) < 20 else None,
    )

    # Add colorbar
    cbar = plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    if use_normalized:
        cbar.set_label('Normalized LZC', rotation=270, labelpad=20)
    else:
        cbar.set_label('LZC', rotation=270, labelpad=20)

    # Set title
    if title is None:
        title = f'Lempel-Ziv Complexity - {condition}'
    ax.set_title(title, fontsize=14, fontweight='bold')

    # Save to bytes buffer
    buf = io.BytesIO()
    plt.tight_layout()
    plt.savefig(buf, format='png', dpi=dpi, bbox_inches='tight')
    plt.close(fig)
    buf.seek(0)

    return buf.read()


def generate_alpha_peak_topomap(
    alpha_peak_values: Dict[str, Dict[str, float]],
    ch_names: List[str],
    condition: str,
    title: Optional[str] = None,
    dpi: int = 300
) -> bytes:
    """
    Generate a topographic brainmap with table for Individual Alpha Frequency (IAF).

    Shows the peak alpha frequency (8-12 Hz) for each channel with a topomap
    and a side table listing frequencies by channel.

    Args:
        alpha_peak_values: Dict mapping channel -> {'peak_frequency': Hz, 'peak_power': μV²/Hz}
        ch_names: List of channel names (must match standard 10-20)
        condition: Condition label (e.g., 'EO', 'EC')
        title: Custom title (if None, auto-generated)
        dpi: Resolution in DPI (default 300 for print quality)

    Returns:
        PNG image as bytes
    """
    logger.info(f"Generating alpha peak topomap for {condition}")

    # Normalize channel names for MNE compatibility
    normalized_ch_names, ch_mapping = normalize_channel_names_for_mne(ch_names)

    # Extract peak frequencies in channel order (use original names for lookup)
    peak_frequencies = np.array([
        alpha_peak_values[ch]['peak_frequency'] if ch in alpha_peak_values else 0.0
        for ch in ch_names
    ])

    # Create MNE Info object with normalized names
    info = mne.create_info(ch_names=normalized_ch_names, sfreq=250, ch_types='eeg')
    montage = mne.channels.make_standard_montage('standard_1020')
    info.set_montage(montage, on_missing='warn')

    # Set color scale for alpha frequencies (8-12 Hz range)
    vmin = 8.0
    vmax = 12.0

    # Create figure with two subplots: topomap on left, table on right
    # Scale height based on number of channels (min 6 for <=19, grow for more)
    n_channels = len(ch_names)
    fig_height = max(6, 0.35 * n_channels)
    fig = plt.figure(figsize=(12, fig_height), dpi=dpi)

    # Left subplot: Topomap
    ax_topo = plt.subplot(1, 2, 1)

    # Generate topomap with viridis colormap (purple to yellow)
    im, _ = mne.viz.plot_topomap(
        peak_frequencies,
        info,
        axes=ax_topo,
        show=False,
        vlim=(vmin, vmax),
        cmap='viridis',  # Purple (low freq) to yellow (high freq)
        contours=6,
        res=128,
        sensors=True,
        names=None,  # Don't show names on topomap
    )

    # Add colorbar
    cbar = plt.colorbar(im, ax=ax_topo, fraction=0.046, pad=0.04)
    cbar.set_label('Peak Frequency (Hz)', rotation=270, labelpad=20)

    # Set title for topomap
    ax_topo.set_title('Topographic Map', fontsize=12, fontweight='bold')

    # Right subplot: Table
    ax_table = plt.subplot(1, 2, 2)
    ax_table.axis('off')

    # Prepare table data sorted by channel name
    table_data = []
    sorted_channels = sorted(ch_names)

    for ch in sorted_channels:
        if ch in alpha_peak_values:
            freq = alpha_peak_values[ch]['peak_frequency']
            power = alpha_peak_values[ch]['peak_power']
            table_data.append([ch, f'{freq:.2f}', f'{power:.1f}'])
        else:
            table_data.append([ch, 'N/A', 'N/A'])

    # Create table
    table = ax_table.table(
        cellText=table_data,
        colLabels=['Channel', 'Peak (Hz)', 'Power (μV²/Hz)'],
        cellLoc='center',
        loc='center',
        colWidths=[0.25, 0.35, 0.4]
    )

    table.auto_set_font_size(False)
    table.set_fontsize(8)
    row_height = max(1.5, 2.0 if n_channels > 24 else 1.8 if n_channels > 19 else 1.5)
    table.scale(1, row_height)

    # Style header
    for i in range(3):
        cell = table[(0, i)]
        cell.set_facecolor('#4CAF50')
        cell.set_text_props(weight='bold', color='white')

    # Alternate row colors
    for i in range(1, len(table_data) + 1):
        for j in range(3):
            cell = table[(i, j)]
            if i % 2 == 0:
                cell.set_facecolor('#f0f0f0')

    # Set overall title
    if title is None:
        title = f'Individual Alpha Frequency (IAF) - {condition}'
    fig.suptitle(title, fontsize=14, fontweight='bold', y=0.98)

    # Save to bytes buffer
    buf = io.BytesIO()
    plt.tight_layout(rect=[0, 0, 1, 0.96])
    plt.savefig(buf, format='png', dpi=dpi, bbox_inches='tight')
    plt.close(fig)
    buf.seek(0)

    return buf.read()


def generate_connectivity_graph(
    connectivity_data: Dict,
    band_name: str,
    condition: str,
    ch_names: List[str] = None,
    threshold: float = 0.3,
    title: Optional[str] = None,
    show_metrics: bool = True,
    dpi: int = 300
) -> bytes:
    """
    Generate a brain connectivity graph visualization showing wPLI connections
    between electrode positions on a 2D head schematic.

    Args:
        connectivity_data: Dict containing connectivity_matrices and network_metrics
                          from compute_connectivity()
        band_name: Frequency band (e.g., 'alpha', 'theta')
        condition: Condition label (e.g., 'EO', 'EC')
        ch_names: List of channel names (if None, uses standard 19 channels)
        threshold: Minimum wPLI value to display a connection (default 0.3)
        title: Custom title (if None, auto-generated)
        show_metrics: Whether to show network metrics on the plot
        dpi: Resolution in DPI

    Returns:
        PNG image as bytes
    """
    logger.info(f"Generating connectivity graph for {band_name} - {condition}")

    if ch_names is None:
        ch_names = CHANNEL_NAMES

    # Get connectivity matrix for this band
    if 'connectivity_matrices' not in connectivity_data:
        logger.warning(f"No connectivity matrices found")
        return b''

    if band_name not in connectivity_data['connectivity_matrices']:
        logger.warning(f"Band {band_name} not found in connectivity data")
        return b''

    matrix_data = connectivity_data['connectivity_matrices'][band_name]
    conn_matrix = np.array(matrix_data['matrix'])
    matrix_channels = matrix_data['channels']

    # Get network metrics if available
    network_metrics = connectivity_data.get('network_metrics', {}).get(band_name, {})

    # Create figure
    fig, ax = plt.subplots(figsize=(10, 10), dpi=dpi)

    # Draw head outline (circle)
    head_circle = plt.Circle((0, 0), 0.55, fill=False, color='gray',
                              linewidth=2, linestyle='-')
    ax.add_patch(head_circle)

    # Draw nose indicator
    nose_x = [0, 0.05, 0, -0.05, 0]
    nose_y = [0.55, 0.60, 0.65, 0.60, 0.55]
    ax.plot(nose_x, nose_y, color='gray', linewidth=2)

    # Draw ears
    ear_left = plt.Circle((-0.55, 0), 0.04, fill=False, color='gray', linewidth=1.5)
    ear_right = plt.Circle((0.55, 0), 0.04, fill=False, color='gray', linewidth=1.5)
    ax.add_patch(ear_left)
    ax.add_patch(ear_right)

    # Get electrode positions - use helper function for normalization
    positions = {}
    for ch in matrix_channels:
        pos = get_electrode_position(ch)
        if pos is not None:
            positions[ch] = pos

    logger.info(f"Found positions for {len(positions)}/{len(matrix_channels)} channels: {list(positions.keys())}")

    if len(positions) < 2:
        logger.warning(f"Not enough channels with positions ({len(positions)}), cannot draw connectivity")
        return b''

    # Collect all connections above threshold
    lines = []
    colors = []
    linewidths = []

    n = len(matrix_channels)
    for i in range(n):
        for j in range(i + 1, n):
            ch1, ch2 = matrix_channels[i], matrix_channels[j]
            if ch1 not in positions or ch2 not in positions:
                continue

            wpli = conn_matrix[i, j]
            if wpli >= threshold:
                pos1 = positions[ch1]
                pos2 = positions[ch2]
                lines.append([(pos1[0], pos1[1]), (pos2[0], pos2[1])])
                colors.append(wpli)
                # Line width proportional to connection strength
                linewidths.append(1 + 4 * wpli)

    # Create colormap for connections - blue (low) to red (high)
    cmap = plt.cm.coolwarm  # blue -> white -> red

    if lines:
        # Use data-adaptive normalization for better color contrast
        data_min = min(colors)
        data_max = max(colors)
        norm = Normalize(vmin=max(threshold, data_min - 0.02), vmax=min(1.0, data_max + 0.05))

        # Create line collection
        lc = LineCollection(lines, cmap=cmap, norm=norm, linewidths=linewidths, alpha=0.7)
        lc.set_array(np.array(colors))
        ax.add_collection(lc)

        # Add colorbar
        sm = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
        sm.set_array([])
        cbar = plt.colorbar(sm, ax=ax, fraction=0.046, pad=0.04, shrink=0.8)
        cbar.set_label('wPLI', rotation=270, labelpad=20)

    # Draw electrodes
    for ch, pos in positions.items():
        # Get node strength if available
        node_strength = network_metrics.get('node_strength', {}).get(ch, 0.5)

        # Node size proportional to strength
        node_size = 200 + 300 * node_strength

        ax.scatter(pos[0], pos[1], s=node_size, c='white', edgecolors='black',
                  linewidths=2, zorder=10)
        ax.text(pos[0], pos[1], ch, ha='center', va='center',
               fontsize=8, fontweight='bold', zorder=11)

    # Add network metrics text if enabled
    if show_metrics and network_metrics:
        metrics_text = []

        if 'global_efficiency' in network_metrics:
            metrics_text.append(f"Global Efficiency: {network_metrics['global_efficiency']:.3f}")
        if 'mean_clustering_coefficient' in network_metrics:
            metrics_text.append(f"Clustering: {network_metrics['mean_clustering_coefficient']:.3f}")
        if 'small_worldness' in network_metrics:
            metrics_text.append(f"Small-worldness: {network_metrics['small_worldness']:.2f}")
        if 'interhemispheric_connectivity' in network_metrics:
            metrics_text.append(f"Interhemispheric: {network_metrics['interhemispheric_connectivity']:.3f}")

        if metrics_text:
            metrics_str = '\n'.join(metrics_text)
            ax.text(0.02, 0.02, metrics_str, transform=ax.transAxes,
                   fontsize=9, verticalalignment='bottom',
                   bbox=dict(boxstyle='round', facecolor='white', alpha=0.8))

    # Set plot properties
    ax.set_xlim(-0.75, 0.75)
    ax.set_ylim(-0.75, 0.75)
    ax.set_aspect('equal')
    ax.axis('off')

    # Set title
    if title is None:
        band_display = band_name.capitalize()
        freq_range = CONNECTIVITY_BANDS.get(band_name, (0, 0))
        title = f'wPLI Connectivity - {band_display} ({freq_range[0]}-{freq_range[1]} Hz) - {condition}'
    ax.set_title(title, fontsize=14, fontweight='bold', pad=20)

    # Save to bytes buffer
    buf = io.BytesIO()
    plt.tight_layout()
    plt.savefig(buf, format='png', dpi=dpi, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    buf.seek(0)

    return buf.read()


def generate_connectivity_grid(
    connectivity_eo: Dict,
    connectivity_ec: Dict,
    ch_names: List[str] = None,
    threshold: float = 0.25,
    dpi: int = 300
) -> bytes:
    """
    Generate a grid of brain connectivity graphs for all bands and conditions.

    Layout adapts based on available data:
    - If both EO and EC: 2 rows (EO and EC), 4 columns (delta, theta, alpha, beta)
    - If only one condition: 1 row, 4 columns

    Args:
        connectivity_eo: Connectivity dict for EO condition from compute_connectivity()
        connectivity_ec: Connectivity dict for EC condition from compute_connectivity()
        ch_names: List of channel names (if None, uses standard 19 channels)
        threshold: Minimum wPLI value to display a connection
        dpi: Resolution in DPI

    Returns:
        PNG image as bytes containing all connectivity graphs in a grid
    """
    logger.info("Generating combined connectivity grid for all bands")

    if ch_names is None:
        ch_names = CHANNEL_NAMES

    # Bands for connectivity (4 main bands)
    band_order = ['delta', 'theta', 'alpha', 'beta']
    n_bands = len(band_order)

    # Determine which conditions have data
    conditions_to_plot = []
    if connectivity_eo is not None and 'connectivity_matrices' in connectivity_eo:
        conditions_to_plot.append(('EO', connectivity_eo))
    if connectivity_ec is not None and 'connectivity_matrices' in connectivity_ec:
        conditions_to_plot.append(('EC', connectivity_ec))

    if not conditions_to_plot:
        logger.warning("No connectivity data available for either condition")
        return b''

    n_rows = len(conditions_to_plot)

    # Create figure with subplots - adjust rows based on available conditions
    fig, axes = plt.subplots(
        n_rows, n_bands,
        figsize=(n_bands * 4, n_rows * 4),
        dpi=dpi
    )

    # Handle single row case (axes is 1D array)
    if n_rows == 1:
        axes = axes.reshape(1, -1)

    # Colormap for connections - blue (low) to red (high)
    cmap = plt.cm.coolwarm  # blue -> white -> red

    # First pass: collect all wPLI values to determine data-adaptive normalization
    all_wpli_values = []
    for cond_idx, (condition, connectivity_data) in enumerate(conditions_to_plot):
        if connectivity_data is None or 'connectivity_matrices' not in connectivity_data:
            continue
        for band_name in band_order:
            if band_name not in connectivity_data['connectivity_matrices']:
                continue
            matrix_data = connectivity_data['connectivity_matrices'][band_name]
            conn_matrix = np.array(matrix_data['matrix'])
            # Get upper triangle values above threshold
            n = conn_matrix.shape[0]
            for i in range(n):
                for j in range(i + 1, n):
                    if conn_matrix[i, j] >= threshold:
                        all_wpli_values.append(conn_matrix[i, j])

    # Use data-adaptive normalization for better color contrast
    if all_wpli_values:
        data_min = min(all_wpli_values)
        data_max = max(all_wpli_values)
        # Add a small margin to make extremes visible
        norm = Normalize(vmin=max(threshold, data_min - 0.02), vmax=min(1.0, data_max + 0.05))
        logger.info(f"Connectivity grid color range: {data_min:.3f} - {data_max:.3f}")
    else:
        norm = Normalize(vmin=threshold, vmax=1.0)

    # Plot each band and condition
    for cond_idx, (condition, connectivity_data) in enumerate(conditions_to_plot):
        for band_idx, band_name in enumerate(band_order):
            ax = axes[cond_idx, band_idx]

            if connectivity_data is None:
                ax.axis('off')
                ax.text(0.5, 0.5, 'No data', ha='center', va='center',
                       transform=ax.transAxes, fontsize=10)
                continue

            # Check if band exists in data
            if 'connectivity_matrices' not in connectivity_data:
                ax.axis('off')
                ax.text(0.5, 0.5, 'No data', ha='center', va='center',
                       transform=ax.transAxes, fontsize=10)
                continue

            if band_name not in connectivity_data['connectivity_matrices']:
                ax.axis('off')
                ax.text(0.5, 0.5, 'No data', ha='center', va='center',
                       transform=ax.transAxes, fontsize=10)
                continue

            matrix_data = connectivity_data['connectivity_matrices'][band_name]
            conn_matrix = np.array(matrix_data['matrix'])
            matrix_channels = matrix_data['channels']

            # Draw head outline
            head_circle = plt.Circle((0, 0), 0.55, fill=False, color='gray',
                                      linewidth=1.5, linestyle='-')
            ax.add_patch(head_circle)

            # Draw nose
            nose_x = [0, 0.04, 0, -0.04, 0]
            nose_y = [0.55, 0.58, 0.62, 0.58, 0.55]
            ax.plot(nose_x, nose_y, color='gray', linewidth=1.5)

            # Get electrode positions - use helper function for normalization
            positions = {}
            for ch in matrix_channels:
                pos = get_electrode_position(ch)
                if pos is not None:
                    positions[ch] = pos

            # Collect connections
            lines = []
            colors = []
            linewidths = []

            n = len(matrix_channels)
            for i in range(n):
                for j in range(i + 1, n):
                    ch1, ch2 = matrix_channels[i], matrix_channels[j]
                    if ch1 not in positions or ch2 not in positions:
                        continue

                    wpli = conn_matrix[i, j]
                    if wpli >= threshold:
                        pos1 = positions[ch1]
                        pos2 = positions[ch2]
                        lines.append([(pos1[0], pos1[1]), (pos2[0], pos2[1])])
                        colors.append(wpli)
                        linewidths.append(0.5 + 2 * wpli)

            # Draw connections
            if lines:
                lc = LineCollection(lines, cmap=cmap, norm=norm,
                                   linewidths=linewidths, alpha=0.6)
                lc.set_array(np.array(colors))
                ax.add_collection(lc)

            # Draw electrodes (smaller for grid view)
            for ch, pos in positions.items():
                ax.scatter(pos[0], pos[1], s=80, c='white', edgecolors='black',
                          linewidths=1, zorder=10)
                ax.text(pos[0], pos[1], ch, ha='center', va='center',
                       fontsize=5, fontweight='bold', zorder=11)

            # Set plot properties
            ax.set_xlim(-0.70, 0.70)
            ax.set_ylim(-0.70, 0.70)
            ax.set_aspect('equal')
            ax.axis('off')

            # Add band title for top row
            if cond_idx == 0:
                freq_range = CONNECTIVITY_BANDS[band_name]
                ax.set_title(f'{band_name.capitalize()}\n{freq_range[0]}-{freq_range[1]} Hz',
                           fontsize=10, fontweight='bold', pad=5)

            # Add condition label on left side
            if band_idx == 0:
                ax.text(-0.15, 0.5, condition, transform=ax.transAxes,
                       fontsize=12, fontweight='bold', rotation=90,
                       ha='center', va='center')

    # Add overall title
    fig.suptitle('Brain Connectivity (wPLI)', fontsize=16, fontweight='bold', y=0.98)

    # Add colorbar
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
    sm.set_array([])
    cbar_ax = fig.add_axes([0.92, 0.15, 0.02, 0.7])
    cbar = plt.colorbar(sm, cax=cbar_ax)
    cbar.set_label('wPLI', rotation=270, labelpad=15)

    # Save to bytes buffer
    buf = io.BytesIO()
    plt.tight_layout(rect=[0, 0, 0.90, 0.96])
    plt.savefig(buf, format='png', dpi=dpi, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    buf.seek(0)

    return buf.read()


def generate_network_metrics_summary(
    connectivity_eo: Dict,
    connectivity_ec: Dict,
    dpi: int = 300
) -> bytes:
    """
    Generate a summary visualization of network metrics.

    When both EO and EC are available, shows comparison bar charts.
    When only one condition is available, shows single condition bar charts.

    Shows bar charts for global efficiency, clustering, small-worldness, and
    interhemispheric connectivity across frequency bands.

    Args:
        connectivity_eo: Connectivity dict for EO condition
        connectivity_ec: Connectivity dict for EC condition
        dpi: Resolution in DPI

    Returns:
        PNG image as bytes
    """
    logger.info("Generating network metrics summary")

    # Determine which conditions have data
    has_eo = connectivity_eo is not None and 'network_metrics' in connectivity_eo
    has_ec = connectivity_ec is not None and 'network_metrics' in connectivity_ec

    if not has_eo and not has_ec:
        logger.warning("No network metrics available for either condition")
        return b''

    # Extract metrics for each band
    bands = ['delta', 'theta', 'alpha', 'beta']
    metrics_names = ['global_efficiency', 'mean_clustering_coefficient',
                    'small_worldness', 'interhemispheric_connectivity']
    metric_labels = ['Global Efficiency', 'Clustering Coef.',
                    'Small-worldness', 'Interhemispheric']

    # Collect data
    eo_data = {metric: [] for metric in metrics_names}
    ec_data = {metric: [] for metric in metrics_names}

    for band in bands:
        for metric in metrics_names:
            # EO
            if has_eo:
                val = connectivity_eo['network_metrics'].get(band, {}).get(metric, 0)
            else:
                val = 0
            eo_data[metric].append(val)

            # EC
            if has_ec:
                val = connectivity_ec['network_metrics'].get(band, {}).get(metric, 0)
            else:
                val = 0
            ec_data[metric].append(val)

    # Create figure with subplots
    fig, axes = plt.subplots(2, 2, figsize=(12, 10), dpi=dpi)
    axes = axes.flatten()

    x = np.arange(len(bands))

    # Determine bar layout based on available conditions
    if has_eo and has_ec:
        # Both conditions - side-by-side bars
        width = 0.35
        for idx, (metric, label) in enumerate(zip(metrics_names, metric_labels)):
            ax = axes[idx]
            eo_vals = eo_data[metric]
            ec_vals = ec_data[metric]

            bars1 = ax.bar(x - width/2, eo_vals, width, label='Eyes Open', color='#1f77b4', alpha=0.8)
            bars2 = ax.bar(x + width/2, ec_vals, width, label='Eyes Closed', color='#ff7f0e', alpha=0.8)

            ax.set_xlabel('Frequency Band', fontsize=11)
            ax.set_ylabel(label, fontsize=11)
            ax.set_title(label, fontsize=12, fontweight='bold')
            ax.set_xticks(x)
            ax.set_xticklabels([b.capitalize() for b in bands])
            ax.legend(loc='upper right')
            ax.grid(axis='y', alpha=0.3)

            # Add value labels on bars
            for bar in bars1:
                height = bar.get_height()
                if height > 0.001:
                    ax.annotate(f'{height:.2f}',
                              xy=(bar.get_x() + bar.get_width() / 2, height),
                              xytext=(0, 3),
                              textcoords="offset points",
                              ha='center', va='bottom', fontsize=8)
            for bar in bars2:
                height = bar.get_height()
                if height > 0.001:
                    ax.annotate(f'{height:.2f}',
                              xy=(bar.get_x() + bar.get_width() / 2, height),
                              xytext=(0, 3),
                              textcoords="offset points",
                              ha='center', va='bottom', fontsize=8)

        title = 'Network Metrics: EO vs EC Comparison'
    else:
        # Single condition - centered bars
        condition_name = 'Eyes Open' if has_eo else 'Eyes Closed'
        condition_data = eo_data if has_eo else ec_data
        color = '#1f77b4' if has_eo else '#ff7f0e'
        width = 0.6

        for idx, (metric, label) in enumerate(zip(metrics_names, metric_labels)):
            ax = axes[idx]
            vals = condition_data[metric]

            bars = ax.bar(x, vals, width, label=condition_name, color=color, alpha=0.8)

            ax.set_xlabel('Frequency Band', fontsize=11)
            ax.set_ylabel(label, fontsize=11)
            ax.set_title(label, fontsize=12, fontweight='bold')
            ax.set_xticks(x)
            ax.set_xticklabels([b.capitalize() for b in bands])
            ax.legend(loc='upper right')
            ax.grid(axis='y', alpha=0.3)

            # Add value labels on bars
            for bar in bars:
                height = bar.get_height()
                if height > 0.001:
                    ax.annotate(f'{height:.2f}',
                              xy=(bar.get_x() + bar.get_width() / 2, height),
                              xytext=(0, 3),
                              textcoords="offset points",
                              ha='center', va='bottom', fontsize=8)

        title = f'Network Metrics: {condition_name}'

    fig.suptitle(title, fontsize=14, fontweight='bold', y=0.98)

    # Save to bytes buffer
    buf = io.BytesIO()
    plt.tight_layout(rect=[0, 0, 1, 0.96])
    plt.savefig(buf, format='png', dpi=dpi, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    buf.seek(0)

    return buf.read()


def compress_png(png_bytes: bytes, quality: int = 85) -> bytes:
    """
    Compress PNG image to reduce file size.

    Args:
        png_bytes: Input PNG as bytes
        quality: Compression quality (1-100, higher = better quality)

    Returns:
        Compressed PNG as bytes
    """
    # Open image from bytes
    img = Image.open(io.BytesIO(png_bytes))

    # Save with optimization
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True, quality=quality)
    buf.seek(0)

    return buf.read()


def generate_topomap_grid(
    band_power_data: Dict[str, Dict[str, np.ndarray]],
    ch_names: List[str],
    conditions: List[str] = ['EO', 'EC'],
    dpi: int = 300
) -> bytes:
    """
    Generate a grid of topomaps for all bands and conditions in a single image.

    Layout: 2 rows (EO and EC), 8 columns (bands ordered by frequency)

    Args:
        band_power_data: Dict with structure {band: {condition: power_array}}
        ch_names: List of channel names
        conditions: List of conditions to generate
        dpi: Resolution in DPI

    Returns:
        PNG image as bytes containing all topomaps in a grid
    """
    logger.info("Generating combined topomap grid for all bands")
    logger.info(f"Input channel names: {ch_names}")

    # Bands ordered by frequency (low to high)
    band_order = ['delta', 'theta', 'alpha1', 'alpha2', 'smr', 'beta2', 'hibeta', 'lowgamma']
    n_bands = len(band_order)
    n_conditions = len(conditions)

    # Normalize channel names for MNE compatibility
    normalized_ch_names, ch_mapping = normalize_channel_names_for_mne(ch_names)
    logger.info(f"Normalized channel names: {normalized_ch_names}")

    # Create MNE Info object with normalized names
    info = mne.create_info(ch_names=normalized_ch_names, sfreq=250, ch_types='eeg')
    montage = mne.channels.make_standard_montage('standard_1020')
    info.set_montage(montage, on_missing='warn')

    # Create figure with subplots: 4 columns x 2 rows per condition
    # Layout: 2 rows of bands per condition (8 bands total = 4 per row)
    n_rows_per_condition = 2
    n_cols = 4
    total_rows = n_conditions * n_rows_per_condition

    fig, axes = plt.subplots(
        total_rows, n_cols,
        figsize=(n_cols * 4, total_rows * 3),
        dpi=dpi
    )

    # Ensure axes is 2D
    axes = np.atleast_2d(axes)

    # English display names for frequency bands
    band_display_names = {
        'delta': 'Delta',
        'theta': 'Theta',
        'alpha1': 'A1',
        'alpha2': 'A2',
        'smr': 'SMR',
        'beta2': 'B2',
        'hibeta': 'HiB',
        'lowgamma': 'LowG',
    }

    # Plot each band and condition
    for cond_idx, condition in enumerate(conditions):
        for band_idx, band_name in enumerate(band_order):
            # Calculate row and column for 4x2 layout per condition
            row_within_condition = band_idx // n_cols
            col = band_idx % n_cols
            row = cond_idx * n_rows_per_condition + row_within_condition
            ax = axes[row, col]

            # Check if data exists for this band/condition
            if band_name not in band_power_data or condition not in band_power_data[band_name]:
                ax.axis('off')
                ax.text(0.5, 0.5, 'No data', ha='center', va='center', transform=ax.transAxes)
                continue

            power_values = band_power_data[band_name][condition]

            # Get global vmin/vmax for this band across all conditions
            all_values = []
            for cond in conditions:
                if condition in band_power_data.get(band_name, {}):
                    all_values.extend(band_power_data[band_name][cond])

            vmin = np.percentile(all_values, 2) if all_values else None
            vmax = np.percentile(all_values, 98) if all_values else None

            # Generate topomap
            im, _ = mne.viz.plot_topomap(
                power_values,
                info,
                axes=ax,
                show=False,
                vlim=(vmin, vmax) if vmin and vmax else None,
                cmap=create_blue_red_cmap(),
                contours=4,
                res=64,  # Lower res for grid view
                sensors=False,  # Hide sensors for cleaner look
                names=None,  # No channel labels
            )

            # Add title with English band names
            freq_range = BANDS[band_name]
            band_display = band_display_names.get(band_name, band_name.capitalize())
            ax.set_title(f'{band_display}\n{freq_range[0]}-{freq_range[1]} Hz',
                       fontsize=10, fontweight='bold', pad=5)

            # Add condition label on left side (first column of each condition's rows)
            if col == 0 and row_within_condition == 0:
                ax.text(-0.35, 0.5, condition, transform=ax.transAxes,
                       fontsize=14, fontweight='bold', rotation=90,
                       ha='center', va='center')

    # Add overall title
    fig.suptitle('Band Power Topographic Maps', fontsize=16, fontweight='bold', y=0.98)

    # Add colorbar
    cbar_ax = fig.add_axes([0.92, 0.15, 0.015, 0.7])
    plt.colorbar(im, cax=cbar_ax, label='Power (μV²/Hz)')

    # Save to bytes buffer
    buf = io.BytesIO()
    plt.tight_layout(rect=[0, 0, 0.91, 0.96])
    plt.savefig(buf, format='png', dpi=dpi, bbox_inches='tight')
    plt.close(fig)
    buf.seek(0)

    return buf.read()


def generate_all_topomaps(
    band_power_data: Dict[str, Dict[str, np.ndarray]],
    ch_names: List[str],
    conditions: List[str] = ['EO', 'EC']
) -> Dict[str, bytes]:
    """
    Generate topomaps for all bands and conditions.

    Args:
        band_power_data: Dict with structure {band: {condition: power_array}}
        ch_names: List of channel names
        conditions: List of conditions to generate

    Returns:
        Dict mapping 'topomap_{band}_{condition}' to PNG bytes
    """
    results = {}

    for band_name in BANDS.keys():
        if band_name not in band_power_data:
            continue

        # Get global vmin/vmax across all conditions for this band
        all_values = []
        for cond in conditions:
            if cond in band_power_data[band_name]:
                all_values.extend(band_power_data[band_name][cond])

        if not all_values:
            continue

        vmin = np.percentile(all_values, 2)
        vmax = np.percentile(all_values, 98)

        # Generate topomap for each condition
        for condition in conditions:
            if condition not in band_power_data[band_name]:
                continue

            power_values = band_power_data[band_name][condition]

            png_bytes = generate_topomap(
                power_values=power_values,
                ch_names=ch_names,
                band_name=band_name,
                condition=condition,
                vmin=vmin,
                vmax=vmax
            )

            # Compress PNG
            png_bytes = compress_png(png_bytes)

            # Store result
            key = f'topomap_{band_name}_{condition}'
            results[key] = png_bytes
            logger.info(f"Generated {key} ({len(png_bytes) / 1024:.1f} KB)")

    return results


if __name__ == '__main__':
    # Test visualization generation
    logger.info("Testing visualization generation...")

    # Create dummy data for testing
    n_channels = 19
    test_power = np.random.rand(n_channels) * 10 + 5

    # Test topomap
    topomap_png = generate_topomap(
        power_values=test_power,
        ch_names=CHANNEL_NAMES,
        band_name='alpha1',
        condition='EC'
    )
    logger.info(f"Generated test topomap: {len(topomap_png) / 1024:.1f} KB")

    # Test PSD
    freqs = np.linspace(0.5, 45, 200)
    psd_eo = np.random.rand(200) * 10
    psd_ec = np.random.rand(200) * 12
    psd_png = generate_psd_plot(
        psd_data={'EO': psd_eo, 'EC': psd_ec},
        freqs=freqs,
        ch_name='Cz'
    )
    logger.info(f"Generated test PSD plot: {len(psd_png) / 1024:.1f} KB")

    logger.info("Visualization tests complete!")
