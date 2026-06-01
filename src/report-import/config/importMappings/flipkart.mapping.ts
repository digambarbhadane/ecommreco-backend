import { MarketplaceImportMapping } from './types';

export const flipkartImportMapping: MarketplaceImportMapping = {
  key: 'flipkart',
  displayName: 'Flipkart',
  gstin: {
    databaseField: 'sellerGSTIN',
    excelColumns: [
      'Seller GSTIN',
      'GST NO',
      'GST NO = Seller GSTIN',
      'GST NO= Seller GSTIN',
      'GSTIN',
    ],
  },
  orderId: {
    databaseField: 'orderID',
    excelColumns: ['Order ID'],
  },
  sku: {
    databaseField: 'skuID',
    excelColumns: ['SKU ID', 'SKU'],
  },
};
