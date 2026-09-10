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
    // Live Order Status drives RTO detection and document classification.
    documentType: doc.liveOrderStatus
      ? String(doc.liveOrderStatus).trim()
      : undefined,
    returnType: (() => {
      const status = String(doc.liveOrderStatus ?? '')
        .trim()
        .toUpperCase();
      if (!status) return undefined;
      if (/\bRTO\b/.test(status) || status.includes('RETURN TO ORIGIN')) {
        return String(doc.liveOrderStatus).trim();
      }
      return undefined;
    })(),
  };
}

/**
 * Meesho Order Payments sheets often store fee components (Marketplace Fee,
 * TDS, shipping, …) as separate physical rows that share the same Sub Order +
 * Transaction ID. Merge those into one analytics row so Order Details does not
 * treat each fee line as a separate sale / invoice / quantity.
 *
 * Repeated sale/return/bank/qty values that are copied onto every fee line are
 * kept once; complementary fee amounts are summed and feeComponents unioned by key.
 */
function mergeRepeatedOrSum(values: Array<number | undefined>): number | undefined {
  const nums = values
    .map((v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v)))
    .filter((v): v is number => v != null);
  if (!nums.length) return undefined;
  const nonzero = nums.filter((v) => v !== 0);
  if (!nonzero.length) return 0;
  const first = nonzero[0];
  if (nonzero.every((v) => Math.abs(v - first) < 0.005)) return first;
  return nonzero.reduce((sum, v) => sum + v, 0);
}

function mergeMeeshoFeeComponents(
  rows: PaymentAnalyticsRow[],
): PaymentFeeComponent[] | undefined {
  const byKey = new Map<
    string,
    {
      label: string;
      category: PaymentFeeComponent['category'];
      amounts: number[];
    }
  >();
  for (const row of rows) {
    for (const component of row.feeComponents ?? []) {
      const key = String(component.key || '').trim();
      if (!key) continue;
      const amount = Number(component.amount) || 0;
      if (!amount) continue;
      const existing = byKey.get(key);
      if (existing) existing.amounts.push(amount);
      else {
        byKey.set(key, {
          label: component.label,
          category: component.category,
          amounts: [amount],
        });
      }
    }
  }
  const merged: PaymentFeeComponent[] = [];
  for (const [key, entry] of byKey) {
    const amount = mergeRepeatedOrSum(entry.amounts);
    if (amount == null || amount === 0) continue;
    merged.push({
      key,
      label: entry.label,
      amount,
      category: entry.category,
    });
  }
  return merged.length ? merged : undefined;
}

function mergeMeeshoPaymentAnalyticsRows(
  group: PaymentAnalyticsRow[],
): PaymentAnalyticsRow {
  if (group.length === 1) return group[0];

  // Prefer the richest settlement line as the base identity/metadata.
  const ranked = [...group].sort((a, b) => {
    const score = (row: PaymentAnalyticsRow) =>
      (row.feeComponents?.length ?? 0) * 10 +
      (Math.abs(Number(row.bankSettlementValue ?? row.finalSettlementAmount ?? 0)) >
      0
        ? 5
        : 0) +
      (Math.abs(Number(row.saleAmount ?? 0)) > 0 ? 2 : 0) +
      (Math.abs(Number(row.refund ?? 0)) > 0 ? 1 : 0);
    return score(b) - score(a);
  });
  const base = ranked[0];

  const saleAmount = mergeRepeatedOrSum(group.map((r) => r.saleAmount));
  const refund = mergeRepeatedOrSum(group.map((r) => r.refund));
  const bank = mergeRepeatedOrSum(
    group.map((r) => r.bankSettlementValue ?? r.finalSettlementAmount),
  );
  const quantity = mergeRepeatedOrSum(group.map((r) => r.quantity));
  const marketplaceFee = mergeRepeatedOrSum(group.map((r) => r.marketplaceFee));
  const commission = mergeRepeatedOrSum(group.map((r) => r.commission));
  const tcs = mergeRepeatedOrSum(group.map((r) => r.tcs));
  const tds = mergeRepeatedOrSum(group.map((r) => r.tds));
  const feeComponents = mergeMeeshoFeeComponents(group);

  return {
    ...base,
    saleAmount,
    refund,
    bankSettlementValue: bank,
    finalSettlementAmount: bank,
    quantity,
    marketplaceFee,
    commission,
    tcs,
    tds,
    feeComponents,
    sellerSku:
      group.map((r) => String(r.sellerSku ?? '').trim()).find(Boolean) ||
      base.sellerSku,
    documentType:
      group.map((r) => String(r.documentType ?? '').trim()).find(Boolean) ||
      base.documentType,
    returnType:
      group.map((r) => String(r.returnType ?? '').trim()).find(Boolean) ||
      base.returnType,
    paymentDate:
      group.map((r) => String(r.paymentDate ?? '').trim()).find(Boolean) ||
      base.paymentDate,
  };
}

/**
 * Meesho-only: merge fee-split `meesho_order_payments` rows that share the same
 * Order ID + Transaction/NEFT id, and drop matching legacy `import_rows`.
 *
 * Other marketplaces are untouched. Rows without a transaction id are kept.
 */
export function dedupeMeeshoDuplicatePaymentTransactions(
  rows: PaymentAnalyticsRow[],
): PaymentAnalyticsRow[] {
  const paymentGroups = new Map<string, PaymentAnalyticsRow[]>();
  const paymentTxnByOrder = new Map<string, Set<string>>();

  for (const row of rows) {
    if (row.source !== 'meesho_order_payments') continue;
    const orderId = String(row.orderId ?? '').trim();
    const txn = String(row.neftId || row.transactionId || '')
      .trim()
      .toLowerCase();
    if (!orderId || !txn) continue;
    const key = `${orderId}::${txn}`;
    const bucket = paymentGroups.get(key);
    if (bucket) bucket.push(row);
    else paymentGroups.set(key, [row]);
    const set = paymentTxnByOrder.get(orderId) ?? new Set<string>();
    set.add(txn);
    paymentTxnByOrder.set(orderId, set);
  }

  const emittedPaymentKeys = new Set<string>();
  const afterPaymentMerge: PaymentAnalyticsRow[] = [];

  for (const row of rows) {
    if (row.source !== 'meesho_order_payments') {
      afterPaymentMerge.push(row);
      continue;
    }
    const orderId = String(row.orderId ?? '').trim();
    const txn = String(row.neftId || row.transactionId || '')
      .trim()
      .toLowerCase();
    if (!orderId || !txn) {
      afterPaymentMerge.push(row);
      continue;
    }
    const key = `${orderId}::${txn}`;
    if (emittedPaymentKeys.has(key)) continue;
    emittedPaymentKeys.add(key);
    afterPaymentMerge.push(
      mergeMeeshoPaymentAnalyticsRows(paymentGroups.get(key) ?? [row]),
    );
  }

  if (!paymentTxnByOrder.size) {
    return normalizeMeeshoMirroredSaleReturnSettlements(afterPaymentMerge);
  }

  const withoutLegacyMirrors = afterPaymentMerge.filter((row) => {
    if (row.source !== 'import_rows') return true;
    const marketplace = String(row.marketplace ?? '')
      .trim()
      .toLowerCase();
    // Only strip Meesho legacy duplicates — never touch other marketplaces.
    if (marketplace && marketplace !== 'meesho') return true;
    const orderId = String(row.orderId ?? '').trim();
    const txn = String(row.neftId || row.transactionId || '')
      .trim()
      .toLowerCase();
    if (!orderId || !txn) return true;
    return !paymentTxnByOrder.get(orderId)?.has(txn);
  });

  return normalizeMeeshoMirroredSaleReturnSettlements(withoutLegacyMirrors);
}

function roundMeeshoAmount(value: number): string {
  return (Math.round(Math.abs(value) * 100) / 100).toFixed(2);
}

/** Preserve sign — sale payout (+X) and return clawback (−X) are different events. */
function roundMeeshoSignedAmount(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function meeshoSaleReturnMirrorKey(row: PaymentAnalyticsRow): string | null {
  const sale = Math.abs(Number(row.saleAmount) || 0);
  const refund = Math.abs(Number(row.refund) || 0);
  if (sale <= 0 || refund <= 0) return null;
  const orderId = String(row.orderId ?? '').trim();
  if (!orderId) return null;
  // Key by sub-order + stamped sale/return totals only. SKU/qty often differ
  // across fee vs settlement reprints of the same Meesho sub-order.
  return `${orderId}::${roundMeeshoAmount(sale)}::${roundMeeshoAmount(refund)}`;
}

function meeshoPaymentSortTime(row: PaymentAnalyticsRow): number {
  const raw = String(row.paymentDate ?? '').trim();
  if (!raw) return Number.MAX_SAFE_INTEGER;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

function meeshoTxnIdentity(row: PaymentAnalyticsRow): string {
  return String(row.neftId || row.transactionId || row._id || '')
    .trim()
    .toLowerCase();
}

/**
 * Meesho reprints Final Settlement / fee totals onto every settlement line.
 * When several distinct Transaction IDs carry the identical signed amount,
 * keep that amount on the earliest payment row only.
 * Opposite signs (payout vs clawback / fee vs fee reversal) are kept separate.
 */
function clearMeeshoIdenticalAmountStamps(
  next: PaymentAnalyticsRow[],
  indexes: number[],
  readAmount: (row: PaymentAnalyticsRow) => number,
  writeZero: (row: PaymentAnalyticsRow) => PaymentAnalyticsRow,
): void {
  const byAmount = new Map<string, number[]>();
  const seenTxnForAmount = new Map<string, Set<string>>();

  for (const index of indexes) {
    const amount = readAmount(next[index]);
    if (!amount) continue;
    const amountKey = roundMeeshoSignedAmount(amount);
    const txn = meeshoTxnIdentity(next[index]) || `idx:${index}`;
    const seen = seenTxnForAmount.get(amountKey) ?? new Set<string>();
    if (seen.has(txn)) continue;
    seen.add(txn);
    seenTxnForAmount.set(amountKey, seen);
    const bucket = byAmount.get(amountKey);
    if (bucket) bucket.push(index);
    else byAmount.set(amountKey, [index]);
  }

  for (const stampedIndexes of byAmount.values()) {
    if (stampedIndexes.length < 2) continue;
    stampedIndexes.sort(
      (a, b) => meeshoPaymentSortTime(next[a]) - meeshoPaymentSortTime(next[b]),
    );
    for (const index of stampedIndexes.slice(1)) {
      next[index] = writeZero(next[index]);
    }
  }
}

function clearMeeshoIdenticalFeeComponentStamps(
  next: PaymentAnalyticsRow[],
  indexes: number[],
): void {
  const amountsByFeeKey = new Map<string, Map<string, number[]>>();
  const seenTxn = new Map<string, Set<string>>();

  for (const index of indexes) {
    const txn = meeshoTxnIdentity(next[index]) || `idx:${index}`;
    for (const component of next[index].feeComponents ?? []) {
      const feeKey = String(component.key || '').trim();
      const amount = Number(component.amount) || 0;
      if (!feeKey || !amount) continue;
      const amountKey = `${feeKey}::${roundMeeshoSignedAmount(amount)}`;
      const seen = seenTxn.get(amountKey) ?? new Set<string>();
      if (seen.has(txn)) continue;
      seen.add(txn);
      seenTxn.set(amountKey, seen);
      const byAmount = amountsByFeeKey.get(feeKey) ?? new Map<string, number[]>();
      const signedKey = roundMeeshoSignedAmount(amount);
      const bucket = byAmount.get(signedKey);
      if (bucket) bucket.push(index);
      else byAmount.set(signedKey, [index]);
      amountsByFeeKey.set(feeKey, byAmount);
    }
  }

  for (const [feeKey, byAmount] of amountsByFeeKey) {
    for (const stampedIndexes of byAmount.values()) {
      if (stampedIndexes.length < 2) continue;
      stampedIndexes.sort(
        (a, b) =>
          meeshoPaymentSortTime(next[a]) - meeshoPaymentSortTime(next[b]),
      );
      for (const index of stampedIndexes.slice(1)) {
        const components = (next[index].feeComponents ?? []).filter(
          (component) => String(component.key || '').trim() !== feeKey,
        );
        next[index] = {
          ...next[index],
          feeComponents: components.length ? components : undefined,
        };
      }
    }
  }
}

/**
 * Meesho reprints order-level Total Sale + Total Sale Return on every
 * settlement Transaction ID for the same sub-order. When multiple different
 * payment IDs carry that identical stamp, keep each Transaction ID but assign
 * business roles: earliest → Sale, latest → Return, middle → payment/fees only.
 *
 * Also clears reprinted Final Settlement / fee totals so bank & fees are not
 * summed once per settlement line.
 *
 * Single stamped settlements (one txn with sale+return) are left unchanged.
 */
function normalizeMeeshoMirroredSaleReturnSettlements(
  rows: PaymentAnalyticsRow[],
): PaymentAnalyticsRow[] {
  const meeshoIndexesByOrder = new Map<string, number[]>();
  rows.forEach((row, index) => {
    if (row.source !== 'meesho_order_payments') return;
    const orderId = String(row.orderId ?? '').trim();
    if (!orderId) return;
    const bucket = meeshoIndexesByOrder.get(orderId);
    if (bucket) bucket.push(index);
    else meeshoIndexesByOrder.set(orderId, [index]);
  });

  if (!meeshoIndexesByOrder.size) return rows;

  const next = rows.map((row) => ({ ...row }));

  for (const indexes of meeshoIndexesByOrder.values()) {
    const stampedByKey = new Map<string, number[]>();
    for (const index of indexes) {
      const key = meeshoSaleReturnMirrorKey(next[index]);
      if (!key) continue;
      const bucket = stampedByKey.get(key);
      if (bucket) bucket.push(index);
      else stampedByKey.set(key, [index]);
    }

    for (const stampedIndexes of stampedByKey.values()) {
      // Distinct settlement Transaction IDs only — fee-split already merged.
      const uniqueTxnIndexes: number[] = [];
      const seenTxn = new Set<string>();
      for (const index of stampedIndexes) {
        const txn = meeshoTxnIdentity(next[index]);
        if (seenTxn.has(txn)) continue;
        seenTxn.add(txn);
        uniqueTxnIndexes.push(index);
      }
      if (uniqueTxnIndexes.length < 2) continue;

      uniqueTxnIndexes.sort(
        (a, b) => meeshoPaymentSortTime(next[a]) - meeshoPaymentSortTime(next[b]),
      );

      const firstIdx = uniqueTxnIndexes[0];
      const lastIdx = uniqueTxnIndexes[uniqueTxnIndexes.length - 1];

      next[firstIdx] = {
        ...next[firstIdx],
        refund: 0,
        documentType: 'Sale',
        returnType: undefined,
      };
      next[lastIdx] = {
        ...next[lastIdx],
        saleAmount: 0,
        // Keep bank on the return settlement — clawbacks (−X) must net against
        // sale payouts (+X). Same-sign reprints are cleared below.
        documentType:
          String(next[lastIdx].documentType ?? '').trim() &&
          !/^sale$/i.test(String(next[lastIdx].documentType))
            ? next[lastIdx].documentType
            : 'Return',
      };
      for (const midIdx of uniqueTxnIndexes.slice(1, -1)) {
        next[midIdx] = {
          ...next[midIdx],
          saleAmount: 0,
          refund: 0,
          documentType: 'Payment',
          returnType: undefined,
        };
      }
    }

    // Sale settlement (refund=0) + return settlement that still stamps sale:
    // clear the mirrored sale on return rows so Sales aren't double-displayed.
    // Meesho may reprint a different Total Sale on the RTO/return NEFT than on
    // the later Cancelled/sale payout (e.g. 634 vs 674) — still clear it; the
    // sale-only row is the Sales source.
    const saleOnly = indexes.filter((index) => {
      const row = next[index];
      return (
        Math.abs(Number(row.saleAmount) || 0) > 0 &&
        Math.abs(Number(row.refund) || 0) <= 0
      );
    });
    if (saleOnly.length) {
      for (const index of indexes) {
        const row = next[index];
        const sale = Math.abs(Number(row.saleAmount) || 0);
        const refund = Math.abs(Number(row.refund) || 0);
        if (sale <= 0 || refund <= 0) continue;
        next[index] = { ...row, saleAmount: 0 };
      }
    }

    // Identical Final Settlement / fee / return totals reprinted across distinct txns.
    clearMeeshoIdenticalAmountStamps(
      next,
      indexes,
      (row) =>
        Number(row.bankSettlementValue ?? row.finalSettlementAmount) || 0,
      (row) => ({
        ...row,
        bankSettlementValue: 0,
        finalSettlementAmount: 0,
      }),
    );
    clearMeeshoIdenticalAmountStamps(
      next,
      indexes,
      (row) => Number(row.refund) || 0,
      (row) => ({ ...row, refund: 0 }),
    );
    clearMeeshoIdenticalAmountStamps(
      next,
      indexes,
      (row) => Number(row.marketplaceFee) || 0,
      (row) => ({ ...row, marketplaceFee: 0 }),
    );
    clearMeeshoIdenticalAmountStamps(
      next,
      indexes,
      (row) => Number(row.commission) || 0,
      (row) => ({ ...row, commission: 0 }),
    );
    clearMeeshoIdenticalAmountStamps(
      next,
      indexes,
      (row) => Number(row.tcs) || 0,
      (row) => ({ ...row, tcs: 0 }),
    );
    clearMeeshoIdenticalAmountStamps(
      next,
      indexes,
      (row) => Number(row.tds) || 0,
      (row) => ({ ...row, tds: 0 }),
    );
    clearMeeshoIdenticalFeeComponentStamps(next, indexes);
  }

  return next;
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
