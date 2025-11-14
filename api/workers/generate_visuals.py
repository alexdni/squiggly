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
        vmin=vmin,
        vmax=vmax,
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
