export type AmazonTransactionCategory =
  | 'sale'
  | 'shipment'
  | 'refund'
  | 'return'
  | 'cancellation'
  | 'other';

/** Classify Amazon MTR Transaction Type for import summary buckets. */
export function classifyAmazonTransactionType(
  documentType: string,
  voucherType?: string,
): AmazonTransactionCategory {
  const raw = `${documentType ?? ''} ${voucherType ?? ''}`.trim().toUpperCase();
  if (!raw) return 'other';
  if (/\bCANCEL/.test(raw)) return 'cancellation';
  if (/\bREFUND/.test(raw)) return 'refund';
  if (/\bRETURN\b/.test(raw) || /\bRTO\b/.test(raw)) return 'return';
  if (/\bSHIPMENT\b/.test(raw)) return 'shipment';
  if (/\bSALE\b/.test(raw) || /\bDELIVER/.test(raw)) return 'sale';
  return 'other';
}

export function isAmazonReturnCategory(
  category: AmazonTransactionCategory,
): boolean {
  return (
    category === 'refund' ||
    category === 'return' ||
    category === 'cancellation'
  );
}

export function isAmazonSaleCategory(category: AmazonTransactionCategory): boolean {
  return category === 'sale' || category === 'shipment' || category === 'other';
}

export function isAmazonCancellationTransaction(
  documentType?: string | null,
  voucherType?: string | null,
): boolean {
  const raw = `${documentType ?? ''} ${voucherType ?? ''}`.trim().toUpperCase();
  return /\bCANCEL/.test(raw);
}

/** True when the row came from Amazon MTR B2B (tagged at import or inferred from buyer GSTIN). */
export function isAmazonB2bMtrRow(
  mtrSource?: string | null,
  customerGstNo?: string | null,
): boolean {
  if (mtrSource === 'b2b') return true;
  if (mtrSource === 'b2c') return false;
  return Boolean(String(customerGstNo ?? '').trim());
}

/** B2B Cancel rows are not treated as returns in Amazon reconciliation. */
export function isAmazonB2bCancelRow(
  mtrSource?: string | null,
  documentType?: string | null,
  voucherType?: string | null,
  customerGstNo?: string | null,
): boolean {
  return (
    isAmazonB2bMtrRow(mtrSource, customerGstNo) &&
    isAmazonCancellationTransaction(documentType, voucherType)
  );
}

/** MTR B2B/B2C rows with Transaction Type Cancel are not imported. */
export function shouldSkipAmazonMtrImportRow(
  documentType?: string | null,
  voucherType?: string | null,
): boolean {
  return isAmazonCancellationTransaction(documentType, voucherType);
}

/** Refund/Return rows that belong in Amazon return totals (Cancel is excluded). */
export function isAmazonCountableReturnTransaction(
  documentType?: string | null,
  voucherType?: string | null,
  mtrSource?: string | null,
  customerGstNo?: string | null,
): boolean {
  if (isAmazonCancellationTransaction(documentType, voucherType)) {
    return false;
  }
  if (isAmazonB2bCancelRow(mtrSource, documentType, voucherType, customerGstNo)) {
    return false;
  }
  const raw = `${documentType ?? ''} ${voucherType ?? ''}`.trim().toUpperCase();
  if (!raw) return false;
  if (/\bREFUND/.test(raw)) return true;
  if (/\bRETURN\b/.test(raw) || /\bRTO\b/.test(raw)) return true;
  return false;
}

export type AmazonSummaryBucket =
  | 'shipment'
  | 'customer_return'
  | 'rto'
  | 'na'
  | 'cancel'
  | 'b2b_cancel'
  | 'other';

/**
 * Mirrors Amazon summary aggregation buckets (see workflow-month-summary.aggregation.ts).
 * NA = Refund/Return rows that are not customer_return or rto.
 * Cancel (B2B and B2C) is excluded from returns and NA.
 */
export function classifyAmazonImportRowForSummary(row: {
  documentType?: string | null;
  voucherType?: string | null;
  amazonMtrSource?: string | null;
  customerGstNo?: string | null;
  amazonReturnSubType?: string | null;
}): AmazonSummaryBucket {
  if (isAmazonCancellationTransaction(row.documentType, row.voucherType)) {
    if (
      isAmazonB2bMtrRow(row.amazonMtrSource, row.customerGstNo)
    ) {
      return 'b2b_cancel';
    }
    return 'cancel';
  }

  if (
    isAmazonB2bCancelRow(
      row.amazonMtrSource,
      row.documentType,
      row.voucherType,
      row.customerGstNo,
    )
  ) {
    return 'b2b_cancel';
  }

  if (
    !isAmazonCountableReturnTransaction(
      row.documentType,
      row.voucherType,
      row.amazonMtrSource,
      row.customerGstNo,
    )
  ) {
    const category = classifyAmazonTransactionType(
      row.documentType ?? '',
      row.voucherType ?? undefined,
    );
    return category === 'shipment' ? 'shipment' : 'other';
  }

  if (row.amazonReturnSubType === 'customer_return') {
    return 'customer_return';
  }
  if (row.amazonReturnSubType === 'rto') {
    return 'rto';
  }
  return 'na';
}

export type AmazonImportDebugRow = {
  bucket: AmazonSummaryBucket;
  orderID?: string;
  documentType?: string;
  voucherType?: string;
  amazonMtrSource?: string;
  customerGstNo?: string;
  amazonReturnSubType?: string;
  typeOfReturn?: string;
  returnReason?: string;
  quantity?: number;
  invoiceAmount?: number;
  taxableAmount?: number;
  igstAmount?: number;
  uploadId?: string;
};

export function buildAmazonImportDebugReport(
  rows: Array<Record<string, unknown>>,
): {
  totalsByBucket: Record<AmazonSummaryBucket, number>;
  rows: AmazonImportDebugRow[];
} {
  const totalsByBucket: Record<AmazonSummaryBucket, number> = {
    shipment: 0,
    customer_return: 0,
    rto: 0,
    na: 0,
    cancel: 0,
    b2b_cancel: 0,
    other: 0,
  };

  const classified: AmazonImportDebugRow[] = rows.map((row) => {
    const bucket = classifyAmazonImportRowForSummary({
      documentType: row.documentType as string | undefined,
      voucherType: row.voucherType as string | undefined,
      amazonMtrSource: row.amazonMtrSource as string | undefined,
      customerGstNo: row.customerGstNo as string | undefined,
      amazonReturnSubType: row.amazonReturnSubType as string | undefined,
    });
    totalsByBucket[bucket] += 1;
    return {
      bucket,
      orderID: row.orderID as string | undefined,
      documentType: row.documentType as string | undefined,
      voucherType: row.voucherType as string | undefined,
      amazonMtrSource: row.amazonMtrSource as string | undefined,
      customerGstNo: row.customerGstNo as string | undefined,
      amazonReturnSubType: row.amazonReturnSubType as string | undefined,
      typeOfReturn: row.typeOfReturn as string | undefined,
      returnReason: row.returnReason as string | undefined,
      quantity: Number(row.quantity ?? 0),
      invoiceAmount: Number(row.invoiceAmount ?? 0),
      taxableAmount: Number(row.taxableAmount ?? 0),
      igstAmount: Number(row.igstAmount ?? 0),
      uploadId: row.uploadId as string | undefined,
    };
  });

  return { totalsByBucket, rows: classified };
}
