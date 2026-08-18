/** Ignore rounding noise between -1 and 1 (inclusive). */
export const PAYMENT_DIFFERENCE_TOLERANCE = 1;
export const PAYMENT_DUE_WINDOW_DAYS = 30;

export type PaymentAmountFields = {
  saleAmount?: number;
  invoiceAmount?: number;
  refund?: number;
  bankSettlementValue?: number;
  finalSettlementAmount?: number;
  commission?: number;
  invoiceDate?: string;
  paymentDate?: string;
  orderId?: string;
};

export function getGrossSales(row: PaymentAmountFields): number {
  return Number(row.saleAmount ?? row.invoiceAmount ?? 0) || 0;
}

export function getReturnAmount(row: PaymentAmountFields): number {
  return Number(row.refund ?? 0) || 0;
}

export function getNetSales(row: PaymentAmountFields): number {
  return getGrossSales(row) - getReturnAmount(row);
}

export function getBankPayout(row: PaymentAmountFields): number {
  return Number(row.bankSettlementValue ?? row.finalSettlementAmount ?? 0) || 0;
}

export function getCommissionAmount(row: PaymentAmountFields): number {
  return Number(row.commission ?? 0) || 0;
}

export function getPaymentDifference(row: PaymentAmountFields): number {
  return getNetSales(row) - getBankPayout(row) - getCommissionAmount(row);
}

export function isIgnoredPaymentDifference(difference: number): boolean {
  return Math.abs(difference) <= PAYMENT_DIFFERENCE_TOLERANCE;
}

export function isPaymentDispute(row: PaymentAmountFields): boolean {
  return !isIgnoredPaymentDifference(getPaymentDifference(row));
}

function getOrderDate(row: PaymentAmountFields): string {
  return String(row.invoiceDate || row.paymentDate || '').trim();
}

export function getInvoiceAgeDays(
  row: PaymentAmountFields,
  nowMs: number = Date.now(),
): number | null {
  const raw = getOrderDate(row);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor((nowMs - parsed) / 86_400_000);
}

export function isPaymentDue(row: PaymentAmountFields, nowMs?: number): boolean {
  const age = getInvoiceAgeDays(row, nowMs);
  return age != null && age < PAYMENT_DUE_WINDOW_DAYS;
}

export function isPaymentOverdue(row: PaymentAmountFields, nowMs?: number): boolean {
  const age = getInvoiceAgeDays(row, nowMs);
  return age != null && age >= PAYMENT_DUE_WINDOW_DAYS;
}

export type PaymentStatusFilter = 'due' | 'overdue' | 'settled' | 'dispute';

export function matchesPaymentStatus(
  row: PaymentAmountFields,
  status?: string,
  nowMs: number = Date.now(),
): boolean {
  const key = String(status ?? '').trim().toLowerCase();
  if (!key) return true;
  if (key === 'dispute') return isPaymentDispute(row);
  if (key === 'settled') return !isPaymentDispute(row);
  if (key === 'due') return isPaymentDue(row, nowMs);
  if (key === 'overdue') return isPaymentOverdue(row, nowMs);
  return true;
}

export function summarizePaymentRecords(rows: PaymentAmountFields[]) {
  const nowMs = Date.now();
  const orderIds = new Set<string>();
  let salesRecords = 0;
  let returnRecords = 0;
  let dueCount = 0;
  let overdueCount = 0;
  let settledCount = 0;
  let disputeCount = 0;

  for (const row of rows) {
    const orderId = String(row.orderId ?? '').trim();
    if (orderId) orderIds.add(orderId);
    if (getGrossSales(row) > 0) salesRecords += 1;
    if (getReturnAmount(row) > 0) returnRecords += 1;

    if (isPaymentDispute(row)) disputeCount += 1;
    else settledCount += 1;

    if (isPaymentDue(row, nowMs)) dueCount += 1;
    else if (isPaymentOverdue(row, nowMs)) overdueCount += 1;
  }

  return {
    salesRecords,
    returnRecords,
    totalOrderRecords: orderIds.size || rows.length,
    dueCount,
    overdueCount,
    settledCount,
    disputeCount,
  };
}
