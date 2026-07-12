import { headerMatchesExcelColumn } from '../config/importMappings/gst-column.util';
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

export const buildMyntraValidationMessage = (
  reports: MyntraReportValidationInput[],
  expectedGstin: string,
): string | null => {
  const problems: string[] = [];

  for (const report of reports) {
    const missing = hasRequiredHeaders(
      report.headers,
      report.requiredHeaderGroups,
    );
    if (missing.length) {
      problems.push(
        `${report.reportLabel}: missing columns — ${missing.join(', ')}`,
      );
    }
    if (!report.rows.length) {
      problems.push(`${report.reportLabel}: file has no data rows`);
    }
    if (report.checkGstin && report.rows.length) {
      const gstinAliases = [
        'seller_gstin',
        'tax_seller_gstin',
        'Seller Gstin',
        'GST NO',
        'GSTIN',
      ];
      const normalizedExpected = String(expectedGstin ?? '')
        .trim()
        .toUpperCase();
      let foundGstin = false;
      for (const row of report.rows.slice(0, 500)) {
        for (const [key, value] of Object.entries(row)) {
          if (key.startsWith('__')) continue;
          if (
            !gstinAliases.some((alias) =>
              headerMatchesExcelColumn(key, alias),
            )
          ) {
            continue;
          }
          const cell = String(value ?? '')
            .trim()
            .toUpperCase();
          if (cell && cell === normalizedExpected) {
            foundGstin = true;
            break;
          }
        }
        if (foundGstin) break;
      }
      if (!foundGstin) {
        problems.push(
          `${report.reportLabel}: no rows match selected GSTIN ${expectedGstin}`,
        );
      }
    }
  }

  if (!problems.length) return null;
  return ['Myntra import validation failed:', ...problems.map((p) => `• ${p}`)].join(
    '\n',
  );
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
