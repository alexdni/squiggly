#!/usr/bin/env python3
"""
Tests for upload_visual_to_supabase content-type handling (analyze_eeg.py).

Regression test for the "Download Cleaned EEG" bug: the cleaned EDF/BDF/CSV
export was uploaded with the hardcoded image/png content type used for the
visualisation PNGs, so browsers rendered it as a broken image instead of
downloading it.

Runs without MNE/matplotlib by stubbing the heavy sibling modules before
importing analyze_eeg.

Run:  python -m pytest api/workers/tests/test_upload_content_type.py
"""

import os
import sys
import types
from unittest.mock import MagicMock, patch

import pytest

WORKERS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKERS_DIR not in sys.path:
    sys.path.insert(0, WORKERS_DIR)


def _stub(name, **attrs):
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules.setdefault(name, mod)


# analyze_eeg imports these at module import time; they need MNE/matplotlib.
_stub("preprocess", preprocess_eeg=MagicMock())
_stub("extract_features", extract_features=MagicMock())
_stub(
    "generate_visuals",
    generate_topomap_grid=MagicMock(),
    generate_connectivity_grid=MagicMock(),
    generate_network_metrics_summary=MagicMock(),
    generate_spectrogram_grid=MagicMock(),
    generate_lzc_topomap=MagicMock(),
    generate_alpha_peak_topomap=MagicMock(),
    compress_png=MagicMock(),
)

import analyze_eeg  # noqa: E402


@pytest.fixture
def fake_supabase():
    """Patch supabase.create_client and return the bucket proxy mock."""
    bucket = MagicMock()
    bucket.create_signed_url.return_value = {"signedURL": "https://x/signed"}
    client = MagicMock()
    client.storage.from_.return_value = bucket
    supabase_mod = types.ModuleType("supabase")
    supabase_mod.create_client = MagicMock(return_value=client)
    supabase_mod.Client = MagicMock
    with patch.dict(sys.modules, {"supabase": supabase_mod}):
        yield bucket


def test_default_upload_is_png(fake_supabase):
    url = analyze_eeg.upload_visual_to_supabase(
        b"png", "topomap_grid.png", "aid", "https://sb", "key"
    )
    assert url == "https://x/signed"
    _, kwargs = fake_supabase.upload.call_args
    assert kwargs["file_options"]["content-type"] == "image/png"


def test_custom_content_type_is_forwarded(fake_supabase):
    analyze_eeg.upload_visual_to_supabase(
        b"edf", "cleaned_raw.edf", "aid", "https://sb", "key",
        content_type="application/octet-stream",
    )
    _, kwargs = fake_supabase.upload.call_args
    assert kwargs["file_options"]["content-type"] == "application/octet-stream"
    assert kwargs["file_options"]["upsert"] == "true"


def test_download_option_sets_attachment_on_signed_url(fake_supabase):
    analyze_eeg.upload_visual_to_supabase(
        b"edf", "cleaned_raw.edf", "aid", "https://sb", "key",
        content_type="application/octet-stream",
        download=True,
    )
    args, kwargs = fake_supabase.create_signed_url.call_args
    options = kwargs.get("options") or (args[2] if len(args) > 2 else {})
    assert options.get("download") == "cleaned_raw.edf"


def test_no_download_option_for_visuals(fake_supabase):
    analyze_eeg.upload_visual_to_supabase(
        b"png", "topomap_grid.png", "aid", "https://sb", "key"
    )
    args, kwargs = fake_supabase.create_signed_url.call_args
    options = kwargs.get("options") or (args[2] if len(args) > 2 else {})
    assert "download" not in options


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
