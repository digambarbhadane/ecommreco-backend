import * as XLSX from 'xlsx';
import { FileParserService } from '../../src/report-import/services/file-parser.service';
import { filterRowsBySelectedGstin, hydrateFlipkartRowsWithProfileGstin } from '../../src/report-import/config/importMappings/gst-column.util';
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

  it('ignores title rows that mention Seller GSTIN but are not column headers', () => {
    const salesData = [
      ['Flipkart Seller GSTIN sales export summary'],
      [''],
      ['Seller GSTIN', 'Order ID', 'Taxable Value'],
      ['24ESNPK1432B1Z5', 'ORD-1', '1000'],
    ];
    const cashbackData = [
      ['Cash Back Report'],
      ['Seller GSTIN', 'Order ID'],
      ['24ESNPK1432B1Z5', 'ORD-2'],
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
    expect(parsed.gstinValues).toContain('24ESNPK1432B1Z5');
    expect(parsed.salesRows.length).toBeGreaterThanOrEqual(1);
  });

  it('reads GSTIN from GST NO column when Seller GSTIN header cell is blank', () => {
    const salesData = [
      ['GST NO', 'Order ID', 'Taxable Value'],
      ['Seller GSTIN', '', ''],
      ['24ESNPK1432B1Z5', 'ORD-1', '1000'],
      ['', 'ORD-2', '500'],
    ];
    const cashbackData = [
      ['GST NO', 'Order ID'],
      ['Seller GSTIN', ''],
      ['24ESNPK1432B1Z5', 'ORD-3'],
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
    expect(parsed.gstinValues).toContain('24ESNPK1432B1Z5');

    const filtered = filterRowsBySelectedGstin(
      parsed.salesRows,
      flipkartImportMapping,
      parsed.headers['Sales Report'],
      '24ESNPK1432B1Z5',
    );
    expect(filtered.matchedCount).toBeGreaterThanOrEqual(2);
  });

  it('parses rows when Seller GSTIN column is present but empty (profile GSTIN applied at validation)', () => {
    const salesData = [
      [
        'Seller GSTIN',
        'Order ID',
        'Buyer Invoice ID',
        'Buyer Invoice Date',
        'Taxable Value',
        'Event Type',
        'IGST Amount',
        'CGST Amount',
        'SGST Amount',
      ],
      ['', 'ORD-1', 'INV-1', '2026-04-01', '1000', 'Sale', '0', '90', '90'],
      ['', 'ORD-2', 'INV-2', '2026-04-02', '500', 'Sale', '0', '45', '45'],
    ];
    const cashbackData = [
      [
        'Seller GSTIN',
        'Order ID',
        'Credit Note ID',
        'Invoice Date',
        'Taxable Value',
        'Document Type',
        'IGST Amount',
        'CGST Amount',
        'SGST Amount',
      ],
      ['', 'ORD-3', 'CN-1', '2026-04-03', '50', 'Credit Note', '0', '4.5', '4.5'],
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
    expect(parsed.salesRows.length).toBe(2);
    expect(parsed.gstinValues).toEqual([]);

    const hydrated = hydrateFlipkartRowsWithProfileGstin(
      parsed.salesRows,
      parsed.headers['Sales Report'],
      '24ESNPK1432B1Z5',
    );
    const filtered = filterRowsBySelectedGstin(
      hydrated,
      flipkartImportMapping,
      parsed.headers['Sales Report'],
      '24ESNPK1432B1Z5',
    );
    expect(filtered.matchedCount).toBe(2);
  });

  it('parses when headers are on row 1 and invoice data starts on row 2', () => {
    const salesData = [
      [
        'Seller GSTIN',
        'Order ID',
        'Buyer Invoice ID',
        'Buyer Invoice Date',
        'Taxable Value',
        'Event Type',
        'IGST Amount',
        'CGST Amount',
        'SGST Amount',
      ],
      [
        '24ESNPK1432B1Z5',
        'OD123',
        'INV-001',
        '2026-04-01',
        '1000',
        'Sale',
        '0',
        '90',
        '90',
      ],
      [
        '24ESNPK1432B1Z5',
        'OD124',
        'INV-002',
        '2026-04-02',
        '500',
        'Sale',
        '0',
        '45',
        '45',
      ],
    ];
    const cashbackData = [
      [
        'Seller GSTIN',
        'Order ID',
        'Credit Note ID',
        'Invoice Date',
        'Taxable Value',
        'Document Type',
        'IGST Amount',
        'CGST Amount',
        'SGST Amount',
      ],
      [
        '24ESNPK1432B1Z5',
        'OD125',
        'CN-001',
        '2026-04-03',
        '50',
        'Credit Note',
        '0',
        '4.5',
        '4.5',
      ],
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

    expect(parsed.salesRows.length).toBe(2);
    expect(parsed.cashbackRows.length).toBe(1);
    expect(parsed.gstinValues).toContain('24ESNPK1432B1Z5');

    const filtered = filterRowsBySelectedGstin(
      [...parsed.salesRows, ...parsed.cashbackRows],
      flipkartImportMapping,
      [
        ...parsed.headers['Sales Report'],
        ...parsed.headers['Cash Back Report'],
      ],
      '24ESNPK1432B1Z5',
    );
    expect(filtered.matchedCount).toBe(3);
  });

  it('filters multi-GST Flipkart workbook to selected GSTIN using per-row column GSTIN', () => {
    const salesData = [
      ['Seller GSTIN', 'Order ID', 'Taxable Value', 'Event Type'],
      ['27AAAAA0000A1Z5', 'ORD-A1', '100', 'Sale'],
      ['', 'ORD-A2', '200', 'Sale'],
      ['29BBBBB0000B1Z5', 'ORD-B1', '300', 'Sale'],
      ['', 'ORD-B2', '400', 'Sale'],
    ];
    const cashbackData = [
      ['Seller GSTIN', 'Order ID', 'Taxable Value', 'Document Type'],
      ['27AAAAA0000A1Z5', 'ORD-A3', '50', 'Credit Note'],
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

    const filtered = filterRowsBySelectedGstin(
      [...parsed.salesRows, ...parsed.cashbackRows],
      flipkartImportMapping,
      [
        ...parsed.headers['Sales Report'],
        ...parsed.headers['Cash Back Report'],
      ],
      '27AAAAA0000A1Z5',
    );
    expect(filtered.matchedCount).toBe(3);
    expect(filtered.skippedCount).toBe(2);
    const orderIds = filtered.rows.map((row) => String(row['Order ID'] ?? ''));
    expect(orderIds).toEqual(expect.arrayContaining(['ORD-A1', 'ORD-A2', 'ORD-A3']));
    expect(orderIds).not.toContain('ORD-B1');
    expect(orderIds).not.toContain('ORD-B2');
  });

  it('parses data rows when workbook !ref only covers the header row', () => {
    const salesSheet = XLSX.utils.aoa_to_sheet([
      ['Seller GSTIN', 'Order ID', 'Taxable Value', 'Event Type'],
    ]);
    XLSX.utils.sheet_add_aoa(
      salesSheet,
      [['24ESNPK1432B1Z5', 'OD-1', '1000', 'Sale']],
      { origin: 'A2' },
    );
    XLSX.utils.sheet_add_aoa(
      salesSheet,
      [['24ESNPK1432B1Z5', 'OD-2', '500', 'Sale']],
      { origin: 'A3' },
    );
    salesSheet['!ref'] = 'A1:D1';

    const cashbackSheet = XLSX.utils.aoa_to_sheet([
      ['Seller GSTIN', 'Order ID', 'Taxable Value', 'Document Type'],
    ]);
    XLSX.utils.sheet_add_aoa(
      cashbackSheet,
      [['24ESNPK1432B1Z5', 'OD-3', '50', 'Credit Note']],
      { origin: 'A2' },
    );
    cashbackSheet['!ref'] = 'A1:D1';

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, salesSheet, 'Sales Report');
    XLSX.utils.book_append_sheet(workbook, cashbackSheet, 'Cash Back Report');

    const parserAny = parser as unknown as {
      parseFlipkartSheetRows: (
        sheet: XLSX.WorkSheet,
        sheetName: 'Sales Report' | 'Cash Back Report',
        headerRowIndex: number,
        gstColumns: string[],
      ) => ReturnType<typeof parser.parseFlipkartWorkbook>['salesRows'];
    };

    const salesRows = parserAny.parseFlipkartSheetRows(
      salesSheet,
      'Sales Report',
      0,
      flipkartImportMapping.gstin.excelColumns,
    );
    const cashbackRows = parserAny.parseFlipkartSheetRows(
      cashbackSheet,
      'Cash Back Report',
      0,
      flipkartImportMapping.gstin.excelColumns,
    );

    expect(salesRows.length).toBe(2);
    expect(cashbackRows.length).toBe(1);
  });
});
