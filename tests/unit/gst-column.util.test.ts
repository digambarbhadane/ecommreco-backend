import { flipkartImportMapping } from '../../src/report-import/config/importMappings/flipkart.mapping';
import { amazonImportMapping } from '../../src/report-import/config/importMappings/amazon.mapping';
import {
  extractGstinsFromRows,
  headerMatchesExcelColumn,
  headersHaveGstColumn,
  normalizeGstinValue,
} from '../../src/report-import/config/importMappings/gst-column.util';
import { ParsedSheetRow } from '../../src/report-import/services/mapping.service';

describe('gst-column.util', () => {
  it('normalizes GSTIN values', () => {
    expect(normalizeGstinValue(' 29abcde1234f1z5 ')).toBe('29ABCDE1234F1Z5');
    expect(normalizeGstinValue('29 ab cd e1 234f1z5')).toBe('29ABCDE1234F1Z5');
  });

  it('matches headers case-insensitively with spacing', () => {
    expect(headerMatchesExcelColumn('seller gstin', 'Seller GSTIN')).toBe(true);
    expect(headerMatchesExcelColumn('SELLER GSTIN', 'Seller GSTIN')).toBe(true);
    expect(headerMatchesExcelColumn('GST NO = Seller GSTIN', 'Seller GSTIN')).toBe(
      true,
    );
    expect(headerMatchesExcelColumn('Seller Gstin', 'Seller Gstin')).toBe(true);
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
});
