/** Ignore rounding noise between -1 and 1 (inclusive). */
export const PAYMENT_DIFFERENCE_TOLERANCE = 1;
export const PAYMENT_DUE_WINDOW_DAYS = 30;

export type PaymentAmountFields = {
  saleAmount?: number;
  invoiceAmount?: number;
  refund?: number;
  bankSettlementValue?: number;
  finalSettlementAmount?: number;
  marketplaceFee?: number;
  commission?: number;
  invoiceDate?: string;
  paymentDate?: string;
  orderId?: string;
  orderID?: string;
  orderItemId?: string;
  sellerSku?: string;
  invoiceId?: string;
  /** Stable row id when present (GST Sale invoice de-dupe). */
  _id?: string;
  documentType?: string;
  /** Flipkart payment report return marker (Customer Return / RTO / etc.). */
  returnType?: string;
  /** True when amounts are already netted across an Order ID group. */
  isOrderGroup?: boolean;
  /** Precomputed Order ID lifecycle Difference. */
  orderPaymentDifference?: number;
  /**
   * Order-level: true when any NEFT/bank credit (&gt; 0) was received before
   * netting reversals.
   */
  hasReceivedBankPayment?: boolean;
  /** Marketplace slug / label (e.g. flipkart) — used for marketplace-scoped status rules. */
  marketplace?: string;
  /** Analytics row source collection (e.g. flipkart_payment_order_reports). */
  source?: string;
};

function signed(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function getGrossSales(row: PaymentAmountFields): number {
  return signed(row.saleAmount ?? row.invoiceAmount);
}

/**
 * Absolute return magnitude for Net Sales / lifecycle formulas.
 *
 * Flipkart often tags sale settlement NEFTs with returnType (Logistics /
 * Customer Return) while Refund (Rs.) stays 0 — those are still Sales.
 * Do NOT invent a return from saleAmount via returnType alone; that collapses
 * multi-Sale orders and double-counts when a sibling refund NEFT exists.
 * Returns come from an explicit refund amount or a Return document type.
 */
export function getReturnDeduction(row: PaymentAmountFields): number {
  const fromRefund = Math.abs(signed(row.refund));
  if (fromRefund > 0) return fromRefund;
  if (isReturnDocumentType(row.documentType)) {
    return Math.abs(getGrossSales(row));
  }
  return 0;
}

/** Signed return outflow for display (negative when a return exists). */
export function getReturnAmount(row: PaymentAmountFields): number {
  const deduction = getReturnDeduction(row);
  return deduction > 0 ? -deduction : 0;
}

/**
 * Gross sales on a single payment row / order group.
 * Order-level de-duplication of mirrored return-row sale amounts happens in
 * {@link aggregateOrderPaymentLifecycle} (Flipkart return NEFTs repeat saleAmountSummary).
 */
export function getLifecycleSales(row: PaymentAmountFields): number {
  return getGrossSales(row);
}

export function getNetSales(row: PaymentAmountFields): number {
  return getLifecycleSales(row) + getReturnAmount(row);
}

export function getBankPayout(row: PaymentAmountFields): number {
  return signed(row.bankSettlementValue ?? row.finalSettlementAmount);
}

export function getCommissionAmount(row: PaymentAmountFields): number {
  return signed(row.commission);
}

/**
 * Net marketplace fee impact for the row (signed).
 * Charges and reversals cancel when netted across the Order ID lifecycle.
 * Flipkart stores fee charges as negative values; reversals are positive.
 */
export function getMarketplaceFeesAmount(row: PaymentAmountFields): number {
  return signed(row.marketplaceFee) + signed(row.commission);
}

/** Expected payout = Net Sales + signed marketplace fee impact. */
export function getExpectedBankPayout(row: PaymentAmountFields): number {
  return getNetSales(row) + getMarketplaceFeesAmount(row);
}

/** Difference = Expected Bank Pay-out − Actual Bank Pay-out. */
export function getPaymentDifference(row: PaymentAmountFields): number {
  if (row.orderPaymentDifference != null) {
    return row.orderPaymentDifference;
  }
  return getOrderPaymentReconciliationDifference(row);
}

/**
 * Final order-level reconciliation Difference (Expected − Actual) before
 * display-only tolerance zeroing in {@link aggregateOrderPaymentLifecycle}.
 */
export function getOrderPaymentReconciliationDifference(
  row: PaymentAmountFields,
): number {
  return getExpectedBankPayout(row) - getBankPayout(row);
}

export function isIgnoredPaymentDifference(difference: number): boolean {
  return Math.abs(difference) <= PAYMENT_DIFFERENCE_TOLERANCE;
}

/**
 * Payment received = an actual bank settlement transaction exists for the order
 * (credit or debit/reversal). Zero/null bank is unpaid — Diff alone is not payment.
 * For order groups, prefer hasReceivedBankPayment (any non-zero NEFT before netting).
 */
export function hasPaymentReceived(row: PaymentAmountFields): boolean {
  if (typeof row.hasReceivedBankPayment === 'boolean') {
    return row.hasReceivedBankPayment;
  }
  return getBankPayout(row) !== 0;
}

/**
 * DISPUTE: payment received AND |difference| &gt; ±₹1.
 * Unpaid orders are Due/Overdue — never Dispute from difference alone.
 */
export function isPaymentDispute(row: PaymentAmountFields): boolean {
  if (!hasPaymentReceived(row)) return false;
  return !isIgnoredPaymentDifference(getPaymentDifference(row));
}

/**
 * Full return / return-only orders that net to ≈₹0 with no bank payout must not
 * be treated as Settled solely because Difference is within ±1.
 * Kept for callers; Settled now requires hasPaymentReceived instead
 * (except the Flipkart return-settlement rule below).
 */
export function isUnresolvedReturnSettlement(row: PaymentAmountFields): boolean {
  const sales = Math.abs(getGrossSales(row));
  const returns = getReturnDeduction(row);
  const bank = Math.abs(getBankPayout(row));
  if (bank > PAYMENT_DIFFERENCE_TOLERANCE) return false;
  if (returns <= PAYMENT_DIFFERENCE_TOLERANCE) return false;
  // Remaining sale value after return → not a full-return zero-settlement case.
  if (
    sales > PAYMENT_DIFFERENCE_TOLERANCE &&
    returns + PAYMENT_DIFFERENCE_TOLERANCE < sales
  ) {
    return false;
  }
  return true;
}

function isFlipkartMarketplaceRow(row: PaymentAmountFields): boolean {
  const marketplace = String(row.marketplace ?? '')
    .trim()
    .toLowerCase();
  if (marketplace.includes('flipkart')) return true;
  const source = String(row.source ?? '')
    .trim()
    .toLowerCase();
  return source === 'flipkart_payment_order_reports';
}

function isMyntraMarketplaceRow(row: PaymentAmountFields): boolean {
  const marketplace = String(row.marketplace ?? '')
    .trim()
    .toLowerCase();
  if (marketplace.includes('myntra')) return true;
  const source = String(row.source ?? '')
    .trim()
    .toLowerCase();
  if (source === 'myntra_pg_settlement_rows') return true;
  const doc = String(row.documentType ?? '')
    .trim()
    .toLowerCase();
  return doc === 'customer return' || doc === 'rto return';
}

/**
 * Flipkart-only completed return settlement:
 * Net Sales ≈ 0, aggregated bank payout ≈ 0, Difference within ±₹1,
 * and return magnitude fully offsets sales (existing return-settlement check).
 * Does not apply to Amazon / Myntra / Meesho.
 */
export function isFlipkartCompletedReturnSettlement(
  row: PaymentAmountFields,
): boolean {
  if (!isFlipkartMarketplaceRow(row)) return false;
  if (!isUnresolvedReturnSettlement(row)) return false;
  if (Math.abs(getNetSales(row)) > PAYMENT_DIFFERENCE_TOLERANCE) return false;
  if (Math.abs(getBankPayout(row)) > PAYMENT_DIFFERENCE_TOLERANCE) return false;
  if (!isIgnoredPaymentDifference(getPaymentDifference(row))) return false;
  return true;
}

/**
 * Myntra full offset reconciliation:
 * Net Sales / fee impact settle to ≈₹0, no bank payout movement, and Difference
 * is within tolerance. This means no outstanding payable remains.
 */
export function isMyntraCompletedZeroSettlement(
  row: PaymentAmountFields,
): boolean {
  if (!isMyntraMarketplaceRow(row)) return false;
  if (
    Math.abs(getExpectedBankPayout(row)) > PAYMENT_DIFFERENCE_TOLERANCE
  ) {
    return false;
  }
  if (Math.abs(getBankPayout(row)) > PAYMENT_DIFFERENCE_TOLERANCE) return false;
  if (!isIgnoredPaymentDifference(getPaymentDifference(row))) return false;
  return true;
}

/**
 * SETTLED: payment received AND |difference| ≤ ±₹1.
 * Diff alone (e.g. unpaid expected≠0, or zero-bank full return) is not Settled —
 * except Flipkart completed return settlements (Net Sales ≈ 0, bank ≈ 0).
 */
export function isPaymentSettled(row: PaymentAmountFields): boolean {
  if (hasPaymentReceived(row)) {
    return isIgnoredPaymentDifference(getPaymentDifference(row));
  }
  if (isFlipkartCompletedReturnSettlement(row)) return true;
  if (isMyntraCompletedZeroSettlement(row)) return true;
  return false;
}

function getOrderDate(row: PaymentAmountFields): string {
  return String(row.invoiceDate || row.paymentDate || '').trim();
}

export type PaymentReconciliationStatus = 'settled' | 'dispute';

/**
 * Synthetic row representing the complete Order ID financial lifecycle.
 * Used for order-level Settled/Dispute (and due/overdue) decisions.
 */
export function toOrderPaymentStatusRow(
  rows: PaymentAmountFields[],
): PaymentAmountFields {
  const lifecycle = aggregateOrderPaymentLifecycle(rows);
  const dates = rows
    .map((row) => getOrderDate(row))
    .filter(Boolean)
    .sort();
  const flipkart = rows.some((row) => isFlipkartMarketplaceRow(row));
  const myntra = rows.some((row) => isMyntraMarketplaceRow(row));
  return {
    isOrderGroup: true,
    saleAmount: lifecycle.sales,
    refund: lifecycle.returns,
    bankSettlementValue: lifecycle.bankPayout,
    marketplaceFee: lifecycle.marketplaceFees,
    commission: 0,
    invoiceDate: dates[0],
    paymentDate: dates[dates.length - 1],
    // Bind status to the same final Expected − Actual value shown in the table.
    orderPaymentDifference: getOrderPaymentReconciliationDifference({
      saleAmount: lifecycle.sales,
      refund: lifecycle.returns,
      bankSettlementValue: lifecycle.bankPayout,
      marketplaceFee: lifecycle.marketplaceFees,
      commission: 0,
    }),
    // Any non-zero bank settlement (credit or reversal) counts as payment received.
    hasReceivedBankPayment: rows.some((row) => getBankPayout(row) !== 0),
    ...(flipkart
      ? { marketplace: 'flipkart', source: 'flipkart_payment_order_reports' }
      : myntra
        ? { marketplace: 'myntra', source: 'myntra_pg_settlement_rows' }
        : {}),
  };
}

/** Order-level status from the complete Order ID lifecycle. */
export function getOrderReconciliationStatus(
  rows: PaymentAmountFields[],
): PaymentReconciliationStatus {
  return isPaymentSettled(toOrderPaymentStatusRow(rows)) ? 'settled' : 'dispute';
}

export function isOrderPaymentDispute(rows: PaymentAmountFields[]): boolean {
  return getOrderReconciliationStatus(rows) !== 'settled';
}

export type OrderPaymentDisplayStatus =
  | 'Settled'
  | 'Dispute'
  | 'Due'
  | 'Overdue'
  | '—';

/** Order-level status from the complete Order ID lifecycle (table / popup). */
export function resolveOrderPaymentDisplayStatus(
  rows: PaymentAmountFields[],
  nowMs?: number,
): OrderPaymentDisplayStatus {
  if (!rows.length) return '—';
  const statusRow = toOrderPaymentStatusRow(rows);
  if (isPaymentSettled(statusRow)) return 'Settled';
  if (isPaymentDispute(statusRow)) return 'Dispute';
  if (isPaymentDue(statusRow, nowMs)) return 'Due';
  if (isPaymentOverdue(statusRow, nowMs)) return 'Overdue';
  return '—';
}

export function getInvoiceAgeDays(
  row: PaymentAmountFields,
  nowMs: number = Date.now(),
): number | null {
  const raw = getOrderDate(row);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  // Calendar-day age (UTC) to avoid timezone shifting 29 ↔ 30.
  const invoice = new Date(parsed);
  const now = new Date(nowMs);
  const invoiceUtc = Date.UTC(
    invoice.getUTCFullYear(),
    invoice.getUTCMonth(),
    invoice.getUTCDate(),
  );
  const nowUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.floor((nowUtc - invoiceUtc) / 86_400_000);
}

/** DUE: no payment received AND (no invoice date OR age &lt; 30 days). */
export function isPaymentDue(
  row: PaymentAmountFields,
  nowMs?: number,
): boolean {
  if (hasPaymentReceived(row)) return false;
  if (isFlipkartCompletedReturnSettlement(row)) return false;
  if (isMyntraCompletedZeroSettlement(row)) return false;
  const age = getInvoiceAgeDays(row, nowMs);
  // Undated unpaid orders still need exactly one status bucket.
  if (age == null) return true;
  return age < PAYMENT_DUE_WINDOW_DAYS;
}

/** OVERDUE: no payment received AND invoice age ≥ 30 days. */
export function isPaymentOverdue(
  row: PaymentAmountFields,
  nowMs?: number,
): boolean {
  if (hasPaymentReceived(row)) return false;
  if (isFlipkartCompletedReturnSettlement(row)) return false;
  if (isMyntraCompletedZeroSettlement(row)) return false;
  const age = getInvoiceAgeDays(row, nowMs);
  return age != null && age >= PAYMENT_DUE_WINDOW_DAYS;
}

export type PaymentStatusFilter = 'due' | 'overdue' | 'settled' | 'dispute';

export function matchesPaymentStatus(
  row: PaymentAmountFields,
  status?: string,
  nowMs: number = Date.now(),
): boolean {
  const key = String(status ?? '')
    .trim()
    .toLowerCase();
  if (!key) return true;
  if (key === 'dispute') return isPaymentDispute(row);
  if (key === 'settled') return isPaymentSettled(row);
  if (key === 'due') return isPaymentDue(row, nowMs);
  if (key === 'overdue') return isPaymentOverdue(row, nowMs);
  return true;
}

/**
 * Identity for payment-only sale de-dupe (no GST Sale rows present).
 * Prefer orderItemId (distinct Flipkart line items can share a SKU), then
 * invoice id, then SKU.
 */
function salesItemKey(row: PaymentAmountFields, index: number): string {
  const itemId = String(row.orderItemId ?? '').trim();
  if (itemId) return `item:${itemId}`;
  const invoiceId = String(row.invoiceId ?? '').trim();
  if (invoiceId) return `inv:${invoiceId}`;
  const sku = String(row.sellerSku ?? '')
    .trim()
    .toLowerCase();
  if (sku) return `sku:${sku}`;
  void index;
  return 'order:single';
}

/** Flipkart GST Sale / Sales import row (canonical sale invoice). */
function isFlipkartGstSaleRow(row: PaymentAmountFields): boolean {
  const doc = String(row.documentType ?? '')
    .trim()
    .toUpperCase();
  return doc === 'SALE' || doc === 'SALES';
}

/**
 * Sum original sales once per distinct sale identity.
 *
 * Flipkart payment NEFTs copy saleAmountSummary onto every settlement line for
 * the same item — those must not inflate Sales. When GST Sale invoices are
 * present, each Sale invoice contributes once (same SKU on two line items is
 * two sales). Otherwise fall back to per orderItemId / invoice / SKU max.
 */
export function aggregateDistinctItemSales(
  rows: PaymentAmountFields[],
): number {
  const gstSales = rows.filter((row) => isFlipkartGstSaleRow(row));
  if (gstSales.length > 0) {
    const bySaleDoc = new Map<string, number>();
    gstSales.forEach((row, index) => {
      const rowId = String(row._id ?? '').trim();
      const invoiceId = String(row.invoiceId ?? '').trim();
      const sku = String(row.sellerSku ?? '')
        .trim()
        .toLowerCase();
      // Prefer unique source row id so multi-SKU lines on one invoice stay distinct.
      const key =
        rowId ||
        (invoiceId && sku ? `inv:${invoiceId}::sku:${sku}` : '') ||
        invoiceId ||
        `gst-sale:${index}`;
      const amount = Math.max(getGrossSales(row), 0);
      bySaleDoc.set(key, Math.max(bySaleDoc.get(key) ?? 0, amount));
    });
    return [...bySaleDoc.values()].reduce((sum, n) => sum + n, 0);
  }

  const byItem = new Map<string, PaymentAmountFields[]>();
  rows.forEach((row, index) => {
    const key = salesItemKey(row, index);
    const bucket = byItem.get(key);
    if (bucket) bucket.push(row);
    else byItem.set(key, [row]);
  });

  let sales = 0;
  for (const itemRows of byItem.values()) {
    const nonRefund = itemRows.filter((row) => getReturnDeduction(row) <= 0);
    let amount = 0;
    if (nonRefund.length > 0) {
      amount = Math.max(...nonRefund.map((row) => getGrossSales(row)), 0);
    }
    // Meesho (and similar): sale amount may only appear on the return row.
    if (amount === 0) {
      amount = Math.max(...itemRows.map((row) => getGrossSales(row)), 0);
    }
    sales += amount;
  }
  return sales;
}

export function isFlipkartCreditNoteDocumentType(
  documentType?: string | null,
): boolean {
  const upper = String(documentType ?? '')
    .trim()
    .toUpperCase();
  return (
    /CREDIT\s*NOTE/.test(upper) ||
    (upper.includes('CREDIT') && !upper.includes('DEBIT'))
  );
}

export function isFlipkartDebitNoteDocumentType(
  documentType?: string | null,
): boolean {
  const upper = String(documentType ?? '')
    .trim()
    .toUpperCase();
  return (
    /DEBIT\s*NOTE/.test(upper) ||
    (upper.includes('DEBIT') && !upper.includes('CREDIT'))
  );
}

/** Flipkart GST "Return Cancellation" — added to Gross Sales (with Credit Notes). */
export function isFlipkartReturnCancellationDocumentType(
  documentType?: string | null,
): boolean {
  const upper = String(documentType ?? '')
    .trim()
    .toUpperCase();
  return /RETURN\s*CANCEL/.test(upper);
}

/** Flipkart GST "Sales Cancellation" / Cancellation — included with Return. */
export function isFlipkartSalesCancellationDocumentType(
  documentType?: string | null,
): boolean {
  const upper = String(documentType ?? '')
    .trim()
    .toUpperCase();
  if (!upper || isFlipkartReturnCancellationDocumentType(upper)) return false;
  return /CANCEL/.test(upper);
}

/** Flipkart payment reports mark returns via returnType even when refund is 0. */
export function isFlipkartReturnType(returnType?: string | null): boolean {
  const upper = String(returnType ?? '')
    .trim()
    .toUpperCase();
  if (!upper || upper === 'NA' || upper === 'N/A' || upper === '-') return false;
  // Same rule as flipkart_payment.repository returnsCount aggregation.
  return /RETURN|RTO|REFUND/.test(upper);
}

/** GST/import document types that represent returns / RTO / refunds. */
export function isReturnDocumentType(documentType?: string | null): boolean {
  const key = String(documentType ?? '')
    .trim()
    .toLowerCase();
  if (!key) return false;
  if (key.includes('credit') || key.includes('debit')) return false;
  return (
    key.includes('return') ||
    key.includes('rto') ||
    key.includes('refund')
  );
}

/**
 * True when the payment analytics row is a return/RTO/refund record.
 * Uses explicit refund amount or Return document type (not returnType alone).
 */
export function isPaymentReturnRecord(row: PaymentAmountFields): boolean {
  return getReturnDeduction(row) > 0;
}

function isFlipkartNoteRow(row: PaymentAmountFields): boolean {
  return (
    isFlipkartCreditNoteDocumentType(row.documentType) ||
    isFlipkartDebitNoteDocumentType(row.documentType) ||
    isFlipkartReturnCancellationDocumentType(row.documentType) ||
    isFlipkartSalesCancellationDocumentType(row.documentType)
  );
}

/**
 * Flipkart GST Return / RTO import row (canonical line-item return document).
 * Excludes Return Cancellation notes.
 */
function isFlipkartGstReturnAnalyticsRow(row: PaymentAmountFields): boolean {
  if (String(row.source ?? '') !== 'import_rows') return false;
  if (!isReturnDocumentType(row.documentType)) return false;
  if (isFlipkartReturnCancellationDocumentType(row.documentType)) return false;
  return true;
}

/**
 * Payment-report return NEFTs often roll many GST line returns into one refund.
 * When GST Return documents are present, they are the return amount source —
 * skip payment-report refund so Returns are not double-counted.
 */
function shouldSkipPaymentReportReturnAmount(
  row: PaymentAmountFields,
  hasGstReturns: boolean,
): boolean {
  if (!hasGstReturns) return false;
  if (String(row.source ?? '') !== 'flipkart_payment_order_reports') return false;
  return getReturnDeduction(row) > 0;
}

/** Aggregate complete Order ID lifecycle across all related payment rows. */
export function aggregateOrderPaymentLifecycle<T extends PaymentAmountFields>(
  rows: T[],
) {
  const noteRows = rows.filter((row) => isFlipkartNoteRow(row));
  const baseRows = rows.filter((row) => !isFlipkartNoteRow(row));
  const creditNoteRows = noteRows.filter((row) =>
    isFlipkartCreditNoteDocumentType(row.documentType),
  );
  const debitNoteRows = noteRows.filter((row) =>
    isFlipkartDebitNoteDocumentType(row.documentType),
  );
  const returnCancellationRows = noteRows.filter((row) =>
    isFlipkartReturnCancellationDocumentType(row.documentType),
  );
  const salesCancellationRows = noteRows.filter((row) =>
    isFlipkartSalesCancellationDocumentType(row.documentType),
  );

  const hasGstReturns = baseRows.some((row) =>
    isFlipkartGstReturnAnalyticsRow(row),
  );

  const originalSales = aggregateDistinctItemSales(baseRows);
  // Flipkart Credit Notes + Return Cancellation → Gross Sales.
  const creditNotes = creditNoteRows.reduce(
    (sum, row) => sum + Math.abs(getGrossSales(row) || signed(row.invoiceAmount)),
    0,
  );
  const returnCancellations = returnCancellationRows.reduce(
    (sum, row) =>
      sum + Math.abs(getGrossSales(row) || signed(row.invoiceAmount)),
    0,
  );
  const originalReturns = baseRows.reduce((sum, row) => {
    if (shouldSkipPaymentReportReturnAmount(row, hasGstReturns)) return sum;
    return sum + getReturnAmount(row);
  }, 0);
  // Flipkart Debit Notes are stored negative in import_rows; keep as return outflow.
  const debitNotes = debitNoteRows.reduce((sum, row) => {
    if (getReturnDeduction(row) > 0) return sum + getReturnAmount(row);
    const amount = signed(row.invoiceAmount ?? row.saleAmount);
    return sum + (amount <= 0 ? amount : -Math.abs(amount));
  }, 0);
  // Sales Cancellation → Return side (negative outflow).
  const salesCancellations = salesCancellationRows.reduce((sum, row) => {
    if (getReturnDeduction(row) > 0) return sum + getReturnAmount(row);
    const amount = signed(row.invoiceAmount ?? row.saleAmount);
    return sum + (amount <= 0 ? amount : -Math.abs(amount));
  }, 0);

  const sales = originalSales + creditNotes + returnCancellations;
  const returns = originalReturns + debitNotes + salesCancellations;
  const netSales = sales + returns;
  // Notes/cancellations must not affect fee/bank aggregates (amounts are zero on those rows).
  const marketplaceFees = baseRows.reduce(
    (sum, row) => sum + getMarketplaceFeesAmount(row),
    0,
  );
  const bankPayout = baseRows.reduce((sum, row) => sum + getBankPayout(row), 0);
  const expectedBankPayout = netSales + marketplaceFees;
  const difference = expectedBankPayout - bankPayout;

  return {
    originalSales,
    creditNotes,
    returnCancellations,
    sales,
    originalReturns,
    debitNotes,
    salesCancellations,
    returns,
    netSales,
    marketplaceFees,
    bankPayout,
    expectedBankPayout,
    difference: isIgnoredPaymentDifference(difference) ? 0 : difference,
  };
}

/** Column totals for Order Wise Payments (one lifecycle sum per Order ID). */
export type OrderWisePaymentColumnTotals = {
  sales: number;
  returns: number;
  netSales: number;
  marketplaceFees: number;
  bankPayout: number;
  difference: number;
};

/**
 * Sum the same Order ID values shown in the Order Wise Payments table
 * (Sales / Return / Net Sales / Marketplace Fees / Bank Payout / Difference).
 */
export function sumOrderWisePaymentColumnTotals<T extends PaymentAmountFields>(
  rows: T[],
): OrderWisePaymentColumnTotals {
  const byOrder = new Map<string, T[]>();
  let orphanSeq = 0;
  for (const row of rows) {
    const orderId = String(row.orderId || row.orderID || '').trim();
    const key = orderId || `__row_${orphanSeq++}`;
    const bucket = byOrder.get(key);
    if (bucket) bucket.push(row);
    else byOrder.set(key, [row]);
  }

  const totals: OrderWisePaymentColumnTotals = {
    sales: 0,
    returns: 0,
    netSales: 0,
    marketplaceFees: 0,
    bankPayout: 0,
    difference: 0,
  };

  for (const orderRows of byOrder.values()) {
    const lifecycle = aggregateOrderPaymentLifecycle(orderRows);
    totals.sales += lifecycle.sales;
    totals.returns += lifecycle.returns;
    totals.netSales += lifecycle.netSales;
    totals.marketplaceFees += lifecycle.marketplaceFees;
    totals.bankPayout += lifecycle.bankPayout;
    totals.difference += lifecycle.difference;
  }

  return totals;
}

export function summarizePaymentRecords(rows: PaymentAmountFields[]) {
  const nowMs = Date.now();
  const byOrder = new Map<string, PaymentAmountFields[]>();
  let orphanSeq = 0;
  let salesRecords = 0;
  let returnRecords = 0;

  for (const row of rows) {
    const orderId = String(row.orderId || row.orderID || '').trim();
    const key = orderId || `__row_${orphanSeq++}`;
    const bucket = byOrder.get(key);
    if (bucket) bucket.push(row);
    else byOrder.set(key, [row]);

    if (isFlipkartNoteRow(row)) continue;
    // Return Records: explicit refund or Return document type.
    if (isPaymentReturnRecord(row)) returnRecords += 1;
    // Sales Records: positive sale with no refund field (includes Flipkart sale
    // NEFTs that carry returnType while Refund is 0).
    if (Math.abs(signed(row.refund)) <= 0 && getGrossSales(row) > 0) {
      salesRecords += 1;
    }
  }

  let dueCount = 0;
  let overdueCount = 0;
  let settledCount = 0;
  let disputeCount = 0;
  let dueNetSales = 0;
  let overdueNetSales = 0;
  let settledNetSales = 0;
  let disputeNetSales = 0;

  for (const orderRows of byOrder.values()) {
    const statusRow = toOrderPaymentStatusRow(orderRows);
    const netSales = aggregateOrderPaymentLifecycle(orderRows).netSales;
    if (isPaymentSettled(statusRow)) {
      settledCount += 1;
      settledNetSales += netSales;
    } else if (isPaymentDispute(statusRow)) {
      disputeCount += 1;
      disputeNetSales += netSales;
    } else if (isPaymentDue(statusRow, nowMs)) {
      dueCount += 1;
      dueNetSales += netSales;
    } else if (isPaymentOverdue(statusRow, nowMs)) {
      overdueCount += 1;
      overdueNetSales += netSales;
    }
  }

  return {
    salesRecords,
    returnRecords,
    totalOrderRecords: byOrder.size,
    dueCount,
    overdueCount,
    settledCount,
    disputeCount,
    dueNetSales,
    overdueNetSales,
    settledNetSales,
    disputeNetSales,
  };
}
