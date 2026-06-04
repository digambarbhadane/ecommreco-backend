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
  });
});
