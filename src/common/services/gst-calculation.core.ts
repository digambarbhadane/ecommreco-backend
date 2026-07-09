import {
  collectSellerRegistrationStateKeys,
  getGstStateCodeFromGstin,
  isSameIndianState,
  normalizeState,
  resolveCustomerIndianStateCode,
  resolveIndianStateCode,
  resolveIndianStateKey,
} from '../gst/gst-state.util';

export type GstTransactionType = 'intra' | 'inter';

export type SellerGstContext = {
  states: string[];
  gstins: string[];
  stateKeys: Set<string>;
  primaryGstin?: string;
};

export type CalculateGstInput = {
  taxableValue: number;
  gstRate: number;
  sellerState?: string | null;
  sellerGstin?: string | null;
  orderState?: string | null;
  orderStateCode?: string | null;
  sellerStateKeys?: Set<string>;
  igstAmount?: number | null;
  cgstAmount?: number | null;
  sgstAmount?: number | null;
  igstRate?: number | null;
  cgstRate?: number | null;
  sgstRate?: number | null;
};

export type GstCalculationResult = {
  igst: number;
  cgst: number;
  sgst: number;
  gstAmount: number;
  invoiceAmount: number;
  transactionType: GstTransactionType;
  igstRate?: number;
  cgstRate?: number;
  sgstRate?: number;
};

export type ImportRowGstInput = {
  sellerGSTIN?: string;
  customerStateCode?: string;
  stateName?: string;
  taxableAmount?: number;
  invoiceAmount?: number;
  igstRate?: number;
  igstAmount?: number;
  cgstRate?: number;
  cgstAmount?: number;
  sgstRate?: number;
  sgstAmount?: number;
  gstTransactionType?: GstTransactionType;
  gstAmount?: number;
};

export type ReportRowGstInput = {
  stateName?: string | null;
  customerStateCode?: string | null;
  gstin?: string | null;
  igstRate?: number | null;
  cgstRate?: number | null;
  sgstRate?: number | null;
  igstAmount?: number | null;
  cgstAmount?: number | null;
  sgstAmount?: number | null;
  taxableAmount?: number | null;
  invoiceAmount?: number | null;
  gstTransactionType?: GstTransactionType | string | null;
};

/** Build seller GST context from registration states and GSTINs (selected GST first). */
export function buildSellerGstContext(
  sellerStates?: string | string[] | null,
  sellerGstins?: string | string[] | null,
): SellerGstContext {
  const states = Array.isArray(sellerStates)
    ? sellerStates.filter(Boolean).map((s) => String(s).trim())
    : sellerStates
      ? [String(sellerStates).trim()]
      : [];
  const gstins = Array.isArray(sellerGstins)
    ? sellerGstins.filter(Boolean).map((g) => String(g).trim())
    : sellerGstins
      ? [String(sellerGstins).trim()]
      : [];

  const primaryGstin =
    gstins.find((item) => getGstStateCodeFromGstin(item)) ?? gstins[0];

  return {
    states,
    gstins,
    stateKeys: collectSellerRegistrationStateKeys(states, gstins),
    primaryGstin,
  };
}

/** Seller GST registered state vs order place-of-supply. */
export function isIntraStateSupply(input: {
  sellerState?: string | null;
  sellerGstin?: string | null;
  sellerStateKeys?: Set<string>;
  orderState?: string | null;
  orderStateCode?: string | null;
}): boolean | null {
  const customerCode = resolveCustomerIndianStateCode(
    input.orderStateCode,
    input.orderState,
  );
  const sellerGstin = input.sellerGstin?.trim();
  const sellerCode = getGstStateCodeFromGstin(sellerGstin);

  if (customerCode && sellerCode) {
    return sellerCode === customerCode;
  }

  const sellerKeys =
    input.sellerStateKeys ??
    collectSellerRegistrationStateKeys(
      input.sellerState?.trim() ? [input.sellerState.trim()] : [],
      sellerGstin ? [sellerGstin] : [],
    );

  const orderKey = resolveIndianStateKey(
    input.orderState ?? input.orderStateCode ?? '',
  );
  if (!orderKey || sellerKeys.size === 0) return null;
  return isSameIndianState(orderKey, sellerKeys);
}

function resolveGstRate(input: CalculateGstInput): number {
  const igstRate = Number(input.igstRate ?? 0);
  if (igstRate > 0) return igstRate;
  const cgstRate = Number(input.cgstRate ?? 0);
  const sgstRate = Number(input.sgstRate ?? 0);
  if (cgstRate + sgstRate > 0) return cgstRate + sgstRate;
  return Number(input.gstRate ?? 0);
}

function resolveExistingGstAmount(input: CalculateGstInput): number {
  const igst = Math.abs(Number(input.igstAmount ?? 0));
  const cgst = Math.abs(Number(input.cgstAmount ?? 0));
  const sgst = Math.abs(Number(input.sgstAmount ?? 0));
  const combined = cgst + sgst;
  if (igst > 0 && combined > 0) return Math.max(igst, combined);
  return igst + combined;
}

/**
 * Indian GST split: intra-state => CGST+SGST; inter-state => IGST.
 * Uses taxableValue × gstRate when row tax amounts are absent.
 */
export function calculateGST(input: CalculateGstInput): GstCalculationResult {
  const taxableValue = Number(input.taxableValue ?? 0);
  const gstRate = resolveGstRate(input);
  const intra = isIntraStateSupply(input);

  let gstAmount = resolveExistingGstAmount(input);
  if (gstAmount === 0 && taxableValue > 0 && gstRate > 0) {
    gstAmount = (taxableValue * gstRate) / 100;
  }

  const sign =
    taxableValue < 0 ||
    Number(input.igstAmount ?? 0) < 0 ||
    Number(input.cgstAmount ?? 0) < 0 ||
    Number(input.sgstAmount ?? 0) < 0
      ? -1
      : 1;
  const signedGst = gstAmount * sign;

  if (intra === true) {
    const half = signedGst / 2;
    const halfRate = gstRate > 0 ? gstRate / 2 : 0;
    return {
      igst: 0,
      cgst: half,
      sgst: half,
      gstAmount: signedGst,
      invoiceAmount: taxableValue + signedGst,
      transactionType: 'intra',
      igstRate: undefined,
      cgstRate: halfRate || undefined,
      sgstRate: halfRate || undefined,
    };
  }

  if (intra === false) {
    return {
      igst: signedGst,
      cgst: 0,
      sgst: 0,
      gstAmount: signedGst,
      invoiceAmount: taxableValue + signedGst,
      transactionType: 'inter',
      igstRate: gstRate > 0 ? gstRate : undefined,
      cgstRate: undefined,
      sgstRate: undefined,
    };
  }

  const igst = Number(input.igstAmount ?? 0);
  const cgst = Number(input.cgstAmount ?? 0);
  const sgst = Number(input.sgstAmount ?? 0);
  const total = igst + cgst + sgst;
  return {
    igst,
    cgst,
    sgst,
    gstAmount: total,
    invoiceAmount: taxableValue + total,
    transactionType:
      igst !== 0 && cgst === 0 && sgst === 0 ? 'inter' : 'intra',
  };
}

function roundGstRate(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Infer missing GST rate fields from stored tax amounts and taxable value. */
export function inferGstRatesFromAmounts(row: ImportRowGstInput): void {
  const taxable = Math.abs(Number(row.taxableAmount ?? 0));
  if (taxable <= 0) return;

  const inferRate = (amount?: number | null) => {
    const absAmount = Math.abs(Number(amount ?? 0));
    if (absAmount <= 0) return undefined;
    return roundGstRate((absAmount / taxable) * 100);
  };

  if (!row.igstRate) {
    const inferred = inferRate(row.igstAmount);
    if (inferred !== undefined) row.igstRate = inferred;
  }
  if (!row.cgstRate) {
    const inferred = inferRate(row.cgstAmount);
    if (inferred !== undefined) row.cgstRate = inferred;
  }
  if (!row.sgstRate) {
    const inferred = inferRate(row.sgstAmount);
    if (inferred !== undefined) row.sgstRate = inferred;
  }
}

/** Mutate import row with correct GST split (all marketplaces except raw Flipkart pivot). */
export function normalizeImportRowGst(
  row: ImportRowGstInput,
  sellerContext: SellerGstContext,
): ImportRowGstInput {
  const customerCode =
    row.customerStateCode ??
    resolveIndianStateCode(row.stateName) ??
    undefined;
  if (customerCode && !row.customerStateCode) {
    row.customerStateCode = customerCode;
  }

  inferGstRatesFromAmounts(row);

  const sellerGstin = sellerContext.primaryGstin ?? row.sellerGSTIN;
  const intra = isIntraStateSupply({
    sellerGstin,
    sellerStateKeys: sellerContext.stateKeys,
    orderState: row.stateName,
    orderStateCode: customerCode,
  });

  if (intra === null) return row;

  const gstRate =
    Number(row.igstRate ?? 0) ||
    Number(row.cgstRate ?? 0) + Number(row.sgstRate ?? 0);

  const result = calculateGST({
    taxableValue: Number(row.taxableAmount ?? 0),
    gstRate,
    sellerGstin,
    sellerStateKeys: sellerContext.stateKeys,
    orderState: row.stateName,
    orderStateCode: customerCode,
    igstAmount: row.igstAmount,
    cgstAmount: row.cgstAmount,
    sgstAmount: row.sgstAmount,
    igstRate: row.igstRate,
    cgstRate: row.cgstRate,
    sgstRate: row.sgstRate,
  });

  row.gstTransactionType = result.transactionType;
  row.gstAmount = result.gstAmount;

  if (result.transactionType === 'intra') {
    row.igstRate = undefined;
    row.igstAmount = undefined;
    row.cgstRate = result.cgstRate;
    row.sgstRate = result.sgstRate;
    row.cgstAmount = result.cgst;
    row.sgstAmount = result.sgst;
    return row;
  }

  row.igstRate = result.igstRate;
  row.igstAmount = result.igst;
  row.cgstRate = undefined;
  row.cgstAmount = undefined;
  row.sgstRate = undefined;
  row.sgstAmount = undefined;
  return row;
}

export function getRowTotalGstAmount(row: ReportRowGstInput): number {
  const igst = Math.abs(Number(row.igstAmount ?? 0));
  const cgst = Math.abs(Number(row.cgstAmount ?? 0));
  const sgst = Math.abs(Number(row.sgstAmount ?? 0));
  const combined = cgst + sgst;
  if (igst > 0 && combined > 0) return Math.max(igst, combined);
  return igst + combined;
}

/** Report-time GST split using stored row or seller registration context. */
export function splitGstForReport(
  row: ReportRowGstInput,
  sellerContext: SellerGstContext,
  sign = 1,
): { igst: number; cgst: number; sgst: number } {
  if (row.gstTransactionType === 'intra') {
    const cgst = Number(row.cgstAmount ?? 0) * sign;
    const sgst = Number(row.sgstAmount ?? 0) * sign;
    if (cgst !== 0 || sgst !== 0) {
      return { igst: 0, cgst, sgst };
    }
  }
  if (row.gstTransactionType === 'inter') {
    const igst = Number(row.igstAmount ?? 0) * sign;
    if (igst !== 0) {
      return { igst, cgst: 0, sgst: 0 };
    }
  }

  const customerCode = resolveCustomerIndianStateCode(
    row.customerStateCode,
    row.stateName,
  );
  const sellerGstin =
    sellerContext.primaryGstin ?? row.gstin ?? undefined;

  const result = calculateGST({
    taxableValue: Number(row.taxableAmount ?? 0),
    gstRate:
      Number(row.igstRate ?? 0) ||
      Number(row.cgstRate ?? 0) + Number(row.sgstRate ?? 0),
    sellerGstin: sellerGstin ?? undefined,
    sellerStateKeys: sellerContext.stateKeys,
    orderState: row.stateName,
    orderStateCode: customerCode,
    igstAmount: row.igstAmount,
    cgstAmount: row.cgstAmount,
    sgstAmount: row.sgstAmount,
    igstRate: row.igstRate,
    cgstRate: row.cgstRate,
    sgstRate: row.sgstRate,
  });

  return {
    igst: result.igst * sign,
    cgst: result.cgst * sign,
    sgst: result.sgst * sign,
  };
}

export { normalizeState };
