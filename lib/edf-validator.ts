// Server-side EDF validation (TypeScript/Node.js)
// Validates EDF header without external dependencies

import {
  MONTAGE_10_20_19CH,
  MONTAGE_10_20_21CH,
  EXPECTED_CHANNELS_19,
  EXPECTED_CHANNELS_21
} from './constants';

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

// Channel name normalization
const CHANNEL_ALIASES: Record<string, string> = {
  'FP1': 'Fp1',
  'FP2': 'Fp2',
  'T3': 'T7',
  'T4': 'T8',
  'T5': 'P7',
  'T6': 'P8',
  'M1': 'A1',  // Mastoid = Auricular
  'M2': 'A2',
  'TP9': 'A1', // Sometimes ear references are labeled as TP9/TP10
  'TP10': 'A2',
};

function normalizeChannelName(ch: string): string {
  let normalized = ch.trim().replace(/\s+/g, '');

  // Remove common prefixes (EEG, ECG, EMG, etc.)
  normalized = normalized.replace(/^(EEG|ECG|EMG|EOG)/i, '');

  // Remove common suffixes (reference notations)
  normalized = normalized.replace(/-(LE|REF|AVG|A1|A2|CZ|M1|M2)$/i, '');

  // Handle A2-A1 reference channel (represents both ear references)
  if (normalized.match(/^A2-A1$/i)) {
    // This is the combined reference - we'll treat it as having both A1 and A2
    return 'A1'; // We'll handle A2 separately
  }

  // Apply aliases
  normalized = CHANNEL_ALIASES[normalized] || normalized;

  return normalized;
}

/**
 * Validate EDF file montage from buffer
 * Parses EDF header structure without loading full signal data
 */
export async function validateEDFMontage(
  buffer: Buffer
): Promise<ValidationResult> {
  try {
    // Check minimum size (256 bytes for header)
    if (buffer.length < 256) {
      return {
        valid: false,
        error: 'File too small to be valid EDF',
      };
    }

    // Parse fixed header (256 bytes)
    const version = buffer.toString('ascii', 0, 8).trim();
    if (!version.startsWith('0')) {
      return {
        valid: false,
        error: 'Invalid EDF format: version field incorrect',
      };
    }

    // Get number of channels (bytes 252-256)
    const nChannels = parseInt(buffer.toString('ascii', 252, 256).trim());

    // Support both 19-channel and 21-channel 10-20 montages
    if (isNaN(nChannels) || (nChannels !== EXPECTED_CHANNELS_19 && nChannels !== EXPECTED_CHANNELS_21)) {
      return {
        valid: false,
        error: `Expected ${EXPECTED_CHANNELS_19} or ${EXPECTED_CHANNELS_21} channels, found ${nChannels}. This tool requires 10-20 montage.`,
      };
    }

    // Get recording info
    const nRecords = parseInt(buffer.toString('ascii', 236, 244).trim());
    const recordDuration = parseFloat(buffer.toString('ascii', 244, 252).trim());
    const duration = nRecords * recordDuration;

    // Calculate header size
    const headerSize = 256 + nChannels * 256;
    if (buffer.length < headerSize) {
      return {
        valid: false,
        error: 'EDF file header incomplete',
      };
    }

    // Read channel labels (16 bytes each, starting at byte 256)
    const channelLabels: string[] = [];
    const rawChannelLabels: string[] = [];
    let offset = 256;
    let hasA2A1Reference = false;

    for (let i = 0; i < nChannels; i++) {
      const label = buffer.toString('ascii', offset, offset + 16).trim();
      rawChannelLabels.push(label);

      // Check if this is A2-A1 reference channel
      if (label.match(/A2-A1/i)) {
        hasA2A1Reference = true;
        // Add both A1 and A2 to the channel list (combined reference)
        channelLabels.push('A1');
        channelLabels.push('A2');
      } else {
        channelLabels.push(normalizeChannelName(label));
      }
      offset += 16;
    }

    // Debug logging
    console.log('[EDF Validator] Found channels:', {
      count: nChannels,
      raw: rawChannelLabels,
      normalized: channelLabels,
      hasA2A1Reference,
    });

    // Determine expected montage based on channel count
    // Use 19-channel montage as base, since LE-referenced files don't have separate A1/A2 channels
    const expectedMontage = MONTAGE_10_20_19CH;

    // Check if all expected channels are present
    const missingChannels = expectedMontage.filter(
      (ch) => !channelLabels.includes(ch)
    );

    if (missingChannels.length > 0) {
      return {
        valid: false,
        error: `Missing required channels: ${missingChannels.join(', ')}. Expected 10-20 montage. Found: ${channelLabels.join(', ')}`,
      };
    }

    // Check for extra channels (allow annotation channels and reference channels)
    const extraChannels = channelLabels.filter(
      (ch) =>
        !expectedMontage.includes(ch) &&
        !ch.toLowerCase().includes('annotation') &&
        ch !== 'A1' &&
        ch !== 'A2'
    );

    if (extraChannels.length > 0) {
      return {
        valid: false,
        error: `Unexpected channels found: ${extraChannels.join(', ')}. Only 10-20 montage is supported.`,
      };
    }

    // Skip to samples per record (after several other fields)
    // Each field is nChannels * field_size bytes
    offset = 256 + nChannels * 16; // After labels
    offset += nChannels * 80; // Skip transducer type
    offset += nChannels * 8; // Skip physical dimension
    offset += nChannels * 8; // Skip physical minimum
    offset += nChannels * 8; // Skip physical maximum
    offset += nChannels * 8; // Skip digital minimum
    offset += nChannels * 8; // Skip digital maximum
    offset += nChannels * 80; // Skip prefiltering

    // Read samples per record (8 bytes each)
    const samplesPerRecord: number[] = [];
    for (let i = 0; i < nChannels; i++) {
      const samples = parseInt(buffer.toString('ascii', offset, offset + 8).trim());
      samplesPerRecord.push(samples);
      offset += 8;
    }

    // Calculate sampling rate (assume all channels same rate)
    const samplingRate =
      recordDuration > 0 ? samplesPerRecord[0] / recordDuration : 0;

    // Note: Annotation parsing is complex and not critical for initial validation
    // Full annotation parsing can be done in preprocessing workers

    return {
      valid: true,
      metadata: {
        duration_seconds: duration,
        sampling_rate: samplingRate,
        n_channels: nChannels,
        channels: channelLabels,
        annotations: [], // Empty for now, parsed in workers
      },
    };
  } catch (error: any) {
    return {
      valid: false,
      error: `Failed to parse EDF file: ${error.message}`,
    };
  }
}
