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

export type MyntraParsedReturnBundle = {
  gstrReportRto: { rows: ParsedSheetRow[]; headers: string[] };
  gstrReportRt: { rows: ParsedSheetRow[]; headers: string[] };
};

const RTO_CANCEL_DATE_ALIASES = [
  'order_cancel_date',
  'Order Cancel Date',
  'Cancel Date',
];

const RT_REFUND_DATE_ALIASES = [
  'fr_refunded_date',
  'FR Refunded Date',
  'Refunded Date',
  'refund_date',
  'Refund Date',
  'return_refund_date',
  'Return Refund Date',
  'customer_return_date',
  'Customer Return Date',
];

const RT_PACKET_ALIASES = [
  'packet_id',
  'Packet ID',
  'Packet_Id',
  'shipment_id',
  'Shipment ID',
];

const headersMatchAnyAlias = (headers: string[], aliases: string[]): boolean =>
  aliases.some((alias) =>
    headers.some((header) => headerMatchesExcelColumn(header, alias)),
  );

/** Detect whether a GSTR return workbook is RTO or RT from its headers. */
export const detectMyntraGstrReturnFileKind = (
  headers: string[],
): 'rto' | 'rt' | 'unknown' => {
  const hasRefundDate = headersMatchAnyAlias(headers, RT_REFUND_DATE_ALIASES);
  const hasPacket = headersMatchAnyAlias(headers, RT_PACKET_ALIASES);
  const hasCancelDate = headersMatchAnyAlias(headers, RTO_CANCEL_DATE_ALIASES);

  // RTO exports often include packet/shipment columns; cancel date is the definitive RTO marker.
  if (hasCancelDate) return 'rto';
  if (hasRefundDate) return 'rt';
  if (hasPacket) return 'rt';
  return 'unknown';
};

/**
 * Auto-correct when RTO and RT files were uploaded to the wrong slots.
 * Returns an error message when a file is clearly in the wrong slot.
 */
export const correctMyntraReturnFileAssignment = (
  parsed: MyntraParsedReturnBundle,
  fileNames?: { rto?: string; rt?: string },
): { swapped: boolean; message?: string; error?: string } => {
  const rtoKind = detectMyntraGstrReturnFileKind(parsed.gstrReportRto.headers);
  const rtKind = detectMyntraGstrReturnFileKind(parsed.gstrReportRt.headers);

  if (rtoKind === 'rt' && rtKind === 'rto') {
    const rto = parsed.gstrReportRto;
    parsed.gstrReportRto = parsed.gstrReportRt;
    parsed.gstrReportRt = rto;
    return {
      swapped: true,
      message:
        'Detected RTO and RT files in the wrong upload slots and swapped them automatically.',
    };
  }

  if (rtKind === 'rto') {
    return {
      swapped: false,
      error: [
        `The file "${fileNames?.rt ?? 'GSTR Report RT'}" looks like a GSTR RTO report`,
        '(it has order cancel date columns, not FR refunded date / packet id).',
        'Upload it under "GSTR Report RTO — RTO", not "GSTR Report RT — Customer Return".',
      ].join(' '),
    };
  }

  if (rtoKind === 'rt') {
    return {
      swapped: false,
      error: [
        `The file "${fileNames?.rto ?? 'GSTR Report RTO'}" looks like a GSTR RT / customer return report`,
        '(it has FR refunded date columns and no order cancel date).',
        'Upload it under "GSTR Report RT — Customer Return", not "GSTR Report RTO — RTO".',
      ].join(' '),
    };
  }

  return { swapped: false };
};

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
  const structuralBlocks: string[] = [];
  const gstBlocks: string[] = [];
  let skippedCount = 0;

  const filteredReports = reports.map((report) => {
    const structuralProblems: string[] = [];
    const missing = hasRequiredHeaders(
      report.headers,
      report.requiredHeaderGroups,
    );
    if (missing.length) {
      const detectedKind =
        report.reportLabel === 'GSTR Report RT' ||
        report.reportLabel === 'GSTR Report RTO'
          ? detectMyntraGstrReturnFileKind(report.headers)
          : 'unknown';
      if (
        report.reportLabel === 'GSTR Report RT' &&
        detectedKind === 'rto'
      ) {
        structuralProblems.push(
          'this file looks like a GSTR RTO report — upload it under GSTR Report RTO, not GSTR Report RT',
        );
      } else if (
        report.reportLabel === 'GSTR Report RTO' &&
        detectedKind === 'rt'
      ) {
        structuralProblems.push(
          'this file looks like a GSTR RT / customer return report — upload it under GSTR Report RT, not GSTR Report RTO',
        );
      } else {
        structuralProblems.push(`missing columns — ${missing.join(', ')}`);
      }
    }
    if (!report.rows.length) {
      structuralProblems.push('file has no data rows');
    }
    if (structuralProblems.length) {
      structuralBlocks.push(
        formatMyntraReportBlock(
          structuralBlocks.length + 1,
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
      gstBlocks.push(
        formatMyntraReportBlock(
          gstBlocks.length + 1,
          report.reportLabel,
          report.fileName,
          gstProblems,
        ),
      );
    }

    return { ...report, rows: filtered.rows };
  });

  if (!structuralBlocks.length && !gstBlocks.length) {
    return { ok: true, reports: filteredReports, skippedCount };
  }

  const lines: string[] = [];
  if (structuralBlocks.length) {
    lines.push(
      `Myntra import failed — fix file format or upload slot in ${structuralBlocks.length} file(s):`,
      '',
      ...structuralBlocks,
    );
  }
  if (gstBlocks.length) {
    if (lines.length) lines.push('');
    lines.push(
      `GSTIN mismatch in ${gstBlocks.length} file(s):`,
      '',
      ...gstBlocks,
      '',
      'Ensure the GSTIN in each report matches the GST profile you selected (seller GSTIN, not marketplace or tax columns).',
    );
  }

  return {
    ok: false,
    message: lines.join('\n'),
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
