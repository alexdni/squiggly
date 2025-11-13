#!/usr/bin/env python3
"""
Flask server for EEG Analysis Worker

Provides HTTP endpoints for Vercel/Supabase to call.
Deploy this to Railway, Render, or any platform that supports Python.
"""

from flask import Flask, request, jsonify
import os
import logging
import tempfile
from analyze_eeg import analyze_eeg_file, download_from_supabase, upload_results_to_supabase, mark_analysis_failed

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Authentication token (optional)
AUTH_TOKEN = os.getenv('WORKER_AUTH_TOKEN', '')


def verify_auth():
    """Verify authorization header if AUTH_TOKEN is set"""
    if not AUTH_TOKEN:
        return True  # No auth required

    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        token = auth_header[7:]
        return token == AUTH_TOKEN

    return False


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'eeg-analysis-worker',
        'version': '1.0.0'
    })


@app.route('/analyze', methods=['POST'])
def analyze():
    """
    Main analysis endpoint

    Expected JSON body:
    {
        "analysis_id": "uuid",
        "file_path": "recordings/uuid/file.edf",
        "eo_start": 10.0,
        "eo_end": 70.0,
        "ec_start": 80.0,
        "ec_end": 140.0,
        "supabase_url": "https://project.supabase.co",
        "supabase_key": "service-role-key"
    }
    """
    # Verify authentication
    if not verify_auth():
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        data = request.json

        # Validate required fields
        required_fields = [
            'analysis_id', 'file_path',
            'supabase_url', 'supabase_key'
        ]

        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing required field: {field}'}), 400

        analysis_id = data['analysis_id']
        file_path = data['file_path']
        supabase_url = data['supabase_url']
        supabase_key = data['supabase_key']

        # EO/EC times are optional (one or both can be provided)
        eo_start = float(data['eo_start']) if data.get('eo_start') is not None else None
        eo_end = float(data['eo_end']) if data.get('eo_end') is not None else None
        ec_start = float(data['ec_start']) if data.get('ec_start') is not None else None
        ec_end = float(data['ec_end']) if data.get('ec_end') is not None else None

        # Validate that at least one condition is provided
        has_eo = eo_start is not None and eo_end is not None
        has_ec = ec_start is not None and ec_end is not None

        if not has_eo and not has_ec:
            return jsonify({
                'error': 'Missing EO/EC segments',
                'message': 'At least one condition (EO or EC) must be provided with start/end times'
            }), 400

        logger.info(f"Starting analysis for: {analysis_id}")

        # Download EDF file from Supabase
        local_file = download_from_supabase(file_path, supabase_url, supabase_key)

        try:
            # Run analysis
            results = analyze_eeg_file(
                local_file,
                eo_start,
                eo_end,
                ec_start,
                ec_end,
                config=data.get('config', {})
            )

            # Upload results
            upload_results_to_supabase(
                analysis_id,
                results,
                supabase_url,
                supabase_key
            )

            logger.info(f"Analysis complete: {analysis_id}")

            return jsonify({
                'success': True,
                'message': 'Analysis completed',
                'analysis_id': analysis_id
            })

        finally:
            # Clean up temp file
            if os.path.exists(local_file):
                os.unlink(local_file)

    except Exception as e:
        logger.error(f"Analysis failed: {e}", exc_info=True)

        # Try to mark as failed in database
        try:
            if 'analysis_id' in data and 'supabase_url' in data and 'supabase_key' in data:
                mark_analysis_failed(
                    data['analysis_id'],
                    str(e),
                    data['supabase_url'],
                    data['supabase_key']
                )
        except Exception as db_error:
            logger.error(f"Failed to update database: {db_error}")

        return jsonify({
            'error': 'Analysis failed',
            'details': str(e)
        }), 500


@app.route('/', methods=['GET'])
def root():
    """Root endpoint with API info"""
    return jsonify({
        'service': 'EEG Analysis Worker',
        'version': '1.0.0',
        'endpoints': {
            '/health': 'GET - Health check',
            '/analyze': 'POST - Run EEG analysis',
        },
        'docs': 'See DEPLOYMENT.md for usage'
    })


if __name__ == '__main__':
    port = int(os.getenv('PORT', 8000))
    app.run(host='0.0.0.0', port=port, debug=False)
