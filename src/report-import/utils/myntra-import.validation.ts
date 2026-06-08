import { myntraImportMapping } from '../config/importMappings/myntra.mapping';
import {
  collectGstinValidationProblems,
  headerMatchesExcelColumn,
  headersHaveGstColumn,
} from '../config/importMappings/gst-column.util';
import { ParsedSheetRow } from '../services/mapping.service';

export type MyntraReportValidationInput = {
  reportLabel: string;
  fileName: string;
  headers: string[];
  rows: ParsedSheetRow[];
  requiredHeaderGroups: string[][];
  /** When true, GSTIN column and match are checked (GSTR Packed / RTO / RT). */
  checkGstin?: boolean;
};

const formatExpected = (aliases: string[]) =>
  aliases.length > 1
    ? `one of: ${aliases.map((a) => `"${a}"`).join(', ')}`
    : `"${aliases[0]}"`;

const formatHeadersFound = (headers: string[], max = 20): string => {
  const cleaned = headers
    .map((h) => String(h ?? '').trim())
    .filter((h) => h.length > 0);
  if (!cleaned.length) {
    return '(no column headers detected — check header row or file format)';
  }
  if (cleaned.length <= max) {
    return cleaned.map((h) => `"${h}"`).join(', ');
  }
  return `${cleaned
    .slice(0, max)
    .map((h) => `"${h}"`)
    .join(', ')}, … (+${cleaned.length - max} more)`;
};

export const findMissingHeaderGroups = (
  headers: string[],
  requiredHeaderGroups: string[][],
): string[][] =>
  requiredHeaderGroups.filter((aliases) => {
    const hit = headers.some((header) =>
      aliases.some((alias) => headerMatchesExcelColumn(header, alias)),
    );
    return !hit;
  });

const collectGstinProblems = (
  report: MyntraReportValidationInput,
  expectedGstin: string,
): string[] =>
  collectGstinValidationProblems({
    rows: report.rows,
    expectedGstin,
    mapping: myntraImportMapping,
    fileHeaders: report.headers,
  });

const formatReportBlock = (
  index: number,
  reportLabel: string,
  fileName: string,
  problems: string[],
): string => {
  const lines = [
    `${index}) ${reportLabel}`,
    `   File: ${fileName || '(unknown)'}`,
    ...problems.map((p) => `   • ${p}`),
  ];
  return lines.join('\n');
};

/**
 * Returns a multi-line error message, or null if all reports pass validation.
 */
export const buildMyntraValidationMessage = (
  reports: MyntraReportValidationInput[],
  expectedGstin: string,
): string | null => {
  const blocks: string[] = [];

  reports.forEach((report) => {
    const problems: string[] = [];

    const missingGroups = findMissingHeaderGroups(
      report.headers,
      report.requiredHeaderGroups,
    );
    if (missingGroups.length > 0) {
      missingGroups.forEach((aliases) => {
        problems.push(`Missing column — expected ${formatExpected(aliases)}.`);
      });
    }

    if (report.rows.length === 0) {
      problems.push(
        'No data rows parsed (0 rows). The header row may be wrong or the sheet is empty.',
      );
    }

    if (report.checkGstin && report.rows.length > 0) {
      problems.push(...collectGstinProblems(report, expectedGstin));
    }

    if (problems.length > 0) {
      problems.push(
        `Columns detected in file: ${formatHeadersFound(report.headers)}`,
      );
      blocks.push(
        formatReportBlock(
          blocks.length + 1,
          report.reportLabel,
          report.fileName,
          problems,
        ),
      );
    }
  });

  if (!blocks.length) return null;

  return [
    `Myntra import failed — ${blocks.length} report(s) need attention:`,
    '',
    ...blocks,
    '',
    'Fix the report(s) listed above and re-upload. Four reports are required (GSTR Packed, Sales Revenue B2C, GSTR RTO, GSTR RT); MDirect Orders and Returns are optional.',
  ].join('\n');
};

export {
  MYNTRA_GSTR_PACKED_HEADERS,
  MYNTRA_MDIRECT_ORDERS_HEADERS,
  MYNTRA_SALES_REVENUE_HEADERS,
  MYNTRA_GSTR_RTO_HEADERS,
  MYNTRA_GSTR_RT_HEADERS,
  MYNTRA_MDIRECT_RETURNS_HEADERS,
} from './myntra-column-aliases';

export const formatMyntraJoinIssues = (issues: {
  missingOrderIdInSales: number;
  missingInGstr: number;
  missingInMdirect: number;
  sampleSalesOrderCodes?: string[];
  sampleGstrKeys?: string[];
  sampleMdirectKeys?: string[];
}): string => {
  const lines = [
    'Myntra import failed — order IDs could not be matched across reports:',
    '',
  ];
  if (issues.missingOrderIdInSales > 0) {
    lines.push(
      `• Sales Revenue Packed B2C: ${issues.missingOrderIdInSales} row(s) missing Sale_Order_Code / sale_order_code.`,
    );
  }
  if (issues.missingInGstr > 0) {
    lines.push(
      `• GSTR Report Packed: ${issues.missingInGstr} sales row(s) — no matching key in GSTR (tried order_id, order_release_id, sale_order_code, shipment_id).`,
    );
  }
  if (issues.missingInMdirect > 0) {
    lines.push(
      `• MDirect Orders Report: ${issues.missingInMdirect} sales row(s) — no matching order_release_id / order_id.`,
    );
  }
  if (issues.sampleSalesOrderCodes?.length) {
    lines.push(
      `  Sample Sale_Order_Code from Sales Revenue: ${issues.sampleSalesOrderCodes.join(', ')}`,
    );
  }
  if (issues.sampleGstrKeys?.length) {
    lines.push(
      `  Sample order keys from GSTR Packed: ${issues.sampleGstrKeys.join(', ')}`,
    );
  }
  if (issues.sampleMdirectKeys?.length) {
    lines.push(
      `  Sample order keys from MDirect Orders: ${issues.sampleMdirectKeys.join(', ')}`,
    );
  }
  lines.push(
    '',
    'Sale_Order_Code in Sales Revenue must match order_id in GSTR Packed. When MDirect Orders is uploaded, it should also match order_release_id there for SKU enrichment.',
  );
  return lines.join('\n');
};

export const formatMyntraEmptyImport = (counts: Record<string, number>): string =>
  [
    'Myntra import produced no records. Data rows parsed per file:',
    '',
    ...Object.entries(counts).map(([label, n]) => `• ${label}: ${n} row(s)`),
    '',
    'If any file shows 0 rows, fix that report first (see column requirements in the error above).',
  ].join('\n');
