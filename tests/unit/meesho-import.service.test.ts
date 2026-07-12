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

    expect(mapped.igstRate).toBeUndefined();

    expect(mapped.igstAmount).toBeUndefined();

    expect(mapped.gstTransactionType).toBe('intra');

  });



  it('applies CGST/SGST for Gujarat when customer state uses code or GSTIN', () => {

    const gujaratRow = {

      ...salesRow,

      end_customer_state_new: '24',

    };

    const fromState = mapping.mapMeeshoTcsSalesRow(gujaratRow, 'Gujarat');

    expect(fromState.gstTransactionType).toBe('intra');

    expect(fromState.igstAmount).toBeUndefined();

    expect(fromState.cgstAmount).toBe(54);



    const interState = mapping.mapMeeshoTcsSalesRow(gujaratRow, 'Karnataka');

    expect(interState.gstTransactionType).toBe('inter');

    const fromGstin = mapping.normalizeTaxByState(

      interState,

      [],

      '24AAAAA0000A1Z5',

    );

    expect(fromGstin.gstTransactionType).toBe('intra');

    expect(fromGstin.igstAmount).toBeUndefined();

    expect(fromGstin.cgstAmount).toBe(54);

  });



  it('leaves CGST/SGST blank for inter-state rows', () => {

    const interRow = {

      ...salesRow,

      gstin: '29AAAAA0000A1Z5',

      end_customer_state_new: 'Maharashtra',

    };

    const mapped = mapping.mapMeeshoTcsSalesRow(interRow, 'Karnataka');

    expect(mapped.cgstRate).toBeUndefined();

    expect(mapped.sgstRate).toBeUndefined();

    expect(mapped.igstRate).toBe(12);

    expect(mapped.gstTransactionType).toBe('inter');

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



    expect(result.rows).toHaveLength(2);

    const row = result.rows.find((item) => item.documentType === 'SALE')!;

    expect(row.orderID).toBe('ORD-100');

    expect(row.skuID).toBe('SKU-1');

    expect(row.documentType).toBe('SALE');

    expect(row.meeshoIsGrossSale).toBe(true);

    expect(row.meeshoHasTcsReturn).toBe(true);

    expect(row.meeshoTcsReturnStatus).toBe('Return Processed');

    expect(row.meeshoOrderStatus).toBe('Delivered');

    expect(row.meeshoReturnSubType).toBeUndefined();

    expect(row.returnInvoiceDate).toMatch(/^2026-04-(09|10)$/);

    expect(row.typeOfReturn).toBe('Customer Return');

    expect(row.subType).toBe('RTO');

    expect(row.returnQty).toBe(1);

    expect(row.returnReason).toBe('Size issue');

    expect(row.detailedReturnReason).toBe('Too small');

    const returnRow = result.rows.find((item) => item.documentType === 'RETURN')!;
    expect(returnRow.meeshoReturnSubType).toBe('rto');
    expect(returnRow.meeshoIsGrossSale).toBe(false);
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
    expect(result.rows.find((r) => r.documentType === 'RETURN')?.meeshoReturnSubType).toBe(
      'cancellation',
    );
  });

  it('counts subtype from any of the three lifecycle reports by order id', () => {
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
              Status: 'Cancelled',
            },
          ],
          headers: [],
        },
        returnInTransit: {
          rows: [
            {
              __sheetName: 'Return In-Transit',
              __rowNumber: 2,
              'Order Number': 'ORD-100',
              'Type of Return': 'Customer Return',
            },
          ],
          headers: [],
        },
        returnOutForDelivery: {
          rows: [
            {
              __sheetName: 'Return Out For Delivery',
              __rowNumber: 2,
              'Order Number': 'ORD-100',
              'Type of Return': 'Customer Return',
              'Sub Type': 'RTO',
            },
          ],
          headers: [],
        },
        returnDeliveryComplete: {
          rows: [
            {
              __sheetName: 'Return Delivery Complete',
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

    expect(result.rows.find((r) => r.documentType === 'RETURN')?.meeshoReturnSubType).toBe('rto');
  });

  it('stores Type of Return from lifecycle Order Number and classifies courier return as RTO', () => {
    const result = service.buildNormalizedRows(
      {
        tcsSales: { rows: [salesRow], headers: [] },
        tcsSalesReturn: emptyLifecycle,
        orderReport: { rows: [], headers: [] },
        returnInTransit: emptyLifecycle,
        returnOutForDelivery: {
          rows: [
            {
              __sheetName: 'Return Out For Delivery',
              __rowNumber: 2,
              'Order Number': 'ORD-100',
              'Type of Return': 'Courier Return',
              Qty: 1,
            },
          ],
          headers: [],
        },
        returnDeliveryComplete: emptyLifecycle,
      },
      'Maharashtra',
    );

    expect(result.rows[0].orderID).toBe('ORD-100');
    expect(result.rows[0].typeOfReturn).toBe('Courier Return');
    expect(result.rows[0].meeshoReturnSubType).toBeUndefined();
  });

  it('matches lifecycle order id variants (quotes/.0/suffix) and stores typeOfReturn', () => {
    const result = service.buildNormalizedRows(
      {
        tcsSales: {
          rows: [
            {
              ...salesRow,
              sub_order_num: '227735A59707617069_1',
            },
          ],
          headers: [],
        },
        tcsSalesReturn: emptyLifecycle,
        orderReport: { rows: [], headers: [] },
        returnInTransit: {
          rows: [
            {
              __sheetName: 'Return In-Transit',
              __rowNumber: 2,
              'Order Number': "'227735A59707617069.0'",
              'Type of Return': 'Customer Return',
            },
          ],
          headers: [],
        },
        returnOutForDelivery: emptyLifecycle,
        returnDeliveryComplete: emptyLifecycle,
      },
      'Maharashtra',
    );

    expect(result.rows[0].typeOfReturn).toBe('Customer Return');
    expect(result.rows[0].meeshoReturnSubType).toBeUndefined();
  });

  it('applies lifecycle Type of Return even when TCS return sheet misses the order', () => {
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

    expect(result.rows[0].typeOfReturn).toBe('Customer Return');
    expect(result.rows[0].meeshoReturnSubType).toBeUndefined();
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

  it('uploads TCS sales return rows from the return report (including return-only orders)', () => {
    const result = service.buildNormalizedRows(
      {
        tcsSales: { rows: [], headers: [] },
        tcsSalesReturn: {
          rows: [
            {
              __sheetName: 'TCS Return',
              __rowNumber: 2,
              sub_order_num: 'RET-ONLY-1',
              cancel_return_date: '2026-04-10',
              'Type of Return': 'Customer Return',
            },
          ],
          headers: [],
        },
        orderReport: { rows: [], headers: [] },
        returnInTransit: emptyLifecycle,
        returnOutForDelivery: emptyLifecycle,
        returnDeliveryComplete: emptyLifecycle,
      },
      'Maharashtra',
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].orderID).toBe('RET-ONLY-1');
    expect(result.rows[0].documentType).toBe('RETURN');
    expect(result.rows[0].returnInvoiceDate).toBeDefined();
    expect(result.rows[0].meeshoReturnSubType).toBe('customer_return');
    expect(result.rows[0].meeshoIsGrossSale).toBe(false);
  });

  it('classifies return as na when TCS return exists but no type of return from any source', () => {
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
              quantity: 1,
              total_invoice_value: 500,
              total_taxable_sale_value: 450,
              tax_amount: 50,
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
              Status: 'Delivered',
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

    expect(result.rows).toHaveLength(2);
    const returnRow = result.rows.find((row) => row.documentType === 'RETURN')!;
    expect(returnRow.meeshoHasTcsReturn).toBe(true);
    expect(returnRow.meeshoReturnSubType).toBe('na');
    expect(returnRow.meeshoIsPreviousMonthReturn).toBe(true);
    expect(returnRow.invoiceAmount).toBe(500);
  });

  it('classifies TCS return rows with Type of Return #N/A from TCS Sales Return file', () => {
    const result = service.buildNormalizedRows(
      {
        tcsSales: {
          rows: [{ ...salesRow, sub_order_num: 'RET-NA-1' }],
          headers: [],
        },
        tcsSalesReturn: {
          rows: [
            {
              __sheetName: 'TCS Return',
              __rowNumber: 2,
              sub_order_num: 'RET-NA-1',
              cancel_return_date: '2026-04-10',
              'Type of Return': '#N/A',
              quantity: 2,
              total_invoice_value: 500,
              total_taxable_sale_value: 450,
              tax_amount: 50,
            },
          ],
          headers: [],
        },
        orderReport: { rows: [], headers: [] },
        returnInTransit: emptyLifecycle,
        returnOutForDelivery: emptyLifecycle,
        returnDeliveryComplete: emptyLifecycle,
      },
      'Maharashtra',
    );

    expect(result.rows).toHaveLength(2);
    const returnRow = result.rows.find((row) => row.documentType === 'RETURN')!;
    expect(returnRow.orderID).toBe('RET-NA-1');
    expect(returnRow.typeOfReturn).toBe('#N/A');
    expect(returnRow.meeshoIsGrossSale).toBe(false);
    expect(returnRow.meeshoReturnSubType).toBe('na');
    expect(returnRow.meeshoIsPreviousMonthReturn).toBe(true);
    expect(returnRow.invoiceAmount).toBe(500);
  });

});

