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

        # Update analysis record
        response = supabase.table('analyses').update({
            'status': 'completed',
            'results': results,
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

        logger.info(f"Preprocessing complete: {len(epochs_eo)} EO epochs, {len(epochs_ec)} EC epochs")

        # Step 2: Feature Extraction
        logger.info("")
        logger.info("STEP 2: Feature Extraction")
        logger.info("-"*80)

        features = extract_features(epochs_eo, epochs_ec)

        logger.info("Feature extraction complete")

        # Step 3: Compile Results
        logger.info("")
        logger.info("STEP 3: Compiling Results")
        logger.info("-"*80)

        processing_time = time.time() - start_time

        results = {
            'qc_report': qc_metrics,
            'band_power': features['band_power'],
            'coherence': features['coherence'],
            'band_ratios': features['band_ratios'],
            'asymmetry': features['asymmetry'],
            'risk_patterns': features['risk_patterns'],
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
