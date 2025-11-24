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
  const signals: number[][] = channelNames.map(ch => channelData.get(ch)!);

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
 * Extract a time window from the signals
 */
export function extractTimeWindow(
  signals: number[][],
  sampleRate: number,
  startTime: number,
  duration: number
): number[][] {
  const startSample = Math.floor(startTime * sampleRate);
  const endSample = Math.floor((startTime + duration) * sampleRate);

  return signals.map((channelData) =>
    channelData.slice(startSample, endSample)
  );
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
