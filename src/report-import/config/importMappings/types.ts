export type MarketplaceImportFieldMapping = {
  databaseField: string;
  excelColumns: string[];
};

export type MarketplaceImportMapping = {
  key: string;
  displayName: string;
  gstin: MarketplaceImportFieldMapping;
  orderId?: MarketplaceImportFieldMapping;
  sku?: MarketplaceImportFieldMapping;
};
