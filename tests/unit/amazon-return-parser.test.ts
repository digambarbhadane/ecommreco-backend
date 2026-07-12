import * as XLSX from 'xlsx';
import { FileParserService } from '../../src/report-import/services/file-parser.service';
import { AmazonImportService } from '../../src/report-import/services/amazon-import.service';
import { MappingService } from '../../src/report-import/services/mapping.service';

function buildAmazonReturnWorkbook() {
  const data = [
    ['Order Id', 'Return Type', 'Return Reason'],
    ['402-1234567-8901234', 'C-Returns', 'Customer changed mind'],
    ['402-9876543-2109876', 'Rejected', 'Delivery failed'],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(data),
    'Returns Report',
  );
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('FileParserService Amazon Return', () => {
  const parser = new FileParserService();
  const amazonImport = new AmazonImportService(parser, new MappingService());

  it('parses return rows when headers are on row 1 and data starts on row 2', () => {
    const parsed = parser.parseAmazonReturnWorkbook(buildAmazonReturnWorkbook());
    expect(parsed.rows.length).toBe(2);
    expect(parsed.headers).toEqual(
      expect.arrayContaining(['Order Id', 'Return Type']),
    );
  });

  it('indexes return details by order id', () => {
    const parsed = parser.parseAmazonReturnWorkbook(buildAmazonReturnWorkbook());
    const index = amazonImport.indexReturnDetailsByOrderId(parsed.rows);
    expect(index.get('402-1234567-8901234')?.typeOfReturn).toBe('Customer Return');
    expect(index.get('402-1234567-8901234')?.returnReason).toBe(
      'Customer changed mind',
    );
    expect(index.get('402-9876543-2109876')?.amazonReturnSubType).toBe('rto');
  });

  it('parses rows when !ref only covers the header row', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Order Id', 'Return Type'],
    ]);
    XLSX.utils.sheet_add_aoa(
      sheet,
      [['402-1111111-2222222', 'C-Returns']],
      { origin: 'A2' },
    );
    sheet['!ref'] = 'A1:B1';

    const parserAny = parser as unknown as {
      parseSheetData: (
        sheet: XLSX.WorkSheet,
        sheetName: string,
        headerRowIndex: number,
        gstColumns: string[],
      ) => typeof parsed.rows;
    };

    const rows = parserAny.parseSheetData(sheet, 'Returns Report', 0, []);
    expect(rows.length).toBe(1);
  });
});
