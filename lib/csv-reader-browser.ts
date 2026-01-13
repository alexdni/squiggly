// Browser-based CSV reader for visualizing EEG data from CSV files
// Parses CSV files with timestamp column and channel data columns

export interface CSVHeader {
  channels: string[];
  timestamps: number[];
  sampleRate: number;
  duration: number;
}

export interface CSVData {
  header: CSVHeader;
  signals: number[][]; // [channel][sample]
  sampleRate: number;
  duration: number;
  channelNames: string[];
}

/**
 * Parse CSV file from text content
 */
export async function parseCSVFile(fileContent: string): Promise<CSVData> {
  const lines = fileContent.trim().split('\n');

  if (lines.length < 2) {
    throw new Error('CSV file must have at least a header row and one data row');
  }

  // Parse header
  const headerLine = lines[0];
  const headers = headerLine.split(/[,\t]/).map(h => h.trim());

  // First column should be timestamp
  if (!headers[0] || headers[0].toLowerCase() !== 'timestamp') {
    throw new Error('CSV file must have "timestamp" as the first column');
  }

  // Extract channel names (all columns except timestamp)
  const channelNames = headers.slice(1).filter(h => h.length > 0);

  if (channelNames.length === 0) {
    throw new Error('CSV file must have at least one channel column');
  }

  // Initialize data structures
  const timestamps: number[] = [];
  const channelData: Map<string, number[]> = new Map();

  channelNames.forEach(ch => {
    channelData.set(ch, []);
  });

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines

    const values = line.split(/[,\t]/);

    // Parse timestamp
    const timestamp = parseFloat(values[0]);
    if (isNaN(timestamp)) {
      console.warn(`Skipping row ${i + 1}: invalid timestamp`);
      continue;
    }

    timestamps.push(timestamp);

    // Parse channel values
    for (let j = 0; j < channelNames.length; j++) {
      const channelName = channelNames[j];
      const valueStr = values[j + 1];

      // Handle missing/empty values
      let value: number;
      if (!valueStr || valueStr.trim() === '') {
        // Use interpolation or zero for missing values
        const channelArray = channelData.get(channelName)!;
        value = channelArray.length > 0 ? channelArray[channelArray.length - 1] : 0;
      } else {
        value = parseFloat(valueStr);
        if (isNaN(value)) {
          // Use previous value or zero if parsing fails
          const channelArray = channelData.get(channelName)!;
          value = channelArray.length > 0 ? channelArray[channelArray.length - 1] : 0;
        }
      }

      channelData.get(channelName)!.push(value);
    }
  }

  if (timestamps.length === 0) {
    throw new Error('No valid data rows found in CSV file');
  }

  // Auto-detect timestamp unit by analyzing time differences
  const firstTimestamp = timestamps[0];

  // Sample first 20 time differences to detect unit
  const timeDiffsRaw: number[] = [];
  for (let i = 1; i < Math.min(20, timestamps.length); i++) {
    const diff = timestamps[i] - timestamps[i - 1];
    if (diff > 0) {
      timeDiffsRaw.push(diff);
    }
  }

  if (timeDiffsRaw.length === 0) {
    throw new Error('Cannot determine sampling pattern from timestamps');
  }

  // Calculate median raw time difference
  timeDiffsRaw.sort((a, b) => a - b);
  const medianRawDiff = timeDiffsRaw[Math.floor(timeDiffsRaw.length / 2)];

  let timeScale = 1;

  // Determine scale based on typical sampling intervals
  if (medianRawDiff < 0.1) {
    // Very small differences, likely already in seconds
    timeScale = 1;
    console.log('CSV: Detected second timestamps');
  } else if (medianRawDiff < 100) {
    // Small differences (0.1 to 100), likely milliseconds
    timeScale = 1_000;
    console.log('CSV: Detected millisecond timestamps');
  } else if (medianRawDiff < 100_000) {
    // Medium differences, likely microseconds
    timeScale = 1_000_000;
    console.log('CSV: Detected microsecond timestamps');
  } else {
    // Large differences
    timeScale = 1_000_000_000;
    console.log('CSV: Detected nanosecond timestamps');
  }

  console.log(`CSV: First timestamp: ${firstTimestamp}, median diff: ${medianRawDiff}, scale: 1/${timeScale}`);

  // Calculate sampling rate from timestamps
  const timeInSeconds = timestamps.map(t => t / timeScale);
  const timeDiffs: number[] = [];

  for (let i = 1; i < Math.min(100, timeInSeconds.length); i++) {
    const diff = timeInSeconds[i] - timeInSeconds[i - 1];
    if (diff > 0) {
      timeDiffs.push(diff);
    }
  }

  // Calculate median time difference
  timeDiffs.sort((a, b) => a - b);
  const medianDiff = timeDiffs[Math.floor(timeDiffs.length / 2)] || 0.004; // fallback to 250 Hz
  const sampleRate = Math.round(1 / medianDiff);

  const duration = (timestamps[timestamps.length - 1] - timestamps[0]) / timeScale;

  // Convert channel data to array format [channel][sample]
  // Note: Detrending is NOT applied here - it's applied per visualization window
  // in extractTimeWindow() to properly remove drift in each viewed segment.
  // The raw signal data (with DC offset) is preserved.
  const signals: number[][] = channelNames.map(ch => channelData.get(ch)!);

  // Debug: Log raw signal statistics
  console.log('CSV Raw Signal Stats:');
  signals.forEach((sig, idx) => {
    if (sig.length > 0) {
      const min = Math.min(...sig);
      const max = Math.max(...sig);
      const mean = sig.reduce((a, b) => a + b, 0) / sig.length;
      console.log(`  ${channelNames[idx]}: DC offset=${mean.toFixed(0)}, range=${(max-min).toFixed(0)}, samples=${sig.length}`);
    }
  });

  const header: CSVHeader = {
    channels: channelNames,
    timestamps: timeInSeconds,
    sampleRate,
    duration,
  };

  return {
    header,
    signals,
    sampleRate,
    duration,
    channelNames,
  };
}

/**
 * Read CSV file from File object
 */
export async function readCSVFile(file: File): Promise<CSVData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const data = await parseCSVFile(content);
        resolve(data);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read CSV file'));
    };

    reader.readAsText(file);
  });
}

/**
 * Butterworth filter coefficient calculator
 * Compute biquad (second-order section) coefficients for Butterworth filter
 */
function butterworthCoeffs(
  filterType: 'lowpass' | 'highpass',
  cutoffHz: number,
  sampleRate: number
): { b: number[], a: number[] } {
  const w0 = Math.tan(Math.PI * cutoffHz / sampleRate);
  const w0sq = w0 * w0;
  const sqrt2 = Math.SQRT2;

  let b0: number, b1: number, b2: number;
  let a0: number, a1: number, a2: number;

  if (filterType === 'lowpass') {
    a0 = 1 + sqrt2 * w0 + w0sq;
    a1 = 2 * (w0sq - 1);
    a2 = 1 - sqrt2 * w0 + w0sq;
    b0 = w0sq;
    b1 = 2 * w0sq;
    b2 = w0sq;
  } else {
    // highpass
    a0 = 1 + sqrt2 * w0 + w0sq;
    a1 = 2 * (w0sq - 1);
    a2 = 1 - sqrt2 * w0 + w0sq;
    b0 = 1;
    b1 = -2;
    b2 = 1;
  }

  // Normalize
  return {
    b: [b0 / a0, b1 / a0, b2 / a0],
    a: [1, a1 / a0, a2 / a0]
  };
}

/**
 * Apply a biquad (second-order IIR) filter to a signal
 * Uses direct form II transposed for numerical stability
 */
function applyBiquad(signal: number[], b: number[], a: number[]): number[] {
  if (signal.length < 3) return signal;

  const output: number[] = new Array(signal.length);
  let z1 = 0, z2 = 0;

  for (let i = 0; i < signal.length; i++) {
    const x = signal[i];
    const y = b[0] * x + z1;
    z1 = b[1] * x - a[1] * y + z2;
    z2 = b[2] * x - a[2] * y;
    output[i] = y;
  }

  return output;
}

/**
 * Apply forward-backward filtering (zero-phase) to avoid phase distortion
 * This is equivalent to scipy's filtfilt
 * Includes edge padding to minimize startup transients
 */
function filtfilt(signal: number[], b: number[], a: number[]): number[] {
  const n = signal.length;
  if (n < 10) return signal;

  // Pad length - use 3x the filter order (second order = 6 samples min)
  // But for better results, use a larger pad based on signal length
  const padLen = Math.min(Math.floor(n / 4), 250); // Up to 1 second at 250Hz

  // Create padded signal with reflected edges (like scipy's filtfilt)
  const padded: number[] = new Array(n + 2 * padLen);

  // Reflect the beginning
  for (let i = 0; i < padLen; i++) {
    padded[i] = 2 * signal[0] - signal[padLen - i];
  }
  // Copy original signal
  for (let i = 0; i < n; i++) {
    padded[padLen + i] = signal[i];
  }
  // Reflect the end
  for (let i = 0; i < padLen; i++) {
    padded[padLen + n + i] = 2 * signal[n - 1] - signal[n - 2 - i];
  }

  // Forward pass
  let filtered = applyBiquad(padded, b, a);
  // Reverse
  filtered = filtered.reverse();
  // Backward pass
  filtered = applyBiquad(filtered, b, a);
  // Reverse again
  filtered = filtered.reverse();

  // Remove padding and return original length
  return filtered.slice(padLen, padLen + n);
}

/**
 * Notch filter coefficients for power line noise removal
 */
function notchCoeffs(notchFreq: number, sampleRate: number, Q: number = 30): { b: number[], a: number[] } {
  const w0 = (2 * Math.PI * notchFreq) / sampleRate;
  const alpha = Math.sin(w0) / (2 * Q);

  const b0 = 1;
  const b1 = -2 * Math.cos(w0);
  const b2 = 1;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha;

  return {
    b: [b0 / a0, b1 / a0, b2 / a0],
    a: [1, a1 / a0, a2 / a0]
  };
}

/**
 * Apply the full prefilteredEEG processing pipeline
 * Matches the DivergenceWebapp/biofeedback-core processing:
 * 1. Highpass at 1 Hz (removes DC and slow drift)
 * 2. Lowpass at 45 Hz (removes high-frequency noise, muscle artifact)
 * 3. Notch at 60 Hz (removes power line interference)
 */
function prefilterEEG(signal: number[], sampleRate: number): number[] {
  if (signal.length < 10) return signal;

  // 1. Highpass filter at 1 Hz to remove DC offset and slow drift
  const hpCoeffs = butterworthCoeffs('highpass', 1, sampleRate);
  let filtered = filtfilt(signal, hpCoeffs.b, hpCoeffs.a);

  // 2. Lowpass filter at 45 Hz to remove high-frequency noise
  const lpCoeffs = butterworthCoeffs('lowpass', 45, sampleRate);
  filtered = filtfilt(filtered, lpCoeffs.b, lpCoeffs.a);

  // 3. Notch filter at 60 Hz to remove power line noise
  const notch = notchCoeffs(60, sampleRate, 30);
  filtered = filtfilt(filtered, notch.b, notch.a);

  return filtered;
}

/**
 * Extract a time window from the signals and apply prefilteredEEG processing
 * Matches the DivergenceWebapp signal processing pipeline
 */
export function extractTimeWindow(
  signals: number[][],
  sampleRate: number,
  startTime: number,
  duration: number
): number[][] {
  const startSample = Math.floor(startTime * sampleRate);
  const endSample = Math.floor((startTime + duration) * sampleRate);

  return signals.map((channelData) => {
    const windowData = channelData.slice(startSample, endSample);
    // Apply full prefilteredEEG pipeline (highpass, lowpass, notch)
    return prefilterEEG(windowData, sampleRate);
  });
}

/**
 * Downsample signals for visualization (to reduce points)
 */
export function downsampleSignals(
  signals: number[][],
  targetPoints: number
): number[][] {
  return signals.map((channelData) => {
    if (channelData.length <= targetPoints) {
      return channelData;
    }

    const downsampledData: number[] = [];
    const step = channelData.length / targetPoints;

    for (let i = 0; i < targetPoints; i++) {
      const index = Math.floor(i * step);
      downsampledData.push(channelData[index]);
    }

    return downsampledData;
  });
}

/**
 * Check if a channel should be excluded (accelerometer, gyroscope, impedance)
 */
function isExcludedChannel(channelName: string): boolean {
  const excludedPatterns = [
    /^a[XYZ]$/i,    // Accelerometer: aX, aY, aZ
    /^g[XYZ]$/i,    // Gyroscope: gX, gY, gZ
    /^acc/i,        // acc, Acc, ACC
    /^gyro/i,       // gyro, Gyro, GYRO
    /^mag/i,        // Magnetometer
    /^temp/i,       // Temperature
    /^batt/i,       // Battery
    /^z-/i,         // Impedance measurements: z-Cz, z-F3, etc.
  ];

  return excludedPatterns.some(pattern => pattern.test(channelName));
}

/**
 * Check if a channel is an ECG channel
 */
function isECGChannel(channelName: string): boolean {
  const ecgPatterns = ['ecg', 'ECG', 'EKG', 'ekg'];
  return ecgPatterns.some(pattern =>
    channelName.toLowerCase() === pattern.toLowerCase()
  );
}

/**
 * Check if a channel is a valid EEG channel
 */
function isEEGChannel(channelName: string): boolean {
  // Standard 10-20 channels
  const standard1020 = [
    'Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8',
    'T7', 'C3', 'Cz', 'C4', 'T8',
    'P7', 'P3', 'Pz', 'P4', 'P8',
    'O1', 'O2', 'A1', 'A2'
  ];

  // Additional channels (10-10, old nomenclature)
  const additional = [
    'T3', 'T4', 'T5', 'T6',  // Old nomenclature
    'Fpz', 'AFz', 'FCz', 'CPz', 'POz', 'Oz', 'Iz',
    'AF3', 'AF4', 'AF7', 'AF8',
    'FC1', 'FC2', 'FC3', 'FC4', 'FC5', 'FC6',
    'FT7', 'FT8', 'FT9', 'FT10',
    'CP1', 'CP2', 'CP3', 'CP4', 'CP5', 'CP6',
    'TP7', 'TP8', 'TP9', 'TP10',
    'PO3', 'PO4', 'PO7', 'PO8',
  ];

  const allEEGChannels = [...standard1020, ...additional];

  // Case-insensitive match
  return allEEGChannels.some(ch =>
    ch.toLowerCase() === channelName.toLowerCase()
  );
}

/**
 * Filter channels to include EEG and ECG, exclude accelerometer/gyro
 */
export function filterValidChannels(data: CSVData): CSVData {
  const validChannelIndices: number[] = [];
  const validChannelNames: string[] = [];

  data.channelNames.forEach((name, idx) => {
    // Skip excluded channels
    if (isExcludedChannel(name)) {
      console.log(`Excluding channel: ${name} (motion sensor or impedance)`);
      return;
    }

    // Include EEG channels
    if (isEEGChannel(name)) {
      validChannelIndices.push(idx);
      validChannelNames.push(name);
      return;
    }

    // Include ECG channels
    if (isECGChannel(name)) {
      validChannelIndices.push(idx);
      validChannelNames.push(name);
      console.log(`Including ECG channel: ${name}`);
      return;
    }

    console.log(`Skipping unknown channel: ${name}`);
  });

  if (validChannelIndices.length === 0) {
    throw new Error('No valid EEG or ECG channels found in CSV file');
  }

  const filteredSignals = validChannelIndices.map(idx => data.signals[idx]);

  console.log(`Filtered to ${validChannelNames.length} valid channels: ${validChannelNames.join(', ')}`);

  return {
    ...data,
    signals: filteredSignals,
    channelNames: validChannelNames,
    header: {
      ...data.header,
      channels: validChannelNames,
    },
  };
}

/**
 * Legacy function name for backward compatibility
 */
export const filterEEGChannels = filterValidChannels;
