export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[0-9A-Z]$/;

export const GST_VERIFICATION_MAX_AGE_MS = 30 * 60 * 1000;

export const INACTIVE_GST_STATUS_KEYWORDS = [
  'cancelled',
  'canceled',
  'suspended',
  'inactive',
  'provisional',
  'rejected',
];

export function normalizeGstin(value: string) {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

export function isValidGstinFormat(value: string) {
  return GSTIN_REGEX.test(normalizeGstin(value));
}

export function isActiveGstStatus(status?: string | null) {
  const normalized = String(status ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  if (INACTIVE_GST_STATUS_KEYWORDS.some((word) => normalized.includes(word))) {
    return false;
  }
  return normalized.includes('active') || normalized === 'regular';
}
