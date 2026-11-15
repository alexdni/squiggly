-- When the recording was made, as the uploaded file states it (see lib/recording-time.ts).
-- ISO text whose form says how much is known: '2025-11-10T21:53:17' (clock time at the recording
-- site, zone not stated), '2025-11-18T12:24:10Z' (absolute), '2022-04-02' (date only).
-- NULL when the file has no usable time.
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS recorded_at TEXT;
