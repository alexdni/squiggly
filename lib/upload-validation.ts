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

  // Check EDF header
  const headerResult = await validateEDFHeader(file);
  if (!headerResult.valid) {
    return headerResult;
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
