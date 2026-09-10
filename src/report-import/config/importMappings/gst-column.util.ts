import { ParsedSheetRow } from '../../services/mapping.service';
import { normalizeHeader } from '../../utils/header.util';
import { MarketplaceImportMapping } from './types';
import { flipkartImportMapping } from './flipkart.mapping';

/** Indian GSTIN pattern (15 chars) — allow digit 0 in entity position for loose match. */
const GSTIN_IN_TEXT = /[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]/;

const GSTIN_STRICT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

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

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const asText = String(raw);
    if (/E[+-]?/i.test(asText)) return undefined;
    return parseGstinFromText(asText);
  }

  return parseGstinFromText(String(raw));
};

const scoreGstHeaderLabel = (header: string): number => {
  const norm = normalizeHeader(header);
  if (!norm) return 0;
  if (norm === 'seller gstin' || norm.includes('seller gstin')) return 100;
  if (norm.includes('supplier gstin') || norm.includes('gstin of seller'))
    return 90;
  if (norm.includes('gst registration')) return 80;
  if (norm === 'gstin' || norm === 'gstin/uin') return 75;
  if (norm === 'gst no' || norm.includes('gst no')) return 50;
  return 10;
};

const parseGstinFromText = (raw: string): string | undefined => {
  let text = raw
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
    .trim()
    .toUpperCase();
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

/** Marketplace / TCS tax columns — not the seller GSTIN column. */
const isExcludedNonSellerGstHeader = (normalizedHeader: string): boolean => {
  if (!normalizedHeader) return false;
  if (/\beco\s*tcs\b/.test(normalizedHeader)) return true;
  if (
    /\bmarketplace\b/.test(normalizedHeader) &&
    /\bgstin\b/.test(normalizedHeader)
  ) {
    return true;
  }
  if (
    /\btcs\b/.test(normalizedHeader) &&
    /\bgstin\b/.test(normalizedHeader) &&
    !/\bseller\b/.test(normalizedHeader)
  ) {
    return true;
  }
  return false;
};

export const headerMatchesExcelColumn = (
  headerKey: string,
  excelColumn: string,
): boolean => {
  const norm = normalizeHeader(headerKey);
  const colNorm = normalizeHeader(excelColumn);
  if (!norm || !colNorm) return false;
  if (isExcludedNonSellerGstHeader(norm)) return false;
  if (norm === colNorm) return true;

  // Exact "gstin" column only — not eco_tcs_gstin or other compound headers.
  if (colNorm === 'gstin') {
    return norm === 'gstin';
  }

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

  // Generic "gst rate" / "tax rate" must not match CGST/SGST-specific columns.
  if (colNorm === 'gst rate' || colNorm === 'tax rate') {
    if (/\bcgst\b/.test(norm) || /\bsgst\b/.test(norm)) return false;
    if (colNorm === 'tax rate' && /\bigst\b/.test(norm)) return false;
  }

  // Header may be a composite label that contains the alias (e.g. "GST NO = Seller GSTIN").
  // Do not match when the alias is longer and merely contains the header text
  // (e.g. alias "Detailed Return Reason" must not match header "Return Reason").
  if (norm.includes(colNorm)) return true;
  return false;
};

/** Pick the single best GST column header (seller-specific labels win over generic GST NO). */
export const resolvePrimaryGstHeaderKey = (
  headers: string[],
  excelColumns: string[],
): string | undefined => {
  let bestHeader: string | undefined;
  let bestScore = -1;
  for (const header of headers) {
    const matched = excelColumns.some((alias) =>
      headerMatchesExcelColumn(header, alias),
    );
    if (!matched) continue;
    const score = scoreGstHeaderLabel(header);
    if (score > bestScore) {
      bestScore = score;
      bestHeader = header;
    }
  }
  return bestHeader;
};

export const headerMatchesAnyExcelColumn = (
  headerKey: string,
  excelColumns: string[],
): boolean =>
  excelColumns.some((col) => headerMatchesExcelColumn(headerKey, col));

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

export const resolveGstHeaderKeys = (
  headers: string[],
  excelColumns: string[],
): string[] =>
  headers.filter((header) => headerMatchesAnyExcelColumn(header, excelColumns));

/** Forward-fill empty GSTIN cells from the previous row (common in Flipkart exports). */
export const enrichRowsWithForwardFilledGstin = (
  rows: ParsedSheetRow[],
  mapping: MarketplaceImportMapping,
  fileHeaders: string[] = [],
): ParsedSheetRow[] => {
  const gstKeys = resolveGstHeaderKeys(
    fileHeaders.length
      ? fileHeaders
      : rows.length
        ? Object.keys(rows[0]).filter((key) => !key.startsWith('__'))
        : [],
    mapping.gstin.excelColumns,
  );
  if (!gstKeys.length) return rows;

  let lastGstin: string | undefined;
  return rows.map((row) => {
    const next: ParsedSheetRow = { ...row };
    let rowGstin = extractGstinFromRow(next, mapping.gstin.excelColumns);

    if (!rowGstin && lastGstin) {
      for (const key of gstKeys) {
        if (key in next) {
          next[key] = lastGstin;
        }
      }
      rowGstin = lastGstin;
    }

    if (rowGstin) {
      lastGstin = rowGstin;
    }

    return next;
  });
};

/**
 * Flipkart often includes a Seller GSTIN column header with blank cells (seller is implicit
 * in the downloaded report). When the upload GST profile is set, stamp it on those rows.
 */
export const hydrateFlipkartRowsWithProfileGstin = (
  rows: ParsedSheetRow[],
  fileHeaders: string[],
  expectedGstin: string,
  mapping: MarketplaceImportMapping = flipkartImportMapping,
): ParsedSheetRow[] => {
  if (!rows.length) return rows;
  if (!headersHaveGstColumn(fileHeaders, mapping.gstin.excelColumns))
    return rows;

  const profileGstin = resolveExpectedGstin(expectedGstin);
  if (!profileGstin) return rows;

  const anyRowHasGstin = rows.some(
    (row) => !!extractGstinFromRow(row, mapping.gstin.excelColumns),
  );
  if (anyRowHasGstin) return rows;

  const gstKey =
    resolvePrimaryGstHeaderKey(fileHeaders, mapping.gstin.excelColumns) ??
    'Seller GSTIN';

  return rows.map((row) => ({ ...row, [gstKey]: profileGstin }));
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

  const gstHeaderKeys = resolveGstHeaderKeys(
    headerCandidates,
    mapping.gstin.excelColumns,
  ).sort((a, b) => scoreGstHeaderLabel(b) - scoreGstHeaderLabel(a));

  if (primaryHeader && !gstHeaderKeys.includes(primaryHeader)) {
    gstHeaderKeys.unshift(primaryHeader);
  }

  for (const headerKey of gstHeaderKeys) {
    foundColumn = true;
    matchedHeaders.add(headerKey);
    let foundInColumn = false;
    rows.forEach((row) => {
      const value = parseGstinFromCell(row[headerKey]);
      if (value) {
        values.add(value);
        foundInColumn = true;
      }
    });
    if (foundInColumn) break;
  }

  if (!values.size) {
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
  }

  return {
    values,
    foundColumn,
    matchedHeaders,
    primaryHeader: primaryHeader ?? gstHeaderKeys[0],
  };
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

export type FilterRowsByGstinResult = {
  rows: ParsedSheetRow[];
  matchedCount: number;
  skippedCount: number;
  fileGstins: Set<string>;
};

/** Keep only rows whose GSTIN column matches the selected profile GSTIN. */
export const filterRowsBySelectedGstin = (
  rows: ParsedSheetRow[],
  mapping: MarketplaceImportMapping,
  fileHeaders: string[] = [],
  expectedGstin: string,
): FilterRowsByGstinResult => {
  const enrichedRows = enrichRowsWithForwardFilledGstin(
    rows,
    mapping,
    fileHeaders,
  );
  const selectedGSTIN = resolveExpectedGstin(expectedGstin);
  const matching: ParsedSheetRow[] = [];
  let skippedCount = 0;
  const fileGstins = new Set<string>();

  for (const row of enrichedRows) {
    const rowGstin = extractGstinFromRow(row, mapping.gstin.excelColumns);
    if (rowGstin) {
      fileGstins.add(rowGstin);
    }
    if (!selectedGSTIN || rowGstin !== selectedGSTIN) {
      skippedCount += 1;
      continue;
    }
    matching.push(row);
  }

  return {
    rows: matching,
    matchedCount: matching.length,
    skippedCount,
    fileGstins,
  };
};

export type GstinRowFilterValidationInput = GstinValidationInput & {
  matchedRowCount: number;
  fileGstins?: Set<string>;
};

/** Validates GST column presence and that at least one row matches the selected GSTIN. */
export const collectGstinRowFilterProblems = (
  input: GstinRowFilterValidationInput,
): string[] => {
  const problems: string[] = [];
  const fileHeaders = input.fileHeaders ?? [];
  const fallbackGstins = input.fallbackGstins ?? [];
  const selectedGSTIN = resolveExpectedGstin(input.expectedGstin);
  const gstColumn = input.mapping.gstin.excelColumns[0];

  const { values, foundColumn } = extractGstinsFromRows(
    input.rows,
    input.mapping,
    fileHeaders,
  );
  fallbackGstins.forEach((raw) => {
    const gstin = parseGstinFromCell(raw);
    if (gstin) values.add(gstin);
  });

  const fileGstins = input.fileGstins ?? values;
  fallbackGstins.forEach((raw) => {
    const gstin = parseGstinFromCell(raw);
    if (gstin) fileGstins.add(gstin);
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

  if (!selectedGSTIN) {
    problems.push(
      `Selected GST profile has no valid GSTIN stored ("${String(input.expectedGstin ?? '').trim()}"). Re-verify the GST profile and try again.`,
    );
    return problems;
  }

  if (input.matchedRowCount <= 0) {
    if (input.rows.length === 0 && headerHasGstColumn) {
      const fillHint =
        input.mapping.key === 'flipkart'
          ? 'No data rows were read from Sales Report or Cash Back Report. Check that those sheets contain invoice rows below the header.'
          : 'No data rows were read from the report.';
      problems.push(`GSTIN column "${gstColumn}" was found but ${fillHint}`);
      return problems;
    }
    if (fileGstins.size > 0) {
      problems.push(
        `No rows found for selected GSTIN "${selectedGSTIN}". File contains: ${[...fileGstins].join(', ')}. Only rows matching the selected GST profile are imported.`,
      );
    } else {
      const fillHint =
        input.mapping.key === 'flipkart'
          ? 'Ensure the Seller GSTIN column is filled on the Sales Report and Cash Back Report sheets.'
          : 'Check that the GSTIN column is filled in your report.';
      problems.push(
        `GSTIN column "${gstColumn}" was found but contains no valid GSTIN values. ${fillHint}`,
      );
    }
  }

  return problems;
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
    const selectedGSTIN = resolveExpectedGstin(input.expectedGstin);
    if (!selectedGSTIN || !values.has(selectedGSTIN)) {
      problems.push(
        `Multiple GSTINs found: ${[...values].join(', ')}. Selected profile GSTIN "${selectedGSTIN || input.expectedGstin}" was not found in the file.`,
      );
    }
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
    if (values.size > 1) {
      problems.push(
        `No rows found for selected GSTIN "${selectedGSTIN}". File contains: ${[...values].join(', ')}. Only rows matching the selected GST profile are imported.${columnHint}`,
      );
    } else {
      problems.push(
        `GSTIN does not match selected profile. Profile: "${selectedGSTIN}". Found in file: ${[...values].join(', ')}.${columnHint}`,
      );
    }
  }

  return problems;
};

export const headersHaveGstColumn = (
  headers: string[],
  excelColumns: string[],
): boolean =>
  headers.some((header) => headerMatchesAnyExcelColumn(header, excelColumns));
