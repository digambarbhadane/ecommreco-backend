import { normalizeFlipkartNoteInvoiceAmount } from '../utils/flipkart-invoice.util';
import {
  isFlipkartCreditNoteDocumentType,
  isFlipkartDebitNoteDocumentType,
  isFlipkartReturnCancellationDocumentType,
  isFlipkartSalesCancellationDocumentType,
  isPaymentReturnRecord,
  isReturnDocumentType,
} from './payment-reconciliation.util';
import type { FlipkartPaymentReportDocument } from './flipkart/schemas/flipkart-payment-report.schema';
import type { MeeshoOrderPayments } from './meesho/schemas/order-payments.schema';
import { repairDateToIso } from '../../common/utils/repair-legacy-date.util';
import { resolveMyntraAnalyticsInvoiceDate, resolveMyntraReturnTransactionDate } from './myntra/myntra-invoice-date.util';


/** Line item used by Order Details fee transparency UI. */
export type PaymentFeeComponent = {
  key: string;
  label: string;
  amount: number;
  category: 'commission' | 'tcs' | 'tds' | 'other';
};

/** Normalized payment row for analytics API responses. */
export type PaymentAnalyticsRow = {
  _id: string;
  source:
    | 'flipkart_payment_order_reports'
    | 'meesho_order_payments'
    | 'amazon_payment_transactions'
    | 'myntra_pg_settlement_rows'
    | 'import_rows';
  orderId: string;
  orderItemId?: string;
  neftId?: string;
  neftType?: string;
  paymentDate?: string;
  bankSettlementValue?: number;
  saleAmount?: number;
  /**
   * Aggregated marketplace fee components + TCS + TDS (excludes commission).
   * Table Marketplace Fees = marketplaceFee + commission.
   */
  marketplaceFee?: number;
  commission?: number;
  tcs?: number;
  tds?: number;
  /** Non-zero fee lines that make up marketplaceFee + commission. */
  feeComponents?: PaymentFeeComponent[];
  refund?: number;
  /** Flipkart return marker (Customer Return / RTO / etc.). */
  returnType?: string;
  sellerSku?: string;
  quantity?: number;
  invoiceId?: string;
  invoiceDate?: string;
  gstin?: string;
  marketplace: string;
  reportMonth?: string;
  paymentMode?: string;
  finalSettlementAmount?: number;
  transactionId?: string;
  documentType?: string;
  invoiceAmount?: number;
  /** Myntra GST import upload scope for return→sale linking in Order Wise Payments. */
  uploadId?: string;
  stateName?: string;
  taxableAmount?: number;
  linkedSaleRowId?: string;
  myntraReturnMatchStatus?: string;
};

function toIsoDateString(
  value: unknown,
  reportMonth?: string,
): string | undefined {
  return repairDateToIso(value, reportMonth);
}

function num(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Flipkart payment reports often store `saleAmount` as 0 while the real
 * original sale lives in `saleAmountSummary`. Treat 0 as missing.
 */
function flipkartSaleAmount(
  doc: FlipkartPaymentReportDocument & { saleAmountSummary?: number },
): number | undefined {
  const fromSale = num(doc.saleAmount);
  const fromSummary = num(doc.saleAmountSummary);
  if (fromSale != null && fromSale !== 0) return fromSale;
  if (fromSummary != null && fromSummary !== 0) return fromSummary;
  return fromSale ?? fromSummary;
}

function pushFeeComponent(
  components: PaymentFeeComponent[],
  key: string,
  label: string,
  amount: number | undefined,
  category: PaymentFeeComponent['category'],
) {
  if (amount == null || amount === 0) return;
  components.push({ key, label, amount, category });
}

type FlipkartFeeAggregate = {
  marketplaceFee?: number;
  tcs?: number;
  tds?: number;
  feeComponents: PaymentFeeComponent[];
};

/**
 * Build Flipkart fee transparency lines from stored payment-report columns.
 * Uses signed values so fee reversals on return NEFTs cancel original charges.
 * marketplaceFee total = other charges + TCS + TDS (commission stays separate).
 */
function aggregateFlipkartFees(
  doc: FlipkartPaymentReportDocument,
): FlipkartFeeAggregate {
  const feeComponents: PaymentFeeComponent[] = [];

  const otherEntries: Array<[string, string, unknown]> = [
    // NOTE: `marketplaceFee` is often a rollup of fixed/collection/shipping/etc.
    // Include it only when no detailed components are present (handled below).
    ['fixedFee', 'Fixed Fee', doc.fixedFee],
    ['collectionFee', 'Collection Fee', doc.collectionFee],
    ['pickAndPackFee', 'Pick And Pack Fee', doc.pickAndPackFee],
    ['shippingFee', 'Shipping Fee', doc.shippingFee],
    ['reverseShippingFee', 'Reverse Shipping Fee', doc.reverseShippingFee],
    ['installationFee', 'Installation Fee', doc.installationFee],
    ['techVisitFee', 'Tech Visit Fee', doc.techVisitFee],
    [
      'uninstallationAndPackagingFee',
      'Uninstallation & Packaging Fee',
      doc.uninstallationAndPackagingFee,
    ],
    [
      'customerAddonsAmountRecovery',
      'Customer Add-ons Amount Recovery',
      doc.customerAddonsAmountRecovery,
    ],
    ['franchiseFee', 'Franchise Fee', doc.franchiseFee],
    ['shopsyMarketingFee', 'Shopsy Marketing Fee', doc.shopsyMarketingFee],
    [
      'productCancellationFee',
      'Product Cancellation Fee',
      doc.productCancellationFee,
    ],
    [
      'noCostEmiFeeReimbursement',
      'No Cost EMI Fee Reimbursement',
      doc.noCostEmiFeeReimbursement,
    ],
    ['gstOnMarketplaceFees', 'GST on Marketplace Fees', doc.gstOnMarketplaceFees],
  ];

  let otherTotal = 0;
  let hasOther = false;
  let hasDetailedFeeComponent = false;
  for (const [key, label, raw] of otherEntries) {
    const amount = num(raw);
    if (amount == null) continue;
    hasOther = true;
    if (amount !== 0) hasDetailedFeeComponent = true;
    otherTotal += amount;
    pushFeeComponent(feeComponents, key, label, amount, 'other');
  }

  // Roll-up Marketplace Fee column — only when detailed fee columns are absent.
  const marketplaceFeeRollup = num(doc.marketplaceFee);
  if (marketplaceFeeRollup != null && !hasDetailedFeeComponent) {
    hasOther = true;
    otherTotal += marketplaceFeeRollup;
    pushFeeComponent(
      feeComponents,
      'marketplaceFee',
      'Marketplace Fee',
      marketplaceFeeRollup,
      'other',
    );
  }

  // Discounts reduce marketplace fee charges (positive values are fee credits).
  const discount =
    num(doc.totalDiscountInMarketplaceFee) ?? num(doc.discountInMarketplaceFee);
  if (discount != null && discount !== 0) {
    hasOther = true;
    const credit = discount > 0 ? Math.abs(discount) : discount;
    otherTotal += credit;
    pushFeeComponent(
      feeComponents,
      'marketplaceFeeDiscount',
      'Discount in Marketplace Fee',
      credit,
      'other',
    );
  }

  const tcs = num(doc.tcs);
  const tds = num(doc.tds);
  pushFeeComponent(feeComponents, 'tcs', 'TCS', tcs, 'tcs');
  pushFeeComponent(feeComponents, 'tds', 'TDS', tds, 'tds');

  const commission = num(doc.commission);
  pushFeeComponent(feeComponents, 'commission', 'Commission', commission, 'commission');

  let marketplaceFee: number | undefined;
  if (hasOther) marketplaceFee = (marketplaceFee ?? 0) + otherTotal;
  if (tcs != null) marketplaceFee = (marketplaceFee ?? 0) + tcs;
  if (tds != null) marketplaceFee = (marketplaceFee ?? 0) + tds;

  return { marketplaceFee, tcs, tds, feeComponents };
}

function aggregateMeeshoFees(doc: MeeshoOrderPayments): FlipkartFeeAggregate {
  const feeComponents: PaymentFeeComponent[] = [];

  const otherEntries: Array<[string, string, unknown]> = [
    ['fixedFeeInclGst', 'Fixed Fee', doc.fixedFeeInclGst],
    ['warehousingFeeInclGst', 'Warehousing Fee', doc.warehousingFeeInclGst],
    ['shippingChargeInclGst', 'Shipping Charge', doc.shippingChargeInclGst],
    [
      'returnShippingChargeInclGst',
      'Return Shipping Charge',
      doc.returnShippingChargeInclGst,
    ],
    [
      'meeshoGoldPlatformFeeInclGst',
      'Meesho Gold Platform Fee',
      doc.meeshoGoldPlatformFeeInclGst,
    ],
    [
      'meeshoMallPlatformFeeInclGst',
      'Meesho Mall Platform Fee',
      doc.meeshoMallPlatformFeeInclGst,
    ],
    ['returnPremiumInclGst', 'Return Premium', doc.returnPremiumInclGst],
    [
      'returnPremiumReturnInclGst',
      'Return Premium (Return)',
      doc.returnPremiumReturnInclGst,
    ],
    [
      'netOtherSupportServiceChargesExclGst',
      'Other Support Service Charges',
      doc.netOtherSupportServiceChargesExclGst,
    ],
    [
      'gstOnNetOtherSupportServiceCharges',
      'GST on Other Support Service Charges',
      doc.gstOnNetOtherSupportServiceCharges,
    ],
    ['compensation', 'Compensation', doc.compensation],
    ['claims', 'Claims', doc.claims],
    ['recovery', 'Recovery', doc.recovery],
  ];

  let otherTotal = 0;
  let hasOther = false;
  for (const [key, label, raw] of otherEntries) {
    const amount = num(raw);
    if (amount == null) continue;
    hasOther = true;
    otherTotal += amount;
    pushFeeComponent(feeComponents, key, label, amount, 'other');
  }

  const tcs = num(doc.tcs);
  const tds = num(doc.tds);
  pushFeeComponent(feeComponents, 'tcs', 'TCS', tcs, 'tcs');
  pushFeeComponent(feeComponents, 'tds', 'TDS', tds, 'tds');

  const commission = num(doc.meeshoCommissionInclGst);
  pushFeeComponent(feeComponents, 'commission', 'Commission', commission, 'commission');

  let marketplaceFee: number | undefined;
  if (hasOther) marketplaceFee = (marketplaceFee ?? 0) + otherTotal;
  if (tcs != null) marketplaceFee = (marketplaceFee ?? 0) + tcs;
  if (tds != null) marketplaceFee = (marketplaceFee ?? 0) + tds;

  return { marketplaceFee, tcs, tds, feeComponents };
}

export function mapFlipkartPaymentToAnalyticsRow(
  doc: FlipkartPaymentReportDocument & {
    _id?: { toString(): string } | string;
  },
): PaymentAnalyticsRow {
  const id =
    typeof doc._id === 'object' && doc._id !== null && 'toString' in doc._id
      ? doc._id.toString()
      : String(doc._id ?? '');

  const saleAmount = flipkartSaleAmount(
    doc as FlipkartPaymentReportDocument & { saleAmountSummary?: number },
  );
  const fees = aggregateFlipkartFees(doc);
  const returnType = doc.returnType;
  const refund = num(doc.refund);
  // Return amount for blank Refund (Rs.) is derived in getReturnDeduction via returnType.
  // Do not copy saleAmount into refund here — that would incorrectly drop Sales Records.

  return {
    _id: id,
    source: 'flipkart_payment_order_reports',
    orderId: String(doc.orderId ?? ''),
    orderItemId: doc.orderItemId,
    neftId: doc.neftId,
    neftType: doc.neftType,
    paymentDate: toIsoDateString(doc.paymentDate, doc.reportMonth),
    bankSettlementValue: num(doc.bankSettlementValue),
    saleAmount,
    marketplaceFee: fees.marketplaceFee,
    commission: num(doc.commission),
    tcs: fees.tcs,
    tds: fees.tds,
    feeComponents: fees.feeComponents.length ? fees.feeComponents : undefined,
    refund,
    returnType,
    sellerSku: doc.sellerSku,
    quantity: num(doc.quantity),
    invoiceId: doc.invoiceId,
    invoiceDate: toIsoDateString(doc.invoiceDate, doc.reportMonth),
    gstin: doc.gstin,
    // Dedicated Flipkart collection — always expose platform slug. Stored
    // `doc.marketplace` is often a seller-marketplace ObjectId, not "flipkart".
    marketplace: 'flipkart',
    reportMonth: doc.reportMonth,
    finalSettlementAmount: num(doc.bankSettlementValue),
    transactionId: doc.neftId,
  };
}

export function mapMeeshoOrderPaymentToAnalyticsRow(
  doc: MeeshoOrderPayments & { _id?: { toString(): string } | string },
): PaymentAnalyticsRow {
  const id =
    typeof doc._id === 'object' && doc._id !== null && 'toString' in doc._id
      ? doc._id.toString()
      : String(doc._id ?? '');

  const fees = aggregateMeeshoFees(doc);

  return {
    _id: id,
    source: 'meesho_order_payments',
    orderId: String(doc.subOrderNo ?? ''),
    neftId: doc.transactionId,
    transactionId: doc.transactionId,
    paymentDate: toIsoDateString(doc.paymentDate, doc.reportMonth),
    bankSettlementValue: num(doc.finalSettlementAmount),
    finalSettlementAmount: num(doc.finalSettlementAmount),
    saleAmount: num(doc.totalSaleAmountInclShippingGst),
    marketplaceFee: fees.marketplaceFee,
    commission: num(doc.meeshoCommissionInclGst),
    tcs: fees.tcs,
    tds: fees.tds,
    feeComponents: fees.feeComponents.length ? fees.feeComponents : undefined,
    refund: num(doc.totalSaleReturnAmountInclShippingGst),
    sellerSku: doc.supplierSku,
    quantity: num(doc.quantity),
    gstin: doc.gstin,
    marketplace: 'meesho',
    reportMonth: doc.reportMonth,
  };
}

export function mapImportRowToPaymentAnalyticsRow(row: {
  _id?: { toString(): string } | string;
  orderID?: string;
  gstin?: string;
  marketplace?: string;
  documentType?: string;
  paymentDate?: string;
  paymentMode?: string;
  finalSettlementAmount?: number;
  transactionId?: string;
  invoiceDate?: string;
  order_packed_date?: string;
  orderCancelDate?: string;
  frRefundedDate?: string;
  invoiceNo?: string;
  invoiceNumber?: string;
  invoiceAmount?: number;
  reportMonth?: string;
  skuID?: string;
  quantity?: number;
  saleAmount?: number;
  marketplaceFee?: number;
  commission?: number;
  refund?: number;
  tcs?: number;
  tds?: number;
  taxableAmount?: number;
  igstAmount?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  uploadId?: string;
  stateName?: string;
  linkedSaleRowId?: string;
  myntraReturnMatchStatus?: string;
}): PaymentAnalyticsRow {
  const id =
    typeof row._id === 'object' && row._id !== null && 'toString' in row._id
      ? row._id.toString()
      : String(row._id ?? '');

  const documentType = row.documentType;
  const isCredit = isFlipkartCreditNoteDocumentType(documentType);
  const isDebit = isFlipkartDebitNoteDocumentType(documentType);
  const isReturnDoc = !isCredit && !isDebit && isReturnDocumentType(documentType);

  let saleAmount = num(row.saleAmount) ?? num(row.invoiceAmount);
  let refund = num(row.refund);
  if (isCredit) {
    saleAmount = normalizeFlipkartNoteInvoiceAmount('credit', row);
    refund = 0;
  } else if (isDebit) {
    saleAmount = 0;
    refund = normalizeFlipkartNoteInvoiceAmount('debit', row);
  } else if (isReturnDoc) {
    // GST/marketplace return rows store the amount on invoice/sale, not refund.
    const amount = Math.abs(saleAmount ?? num(row.invoiceAmount) ?? 0);
    if ((refund == null || refund === 0) && amount > 0) {
      refund = amount;
    }
    saleAmount = 0;
  }

  const feeComponents: PaymentFeeComponent[] = [];
  const other = num(row.marketplaceFee);
  const tcs = num(row.tcs);
  const tds = num(row.tds);
  const commission = num(row.commission);

  if (!isCredit && !isDebit) {
    pushFeeComponent(
      feeComponents,
      'marketplaceFee',
      'Marketplace Fee',
      other,
      'other',
    );
    pushFeeComponent(feeComponents, 'tcs', 'TCS', tcs, 'tcs');
    pushFeeComponent(feeComponents, 'tds', 'TDS', tds, 'tds');
    pushFeeComponent(
      feeComponents,
      'commission',
      'Commission',
      commission,
      'commission',
    );
  }

  let marketplaceFee: number | undefined;
  if (!isCredit && !isDebit) {
    if (other != null) marketplaceFee = (marketplaceFee ?? 0) + other;
    if (tcs != null) marketplaceFee = (marketplaceFee ?? 0) + tcs;
    if (tds != null) marketplaceFee = (marketplaceFee ?? 0) + tds;
  }

  const myntraReturnDate = resolveMyntraReturnTransactionDate({
    documentType,
    orderCancelDate: row.orderCancelDate,
    frRefundedDate: row.frRefundedDate,
    reportMonth: row.reportMonth,
  });

  return {
    _id: id,
    source: 'import_rows',
    orderId: String(row.orderID ?? ''),
    orderItemId: isCredit || isDebit ? `note:${id}` : undefined,
    paymentDate:
      myntraReturnDate ??
      toIsoDateString(row.paymentDate, row.reportMonth),
    paymentMode: row.paymentMode,
    bankSettlementValue:
      isCredit || isDebit ? 0 : num(row.finalSettlementAmount),
    finalSettlementAmount:
      isCredit || isDebit ? 0 : num(row.finalSettlementAmount),
    transactionId: row.transactionId,
    neftId: row.transactionId,
    gstin: row.gstin,
    marketplace: String(row.marketplace ?? ''),
    documentType,
    invoiceDate:
      resolveMyntraAnalyticsInvoiceDate(row) ??
      toIsoDateString(row.invoiceDate, row.reportMonth),
    invoiceId:
      String(row.invoiceNo ?? row.invoiceNumber ?? '')
        .replace(/\\+"/g, '')
        .replace(/"/g, '')
        .trim() || undefined,
    invoiceAmount: num(row.invoiceAmount),
    reportMonth: row.reportMonth,
    sellerSku: row.skuID,
    quantity: num(row.quantity),
    saleAmount,
    marketplaceFee,
    commission: isCredit || isDebit ? 0 : num(row.commission),
    tcs: isCredit || isDebit ? undefined : tcs,
    tds: isCredit || isDebit ? undefined : tds,
    feeComponents: feeComponents.length ? feeComponents : undefined,
    refund,
    uploadId: row.uploadId ? String(row.uploadId) : undefined,
    stateName: row.stateName ? String(row.stateName) : undefined,
    taxableAmount: num(row.taxableAmount),
    linkedSaleRowId: row.linkedSaleRowId
      ? String(row.linkedSaleRowId)
      : undefined,
    myntraReturnMatchStatus: row.myntraReturnMatchStatus
      ? String(row.myntraReturnMatchStatus)
      : undefined,
  };
}

function normalizeFlipkartImportSku(raw?: string): string | undefined {
  let value = String(raw ?? '').trim();
  if (!value) return undefined;
  // Flipkart GST exports often wrap SKUs as """SKU:ABC-123"""
  value = value.replace(/^"+|"+$/g, '').trim();
  value = value.replace(/^SKU:\s*/i, '').trim();
  return value || undefined;
}

export { normalizeFlipkartImportSku };

/** GST Return / RTO invoice metadata (display + coverage matching). */
export type FlipkartGstReturnInvoiceMeta = {
  orderId: string;
  sellerSku?: string;
  invoiceId: string;
  invoiceDate?: string;
};

/**
 * True for Flipkart GST Return / RTO / Customer Return documents.
 * Excludes Return Cancellation (handled as a financial note).
 */
export function isFlipkartGstReturnDocumentType(
  documentType?: string | null,
): boolean {
  if (!isReturnDocumentType(documentType)) return false;
  if (isFlipkartReturnCancellationDocumentType(documentType)) return false;
  return true;
}

function isUsableFlipkartInvoiceToken(raw?: string | null): boolean {
  const inv = String(raw ?? '').trim();
  if (!inv) return false;
  if (/^(NA|N\/A|-)$/i.test(inv)) return false;
  return true;
}

/** Split Flipkart payment invoiceId values that join sale$return with `$`. */
export function splitFlipkartPaymentInvoiceIds(
  invoiceId?: string | null,
): string[] {
  const raw = String(invoiceId ?? '').trim();
  if (!raw || !isUsableFlipkartInvoiceToken(raw)) return [];
  return raw
    .split('$')
    .map((part) => part.trim())
    .filter((part) => isUsableFlipkartInvoiceToken(part));
}

/**
 * GST Return rows to attach financially alongside payment NEFTs.
 *
 * Flipkart GST line-item Returns are the canonical return documents (including
 * cancelled / re-issued invoice pairs). Payment NEFTs often roll many line
 * returns into one refund amount — lifecycle skips that payment refund when
 * GST Returns are present so amounts are not double-counted.
 *
 * Always attach every GST Return row; do not drop returns for missing NEFT,
 * shared SKU, or multi-item payment rollups.
 */
export function selectUncoveredFlipkartGstReturnRows(
  _paymentRows: Array<{
    source?: string;
    orderId?: string;
    invoiceId?: string;
    refund?: number;
    returnType?: string;
    documentType?: string;
    saleAmount?: number;
    invoiceAmount?: number;
  }>,
  gstReturnRows: PaymentAnalyticsRow[],
): PaymentAnalyticsRow[] {
  return gstReturnRows.slice();
}

/**
 * Order Details display enrichment for Flipkart (amounts unchanged):
 * 1) Payment return NEFTs often store the Sale invoice id — restore each row's
 *    GST Return invoice number from import_rows when available.
 * 2) GST Sale rows missing NEFT pick up the Flipkart payment sale settlement
 *    NEFT for the same order/invoice/SKU when one exists (never from returns).
 */
export function enrichFlipkartOrderDetailsMetadata(
  rows: PaymentAnalyticsRow[],
  gstReturns: FlipkartGstReturnInvoiceMeta[],
): PaymentAnalyticsRow[] {
  if (!rows.length) return rows;

  const returnsByOrderSku = new Map<string, FlipkartGstReturnInvoiceMeta[]>();
  const returnsByOrder = new Map<string, FlipkartGstReturnInvoiceMeta[]>();
  const returnsByInvoice = new Map<string, FlipkartGstReturnInvoiceMeta>();
  for (const ret of gstReturns) {
    const orderId = String(ret.orderId ?? '').trim();
    const invoiceId = String(ret.invoiceId ?? '').trim();
    if (!orderId || !invoiceId) continue;
    returnsByInvoice.set(`${orderId}::${invoiceId}`, ret);
    const sku = String(ret.sellerSku ?? '')
      .trim()
      .toLowerCase();
    if (sku) {
      const skuKey = `${orderId}::${sku}`;
      const skuList = returnsByOrderSku.get(skuKey) ?? [];
      skuList.push(ret);
      returnsByOrderSku.set(skuKey, skuList);
    }
    const list = returnsByOrder.get(orderId) ?? [];
    list.push(ret);
    returnsByOrder.set(orderId, list);
  }

  const saleNeftByOrderInvoice = new Map<string, string>();
  const saleNeftByOrderSku = new Map<string, string>();
  for (const row of rows) {
    if (row.source !== 'flipkart_payment_order_reports') continue;
    const neft = String(row.neftId ?? row.transactionId ?? '').trim();
    if (!neft) continue;
    // Explicit refund NEFTs are returns. Sale settlements may still carry
    // returnType (Logistics/Customer Return) — keep those as NEFT sources.
    if (isPaymentReturnRecord(row)) continue;
    const orderId = String(row.orderId ?? '').trim();
    const invParts = splitFlipkartPaymentInvoiceIds(row.invoiceId);
    const sku = String(row.sellerSku ?? '')
      .trim()
      .toLowerCase();
    for (const inv of invParts) {
      saleNeftByOrderInvoice.set(`${orderId}::${inv}`, neft);
    }
    if (orderId && sku) saleNeftByOrderSku.set(`${orderId}::${sku}`, neft);
  }

  return rows.map((row) => {
    let next = row;
    let changed = false;

    if (
      row.source === 'flipkart_payment_order_reports' &&
      isPaymentReturnRecord(row)
    ) {
      const orderId = String(row.orderId ?? '').trim();
      const sku = String(row.sellerSku ?? '')
        .trim()
        .toLowerCase();
      let meta: FlipkartGstReturnInvoiceMeta | undefined;

      // Prefer an explicit return invoice already present in payment invoiceId.
      for (const part of splitFlipkartPaymentInvoiceIds(row.invoiceId)) {
        const hit = returnsByInvoice.get(`${orderId}::${part}`);
        if (hit) {
          meta = hit;
          break;
        }
      }

      if (!meta) {
        const skuList = sku
          ? returnsByOrderSku.get(`${orderId}::${sku}`) ?? []
          : [];
        if (skuList.length === 1) meta = skuList[0];
      }
      if (!meta) {
        const list = returnsByOrder.get(orderId) ?? [];
        if (list.length === 1) meta = list[0];
      }

      const gstInvoice = String(meta?.invoiceId ?? '').trim();
      const currentParts = splitFlipkartPaymentInvoiceIds(row.invoiceId);
      const alreadyHasReturnInvoice =
        gstInvoice && currentParts.includes(gstInvoice);
      if (gstInvoice && !alreadyHasReturnInvoice) {
        // Replace sale-only / placeholder invoice with the GST Return invoice.
        const current = String(row.invoiceId ?? '').trim();
        const shouldReplace =
          !isUsableFlipkartInvoiceToken(current) ||
          currentParts.length <= 1 ||
          !currentParts.some((part) =>
            returnsByInvoice.has(`${orderId}::${part}`),
          );
        if (shouldReplace) {
          next = {
            ...next,
            invoiceId: gstInvoice,
            ...(meta?.invoiceDate
              ? { invoiceDate: meta.invoiceDate }
              : {}),
          };
          changed = true;
        }
      }
    }

    const docType = String(row.documentType ?? '')
      .trim()
      .toUpperCase();
    const isGstSale =
      row.source === 'import_rows' &&
      (docType === 'SALE' || docType === 'SALES');
    if (isGstSale && !String(row.neftId ?? row.transactionId ?? '').trim()) {
      const orderId = String(row.orderId ?? '').trim();
      const inv = String(row.invoiceId ?? '').trim();
      const sku = String(row.sellerSku ?? '')
        .trim()
        .toLowerCase();
      const neft =
        (inv ? saleNeftByOrderInvoice.get(`${orderId}::${inv}`) : undefined) ||
        (sku ? saleNeftByOrderSku.get(`${orderId}::${sku}`) : undefined) ||
        '';
      if (neft) {
        next = { ...next, neftId: neft, transactionId: neft };
        changed = true;
      }
    }

    return changed ? next : row;
  });
}

/** Map Flipkart GST Credit/Debit/Cancellation/Sale/Return import rows into payment analytics rows. */
export function mapFlipkartNoteImportRowToAnalyticsRow(row: {
  _id?: { toString(): string } | string;
  orderID?: string;
  gstin?: string;
  marketplace?: string;
  documentType?: string;
  /** Canonical Flipkart GST invoice / note id (Invoice No / Credit Note ID / Debit Note ID). */
  invoiceNo?: string;
  invoiceDate?: string;
  invoiceAmount?: number;
  taxableAmount?: number;
  igstAmount?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  reportMonth?: string;
  skuID?: string;
  quantity?: number;
  /** Flipkart GST exports often include settlement NEFT / UTR as transactionId. */
  transactionId?: string;
}): PaymentAnalyticsRow | null {
  const documentType = String(row.documentType ?? '').trim();
  const documentTypeUpper = documentType.toUpperCase();
  // Exact Sale/Sales only — do not match Sales Cancellation.
  const isSale =
    documentTypeUpper === 'SALE' || documentTypeUpper === 'SALES';
  const isGstReturn = isFlipkartGstReturnDocumentType(documentType);
  const isCredit = isFlipkartCreditNoteDocumentType(documentType);
  const isDebit = isFlipkartDebitNoteDocumentType(documentType);
  const isReturnCancellation =
    isFlipkartReturnCancellationDocumentType(documentType);
  const isSalesCancellation =
    isFlipkartSalesCancellationDocumentType(documentType);
  if (
    !isSale &&
    !isGstReturn &&
    !isCredit &&
    !isDebit &&
    !isReturnCancellation &&
    !isSalesCancellation
  ) {
    return null;
  }

  const id =
    typeof row._id === 'object' && row._id !== null && 'toString' in row._id
      ? row._id.toString()
      : String(row._id ?? '');

  const invoiceId = String(row.invoiceNo ?? '').trim() || undefined;
  const settlementTxnId = String(row.transactionId ?? '').trim() || undefined;

  // GST Sale invoices are not settlement NEFTs — bank/fees stay 0 (same as notes).
  // Do not invent orderItemId: lifecycle sales de-dupe by item/SKU, and a synthetic
  // id would isolate GST sales from payment return rows that share the same SKU.
  // When Flipkart GST exports include NEFT/UTR on the Sale row, pass it through.
  if (isSale) {
    const saleAmount = Math.abs(
      num(row.invoiceAmount) ?? num(row.taxableAmount) ?? 0,
    );
    return {
      _id: `fk-sale:${id}`,
      source: 'import_rows',
      orderId: String(row.orderID ?? ''),
      paymentDate: toIsoDateString(row.invoiceDate, row.reportMonth),
      bankSettlementValue: 0,
      finalSettlementAmount: 0,
      saleAmount,
      refund: 0,
      invoiceAmount: num(row.invoiceAmount),
      invoiceId,
      invoiceDate: toIsoDateString(row.invoiceDate, row.reportMonth),
      documentType,
      sellerSku: normalizeFlipkartImportSku(row.skuID),
      quantity: num(row.quantity),
      gstin: row.gstin,
      marketplace: 'flipkart',
      reportMonth: row.reportMonth,
      commission: 0,
      marketplaceFee: 0,
      ...(settlementTxnId
        ? { neftId: settlementTxnId, transactionId: settlementTxnId }
        : {}),
    };
  }

  // GST Return / RTO — or Return Cancellation when Flipkart stores a positive
  // amount under documentType "Return" (HKPHR / AFSJR / LOA… invoices).
  // Do NOT Math.abs a positive Return into another negative refund.
  if (isGstReturn) {
    const signedInvoice =
      num(row.invoiceAmount) ?? num(row.taxableAmount) ?? 0;
    if (signedInvoice > 0) {
      return {
        _id: `fk-note:${id}`,
        source: 'import_rows',
        orderId: String(row.orderID ?? ''),
        orderItemId: `note:${id}`,
        paymentDate: toIsoDateString(row.invoiceDate, row.reportMonth),
        bankSettlementValue: 0,
        finalSettlementAmount: 0,
        saleAmount: Math.abs(signedInvoice),
        refund: 0,
        invoiceAmount: signedInvoice,
        invoiceId,
        invoiceDate: toIsoDateString(row.invoiceDate, row.reportMonth),
        // Canonical type so existing Return Cancellation → Gross Sales rule applies.
        documentType: 'Return Cancellation',
        sellerSku: normalizeFlipkartImportSku(row.skuID),
        quantity: num(row.quantity),
        gstin: row.gstin,
        marketplace: 'flipkart',
        reportMonth: row.reportMonth,
        commission: 0,
        marketplaceFee: 0,
        ...(settlementTxnId
          ? { neftId: settlementTxnId, transactionId: settlementTxnId }
          : {}),
      };
    }

    const returnAmount = Math.abs(signedInvoice);
    return {
      _id: `fk-return:${id}`,
      source: 'import_rows',
      orderId: String(row.orderID ?? ''),
      paymentDate: toIsoDateString(row.invoiceDate, row.reportMonth),
      bankSettlementValue: 0,
      finalSettlementAmount: 0,
      saleAmount: 0,
      refund: returnAmount > 0 ? -returnAmount : 0,
      invoiceAmount: num(row.invoiceAmount),
      invoiceId,
      invoiceDate: toIsoDateString(row.invoiceDate, row.reportMonth),
      documentType,
      sellerSku: normalizeFlipkartImportSku(row.skuID),
      quantity: num(row.quantity),
      gstin: row.gstin,
      marketplace: 'flipkart',
      reportMonth: row.reportMonth,
      commission: 0,
      marketplaceFee: 0,
      ...(settlementTxnId
        ? { neftId: settlementTxnId, transactionId: settlementTxnId }
        : {}),
    };
  }

  const noteAmount = normalizeFlipkartNoteInvoiceAmount(
    isCredit || isReturnCancellation ? 'credit' : 'debit',
    row,
  );

  return {
    _id: `fk-note:${id}`,
    source: 'import_rows',
    orderId: String(row.orderID ?? ''),
    orderItemId: `note:${id}`,
    paymentDate: toIsoDateString(row.invoiceDate, row.reportMonth),
    bankSettlementValue: 0,
    finalSettlementAmount: 0,
    saleAmount: isCredit || isReturnCancellation ? noteAmount : 0,
    refund: isDebit || isSalesCancellation ? noteAmount : 0,
    invoiceAmount: num(row.invoiceAmount),
    invoiceId,
    invoiceDate: toIsoDateString(row.invoiceDate, row.reportMonth),
    documentType,
    sellerSku: normalizeFlipkartImportSku(row.skuID),
    quantity: num(row.quantity),
    gstin: row.gstin,
    marketplace: 'flipkart',
    reportMonth: row.reportMonth,
    commission: 0,
    marketplaceFee: 0,
    ...(settlementTxnId
      ? { neftId: settlementTxnId, transactionId: settlementTxnId }
      : {}),
  };
}
