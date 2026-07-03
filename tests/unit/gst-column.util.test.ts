import { flipkartImportMapping } from '../../src/report-import/config/importMappings/flipkart.mapping';
import { amazonImportMapping } from '../../src/report-import/config/importMappings/amazon.mapping';
import { meeshoImportMapping } from '../../src/report-import/config/importMappings/meesho.mapping';
import {
  collectGstinRowFilterProblems,
  extractGstinsFromRows,
  filterRowsBySelectedGstin,
  headerMatchesExcelColumn,
  headersHaveGstColumn,
  normalizeGstinValue,
  parseGstinFromCell,
} from '../../src/report-import/config/importMappings/gst-column.util';
import { ParsedSheetRow } from '../../src/report-import/services/mapping.service';

describe('gst-column.util', () => {
  it('normalizes GSTIN values', () => {
    expect(parseGstinFromCell(' 07aaxfb7609k1zs ')).toBe('07AAXFB7609K1ZS');
    expect(parseGstinFromCell('07 AAX FB 7609 K1ZS')).toBe('07AAXFB7609K1ZS');
    expect(parseGstinFromCell("'07AAXFB7609K1ZS")).toBe('07AAXFB7609K1ZS');
    expect(normalizeGstinValue('07AAXFB7609K1ZS')).toBe('07AAXFB7609K1ZS');
  });

  it('matches headers case-insensitively with spacing', () => {
    expect(headerMatchesExcelColumn('seller gstin', 'Seller GSTIN')).toBe(true);
    expect(headerMatchesExcelColumn('SELLER GSTIN', 'Seller GSTIN')).toBe(true);
    expect(headerMatchesExcelColumn('GST NO = Seller GSTIN', 'Seller GSTIN')).toBe(
      true,
    );
    expect(headerMatchesExcelColumn('Seller Gstin', 'Seller Gstin')).toBe(true);
    expect(headerMatchesExcelColumn('Seller GSTIN', 'GSTIN')).toBe(true);
  });

  it('does not match a shorter header when the alias is more specific', () => {
    expect(
      headerMatchesExcelColumn('Return Reason', 'Detailed Return Reason'),
    ).toBe(false);
    expect(
      headerMatchesExcelColumn('Detailed Return Reason', 'Detailed Return Reason'),
    ).toBe(true);
  });

  it('does not treat CGST/SGST/IGST NO columns as GST NO', () => {
    expect(headerMatchesExcelColumn('CGST NO', 'GST NO')).toBe(false);
    expect(headerMatchesExcelColumn('SGST NO', 'GST NO')).toBe(false);
    expect(headerMatchesExcelColumn('IGST NO', 'GST NO')).toBe(false);
    expect(headerMatchesExcelColumn('GST NO', 'GST NO')).toBe(true);
    expect(headerMatchesExcelColumn('GST NO = Seller GSTIN', 'GST NO')).toBe(
      true,
    );
  });

  it('collects GSTIN values from every matching GST column alias', () => {
    const rows: ParsedSheetRow[] = [
      {
        __sheetName: 'TCS Sales',
        __rowNumber: 2,
        gstin: '27AAAAA0000A1Z5',
        'GST NO': '29BBBBB0000B1Z5',
      },
      {
        __sheetName: 'TCS Sales',
        __rowNumber: 3,
        gstin: '27AAAAA0000A1Z5',
        'GST NO': '29BBBBB0000B1Z5',
      },
    ];
    const { values } = extractGstinsFromRows(rows, meeshoImportMapping, [
      'gstin',
      'GST NO',
    ]);
    expect([...values].sort()).toEqual([
      '27AAAAA0000A1Z5',
      '29BBBBB0000B1Z5',
    ]);
  });

  it('extracts Flipkart GSTIN from Seller GSTIN column', () => {
    const rows: ParsedSheetRow[] = [
      {
        __sheetName: 'Sales Report',
        __rowNumber: 2,
        'Seller GSTIN': '29ABCDE1234F1Z5',
        'Order ID': 'O1',
      },
    ];
    const { values, foundColumn } = extractGstinsFromRows(
      rows,
      flipkartImportMapping,
    );
    expect(foundColumn).toBe(true);
    expect([...values]).toEqual(['29ABCDE1234F1Z5']);
  });

  it('extracts Amazon GSTIN from Seller Gstin column', () => {
    const rows: ParsedSheetRow[] = [
      {
        __sheetName: 'Sheet1',
        __rowNumber: 2,
        'Seller Gstin': '29ABCDE1234F1Z5',
        'Order Id': 'O1',
      },
    ];
    const { values, foundColumn } = extractGstinsFromRows(
      rows,
      amazonImportMapping,
    );
    expect(foundColumn).toBe(true);
    expect([...values]).toEqual(['29ABCDE1234F1Z5']);
  });

  it('detects GST column in headers when composite label is used', () => {
    expect(
      headersHaveGstColumn(
        ['GST NO = Seller GSTIN', 'Order ID'],
        flipkartImportMapping.gstin.excelColumns,
      ),
    ).toBe(true);
  });

  it('filters rows to only the selected GSTIN', () => {
    const rows: ParsedSheetRow[] = [
      {
        __sheetName: 'Sales Report',
        __rowNumber: 2,
        'Seller GSTIN': '27AAAAA0000A1Z5',
        'Order ID': 'O1',
      },
      {
        __sheetName: 'Sales Report',
        __rowNumber: 3,
        'Seller GSTIN': '29BBBBB0000B1Z5',
        'Order ID': 'O2',
      },
      {
        __sheetName: 'Sales Report',
        __rowNumber: 4,
        'Seller GSTIN': '27AAAAA0000A1Z5',
        'Order ID': 'O3',
      },
    ];
    const result = filterRowsBySelectedGstin(
      rows,
      flipkartImportMapping,
      ['Seller GSTIN', 'Order ID'],
      '27AAAAA0000A1Z5',
    );
    expect(result.matchedCount).toBe(2);
    expect(result.skippedCount).toBe(1);
    expect(result.rows.map((r) => r['Order ID'])).toEqual(['O1', 'O3']);
    expect([...result.fileGstins].sort()).toEqual([
      '27AAAAA0000A1Z5',
      '29BBBBB0000B1Z5',
    ]);
  });

  it('reports no matching rows when file has other GSTINs only', () => {
    const problems = collectGstinRowFilterProblems({
      rows: [
        {
          __sheetName: 'Sales Report',
          __rowNumber: 2,
          'Seller GSTIN': '29BBBBB0000B1Z5',
        },
      ],
      expectedGstin: '27AAAAA0000A1Z5',
      mapping: flipkartImportMapping,
      fileHeaders: ['Seller GSTIN'],
      matchedRowCount: 0,
      fileGstins: new Set(['29BBBBB0000B1Z5']),
    });
    expect(problems.some((p) => p.includes('No rows found for selected GSTIN'))).toBe(
      true,
    );
  });

  it('does not reject files with multiple GSTINs when filtering', () => {
    const problems = collectGstinRowFilterProblems({
      rows: [
        {
          __sheetName: 'Sales Report',
          __rowNumber: 2,
          'Seller GSTIN': '27AAAAA0000A1Z5',
        },
        {
          __sheetName: 'Sales Report',
          __rowNumber: 3,
          'Seller GSTIN': '29BBBBB0000B1Z5',
        },
      ],
      expectedGstin: '27AAAAA0000A1Z5',
      mapping: flipkartImportMapping,
      fileHeaders: ['Seller GSTIN'],
      matchedRowCount: 1,
      fileGstins: new Set(['27AAAAA0000A1Z5', '29BBBBB0000B1Z5']),
    });
    expect(problems).toEqual([]);
  });
});
