import {
  buildMyntraValidationMessage,
  filterMyntraReportsBySelectedGstin,
  MYNTRA_GSTR_RT_HEADERS,
} from '../../src/report-import/utils/myntra-import.validation';

describe('myntra-import.validation', () => {
  it('requires packet_id on GSTR RT', () => {
    const message = buildMyntraValidationMessage(
      [
        {
          reportLabel: 'GSTR Report RT',
          headers: ['tax_seller_gstin', 'fr_refunded_date'],
          rows: [{ __sheetName: 'RT', __rowNumber: 2 }],
          requiredHeaderGroups: MYNTRA_GSTR_RT_HEADERS,
        },
      ],
      '07AAXFB7609K1ZS',
    );
    expect(message).toContain('packet_id');
  });

  it('filters Myntra rows to the selected GSTIN when file has multiple seller GSTINs', () => {
    const result = filterMyntraReportsBySelectedGstin(
      [
        {
          reportLabel: 'GSTR Report Packed',
          headers: ['seller_gstin', 'order_id'],
          rows: [
            {
              __sheetName: 'Packed',
              __rowNumber: 2,
              seller_gstin: '27AAAAA0000A1Z5',
              order_id: 'O1',
            },
            {
              __sheetName: 'Packed',
              __rowNumber: 3,
              seller_gstin: '29BBBBB0000B1Z5',
              order_id: 'O2',
            },
          ],
          requiredHeaderGroups: [['seller_gstin'], ['order_id']],
        },
      ],
      '27AAAAA0000A1Z5',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skippedCount).toBe(1);
    expect(result.reports[0].rows.map((row) => row.order_id)).toEqual(['O1']);
  });
});
