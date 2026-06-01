import { ParsedSheetRow } from '../../services/mapping.service';
import { normalizeHeader } from '../../utils/header.util';
import { MarketplaceImportMapping } from './types';

/** Indian GSTIN: 15 alphanumeric characters. */
const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const isValidGstinFormat = (value: string): boolean => {
  if (!value || value.length !== 15) return false;
  if (GSTIN_FORMAT.test(value)) return true;
  return /^[0-9A-Z]{15}$/.test(value);
};

export const normalizeGstinValue = (raw: unknown): string | undefined => {
  if (raw === null || raw === undefined) return undefined;
  if (
    typeof raw !== 'string' &&
    typeof raw !== 'number' &&
    typeof raw !== 'boolean'
  ) {
    return undefined;
  }
  let text = String(raw).trim().toUpperCase();
  if (!text) return undefined;
  // Reject scientific notation from Excel numeric cells (GSTIN must be text).
  if (/^[0-9.]+E[+-]?[0-9]+$/i.test(text)) return undefined;
  const normalized = text.replace(/\s+/g, '');
  if (!normalized) return undefined;
  if (normalized.length > 15) return normalized.slice(0, 15);
  return normalized;
};

export const headerMatchesExcelColumn = (
  headerKey: string,
  excelColumn: string,
): boolean => {
  const norm = normalizeHeader(headerKey);
  const colNorm = normalizeHeader(excelColumn);
  if (!norm || !colNorm) return false;
  if (norm === colNorm) return true;
  if (norm.includes(colNorm) || colNorm.includes(norm)) return true;
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
    const value = normalizeGstinValue(raw);
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
      const value = normalizeGstinValue(raw);
      if (value && isValidGstinFormat(value)) values.add(value);
    }
  });

  return { values, foundColumn, matchedHeaders };
};

export const headersHaveGstColumn = (
  headers: string[],
  excelColumns: string[],
): boolean =>
  headers.some((header) => headerMatchesAnyExcelColumn(header, excelColumns));
