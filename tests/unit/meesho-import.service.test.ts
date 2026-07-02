import { MeeshoImportService } from '../../src/report-import/services/meesho-import.service';

import { FileParserService } from '../../src/report-import/services/file-parser.service';

import { MappingService } from '../../src/report-import/services/mapping.service';



describe('MeeshoImportService', () => {

  const mapping = new MappingService();

  const service = new MeeshoImportService(new FileParserService(), mapping);



  const salesRow = {

    __sheetName: 'TCS Sales',

    __rowNumber: 2,

    gstin: '27AAAAA0000A1Z5',

    sub_order_num: 'ORD-100',

    hsn_code: '6109',

    quantity: 2,

    total_invoice_value: 1000,

    total_taxable_sale_value: 900,

    gst_rate: 12,

    tax_amount: 108,

    order_date: '01/04/2026',

    end_customer_state_new: 'Maharashtra',

  };



  const emptyLifecycle = { rows: [], headers: [] };



  it('applies CGST/SGST when seller state matches customer state', () => {

    const mapped = mapping.mapMeeshoTcsSalesRow(salesRow, 'Maharashtra');

    expect(mapped.cgstRate).toBe(6);

    expect(mapped.sgstRate).toBe(6);

    expect(mapped.cgstAmount).toBe(54);

    expect(mapped.sgstAmount).toBe(54);

  });



  it('leaves CGST/SGST blank for inter-state rows', () => {

    const mapped = mapping.mapMeeshoTcsSalesRow(salesRow, 'Karnataka');

    expect(mapped.cgstRate).toBeUndefined();

    expect(mapped.sgstRate).toBeUndefined();

    expect(mapped.igstRate).toBe(12);

  });



  it('enriches TCS sales row from other reports by sub_order_num', () => {

    const result = service.buildNormalizedRows(

      {

        tcsSales: { rows: [salesRow], headers: [] },

        tcsSalesReturn: {

          rows: [

            {

              __sheetName: 'TCS Return',

              __rowNumber: 2,

              sub_order_num: 'ORD-100',

              cancel_return_date: '2026-04-10',

              Status: 'Return Processed',

            },

          ],

          headers: [],

        },

        orderReport: {

          rows: [

            {

              __sheetName: 'Order',

              __rowNumber: 2,

              'Sub Order No': 'ORD-100',

              SKU: 'SKU-1',

              Status: 'Delivered',

            },

          ],

          headers: [],

        },

        returnInTransit: emptyLifecycle,

        returnOutForDelivery: emptyLifecycle,

        returnDeliveryComplete: {

          rows: [

            {

              __sheetName: 'Return Complete',

              __rowNumber: 2,

              'Order Number': 'ORD-100',

              'Type of Return': 'Customer Return',

              'Sub Type': 'RTO',

              Qty: 1,

              'Return Reason': 'Size issue',

              'Detailed Return Reason': 'Too small',

            },

          ],

          headers: [],

        },

      },

      'Maharashtra',

    );



    expect(result.rows).toHaveLength(1);

    const row = result.rows[0];

    expect(row.orderID).toBe('ORD-100');

    expect(row.skuID).toBe('SKU-1');

    expect(row.documentType).toBe('SALE');

    expect(row.meeshoIsGrossSale).toBe(true);

    expect(row.meeshoHasTcsReturn).toBe(true);

    expect(row.meeshoTcsReturnStatus).toBe('Return Processed');

    expect(row.meeshoOrderStatus).toBe('Delivered');

    expect(row.meeshoReturnSubType).toBe('rto');

    expect(row.returnInvoiceDate).toMatch(/^2026-04-(09|10)$/);

    expect(row.typeOfReturn).toBe('Customer Return');

    expect(row.subType).toBe('RTO');

    expect(row.returnQty).toBe(1);

    expect(row.returnReason).toBe('Size issue');

    expect(row.detailedReturnReason).toBe('Too small');

  });



  it('enriches cancellation from Reason for Credit Entry on order report', () => {
    const result = service.buildNormalizedRows(
      {
        tcsSales: { rows: [salesRow], headers: [] },
        tcsSalesReturn: {
          rows: [
            {
              __sheetName: 'TCS Return',
              __rowNumber: 2,
              sub_order_num: 'ORD-100',
              cancel_return_date: '2026-04-10',
            },
          ],
          headers: [],
        },
        orderReport: {
          rows: [
            {
              __sheetName: 'Order',
              __rowNumber: 2,
              'Sub Order No': 'ORD-100',
              SKU: 'SKU-1',
              'Reason for Credit Entry': 'Cancellation',
            },
          ],
          headers: [],
        },
        returnInTransit: emptyLifecycle,
        returnOutForDelivery: emptyLifecycle,
        returnDeliveryComplete: emptyLifecycle,
      },
      'Maharashtra',
    );

    expect(result.rows[0].meeshoOrderStatus).toBe('Cancellation');
    expect(result.rows[0].meeshoReturnSubType).toBe('cancellation');
  });

  it('does not apply lifecycle Type of Return when order is not in TCS return', () => {
    const result = service.buildNormalizedRows(
      {
        tcsSales: { rows: [salesRow], headers: [] },
        tcsSalesReturn: emptyLifecycle,
        orderReport: { rows: [], headers: [] },
        returnInTransit: emptyLifecycle,
        returnOutForDelivery: emptyLifecycle,
        returnDeliveryComplete: {
          rows: [
            {
              __sheetName: 'Return Complete',
              __rowNumber: 2,
              'Order Number': 'ORD-100',
              'Type of Return': 'Customer Return',
            },
          ],
          headers: [],
        },
      },
      'Maharashtra',
    );

    expect(result.rows[0].typeOfReturn).toBeUndefined();
    expect(result.rows[0].meeshoHasTcsReturn).toBe(false);
  });



  it('enriches TCS sales row from payment report by Sub Order No', () => {

    const result = service.buildNormalizedRows(

      {

        tcsSales: { rows: [salesRow], headers: [] },

        tcsSalesReturn: emptyLifecycle,

        orderReport: { rows: [], headers: [] },

        returnInTransit: emptyLifecycle,

        returnOutForDelivery: emptyLifecycle,

        returnDeliveryComplete: emptyLifecycle,

      },

      'Maharashtra',

      [

        {

          __sheetName: 'Order Payments',

          __rowNumber: 3,

          'Sub Order No': 'ORD-100',

          'Live Order Status': 'Delivered',

          'Transaction ID': 'TXN-1',

          'Payment Date': '01/05/2026',

          'Final Settlement Amount': 850,

          TCS: 10,

          TDS: 5,

        },

      ],

    );



    expect(result.rows).toHaveLength(1);

    const row = result.rows[0];

    expect(row.liveOrderStatus).toBe('Delivered');

    expect(row.transactionId).toBe('TXN-1');

    expect(row.finalSettlementAmount).toBe(850);

    expect(row.paymentTcs).toBe(10);

    expect(row.tds).toBe(5);

  });

});

