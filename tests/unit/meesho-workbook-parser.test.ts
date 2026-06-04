import * as XLSX from 'xlsx';
import { FileParserService } from '../../src/report-import/services/file-parser.service';

function buildMeeshoTcsSalesBuffer() {
  const data = [
    ['TCS Sales Report'],
    [''],
    [
      'gstin',
      'sub_order_num',
      'hsn_code',
      'quantity',
      'total_invoice_value',
      'total_taxable_sale_value',
      'gst_rate',
      'tax_amount',
      'order_date',
      'end_customer_state_new',
    ],
    [
      '27AAAAA0000A1Z5',
      'ORD-100',
      '6109',
      2,
      1000,
      900,
      12,
      108,
      '01/04/2026',
      'Maharashtra',
    ],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('FileParserService Meesho workbooks', () => {
  const parser = new FileParserService();

  it('parses TCS Sales Report rows with gstin and sub_order_num', () => {
    const parsed = parser.parseMeeshoWorkbook(
      buildMeeshoTcsSalesBuffer(),
      'tcsSales',
    );
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(parsed.headers.map((h) => h.toLowerCase())).toEqual(
      expect.arrayContaining(['gstin', 'sub_order_num']),
    );
    expect(String(parsed.rows[0].gstin).toUpperCase()).toContain('27AAAAA0000A1Z5');
    expect(String(parsed.rows[0].sub_order_num)).toBe('ORD-100');
  });
});
