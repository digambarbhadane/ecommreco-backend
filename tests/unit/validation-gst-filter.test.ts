import { ValidationService } from '../../src/report-import/services/validation.service';
import type { ParsedSheetRow } from '../../src/report-import/services/mapping.service';

describe('ValidationService GST filtering', () => {
  const validation = new ValidationService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('imports only Amazon rows matching the selected GSTIN from a multi-GST file', () => {
    const rows: ParsedSheetRow[] = [
      {
        __sheetName: 'Sheet1',
        __rowNumber: 2,
        'Seller Gstin': '27AAAAA0000A1Z5',
        'Order Id': 'O1',
      },
      {
        __sheetName: 'Sheet1',
        __rowNumber: 3,
        'Seller Gstin': '29BBBBB0000B1Z5',
        'Order Id': 'O2',
      },
      {
        __sheetName: 'Sheet1',
        __rowNumber: 4,
        'Seller Gstin': '27AAAAA0000A1Z5',
        'Order Id': 'O3',
      },
    ];

    const result = validation.filterAmazonRowsBySelectedGstin(
      rows,
      '27AAAAA0000A1Z5',
      ['Seller Gstin', 'Order Id'],
      { reportLabel: 'Amazon MTR B2C Report' },
    );

    expect(result.rows.map((row) => row['Order Id'])).toEqual(['O1', 'O3']);
    expect(result.skippedCount).toBe(1);
  });

  it('imports only Flipkart rows matching the selected GSTIN from a multi-GST file', () => {
    const parsed = {
      salesRows: [
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
      ] as ParsedSheetRow[],
      cashbackRows: [
        {
          __sheetName: 'Cash Back Report',
          __rowNumber: 2,
          'Seller GSTIN': '27AAAAA0000A1Z5',
          'Order ID': 'O3',
        },
      ] as ParsedSheetRow[],
      headers: {
        'Sales Report': ['Seller GSTIN', 'Order ID'],
        'Cash Back Report': ['Seller GSTIN', 'Order ID'],
      },
      gstinValues: ['27AAAAA0000A1Z5', '29BBBBB0000B1Z5'],
    };

    const result = validation.filterFlipkartRowsBySelectedGstin(
      parsed,
      '27AAAAA0000A1Z5',
    );

    expect(result.salesRows.map((row) => row['Order ID'])).toEqual(['O1']);
    expect(result.cashbackRows.map((row) => row['Order ID'])).toEqual(['O3']);
    expect(result.skippedCount).toBe(1);
  });

  it('rejects when the selected GSTIN is not present in the file', () => {
    const rows: ParsedSheetRow[] = [
      {
        __sheetName: 'Sheet1',
        __rowNumber: 2,
        'Seller Gstin': '29BBBBB0000B1Z5',
        'Order Id': 'O1',
      },
    ];

    expect(() =>
      validation.filterAmazonRowsBySelectedGstin(
        rows,
        '27AAAAA0000A1Z5',
        ['Seller Gstin', 'Order Id'],
      ),
    ).toThrow(/No rows found for selected GSTIN/i);
  });
});
