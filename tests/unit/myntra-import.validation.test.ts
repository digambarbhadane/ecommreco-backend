import {
  buildMyntraValidationMessage,
  MYNTRA_MDIRECT_ORDERS_HEADERS,
  MYNTRA_MDIRECT_RETURNS_HEADERS,
} from '../../src/report-import/utils/myntra-import.validation';

describe('myntra-import.validation', () => {
  it('lists report name, missing column, expected aliases, and headers found', () => {
    const message = buildMyntraValidationMessage(
      [
        {
          reportLabel: 'MDirect Orders Report',
          fileName: 'my_orders_apr.xlsx',
          headers: ['seller_sku_code', 'other_col'],
          rows: [],
          requiredHeaderGroups: MYNTRA_MDIRECT_ORDERS_HEADERS,
        },
      ],
      '27AAAAA0000A1Z5',
    );

    expect(message).toContain('MDirect Orders Report');
    expect(message).toContain('my_orders_apr.xlsx');
    expect(message).toContain('order_release_id');
    expect(message).toContain('Columns detected in file');
    expect(message).toContain('seller_sku_code');
  });

  it('accepts MDirect Returns with order_id only (no order_release_id)', () => {
    const message = buildMyntraValidationMessage(
      [
        {
          reportLabel: 'MDirect Returns Report',
          fileName: 'Return-April.csv',
          headers: ['order_id', 'Return Reason'],
          rows: [{ __sheetName: 'S', __rowNumber: 2, order_id: '107774855' }],
          requiredHeaderGroups: MYNTRA_MDIRECT_RETURNS_HEADERS,
        },
      ],
      '27AAAAA0000A1Z5',
    );
    expect(message).toBeNull();
  });

  it('returns null when all checks pass', () => {
    const message = buildMyntraValidationMessage(
      [
        {
          reportLabel: 'MDirect Orders Report',
          fileName: 'orders.xlsx',
          headers: ['order_release_id', 'seller_sku_code'],
          rows: [{ __sheetName: 'S', __rowNumber: 2, order_release_id: '1' }],
          requiredHeaderGroups: MYNTRA_MDIRECT_ORDERS_HEADERS,
        },
      ],
      '27AAAAA0000A1Z5',
    );
    expect(message).toBeNull();
  });
});
