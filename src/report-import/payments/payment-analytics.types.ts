import type { FlipkartPaymentReportDocument } from './flipkart/schemas/flipkart-payment-report.schema';

/** Normalized payment row for analytics API responses. */
export type PaymentAnalyticsRow = {
  _id: string;
  source: 'flipkart_payment_reports' | 'import_rows';
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

export function mapFlipkartPaymentToAnalyticsRow(
  doc: FlipkartPaymentReportDocument & { _id?: { toString(): string } | string },
): PaymentAnalyticsRow {
  const id =
    typeof doc._id === 'object' && doc._id !== null && 'toString' in doc._id
      ? doc._id.toString()
      : String(doc._id ?? '');

  return {
    _id: id,
    source: 'flipkart_payment_reports',
    orderId: doc.orderId,
    orderItemId: doc.orderItemId,
    neftId: doc.neftId,
    neftType: doc.neftType,
    paymentDate: doc.paymentDate,
    bankSettlementValue: doc.bankSettlementValue,
    saleAmount: doc.saleAmount,
    marketplaceFee: doc.marketplaceFee,
    commission: doc.commission,
    refund: doc.refund,
    sellerSku: doc.sellerSku,
    quantity: doc.quantity,
    invoiceId: doc.invoiceId,
    invoiceDate: doc.invoiceDate,
    gstin: doc.gstin,
    marketplace: doc.marketplace,
    reportMonth: doc.reportMonth,
    finalSettlementAmount: doc.bankSettlementValue,
    transactionId: doc.neftId,
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
    paymentDate: row.paymentDate,
    paymentMode: row.paymentMode,
    bankSettlementValue: row.finalSettlementAmount,
    finalSettlementAmount: row.finalSettlementAmount,
    transactionId: row.transactionId,
    neftId: row.transactionId,
    gstin: row.gstin,
    marketplace: String(row.marketplace ?? ''),
    documentType: row.documentType,
    invoiceDate: row.invoiceDate,
    invoiceAmount: row.invoiceAmount,
    reportMonth: row.reportMonth,
  };
}
