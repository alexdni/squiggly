#!/usr/bin/env python3
"""
Local Storage Utility Functions

Provides functions for working with local filesystem storage in Docker mode.
"""

import os
import shutil
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Default storage path (can be overridden via environment variable)
DEFAULT_STORAGE_PATH = '/data/storage'


def get_storage_path() -> str:
    """Get the base storage path from environment or default"""
    return os.getenv('STORAGE_PATH', DEFAULT_STORAGE_PATH)


def get_storage_mode() -> str:
    """Get the current storage mode (supabase or local)"""
    return os.getenv('STORAGE_MODE', 'supabase')


def is_local_storage_mode() -> bool:
    """Check if running in local storage mode"""
    return get_storage_mode() == 'local'


def get_local_file_path(bucket: str, file_path: str) -> str:
    """
    Get the full local filesystem path for a file

    Args:
        bucket: Storage bucket name (recordings, visuals, exports)
        file_path: Path within the bucket

    Returns:
        Full filesystem path
    """
    storage_base = get_storage_path()
    return os.path.join(storage_base, bucket, file_path)


def download_local_file(file_path: str) -> str:
    """
    Get local file path for direct access (no download needed in local mode)

    Args:
        file_path: Path in storage (e.g., 'projectId/filename.edf')

    Returns:
        Full local filesystem path
    """
    # Bucket is always 'recordings' for EEG files
    local_path = get_local_file_path('recordings', file_path)

    if not os.path.exists(local_path):
        raise FileNotFoundError(f"File not found: {local_path}")

    logger.info(f"Local file access: {local_path}")
    return local_path


def upload_local_file(
    data: bytes,
    bucket: str,
    file_path: str,
    content_type: Optional[str] = None
) -> str:
    """
    Save file to local storage

    Args:
        data: File content as bytes
        bucket: Storage bucket name
        file_path: Path within the bucket
        content_type: MIME type (optional, for metadata)

    Returns:
        Local filesystem path where file was saved
    """
    local_path = get_local_file_path(bucket, file_path)

    # Ensure directory exists
    os.makedirs(os.path.dirname(local_path), exist_ok=True)

    # Write file
    with open(local_path, 'wb') as f:
        f.write(data)

    logger.info(f"Saved file to local storage: {local_path}")
    return local_path


def delete_local_file(bucket: str, file_path: str) -> bool:
    """
    Delete a file from local storage

    Args:
        bucket: Storage bucket name
        file_path: Path within the bucket

    Returns:
        True if deleted, False if file didn't exist
    """
    local_path = get_local_file_path(bucket, file_path)

    if os.path.exists(local_path):
        os.remove(local_path)
        logger.info(f"Deleted local file: {local_path}")
        return True

    return False


def list_local_files(bucket: str, directory: str) -> list:
    """
    List files in a directory

    Args:
        bucket: Storage bucket name
        directory: Directory path within the bucket

    Returns:
        List of file names
    """
    local_path = get_local_file_path(bucket, directory)

    if not os.path.exists(local_path):
        return []

    return [f for f in os.listdir(local_path) if os.path.isfile(os.path.join(local_path, f))]


def ensure_storage_directories():
    """Create required storage directories if they don't exist"""
    storage_base = get_storage_path()
    directories = [
        os.path.join(storage_base, 'recordings'),
        os.path.join(storage_base, 'visuals'),
        os.path.join(storage_base, 'exports'),
    ]

    for directory in directories:
        os.makedirs(directory, exist_ok=True)
        logger.info(f"Ensured directory exists: {directory}")


def get_local_file_url(bucket: str, file_path: str) -> str:
    """
    Get a URL for accessing a local file via the API

    Args:
        bucket: Storage bucket name
        file_path: Path within the bucket

    Returns:
        URL path for API access
    """
    app_url = os.getenv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    return f"{app_url}/api/storage/{bucket}/{file_path}"
