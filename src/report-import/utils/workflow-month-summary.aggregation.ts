import type { PipelineStage } from 'mongoose';
import { isSameIndianState } from './gst-state.util';
import { computeFlipkartInvoiceAmount } from './flipkart-invoice.util';
import { splitGstForReportRow } from './state-wise-gst-split.util';

const num = (field: string) => ({ $ifNull: [`$${field}`, 0] });

const docTypeUpper = { $toUpper: { $ifNull: ['$documentType', ''] } };
const isSalesDoc = {
  $regexMatch: { input: docTypeUpper, regex: 'SALE' },
};
const isReturnDoc = {
  $or: [
    { $regexMatch: { input: docTypeUpper, regex: 'RETURN' } },
    { $regexMatch: { input: docTypeUpper, regex: 'RTO' } },
  ],
};
const isCancelledDoc = {
  $regexMatch: { input: docTypeUpper, regex: 'CANCEL' },
};

const invoiceAmt = num('invoiceAmount');
const taxableAmt = num('taxableAmount');
const igstAmt = num('igstAmount');
const cgstAmt = num('cgstAmount');
const sgstAmt = num('sgstAmount');
const qty = num('quantity');
const isIntraTxn = { $eq: ['$gstTransactionType', 'intra'] };
const isInterTxn = { $eq: ['$gstTransactionType', 'inter'] };
const igstForSummary = {
  $cond: [isIntraTxn, 0, igstAmt],
};
const cgstForSummary = {
  $cond: [isInterTxn, 0, cgstAmt],
};
const sgstForSummary = {
  $cond: [isInterTxn, 0, sgstAmt],
};

export const PAYMENT_AMOUNT_FIELDS = [
  { key: 'finalSettlementAmount', label: 'Final settlement' },
  { key: 'totalSaleAmountInclShippingGst', label: 'Total sale (incl. shipping & GST)' },
  {
    key: 'totalSaleReturnAmountInclShippingGst',
    label: 'Total sale return (incl. shipping & GST)',
  },
  { key: 'meeshoCommissionInclGst', label: 'Marketplace commission (incl. GST)' },
  { key: 'meeshoGoldPlatformFeeInclGst', label: 'Gold platform fee (incl. GST)' },
  { key: 'meeshoMallPlatformFeeInclGst', label: 'Mall platform fee (incl. GST)' },
  { key: 'fixedFeeInclGst', label: 'Fixed fee (incl. GST)' },
  { key: 'warehousingFeeInclGst', label: 'Warehousing fee (incl. GST)' },
  { key: 'shippingChargeInclGst', label: 'Shipping charge (incl. GST)' },
  { key: 'returnShippingChargeInclGst', label: 'Return shipping (incl. GST)' },
  { key: 'returnPremiumInclGst', label: 'Return premium (incl. GST)' },
  { key: 'paymentTcs', label: 'TCS on payment' },
  { key: 'tds', label: 'TDS' },
  { key: 'compensation', label: 'Compensation' },
  { key: 'claims', label: 'Claims' },
  { key: 'recovery', label: 'Recovery' },
  { key: 'otherSupportServiceChargesExclGst', label: 'Other support charges (excl. GST)' },
  { key: 'waiversExclGst', label: 'Waivers (excl. GST)' },
] as const;

function sumField(field: string) {
  return { $sum: num(field) };
}

export function buildWorkflowMonthSummaryPipeline(
  rowFilter: Record<string, unknown>,
): PipelineStage[] {
  const paymentGroupFields = Object.fromEntries(
    PAYMENT_AMOUNT_FIELDS.map(({ key }) => [key, sumField(key)]),
  );

  return [
    { $match: rowFilter },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalRows: { $sum: 1 },
              salesRows: {
                $sum: { $cond: [{ $eq: ['$reportType', 'sales'] }, 1, 0] },
              },
              cashbackRows: {
                $sum: { $cond: [{ $eq: ['$reportType', 'cashback'] }, 1, 0] },
              },
              salesDocRows: { $sum: { $cond: [isSalesDoc, 1, 0] } },
              returnsDocRows: { $sum: { $cond: [isReturnDoc, 1, 0] } },
              cancelledDocRows: { $sum: { $cond: [isCancelledDoc, 1, 0] } },
              totalInvoiceAmount: { $sum: invoiceAmt },
              salesInvoiceAmount: {
                $sum: { $cond: [isSalesDoc, invoiceAmt, 0] },
              },
              returnsInvoiceAmount: {
                $sum: { $cond: [isReturnDoc, invoiceAmt, 0] },
              },
              salesPcs: {
                $sum: { $cond: [isSalesDoc, qty, 0] },
              },
              returnsPcs: {
                $sum: { $cond: [isReturnDoc, qty, 0] },
              },
              salesTaxableAmount: {
                $sum: { $cond: [isSalesDoc, taxableAmt, 0] },
              },
              returnsTaxableAmount: {
                $sum: { $cond: [isReturnDoc, taxableAmt, 0] },
              },
              salesIgst: {
                $sum: { $cond: [isSalesDoc, igstForSummary, 0] },
              },
              returnsIgst: {
                $sum: { $cond: [isReturnDoc, igstForSummary, 0] },
              },
              salesCgst: {
                $sum: { $cond: [isSalesDoc, cgstForSummary, 0] },
              },
              returnsCgst: {
                $sum: { $cond: [isReturnDoc, cgstForSummary, 0] },
              },
              salesSgst: {
                $sum: { $cond: [isSalesDoc, sgstForSummary, 0] },
              },
              returnsSgst: {
                $sum: { $cond: [isReturnDoc, sgstForSummary, 0] },
              },
              cancelledInvoiceAmount: {
                $sum: { $cond: [isCancelledDoc, invoiceAmt, 0] },
              },
              totalTaxableAmount: { $sum: taxableAmt },
              totalIgst: { $sum: igstForSummary },
              totalCgst: { $sum: cgstForSummary },
              totalSgst: { $sum: sgstForSummary },
              intraStateSalesRows: {
                $sum: { $cond: [{ $and: [isSalesDoc, isIntraTxn] }, 1, 0] },
              },
              interStateSalesRows: {
                $sum: { $cond: [{ $and: [isSalesDoc, isInterTxn] }, 1, 0] },
              },
              intraStateTaxableAmount: {
                $sum: { $cond: [isIntraTxn, taxableAmt, 0] },
              },
              interStateTaxableAmount: {
                $sum: { $cond: [isInterTxn, taxableAmt, 0] },
              },
              minInvoiceDate: { $min: '$invoiceDate' },
              maxInvoiceDate: { $max: '$invoiceDate' },
              ordersWithSettlement: {
                $sum: {
                  $cond: [{ $gt: [num('finalSettlementAmount'), 0] }, 1, 0],
                },
              },
              ...paymentGroupFields,
            },
          },
        ],
        byDocumentType: [
          {
            $group: {
              _id: { $ifNull: ['$documentType', 'Unknown'] },
              count: { $sum: 1 },
              invoiceAmount: { $sum: invoiceAmt },
              taxableAmount: { $sum: taxableAmt },
            },
          },
          { $sort: { count: -1, _id: 1 } },
          { $limit: 30 },
        ],
        byReportType: [
          {
            $group: {
              _id: '$reportType',
              count: { $sum: 1 },
              invoiceAmount: { $sum: invoiceAmt },
              taxableAmount: { $sum: taxableAmt },
            },
          },
          { $sort: { count: -1 } },
        ],
      },
    },
  ];
}

export type WorkflowMonthTotalsRow = {
  totalRows?: number;
  salesRows?: number;
  cashbackRows?: number;
  salesDocRows?: number;
  returnsDocRows?: number;
  cancelledDocRows?: number;
  totalInvoiceAmount?: number;
  salesInvoiceAmount?: number;
  returnsInvoiceAmount?: number;
  salesPcs?: number;
  returnsPcs?: number;
  salesTaxableAmount?: number;
  returnsTaxableAmount?: number;
  salesIgst?: number;
  returnsIgst?: number;
  salesCgst?: number;
  returnsCgst?: number;
  salesSgst?: number;
  returnsSgst?: number;
  cancelledInvoiceAmount?: number;
  totalTaxableAmount?: number;
  totalIgst?: number;
  totalCgst?: number;
  totalSgst?: number;
  intraStateSalesRows?: number;
  interStateSalesRows?: number;
  intraStateTaxableAmount?: number;
  interStateTaxableAmount?: number;
  minInvoiceDate?: string;
  maxInvoiceDate?: string;
  ordersWithSettlement?: number;
} & Partial<Record<(typeof PAYMENT_AMOUNT_FIELDS)[number]['key'], number>>;

export type MeeshoMonthTotalsRow = WorkflowMonthTotalsRow & {
  meeshoGrossSalesRows?: number;
  meeshoTcsReturnRows?: number;
  meeshoReturnCancellationRows?: number;
  meeshoReturnRtoRows?: number;
  meeshoReturnCustomerRows?: number;
  meeshoReturnNaRows?: number;
  meeshoGrossSalesPcs?: number;
  meeshoTcsReturnPcs?: number;
  meeshoReturnCancellationPcs?: number;
  meeshoReturnRtoPcs?: number;
  meeshoReturnCustomerPcs?: number;
  meeshoReturnNaPcs?: number;
  meeshoGrossSalesTaxable?: number;
  meeshoTcsReturnTaxable?: number;
  meeshoReturnCancellationTaxable?: number;
  meeshoReturnRtoTaxable?: number;
  meeshoReturnCustomerTaxable?: number;
  meeshoReturnNaTaxable?: number;
  meeshoGrossSalesIgst?: number;
  meeshoTcsReturnIgst?: number;
  meeshoReturnCancellationIgst?: number;
  meeshoReturnRtoIgst?: number;
  meeshoReturnCustomerIgst?: number;
  meeshoReturnNaIgst?: number;
  meeshoGrossSalesCgst?: number;
  meeshoTcsReturnCgst?: number;
  meeshoReturnCancellationCgst?: number;
  meeshoReturnRtoCgst?: number;
  meeshoReturnCustomerCgst?: number;
  meeshoReturnNaCgst?: number;
  meeshoGrossSalesSgst?: number;
  meeshoTcsReturnSgst?: number;
  meeshoReturnCancellationSgst?: number;
  meeshoReturnRtoSgst?: number;
  meeshoReturnCustomerSgst?: number;
  meeshoReturnNaSgst?: number;
  meeshoGrossSalesInvoice?: number;
  meeshoTcsReturnInvoice?: number;
  meeshoReturnCancellationInvoice?: number;
  meeshoReturnRtoInvoice?: number;
  meeshoReturnCustomerInvoice?: number;
  meeshoReturnNaInvoice?: number;
};

export type FlipkartBucket =
  | 'sale'
  | 'return'
  | 'cancellation'
  | 'return_cancellation'
  | 'other';

const FLIPKART_BUCKET_LABELS: Record<FlipkartBucket, string> = {
  sale: 'Sale',
  return: 'Return',
  cancellation: 'Cancellation',
  return_cancellation: 'Return Cancellation',
  other: 'Other',
};

function flipkartTypeRank(upper: string): number {
  if (/RETURN\s*CANCEL/.test(upper)) return 40;
  if (/CANCEL/.test(upper)) return 30;
  if (/RETURN/.test(upper) || /\bRTO\b/.test(upper)) return 20;
  if (/SALE/.test(upper) && !/RETURN/.test(upper)) return 10;
  return 0;
}

/** Pick the most specific label from document type and voucher type. */
export function resolveFlipkartBucket(
  documentType?: string | null,
  voucherType?: string | null,
): { bucket: FlipkartBucket; label: string } {
  let bestLabel = '';
  let bestRank = 0;
  const doc = String(documentType ?? '').trim();
  const voucher = String(voucherType ?? '').trim();
  const docRank = doc ? flipkartTypeRank(doc.toUpperCase()) : 0;
  const voucherRank = voucher ? flipkartTypeRank(voucher.toUpperCase()) : 0;

  if (voucherRank > docRank) {
    bestLabel = voucher;
    bestRank = voucherRank;
  } else if (docRank > voucherRank) {
    bestLabel = doc;
    bestRank = docRank;
  } else if (doc) {
    bestLabel = doc;
    bestRank = docRank;
  } else if (voucher) {
    bestLabel = voucher;
    bestRank = voucherRank;
  }

  if (bestRank === 40) {
    return { bucket: 'return_cancellation', label: bestLabel };
  }
  if (bestRank === 30) {
    return { bucket: 'cancellation', label: bestLabel };
  }
  if (bestRank === 20) {
    return { bucket: 'return', label: bestLabel };
  }
  if (bestRank === 10) {
    return { bucket: 'sale', label: bestLabel };
  }

  return {
    bucket: 'other',
    label: bestLabel || String(documentType ?? voucherType ?? 'Unknown').trim() || 'Unknown',
  };
}

/** @deprecated Use resolveFlipkartBucket for classification. */
export function resolveFlipkartSummaryType(
  documentType?: string | null,
  voucherType?: string | null,
): string {
  return resolveFlipkartBucket(documentType, voucherType).label;
}

export function flipkartBucketLabel(bucket: string): string {
  return FLIPKART_BUCKET_LABELS[bucket as FlipkartBucket] ?? bucket;
}

/** Canonical display order for Flipkart voucher types in the summary table. */
export function compareFlipkartVoucherTypes(a: string, b: string): number {
  const rank = (value: string) => {
    const upper = value.trim().toUpperCase();
    if (/RETURN\s*CANCEL/.test(upper)) return 1;
    if (/^SALE$/.test(upper) || (upper.includes('SALE') && !upper.includes('RETURN'))) {
      return 0;
    }
    if (/^RETURN$/.test(upper) || /\bRTO\b/.test(upper)) return 2;
    if (/CANCEL/.test(upper)) return 3;
    return 99;
  };

  const rankDiff = rank(a) - rank(b);
  if (rankDiff !== 0) return rankDiff;
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}

/** Flipkart summary classification — all return-family rows net against Sale. */
export function classifyFlipkartDocumentType(
  documentType?: string | null,
  voucherType?: string | null,
) {
  const { bucket } = resolveFlipkartBucket(documentType, voucherType);
  const isReturnCancellation = bucket === 'return_cancellation';
  const isGrossSale = bucket === 'sale';
  const isReturn = bucket === 'return';
  const isCancellation = bucket === 'cancellation';
  const isReturnActivity =
    isReturn || isCancellation || isReturnCancellation;
  return {
    isGrossSale,
    isReturnCancellation,
    isReturn,
    isCancellation,
    isReturnDeduction: isReturn || isCancellation,
    isReturnAddition: isReturnCancellation,
    isReturnActivity,
  };
}

export type FlipkartSummaryRow = {
  totalRows: number;
  pcs: number;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  invoiceAmount: number;
};

export function addFlipkartSummaryRows(
  ...rows: FlipkartSummaryRow[]
): FlipkartSummaryRow {
  return rows.reduce(
    (acc, row) => ({
      totalRows: acc.totalRows + row.totalRows,
      pcs: acc.pcs + row.pcs,
      taxableValue: acc.taxableValue + row.taxableValue,
      igst: acc.igst + row.igst,
      cgst: acc.cgst + row.cgst,
      sgst: acc.sgst + row.sgst,
      invoiceAmount: acc.invoiceAmount + row.invoiceAmount,
    }),
    {
      totalRows: 0,
      pcs: 0,
      taxableValue: 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      invoiceAmount: 0,
    },
  );
}

/** Gross Sale = Sale + Credit Note */
export function computeFlipkartGrossSale(
  saleRow: FlipkartSummaryRow,
  creditNoteRow: FlipkartSummaryRow,
): FlipkartSummaryRow {
  return addFlipkartSummaryRows(saleRow, creditNoteRow);
}

/**
 * Returns Total = Return + Cancellation + Debit Note − Return Cancellation
 * (signed row amounts; return/cancellation typically negative, debit/credit note positive).
 */
export function computeFlipkartReturnsNetTotal(
  returnRow: FlipkartSummaryRow,
  cancellationRow: FlipkartSummaryRow,
  returnCancellationRow: FlipkartSummaryRow,
  debitNoteRow: FlipkartSummaryRow = {
    totalRows: 0,
    pcs: 0,
    taxableValue: 0,
    igst: 0,
    cgst: 0,
    sgst: 0,
    invoiceAmount: 0,
  },
): FlipkartSummaryRow {
  return addFlipkartSummaryRows(
    returnRow,
    cancellationRow,
    returnCancellationRow,
    debitNoteRow,
  );
}

/** Net Sale = Gross Sale + Returns Total (returns total is signed, usually negative). */
export function computeFlipkartNetSale(
  grossSaleRow: FlipkartSummaryRow,
  returnsTotalRow: FlipkartSummaryRow,
): FlipkartSummaryRow {
  return addFlipkartSummaryRows(grossSaleRow, returnsTotalRow);
}

export type FlipkartVoucherTypeSummaryRow = {
  voucherType: string;
  category: 'gross' | 'returnSubMinus' | 'returnSubPlus' | 'other';
  count: number;
  pcs: number;
  invoiceAmount: number;
  taxableAmount: number;
  igst: number;
  cgst: number;
  sgst: number;
};

export function mapFlipkartVoucherTypeSummaryRows(
  rows: Array<{
    bucket: string;
    label: string;
    count: number;
    pcs: number;
    invoiceAmount: number;
    taxableAmount: number;
    igst: number;
    cgst: number;
    sgst: number;
  }>,
): FlipkartVoucherTypeSummaryRow[] {
  return rows
    .map((row) => {
      let category: FlipkartVoucherTypeSummaryRow['category'] = 'other';
      if (row.bucket === 'return_cancellation') {
        category = 'returnSubPlus';
      } else if (row.bucket === 'return' || row.bucket === 'cancellation') {
        category = 'returnSubMinus';
      } else if (row.bucket === 'sale') {
        category = 'gross';
      }

      return {
        voucherType: row.label,
        category,
        count: row.count,
        pcs: row.pcs,
        invoiceAmount: row.invoiceAmount,
        taxableAmount: row.taxableAmount,
        igst: row.igst,
        cgst: row.cgst,
        sgst: row.sgst,
      };
    })
    .sort((a, b) => compareFlipkartVoucherTypes(a.voucherType, b.voucherType));
}

export function isFlipkartCreditNoteDocumentType(documentType?: string | null): boolean {
  const upper = String(documentType ?? '').trim().toUpperCase();
  return /CREDIT\s*NOTE/.test(upper) || (upper.includes('CREDIT') && !upper.includes('DEBIT'));
}

export function isFlipkartDebitNoteDocumentType(documentType?: string | null): boolean {
  const upper = String(documentType ?? '').trim().toUpperCase();
  return /DEBIT\s*NOTE/.test(upper) || (upper.includes('DEBIT') && !upper.includes('CREDIT'));
}

export type FlipkartNoteKind = 'credit' | 'debit';

export type FlipkartNoteSummaryRow = {
  totalRows: number;
  pcs: number;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  invoiceAmount: number;
};

export type FlipkartOrderNoteInput = {
  orderID?: string | null;
  documentType?: string | null;
  quantity?: number | null;
  invoiceAmount?: number | null;
  taxableAmount?: number | null;
  igstAmount?: number | null;
  cgstAmount?: number | null;
  sgstAmount?: number | null;
};

/** Sum credit/debit note amounts per order ID, then roll up totals. */
export function aggregateFlipkartNotesByOrderId(
  rows: FlipkartOrderNoteInput[],
  sellerStateKeys?: Set<string>,
): { creditNote: FlipkartNoteSummaryRow; debitNote: FlipkartNoteSummaryRow } {
  const empty = (): FlipkartNoteSummaryRow => ({
    totalRows: 0,
    pcs: 0,
    taxableValue: 0,
    igst: 0,
    cgst: 0,
    sgst: 0,
    invoiceAmount: 0,
  });

  const perOrder = new Map<string, { credit: FlipkartNoteSummaryRow; debit: FlipkartNoteSummaryRow }>();

  for (const row of rows) {
    const documentType = String(row.documentType ?? '').trim();
    const isCredit = isFlipkartCreditNoteDocumentType(documentType);
    const isDebit = isFlipkartDebitNoteDocumentType(documentType);
    if (!isCredit && !isDebit) continue;

    const orderId = String(row.orderID ?? '').trim() || 'UNKNOWN';
    const kind: FlipkartNoteKind = isCredit ? 'credit' : 'debit';
    const bucket =
      perOrder.get(orderId) ??
      ({ credit: empty(), debit: empty() } as {
        credit: FlipkartNoteSummaryRow;
        debit: FlipkartNoteSummaryRow;
      });
    const target = bucket[kind];
    target.pcs += Number(row.quantity ?? 0);
    target.taxableValue += Number(row.taxableAmount ?? 0);
    if (sellerStateKeys && sellerStateKeys.size > 0) {
      const tax = splitGstForReportRow(row, sellerStateKeys);
      target.igst += tax.igst;
      target.cgst += tax.cgst;
      target.sgst += tax.sgst;
    } else {
      target.igst += Number(row.igstAmount ?? 0);
      target.cgst += Number(row.cgstAmount ?? 0);
      target.sgst += Number(row.sgstAmount ?? 0);
    }
    target.invoiceAmount += Math.abs(computeFlipkartInvoiceAmount(row));
    perOrder.set(orderId, bucket);
  }

  const creditNote = empty();
  const debitNote = empty();

  for (const bucket of perOrder.values()) {
    if (bucket.credit.invoiceAmount !== 0 || bucket.credit.pcs !== 0) {
      creditNote.totalRows += 1;
      creditNote.pcs += bucket.credit.pcs;
      creditNote.taxableValue += bucket.credit.taxableValue;
      creditNote.igst += bucket.credit.igst;
      creditNote.cgst += bucket.credit.cgst;
      creditNote.sgst += bucket.credit.sgst;
      creditNote.invoiceAmount += bucket.credit.invoiceAmount;
    }
    if (bucket.debit.invoiceAmount !== 0 || bucket.debit.pcs !== 0) {
      debitNote.totalRows += 1;
      debitNote.pcs += bucket.debit.pcs;
      debitNote.taxableValue += bucket.debit.taxableValue;
      debitNote.igst += bucket.debit.igst;
      debitNote.cgst += bucket.debit.cgst;
      debitNote.sgst += bucket.debit.sgst;
      debitNote.invoiceAmount += bucket.debit.invoiceAmount;
    }
  }

  return { creditNote, debitNote };
}

export function mapFlipkartNoteFacetRows(
  rows: Array<{
    _id: FlipkartNoteKind;
    orderCount?: number;
    pcs?: number;
    invoiceAmount?: number;
    taxableAmount?: number;
    igst?: number;
    cgst?: number;
    sgst?: number;
  }>,
): { creditNote: FlipkartNoteSummaryRow; debitNote: FlipkartNoteSummaryRow } {
  const empty = (): FlipkartNoteSummaryRow => ({
    totalRows: 0,
    pcs: 0,
    taxableValue: 0,
    igst: 0,
    cgst: 0,
    sgst: 0,
    invoiceAmount: 0,
  });

  const toRow = (item?: {
    orderCount?: number;
    pcs?: number;
    invoiceAmount?: number;
    taxableAmount?: number;
    igst?: number;
    cgst?: number;
    sgst?: number;
  }): FlipkartNoteSummaryRow => ({
    totalRows: Number(item?.orderCount ?? 0),
    pcs: Number(item?.pcs ?? 0),
    taxableValue: Number(item?.taxableAmount ?? 0),
    igst: Number(item?.igst ?? 0),
    cgst: Number(item?.cgst ?? 0),
    sgst: Number(item?.sgst ?? 0),
    invoiceAmount: Math.abs(Number(item?.invoiceAmount ?? 0)),
  });

  const credit = rows.find((row) => row._id === 'credit');
  const debit = rows.find((row) => row._id === 'debit');

  return {
    creditNote: credit ? toRow(credit) : empty(),
    debitNote: debit ? toRow(debit) : empty(),
  };
}

export type FlipkartMonthTotalsRow = WorkflowMonthTotalsRow & {
  flipkartGrossSalesRows?: number;
  flipkartReturnDeductionRows?: number;
  flipkartReturnRows?: number;
  flipkartCancellationRows?: number;
  flipkartReturnCancellationRows?: number;
  flipkartGrossSalesPcs?: number;
  flipkartReturnDeductionPcs?: number;
  flipkartReturnPcs?: number;
  flipkartCancellationPcs?: number;
  flipkartReturnCancellationPcs?: number;
  flipkartGrossSalesTaxable?: number;
  flipkartReturnDeductionTaxable?: number;
  flipkartReturnTaxable?: number;
  flipkartCancellationTaxable?: number;
  flipkartReturnCancellationTaxable?: number;
  flipkartGrossSalesIgst?: number;
  flipkartReturnDeductionIgst?: number;
  flipkartReturnIgst?: number;
  flipkartCancellationIgst?: number;
  flipkartReturnCancellationIgst?: number;
  flipkartGrossSalesCgst?: number;
  flipkartReturnDeductionCgst?: number;
  flipkartReturnCgst?: number;
  flipkartCancellationCgst?: number;
  flipkartReturnCancellationCgst?: number;
  flipkartGrossSalesSgst?: number;
  flipkartReturnDeductionSgst?: number;
  flipkartReturnSgst?: number;
  flipkartCancellationSgst?: number;
  flipkartReturnCancellationSgst?: number;
  flipkartGrossSalesInvoice?: number;
  flipkartReturnDeductionInvoice?: number;
  flipkartReturnInvoice?: number;
  flipkartCancellationInvoice?: number;
  flipkartReturnCancellationInvoice?: number;
};

export function buildFlipkartWorkflowMonthSummaryPipeline(
  rowFilter: Record<string, unknown>,
): PipelineStage[] {
  const paymentGroupFields = Object.fromEntries(
    PAYMENT_AMOUNT_FIELDS.map(({ key }) => [key, sumField(key)]),
  );

  const sumWhen = (condition: Record<string, unknown>, fieldExpr: Record<string, unknown> | number) => ({
    $sum: { $cond: [condition, fieldExpr, 0] },
  });

  // Flipkart Excel pivot sums raw file tax columns (not intra/inter split).
  const fkIgst = igstAmt;
  const fkCgst = cgstAmt;
  const fkSgst = sgstAmt;

  const flipkartSummaryTypeUpper = '$flipkartSummaryTypeUpper';
  const flipkartBucketIs = (bucket: string) => ({ $eq: ['$flipkartBucket', bucket] });
  const flipkartIsGrossSale = flipkartBucketIs('sale');
  const flipkartIsReturn = flipkartBucketIs('return');
  const flipkartIsCancellation = flipkartBucketIs('cancellation');
  const flipkartReturnCancellationMatch = flipkartBucketIs('return_cancellation');
  const flipkartIsReturnDeduction = {
    $or: [flipkartIsReturn, flipkartIsCancellation],
  };

  const flipkartRankExpr = (upperExpr: string) => ({
    $switch: {
      branches: [
        {
          case: {
            $regexMatch: { input: upperExpr, regex: 'RETURN\\s*CANCEL' },
          },
          then: 40,
        },
        {
          case: {
            $and: [
              { $regexMatch: { input: upperExpr, regex: 'CANCEL' } },
              {
                $not: {
                  $regexMatch: { input: upperExpr, regex: 'RETURN\\s*CANCEL' },
                },
              },
            ],
          },
          then: 30,
        },
        {
          case: {
            $or: [
              { $regexMatch: { input: upperExpr, regex: 'RETURN' } },
              { $regexMatch: { input: upperExpr, regex: 'RTO' } },
            ],
          },
          then: 20,
        },
        {
          case: {
            $and: [
              { $regexMatch: { input: upperExpr, regex: 'SALE' } },
              { $not: { $regexMatch: { input: upperExpr, regex: 'RETURN' } } },
            ],
          },
          then: 10,
        },
      ],
      default: 0,
    },
  });

  const flipkartDocumentTypeUpper = {
    $toUpper: { $ifNull: ['$documentType', ''] },
  };
  const flipkartIsCreditNote = {
    $or: [
      {
        $regexMatch: {
          input: flipkartDocumentTypeUpper,
          regex: 'CREDIT\\s*NOTE',
        },
      },
      {
        $and: [
          {
            $regexMatch: {
              input: flipkartDocumentTypeUpper,
              regex: 'CREDIT',
            },
          },
          {
            $not: {
              $regexMatch: {
                input: flipkartDocumentTypeUpper,
                regex: 'DEBIT',
              },
            },
          },
        ],
      },
    ],
  };
  const flipkartIsDebitNote = {
    $or: [
      {
        $regexMatch: {
          input: flipkartDocumentTypeUpper,
          regex: 'DEBIT\\s*NOTE',
        },
      },
      {
        $and: [
          {
            $regexMatch: {
              input: flipkartDocumentTypeUpper,
              regex: 'DEBIT',
            },
          },
          {
            $not: {
              $regexMatch: {
                input: flipkartDocumentTypeUpper,
                regex: 'CREDIT',
              },
            },
          },
        ],
      },
    ],
  };

  return [
    { $match: rowFilter },
    {
      $addFields: {
        flipkartBucket: {
          $let: {
            vars: {
              docUpper: {
                $toUpper: {
                  $trim: { input: { $ifNull: ['$documentType', ''] } },
                },
              },
              voucherUpper: {
                $toUpper: {
                  $trim: { input: { $ifNull: ['$voucherType', ''] } },
                },
              },
            },
            in: {
              $let: {
                vars: {
                  docRank: flipkartRankExpr('$$docUpper'),
                  voucherRank: flipkartRankExpr('$$voucherUpper'),
                },
                in: {
                  $let: {
                    vars: {
                      chosenRank: {
                        $cond: [
                          { $gt: ['$$voucherRank', '$$docRank'] },
                          '$$voucherRank',
                          '$$docRank',
                        ],
                      },
                    },
                    in: {
                      $switch: {
                        branches: [
                          {
                            case: { $eq: ['$$chosenRank', 40] },
                            then: 'return_cancellation',
                          },
                          {
                            case: { $eq: ['$$chosenRank', 30] },
                            then: 'cancellation',
                          },
                          { case: { $eq: ['$$chosenRank', 20] }, then: 'return' },
                          { case: { $eq: ['$$chosenRank', 10] }, then: 'sale' },
                        ],
                        default: 'other',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        flipkartSummaryTypeUpper: {
          $let: {
            vars: {
              docTrimmed: {
                $trim: { input: { $ifNull: ['$documentType', ''] } },
              },
              voucherTrimmed: {
                $trim: { input: { $ifNull: ['$voucherType', ''] } },
              },
              docUpper: {
                $toUpper: {
                  $trim: { input: { $ifNull: ['$documentType', ''] } },
                },
              },
              voucherUpper: {
                $toUpper: {
                  $trim: { input: { $ifNull: ['$voucherType', ''] } },
                },
              },
            },
            in: {
              $let: {
                vars: {
                  docRank: flipkartRankExpr('$$docUpper'),
                  voucherRank: flipkartRankExpr('$$voucherUpper'),
                },
                in: {
                  $cond: [
                    { $gte: ['$$voucherRank', '$$docRank'] },
                    { $toUpper: '$$voucherTrimmed' },
                    { $toUpper: '$$docTrimmed' },
                  ],
                },
              },
            },
          },
        },
        flipkartSummaryTypeLabel: {
          $let: {
            vars: {
              docTrimmed: {
                $trim: { input: { $ifNull: ['$documentType', ''] } },
              },
              voucherTrimmed: {
                $trim: { input: { $ifNull: ['$voucherType', ''] } },
              },
              docUpper: {
                $toUpper: {
                  $trim: { input: { $ifNull: ['$documentType', ''] } },
                },
              },
              voucherUpper: {
                $toUpper: {
                  $trim: { input: { $ifNull: ['$voucherType', ''] } },
                },
              },
            },
            in: {
              $let: {
                vars: {
                  docRank: flipkartRankExpr('$$docUpper'),
                  voucherRank: flipkartRankExpr('$$voucherUpper'),
                },
                in: {
                  $cond: [
                    { $gte: ['$$voucherRank', '$$docRank'] },
                    '$$voucherTrimmed',
                    '$$docTrimmed',
                  ],
                },
              },
            },
          },
        },
      },
    },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalRows: { $sum: 1 },
              salesRows: {
                $sum: { $cond: [{ $eq: ['$reportType', 'sales'] }, 1, 0] },
              },
              cashbackRows: {
                $sum: { $cond: [{ $eq: ['$reportType', 'cashback'] }, 1, 0] },
              },
              flipkartGrossSalesRows: sumWhen(flipkartIsGrossSale, 1),
              flipkartReturnDeductionRows: sumWhen(flipkartIsReturnDeduction, 1),
              flipkartReturnRows: sumWhen(flipkartIsReturn, 1),
              flipkartCancellationRows: sumWhen(flipkartIsCancellation, 1),
              flipkartReturnCancellationRows: sumWhen(flipkartReturnCancellationMatch, 1),
              flipkartGrossSalesPcs: sumWhen(flipkartIsGrossSale, qty),
              flipkartReturnDeductionPcs: sumWhen(flipkartIsReturnDeduction, qty),
              flipkartReturnPcs: sumWhen(flipkartIsReturn, qty),
              flipkartCancellationPcs: sumWhen(flipkartIsCancellation, qty),
              flipkartReturnCancellationPcs: sumWhen(flipkartReturnCancellationMatch, qty),
              flipkartGrossSalesTaxable: sumWhen(flipkartIsGrossSale, taxableAmt),
              flipkartReturnDeductionTaxable: sumWhen(flipkartIsReturnDeduction, taxableAmt),
              flipkartReturnTaxable: sumWhen(flipkartIsReturn, taxableAmt),
              flipkartCancellationTaxable: sumWhen(flipkartIsCancellation, taxableAmt),
              flipkartReturnCancellationTaxable: sumWhen(
                flipkartReturnCancellationMatch,
                taxableAmt,
              ),
              flipkartGrossSalesIgst: sumWhen(flipkartIsGrossSale, fkIgst),
              flipkartReturnDeductionIgst: sumWhen(flipkartIsReturnDeduction, fkIgst),
              flipkartReturnIgst: sumWhen(flipkartIsReturn, fkIgst),
              flipkartCancellationIgst: sumWhen(flipkartIsCancellation, fkIgst),
              flipkartReturnCancellationIgst: sumWhen(
                flipkartReturnCancellationMatch,
                fkIgst,
              ),
              flipkartGrossSalesCgst: sumWhen(flipkartIsGrossSale, fkCgst),
              flipkartReturnDeductionCgst: sumWhen(flipkartIsReturnDeduction, fkCgst),
              flipkartReturnCgst: sumWhen(flipkartIsReturn, fkCgst),
              flipkartCancellationCgst: sumWhen(flipkartIsCancellation, fkCgst),
              flipkartReturnCancellationCgst: sumWhen(
                flipkartReturnCancellationMatch,
                fkCgst,
              ),
              flipkartGrossSalesSgst: sumWhen(flipkartIsGrossSale, fkSgst),
              flipkartReturnDeductionSgst: sumWhen(flipkartIsReturnDeduction, fkSgst),
              flipkartReturnSgst: sumWhen(flipkartIsReturn, fkSgst),
              flipkartCancellationSgst: sumWhen(flipkartIsCancellation, fkSgst),
              flipkartReturnCancellationSgst: sumWhen(
                flipkartReturnCancellationMatch,
                fkSgst,
              ),
              flipkartGrossSalesInvoice: sumWhen(flipkartIsGrossSale, invoiceAmt),
              flipkartReturnDeductionInvoice: sumWhen(flipkartIsReturnDeduction, invoiceAmt),
              flipkartReturnInvoice: sumWhen(flipkartIsReturn, invoiceAmt),
              flipkartCancellationInvoice: sumWhen(flipkartIsCancellation, invoiceAmt),
              flipkartReturnCancellationInvoice: sumWhen(
                flipkartReturnCancellationMatch,
                invoiceAmt,
              ),
              totalInvoiceAmount: { $sum: invoiceAmt },
              totalTaxableAmount: { $sum: taxableAmt },
              totalIgst: { $sum: fkIgst },
              totalCgst: { $sum: fkCgst },
              totalSgst: { $sum: fkSgst },
              intraStateSalesRows: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        flipkartIsGrossSale,
                        { $eq: ['$gstTransactionType', 'intra'] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              interStateSalesRows: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        flipkartIsGrossSale,
                        { $eq: ['$gstTransactionType', 'inter'] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              intraStateTaxableAmount: {
                $sum: {
                  $cond: [{ $eq: ['$gstTransactionType', 'intra'] }, taxableAmt, 0],
                },
              },
              interStateTaxableAmount: {
                $sum: {
                  $cond: [{ $eq: ['$gstTransactionType', 'inter'] }, taxableAmt, 0],
                },
              },
              minInvoiceDate: { $min: '$invoiceDate' },
              maxInvoiceDate: { $max: '$invoiceDate' },
              ordersWithSettlement: {
                $sum: {
                  $cond: [{ $gt: [num('finalSettlementAmount'), 0] }, 1, 0],
                },
              },
              ...paymentGroupFields,
            },
          },
        ],
        byDocumentType: [
          {
            $group: {
              _id: { $ifNull: ['$documentType', 'Unknown'] },
              count: { $sum: 1 },
              invoiceAmount: { $sum: invoiceAmt },
              taxableAmount: { $sum: taxableAmt },
            },
          },
          { $sort: { count: -1, _id: 1 } },
          { $limit: 30 },
        ],
        byVoucherType: [
          {
            $group: {
              _id: '$flipkartBucket',
              count: { $sum: 1 },
              pcs: { $sum: qty },
              invoiceAmount: { $sum: invoiceAmt },
              taxableAmount: { $sum: taxableAmt },
              igst: { $sum: fkIgst },
              cgst: { $sum: fkCgst },
              sgst: { $sum: fkSgst },
            },
          },
        ],
        noteTotals: [
          {
            $match: {
              $expr: {
                $or: [flipkartIsCreditNote, flipkartIsDebitNote],
              },
            },
          },
          {
            $addFields: {
              flipkartNoteKind: {
                $cond: [flipkartIsCreditNote, 'credit', 'debit'],
              },
              flipkartOrderId: {
                $trim: { input: { $ifNull: ['$orderID', ''] } },
              },
            },
          },
          {
            $group: {
              _id: {
                orderId: '$flipkartOrderId',
                noteKind: '$flipkartNoteKind',
              },
              rowCount: { $sum: 1 },
              pcs: { $sum: qty },
              invoiceAmount: {
                $sum: { $abs: invoiceAmt },
              },
              taxableAmount: { $sum: taxableAmt },
              igst: { $sum: fkIgst },
              cgst: { $sum: fkCgst },
              sgst: { $sum: fkSgst },
            },
          },
          {
            $group: {
              _id: '$_id.noteKind',
              orderCount: { $sum: 1 },
              rowCount: { $sum: '$rowCount' },
              pcs: { $sum: '$pcs' },
              invoiceAmount: { $sum: '$invoiceAmount' },
              taxableAmount: { $sum: '$taxableAmount' },
              igst: { $sum: '$igst' },
              cgst: { $sum: '$cgst' },
              sgst: { $sum: '$sgst' },
            },
          },
        ],
        byReportType: [
          {
            $group: {
              _id: '$reportType',
              count: { $sum: 1 },
              invoiceAmount: { $sum: invoiceAmt },
              taxableAmount: { $sum: taxableAmt },
            },
          },
          { $sort: { count: -1 } },
        ],
      },
    },
  ];
}

export function buildMeeshoWorkflowMonthSummaryPipeline(
  rowFilter: Record<string, unknown>,
): PipelineStage[] {
  const meeshoReturnQtyForSummary = {
    $ifNull: ['$returnQty', { $ifNull: ['$quantity', 0] }],
  };

  const paymentGroupFields = Object.fromEntries(
    PAYMENT_AMOUNT_FIELDS.map(({ key }) => [key, sumField(key)]),
  );

  const sumWhen = (flag: string, fieldExpr: Record<string, unknown> | number) => ({
    $sum: { $cond: [{ $eq: [`$${flag}`, true] }, fieldExpr, 0] },
  });

  /** TCS Sales Return documents only — matches Excel pivot on the return file. */
  const isMeeshoReturnRow = { $eq: ['$meeshoIsGrossSale', false] };

  const sumWhenMeeshoReturnRow = (fieldExpr: Record<string, unknown> | number) => ({
    $sum: { $cond: [isMeeshoReturnRow, fieldExpr, 0] },
  });

  const sumWhenTcsReturnSubType = (
    subType: string,
    fieldExpr: Record<string, unknown> | number,
  ) => ({
    $sum: {
      $cond: [
        {
          $and: [
            isMeeshoReturnRow,
            { $eq: ['$meeshoReturnSubType', subType] },
          ],
        },
        fieldExpr,
        0,
      ],
    },
  });

  return [
    { $match: rowFilter },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalRows: { $sum: 1 },
              salesRows: {
                $sum: { $cond: [{ $eq: ['$reportType', 'sales'] }, 1, 0] },
              },
              cashbackRows: {
                $sum: { $cond: [{ $eq: ['$reportType', 'cashback'] }, 1, 0] },
              },
              meeshoGrossSalesRows: sumWhen('meeshoIsGrossSale', 1),
              meeshoTcsReturnRows: sumWhenMeeshoReturnRow(1),
              meeshoReturnCancellationRows: sumWhenTcsReturnSubType('cancellation', 1),
              meeshoReturnRtoRows: sumWhenTcsReturnSubType('rto', 1),
              meeshoReturnCustomerRows: sumWhenTcsReturnSubType('customer_return', 1),
              meeshoReturnNaRows: sumWhenTcsReturnSubType('na', 1),
              meeshoGrossSalesPcs: sumWhen('meeshoIsGrossSale', qty),
              meeshoTcsReturnPcs: sumWhenMeeshoReturnRow(meeshoReturnQtyForSummary),
              meeshoReturnCancellationPcs: sumWhenTcsReturnSubType(
                'cancellation',
                meeshoReturnQtyForSummary,
              ),
              meeshoReturnRtoPcs: sumWhenTcsReturnSubType('rto', meeshoReturnQtyForSummary),
              meeshoReturnCustomerPcs: sumWhenTcsReturnSubType(
                'customer_return',
                meeshoReturnQtyForSummary,
              ),
              meeshoReturnNaPcs: sumWhenTcsReturnSubType('na', meeshoReturnQtyForSummary),
              meeshoGrossSalesTaxable: sumWhen('meeshoIsGrossSale', taxableAmt),
              meeshoTcsReturnTaxable: sumWhenMeeshoReturnRow(taxableAmt),
              meeshoReturnCancellationTaxable: sumWhenTcsReturnSubType(
                'cancellation',
                taxableAmt,
              ),
              meeshoReturnRtoTaxable: sumWhenTcsReturnSubType('rto', taxableAmt),
              meeshoReturnCustomerTaxable: sumWhenTcsReturnSubType(
                'customer_return',
                taxableAmt,
              ),
              meeshoReturnNaTaxable: sumWhenTcsReturnSubType('na', taxableAmt),
              meeshoGrossSalesIgst: sumWhen('meeshoIsGrossSale', igstForSummary),
              meeshoTcsReturnIgst: sumWhenMeeshoReturnRow(igstForSummary),
              meeshoReturnCancellationIgst: sumWhenTcsReturnSubType(
                'cancellation',
                igstForSummary,
              ),
              meeshoReturnRtoIgst: sumWhenTcsReturnSubType('rto', igstForSummary),
              meeshoReturnCustomerIgst: sumWhenTcsReturnSubType(
                'customer_return',
                igstForSummary,
              ),
              meeshoReturnNaIgst: sumWhenTcsReturnSubType('na', igstForSummary),
              meeshoGrossSalesCgst: sumWhen('meeshoIsGrossSale', cgstForSummary),
              meeshoTcsReturnCgst: sumWhenMeeshoReturnRow(cgstForSummary),
              meeshoReturnCancellationCgst: sumWhenTcsReturnSubType(
                'cancellation',
                cgstForSummary,
              ),
              meeshoReturnRtoCgst: sumWhenTcsReturnSubType('rto', cgstForSummary),
              meeshoReturnCustomerCgst: sumWhenTcsReturnSubType(
                'customer_return',
                cgstForSummary,
              ),
              meeshoReturnNaCgst: sumWhenTcsReturnSubType('na', cgstForSummary),
              meeshoGrossSalesSgst: sumWhen('meeshoIsGrossSale', sgstForSummary),
              meeshoTcsReturnSgst: sumWhenMeeshoReturnRow(sgstForSummary),
              meeshoReturnCancellationSgst: sumWhenTcsReturnSubType(
                'cancellation',
                sgstForSummary,
              ),
              meeshoReturnRtoSgst: sumWhenTcsReturnSubType('rto', sgstForSummary),
              meeshoReturnCustomerSgst: sumWhenTcsReturnSubType(
                'customer_return',
                sgstForSummary,
              ),
              meeshoReturnNaSgst: sumWhenTcsReturnSubType('na', sgstForSummary),
              meeshoGrossSalesInvoice: sumWhen('meeshoIsGrossSale', invoiceAmt),
              meeshoTcsReturnInvoice: sumWhenMeeshoReturnRow(invoiceAmt),
              meeshoReturnCancellationInvoice: sumWhenTcsReturnSubType(
                'cancellation',
                invoiceAmt,
              ),
              meeshoReturnRtoInvoice: sumWhenTcsReturnSubType('rto', invoiceAmt),
              meeshoReturnCustomerInvoice: sumWhenTcsReturnSubType(
                'customer_return',
                invoiceAmt,
              ),
              meeshoReturnNaInvoice: sumWhenTcsReturnSubType('na', invoiceAmt),
              totalInvoiceAmount: { $sum: invoiceAmt },
              totalTaxableAmount: { $sum: taxableAmt },
              totalIgst: { $sum: igstForSummary },
              totalCgst: { $sum: cgstForSummary },
              totalSgst: { $sum: sgstForSummary },
              intraStateSalesRows: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$meeshoIsGrossSale', true] },
                        { $eq: ['$gstTransactionType', 'intra'] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              interStateSalesRows: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$meeshoIsGrossSale', true] },
                        { $eq: ['$gstTransactionType', 'inter'] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              intraStateTaxableAmount: {
                $sum: {
                  $cond: [{ $eq: ['$gstTransactionType', 'intra'] }, taxableAmt, 0],
                },
              },
              interStateTaxableAmount: {
                $sum: {
                  $cond: [{ $eq: ['$gstTransactionType', 'inter'] }, taxableAmt, 0],
                },
              },
              minInvoiceDate: { $min: '$invoiceDate' },
              maxInvoiceDate: { $max: '$invoiceDate' },
              ordersWithSettlement: {
                $sum: {
                  $cond: [{ $gt: [num('finalSettlementAmount'), 0] }, 1, 0],
                },
              },
              ...paymentGroupFields,
            },
          },
        ],
        byDocumentType: [
          {
            $group: {
              _id: { $ifNull: ['$documentType', 'Unknown'] },
              count: { $sum: 1 },
              invoiceAmount: { $sum: invoiceAmt },
              taxableAmount: { $sum: taxableAmt },
            },
          },
          { $sort: { count: -1, _id: 1 } },
          { $limit: 30 },
        ],
        byReportType: [
          {
            $group: {
              _id: '$reportType',
              count: { $sum: 1 },
              invoiceAmount: { $sum: invoiceAmt },
              taxableAmount: { $sum: taxableAmt },
            },
          },
          { $sort: { count: -1 } },
        ],
      },
    },
  ];
}

type FlipkartBucketAcc = {
  count: number;
  pcs: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  invoice: number;
};

const emptyFlipkartBucketAcc = (): FlipkartBucketAcc => ({
  count: 0,
  pcs: 0,
  taxable: 0,
  igst: 0,
  cgst: 0,
  sgst: 0,
  invoice: 0,
});

const addFlipkartBucketRow = (
  acc: FlipkartBucketAcc,
  row: {
    quantity?: number | null;
    taxableAmount?: number | null;
    invoiceAmount?: number | null;
    igstAmount?: number | null;
    cgstAmount?: number | null;
    sgstAmount?: number | null;
  },
  tax: { igst: number; cgst: number; sgst: number },
) => {
  acc.count += 1;
  acc.pcs += Number(row.quantity ?? 0);
  acc.taxable += Number(row.taxableAmount ?? 0);
  acc.igst += tax.igst;
  acc.cgst += tax.cgst;
  acc.sgst += tax.sgst;
  acc.invoice += computeFlipkartInvoiceAmount(row);
};

export type FlipkartMonthSummaryInputRow = FlipkartOrderNoteInput & {
  voucherType?: string | null;
  stateName?: string | null;
  igstRate?: number | null;
  cgstRate?: number | null;
  sgstRate?: number | null;
  reportType?: string | null;
  invoiceDate?: string | null;
  gstTransactionType?: string | null;
  finalSettlementAmount?: number | null;
} & Partial<Record<(typeof PAYMENT_AMOUNT_FIELDS)[number]['key'], number>>;

export type FlipkartMonthSummaryAggregateResult = {
  totals: FlipkartMonthTotalsRow;
  byDocumentType: Array<{
    _id: string;
    count: number;
    invoiceAmount: number;
    taxableAmount: number;
  }>;
  byVoucherType: Array<{
    _id: string;
    count: number;
    pcs: number;
    invoiceAmount: number;
    taxableAmount: number;
    igst: number;
    cgst: number;
    sgst: number;
  }>;
  flipkartNotes: {
    creditNote: FlipkartNoteSummaryRow;
    debitNote: FlipkartNoteSummaryRow;
  };
  byReportType: Array<{
    _id: string;
    count: number;
    invoiceAmount: number;
    taxableAmount: number;
  }>;
};

/**
 * Flipkart month summary with GST split based on seller registration state vs order state.
 * Uses the same logic as the state-wise GST report.
 */
export function aggregateFlipkartMonthSummaryFromRows(
  rows: FlipkartMonthSummaryInputRow[],
  sellerStateKeys: Set<string>,
): FlipkartMonthSummaryAggregateResult {
  const sale = emptyFlipkartBucketAcc();
  const returnBucket = emptyFlipkartBucketAcc();
  const cancellation = emptyFlipkartBucketAcc();
  const returnCancellation = emptyFlipkartBucketAcc();
  const voucherBuckets = new Map<string, FlipkartBucketAcc>();
  const byDocumentType = new Map<
    string,
    { count: number; invoiceAmount: number; taxableAmount: number }
  >();
  const byReportType = new Map<
    string,
    { count: number; invoiceAmount: number; taxableAmount: number }
  >();

  let minInvoiceDate: string | undefined;
  let maxInvoiceDate: string | undefined;
  let ordersWithSettlement = 0;
  let intraStateSalesRows = 0;
  let interStateSalesRows = 0;
  let intraStateTaxableAmount = 0;
  let interStateTaxableAmount = 0;

  const paymentTotals = Object.fromEntries(
    PAYMENT_AMOUNT_FIELDS.map(({ key }) => [key, 0]),
  ) as Record<(typeof PAYMENT_AMOUNT_FIELDS)[number]['key'], number>;

  for (const row of rows) {
    const tax = splitGstForReportRow(row, sellerStateKeys);
    const { bucket } = resolveFlipkartBucket(row.documentType, row.voucherType);
    const taxable = Number(row.taxableAmount ?? 0);
    const invoice = computeFlipkartInvoiceAmount(row);

    if (bucket === 'sale') {
      addFlipkartBucketRow(sale, row, tax);
      const isIntra = isSameIndianState(row.stateName ?? '', sellerStateKeys);
      if (isIntra) {
        intraStateSalesRows += 1;
        intraStateTaxableAmount += taxable;
      } else {
        interStateSalesRows += 1;
        interStateTaxableAmount += taxable;
      }
    } else if (bucket === 'return') {
      addFlipkartBucketRow(returnBucket, row, tax);
    } else if (bucket === 'cancellation') {
      addFlipkartBucketRow(cancellation, row, tax);
    } else if (bucket === 'return_cancellation') {
      addFlipkartBucketRow(returnCancellation, row, tax);
    }

    const voucherAcc = voucherBuckets.get(bucket) ?? emptyFlipkartBucketAcc();
    addFlipkartBucketRow(voucherAcc, row, tax);
    voucherBuckets.set(bucket, voucherAcc);

    const docType = String(row.documentType ?? 'Unknown').trim() || 'Unknown';
    const docAcc = byDocumentType.get(docType) ?? {
      count: 0,
      invoiceAmount: 0,
      taxableAmount: 0,
    };
    docAcc.count += 1;
    docAcc.invoiceAmount += invoice;
    docAcc.taxableAmount += taxable;
    byDocumentType.set(docType, docAcc);

    const reportType = String(row.reportType ?? 'unknown');
    const reportAcc = byReportType.get(reportType) ?? {
      count: 0,
      invoiceAmount: 0,
      taxableAmount: 0,
    };
    reportAcc.count += 1;
    reportAcc.invoiceAmount += invoice;
    reportAcc.taxableAmount += taxable;
    byReportType.set(reportType, reportAcc);

    for (const { key } of PAYMENT_AMOUNT_FIELDS) {
      paymentTotals[key] += Number(row[key] ?? 0);
    }

    if (Number(row.finalSettlementAmount ?? 0) > 0) {
      ordersWithSettlement += 1;
    }

    const invoiceDate = String(row.invoiceDate ?? '').trim();
    if (invoiceDate) {
      if (!minInvoiceDate || invoiceDate < minInvoiceDate) {
        minInvoiceDate = invoiceDate;
      }
      if (!maxInvoiceDate || invoiceDate > maxInvoiceDate) {
        maxInvoiceDate = invoiceDate;
      }
    }
  }

  const totalIgst =
    sale.igst + returnBucket.igst + cancellation.igst + returnCancellation.igst;
  const totalCgst =
    sale.cgst + returnBucket.cgst + cancellation.cgst + returnCancellation.cgst;
  const totalSgst =
    sale.sgst + returnBucket.sgst + cancellation.sgst + returnCancellation.sgst;
  const returnDeduction = {
    count: returnBucket.count + cancellation.count,
    pcs: returnBucket.pcs + cancellation.pcs,
    taxable: returnBucket.taxable + cancellation.taxable,
    igst: returnBucket.igst + cancellation.igst,
    cgst: returnBucket.cgst + cancellation.cgst,
    sgst: returnBucket.sgst + cancellation.sgst,
    invoice: returnBucket.invoice + cancellation.invoice,
  };

  const totals: FlipkartMonthTotalsRow = {
    totalRows: rows.length,
    salesRows: rows.filter((r) => r.reportType === 'sales').length,
    cashbackRows: rows.filter((r) => r.reportType === 'cashback').length,
    flipkartGrossSalesRows: sale.count,
    flipkartReturnDeductionRows: returnDeduction.count,
    flipkartReturnRows: returnBucket.count,
    flipkartCancellationRows: cancellation.count,
    flipkartReturnCancellationRows: returnCancellation.count,
    flipkartGrossSalesPcs: sale.pcs,
    flipkartReturnDeductionPcs: returnDeduction.pcs,
    flipkartReturnPcs: returnBucket.pcs,
    flipkartCancellationPcs: cancellation.pcs,
    flipkartReturnCancellationPcs: returnCancellation.pcs,
    flipkartGrossSalesTaxable: sale.taxable,
    flipkartReturnDeductionTaxable: returnDeduction.taxable,
    flipkartReturnTaxable: returnBucket.taxable,
    flipkartCancellationTaxable: cancellation.taxable,
    flipkartReturnCancellationTaxable: returnCancellation.taxable,
    flipkartGrossSalesIgst: sale.igst,
    flipkartReturnDeductionIgst: returnDeduction.igst,
    flipkartReturnIgst: returnBucket.igst,
    flipkartCancellationIgst: cancellation.igst,
    flipkartReturnCancellationIgst: returnCancellation.igst,
    flipkartGrossSalesCgst: sale.cgst,
    flipkartReturnDeductionCgst: returnDeduction.cgst,
    flipkartReturnCgst: returnBucket.cgst,
    flipkartCancellationCgst: cancellation.cgst,
    flipkartReturnCancellationCgst: returnCancellation.cgst,
    flipkartGrossSalesSgst: sale.sgst,
    flipkartReturnDeductionSgst: returnDeduction.sgst,
    flipkartReturnSgst: returnBucket.sgst,
    flipkartCancellationSgst: cancellation.sgst,
    flipkartReturnCancellationSgst: returnCancellation.sgst,
    flipkartGrossSalesInvoice: sale.invoice,
    flipkartReturnDeductionInvoice: returnDeduction.invoice,
    flipkartReturnInvoice: returnBucket.invoice,
    flipkartCancellationInvoice: cancellation.invoice,
    flipkartReturnCancellationInvoice: returnCancellation.invoice,
    totalInvoiceAmount: rows.reduce(
      (sum, row) => sum + computeFlipkartInvoiceAmount(row),
      0,
    ),
    totalTaxableAmount: rows.reduce(
      (sum, row) => sum + Number(row.taxableAmount ?? 0),
      0,
    ),
    totalIgst,
    totalCgst,
    totalSgst,
    intraStateSalesRows,
    interStateSalesRows,
    intraStateTaxableAmount,
    interStateTaxableAmount,
    minInvoiceDate,
    maxInvoiceDate,
    ordersWithSettlement,
    ...paymentTotals,
  };

  return {
    totals,
    byDocumentType: [...byDocumentType.entries()]
      .map(([_id, value]) => ({ _id, ...value }))
      .sort((a, b) => b.count - a.count || a._id.localeCompare(b._id))
      .slice(0, 30),
    byVoucherType: [...voucherBuckets.entries()].map(([_id, value]) => ({
      _id,
      count: value.count,
      pcs: value.pcs,
      invoiceAmount: value.invoice,
      taxableAmount: value.taxable,
      igst: value.igst,
      cgst: value.cgst,
      sgst: value.sgst,
    })),
    flipkartNotes: aggregateFlipkartNotesByOrderId(rows, sellerStateKeys),
    byReportType: [...byReportType.entries()]
      .map(([_id, value]) => ({ _id, ...value }))
      .sort((a, b) => b.count - a.count),
  };
}
