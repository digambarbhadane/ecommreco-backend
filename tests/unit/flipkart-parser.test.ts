import * as XLSX from 'xlsx';
import { FileParserService } from '../../src/report-import/services/file-parser.service';
import { filterRowsBySelectedGstin } from '../../src/report-import/config/importMappings/gst-column.util';
import { flipkartImportMapping } from '../../src/report-import/config/importMappings/flipkart.mapping';

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

  it('reads Seller GSTIN when main header row leaves GST column empty', () => {
    const salesData = [
      ['Report'],
      ['', 'Order ID', 'Taxable Value'],
      ['Seller GSTIN', 'Order ID', 'Taxable Value'],
      ['07AAXFB7609K1ZS', 'ORD-1', '100'],
    ];
    const cashbackData = [
      ['Cash Back Report'],
      ['', 'Order ID'],
      ['Seller GSTIN', 'Order ID'],
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
    expect(parsed.salesRows.length).toBeGreaterThanOrEqual(1);
    const gstKey = Object.keys(parsed.salesRows[0]).find((k) =>
      k.toLowerCase().includes('seller gstin'),
    );
    expect(gstKey).toBeDefined();
    expect(String(parsed.salesRows[0][gstKey!]).replace(/\s+/g, '').toUpperCase()).toBe(
      '07AAXFB7609K1ZS',
    );
  });

  it('forward-fills Seller GSTIN on subsequent rows (Flipkart export pattern)', () => {
    const salesData = [
      ['Seller GSTIN', 'Order ID', 'Taxable Value'],
      ['27AAAAA0000A1Z5', 'ORD-1', '100'],
      ['', 'ORD-2', '200'],
      ['', 'ORD-3', '300'],
      ['29BBBBB0000B1Z5', 'ORD-4', '400'],
      ['', 'ORD-5', '500'],
    ];
    const cashbackData = [
      ['Seller GSTIN', 'Order ID'],
      ['27AAAAA0000A1Z5', 'ORD-6'],
      ['', 'ORD-7'],
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
    expect(parsed.gstinValues).toEqual(
      expect.arrayContaining(['27AAAAA0000A1Z5', '29BBBBB0000B1Z5']),
    );

    const filtered = filterRowsBySelectedGstin(
      parsed.salesRows,
      flipkartImportMapping,
      parsed.headers['Sales Report'],
      '27AAAAA0000A1Z5',
    );
    expect(filtered.matchedCount).toBe(3);
    expect(filtered.skippedCount).toBe(2);
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
