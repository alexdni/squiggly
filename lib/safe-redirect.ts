// Post-login return path: only same-origin absolute paths are allowed.
export const DEFAULT_REDIRECT = '/dashboard';

export function safeRedirect(value: string | null): string {
  if (!value || !value.startsWith('/')) return DEFAULT_REDIRECT;
  if (value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_REDIRECT;
  if (/[\u0000-\u001f\\]/.test(value)) return DEFAULT_REDIRECT;
  return value;
}
