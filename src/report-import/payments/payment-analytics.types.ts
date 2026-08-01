import type { FlipkartPaymentReportDocument } from './flipkart/schemas/flipkart-payment-report.schema';
import type { MeeshoOrderPayments } from './meesho/schemas/order-payments.schema';
import { repairDateToIso } from '../../common/utils/repair-legacy-date.util';

/** Normalized payment row for analytics API responses. */
export type PaymentAnalyticsRow = {
  _id: string;
  source:
    | 'flipkart_payment_order_reports'
    | 'meesho_order_payments'
    | 'import_rows';
  orderId: string;
  orderItemId?: string;
  neftId?: string;
  neftType?: string;
  paymentDate?: string;
  bankSettlementValue?: number;
  saleAmount?: number;
  marketplaceFee?: number;
  commission?: number;
  refund?: number;
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
};

function toIsoDateString(value: unknown, reportMonth?: string): string | undefined {
  return repairDateToIso(value, reportMonth);
}

function num(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function sumNums(...values: unknown[]): number | undefined {
  let total = 0;
  let any = false;
  for (const value of values) {
    const n = num(value);
    if (n == null) continue;
    total += n;
    any = true;
  }
  return any ? total : undefined;
}

export function mapFlipkartPaymentToAnalyticsRow(
  doc: FlipkartPaymentReportDocument & { _id?: { toString(): string } | string },
): PaymentAnalyticsRow {
  const id =
    typeof doc._id === 'object' && doc._id !== null && 'toString' in doc._id
      ? doc._id.toString()
      : String(doc._id ?? '');

  const saleAmount =
    num(doc.saleAmount) ??
    num((doc as { saleAmountSummary?: number }).saleAmountSummary);
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
    commission: num(doc.commission),
    refund: num(doc.refund),
    sellerSku: doc.sellerSku,
    quantity: num(doc.quantity),
    invoiceId: doc.invoiceId,
    invoiceDate: toIsoDateString(doc.invoiceDate, doc.reportMonth),
    gstin: doc.gstin,
    marketplace: doc.marketplace || 'flipkart',
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

  const marketplaceFee = sumNums(
    doc.fixedFeeInclGst,
    doc.warehousingFeeInclGst,
    doc.shippingChargeInclGst,
    doc.returnShippingChargeInclGst,
    doc.meeshoGoldPlatformFeeInclGst,
    doc.meeshoMallPlatformFeeInclGst,
    doc.returnPremiumInclGst,
    doc.returnPremiumReturnInclGst,
    doc.netOtherSupportServiceChargesExclGst,
    doc.gstOnNetOtherSupportServiceCharges,
  );

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
    marketplaceFee,
    commission: num(doc.meeshoCommissionInclGst),
    refund: num(doc.totalSaleReturnAmountInclShippingGst),
    sellerSku: doc.supplierSku,
    quantity: num(doc.quantity),
    gstin: doc.gstin,
    marketplace: 'meesho',
    reportMonth: doc.reportMonth,
  };
}

export function mapImportRowToPaymentAnalyticsRow(
  row: {
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
    invoiceAmount?: number;
    reportMonth?: string;
    skuID?: string;
    quantity?: number;
    saleAmount?: number;
    marketplaceFee?: number;
    commission?: number;
    refund?: number;
  },
): PaymentAnalyticsRow {
  const id =
    typeof row._id === 'object' && row._id !== null && 'toString' in row._id
      ? row._id.toString()
      : String(row._id ?? '');

  return {
    _id: id,
    source: 'import_rows',
    orderId: String(row.orderID ?? ''),
    paymentDate: toIsoDateString(row.paymentDate, row.reportMonth),
    paymentMode: row.paymentMode,
    bankSettlementValue: num(row.finalSettlementAmount),
    finalSettlementAmount: num(row.finalSettlementAmount),
    transactionId: row.transactionId,
    neftId: row.transactionId,
    gstin: row.gstin,
    marketplace: String(row.marketplace ?? ''),
    documentType: row.documentType,
    invoiceDate: toIsoDateString(row.invoiceDate, row.reportMonth),
    invoiceAmount: num(row.invoiceAmount),
    reportMonth: row.reportMonth,
    sellerSku: row.skuID,
    quantity: num(row.quantity),
    saleAmount: num(row.saleAmount) ?? num(row.invoiceAmount),
    marketplaceFee: num(row.marketplaceFee),
    commission: num(row.commission),
    refund: num(row.refund),
  };
}
