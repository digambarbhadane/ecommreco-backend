/** Required header groups per Myntra report (any alias in a group satisfies the group). */

export const MYNTRA_GSTR_PACKED_HEADERS: string[][] = [
  ['seller_gstin', 'Seller Gstin', 'GST NO', 'GSTIN'],
  ['order_id', 'Order ID', 'Order Id'],
  ['payment_method', 'Payment Mode', 'Payment Method'],
  ['seller_type', 'Fulfilment Type', 'Fulfillment Type'],
  ['quantity', 'Quantity'],
  ['seller_price', 'Invoice Amount'],
  ['base_value', 'Taxable Amount', 'Taxable Value'],
];

export const MYNTRA_SALES_REVENUE_HEADERS: string[][] = [
  ['Sale_Order_Code', 'sale_order_code', 'Order ID', 'Order Id'],
  ['Hsn', 'HSN', 'HSN Code'],
  ['Invoice_Number', 'invoice_number', 'Invoice No', 'Invoice Number'],
  ['Packing_Date', 'packing_date', 'Invoice Date'],
];

export const MYNTRA_MDIRECT_ORDERS_HEADERS: string[][] = [
  ['order_release_id', 'Order Release Id', 'Order ID'],
  ['seller_sku_code', 'seller sku code', 'SKU ID', 'SKU'],
];

export const MYNTRA_GSTR_RTO_HEADERS: string[][] = [
  ['tax_seller_gstin', 'seller_gstin', 'GST NO', 'GSTIN'],
  ['order_id', 'Order ID', 'Order Id'],
  ['order_cancel_date', 'Order Cancel Date', 'Cancel Date'],
];

export const MYNTRA_GSTR_RT_HEADERS: string[][] = [
  ['tax_seller_gstin', 'seller_gstin', 'GST NO', 'GSTIN'],
  [
    'packet_id',
    'Packet ID',
    'Packet_Id',
    'shipment_id',
    'Shipment ID',
    'order_id',
  ],
  [
    'fr_refunded_date',
    'FR Refunded Date',
    'Refunded Date',
    'refund_date',
    'Refund Date',
    'return_refund_date',
    'Return Refund Date',
    'customer_return_date',
    'Customer Return Date',
  ],
];

export const MYNTRA_MDIRECT_RETURNS_HEADERS: string[][] = [
  ['order_id', 'Order ID', 'Order Id', 'Order Number'],
  ['return_mode', 'Return Mode', 'Return Reason'],
  ['return_reason', 'Detailed Return Reason', 'Return Reason Detail'],
];
