#!/usr/bin/env python3
"""
EEG Analysis Orchestrator

Main script that orchestrates the full EEG analysis pipeline:
1. Downloads EDF file from Supabase storage
2. Preprocesses the data
3. Extracts features
4. Uploads results back to Supabase

Can be run as a standalone script or worker process
"""

import os
import sys
import json
import logging
import tempfile
import time
from pathlib import Path
from typing import Dict, Optional
import argparse

# Import our modules
from preprocess import preprocess_eeg
from extract_features import extract_features
from generate_visuals import generate_all_topomaps, generate_psd_plot, generate_apf_plot, generate_spectrogram

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def download_from_supabase(file_path: str, supabase_url: str, supabase_key: str) -> str:
    """
    Download EDF file from Supabase storage

    Args:
        file_path: Path in Supabase storage (e.g., 'recordings/uuid/file.edf')
        supabase_url: Supabase project URL
        supabase_key: Supabase service role key

    Returns:
        Path to downloaded temporary file
    """
    try:
        from supabase import create_client, Client

        logger.info(f"Downloading file from Supabase: {file_path}")

        supabase: Client = create_client(supabase_url, supabase_key)

        # File path is stored without bucket name (just projectId/filename)
        # Bucket is always 'recordings'
        bucket_name = 'recordings'
        object_path = file_path

        logger.info(f"Downloading from bucket '{bucket_name}', path: {object_path}")

        # Download file
        response = supabase.storage.from_(bucket_name).download(object_path)

        # Save to temporary file
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.edf')
        temp_file.write(response)
        temp_file.close()

        logger.info(f"Downloaded to: {temp_file.name}")
        return temp_file.name

    except ImportError:
        logger.error("supabase-py not installed. Install with: pip install supabase")
        raise
    except Exception as e:
        logger.error(f"Failed to download file: {e}")
        raise


def convert_numpy_types(obj):
    """
    Recursively convert NumPy types to native Python types for JSON serialization

    Args:
        obj: Object to convert (can be dict, list, numpy type, etc.)

    Returns:
        Object with all NumPy types converted to native Python types
    """
    import numpy as np

    if isinstance(obj, dict):
        return {key: convert_numpy_types(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_numpy_types(item) for item in obj]
    elif isinstance(obj, np.bool_):
        return bool(obj)
    elif isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return convert_numpy_types(obj.tolist())
    else:
        return obj


def upload_visual_to_supabase(
    png_bytes: bytes,
    file_name: str,
    analysis_id: str,
    supabase_url: str,
    supabase_key: str
) -> Optional[str]:
    """
    Upload a visual asset (PNG) to Supabase Storage

    Args:
        png_bytes: PNG image as bytes
        file_name: Name for the file (e.g., 'topomap_alpha1_EO.png')
        analysis_id: Analysis UUID
        supabase_url: Supabase project URL
        supabase_key: Supabase service role key

    Returns:
        Public URL of uploaded file, or None if failed
    """
    try:
        from supabase import create_client, Client

        supabase: Client = create_client(supabase_url, supabase_key)

        # Upload to visuals bucket
        bucket_name = 'visuals'
        object_path = f'{analysis_id}/{file_name}'

        logger.info(f"Uploading visual: {object_path}")

        supabase.storage.from_(bucket_name).upload(
            object_path,
            png_bytes,
            file_options={"content-type": "image/png"}
        )

        # Get public URL
        url = supabase.storage.from_(bucket_name).get_public_url(object_path)

        return url

    except Exception as e:
        logger.error(f"Failed to upload visual {file_name}: {e}")
        return None


def upload_results_to_supabase(
    analysis_id: str,
    results: Dict,
    supabase_url: str,
    supabase_key: str
) -> bool:
    """
    Upload analysis results to Supabase

    Args:
        analysis_id: Analysis UUID
        results: Results dictionary
        supabase_url: Supabase project URL
        supabase_key: Supabase service role key

    Returns:
        True if successful
    """
    try:
        from supabase import create_client, Client

        logger.info(f"Uploading results for analysis: {analysis_id}")

        supabase: Client = create_client(supabase_url, supabase_key)

        # Convert NumPy types to native Python types for JSON serialization
        results_serializable = convert_numpy_types(results)

        # Update analysis record
        response = supabase.table('analyses').update({
            'status': 'completed',
            'results': results_serializable,
            'completed_at': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())
        }).eq('id', analysis_id).execute()

        logger.info("Results uploaded successfully")
        return True

    except ImportError:
        logger.error("supabase-py not installed. Install with: pip install supabase")
        raise
    except Exception as e:
        logger.error(f"Failed to upload results: {e}")
        raise


def mark_analysis_failed(
    analysis_id: str,
    error_message: str,
    supabase_url: str,
    supabase_key: str
) -> bool:
    """
    Mark analysis as failed in Supabase

    Args:
        analysis_id: Analysis UUID
        error_message: Error description
        supabase_url: Supabase project URL
        supabase_key: Supabase service role key

    Returns:
        True if successful
    """
    try:
        from supabase import create_client, Client

        logger.info(f"Marking analysis as failed: {analysis_id}")

        supabase: Client = create_client(supabase_url, supabase_key)

        response = supabase.table('analyses').update({
            'status': 'failed',
            'error_log': error_message,
            'completed_at': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())
        }).eq('id', analysis_id).execute()

        return True

    except Exception as e:
        logger.error(f"Failed to mark analysis as failed: {e}")
        return False


def analyze_eeg_file(
    file_path: str,
    eo_start: float,
    eo_end: float,
    ec_start: float,
    ec_end: float,
    config: Optional[Dict] = None
) -> Dict:
    """
    Run complete EEG analysis pipeline

    Args:
        file_path: Path to EDF file (local or to download)
        eo_start: Eyes open segment start (seconds)
        eo_end: Eyes open segment end (seconds)
        ec_start: Eyes closed segment start (seconds)
        ec_end: Eyes closed segment end (seconds)
        config: Analysis configuration

    Returns:
        Dictionary of results
    """
    logger.info("="*80)
    logger.info("Starting EEG Analysis Pipeline")
    logger.info("="*80)

    start_time = time.time()

    try:
        # Step 1: Preprocessing
        logger.info("STEP 1: Preprocessing")
        logger.info("-"*80)

        preprocess_config = config.get('preprocessing', {}) if config else {}
        preprocess_result = preprocess_eeg(
            file_path,
            eo_start,
            eo_end,
            ec_start,
            ec_end,
            preprocess_config
        )

        epochs_eo = preprocess_result['epochs_eo']
        epochs_ec = preprocess_result['epochs_ec']
        qc_metrics = preprocess_result['qc_metrics']

        n_eo = len(epochs_eo) if epochs_eo is not None else 0
        n_ec = len(epochs_ec) if epochs_ec is not None else 0
        logger.info(f"Preprocessing complete: {n_eo} EO epochs, {n_ec} EC epochs")

        # Step 2: Feature Extraction
        logger.info("")
        logger.info("STEP 2: Feature Extraction")
        logger.info("-"*80)

        features = extract_features(epochs_eo, epochs_ec)

        logger.info("Feature extraction complete")

        # Step 3: Generate Visualizations
        logger.info("")
        logger.info("STEP 3: Generating Visualizations")
        logger.info("-"*80)

        visuals = {}

        try:
            import numpy as np

            # Get channel names from epochs
            if epochs_eo is not None:
                ch_names = epochs_eo.ch_names
            elif epochs_ec is not None:
                ch_names = epochs_ec.ch_names
            else:
                ch_names = []

            # Prepare band power data for topomaps
            # Note: extract_features returns 'eo' and 'ec' as keys
            band_power_eo_dict = features['band_power'].get('eo', {})
            band_power_ec_dict = features['band_power'].get('ec', {})

            # Restructure data by band instead of by condition
            band_power_data = {}

            # Get all bands from whichever condition is available
            all_bands = set()
            if band_power_eo_dict:
                # Get bands from first channel
                first_ch = next(iter(band_power_eo_dict.keys()), None)
                if first_ch:
                    all_bands.update(band_power_eo_dict[first_ch].keys())
            if band_power_ec_dict:
                first_ch = next(iter(band_power_ec_dict.keys()), None)
                if first_ch:
                    all_bands.update(band_power_ec_dict[first_ch].keys())

            for band in all_bands:
                band_power_data[band] = {}

                # EO condition
                if band_power_eo_dict:
                    band_power_eo = []
                    for ch in ch_names:
                        if ch in band_power_eo_dict and band in band_power_eo_dict[ch]:
                            band_power_eo.append(band_power_eo_dict[ch][band]['absolute'])
                    if len(band_power_eo) == len(ch_names):
                        band_power_data[band]['EO'] = np.array(band_power_eo)

                # EC condition
                if band_power_ec_dict:
                    band_power_ec = []
                    for ch in ch_names:
                        if ch in band_power_ec_dict and band in band_power_ec_dict[ch]:
                            band_power_ec.append(band_power_ec_dict[ch][band]['absolute'])
                    if len(band_power_ec) == len(ch_names):
                        band_power_data[band]['EC'] = np.array(band_power_ec)

            # Generate all topomaps
            conditions = []
            if epochs_eo is not None:
                conditions.append('EO')
            if epochs_ec is not None:
                conditions.append('EC')

            if conditions and band_power_data:
                topomap_visuals = generate_all_topomaps(
                    band_power_data=band_power_data,
                    ch_names=ch_names,
                    conditions=conditions
                )
                visuals.update(topomap_visuals)
                logger.info(f"Generated {len(topomap_visuals)} topomaps")

            logger.info("Visualization generation complete")

        except Exception as e:
            logger.warning(f"Failed to generate some visualizations: {e}")
            # Continue anyway - visuals are optional

        # Step 4: Compile Results
        logger.info("")
        logger.info("STEP 4: Compiling Results")
        logger.info("-"*80)

        processing_time = time.time() - start_time

        results = {
            'qc_report': qc_metrics,
            'band_power': features['band_power'],
            'coherence': features['coherence'],
            'band_ratios': features['band_ratios'],
            'asymmetry': features['asymmetry'],
            'risk_patterns': features['risk_patterns'],
            'visuals': visuals,  # Add visuals to results
            'processing_metadata': {
                'preprocessing_config': preprocess_config,
                'processing_time_seconds': round(processing_time, 2),
                'mne_version': __import__('mne').__version__,
                'numpy_version': __import__('numpy').__version__,
                'scipy_version': __import__('scipy').__version__,
            }
        }

        logger.info("="*80)
        logger.info(f"Analysis Complete! Total time: {processing_time:.2f}s")
        logger.info("="*80)

        return results

    except Exception as e:
        logger.error(f"Analysis failed: {e}", exc_info=True)
        raise


def main():
    """Main entry point for CLI and worker usage"""

    parser = argparse.ArgumentParser(description='EEG Analysis Worker')
    parser.add_argument('--file', type=str, help='Path to EDF file')
    parser.add_argument('--eo-start', type=float, help='Eyes open start (seconds)')
    parser.add_argument('--eo-end', type=float, help='Eyes open end (seconds)')
    parser.add_argument('--ec-start', type=float, help='Eyes closed start (seconds)')
    parser.add_argument('--ec-end', type=float, help='Eyes closed end (seconds)')
    parser.add_argument('--output', type=str, help='Output JSON file path')

    # Supabase integration
    parser.add_argument('--analysis-id', type=str, help='Analysis UUID (for Supabase integration)')
    parser.add_argument('--supabase-url', type=str, help='Supabase project URL')
    parser.add_argument('--supabase-key', type=str, help='Supabase service role key')
    parser.add_argument('--storage-path', type=str, help='Path in Supabase storage')

    # Configuration
    parser.add_argument('--config', type=str, help='JSON configuration file')

    args = parser.parse_args()

    # Load config if provided
    config = {}
    if args.config:
        with open(args.config, 'r') as f:
            config = json.load(f)

    # Check if we're running in Supabase mode or local mode
    if args.analysis_id and args.supabase_url and args.supabase_key:
        # Supabase worker mode
        logger.info(f"Running in Supabase worker mode for analysis: {args.analysis_id}")

        try:
            # Get analysis details from Supabase
            from supabase import create_client
            supabase = create_client(args.supabase_url, args.supabase_key)

            response = supabase.table('analyses').select(
                '*, recording:recordings(file_path, eo_start, eo_end, ec_start, ec_end)'
            ).eq('id', args.analysis_id).single().execute()

            analysis = response.data
            recording = analysis['recording']

            # Download file
            local_file = download_from_supabase(
                recording['file_path'],
                args.supabase_url,
                args.supabase_key
            )

            # Run analysis
            results = analyze_eeg_file(
                local_file,
                recording['eo_start'],
                recording['eo_end'],
                recording['ec_start'],
                recording['ec_end'],
                analysis.get('config', {})
            )

            # Upload visualizations to Supabase Storage
            if 'visuals' in results and results['visuals']:
                logger.info("Uploading visualization assets to Supabase Storage")
                visual_urls = {}

                for visual_name, png_bytes in results['visuals'].items():
                    file_name = f'{visual_name}.png'
                    url = upload_visual_to_supabase(
                        png_bytes,
                        file_name,
                        args.analysis_id,
                        args.supabase_url,
                        args.supabase_key
                    )
                    if url:
                        visual_urls[visual_name] = url
                    else:
                        logger.warning(f"Failed to upload {visual_name}, skipping")

                # Replace PNG bytes with URLs in results (always replace, even if empty)
                results['visuals'] = visual_urls
                logger.info(f"Uploaded {len(visual_urls)} visualization assets")
            else:
                # Ensure visuals is not present or is empty dict if no visuals generated
                results['visuals'] = {}

            # Upload results
            upload_results_to_supabase(
                args.analysis_id,
                results,
                args.supabase_url,
                args.supabase_key
            )

            # Clean up temp file
            os.unlink(local_file)

            logger.info("Analysis complete and results uploaded")
            return 0

        except Exception as e:
            logger.error(f"Analysis failed: {e}", exc_info=True)

            # Mark as failed in Supabase
            mark_analysis_failed(
                args.analysis_id,
                str(e),
                args.supabase_url,
                args.supabase_key
            )

            return 1

    elif args.file and args.eo_start is not None and args.eo_end is not None \
            and args.ec_start is not None and args.ec_end is not None:
        # Local file mode
        logger.info(f"Running in local file mode: {args.file}")

        try:
            results = analyze_eeg_file(
                args.file,
                args.eo_start,
                args.eo_end,
                args.ec_start,
                args.ec_end,
                config
            )

            # Output results
            if args.output:
                with open(args.output, 'w') as f:
                    json.dump(results, f, indent=2)
                logger.info(f"Results saved to: {args.output}")
            else:
                print(json.dumps(results, indent=2))

            return 0

        except Exception as e:
            logger.error(f"Analysis failed: {e}", exc_info=True)
            return 1

    else:
        parser.print_help()
        return 1


if __name__ == '__main__':
    sys.exit(main())
