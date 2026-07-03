import { MarketplaceImportMapping } from './types';

export const flipkartImportMapping: MarketplaceImportMapping = {
  key: 'flipkart',
  displayName: 'Flipkart',
  gstin: {
    databaseField: 'sellerGSTIN',
    excelColumns: [
      'Seller GSTIN',
      'Seller GSTIN Number',
      'Supplier GSTIN',
      'GSTIN of Seller',
      'GST Registration No',
      'GSTIN/UIN',
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
