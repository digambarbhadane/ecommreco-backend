import { MyntraImportService } from '../../src/report-import/services/myntra-import.service';
import { MappingService } from '../../src/report-import/services/mapping.service';
import { FileParserService } from '../../src/report-import/services/file-parser.service';

describe('MyntraImportService', () => {
  const service = new MyntraImportService(
    new FileParserService(),
    new MappingService(),
  );

  const baseContext = {
    sellerIds: ['seller-1'],
    gstin: '07AAXFB7609K1ZS',
    marketplaceId: 'myntra-mp',
    reportMonth: '2025-06',
  };

  it('merges GSTR, Sales Revenue, and MDirect into one sale per order', async () => {
    const parsed = {
      gstrReportPacked: {
        headers: ['order_id', 'seller_gstin', 'quantity', 'seller_price', 'base_value'],
        rows: [
          {
            __sheetName: 'GSTR',
            __rowNumber: 2,
            order_id: 'ORD-1',
            seller_gstin: '07AAXFB7609K1ZS',
            quantity: 1,
            seller_price: 1000,
            base_value: 847,
          },
        ],
      },
      mDirectOrders: {
        headers: ['order_release_id', 'seller_sku_code'],
        rows: [
          {
            __sheetName: 'MDirect',
            __rowNumber: 2,
            order_release_id: 'ORD-1',
            seller_sku_code: 'SKU-ABC',
          },
        ],
      },
      salesRevenueB2c: {
        headers: ['Sale_Order_Code', 'Hsn', 'Invoice_Number', 'Packing_Date'],
        rows: [
          {
            __sheetName: 'Sales',
            __rowNumber: 2,
            Sale_Order_Code: 'ORD-1',
            Hsn: '6109',
            Invoice_Number: 'INV-001',
            Packing_Date: '2025-06-15',
          },
        ],
      },
      gstrReportRto: { headers: [], rows: [] },
      gstrReportRt: { headers: [], rows: [] },
      mDirectReturns: { headers: [], rows: [] },
    };

    const result = await service.buildNormalizedRows(parsed, baseContext);
    expect(result.rows).toHaveLength(1);
    const sale = result.rows[0];
    expect(sale.documentType).toBe('SALE');
    expect(sale.myntraTransactionType).toBe('SALE');
    expect(sale.orderID).toBe('ORD-1');
    expect(sale.skuID).toBe('SKU-ABC');
    expect(sale.hsnCode).toBe('6109');
    expect(sale.invoiceNo).toBe('INV-001');
    expect(sale.taxableAmount).toBe(847);
  });

  it('creates separate RTO and RT return rows with negated GST from sale', async () => {
    const parsed = {
      gstrReportPacked: {
        headers: ['order_id', 'seller_gstin', 'quantity', 'seller_price', 'base_value', 'igst_amt'],
        rows: [
          {
            __sheetName: 'GSTR',
            __rowNumber: 2,
            order_id: 'ORD-1',
            seller_gstin: '07AAXFB7609K1ZS',
            quantity: 1,
            seller_price: 1000,
            base_value: 847,
            igst_amt: 153,
          },
        ],
      },
      mDirectOrders: { headers: [], rows: [] },
      salesRevenueB2c: {
        headers: ['Sale_Order_Code', 'Packing_Date'],
        rows: [
          {
            __sheetName: 'Sales',
            __rowNumber: 2,
            Sale_Order_Code: 'ORD-1',
            Packing_Date: '2025-06-01',
          },
        ],
      },
      gstrReportRto: {
        headers: ['order_id', 'order_cancel_date'],
        rows: [
          {
            __sheetName: 'RTO',
            __rowNumber: 2,
            order_id: 'ORD-1',
            order_cancel_date: '2025-06-20',
          },
        ],
      },
      gstrReportRt: {
        headers: ['packet_id', 'fr_refunded_date'],
        rows: [
          {
            __sheetName: 'RT',
            __rowNumber: 2,
            packet_id: 'ORD-2',
            fr_refunded_date: '2025-06-25',
          },
        ],
      },
      mDirectReturns: { headers: [], rows: [] },
    };

    const result = await service.buildNormalizedRows(parsed, baseContext);
    const rto = result.rows.find((row) => row.documentType === 'RTO Return');
    const rt = result.rows.find((row) => row.documentType === 'Customer Return');
    expect(rto).toBeDefined();
    expect(rt).toBeDefined();
    expect(rto?.myntraReturnMatchStatus).toBe('MATCHED_CURRENT_MONTH');
    expect(rto?.taxableAmount).toBe(-847);
    expect(rto?.igstAmount).toBe(-153);
    expect(rto?.orderCancelDate).toBeTruthy();
    expect(rto?.invoiceDate).toBeUndefined();
    expect(rt?.frRefundedDate).toBeTruthy();
    expect(result.rows.find((row) => row.documentType === 'SALE')?.myntraIsReturned).toBe(
      true,
    );
  });

  it('rewrites matched RTO orderID to the original sale Order Id when they differ', async () => {
    const parsed = {
      gstrReportPacked: {
        headers: [
          'order_id',
          'seller_gstin',
          'quantity',
          'seller_price',
          'base_value',
          'igst_amt',
        ],
        rows: [
          {
            __sheetName: 'GSTR',
            __rowNumber: 2,
            order_id: '5698497068',
            seller_gstin: '07AAXFB7609K1ZS',
            quantity: 1,
            seller_price: 1846,
            base_value: 1564,
            igst_amt: 282,
          },
        ],
      },
      mDirectOrders: { headers: [], rows: [] },
      salesRevenueB2c: {
        headers: ['Sale_Order_Code', 'Invoice_Number', 'Packing_Date'],
        rows: [
          {
            __sheetName: 'Sales',
            __rowNumber: 2,
            Sale_Order_Code: '5698497068',
            Invoice_Number: 'I2426MX000000365',
            Packing_Date: '2025-05-12',
          },
        ],
      },
      gstrReportRto: {
        headers: ['order_id', 'invoice_number', 'order_cancel_date'],
        rows: [
          {
            __sheetName: 'RTO',
            __rowNumber: 2,
            order_id: '8846287633',
            invoice_number: 'I2426MX000000365',
            order_cancel_date: '2025-12-08',
          },
        ],
      },
      gstrReportRt: { headers: [], rows: [] },
      mDirectReturns: { headers: [], rows: [] },
    };

    const result = await service.buildNormalizedRows(parsed, baseContext);
    const sale = result.rows.find((row) => row.documentType === 'SALE');
    const rto = result.rows.find((row) => row.documentType === 'RTO Return');
    expect(sale?.orderID).toBe('5698497068');
    expect(sale?.invoiceNo).toBe('I2426MX000000365');
    expect(rto?.myntraReturnMatchStatus).toBe('MATCHED_CURRENT_MONTH');
    expect(rto?.orderID).toBe('5698497068');
    expect(rto?.invoiceAmount).toBe(-1846);
  });

  it('infers igst_rate from RT amounts when rate column is missing', async () => {
    const parsed = {
      gstrReportPacked: { headers: [], rows: [] },
      mDirectOrders: { headers: [], rows: [] },
      salesRevenueB2c: { headers: [], rows: [] },
      gstrReportRto: { headers: [], rows: [] },
      gstrReportRt: {
        headers: [
          'shipment_id',
          'fr_refunded_date',
          'base_value',
          'seller_price',
          'igst_amt',
          'customer_delivery_state_code',
        ],
        rows: [
          {
            __sheetName: 'RT',
            __rowNumber: 2,
            shipment_id: '5495127221',
            fr_refunded_date: '2025-06-06',
            base_value: 1535.714286,
            seller_price: 1720,
            igst_amt: 184.28571432,
            customer_delivery_state_code: '09',
          },
        ],
      },
      mDirectReturns: { headers: [], rows: [] },
    };

    const mapping = new MappingService();
    const result = await service.buildNormalizedRows(parsed, {
      ...baseContext,
      gstin: '24ESNPK1432B1Z5',
    });
    const rt = result.rows.find((row) => row.documentType === 'Customer Return');
    expect(rt?.orderID).toBe('5495127221');
    expect(rt?.myntraReturnMatchStatus).toBe('UNMATCHED_RETURN');
    mapping.normalizeTaxByState(rt!, ['Gujarat'], ['24ESNPK1432B1Z5']);
    expect(rt?.igstRate).toBe(12);
    expect(rt?.igstAmount).toBe(-184.28571432);
    expect(rt?.gstTransactionType).toBe('inter');
  });

  it('picks shipment_id as orderID for GSTR Report RT and ignores other order ID columns', async () => {
    const parsed = {
      gstrReportPacked: { headers: [], rows: [] },
      mDirectOrders: { headers: [], rows: [] },
      salesRevenueB2c: { headers: [], rows: [] },
      gstrReportRto: { headers: [], rows: [] },
      gstrReportRt: {
        headers: [
          'shipment_id',
          'order_id',
          'Order ID',
          'order_release_id',
          'sale_order_code',
          'Sale_Order_Code',
          'fr_refunded_date',
          'base_value',
          'seller_price',
          'igst_amt',
        ],
        rows: [
          {
            __sheetName: 'RT',
            __rowNumber: 2,
            shipment_id: 'SHP-999888',
            order_id: 'IGNORED-ORD-1',
            'Order ID': 'IGNORED-ORD-2',
            order_release_id: 'IGNORED-ORD-3',
            sale_order_code: 'IGNORED-ORD-4',
            Sale_Order_Code: 'IGNORED-ORD-5',
            fr_refunded_date: '2025-06-06',
            base_value: 1000,
            seller_price: 1120,
            igst_amt: 120,
          },
        ],
      },
      mDirectReturns: { headers: [], rows: [] },
    };

    const result = await service.buildNormalizedRows(parsed, baseContext);
    const rt = result.rows.find((row) => row.documentType === 'Customer Return');
    expect(rt).toBeDefined();
    expect(rt?.orderID).toBe('SHP-999888');
  });

  it('parses percentage GST rate strings from RT file', async () => {
    const parsed = {
      gstrReportPacked: { headers: [], rows: [] },
      mDirectOrders: { headers: [], rows: [] },
      salesRevenueB2c: { headers: [], rows: [] },
      gstrReportRto: { headers: [], rows: [] },
      gstrReportRt: {
        headers: ['packet_id', 'fr_refunded_date', 'IGST %', 'base_value', 'igst_amt'],
        rows: [
          {
            __sheetName: 'RT',
            __rowNumber: 2,
            packet_id: 'ORD-PCT',
            fr_refunded_date: '2025-06-25',
            'IGST %': '12%',
            base_value: 1000,
            igst_amt: 120,
          },
        ],
      },
      mDirectReturns: { headers: [], rows: [] },
    };

    const result = await service.buildNormalizedRows(parsed, baseContext);
    const rt = result.rows.find((row) => row.documentType === 'Customer Return');
    expect(rt?.igstRate).toBe(12);
  });

  it('stores igst_rate, cgst_rate, sgst_rate from GSTR Report RT file', async () => {
    const parsed = {
      gstrReportPacked: { headers: [], rows: [] },
      mDirectOrders: { headers: [], rows: [] },
      salesRevenueB2c: { headers: [], rows: [] },
      gstrReportRto: { headers: [], rows: [] },
      gstrReportRt: {
        headers: [
          'packet_id',
          'fr_refunded_date',
          'igst_rate',
          'cgst_rate',
          'sgst_rate',
          'base_value',
          'igst_amt',
          'cgst_amt',
          'sgst_amt',
        ],
        rows: [
          {
            __sheetName: 'RT',
            __rowNumber: 2,
            packet_id: 'ORD-RT-1',
            fr_refunded_date: '2025-06-25',
            igst_rate: 5,
            cgst_rate: 2.5,
            sgst_rate: 2.5,
            base_value: 1000,
            igst_amt: 50,
            cgst_amt: 25,
            sgst_amt: 25,
          },
        ],
      },
      mDirectReturns: { headers: [], rows: [] },
    };

    const result = await service.buildNormalizedRows(parsed, baseContext);
    const rt = result.rows.find((row) => row.documentType === 'Customer Return');
    expect(rt).toBeDefined();
    expect(rt?.igstRate).toBe(5);
    expect(rt?.cgstRate).toBe(2.5);
    expect(rt?.sgstRate).toBe(2.5);
    expect(rt?.taxableAmount).toBe(-1000);
    expect(rt?.igstAmount).toBe(-50);
    expect(rt?.cgstAmount).toBe(-25);
    expect(rt?.sgstAmount).toBe(-25);
  });

  it('marks cross-month returns as MATCHED_PREVIOUS_MONTH when historical sale exists', async () => {
    const rowModel = {
      find: () => ({
        select: () => ({
          sort: () => ({
            lean: () => ({
              exec: async () => [
                {
                  _id: 'prior-sale-id',
                  orderID: 'ORD-MAY',
                  reportMonth: '2025-05',
                  quantity: 2,
                  seller_price: 500,
                  taxableAmount: 400,
                  igstAmount: 72,
                  invoiceAmount: 500,
                },
              ],
            }),
          }),
        }),
      }),
    };

    const serviceWithDb = new MyntraImportService(
      new FileParserService(),
      new MappingService(),
      rowModel as never,
    );

    const parsed = {
      gstrReportPacked: { headers: [], rows: [] },
      mDirectOrders: { headers: [], rows: [] },
      salesRevenueB2c: { headers: [], rows: [] },
      gstrReportRto: {
        headers: ['order_id', 'order_cancel_date'],
        rows: [
          {
            __sheetName: 'RTO',
            __rowNumber: 2,
            order_id: 'ORD-MAY',
            order_cancel_date: '2025-06-10',
          },
        ],
      },
      gstrReportRt: { headers: [], rows: [] },
      mDirectReturns: { headers: [], rows: [] },
    };

    const result = await serviceWithDb.buildNormalizedRows(parsed, baseContext);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].myntraReturnMatchStatus).toBe('MATCHED_PREVIOUS_MONTH');
    expect(result.rows[0].linkedSaleRowId).toBe('prior-sale-id');
    expect(result.rows[0].saleReferenceMonth).toBe('2025-05');
    expect(result.historicalSaleIdsToMarkReturned).toEqual(['prior-sale-id']);
    expect(result.rows[0].taxableAmount).toBe(-400);
  });

  it('persists UNMATCHED_RETURN when no sale is found', async () => {
    const parsed = {
      gstrReportPacked: { headers: [], rows: [] },
      mDirectOrders: { headers: [], rows: [] },
      salesRevenueB2c: { headers: [], rows: [] },
      gstrReportRto: {
        headers: ['order_id', 'order_cancel_date', 'base_value', 'seller_price', 'quantity'],
        rows: [
          {
            __sheetName: 'RTO',
            __rowNumber: 2,
            order_id: 'ORPHAN-1',
            order_cancel_date: '2025-06-10',
            base_value: 500,
            seller_price: 590,
            quantity: 1,
          },
        ],
      },
      gstrReportRt: { headers: [], rows: [] },
      mDirectReturns: { headers: [], rows: [] },
    };

    const result = await service.buildNormalizedRows(parsed, baseContext);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].myntraReturnMatchStatus).toBe('UNMATCHED_RETURN');
    expect(result.rows[0].myntraTransactionType).toBe('RETURN');
    expect(result.rows[0].orderID).toBe('ORPHAN-1');
    expect(result.rows[0].taxableAmount).toBe(-500);
    expect(result.rows[0].invoiceAmount).toBe(-590);
    expect(result.rows[0].quantity).toBe(-1);
  });

  it('imports every RTO row even when order is absent from GSTR Packed and Sales', async () => {
    const parsed = {
      gstrReportPacked: {
        headers: ['order_id', 'seller_gstin', 'quantity', 'seller_price', 'base_value'],
        rows: [
          {
            __sheetName: 'GSTR',
            __rowNumber: 2,
            order_id: 'ORD-CURRENT',
            seller_gstin: '07AAXFB7609K1ZS',
            quantity: 1,
            seller_price: 1000,
            base_value: 847,
          },
        ],
      },
      mDirectOrders: { headers: [], rows: [] },
      salesRevenueB2c: { headers: [], rows: [] },
      gstrReportRto: {
        headers: ['order_id', 'order_cancel_date'],
        rows: [
          {
            __sheetName: 'RTO',
            __rowNumber: 2,
            order_id: 'ORD-CURRENT',
            order_cancel_date: '2025-06-20',
          },
          {
            __sheetName: 'RTO',
            __rowNumber: 3,
            order_id: 'ORD-PRIOR-NOT-IN-GSTR',
            order_cancel_date: '2025-06-21',
          },
        ],
      },
      gstrReportRt: { headers: [], rows: [] },
      mDirectReturns: { headers: [], rows: [] },
    };

    const result = await service.buildNormalizedRows(parsed, baseContext);
    const rtoRows = result.rows.filter((row) => row.documentType === 'RTO Return');
    expect(rtoRows).toHaveLength(2);
    expect(rtoRows.map((row) => row.orderID).sort()).toEqual([
      'ORD-CURRENT',
      'ORD-PRIOR-NOT-IN-GSTR',
    ]);
    expect(
      rtoRows.find((row) => row.orderID === 'ORD-PRIOR-NOT-IN-GSTR')?.myntraReturnMatchStatus,
    ).toBe('UNMATCHED_RETURN');
  });

  it('keeps RTO documentType when MDirect Returns is merged', async () => {
    const parsed = {
      gstrReportPacked: { headers: [], rows: [] },
      mDirectOrders: { headers: [], rows: [] },
      salesRevenueB2c: { headers: [], rows: [] },
      gstrReportRto: {
        headers: ['order_id', 'order_cancel_date'],
        rows: [
          {
            __sheetName: 'RTO',
            __rowNumber: 2,
            order_id: 'RTO-1',
            order_cancel_date: '2025-06-10',
          },
        ],
      },
      gstrReportRt: { headers: [], rows: [] },
      mDirectReturns: {
        headers: ['order_id', 'return_mode', 'seller_sku_code'],
        rows: [
          {
            __sheetName: 'MDirectReturns',
            __rowNumber: 2,
            order_id: 'RTO-1',
            return_mode: 'RTO',
            seller_sku_code: 'SKU-RTO',
          },
        ],
      },
    };

    const result = await service.buildNormalizedRows(parsed, baseContext);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].documentType).toBe('RTO Return');
    expect(result.rows[0].myntraTransactionType).toBe('RETURN');
    expect(result.rows[0].skuID).toBe('SKU-RTO');
  });

  it('matches prior-month sale by order_id when invoice no is missing on RTO row', async () => {
    const rowModel = {
      find: () => ({
        select: () => ({
          sort: () => ({
            lean: () => ({
              exec: async () => [
                {
                  _id: 'prior-sale-no-invoice',
                  orderID: 'ORD-MAY-NO-INV',
                  reportMonth: '2025-05',
                  quantity: 1,
                  taxableAmount: 400,
                  igstAmount: 72,
                  invoiceAmount: 472,
                },
              ],
            }),
          }),
        }),
      }),
    };

    const serviceWithDb = new MyntraImportService(
      new FileParserService(),
      new MappingService(),
      rowModel as never,
    );

    const parsed = {
      gstrReportPacked: { headers: [], rows: [] },
      mDirectOrders: { headers: [], rows: [] },
      salesRevenueB2c: { headers: [], rows: [] },
      gstrReportRto: {
        headers: ['order_id', 'order_cancel_date', 'base_value'],
        rows: [
          {
            __sheetName: 'RTO',
            __rowNumber: 2,
            order_id: 'ORD-MAY-NO-INV',
            order_cancel_date: '2025-06-10',
            base_value: 999,
          },
        ],
      },
      gstrReportRt: { headers: [], rows: [] },
      mDirectReturns: { headers: [], rows: [] },
    };

    const result = await serviceWithDb.buildNormalizedRows(parsed, baseContext);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].myntraReturnMatchStatus).toBe('MATCHED_PREVIOUS_MONTH');
    expect(result.rows[0].igstAmount).toBe(-72);
    expect(result.rows[0].taxableAmount).toBe(-400);
  });

  it('imports duplicate order_id RTO rows as separate return records', async () => {
    const parsed = {
      gstrReportPacked: { headers: [], rows: [] },
      mDirectOrders: { headers: [], rows: [] },
      salesRevenueB2c: { headers: [], rows: [] },
      gstrReportRto: {
        headers: ['order_id', 'order_cancel_date', 'igst_amt'],
        rows: [
          {
            __sheetName: 'RTO',
            __rowNumber: 2,
            order_id: 'ORD-DUP',
            order_cancel_date: '2025-06-10',
            igst_amt: 50,
          },
          {
            __sheetName: 'RTO',
            __rowNumber: 3,
            order_id: 'ORD-DUP',
            order_cancel_date: '2025-06-11',
            igst_amt: 60,
          },
        ],
      },
      gstrReportRt: { headers: [], rows: [] },
      mDirectReturns: { headers: [], rows: [] },
    };

    const result = await service.buildNormalizedRows(parsed, baseContext);
    const rtoRows = result.rows.filter((row) => row.documentType === 'RTO Return');
    expect(rtoRows).toHaveLength(2);
    expect(rtoRows.map((row) => row.igstAmount).sort()).toEqual([-50, -60]);
  });

  it('preserves RTO tax values when matched historical sale lacks tax fields', async () => {
    const rowModel = {
      find: () => ({
        select: () => ({
          sort: () => ({
            lean: () => ({
              exec: async () => [
                {
                  _id: 'prior-sale-no-tax',
                  orderID: 'ORD-HIST-NO-TAX',
                  reportMonth: '2025-05',
                  quantity: 1,
                  taxableAmount: 400,
                  invoiceAmount: 472,
                },
              ],
            }),
          }),
        }),
      }),
    };

    const serviceWithDb = new MyntraImportService(
      new FileParserService(),
      new MappingService(),
      rowModel as never,
    );

    const parsed = {
      gstrReportPacked: { headers: [], rows: [] },
      mDirectOrders: { headers: [], rows: [] },
      salesRevenueB2c: { headers: [], rows: [] },
      gstrReportRto: {
        headers: ['order_id', 'order_cancel_date', 'base_value', 'igst_amt', 'cgst_amt', 'sgst_amt'],
        rows: [
          {
            __sheetName: 'RTO',
            __rowNumber: 2,
            order_id: 'ORD-HIST-NO-TAX',
            order_cancel_date: '2025-06-10',
            base_value: 400,
            igst_amt: 72,
            cgst_amt: 0,
            sgst_amt: 0,
          },
        ],
      },
      gstrReportRt: { headers: [], rows: [] },
      mDirectReturns: { headers: [], rows: [] },
    };

    const result = await serviceWithDb.buildNormalizedRows(parsed, baseContext);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].myntraReturnMatchStatus).toBe('MATCHED_PREVIOUS_MONTH');
    expect(result.rows[0].igstAmount).toBe(-72);
  });

  it('keeps RTO IGST when historical sale has zero IGST', async () => {
    const rowModel = {
      find: () => ({
        select: () => ({
          sort: () => ({
            lean: () => ({
              exec: async () => [
                {
                  _id: 'prior-sale-zero-tax',
                  orderID: 'ORD-HIST-ZERO-TAX',
                  reportMonth: '2025-05',
                  quantity: 1,
                  taxableAmount: 400,
                  invoiceAmount: 472,
                  igstAmount: 0,
                },
              ],
            }),
          }),
        }),
      }),
    };

    const serviceWithDb = new MyntraImportService(
      new FileParserService(),
      new MappingService(),
      rowModel as never,
    );

    const parsed = {
      gstrReportPacked: { headers: [], rows: [] },
      mDirectOrders: { headers: [], rows: [] },
      salesRevenueB2c: { headers: [], rows: [] },
      gstrReportRto: {
        headers: ['order_id', 'order_cancel_date', 'igst_amt'],
        rows: [
          {
            __sheetName: 'RTO',
            __rowNumber: 2,
            order_id: 'ORD-HIST-ZERO-TAX',
            order_cancel_date: '2025-06-10',
            igst_amt: 72,
          },
        ],
      },
      gstrReportRt: { headers: [], rows: [] },
      mDirectReturns: { headers: [], rows: [] },
    };

    const result = await serviceWithDb.buildNormalizedRows(parsed, baseContext);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].myntraReturnMatchStatus).toBe('MATCHED_PREVIOUS_MONTH');
    expect(result.rows[0].igstAmount).toBe(-72);
  });
});
