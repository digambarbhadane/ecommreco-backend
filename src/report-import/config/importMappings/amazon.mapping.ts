import { MarketplaceImportMapping } from './types';

export const amazonImportMapping: MarketplaceImportMapping = {
  key: 'amazon',
  displayName: 'Amazon',
  gstin: {
    databaseField: 'sellerGSTIN',
    excelColumns: [
      'Seller Gstin',
      'Seller GSTIN',
      'GST NO',
      'GST NO = Seller Gstin',
    ],
  },
  orderId: {
    databaseField: 'orderID',
    excelColumns: ['Order Id', 'Order ID'],
  },
  sku: {
    databaseField: 'skuID',
    excelColumns: ['Sku', 'SKU'],
  },
};
