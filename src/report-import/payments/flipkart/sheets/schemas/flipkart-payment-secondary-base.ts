export type FlipkartPaymentSecondaryMeta = {
  marketplace: string;
  sellerId: string;
  gstId?: string;
  gstin?: string;
  reportMonth?: string;
  reportType: string; // 'payment'
  uploadedFileName: string;
  sheetName: string;
  uploadId: string;
  uploadedAt: Date;
  /** stable unique key within sheet for upsert */
  rowKey: string;
};
