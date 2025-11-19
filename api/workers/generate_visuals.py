#!/usr/bin/env python3
"""
EEG Visualization Generation Module

Generates publication-quality visualizations for EEG analysis results:
- Topographic brainmaps (topomaps) for each band and condition
- Spectrograms for each channel
- Power Spectral Density (PSD) plots
- Alpha Peak Frequency (APF) visualizations
- Coherence matrices
- QC dashboards
"""

import numpy as np
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend for server-side rendering
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
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

    # Create MNE Info object with standard montage
    info = mne.create_info(ch_names=ch_names, sfreq=250, ch_types='eeg')
    montage = mne.channels.make_standard_montage('standard_1020')
    info.set_montage(montage)

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

    # Extract LZC values in channel order
    key = 'normalized_lzc' if use_normalized else 'lzc'
    complexity_values = np.array([
        lzc_values[ch][key] if ch in lzc_values else 0.0
        for ch in ch_names
    ])

    # Create MNE Info object with standard montage
    info = mne.create_info(ch_names=ch_names, sfreq=250, ch_types='eeg')
    montage = mne.channels.make_standard_montage('standard_1020')
    info.set_montage(montage)

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

    # Extract peak frequencies in channel order
    peak_frequencies = np.array([
        alpha_peak_values[ch]['peak_frequency'] if ch in alpha_peak_values else 0.0
        for ch in ch_names
    ])

    # Create MNE Info object with standard montage
    info = mne.create_info(ch_names=ch_names, sfreq=250, ch_types='eeg')
    montage = mne.channels.make_standard_montage('standard_1020')
    info.set_montage(montage)

    # Set color scale for alpha frequencies (8-12 Hz range)
    vmin = 8.0
    vmax = 12.0

    # Create figure with two subplots: topomap on left, table on right
    fig = plt.figure(figsize=(12, 6), dpi=dpi)

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
    table.scale(1, 1.5)

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

    ax_table.set_title('Peak Frequencies by Channel', fontsize=12, fontweight='bold', pad=20)

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


def generate_coherence_matrix(
    coherence_data: List[Dict],
    band_name: str,
    condition: str,
    ch_names: List[str] = None,
    title: Optional[str] = None,
    dpi: int = 300
) -> bytes:
    """
    Generate a coherence matrix heatmap for a specific band and condition.

    Args:
        coherence_data: List of coherence dicts from extract_features
                       Each dict has: {ch1, ch2, type, delta, theta, ...}
        band_name: Frequency band (e.g., 'alpha1')
        condition: Condition label (e.g., 'EO', 'EC')
        ch_names: List of channel names (if None, uses standard 19 channels)
        title: Custom title (if None, auto-generated)
        dpi: Resolution in DPI

    Returns:
        PNG image as bytes
    """
    logger.info(f"Generating coherence matrix for {band_name} - {condition}")

    if ch_names is None:
        ch_names = CHANNEL_NAMES

    n_channels = len(ch_names)

    # Initialize matrix with NaN (for missing pairs)
    coherence_matrix = np.full((n_channels, n_channels), np.nan)

    # Set diagonal to 1.0 (perfect self-coherence)
    np.fill_diagonal(coherence_matrix, 1.0)

    # Fill matrix from coherence data
    for coh_pair in coherence_data:
        ch1 = coh_pair['ch1']
        ch2 = coh_pair['ch2']

        if ch1 not in ch_names or ch2 not in ch_names:
            continue

        if band_name not in coh_pair:
            continue

        idx1 = ch_names.index(ch1)
        idx2 = ch_names.index(ch2)
        coh_value = coh_pair[band_name]

        # Fill both symmetric positions
        coherence_matrix[idx1, idx2] = coh_value
        coherence_matrix[idx2, idx1] = coh_value

    # Create figure
    fig, ax = plt.subplots(figsize=(10, 8), dpi=dpi)

    # Plot heatmap
    im = ax.imshow(
        coherence_matrix,
        cmap='plasma',  # Sequential colormap (purple to yellow)
        vmin=0.0,
        vmax=1.0,
        aspect='auto',
        interpolation='nearest'
    )

    # Add colorbar
    cbar = plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    cbar.set_label('Coherence', rotation=270, labelpad=20)

    # Set ticks and labels
    ax.set_xticks(np.arange(n_channels))
    ax.set_yticks(np.arange(n_channels))
    ax.set_xticklabels(ch_names, fontsize=8, rotation=45, ha='right')
    ax.set_yticklabels(ch_names, fontsize=8)

    # Add grid
    ax.set_xticks(np.arange(n_channels) - 0.5, minor=True)
    ax.set_yticks(np.arange(n_channels) - 0.5, minor=True)
    ax.grid(which='minor', color='white', linestyle='-', linewidth=0.5)

    # Set title
    if title is None:
        band_display = band_name.replace('alpha', 'Alpha ').replace('beta', 'Beta ')
        title = f'Coherence Matrix - {band_display.capitalize()} ({condition})'
    ax.set_title(title, fontsize=14, fontweight='bold', pad=20)

    # Save to bytes buffer
    buf = io.BytesIO()
    plt.tight_layout()
    plt.savefig(buf, format='png', dpi=dpi, bbox_inches='tight')
    plt.close(fig)
    buf.seek(0)

    return buf.read()


def generate_coherence_grid(
    coherence_eo: List[Dict],
    coherence_ec: List[Dict],
    ch_names: List[str] = None,
    dpi: int = 300
) -> bytes:
    """
    Generate a grid of coherence matrices for all bands and conditions.

    Layout: 2 rows (EO and EC), 8 columns (all bands)

    Args:
        coherence_eo: List of coherence dicts for EO condition
        coherence_ec: List of coherence dicts for EC condition
        ch_names: List of channel names (if None, uses standard 19 channels)
        dpi: Resolution in DPI

    Returns:
        PNG image as bytes containing all coherence matrices in a grid
    """
    logger.info("Generating combined coherence grid for all bands")

    if ch_names is None:
        ch_names = CHANNEL_NAMES

    # Bands ordered by frequency
    band_order = ['delta', 'theta', 'alpha1', 'alpha2', 'smr', 'beta2', 'hibeta', 'lowgamma']
    n_bands = len(band_order)
    n_channels = len(ch_names)

    # Create figure with subplots
    fig, axes = plt.subplots(
        2, n_bands,
        figsize=(n_bands * 2.5, 2 * 2.5),
        dpi=dpi
    )

    # Plot each band and condition
    for cond_idx, (coherence_data, condition) in enumerate([(coherence_eo, 'EO'), (coherence_ec, 'EC')]):
        for band_idx, band_name in enumerate(band_order):
            ax = axes[cond_idx, band_idx]

            if coherence_data is None:
                ax.axis('off')
                ax.text(0.5, 0.5, 'No data', ha='center', va='center', transform=ax.transAxes, fontsize=8)
                continue

            # Initialize matrix with NaN
            coherence_matrix = np.full((n_channels, n_channels), np.nan)
            np.fill_diagonal(coherence_matrix, 1.0)

            # Fill matrix from coherence data
            for coh_pair in coherence_data:
                ch1 = coh_pair['ch1']
                ch2 = coh_pair['ch2']

                if ch1 not in ch_names or ch2 not in ch_names:
                    continue
                if band_name not in coh_pair:
                    continue

                idx1 = ch_names.index(ch1)
                idx2 = ch_names.index(ch2)
                coh_value = coh_pair[band_name]

                coherence_matrix[idx1, idx2] = coh_value
                coherence_matrix[idx2, idx1] = coh_value

            # Plot heatmap
            im = ax.imshow(
                coherence_matrix,
                cmap='plasma',
                vmin=0.0,
                vmax=1.0,
                aspect='auto',
                interpolation='nearest'
            )

            # Minimal tick labels (only show every 3rd channel)
            tick_indices = list(range(0, n_channels, 3))
            ax.set_xticks(tick_indices)
            ax.set_yticks(tick_indices)
            ax.set_xticklabels([ch_names[i] for i in tick_indices], fontsize=6, rotation=45, ha='right')
            ax.set_yticklabels([ch_names[i] for i in tick_indices], fontsize=6)

            # Add title for top row (band names)
            if cond_idx == 0:
                band_display = band_name.replace('alpha', 'α').replace('beta', 'β').replace('theta', 'θ').replace('delta', 'δ').replace('gamma', 'γ')
                freq_range = BANDS[band_name]
                ax.set_title(f'{band_display.upper()}\n{freq_range[0]}-{freq_range[1]} Hz',
                           fontsize=8, fontweight='bold', pad=3)

            # Add condition label on left side
            if band_idx == 0:
                ax.text(-0.15, 0.5, condition, transform=ax.transAxes,
                       fontsize=10, fontweight='bold', rotation=90,
                       ha='center', va='center')

    # Add overall title
    fig.suptitle('Inter-Channel Coherence Matrices', fontsize=14, fontweight='bold', y=0.98)

    # Add colorbar
    cbar_ax = fig.add_axes([0.92, 0.15, 0.015, 0.7])
    plt.colorbar(im, cax=cbar_ax, label='Coherence')

    # Save to bytes buffer
    buf = io.BytesIO()
    plt.tight_layout(rect=[0, 0, 0.91, 0.96])
    plt.savefig(buf, format='png', dpi=dpi, bbox_inches='tight')
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

    # Bands ordered by frequency (low to high)
    band_order = ['delta', 'theta', 'alpha1', 'alpha2', 'smr', 'beta2', 'hibeta', 'lowgamma']
    n_bands = len(band_order)
    n_conditions = len(conditions)

    # Create MNE Info object
    info = mne.create_info(ch_names=ch_names, sfreq=250, ch_types='eeg')
    montage = mne.channels.make_standard_montage('standard_1020')
    info.set_montage(montage)

    # Create figure with subplots
    fig, axes = plt.subplots(
        n_conditions, n_bands,
        figsize=(n_bands * 3, n_conditions * 2.5),
        dpi=dpi
    )

    # Ensure axes is 2D even if only one condition
    if n_conditions == 1:
        axes = axes.reshape(1, -1)

    # Plot each band and condition
    for cond_idx, condition in enumerate(conditions):
        for band_idx, band_name in enumerate(band_order):
            ax = axes[cond_idx, band_idx]

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

            # Add title for top row (band names)
            if cond_idx == 0:
                band_display = band_name.replace('alpha', 'α').replace('beta', 'β').replace('theta', 'θ').replace('delta', 'δ').replace('gamma', 'γ')
                freq_range = BANDS[band_name]
                ax.set_title(f'{band_display.upper()}\n{freq_range[0]}-{freq_range[1]} Hz',
                           fontsize=9, fontweight='bold', pad=5)

            # Add condition label on left side
            if band_idx == 0:
                ax.text(-0.3, 0.5, condition, transform=ax.transAxes,
                       fontsize=12, fontweight='bold', rotation=90,
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
