import * as XLSX from 'xlsx';
import { FileParserService } from '../../src/report-import/services/file-parser.service';

function buildFlipkartWorkbook() {
  const salesData = [
    ['Flipkart Sales Report'],
    [''],
    ['Seller GSTIN', 'Order ID', 'Buyer Invoice Date', 'Taxable Value', 'Event Type'],
    ['07AAXFB7609K1ZS', 'ORD-001', '2026-04-01', '1000', 'Sale'],
    ['07AAXFB7609K1ZS', 'ORD-002', '2026-04-02', '500', 'Sale'],
  ];
  const cashbackData = [
    ['Cash Back Report'],
    [''],
    ['Seller GSTIN', 'Order ID', 'Invoice Date', 'Taxable Value', 'Document Type'],
    ['07AAXFB7609K1ZS', 'ORD-003', '2026-04-03', '50', 'Credit Note'],
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(salesData),
    'Sales Report',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(cashbackData),
    'Cash Back Report',
  );
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('FileParserService Flipkart', () => {
  const parser = new FileParserService();

  it('parses GSTIN with two-row header (GST NO + Seller GSTIN)', () => {
    const salesData = [
      ['Report'],
      ['GST NO', 'Order ID', 'Taxable Value'],
      ['Seller GSTIN', '', ''],
      ['07AAXFB7609K1ZS', 'ORD-1', '100'],
    ];
    const cashbackData = [
      ['Cash Back Report'],
      ['GST NO', 'Order ID'],
      ['Seller GSTIN', ''],
      ['07AAXFB7609K1ZS', 'ORD-2'],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(salesData),
      'Sales Report',
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(cashbackData),
      'Cash Back Report',
    );
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const parsed = parser.parseFlipkartWorkbook(buffer);
    expect(parsed.gstinValues).toContain('07AAXFB7609K1ZS');
  });

  it('reads GSTIN when column is not the first column (sparse row fix)', () => {
    const salesData = [
      ['', 'Seller GSTIN', 'Order ID'],
      ['', '07AAXFB7609K1ZS', 'ORD-1'],
      ['', '07AAXFB7609K1ZS', 'ORD-2'],
    ];
    const cashbackData = [
      ['', 'Seller GSTIN', 'Order ID'],
      ['', '07AAXFB7609K1ZS', 'ORD-3'],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(salesData),
      'Sales Report',
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(cashbackData),
      'Cash Back Report',
    );
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const parsed = parser.parseFlipkartWorkbook(buffer);
    expect(parsed.gstinValues).toContain('07AAXFB7609K1ZS');
  });

  it('parses Seller GSTIN from Sales and Cash Back sheets', () => {
    const buffer = buildFlipkartWorkbook();
    const parsed = parser.parseFlipkartWorkbook(buffer);

    expect(parsed.salesRows.length).toBeGreaterThanOrEqual(1);
    expect(parsed.gstinValues).toContain('07AAXFB7609K1ZS');

    const firstSales = parsed.salesRows[0];
    const gstKey = Object.keys(firstSales).find((k) =>
      k.toLowerCase().includes('seller gstin'),
    );
    expect(gstKey).toBeDefined();
    expect(String(firstSales[gstKey!]).replace(/\s+/g, '').toUpperCase()).toBe(
      '07AAXFB7609K1ZS',
    );
  });
});
