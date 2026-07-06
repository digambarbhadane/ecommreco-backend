import {
  buildMyntraValidationMessage,
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
});
