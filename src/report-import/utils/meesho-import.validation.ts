import { meeshoImportMapping } from '../config/importMappings/meesho.mapping';
import {
  collectGstinRowFilterProblems,
  filterRowsBySelectedGstin,
  headersHaveGstColumn,
} from '../config/importMappings/gst-column.util';
import { ParsedSheetRow } from '../services/mapping.service';

export type MeeshoReportValidationInput = {
  reportLabel: string;
  fileName: string;
  headers: string[];
  rows: ParsedSheetRow[];
};

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

export type MeeshoGstinFilterResult =
  | { ok: true; reports: MeeshoReportValidationInput[]; skippedCount: number }
  | { ok: false; message: string };

/**
 * Keeps only rows matching the selected seller GSTIN and validates at least one row matches.
 * Reports without a GSTIN column are passed through unchanged.
 */
export const filterMeeshoReportsBySelectedGstin = (
  reports: MeeshoReportValidationInput[],
  expectedGstin: string,
): MeeshoGstinFilterResult => {
  const blocks: string[] = [];
  let skippedCount = 0;

  const filteredReports = reports.map((report) => {
    const hasGstColumn = headersHaveGstColumn(
      report.headers,
      meeshoImportMapping.gstin.excelColumns,
    );
    if (!hasGstColumn) {
      return report;
    }

    const filtered = filterRowsBySelectedGstin(
      report.rows,
      meeshoImportMapping,
      report.headers,
      expectedGstin,
    );
    skippedCount += filtered.skippedCount;

    const problems = collectGstinRowFilterProblems({
      rows: report.rows,
      expectedGstin,
      mapping: meeshoImportMapping,
      fileHeaders: report.headers,
      matchedRowCount: filtered.matchedCount,
      fileGstins: filtered.fileGstins,
    });

    if (problems.length > 0) {
      blocks.push(
        formatReportBlock(
          blocks.length + 1,
          report.reportLabel,
          report.fileName,
          problems,
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
      `Meesho import failed — GSTIN mismatch in ${blocks.length} file(s):`,
      '',
      ...blocks,
      '',
      'Ensure the GSTIN in each report matches the GST profile you selected (seller GSTIN, not marketplace or tax columns).',
    ].join('\n'),
  };
};

/** @deprecated Use filterMeeshoReportsBySelectedGstin — kept for tests referencing strict validation. */
export const buildMeeshoGstinValidationMessage = (
  reports: MeeshoReportValidationInput[],
  expectedGstin: string,
): string | null => {
  const result = filterMeeshoReportsBySelectedGstin(reports, expectedGstin);
  return result.ok ? null : result.message;
};
