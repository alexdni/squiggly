// Server-side CSV validation (TypeScript/Node.js)
// Validates CSV structure and extracts metadata

import { ALL_EEG_CHANNELS, AUX_CHANNELS, EXCLUDED_CHANNEL_PATTERNS } from './constants';

interface ValidationResult {
  valid: boolean;
  error?: string;
  metadata?: {
    duration_seconds: number;
    sampling_rate: number;
    n_channels: number;
    channels: string[];
    annotations: Array<{
      onset: number;
      duration: number;
      description: string;
    }>;
  };
}

/**
 * Check if a channel should be excluded (accelerometer, gyroscope, impedance)
 */
function isExcludedChannel(channelName: string): boolean {
  return EXCLUDED_CHANNEL_PATTERNS.some(pattern => pattern.test(channelName));
}

/**
 * Check if a channel is an ECG channel
 */
function isECGChannel(channelName: string): boolean {
  const ecgPatterns = AUX_CHANNELS.ecg;
  return ecgPatterns.some(pattern =>
    channelName.toLowerCase() === pattern.toLowerCase()
  );
}

/**
 * Check if a channel is a valid EEG channel
 */
function isEEGChannel(channelName: string): boolean {
  // Case-insensitive match against all known EEG channels
  const channelLower = channelName.toLowerCase();
  return ALL_EEG_CHANNELS.some(ch => ch.toLowerCase() === channelLower);
}

/**
 * Validate CSV file from buffer
 * Parses CSV header and calculates metadata
 */
export async function validateCSVFile(
  buffer: Buffer
): Promise<ValidationResult> {
  try {
    // Convert buffer to string
    const content = buffer.toString('utf-8');
    const lines = content.trim().split('\n');

    if (lines.length < 2) {
      return {
        valid: false,
        error: 'CSV file must have at least a header row and one data row',
      };
    }

    // Parse header
    const headerLine = lines[0];
    const headers = headerLine.split(/[,\t]/).map(h => h.trim());

    // First column should be timestamp
    if (!headers[0] || headers[0].toLowerCase() !== 'timestamp') {
      return {
        valid: false,
        error: 'CSV file must have "timestamp" as the first column',
      };
    }

    // Extract channel names (all columns except timestamp)
    const allChannels = headers.slice(1).filter(h => h.length > 0);

    if (allChannels.length === 0) {
      return {
        valid: false,
        error: 'CSV file must have at least one channel column',
      };
    }

    // Filter channels: include EEG and ECG, exclude motion sensors and impedance
    const validChannels: string[] = [];
    const ecgChannels: string[] = [];

    for (const channel of allChannels) {
      // Skip excluded channels
      if (isExcludedChannel(channel)) {
        console.log(`[CSV Validator] Excluding channel: ${channel} (motion sensor or impedance)`);
        continue;
      }

      // Include EEG channels
      if (isEEGChannel(channel)) {
        validChannels.push(channel);
        continue;
      }

      // Include ECG channels
      if (isECGChannel(channel)) {
        validChannels.push(channel);
        ecgChannels.push(channel);
        console.log(`[CSV Validator] Including ECG channel: ${channel}`);
        continue;
      }

      console.log(`[CSV Validator] Skipping unknown channel: ${channel}`);
    }

    if (validChannels.length === 0) {
      return {
        valid: false,
        error: `No valid EEG or ECG channels found. Found: ${allChannels.join(', ')}`,
      };
    }

    console.log(`[CSV Validator] Found ${validChannels.length} valid channels: ${validChannels.join(', ')}`);
    if (ecgChannels.length > 0) {
      console.log(`[CSV Validator] Found ${ecgChannels.length} ECG channels: ${ecgChannels.join(', ')}`);
    }

    // Parse a few data rows to extract timestamps and calculate sampling rate
    const timestamps: number[] = [];
    const maxSampleRows = Math.min(100, lines.length - 1);

    for (let i = 1; i <= maxSampleRows; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = line.split(/[,\t]/);
      const timestamp = parseFloat(values[0]);

      if (!isNaN(timestamp)) {
        timestamps.push(timestamp);
      }
    }

    if (timestamps.length < 2) {
      return {
        valid: false,
        error: 'Insufficient valid data rows to determine sampling rate',
      };
    }

    // Auto-detect timestamp unit (microseconds vs milliseconds vs seconds)
    const firstTimestamp = timestamps[0];
    let timeScale = 1; // seconds by default

    if (firstTimestamp > 1e9) {
      // Likely microseconds (e.g., 337679000000)
      timeScale = 1_000_000;
      console.log('[CSV Validator] Detected microsecond timestamps');
    } else if (firstTimestamp > 1e6) {
      // Likely milliseconds
      timeScale = 1_000;
      console.log('[CSV Validator] Detected millisecond timestamps');
    } else {
      console.log('[CSV Validator] Detected second timestamps');
    }

    console.log(`[CSV Validator] First timestamp: ${firstTimestamp}, scale: 1/${timeScale}`);

    // Convert timestamps to seconds
    const timestampsSeconds = timestamps.map(t => t / timeScale);

    // Calculate sampling rate from time differences
    const timeDiffs: number[] = [];
    for (let i = 1; i < Math.min(50, timestampsSeconds.length); i++) {
      const diff = timestampsSeconds[i] - timestampsSeconds[i - 1];
      if (diff > 0) {
        timeDiffs.push(diff);
      }
    }

    if (timeDiffs.length === 0) {
      return {
        valid: false,
        error: 'Cannot determine sampling rate from timestamps',
      };
    }

    // Calculate median time difference
    timeDiffs.sort((a, b) => a - b);
    const medianDiff = timeDiffs[Math.floor(timeDiffs.length / 2)];
    const samplingRate = Math.round(1 / medianDiff);

    console.log(`[CSV Validator] Median time diff: ${medianDiff}s, sampling rate: ${samplingRate} Hz`);

    // Estimate total duration
    // Parse last line to get final timestamp
    let lastTimestamp = timestamps[timestamps.length - 1];
    if (lines.length > maxSampleRows + 1) {
      // Try to parse the actual last line
      const lastLine = lines[lines.length - 1].trim();
      if (lastLine) {
        const lastValues = lastLine.split(/[,\t]/);
        const lastTs = parseFloat(lastValues[0]);
        if (!isNaN(lastTs)) {
          lastTimestamp = lastTs;
        }
      }
    }

    const duration = (lastTimestamp - timestamps[0]) / timeScale;

    console.log(`[CSV Validator] Metadata:`, {
      duration_seconds: duration.toFixed(2),
      sampling_rate: samplingRate,
      n_channels: validChannels.length,
      total_rows: lines.length - 1,
    });

    return {
      valid: true,
      metadata: {
        duration_seconds: duration,
        sampling_rate: samplingRate,
        n_channels: validChannels.length,
        channels: validChannels,
        annotations: [], // CSV files don't have annotations like EDF
      },
    };
  } catch (error: any) {
    return {
      valid: false,
      error: `Failed to parse CSV file: ${error.message}`,
    };
  }
}
