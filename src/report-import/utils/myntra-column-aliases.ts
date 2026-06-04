/** Excel header aliases for Myntra validation and mapping (display + snake_case). */

export const MYNTRA_GSTR_PACKED_HEADERS: string[][] = [
  ['seller_gstin', 'GST NO', 'GSTIN', 'Seller Gstin'],
  ['order_id', 'Order ID', 'Order Id'],
  ['payment_method', 'Payment Mode', 'Payment Method'],
  ['seller_type', 'Fulfilment Type', 'Fulfillment Type', 'Fulfilment Channel'],
  ['quantity', 'Quantity'],
  ['seller_price', 'Invoice Amount'],
  ['base_value', 'Taxable Amount', 'Taxable Value'],
  ['igst_rate', 'IGST Rate', 'Igst Rate'],
  ['igst_amt', 'IGST Amount', 'Igst Tax', 'Igst Amount'],
  ['cgst_rate', 'CGST Rate', 'Cgst Rate'],
  ['cgst_amt', 'CGST Amount', 'Cgst Tax', 'Cgst Amount'],
  ['sgst_rate', 'SGST Rate', 'Sgst Rate'],
  ['sgst_amt', 'SGST Amount', 'Sgst Tax', 'Sgst Amount'],
  ['customer_delivery_state_code', 'State Name', 'Ship To State'],
];

export const MYNTRA_MDIRECT_ORDERS_HEADERS: string[][] = [
  ['order_release_id', 'Order ID', 'Order Id', 'Order Release ID'],
  ['seller_sku_code', 'SKU ID', 'SKU', 'Sku'],
];

export const MYNTRA_SALES_REVENUE_HEADERS: string[][] = [
  ['Sale_Order_Code', 'sale_order_code', 'Order ID', 'Order Id'],
  ['Invoice_Number', 'invoice_number', 'Invoice No', 'Invoice Number'],
  ['Packing_Date', 'packing_date', 'Invoice Date'],
];

export const MYNTRA_GSTR_RTO_HEADERS: string[][] = [
  ['tax_seller_gstin', 'GST NO', 'GSTIN', 'Seller Gstin'],
  ['order_id', 'Order ID', 'Order Id'],
];

export const MYNTRA_GSTR_RT_HEADERS: string[][] = [
  ['tax_seller_gstin', 'GST NO', 'GSTIN', 'Seller Gstin'],
  ['shipment_id', 'Shipment ID', 'Order ID', 'Order Id'],
];

/** Returns report — only order_id is required to join; return reason columns are optional enrichments. */
export const MYNTRA_MDIRECT_RETURNS_HEADERS: string[][] = [
  ['order_id', 'Order ID', 'Order Id', 'Order Number', 'Store Order Id'],
];
