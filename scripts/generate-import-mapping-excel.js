/**
 * Generates a downloadable Excel reference for marketplace report → DB field mappings.
 * Run: node scripts/generate-import-mapping-excel.js
 */
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const OUT_DIR = path.join(__dirname, '..', 'docs');
const OUT_FILE = path.join(OUT_DIR, 'Import-Field-Mapping-Reference.xlsx');

/** @type {Array<{ marketplace: string; report: string; uploadSlot: string; sheet?: string; rows: Array<{ excel: string; db: string; notes?: string }> }>} */
const REPORTS = [
  // ─── Flipkart ───
  {
    marketplace: 'Flipkart',
    report: 'Sales Report',
    uploadSlot: 'file (Sales workbook)',
    sheet: 'Sales Report',
    rows: [
      {
        excel:
          'Seller GSTIN, Seller GSTIN Number, Supplier GSTIN, GSTIN of Seller, GST Registration No, GSTIN/UIN, GST NO (+ variants), GSTIN',
        db: 'gstin (profile) / seller GSTIN match',
        notes: 'Eco/marketplace TCS GSTIN headers ignored; stored gstin from selected GST profile',
      },
      { excel: 'Order ID', db: 'orderID' },
      { excel: 'SKU ID, SKU', db: 'skuID', notes: 'SKU Master source for Flipkart' },
      { excel: 'HSN Code', db: 'hsnCode' },
      { excel: 'Voucher Type, Event Sub Type', db: 'voucherType' },
      {
        excel: 'Document Type, Event Type',
        db: 'documentType',
        notes: 'Default SALE if empty',
      },
      { excel: 'Payment Mode, Order Type', db: 'paymentMode' },
      { excel: 'Fulfilment Type', db: 'fulfilmentType' },
      { excel: 'Quantity, Item Quantity', db: 'quantity' },
      { excel: 'Taxable Amount, Taxable Value', db: 'taxableAmount' },
      { excel: 'IGST Rate', db: 'igstRate' },
      { excel: 'IGST Amount', db: 'igstAmount' },
      { excel: 'CGST Rate', db: 'cgstRate' },
      { excel: 'CGST Amount', db: 'cgstAmount' },
      { excel: 'SGST Rate, UTGST Rate', db: 'sgstRate' },
      { excel: 'SGST Amount, UTGST Amount', db: 'sgstAmount' },
      { excel: 'Invoice No, Buyer Invoice ID', db: 'invoiceNo' },
      { excel: 'Buyer Invoice Date', db: 'buyerInvoiceDate' },
      {
        excel: 'Buyer Invoice Date, Invoice Date',
        db: 'invoiceDate',
        notes: 'Buyer Invoice Date preferred',
      },
      {
        excel: "Pincode, Customer's Delivery Pincode, Customer Delivery Pincode",
        db: 'pincode',
      },
      {
        excel: "State Name, Customer's Delivery State, Customer Delivery State",
        db: 'stateName',
      },
      {
        excel: '(computed — not from Excel)',
        db: 'invoiceAmount',
        notes: 'taxable + IGST + CGST + SGST',
      },
      {
        excel: '(derived — not from Excel)',
        db: 'gstAmount, gstTransactionType',
        notes: 'After normalizeTaxByState',
      },
    ],
  },
  {
    marketplace: 'Flipkart',
    report: 'Cash Back Report',
    uploadSlot: 'file (Sales workbook)',
    sheet: 'Cash Back Report',
    rows: [
      {
        excel: 'Same Flipkart GSTIN aliases as Sales',
        db: 'gstin (profile) / seller GSTIN match',
      },
      { excel: 'Order ID', db: 'orderID' },
      {
        excel: 'Voucher Type, Document Type',
        db: 'documentType',
        notes: 'Default CASHBACK; reportType=cashback',
      },
      {
        excel: 'Document Type, Document Sub Type, Document SubType',
        db: 'voucherType',
      },
      { excel: 'Payment Mode', db: 'paymentMode' },
      { excel: 'Taxable Amount, Taxable Value', db: 'taxableAmount' },
      { excel: 'IGST Rate / Amount', db: 'igstRate / igstAmount' },
      { excel: 'CGST Rate / Amount', db: 'cgstRate / cgstAmount' },
      {
        excel: 'SGST Rate, UTGST Rate / Amount',
        db: 'sgstRate / sgstAmount',
      },
      {
        excel:
          'Invoice No, Credit Note ID, Debit Note ID, Credit Note ID / Debit Note ID',
        db: 'invoiceNo',
      },
      { excel: 'Invoice Date', db: 'invoiceDate' },
      {
        excel: "State Name, Customer's Delivery State, Customer Delivery State",
        db: 'stateName',
      },
      {
        excel: '(computed)',
        db: 'invoiceAmount',
        notes: 'Same Flipkart sum formula',
      },
      {
        excel: '(not mapped)',
        db: 'skuID, hsnCode, quantity, fulfilmentType, pincode, buyerInvoiceDate',
        notes: 'Not present on Cash Back mapping',
      },
    ],
  },
  {
    marketplace: 'Flipkart',
    report: 'Return Report',
    uploadSlot: 'returnReportFile',
    sheet: 'Return Report / Returns / Return',
    rows: [
      {
        excel: 'Order ID, Order Id, order_id',
        db: '(join → orderID)',
        notes: 'Enriches existing sales rows; does not create standalone sales',
      },
      {
        excel: 'Return Type, Type of Return, Return_Type, type_of_return',
        db: 'typeOfReturn',
        notes: 'If reason present but type missing → #N/A',
      },
      {
        excel: 'Return Reason, Return_Reason, return_reason',
        db: 'returnReason',
      },
      {
        excel:
          'Return Sub-reason, Return Sub Reason, Return Sub-Reason, Return SubReason, Sub Reason, Sub-Reason',
        db: 'detailedReturnReason',
      },
    ],
  },
  {
    marketplace: 'Flipkart',
    report: 'Payment / Settlement Report',
    uploadSlot: 'paymentReportFile',
    sheet: 'Orders / Order / Settlement',
    rows: [
      {
        excel: 'Order ID, Order Id, order_id',
        db: '(join → orderID)',
      },
      {
        excel:
          'Settlement Value, Settlement Amount, Net Settlement Amount, Net Amount, Net Payable Amount, Settlement',
        db: 'finalSettlementAmount',
      },
      {
        excel: 'NEFT ID, NEFT_ID, UTR, Settlement UTR, Bank UTR',
        db: 'transactionId',
      },
      {
        excel: 'Settlement Date, Payment Date, NEFT Date, Payout Date',
        db: 'paymentDate',
      },
    ],
  },

  // ─── Amazon ───
  {
    marketplace: 'Amazon',
    report: 'MTR B2C Report',
    uploadSlot: 'mtrB2cFile',
    rows: [
      {
        excel: 'Seller Gstin, Seller GSTIN, GST NO, GST NO = Seller Gstin',
        db: 'gstin (profile) / seller GSTIN match',
      },
      { excel: 'Order Id, Order ID', db: 'orderID' },
      { excel: 'Sku, SKU', db: 'skuID', notes: 'SKU Master source for Amazon' },
      { excel: 'Hsn/sac, HSN Code', db: 'hsnCode' },
      {
        excel: 'Transaction Type',
        db: 'voucherType AND documentType',
        notes: 'Both mapped from same column',
      },
      {
        excel: 'Payment Method, Payment Mode, Payment Method Code',
        db: 'paymentMode',
      },
      {
        excel: 'Fulfillment Channel, Fullfilment Channel, Fulfilment Type',
        db: 'fulfilmentType',
      },
      { excel: 'Quantity', db: 'quantity' },
      {
        excel: 'Invoice Amount',
        db: 'invoiceAmount',
        notes: 'Read from file (unlike Flipkart)',
      },
      {
        excel: 'Tax Exclusive Gross, Taxable Amount, Taxable Value',
        db: 'taxableAmount',
      },
      { excel: 'Igst Rate, IGST Rate', db: 'igstRate' },
      { excel: 'Igst Tax, IGST Amount', db: 'igstAmount' },
      { excel: 'Cgst Rate, CGST Rate', db: 'cgstRate' },
      { excel: 'Cgst Tax, CGST Amount', db: 'cgstAmount' },
      { excel: 'Sgst Rate, SGST Rate', db: 'sgstRate' },
      { excel: 'Sgst Tax, SGST Amount', db: 'sgstAmount' },
      { excel: 'Invoice Number, Invoice No', db: 'invoiceNo' },
      { excel: 'Invoice Date', db: 'invoiceDate' },
      { excel: 'Ship To Postal Code, Pincode', db: 'pincode' },
      { excel: 'Ship To State, State Name', db: 'stateName' },
      {
        excel: 'Customer Bill To Gstid, Customer GST No',
        db: 'customerGstNo',
        notes: 'Optional on B2C',
      },
      {
        excel: 'Buyer Name',
        db: 'buyerName',
        notes: 'Optional on B2C',
      },
    ],
  },
  {
    marketplace: 'Amazon',
    report: 'MTR B2B Report',
    uploadSlot: 'mtrB2bFile',
    rows: [
      {
        excel: '(Same column map as MTR B2C)',
        db: '(same as MTR B2C)',
        notes: 'Customer Bill To Gstid and Buyer Name are REQUIRED on B2B',
      },
      {
        excel: 'Customer Bill To Gstid, Customer GST No',
        db: 'customerGstNo',
        notes: 'Required',
      },
      { excel: 'Buyer Name', db: 'buyerName', notes: 'Required' },
    ],
  },
  {
    marketplace: 'Amazon',
    report: 'Amazon Return Report',
    uploadSlot: 'amazonReturnReportFile',
    sheet: 'Return Report / Returns / Return',
    rows: [
      {
        excel: 'Order Id, Order ID, order_id, Order Number',
        db: '(join → orderID)',
      },
      {
        excel: 'Return Type, Type of Return, Return_Type, type_of_return',
        db: 'typeOfReturn',
        notes:
          'C-Returns / Amazon CS → Customer Return; Rejected/Undelivered → RTO; else raw / #N/A',
      },
      {
        excel: '(derived from Return Type)',
        db: 'amazonReturnSubType',
        notes: 'customer_return | rto | na',
      },
      {
        excel: '(not mapped)',
        db: 'amounts, skuID, tax, dates',
        notes: 'Only return type classification from this file',
      },
    ],
  },

  // ─── Meesho ───
  {
    marketplace: 'Meesho',
    report: 'TCS Sales Report',
    uploadSlot: 'tcsSalesFile',
    rows: [
      {
        excel: 'gstin, GST NO, Seller GSTIN',
        db: 'gstin (profile) / seller GSTIN match',
      },
      {
        excel: 'sub_order_num, Order ID, Sub Order No, Order Number',
        db: 'orderID',
        notes: 'Common Meesho order key aliases',
      },
      { excel: 'hsn_code, HSN Code', db: 'hsnCode' },
      { excel: 'quantity, Quantity', db: 'quantity' },
      { excel: 'total_invoice_value, Invoice Amount', db: 'invoiceAmount' },
      {
        excel: 'total_taxable_sale_value, Taxable Amount',
        db: 'taxableAmount',
      },
      {
        excel: 'gst_rate, IGST Rate',
        db: 'igstRate',
        notes: 'Rate stored on IGST; tax split by seller vs customer state',
      },
      {
        excel: 'tax_amount, IGST Amount',
        db: 'igstAmount',
        notes: 'Redistributed via normalizeTaxByState',
      },
      { excel: 'order_date, Invoice Date', db: 'invoiceDate' },
      {
        excel: 'end_customer_state_new, State Name',
        db: 'stateName',
      },
      {
        excel: '(set in code)',
        db: 'documentType',
        notes: 'SALE',
      },
      {
        excel: '(set in code)',
        db: 'meeshoIsGrossSale',
        notes: 'true on sales path',
      },
      {
        excel: '(not on TCS Sales)',
        db: 'skuID',
        notes: 'SKU comes from Order Report enrichment only',
      },
    ],
  },
  {
    marketplace: 'Meesho',
    report: 'TCS Sales Return Report',
    uploadSlot: 'tcsSalesReturnFile',
    rows: [
      {
        excel: '(Same TCS Sales amount/order/GST columns)',
        db: '(same as TCS Sales)',
        notes: 'Primary return row → documentType=RETURN',
      },
      {
        excel: 'cancel_return_date, Return Invoice Date',
        db: 'returnInvoiceDate (+ invoiceDate on primary return)',
      },
      {
        excel: 'Type of Return, Return Type, type_of_return',
        db: 'typeOfReturn',
      },
      { excel: 'Sub Type, sub_type', db: 'subType' },
      {
        excel: 'Status, Return Status, Order Status, status',
        db: 'meeshoTcsReturnStatus',
        notes: 'Enrich path',
      },
      {
        excel: '(return amounts when enriching a sale)',
        db: 'meeshoReturnInvoiceAmount, meeshoReturnTaxableAmount, meeshoReturnIgstAmount, meeshoReturnCgstAmount, meeshoReturnSgstAmount, returnQty',
        notes: 'Kept separate from gross sale amounts',
      },
    ],
  },
  {
    marketplace: 'Meesho',
    report: 'Order Report',
    uploadSlot: 'orderReportFile',
    rows: [
      {
        excel: 'Sub Order No (+ Meesho order ID aliases)',
        db: '(join)',
        notes: 'Enrichment only; no GSTIN required',
      },
      {
        excel: 'SKU, SKU ID, sku',
        db: 'skuID',
        notes: 'SKU Master source for Meesho',
      },
      {
        excel:
          'Status, Order Status, Live Order Status, Reason for Credit Entry',
        db: 'meeshoOrderStatus',
      },
    ],
  },
  {
    marketplace: 'Meesho',
    report: 'Return In-Transit / Out-for-Delivery / Delivery Complete',
    uploadSlot:
      'returnInTransitReportFile | returnOutForDeliveryReportFile | returnDeliveryCompleteReportFile',
    sheet: 'Headers typically on Excel row 8',
    rows: [
      { excel: '(order id aliases)', db: '(join)' },
      { excel: 'Type of Return, Return Type', db: 'typeOfReturn' },
      {
        excel: 'Sub Type',
        db: 'subType',
        notes: 'Also drives meeshoReturnSubType / prior-month flags',
      },
      { excel: 'Qty, Return Qty', db: 'returnQty' },
      {
        excel: 'Return Reason, Reason for Return',
        db: 'returnReason',
      },
      {
        excel: 'Detailed Return Reason, Detailed Return',
        db: 'detailedReturnReason',
      },
    ],
  },
  {
    marketplace: 'Meesho',
    report: 'Order Payments',
    uploadSlot: 'paymentReportFile',
    sheet: 'Order Payments (headers often row 2)',
    rows: [
      {
        excel: 'Sub Order No, sub_order_num, Order ID',
        db: '(join)',
      },
      { excel: 'Live Order Status', db: 'liveOrderStatus' },
      { excel: 'Transaction ID', db: 'transactionId' },
      { excel: 'Payment Date', db: 'paymentDate' },
      { excel: 'Final Settlement Amount', db: 'finalSettlementAmount' },
      { excel: 'Price Type', db: 'priceType' },
      {
        excel: 'Total Sale Amount (Incl. Shipping & GST)',
        db: 'totalSaleAmountInclShippingGst',
      },
      {
        excel: 'Total Sale Return Amount (Incl. Shipping & GST)',
        db: 'totalSaleReturnAmountInclShippingGst',
      },
      { excel: 'Fixed Fee (Incl. GST)', db: 'fixedFeeInclGst' },
      {
        excel: 'Warehousing fee (inc Gst) / Warehousing fee (Incl. GST)',
        db: 'warehousingFeeInclGst',
      },
      {
        excel: 'Return premium (incl GST)',
        db: 'returnPremiumInclGst',
      },
      {
        excel: 'Return premium (incl GST) of Return',
        db: 'returnPremiumInclGstOfReturn',
      },
      {
        excel: 'Meesho Commission Percentage',
        db: 'meeshoCommissionPercentage',
      },
      {
        excel: 'Meesho Commission (Incl. GST)',
        db: 'meeshoCommissionInclGst',
      },
      {
        excel: 'Meesho gold platform fee (Incl. GST)',
        db: 'meeshoGoldPlatformFeeInclGst',
      },
      {
        excel: 'Meesho mall platform fee (Incl. GST)',
        db: 'meeshoMallPlatformFeeInclGst',
      },
      {
        excel: 'Return Shipping Charge (Incl. GST)',
        db: 'returnShippingChargeInclGst',
      },
      {
        excel: 'GST Compensation (PRP Shipping)',
        db: 'gstCompensationPrpShipping',
      },
      {
        excel: 'Shipping Charge (Incl. GST)',
        db: 'shippingChargeInclGst',
      },
      {
        excel: 'Other Support Service Charges (Excl. GST)',
        db: 'otherSupportServiceChargesExclGst',
      },
      { excel: 'Waivers (Excl. GST)', db: 'waiversExclGst' },
      {
        excel: 'Net Other Support Service Charges (Excl. GST)',
        db: 'netOtherSupportServiceChargesExclGst',
      },
      {
        excel: 'GST on Net Other Support Service Charges',
        db: 'gstOnNetOtherSupportServiceCharges',
      },
      { excel: 'TCS', db: 'paymentTcs', notes: 'Not seller GSTIN' },
      { excel: 'TDS Rate %, TDS Rate', db: 'tdsRatePercent' },
      { excel: 'TDS', db: 'tds' },
      { excel: 'Compensation', db: 'compensation' },
      { excel: 'Claims', db: 'claims' },
      { excel: 'Recovery', db: 'recovery' },
      { excel: 'Compensation Reason', db: 'compensationReason' },
      { excel: 'Claims Reason', db: 'claimsReason' },
      { excel: 'Recovery Reason', db: 'recoveryReason' },
    ],
  },

  // ─── Myntra ───
  {
    marketplace: 'Myntra',
    report: 'GSTR Report Packed',
    uploadSlot: 'gstrReportPackedFile',
    rows: [
      {
        excel: 'seller_gstin, GST NO, GSTIN, Seller Gstin, tax_seller_gstin',
        db: 'gstin (profile) / seller GSTIN match',
      },
      {
        excel:
          'order_id, order_release_id, sale_order_code, Sale_Order_Code, shipment_id, Order ID',
        db: 'orderID',
      },
      {
        excel: 'payment_method, Payment Mode, Payment Method',
        db: 'paymentMode',
      },
      {
        excel: 'seller_type, Fulfilment Type, Fulfillment Type, Fulfilment Channel',
        db: 'fulfilmentType',
      },
      { excel: 'quantity, Quantity', db: 'quantity' },
      { excel: 'seller_price, Invoice Amount', db: 'invoiceAmount' },
      {
        excel: 'base_value, Taxable Amount, Taxable Value',
        db: 'taxableAmount',
      },
      {
        excel: 'igst_rate / igst_amt (+ Rate/Amount/Tax aliases)',
        db: 'igstRate / igstAmount',
      },
      {
        excel: 'cgst_rate / cgst_amt (+ aliases)',
        db: 'cgstRate / cgstAmount',
      },
      {
        excel: 'sgst_rate / sgst_amt (+ aliases)',
        db: 'sgstRate / sgstAmount',
      },
      { excel: 'pincode, Pincode', db: 'pincode' },
      {
        excel:
          'customer_delivery_state, customer_delivery_state_code, State Name, Ship To State',
        db: 'stateName',
        notes: 'Normalized Indian state label',
      },
      {
        excel: 'customer_delivery_state_code, State Name, Ship To State',
        db: 'customerStateCode',
        notes: '2-digit state code transform',
      },
      {
        excel: 'order_packed_date, Order Packed Date, Packed Date',
        db: 'order_packed_date',
        notes: 'DMY → ISO; also copied to invoiceDate if unset',
      },
      {
        excel: '(set in code)',
        db: 'documentType, myntraTransactionType',
        notes: 'SALE',
      },
      {
        excel: '(not on GSTR Packed)',
        db: 'skuID',
        notes: 'SKU comes from MDirect Orders',
      },
      {
        excel: '(not on GSTR Packed)',
        db: 'hsnCode, invoiceNo',
        notes: 'Come from Sales Revenue Packed B2C',
      },
    ],
  },
  {
    marketplace: 'Myntra',
    report: 'Sales Revenue Packed B2C',
    uploadSlot: 'salesRevenuePackedB2cFile',
    rows: [
      {
        excel: 'Sale_Order_Code, sale_order_code, Order ID, Order Id',
        db: 'orderID / join',
      },
      { excel: 'Hsn, HSN, hsn, HSN Code', db: 'hsnCode' },
      {
        excel: 'Invoice_Number, invoice_number, Invoice No, Invoice Number',
        db: 'invoiceNo',
      },
      {
        excel: 'Packing_Date, packing_date, Invoice Date',
        db: 'invoiceDate',
      },
      {
        excel: 'Order_Created_Date, order_created_date, Order Created Date',
        db: 'order_created_date',
        notes: 'Informational; sales dated by packed date',
      },
    ],
  },
  {
    marketplace: 'Myntra',
    report: 'MDirect Orders',
    uploadSlot: 'mDirectOrdersReportFile (optional)',
    rows: [
      {
        excel:
          'order_release_id, order_id, sale_order_code, Sale_Order_Code, Order ID',
        db: 'orderID / join',
      },
      {
        excel: 'seller_sku_code, seller sku code, SKU ID, SKU, Sku',
        db: 'skuID',
        notes: 'SKU Master source for Myntra',
      },
    ],
  },
  {
    marketplace: 'Myntra',
    report: 'GSTR Report RTO',
    uploadSlot: 'gstrReportRtoFile',
    rows: [
      {
        excel: 'tax_seller_gstin, seller_gstin, GST NO, GSTIN',
        db: 'seller GSTIN match',
      },
      {
        excel:
          'order_id, Order ID, shipment_id, order_release_id, sale_order_code, invoice_number, Invoice No',
        db: 'orderID',
        notes: 'Invoice numbers also used as prior-sale lookup keys',
      },
      {
        excel: 'order_cancel_date, Order Cancel Date, Cancel Date',
        db: 'orderCancelDate',
        notes: 'Drives return dating',
      },
      { excel: 'invoice_number (+ Invoice_* aliases)', db: 'invoiceNo' },
      { excel: 'payment_method (+ aliases)', db: 'paymentMode' },
      { excel: 'seller_type (+ fulfilment aliases)', db: 'fulfilmentType' },
      {
        excel: 'quantity, Quantity, Qty',
        db: 'quantity',
        notes: 'Often negated for return',
      },
      {
        excel: 'seller_price / base_value (+ amount aliases)',
        db: 'invoiceAmount / taxableAmount',
        notes: 'May be overwritten from matched sale',
      },
      {
        excel: 'igst/cgst/sgst rate & amt aliases',
        db: 'tax fields',
        notes: 'Prefer existing return values; else from sale',
      },
      {
        excel: 'customer_pincode, pincode, Pincode, Customer Pincode',
        db: 'pincode',
      },
      {
        excel:
          'customer_state, customer_delivery_state, customer_delivery_state_code, State Name, Ship To State',
        db: 'stateName',
      },
      {
        excel: '(set in code)',
        db: 'documentType, typeOfReturn, myntraTransactionType',
        notes: 'RTO Return / RETURN',
      },
    ],
  },
  {
    marketplace: 'Myntra',
    report: 'GSTR Report RT',
    uploadSlot: 'gstrReportRtFile',
    rows: [
      {
        excel: 'tax_seller_gstin, seller_gstin, GST NO, GSTIN',
        db: 'seller GSTIN match',
      },
      {
        excel:
          'packet_id, Packet ID, shipment_id, Shipment ID, order_id, Order ID, order_release_id, sale_order_code',
        db: 'orderID',
      },
      {
        excel: 'fr_refunded_date, FR Refunded Date, Refunded Date',
        db: 'frRefundedDate',
      },
      {
        excel: 'payment_method / seller_type aliases',
        db: 'paymentMode / fulfilmentType',
      },
      {
        excel: 'quantity (+ Qty) / seller_price / base_value',
        db: 'quantity & amounts',
      },
      {
        excel: 'tax_rate, gst_rate, igst_rate, IGST Rate',
        db: 'igstRate',
        notes: 'RT accepts generic tax_rate',
      },
      {
        excel: 'tax_amount, gst_amount, igst_amt, IGST Amount',
        db: 'igstAmount',
      },
      { excel: 'cgst/sgst rate & amt', db: 'cgst* / sgst*' },
      {
        excel: 'customer_pincode (+ aliases)',
        db: 'pincode',
      },
      {
        excel:
          'delivery_state, customer_delivery_state, customer_delivery_state_code, State Name, Ship To State',
        db: 'stateName',
      },
      {
        excel: '(set in code)',
        db: 'documentType, typeOfReturn',
        notes: 'Customer Return',
      },
    ],
  },
  {
    marketplace: 'Myntra',
    report: 'MDirect Returns',
    uploadSlot: 'mDirectReturnsReportFile (optional)',
    rows: [
      {
        excel: 'order_id, Order ID, Order Number, Store Order Id',
        db: 'join / orderID',
      },
      {
        excel: 'seller_sku_code, seller sku code, SKU ID, SKU, Sku',
        db: 'skuID',
      },
      { excel: 'return_mode, Return Mode', db: 'returnReason' },
      {
        excel: 'return_reason, Detailed Return Reason, Return Reason Detail',
        db: 'detailedReturnReason',
      },
    ],
  },
];

const SKU_SOURCES = [
  {
    marketplace: 'Flipkart',
    report: 'Sales Report',
    excel: 'SKU ID, SKU',
    db: 'skuID',
    notes: 'Primary SKU Master source',
  },
  {
    marketplace: 'Amazon',
    report: 'MTR B2C / MTR B2B',
    excel: 'Sku, SKU',
    db: 'skuID',
    notes: 'Primary SKU Master source',
  },
  {
    marketplace: 'Meesho',
    report: 'Order Report (enrichment)',
    excel: 'SKU, SKU ID, sku',
    db: 'skuID',
    notes: 'Not on TCS Sales — enrichment only',
  },
  {
    marketplace: 'Myntra',
    report: 'MDirect Orders (optional)',
    excel: 'seller_sku_code, SKU ID, SKU',
    db: 'skuID',
    notes: 'Not on GSTR Packed — optional enrichment',
  },
];

const PIPELINE_FIELDS = [
  {
    field: 'uploadId',
    meaning: 'Import upload id',
    source: 'Pipeline',
  },
  {
    field: 'sellerId',
    meaning: 'Seller id',
    source: 'Auth / GST context',
  },
  {
    field: 'gstin',
    meaning: 'Stored GSTIN on ImportRow',
    source: 'Selected GST profile (not Excel sellerGSTIN column write)',
  },
  {
    field: 'marketplace',
    meaning: 'Marketplace id / slug ref',
    source: 'Upload context',
  },
  {
    field: 'reportMonth',
    meaning: 'Report month',
    source: 'Upload context',
  },
  {
    field: 'gstAmount',
    meaning: 'Total GST amount',
    source: 'Derived',
  },
  {
    field: 'gstTransactionType',
    meaning: 'intra | inter',
    source: 'Derived via normalizeTaxByState',
  },
  {
    field: 'invoiceAmount (Flipkart)',
    meaning: 'Invoice total',
    source: 'Computed: taxable + IGST + CGST + SGST',
  },
  {
    field: 'meesho / amazon / myntra match flags',
    meaning:
      'meeshoIsGrossSale, amazonReturnSubType, myntraReturnMatchStatus, myntraIsReturned, linkedSaleRowId, saleReferenceMonth, etc.',
    source: 'Import matching pipeline',
  },
];

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF003F5C' },
  };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 22;
}

function autoWidth(sheet, min = 12, max = 60) {
  sheet.columns.forEach((col) => {
    let longest = min;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? '').length;
      if (len > longest) longest = len;
    });
    col.width = Math.min(max, Math.max(min, longest + 2));
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EcommReco';
  workbook.created = new Date();
  workbook.description =
    'Marketplace report Excel column → ImportRow database field mapping reference';

  // Sheet 1: Index / Overview
  const index = workbook.addWorksheet('Overview');
  index.columns = [
    { header: 'Section', key: 'section', width: 28 },
    { header: 'Details', key: 'details', width: 80 },
  ];
  styleHeader(index.getRow(1));
  index.addRow({
    section: 'Purpose',
    details:
      'Report-wise mapping of marketplace Excel columns to ImportRow (database) fields used during imports.',
  });
  index.addRow({
    section: 'Source of truth',
    details:
      'Backend importMappings + mapping.service.ts + marketplace import services + import-row.schema.ts',
  });
  index.addRow({
    section: 'Important note',
    details:
      'Stored ImportRow.gstin always comes from the selected GST profile. Excel GSTIN columns are used for validation/matching.',
  });
  index.addRow({
    section: 'How to read sheets',
    details:
      'All Mappings = flat table. Flipkart / Amazon / Meesho / Myntra = marketplace detail. SKU Sources = where skuID originates for SKU Master. Pipeline Fields = non-Excel fields.',
  });
  index.addRow({
    section: 'Generated at',
    details: new Date().toISOString(),
  });
  autoWidth(index);

  // Sheet 2: All mappings (flat)
  const all = workbook.addWorksheet('All Mappings');
  all.columns = [
    { header: 'Marketplace', key: 'marketplace', width: 14 },
    { header: 'Report', key: 'report', width: 36 },
    { header: 'Upload Slot / File', key: 'uploadSlot', width: 28 },
    { header: 'Sheet (if any)', key: 'sheet', width: 28 },
    { header: 'Excel Column(s)', key: 'excel', width: 55 },
    { header: 'Database Field', key: 'db', width: 40 },
    { header: 'Notes', key: 'notes', width: 45 },
  ];
  styleHeader(all.getRow(1));

  for (const report of REPORTS) {
    for (const row of report.rows) {
      all.addRow({
        marketplace: report.marketplace,
        report: report.report,
        uploadSlot: report.uploadSlot,
        sheet: report.sheet ?? '',
        excel: row.excel,
        db: row.db,
        notes: row.notes ?? '',
      });
    }
  }
  all.views = [{ state: 'frozen', ySplit: 1 }];
  all.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 7 },
  };

  // Per-marketplace sheets
  const marketplaces = ['Flipkart', 'Amazon', 'Meesho', 'Myntra'];
  for (const mp of marketplaces) {
    const sheet = workbook.addWorksheet(mp);
    sheet.columns = [
      { header: 'Report', key: 'report', width: 36 },
      { header: 'Upload Slot / File', key: 'uploadSlot', width: 32 },
      { header: 'Sheet (if any)', key: 'sheet', width: 28 },
      { header: 'Excel Column(s)', key: 'excel', width: 55 },
      { header: 'Database Field', key: 'db', width: 40 },
      { header: 'Notes', key: 'notes', width: 45 },
    ];
    styleHeader(sheet.getRow(1));
    for (const report of REPORTS.filter((r) => r.marketplace === mp)) {
      for (const row of report.rows) {
        sheet.addRow({
          report: report.report,
          uploadSlot: report.uploadSlot,
          sheet: report.sheet ?? '',
          excel: row.excel,
          db: row.db,
          notes: row.notes ?? '',
        });
      }
    }
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 6 },
    };
  }

  // SKU sources
  const sku = workbook.addWorksheet('SKU Sources');
  sku.columns = [
    { header: 'Marketplace', key: 'marketplace', width: 14 },
    { header: 'Report that provides SKU', key: 'report', width: 32 },
    { header: 'Excel Column(s)', key: 'excel', width: 40 },
    { header: 'Database Field', key: 'db', width: 14 },
    { header: 'Notes', key: 'notes', width: 45 },
  ];
  styleHeader(sku.getRow(1));
  for (const row of SKU_SOURCES) {
    sku.addRow(row);
  }
  autoWidth(sku);

  // Pipeline fields
  const pipeline = workbook.addWorksheet('Pipeline Fields');
  pipeline.columns = [
    { header: 'Database Field', key: 'field', width: 36 },
    { header: 'Meaning', key: 'meaning', width: 55 },
    { header: 'Source', key: 'source', width: 45 },
  ];
  styleHeader(pipeline.getRow(1));
  for (const row of PIPELINE_FIELDS) {
    pipeline.addRow(row);
  }
  autoWidth(pipeline);

  // Report index
  const reports = workbook.addWorksheet('Report Index');
  reports.columns = [
    { header: 'Marketplace', key: 'marketplace', width: 14 },
    { header: 'Report', key: 'report', width: 42 },
    { header: 'Upload Slot / File', key: 'uploadSlot', width: 40 },
    { header: 'Sheet', key: 'sheet', width: 32 },
    { header: 'Mapped Fields Count', key: 'count', width: 18 },
  ];
  styleHeader(reports.getRow(1));
  for (const report of REPORTS) {
    reports.addRow({
      marketplace: report.marketplace,
      report: report.report,
      uploadSlot: report.uploadSlot,
      sheet: report.sheet ?? '',
      count: report.rows.length,
    });
  }
  autoWidth(reports);

  await workbook.xlsx.writeFile(OUT_FILE);
  console.log(`Created: ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
