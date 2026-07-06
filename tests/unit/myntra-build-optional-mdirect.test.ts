import { MyntraImportService } from '../../src/report-import/services/myntra-import.service';
import { FileParserService } from '../../src/report-import/services/file-parser.service';
import { MappingService } from '../../src/report-import/services/mapping.service';

describe('MyntraImportService optional MDirect', () => {
  const service = new MyntraImportService(
    new FileParserService(),
    new MappingService(),
  );

  it('builds rows from GSTR + Sales only when MDirect Orders is empty', async () => {
    const parsed = {
      gstrReportPacked: {
        headers: ['order_id', 'seller_gstin'],
        rows: [
          {
            __sheetName: 'GSTR',
            __rowNumber: 2,
            order_id: 'ORD-1',
            seller_gstin: '07AAXFB7609K1ZS',
          },
        ],
      },
      mDirectOrders: { headers: [], rows: [] },
      salesRevenueB2c: {
        headers: ['Sale_Order_Code'],
        rows: [
          {
            __sheetName: 'Sales',
            __rowNumber: 2,
            Sale_Order_Code: 'ORD-1',
          },
        ],
      },
      gstrReportRto: { headers: [], rows: [] },
      gstrReportRt: { headers: [], rows: [] },
      mDirectReturns: { headers: [], rows: [] },
    };

    const result = await service.buildNormalizedRows(parsed);
    expect(result.rows.length).toBe(1);
    expect(result.joinIssues).toBeUndefined();
    expect(result.rows[0].documentType).toBe('SALE');
  });

  it('imports every GSTR packed row and adds separate RTO/RT return rows', async () => {
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
          {
            __sheetName: 'GSTR',
            __rowNumber: 3,
            order_id: 'ORD-2',
            seller_gstin: '07AAXFB7609K1ZS',
            quantity: 1,
            seller_price: 500,
            base_value: 423,
          },
          {
            __sheetName: 'GSTR',
            __rowNumber: 4,
            order_id: 'ORD-3',
            seller_gstin: '07AAXFB7609K1ZS',
            quantity: 1,
            seller_price: 300,
            base_value: 254,
          },
        ],
      },
      mDirectOrders: { headers: [], rows: [] },
      salesRevenueB2c: {
        headers: ['Sale_Order_Code'],
        rows: [
          {
            __sheetName: 'Sales',
            __rowNumber: 2,
            Sale_Order_Code: 'ORD-1',
          },
        ],
      },
      gstrReportRto: {
        headers: ['order_id'],
        rows: [
          {
            __sheetName: 'RTO',
            __rowNumber: 2,
            order_id: 'ORD-2',
          },
        ],
      },
      gstrReportRt: {
        headers: ['shipment_id'],
        rows: [
          {
            __sheetName: 'RT',
            __rowNumber: 2,
            shipment_id: 'ORD-3',
          },
        ],
      },
      mDirectReturns: { headers: [], rows: [] },
    };

    const result = await service.buildNormalizedRows(parsed);
    expect(result.rows.filter((row) => row.documentType === 'SALE')).toHaveLength(3);
    expect(result.rows.filter((row) => row.documentType === 'RTO Return')).toHaveLength(1);
    expect(result.rows.filter((row) => row.documentType === 'Customer Return')).toHaveLength(1);
    expect(result.rows).toHaveLength(5);
  });
});
