// Browser-based EDF reader for visualizing raw EEG data
// Reads EDF files and extracts signal data for plotting

export interface EDFHeader {
  version: string;
  patientID: string;
  recordingID: string;
  startDate: string;
  startTime: string;
  headerBytes: number;
  recordsCount: number;
  recordDuration: number;
  channelCount: number;
  channels: EDFChannel[];
}

export interface EDFChannel {
  label: string;
  transducerType: string;
  physicalDimension: string;
  physicalMin: number;
  physicalMax: number;
  digitalMin: number;
  digitalMax: number;
  prefiltering: string;
  samplesPerRecord: number;
}

export interface EDFData {
  header: EDFHeader;
  signals: number[][]; // [channel][sample]
  sampleRate: number;
  duration: number;
}

/**
 * Parse EDF file from ArrayBuffer
 */
export async function parseEDFFile(arrayBuffer: ArrayBuffer): Promise<EDFData> {
  const dataView = new DataView(arrayBuffer);
  const decoder = new TextDecoder('ascii');

  let offset = 0;

  // Read fixed header (256 bytes)
  const readASCII = (length: number): string => {
    const bytes = new Uint8Array(arrayBuffer, offset, length);
    offset += length;
    return decoder.decode(bytes).trim();
  };

  const version = readASCII(8);
  const patientID = readASCII(80);
  const recordingID = readASCII(80);
  const startDate = readASCII(8);
  const startTime = readASCII(8);
  const headerBytes = parseInt(readASCII(8));
  readASCII(44); // reserved
  const recordsCount = parseInt(readASCII(8));
  const recordDuration = parseFloat(readASCII(8));
  const channelCount = parseInt(readASCII(4));

  // Read channel information
  const channels: EDFChannel[] = [];

  // Read labels
  const labels: string[] = [];
  for (let i = 0; i < channelCount; i++) {
    labels.push(readASCII(16));
  }

  // Read transducer types
  const transducerTypes: string[] = [];
  for (let i = 0; i < channelCount; i++) {
    transducerTypes.push(readASCII(80));
  }

  // Read physical dimensions
  const physicalDimensions: string[] = [];
  for (let i = 0; i < channelCount; i++) {
    physicalDimensions.push(readASCII(8));
  }

  // Read physical min/max
  const physicalMins: number[] = [];
  for (let i = 0; i < channelCount; i++) {
    physicalMins.push(parseFloat(readASCII(8)));
  }

  const physicalMaxs: number[] = [];
  for (let i = 0; i < channelCount; i++) {
    physicalMaxs.push(parseFloat(readASCII(8)));
  }

  // Read digital min/max
  const digitalMins: number[] = [];
  for (let i = 0; i < channelCount; i++) {
    digitalMins.push(parseInt(readASCII(8)));
  }

  const digitalMaxs: number[] = [];
  for (let i = 0; i < channelCount; i++) {
    digitalMaxs.push(parseInt(readASCII(8)));
  }

  // Read prefiltering
  const prefilterings: string[] = [];
  for (let i = 0; i < channelCount; i++) {
    prefilterings.push(readASCII(80));
  }

  // Read samples per record
  const samplesPerRecord: number[] = [];
  for (let i = 0; i < channelCount; i++) {
    samplesPerRecord.push(parseInt(readASCII(8)));
  }

  // Skip reserved fields
  for (let i = 0; i < channelCount; i++) {
    readASCII(32);
  }

  // Assemble channel information
  for (let i = 0; i < channelCount; i++) {
    channels.push({
      label: labels[i],
      transducerType: transducerTypes[i],
      physicalDimension: physicalDimensions[i],
      physicalMin: physicalMins[i],
      physicalMax: physicalMaxs[i],
      digitalMin: digitalMins[i],
      digitalMax: digitalMaxs[i],
      prefiltering: prefilterings[i],
      samplesPerRecord: samplesPerRecord[i],
    });
  }

  const header: EDFHeader = {
    version,
    patientID,
    recordingID,
    startDate,
    startTime,
    headerBytes,
    recordsCount,
    recordDuration,
    channelCount,
    channels,
  };

  // Initialize signal arrays
  const signals: number[][] = [];
  for (let i = 0; i < channelCount; i++) {
    signals.push([]);
  }

  // Read signal data
  for (let record = 0; record < recordsCount; record++) {
    for (let ch = 0; ch < channelCount; ch++) {
      const channel = channels[ch];
      const samples = channel.samplesPerRecord;

      // Read digital values (16-bit integers)
      for (let s = 0; s < samples; s++) {
        const digitalValue = dataView.getInt16(offset, true); // little-endian
        offset += 2;

        // Convert to physical value
        const physicalValue =
          ((digitalValue - channel.digitalMin) /
            (channel.digitalMax - channel.digitalMin)) *
            (channel.physicalMax - channel.physicalMin) +
          channel.physicalMin;

        signals[ch].push(physicalValue);
      }
    }
  }

  const sampleRate = samplesPerRecord[0] / recordDuration;
  const duration = recordsCount * recordDuration;

  return {
    header,
    signals,
    sampleRate,
    duration,
  };
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
