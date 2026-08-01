export type MeeshoPaymentImportMeta = {
  sellerId: string;
  importId: string;
  marketplace: 'meesho';
  importedAt: Date;
  gstId?: string;
  gstin?: string;
  reportMonth?: string;
  uploadedFileName: string;
  sheetName: string;
};
