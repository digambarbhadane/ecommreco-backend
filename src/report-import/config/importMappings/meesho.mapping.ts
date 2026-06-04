import { MarketplaceImportMapping } from './types';

export const meeshoImportMapping: MarketplaceImportMapping = {
  key: 'meesho',
  displayName: 'Meesho',
  gstin: {
    databaseField: 'sellerGSTIN',
    excelColumns: ['gstin', 'GST NO', 'Seller GSTIN'],
  },
  orderId: {
    databaseField: 'orderID',
    excelColumns: [
      'sub_order_num',
      'sub order num',
      'Sub Order No',
      'Order ID',
      'order number',
    ],
  },
};
