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

  // "GST NO" must not match CGST/SGST/IGST number columns (substring "gst no").
  if (colNorm === 'gst no') {
    if (norm === 'gst no') return true;
    if (
      norm.includes('gst no') &&
      !/\bcgst\s*no\b/.test(norm) &&
      !/\bsgst\s*no\b/.test(norm) &&
      !/\bigst\s*no\b/.test(norm)
    ) {
      return true;
    }
    return false;
  }

  // Header may be a composite label that contains the alias (e.g. "GST NO = Seller GSTIN").
  // Do not match when the alias is longer and merely contains the header text
  // (e.g. alias "Detailed Return Reason" must not match header "Return Reason").
  if (norm.includes(colNorm)) return true;
  return false;
};

/** Pick the single best GST column header (alias order = priority). */
export const resolvePrimaryGstHeaderKey = (
  headers: string[],
  excelColumns: string[],
): string | undefined => {
  for (const alias of excelColumns) {
    for (const header of headers) {
      if (headerMatchesExcelColumn(header, alias)) {
        return header;
      }
    }
  }
  return undefined;
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
  fileHeaders: string[] = [],
): {
  values: Set<string>;
  foundColumn: boolean;
  matchedHeaders: Set<string>;
  primaryHeader?: string;
} => {
  const values = new Set<string>();
  const matchedHeaders = new Set<string>();
  let foundColumn = false;

  const headerCandidates = fileHeaders.length
    ? fileHeaders
    : rows.length
      ? Object.keys(rows[0]).filter((key) => !key.startsWith('__'))
      : [];

  const primaryHeader = resolvePrimaryGstHeaderKey(
    headerCandidates,
    mapping.gstin.excelColumns,
  );

  if (primaryHeader) {
    foundColumn = true;
    matchedHeaders.add(primaryHeader);
    rows.forEach((row) => {
      const value = parseGstinFromCell(row[primaryHeader]);
      if (value) values.add(value);
    });
    return { values, foundColumn, matchedHeaders, primaryHeader };
  }

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

export type GstinValidationInput = {
  rows: ParsedSheetRow[];
  expectedGstin: string;
  mapping: MarketplaceImportMapping;
  fileHeaders?: string[];
  fallbackGstins?: string[];
};

export const resolveExpectedGstin = (expectedGstin: string): string => {
  const parsed = parseGstinFromCell(expectedGstin);
  if (parsed) return parsed;
  const compact = String(expectedGstin ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
  if (compact.length === 15 && isValidGstinFormat(compact)) {
    return compact;
  }
  return '';
};

export const collectGstinValidationProblems = (
  input: GstinValidationInput,
): string[] => {
  const problems: string[] = [];
  const fileHeaders = input.fileHeaders ?? [];
  const fallbackGstins = input.fallbackGstins ?? [];
  const selectedGSTIN = resolveExpectedGstin(input.expectedGstin);
  const gstColumn = input.mapping.gstin.excelColumns[0];

  const { values, foundColumn, matchedHeaders } = extractGstinsFromRows(
    input.rows,
    input.mapping,
    fileHeaders,
  );
  fallbackGstins.forEach((raw) => {
    const gstin = parseGstinFromCell(raw);
    if (gstin) values.add(gstin);
  });

  const headerHasGstColumn = headersHaveGstColumn(
    fileHeaders,
    input.mapping.gstin.excelColumns,
  );
  const gstColumnFound =
    foundColumn || headerHasGstColumn || fallbackGstins.length > 0;

  if (!gstColumnFound) {
    problems.push(
      `GSTIN column not found. Expected one of: ${input.mapping.gstin.excelColumns.map((c) => `"${c}"`).join(', ')}.`,
    );
    return problems;
  }

  if (!values.size) {
    const fillHint =
      input.mapping.key === 'flipkart'
        ? 'Ensure the Seller GSTIN column is filled on the Sales Report and Cash Back Report sheets.'
        : input.mapping.key === 'meesho'
          ? 'Ensure the gstin column is filled in TCS Sales Report.'
          : input.mapping.key === 'myntra'
            ? 'Ensure seller_gstin (or tax_seller_gstin) is filled in GSTR Report Packed.'
            : input.mapping.key === 'amazon'
              ? 'Ensure the Seller Gstin column is filled in your MTR report.'
              : 'Check that the GSTIN column is filled in your report.';
    problems.push(
      `GSTIN column "${gstColumn}" was found but contains no valid GSTIN values. ${fillHint}`,
    );
    return problems;
  }

  if (values.size > 1) {
    problems.push(
      `Multiple GSTINs found: ${[...values].join(', ')}. Only one seller GSTIN per file is allowed.`,
    );
  }

  if (!selectedGSTIN) {
    problems.push(
      `Selected GST profile has no valid GSTIN stored ("${String(input.expectedGstin ?? '').trim()}"). Re-verify the GST profile and try again.`,
    );
    return problems;
  }

  if (!values.has(selectedGSTIN)) {
    const columnHint =
      matchedHeaders.size > 0
        ? ` Column used: ${[...matchedHeaders].map((h) => `"${h}"`).join(', ')}.`
        : '';
    problems.push(
      `GSTIN does not match selected profile. Profile: "${selectedGSTIN}". Found in file: ${[...values].join(', ')}.${columnHint}`,
    );
  }

  return problems;
};

export const headersHaveGstColumn = (
  headers: string[],
  excelColumns: string[],
): boolean =>
  headers.some((header) => headerMatchesAnyExcelColumn(header, excelColumns));
