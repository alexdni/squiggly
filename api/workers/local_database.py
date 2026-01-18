#!/usr/bin/env python3
"""
Local Database Utility Functions

Provides functions for updating the local PostgreSQL database in Docker mode.
"""

import os
import json
import time
import logging
from typing import Dict, Any
import numpy as np

logger = logging.getLogger(__name__)


def get_database_url() -> str:
    """Get the PostgreSQL connection URL from environment"""
    return os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/squiggly')


def convert_numpy_types(obj: Any) -> Any:
    """
    Recursively convert NumPy types to native Python types for JSON serialization

    Args:
        obj: Object to convert (can be dict, list, numpy type, etc.)

    Returns:
        Object with all NumPy types converted to native Python types
    """
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


def upload_results_to_local_db(
    analysis_id: str,
    results: Dict
) -> bool:
    """
    Upload analysis results to local PostgreSQL database

    Args:
        analysis_id: Analysis UUID
        results: Results dictionary

    Returns:
        True if successful
    """
    try:
        import psycopg2
        from psycopg2.extras import Json

        logger.info(f"Uploading results to local DB for analysis: {analysis_id}")

        database_url = get_database_url()
        conn = psycopg2.connect(database_url)
        cur = conn.cursor()

        try:
            # First, fetch existing results to preserve AI interpretation
            cur.execute(
                "SELECT results FROM analyses WHERE id = %s",
                (analysis_id,)
            )
            row = cur.fetchone()
            existing_results = row[0] if row and row[0] else None

            # Preserve AI interpretation if it exists
            preserved_ai_interpretation = None
            if existing_results and 'ai_interpretation' in existing_results:
                preserved_ai_interpretation = existing_results['ai_interpretation']
                logger.info("Preserving existing AI interpretation")

            # Convert NumPy types to native Python types for JSON serialization
            results_serializable = convert_numpy_types(results)

            # Merge preserved AI interpretation into new results
            if preserved_ai_interpretation:
                results_serializable['ai_interpretation'] = preserved_ai_interpretation

            # Update analysis record
            completed_at = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())

            cur.execute(
                """
                UPDATE analyses
                SET status = %s, results = %s, completed_at = %s, updated_at = NOW()
                WHERE id = %s
                """,
                ('completed', Json(results_serializable), completed_at, analysis_id)
            )

            conn.commit()
            logger.info("Results uploaded successfully to local database")
            return True

        finally:
            cur.close()
            conn.close()

    except ImportError:
        logger.error("psycopg2 not installed. Install with: pip install psycopg2-binary")
        raise
    except Exception as e:
        logger.error(f"Failed to upload results to local DB: {e}")
        raise


def mark_analysis_failed_local(
    analysis_id: str,
    error_message: str
) -> bool:
    """
    Mark analysis as failed in local PostgreSQL database

    Args:
        analysis_id: Analysis UUID
        error_message: Error description

    Returns:
        True if successful
    """
    try:
        import psycopg2

        logger.info(f"Marking analysis as failed in local DB: {analysis_id}")

        database_url = get_database_url()
        conn = psycopg2.connect(database_url)
        cur = conn.cursor()

        try:
            completed_at = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())

            cur.execute(
                """
                UPDATE analyses
                SET status = %s, error_log = %s, completed_at = %s, updated_at = NOW()
                WHERE id = %s
                """,
                ('failed', error_message, completed_at, analysis_id)
            )

            conn.commit()
            logger.info("Analysis marked as failed in local database")
            return True

        finally:
            cur.close()
            conn.close()

    except Exception as e:
        logger.error(f"Failed to mark analysis as failed in local DB: {e}")
        return False
