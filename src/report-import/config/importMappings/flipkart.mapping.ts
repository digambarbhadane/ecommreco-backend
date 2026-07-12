import { MarketplaceImportMapping } from './types';

export const flipkartImportMapping: MarketplaceImportMapping = {
  key: 'flipkart',
  displayName: 'Flipkart',
  gstin: {
    databaseField: 'sellerGSTIN',
    excelColumns: [
      'Seller GSTIN',
      'Seller Gstin',
      'SELLER GSTIN',
      'seller_gstin',
      'Seller GSTIN Number',
      'Supplier GSTIN',
      'GSTIN of Seller',
      'Gstin of Seller',
      'GST Registration No',
      'GSTIN/UIN',
      'GST NO',
      'GST NO = Seller GSTIN',
      'GST NO = Seller Gstin',
      'GST NO= Seller GSTIN',
      'GST NO= Seller Gstin',
      'GSTIN',
      'Gstin',
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
