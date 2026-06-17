import { MarketplaceImportMapping } from './types';

export const myntraImportMapping: MarketplaceImportMapping = {
  key: 'myntra',
  displayName: 'Myntra',
  gstin: {
    databaseField: 'sellerGSTIN',
    excelColumns: ['seller_gstin', 'tax_seller_gstin', 'GST NO'],
  },
  orderId: {
    databaseField: 'orderID',
    excelColumns: ['order_id', 'order_release_id', 'Sale_Order_Code'],
  },
};
