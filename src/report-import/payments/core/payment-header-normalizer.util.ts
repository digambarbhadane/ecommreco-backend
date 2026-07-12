import { normalizeHeader } from '../../utils/header.util';

/**
 * Normalize Excel payment report headers for alias matching.
 * Trims, lowercases, collapses whitespace, strips bracketed suffixes.
 */
export function normalizePaymentHeader(value: string): string {
  return normalizeHeader(String(value ?? ''))
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildNormalizedHeaderLookup(
  entries: ReadonlyArray<{ excelLabel: string; field: string }>,
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const entry of entries) {
    lookup.set(normalizePaymentHeader(entry.excelLabel), entry.field);
  }
  return lookup;
}
