import { ParsedSheetRow } from '../../services/mapping.service';
import { normalizeHeader } from '../../utils/header.util';
import { MarketplaceImportMapping } from './types';

/** Indian GSTIN pattern (15 chars) — allow digit 0 in entity position for loose match. */
const GSTIN_IN_TEXT =
  /[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]/;

const GSTIN_STRICT =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const isValidGstinFormat = (value: string): boolean => {
  if (!value || value.length !== 15) return false;
  if (GSTIN_STRICT.test(value)) return true;
  return /^[0-9]{2}[A-Z][0-9A-Z]{12}$/.test(value);
};

/**
 * Extract a 15-character GSTIN from an Excel cell value.
 * Handles prefixes, apostrophes, spaces, and GSTIN embedded in longer text.
 */
export const parseGstinFromCell = (raw: unknown): string | undefined => {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'object') return undefined;

  let text = String(raw).trim().toUpperCase();
  if (!text) return undefined;

  // Excel text prefix apostrophe or backtick
  text = text.replace(/^['`]+/, '').trim();
  if (/^[0-9.]+E[+-]?[0-9]+$/i.test(text)) return undefined;

  const compact = text.replace(/[^0-9A-Z]/g, '');
  if (!compact) return undefined;

  const match = compact.match(GSTIN_IN_TEXT);
  if (match?.[0] && isValidGstinFormat(match[0])) {
    return match[0];
  }

  if (compact.length === 15 && isValidGstinFormat(compact)) {
    return compact;
  }

  return undefined;
};

/** @deprecated Use parseGstinFromCell — kept for non-GSTIN normalizations. */
export const normalizeGstinValue = (raw: unknown): string | undefined =>
  parseGstinFromCell(raw);

export const headerMatchesExcelColumn = (
  headerKey: string,
  excelColumn: string,
): boolean => {
  const norm = normalizeHeader(headerKey);
  const colNorm = normalizeHeader(excelColumn);
  if (!norm || !colNorm) return false;
  if (norm === colNorm) return true;
  // Header may be a composite label that contains the alias (e.g. "GST NO = Seller GSTIN").
  // Do not match when the alias is longer and merely contains the header text
  // (e.g. alias "Detailed Return Reason" must not match header "Return Reason").
  if (norm.includes(colNorm)) return true;
  return false;
};

export const headerMatchesAnyExcelColumn = (
  headerKey: string,
  excelColumns: string[],
): boolean => excelColumns.some((col) => headerMatchesExcelColumn(headerKey, col));

export const extractGstinFromRow = (
  row: ParsedSheetRow,
  excelColumns: string[],
): string | undefined => {
  for (const [key, raw] of Object.entries(row)) {
    if (key.startsWith('__')) continue;
    if (!headerMatchesAnyExcelColumn(key, excelColumns)) continue;
    const value = parseGstinFromCell(raw);
    if (value) return value;
  }
  return undefined;
};

export const extractGstinsFromRows = (
  rows: ParsedSheetRow[],
  mapping: MarketplaceImportMapping,
): { values: Set<string>; foundColumn: boolean; matchedHeaders: Set<string> } => {
  const values = new Set<string>();
  const matchedHeaders = new Set<string>();
  let foundColumn = false;

  rows.forEach((row) => {
    for (const [key, raw] of Object.entries(row)) {
      if (key.startsWith('__')) continue;
      if (!headerMatchesAnyExcelColumn(key, mapping.gstin.excelColumns)) {
        continue;
      }
      foundColumn = true;
      matchedHeaders.add(key);
      const value = parseGstinFromCell(raw);
      if (value) values.add(value);
    }
  });

  return { values, foundColumn, matchedHeaders };
};

export const headersHaveGstColumn = (
  headers: string[],
  excelColumns: string[],
): boolean =>
  headers.some((header) => headerMatchesAnyExcelColumn(header, excelColumns));
