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
});
