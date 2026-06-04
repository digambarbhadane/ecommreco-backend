import * as XLSX from 'xlsx';
import { FileParserService } from '../../src/report-import/services/file-parser.service';

function buildMdirectReturnsBuffer() {
  const data = [
    [
      'Seller Id',
      'Warehouse Id',
      'Order Id',
      'Seller SKU',
      'Style Id',
      'Myntra SKU',
      'Brand',
      'Order Date',
      'Return Date',
      'Delivered Date',
      'Qty',
      'Return Mode',
      'Store Order Id',
      'Phone',
      'Release Id',
      'UUID',
      'Return Type',
      'Tracking',
      'Status',
      'Reason',
      'Detailed Reason',
      'Notes',
      'Extra',
      'More',
      'Last',
    ],
    [
      '14184',
      '32224',
      'BIISTOPS107774855',
      'BRSTP157BLACK-4XL',
      '29094954',
      '107774855',
      'BRINNS',
      '14-04-2026',
      '16-04-2026',
      '18-04-2026',
      '25-04-2026',
      '25-04-2026',
      '1',
      '1.00E+11',
      '100041444942',
      '5847112690',
      '11096173901',
      '6aad9674-20a3-4111-87f8-a26148bb04f8',
      'Return',
      '1.00E+11',
      'Customer',
      'Size issue',
      'Note',
      'X',
      'Y',
    ],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function buildMdirectOrdersBuffer() {
  const data = [
    ['MDirect Orders'],
    [''],
    ['order_release_id', 'seller_sku_code'],
    ['REL-100', 'SKU-ABC'],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('FileParserService Myntra workbooks', () => {
  const parser = new FileParserService();

  it('uses row 0 as headers for MDirect Returns when row 1 contains Return status text', () => {
    const parsed = parser.parseMyntraWorkbook(
      buildMdirectReturnsBuffer(),
      'mDirectReturns',
    );
    expect(parsed.headers).toContain('Order Id');
    expect(parsed.headers).not.toContain('14184');
    expect(parsed.rows.length).toBeGreaterThanOrEqual(1);
    const dataRow = parsed.rows[0];
    expect(String(dataRow['Order Id'] ?? dataRow.order_id)).toBe(
      'BIISTOPS107774855',
    );
  });

  it('parses MDirect Orders without seller GSTIN column', () => {
    const parsed = parser.parseMyntraWorkbook(
      buildMdirectOrdersBuffer(),
      'mDirectOrders',
    );
    expect(parsed.rows.length).toBeGreaterThanOrEqual(1);
    const dataRow = parsed.rows.find(
      (row) => String(row.order_release_id).trim() === 'REL-100',
    );
    expect(dataRow).toBeDefined();
    expect(String(dataRow?.seller_sku_code)).toBe('SKU-ABC');
  });
});
