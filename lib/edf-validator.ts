// Server-side EDF validation (TypeScript/Node.js)
// Validates EDF header without external dependencies

import {
  MONTAGE_10_20_19CH,
  MONTAGE_10_20_21CH,
  EXPECTED_CHANNELS_19,
  EXPECTED_CHANNELS_21,
  EXPECTED_CHANNELS_24,
  ALL_EEG_CHANNELS,
  EXCLUDED_CHANNEL_PATTERNS,
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
 * Shared montage validation for EDF/BDF files.
 * Both formats share the same header layout after the version field.
 */
async function validateMontage(
  buffer: Buffer,
  format: 'EDF' | 'BDF'
): Promise<ValidationResult> {
  try {
    // Check minimum size (256 bytes for header)
    if (buffer.length < 256) {
      return {
        valid: false,
        error: `File too small to be valid ${format}`,
      };
    }

    // Parse fixed header (256 bytes) - version check
    if (format === 'BDF') {
      // BDF: first byte is 0xFF, followed by "BIOSEMI"
      if (buffer[0] !== 0xFF) {
        return {
          valid: false,
          error: 'Invalid BDF format: version byte incorrect (expected 0xFF)',
        };
      }
      const biosemiStr = buffer.toString('ascii', 1, 8).trim();
      if (biosemiStr !== 'BIOSEMI') {
        return {
          valid: false,
          error: 'Invalid BDF format: expected "BIOSEMI" identifier in header',
        };
      }
    } else {
      // EDF: first 8 bytes should start with "0"
      const version = buffer.toString('ascii', 0, 8).trim();
      if (!version.startsWith('0')) {
        return {
          valid: false,
          error: 'Invalid EDF format: version field incorrect',
        };
      }
    }

    // Get number of channels (bytes 252-256)
    const nChannels = parseInt(buffer.toString('ascii', 252, 256).trim());

    // Validate channel count - support 10-20 (19, 21 channels) and 10-10 (24+ channels)
    // We accept any count >= 19 as long as it contains the required 10-20 base channels
    const isValidCount = !isNaN(nChannels) && nChannels >= EXPECTED_CHANNELS_19;

    if (!isValidCount) {
      return {
        valid: false,
        error: `Expected at least ${EXPECTED_CHANNELS_19} channels, found ${nChannels}. This tool requires 10-20 or 10-10 montage.`,
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
        error: `${format} file header incomplete`,
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

    // Filter out non-EEG channels (BioSemi aux, rail, impedance, etc.)
    const isExcludedChannel = (ch: string): boolean => {
      return EXCLUDED_CHANNEL_PATTERNS.some(pattern => pattern.test(ch)) ||
        ch.toLowerCase().includes('annotation');
    };

    // Separate EEG channels from excluded channels
    const eegChannelLabels = channelLabels.filter(ch => !isExcludedChannel(ch));
    const excludedChannels = rawChannelLabels.filter((_, i) => {
      const normalized = channelLabels[i] || rawChannelLabels[i];
      return isExcludedChannel(normalized) || isExcludedChannel(rawChannelLabels[i]);
    });

    // Debug logging
    console.log(`[${format} Validator] Found channels:`, {
      total: nChannels,
      raw: rawChannelLabels,
      eeg: eegChannelLabels,
      excluded: excludedChannels,
      hasA2A1Reference,
    });

    // Base required channels (10-20 montage without ear references)
    // All montages must contain at least these 19 channels
    const requiredBaseChannels = MONTAGE_10_20_19CH;

    // Check if all required base channels are present (among EEG channels only)
    const missingChannels = requiredBaseChannels.filter(
      (ch) => !eegChannelLabels.includes(ch)
    );

    if (missingChannels.length > 0) {
      return {
        valid: false,
        error: `Missing required channels: ${missingChannels.join(', ')}. Expected 10-20 or 10-10 montage with base channels. Found EEG channels: ${eegChannelLabels.join(', ')}`,
      };
    }

    // Check for unknown channels among the non-excluded ones
    const extraChannels = eegChannelLabels.filter(
      (ch) =>
        !ALL_EEG_CHANNELS.includes(ch) &&
        ch !== 'A1' &&
        ch !== 'A2'
    );

    // Only warn about unknown channels, don't reject
    if (extraChannels.length > 0) {
      console.log(`[${format} Validator] Unknown channels (will be ignored):`, extraChannels);
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

    return {
      valid: true,
      metadata: {
        duration_seconds: duration,
        sampling_rate: samplingRate,
        n_channels: eegChannelLabels.length,
        channels: eegChannelLabels,
        annotations: [], // Empty for now, parsed in workers
      },
    };
  } catch (error: any) {
    return {
      valid: false,
      error: `Failed to parse ${format} file: ${error.message}`,
    };
  }
}

/**
 * Validate EDF file montage from buffer
 * Parses EDF header structure without loading full signal data
 */
export async function validateEDFMontage(
  buffer: Buffer
): Promise<ValidationResult> {
  return validateMontage(buffer, 'EDF');
}

/**
 * Validate BDF file montage from buffer
 * BDF is structurally identical to EDF but uses 0xFF+BIOSEMI version and 24-bit samples
 */
export async function validateBDFMontage(
  buffer: Buffer
): Promise<ValidationResult> {
  return validateMontage(buffer, 'BDF');
}
