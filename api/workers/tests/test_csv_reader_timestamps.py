#!/usr/bin/env python3
"""
Tests for CSVReader timestamp handling (csv_reader.py).

Regression: CSVs exported with ISO 8601 timestamps
("2026-06-24T22:13:59.340Z", TheraQ / Divergence exports) crashed the worker
because the timestamp column was treated as numeric. Numeric epoch columns
must keep working unchanged.

Requires MNE, pandas, scipy (same as the worker).

Run:  python -m pytest api/workers/tests/test_csv_reader_timestamps.py
"""

import math
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

WORKERS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKERS_DIR not in sys.path:
    sys.path.insert(0, WORKERS_DIR)

from csv_reader import CSVReader  # noqa: E402

ROWS = 500
STEP_MS = 4


def _write_csv(lines):
    tmp = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False)
    tmp.write("\n".join(lines) + "\n")
    tmp.close()
    return tmp.name


@pytest.fixture
def iso_csv():
    start = datetime(2026, 6, 24, 22, 13, 59, 340000, tzinfo=timezone.utc)
    lines = ["timestamp,F3,F4"]
    for i in range(ROWS):
        ts = (start + timedelta(milliseconds=i * STEP_MS)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        lines.append(f"{ts},{math.sin(i) * 100},{math.cos(i) * 50}")
    path = _write_csv(lines)
    yield path
    os.unlink(path)


@pytest.fixture
def epoch_ms_csv():
    start = 1782339239340
    lines = ["timestamp,F3,F4"]
    for i in range(ROWS):
        lines.append(f"{start + i * STEP_MS},{i},{-i}")
    path = _write_csv(lines)
    yield path
    os.unlink(path)


def test_iso_timestamps_give_250hz(iso_csv):
    raw, sfreq = CSVReader().read_csv(iso_csv)
    assert round(sfreq) == 250
    assert raw.ch_names == ["F3", "F4"]
    assert raw.n_times == ROWS


def test_epoch_ms_timestamps_still_work(epoch_ms_csv):
    raw, sfreq = CSVReader().read_csv(epoch_ms_csv)
    assert round(sfreq) == 250
    assert raw.n_times == ROWS


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
