import {
  buildMyntraValidationMessage,
  correctMyntraReturnFileAssignment,
  detectMyntraGstrReturnFileKind,
  filterMyntraReportsBySelectedGstin,
  MYNTRA_GSTR_RT_HEADERS,
} from '../../src/report-import/utils/myntra-import.validation';

describe('myntra-import.validation', () => {
  it('detects RTO vs RT file kinds from headers', () => {
    expect(
      detectMyntraGstrReturnFileKind([
        'tax_seller_gstin',
        'order_id',
        'order_cancel_date',
      ]),
    ).toBe('rto');
    expect(
      detectMyntraGstrReturnFileKind([
        'tax_seller_gstin',
        'order_id',
        'packet_id',
        'order_cancel_date',
      ]),
    ).toBe('rto');
    expect(
      detectMyntraGstrReturnFileKind([
        'tax_seller_gstin',
        'packet_id',
        'fr_refunded_date',
      ]),
    ).toBe('rt');
  });

  it('allows RTO file with packet_id in the RTO slot', () => {
    const result = correctMyntraReturnFileAssignment(
      {
        gstrReportRto: {
          headers: [
            'tax_seller_gstin',
            'order_id',
            'packet_id',
            'order_cancel_date',
          ],
          rows: [{ __sheetName: 'RTO', __rowNumber: 2 }],
        },
        gstrReportRt: {
          headers: ['tax_seller_gstin', 'packet_id', 'fr_refunded_date'],
          rows: [{ __sheetName: 'RT', __rowNumber: 2 }],
        },
      },
      { rto: 'GSTR report RTO.csv', rt: 'GSTR report RT.csv' },
    );
    expect(result.error).toBeUndefined();
    expect(result.swapped).toBe(false);
  });

  it('auto-swaps RTO and RT files when uploaded to wrong slots', () => {
    const parsed = {
      gstrReportRto: {
        headers: ['tax_seller_gstin', 'packet_id', 'fr_refunded_date'],
        rows: [{ __sheetName: 'RT', __rowNumber: 2, packet_id: 'P1' }],
      },
      gstrReportRt: {
        headers: ['tax_seller_gstin', 'order_id', 'order_cancel_date'],
        rows: [{ __sheetName: 'RTO', __rowNumber: 2, order_id: 'O1' }],
      },
    };
    const result = correctMyntraReturnFileAssignment(parsed, {
      rto: 'GSTR report RTO.csv',
      rt: 'GSTR report RT.csv',
    });
    expect(result.swapped).toBe(true);
    expect(detectMyntraGstrReturnFileKind(parsed.gstrReportRto.headers)).toBe(
      'rto',
    );
    expect(detectMyntraGstrReturnFileKind(parsed.gstrReportRt.headers)).toBe(
      'rt',
    );
  });

  it('reports misplaced RTO file on RT slot', () => {
    const result = correctMyntraReturnFileAssignment(
      {
        gstrReportRto: {
          headers: ['tax_seller_gstin', 'order_id', 'order_cancel_date'],
          rows: [{ __sheetName: 'RTO', __rowNumber: 2 }],
        },
        gstrReportRt: {
          headers: ['tax_seller_gstin', 'order_id', 'order_cancel_date'],
          rows: [{ __sheetName: 'RT', __rowNumber: 2 }],
        },
      },
      { rt: 'GSTR report RTO.csv' },
    );
    expect(result.error).toContain('GSTR report RTO.csv');
    expect(result.error).toContain('GSTR Report RTO');
  });

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

  it('explains when RT slot receives an RTO file', () => {
    const message = buildMyntraValidationMessage(
      [
        {
          reportLabel: 'GSTR Report RT',
          fileName: 'GSTR report RTO.csv',
          headers: ['tax_seller_gstin', 'order_id', 'order_cancel_date'],
          rows: [{ __sheetName: 'RTO', __rowNumber: 2, order_id: 'O1' }],
          requiredHeaderGroups: MYNTRA_GSTR_RT_HEADERS,
        },
      ],
      '07AAXFB7609K1ZS',
    );
    expect(message).toContain('looks like a GSTR RTO report');
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
