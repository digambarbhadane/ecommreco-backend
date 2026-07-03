import { meeshoPaymentFieldMappings } from '../config/importMappings/meesho-payment.mapping';
import { NormalizedImportRow } from './mapping.service';
import { yieldToEventLoop } from '../utils/import-performance.util';

const pickMeeshoPaymentFields = (row: NormalizedImportRow) => {
  const payment: Record<string, unknown> = {};
  for (const { target } of meeshoPaymentFieldMappings) {
    const value = row[target];
    if (value !== undefined) {
      payment[target] = value;
    }
  }
  return payment;
};

const INSERT_BATCH_SIZE = 2000;

export type NormalizedRowWithMeta = NormalizedImportRow & {
  __sheetName: string;
  __rowNumber: number;
};

export const toImportRowDocuments = (
  rows: NormalizedRowWithMeta[],
  meta: {
    uploadId: string;
    sellerId: string;
    gstin: string;
    marketplace: string;
    reportMonth?: string;
  },
) =>
  rows.map((row) => ({
    uploadId: meta.uploadId,
    sellerId: meta.sellerId,
    gstin: meta.gstin,
    marketplace: meta.marketplace,
    reportMonth: meta.reportMonth,
    reportType: row.reportType,
    documentType: row.documentType,
    voucherType: row.voucherType,
    orderID: row.orderID,
    skuID: row.skuID,
    hsnCode: row.hsnCode,
    paymentMode: row.paymentMode,
    fulfilmentType: row.fulfilmentType,
    quantity: row.quantity,
    invoiceAmount: row.invoiceAmount,
    taxableAmount: row.taxableAmount,
    igstRate: row.igstRate,
    igstAmount: row.igstAmount,
    cgstRate: row.cgstRate,
    cgstAmount: row.cgstAmount,
    sgstRate: row.sgstRate,
    sgstAmount: row.sgstAmount,
    gstTransactionType: row.gstTransactionType,
    invoiceNo: row.invoiceNo,
    buyerInvoiceDate: row.buyerInvoiceDate,
    invoiceDate: row.invoiceDate,
    pincode: row.pincode,
    stateName: row.stateName,
    customerGstNo: row.customerGstNo,
    buyerName: row.buyerName,
    returnInvoiceDate: row.returnInvoiceDate,
    typeOfReturn: row.typeOfReturn,
    subType: row.subType,
    returnQty: row.returnQty,
    returnReason: row.returnReason,
    detailedReturnReason: row.detailedReturnReason,
    meeshoHasTcsReturn: row.meeshoHasTcsReturn,
    meeshoOrderStatus: row.meeshoOrderStatus,
    meeshoTcsReturnStatus: row.meeshoTcsReturnStatus,
    meeshoIsGrossSale: row.meeshoIsGrossSale,
    meeshoIsPreviousMonthReturn: row.meeshoIsPreviousMonthReturn,
    meeshoReturnSubType: row.meeshoReturnSubType,
    amazonReturnSubType: row.amazonReturnSubType,
    meeshoReturnInvoiceAmount: row.meeshoReturnInvoiceAmount,
    meeshoReturnTaxableAmount: row.meeshoReturnTaxableAmount,
    meeshoReturnIgstAmount: row.meeshoReturnIgstAmount,
    meeshoReturnCgstAmount: row.meeshoReturnCgstAmount,
    meeshoReturnSgstAmount: row.meeshoReturnSgstAmount,
    ...pickMeeshoPaymentFields(row),
  }));

export async function insertImportRowsInBatches(
  rowModel: {
    insertMany: (
      docs: unknown[],
      opts: { ordered: boolean },
    ) => Promise<unknown>;
  },
  rows: NormalizedRowWithMeta[],
  meta: Parameters<typeof toImportRowDocuments>[1],
  onBatchSaved?: (savedCount: number) => void | Promise<void>,
  options?: { progressThrottleMs?: number },
): Promise<void> {
  if (!rows.length) return;
  let saved = 0;
  let lastProgressAt = 0;
  const throttleMs = options?.progressThrottleMs ?? 1500;

  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const rowBatch = rows.slice(i, i + INSERT_BATCH_SIZE);
    const batch = toImportRowDocuments(rowBatch, meta);
    await rowModel.insertMany(batch, { ordered: false });
    saved += batch.length;

    const now = Date.now();
    const isLastBatch = i + INSERT_BATCH_SIZE >= rows.length;
    if (
      onBatchSaved &&
      (isLastBatch || now - lastProgressAt >= throttleMs)
    ) {
      lastProgressAt = now;
      await onBatchSaved(saved);
    }
    await yieldToEventLoop();
  }
}
