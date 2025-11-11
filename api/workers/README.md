# Python Workers

This directory contains Python workers for EEG signal processing.

## Architecture

To avoid exceeding Vercel's 250MB serverless function limit, we use a two-tier validation approach:

### Tier 1: Lightweight Validation (API Routes)
- **File**: `validate_montage_lite.py`
- **Dependencies**: Python standard library only (no external packages)
- **Purpose**: Fast EDF header validation during upload
- **Validates**:
  - EDF file format signature
  - 19-channel count
  - 10-20 montage channel names
  - Basic metadata (duration, sampling rate)
- **Size**: <100KB

### Tier 2: Full Signal Processing (Separate Workers)
- **Files**: `preprocess.py`, `extract_features.py`, etc.
- **Dependencies**: MNE, NumPy, SciPy, pandas, etc.
- **Purpose**: Full signal processing and analysis
- **Runs**: As separate workers (not in API routes)
- **Options**:
  1. Supabase Queue workers
  2. Separate container service (Docker)
  3. AWS Lambda with larger limits
  4. Background processing service

## Why This Approach?

**Problem**: MNE-Python + dependencies = 200-300MB, exceeding Vercel's 250MB limit

**Solution**:
- Upload validation uses lightweight pure Python (no deps)
- Heavy processing happens in separate workers
- API stays small and fast
- Processing can scale independently

## Files

### `validate_montage_lite.py`
Pure Python EDF header parser. Validates:
- File format (EDF signature)
- Channel count (must be 19)
- Channel names (10-20 montage)
- Basic metadata extraction

**No external dependencies required**

### `validate_montage.py` (Full version - for reference)
Full MNE-based validation with annotation parsing.
**Use only in separate worker services, not API routes**

### `requirements.txt`
Currently empty for API routes. Full dependencies will be in preprocessing worker `requirements.txt` when workers are implemented.

## Deployment

### For Vercel (Current)
- Only `validate_montage_lite.py` is used in API routes
- No Python dependencies needed
- Stays well under 250MB limit

### For Workers (Future - Section 4+)
When implementing preprocessing workers, you can:

1. **Deploy to separate service**:
   ```bash
   # Separate Docker container or Lambda
   pip install mne numpy scipy pandas matplotlib
   ```

2. **Use Supabase Queue + Cloud Run**:
   - Deploy workers to Google Cloud Run
   - Triggered by Supabase Queue
   - No size limits

3. **Use AWS Lambda Layers**:
   - Package MNE in Lambda Layer
   - Reference from worker functions

## Testing

### Test lite validation:
```bash
python3 api/workers/validate_montage_lite.py /path/to/file.edf
```

### Test full validation (requires MNE):
```bash
pip install mne numpy scipy
python3 api/workers/validate_montage.py /path/to/file.edf
```

## Migration Path

When implementing Section 4 (Preprocessing Pipeline):

1. Keep lite validation in API routes (fast upload validation)
2. Deploy full MNE workers separately:
   - Option A: Docker container on Cloud Run
   - Option B: AWS Lambda with layers
   - Option C: Dedicated server
3. Queue processing jobs from API routes
4. Workers pull jobs and process with full MNE stack

This separation keeps the API fast and under size limits while enabling full signal processing capabilities.
