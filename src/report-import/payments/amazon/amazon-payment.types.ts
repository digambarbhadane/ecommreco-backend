export type AmazonPaymentMappedRow = {
  settlementId: string;
  depositDate: Date | string;
  transactionType: string;
  orderId: string;
  amountDescription: string;
  amount: number;
  rowKey: string;
  sourceRowNumber: number;
};

export type AmazonPaymentInsertPayload = AmazonPaymentMappedRow & {
  marketplace: string;
  sellerId: string;
  gstId?: string;
  gstin?: string;
  reportMonth?: string;
  uploadId: string;
  uploadedFileName: string;
  sheetName: string;
  uploadedAt: Date;
};

