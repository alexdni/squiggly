// Client-side upload validation utilities
import { MAX_UPLOAD_SIZE, ALLOWED_FILE_EXTENSIONS } from './constants';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate file extension
 */
export function validateFileExtension(filename: string): ValidationResult {
  const extension = '.' + filename.split('.').pop()?.toLowerCase();

  if (!ALLOWED_FILE_EXTENSIONS.includes(extension)) {
    return {
      valid: false,
      error: `Invalid file type. Only ${ALLOWED_FILE_EXTENSIONS.join(', ')} files are allowed.`,
    };
  }

  return { valid: true };
}

/**
 * Validate file size
 */
export function validateFileSize(size: number): ValidationResult {
  if (size > MAX_UPLOAD_SIZE) {
    const sizeMB = (MAX_UPLOAD_SIZE / 1024 / 1024).toFixed(0);
    const actualSizeMB = (size / 1024 / 1024).toFixed(2);
    return {
      valid: false,
      error: `File size (${actualSizeMB}MB) exceeds maximum allowed size of ${sizeMB}MB.`,
    };
  }

  if (size === 0) {
    return {
      valid: false,
      error: 'File is empty.',
    };
  }

  return { valid: true };
}

/**
 * Basic EDF header validation (checks first 256 bytes for EDF signature)
 */
export async function validateEDFHeader(file: File): Promise<ValidationResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const header = new Uint8Array(e.target?.result as ArrayBuffer);

      // Check for EDF signature (first 8 bytes should be "0       " for EDF)
      const signature = String.fromCharCode(...header.slice(0, 8));

      if (!signature.startsWith('0')) {
        resolve({
          valid: false,
          error: 'Invalid EDF file format. File does not contain valid EDF header.',
        });
        return;
      }

      resolve({ valid: true });
    };

    reader.onerror = () => {
      resolve({
        valid: false,
        error: 'Failed to read file header.',
      });
    };

    // Read first 256 bytes (EDF header size)
    reader.readAsArrayBuffer(file.slice(0, 256));
  });
}

/**
 * Basic CSV validation (checks for timestamp column and valid structure)
 */
export async function validateCSVHeader(file: File): Promise<ValidationResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const content = e.target?.result as string;
      const lines = content.split('\n');

      if (lines.length < 2) {
        resolve({
          valid: false,
          error: 'CSV file must have at least a header row and one data row.',
        });
        return;
      }

      // Check header
      const headerLine = lines[0].trim();
      const headers = headerLine.split(/[,\t]/).map(h => h.trim());

      // First column should be timestamp
      if (!headers[0] || headers[0].toLowerCase() !== 'timestamp') {
        resolve({
          valid: false,
          error: 'CSV file must have "timestamp" as the first column.',
        });
        return;
      }

      // Check that there are channel columns
      const channelCount = headers.slice(1).filter(h => h.length > 0).length;
      if (channelCount === 0) {
        resolve({
          valid: false,
          error: 'CSV file must have at least one channel column.',
        });
        return;
      }

      resolve({ valid: true });
    };

    reader.onerror = () => {
      resolve({
        valid: false,
        error: 'Failed to read CSV file.',
      });
    };

    // Read first 1KB to check header
    reader.readAsText(file.slice(0, 1024));
  });
}

/**
 * Comprehensive file validation
 */
export async function validateUploadFile(file: File): Promise<ValidationResult> {
  // Check extension
  const extensionResult = validateFileExtension(file.name);
  if (!extensionResult.valid) {
    return extensionResult;
  }

  // Check size
  const sizeResult = validateFileSize(file.size);
  if (!sizeResult.valid) {
    return sizeResult;
  }

  // Determine file type and validate accordingly
  const extension = '.' + file.name.split('.').pop()?.toLowerCase();

  if (extension === '.csv') {
    // Validate CSV header
    const csvResult = await validateCSVHeader(file);
    if (!csvResult.valid) {
      return csvResult;
    }
  } else {
    // Validate EDF header
    const edfResult = await validateEDFHeader(file);
    if (!edfResult.valid) {
      return edfResult;
    }
  }

  return { valid: true };
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
