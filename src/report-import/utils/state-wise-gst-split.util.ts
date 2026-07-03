import {
  collectSellerRegistrationStateKeys,
  isSameIndianState,
} from './gst-state.util';
import type { StateWiseAggregatedRow } from './state-wise-report.aggregation';

export type StateWiseGstRowInput = {
  stateName?: string | null;
  igstRate?: number | null;
  cgstRate?: number | null;
  sgstRate?: number | null;
  igstAmount?: number | null;
  cgstAmount?: number | null;
  sgstAmount?: number | null;
  taxableAmount?: number | null;
  invoiceAmount?: number | null;
  quantity?: number | null;
  returnQty?: number | null;
  meeshoIsGrossSale?: boolean | null;
};

/** Total GST on a row (IGST or CGST+SGST, never double-count both). */
export function getRowTotalGstAmount(row: StateWiseGstRowInput): number {
  const igst = Math.abs(Number(row.igstAmount ?? 0));
  const cgst = Math.abs(Number(row.cgstAmount ?? 0));
  const sgst = Math.abs(Number(row.sgstAmount ?? 0));
  const cgstSgst = cgst + sgst;
  if (igst > 0 && cgstSgst > 0) {
    return Math.max(igst, cgstSgst);
  }
  return igst + cgstSgst;
}

export function resolveRowGstRate(row: StateWiseGstRowInput): number {
  const igstRate = Number(row.igstRate ?? 0);
  if (igstRate > 0) return igstRate;
  return Number(row.cgstRate ?? 0) + Number(row.sgstRate ?? 0);
}

export function isMeeshoReturnRow(row: StateWiseGstRowInput): boolean {
  return row.meeshoIsGrossSale === false;
}

export function getReportRowGstSign(row: StateWiseGstRowInput): number {
  if (isMeeshoReturnRow(row)) return -1;

  const igst = Number(row.igstAmount ?? 0);
  const cgst = Number(row.cgstAmount ?? 0);
  const sgst = Number(row.sgstAmount ?? 0);
  const taxSum = igst + cgst + sgst;
  if (taxSum !== 0) return taxSum < 0 ? -1 : 1;

  const invoice = Number(row.invoiceAmount ?? 0);
  return invoice < 0 ? -1 : 1;
}

/**
 * Indian GST split for reports (state-wise + month summary):
 * - Intra-state (seller registration == order state): CGST/SGST = half each, IGST = 0
 * - Inter-state: IGST = full amount, CGST/SGST = 0
 */
export function splitGstForReportRow(
  row: StateWiseGstRowInput,
  sellerStateKeys: Set<string>,
): { igst: number; cgst: number; sgst: number } {
  const totalGst = getRowTotalGstAmount(row);
  if (totalGst === 0) {
    return { igst: 0, cgst: 0, sgst: 0 };
  }

  const sign = getReportRowGstSign(row);
  const isIntra = isSameIndianState(row.stateName ?? '', sellerStateKeys);

  if (isIntra) {
    const half = (totalGst / 2) * sign;
    return { igst: 0, cgst: half, sgst: half };
  }

  return { igst: totalGst * sign, cgst: 0, sgst: 0 };
}

/** @deprecated Use splitGstForReportRow */
export function splitGstForStateWiseRow(
  row: StateWiseGstRowInput,
  sellerStateKeys: Set<string>,
): { igst: number; cgst: number; sgst: number } {
  return splitGstForReportRow(row, sellerStateKeys);
}

export function sellerStateKeysFromRegistration(
  registeredState?: string | null,
  gstNumber?: string | null,
): Set<string> {
  const states = registeredState?.trim() ? [registeredState.trim()] : [];
  const gstins = gstNumber?.trim() ? [gstNumber.trim()] : [];
  return collectSellerRegistrationStateKeys(states, gstins);
}

export function aggregateStateWiseRows(
  rows: StateWiseGstRowInput[],
  sellerStateKeys: Set<string>,
): StateWiseAggregatedRow[] {
  const groups = new Map<
    string,
    StateWiseAggregatedRow & { _hasActivity: boolean }
  >();

  for (const row of rows) {
    const sign = getReportRowGstSign(row);
    const qty =
      sign *
      Number(
        isMeeshoReturnRow(row)
          ? (row.returnQty ?? row.quantity ?? 0)
          : (row.quantity ?? 0),
      );
    const taxableValue = sign * Number(row.taxableAmount ?? 0);
    const invoiceAmount = sign * Number(row.invoiceAmount ?? 0);
    const tax = splitGstForReportRow(row, sellerStateKeys);

    const stateName = String(row.stateName ?? 'Unknown').trim() || 'Unknown';
    const gstRate = resolveRowGstRate(row);
    const key = `${stateName.toLowerCase()}\0${gstRate}`;

    const existing = groups.get(key) ?? {
      stateName,
      gstRate,
      qty: 0,
      taxableValue: 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      invoiceAmount: 0,
      _hasActivity: false,
    };

    existing.qty += qty;
    existing.taxableValue += taxableValue;
    existing.igst += tax.igst;
    existing.cgst += tax.cgst;
    existing.sgst += tax.sgst;
    existing.invoiceAmount += invoiceAmount;
    existing._hasActivity =
      existing._hasActivity ||
      qty !== 0 ||
      taxableValue !== 0 ||
      invoiceAmount !== 0;

    groups.set(key, existing);
  }

  return Array.from(groups.values())
    .filter((row) => row._hasActivity)
    .map(({ _hasActivity: _, ...row }) => row)
    .sort((a, b) => {
      const stateCmp = a.stateName.localeCompare(b.stateName, 'en', {
        sensitivity: 'base',
      });
      if (stateCmp !== 0) return stateCmp;
      return a.gstRate - b.gstRate;
    });
}
