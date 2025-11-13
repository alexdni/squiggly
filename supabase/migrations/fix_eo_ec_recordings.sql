-- Fix EO/EC recordings that were uploaded before auto-detection
-- Run this in Supabase SQL Editor

-- Update all recordings with "EO" in filename to have EO segments (entire file)
UPDATE recordings
SET
  eo_start = 0,
  eo_end = duration_seconds,
  eo_label = 'EO',
  ec_start = NULL,
  ec_end = NULL,
  ec_label = NULL
WHERE
  (
    filename ILIKE '% EO %' OR
    filename ILIKE '%_EO_%' OR
    filename ILIKE '%-EO-%' OR
    filename ILIKE '% EO.%' OR
    filename ~* '\mEO\M'
  )
  AND (eo_start IS NULL OR ec_start IS NULL); -- Only update if not already set

-- Update all recordings with "EC" in filename to have EC segments (entire file)
UPDATE recordings
SET
  ec_start = 0,
  ec_end = duration_seconds,
  ec_label = 'EC',
  eo_start = NULL,
  eo_end = NULL,
  eo_label = NULL
WHERE
  (
    filename ILIKE '% EC %' OR
    filename ILIKE '%_EC_%' OR
    filename ILIKE '%-EC-%' OR
    filename ILIKE '% EC.%' OR
    filename ~* '\mEC\M'
  )
  AND (eo_start IS NULL OR ec_start IS NULL); -- Only update if not already set

-- Show the updated recordings
SELECT
  id,
  filename,
  duration_seconds,
  eo_start,
  eo_end,
  eo_label,
  ec_start,
  ec_end,
  ec_label
FROM recordings
WHERE
  filename ILIKE '%EO%' OR filename ILIKE '%EC%'
ORDER BY created_at DESC;
