import { MarketplaceImportMapping } from './types';

export const myntraImportMapping: MarketplaceImportMapping = {
  key: 'myntra',
  displayName: 'Myntra',
  gstin: {
    databaseField: 'sellerGSTIN',
    excelColumns: [
      'seller_gstin',
      'Seller Gstin',
      'tax_seller_gstin',
      'Tax Seller Gstin',
      'GST NO',
      'GSTIN',
    ],
  },
  orderId: {
    databaseField: 'orderID',
    excelColumns: [
      'order_id',
      'Order ID',
      'Order Id',
      'Sale_Order_Code',
      'sale_order_code',
      'order_release_id',
    ],
  },
  sku: {
    databaseField: 'skuID',
    excelColumns: ['seller_sku_code', 'seller sku code'],
  },
};
