import { meeshoPaymentFieldMappings } from '../config/importMappings/meesho-payment.mapping';
import { NormalizedImportRow } from './mapping.service';

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

const INSERT_BATCH_SIZE = 5000;

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
  },
) =>
  rows.map((row) => ({
    uploadId: meta.uploadId,
    sellerId: meta.sellerId,
    gstin: meta.gstin,
    marketplace: meta.marketplace,
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
): Promise<void> {
  if (!rows.length) return;
  const docs = toImportRowDocuments(rows, meta);
  let saved = 0;
  for (let i = 0; i < docs.length; i += INSERT_BATCH_SIZE) {
    const batch = docs.slice(i, i + INSERT_BATCH_SIZE);
    await rowModel.insertMany(batch, { ordered: false });
    saved += batch.length;
    if (onBatchSaved) {
      await onBatchSaved(saved);
    }
  }
}
