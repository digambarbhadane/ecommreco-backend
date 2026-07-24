import {
  collectGstinRowFilterProblems,
  filterRowsBySelectedGstin,
  headerMatchesExcelColumn,
  headersHaveGstColumn,
} from '../config/importMappings/gst-column.util';
import { myntraImportMapping } from '../config/importMappings/myntra.mapping';
import {
  MYNTRA_GSTR_PACKED_HEADERS,
  MYNTRA_GSTR_RTO_HEADERS,
  MYNTRA_GSTR_RT_HEADERS,
  MYNTRA_MDIRECT_ORDERS_HEADERS,
  MYNTRA_MDIRECT_RETURNS_HEADERS,
  MYNTRA_SALES_REVENUE_HEADERS,
} from './myntra-column-aliases';
import type { ParsedSheetRow } from '../services/mapping.service';

export type MyntraReportValidationInput = {
  reportLabel: string;
  fileName?: string;
  headers: string[];
  rows: ParsedSheetRow[];
  requiredHeaderGroups: string[][];
  checkGstin?: boolean;
};

const hasRequiredHeaders = (
  headers: string[],
  requiredHeaderGroups: string[][],
): string[] => {
  const missing: string[] = [];
  for (const group of requiredHeaderGroups) {
    const found = group.some((alias) =>
      headers.some((header) => headerMatchesExcelColumn(header, alias)),
    );
    if (!found) {
      missing.push(group[0]);
    }
  }
  return missing;
};

export type MyntraGstinFilterResult =
  | { ok: true; reports: MyntraReportValidationInput[]; skippedCount: number }
  | { ok: false; message: string };

const formatMyntraReportBlock = (
  index: number,
  reportLabel: string,
  fileName: string | undefined,
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
 * Validates report structure and keeps only rows matching the selected seller GSTIN.
 * Reports without a GSTIN column are passed through unchanged.
 */
export const filterMyntraReportsBySelectedGstin = (
  reports: MyntraReportValidationInput[],
  expectedGstin: string,
): MyntraGstinFilterResult => {
  const blocks: string[] = [];
  let skippedCount = 0;

  const filteredReports = reports.map((report) => {
    const structuralProblems: string[] = [];
    const missing = hasRequiredHeaders(
      report.headers,
      report.requiredHeaderGroups,
    );
    if (missing.length) {
      structuralProblems.push(
        `missing columns — ${missing.join(', ')}`,
      );
    }
    if (!report.rows.length) {
      structuralProblems.push('file has no data rows');
    }
    if (structuralProblems.length) {
      blocks.push(
        formatMyntraReportBlock(
          blocks.length + 1,
          report.reportLabel,
          report.fileName,
          structuralProblems,
        ),
      );
      return report;
    }

    const hasGstColumn = headersHaveGstColumn(
      report.headers,
      myntraImportMapping.gstin.excelColumns,
    );
    if (!hasGstColumn) {
      return report;
    }

    const filtered = filterRowsBySelectedGstin(
      report.rows,
      myntraImportMapping,
      report.headers,
      expectedGstin,
    );
    skippedCount += filtered.skippedCount;

    const gstProblems = collectGstinRowFilterProblems({
      rows: report.rows,
      expectedGstin,
      mapping: myntraImportMapping,
      fileHeaders: report.headers,
      matchedRowCount: filtered.matchedCount,
      fileGstins: filtered.fileGstins,
    });
    if (gstProblems.length) {
      blocks.push(
        formatMyntraReportBlock(
          blocks.length + 1,
          report.reportLabel,
          report.fileName,
          gstProblems,
        ),
      );
    }

    return { ...report, rows: filtered.rows };
  });

  if (!blocks.length) {
    return { ok: true, reports: filteredReports, skippedCount };
  }

  return {
    ok: false,
    message: [
      `Myntra import failed — GSTIN mismatch in ${blocks.length} file(s):`,
      '',
      ...blocks,
      '',
      'Ensure the GSTIN in each report matches the GST profile you selected (seller GSTIN, not marketplace or tax columns).',
    ].join('\n'),
  };
};

export const buildMyntraValidationMessage = (
  reports: MyntraReportValidationInput[],
  expectedGstin: string,
): string | null => {
  const result = filterMyntraReportsBySelectedGstin(reports, expectedGstin);
  return result.ok ? null : result.message;
};

export const formatMyntraJoinIssues = (issues: {
  missingOrderIdInGstr?: number;
  missingInMdirect?: number;
  missingInGstr?: number;
  missingInSales?: number;
}) => {
  const parts = [
    issues.missingOrderIdInGstr
      ? `${issues.missingOrderIdInGstr} sales row(s) missing order id in GSTR Packed`
      : '',
    issues.missingInSales
      ? `${issues.missingInSales} GSTR row(s) missing Sales Revenue match`
      : '',
    issues.missingInMdirect
      ? `${issues.missingInMdirect} row(s) missing MDirect Orders match (optional)`
      : '',
    issues.missingInGstr
      ? `${issues.missingInGstr} return row(s) missing GSTR Packed match`
      : '',
  ].filter(Boolean);
  return `Myntra import could not build rows. ${parts.join('; ')}.`;
};

export const formatMyntraEmptyImport = (counts: Record<string, number>) => {
  const detail = Object.entries(counts)
    .map(([label, count]) => `${label}: ${count} row(s)`)
    .join(', ');
  return `Myntra import produced no records. Parsed counts — ${detail}. Check file formats and required columns.`;
};

export {
  MYNTRA_GSTR_PACKED_HEADERS,
  MYNTRA_MDIRECT_ORDERS_HEADERS,
  MYNTRA_SALES_REVENUE_HEADERS,
  MYNTRA_GSTR_RTO_HEADERS,
  MYNTRA_GSTR_RT_HEADERS,
  MYNTRA_MDIRECT_RETURNS_HEADERS,
};
