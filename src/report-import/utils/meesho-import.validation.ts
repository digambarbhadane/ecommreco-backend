import { meeshoImportMapping } from '../config/importMappings/meesho.mapping';
import {
  collectGstinValidationProblems,
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

/**
 * Returns a multi-line error message, or null if all GSTIN checks pass.
 * Only reports that contain a GSTIN column are validated.
 */
export const buildMeeshoGstinValidationMessage = (
  reports: MeeshoReportValidationInput[],
  expectedGstin: string,
): string | null => {
  const blocks: string[] = [];

  reports.forEach((report) => {
    const hasGstColumn = headersHaveGstColumn(
      report.headers,
      meeshoImportMapping.gstin.excelColumns,
    );
    if (!hasGstColumn) {
      return;
    }

    const problems = collectGstinValidationProblems({
      rows: report.rows,
      expectedGstin,
      mapping: meeshoImportMapping,
      fileHeaders: report.headers,
      fallbackGstins: [],
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
  });

  if (!blocks.length) return null;

  return [
    `Meesho import failed — GSTIN mismatch in ${blocks.length} file(s):`,
    '',
    ...blocks,
    '',
    'Ensure the GSTIN in each report matches the GST profile you selected (seller GSTIN, not marketplace or tax columns).',
  ].join('\n');
};
