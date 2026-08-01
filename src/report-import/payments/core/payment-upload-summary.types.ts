export type PaymentValidationError = {
  rowNumber: number;
  column: string;
  reason: string;
};

export type PaymentUploadSummary = {
  totalRows: number;
  parsedRows: number;
  insertedRows: number;
  updatedRows: number;
  skippedRows: number;
  duplicateRows: number;
  invalidRows: number;
  /** Lines merged into another Order ID by summing amounts (not dropped). */
  mergedDuplicateRows?: number;
  validationErrors: PaymentValidationError[];
  processingTimeMs: number;
  sheetName?: string;
};

export type PaymentDuplicateStrategy = 'update' | 'skip';

export type PaymentUploadContext = {
  sellerId: string;
  gstId?: string;
  gstin?: string;
  marketplace: string;
  reportMonth?: string;
  uploadId: string;
  uploadedFileName: string;
  duplicateStrategy?: PaymentDuplicateStrategy;
};
