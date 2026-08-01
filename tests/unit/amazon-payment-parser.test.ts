import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { AmazonPaymentParser } from '../../src/report-import/payments/amazon/amazon-payment.parser';

function workbookBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    'Payment Report',
  );
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('AmazonPaymentParser', () => {
  const parser = new AmazonPaymentParser();

  it('maps reordered headers and preserves every component row', () => {
    const buffer = workbookBuffer([
      [
        ' amount-description ',
        'order-id',
        'amount',
        'transaction-type',
        'deposit-date',
        'settlement-id',
      ],
      ['Principal', '12345', 500, 'Order', '2026-07-15', 'SET-1'],
      ['Product Tax', '12345', '90.00', 'Order', '2026-07-15', 'SET-1'],
      ['Commission', '12345', -75, 'Order', '2026-07-15', 'SET-1'],
    ]);

    const result = parser.parse(buffer);

    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row) => row.amount)).toEqual([500, 90, -75]);
    expect(result.rows.every((row) => row.orderId === '12345')).toBe(true);
    expect(result.rows[0].depositDate.toISOString()).toBe(
      '2026-07-15T00:00:00.000Z',
    );
  });

  it('preserves identical source rows independently and ignores blank rows', () => {
    const headers = [
      'settlement-id',
      'deposit-date',
      'transaction-type',
      'order-id',
      'amount-description',
      'amount',
    ];
    const duplicate = [
      'SET-2',
      '17/07/2026',
      'Order',
      'A-1',
      ' Shipping ',
      40,
    ];
    const result = parser.parse(
      workbookBuffer([headers, duplicate, duplicate, [null, null, null]]),
    );

    expect(result.rows).toHaveLength(2);
    expect(result.blankRows).toBe(1);
    expect(result.rows[0].amountDescription).toBe(' Shipping ');
    expect(result.rows[0].rowKey).not.toBe(result.rows[1].rowKey);
  });

  it('carries settlement-id and deposit-date forward to component rows', () => {
    const result = parser.parse(
      workbookBuffer([
        [
          'settlement-id',
          'deposit-date',
          'transaction-type',
          'order-id',
          'amount-description',
          'amount',
        ],
        [
          '26694040922',
          '20.03.2026 10:32:05 UTC',
          'Order',
          '405-3207097-0266725',
          'Principal',
          475.24,
        ],
        ['', '', 'Order', '405-3207097-0266725', 'Product Tax', 23.76],
        ['', '', 'Order', '405-3207097-0266725', 'Commission', -22.46],
      ]),
    );

    expect(result.rows).toHaveLength(3);
    expect(result.rows.every((row) => row.settlementId === '26694040922')).toBe(
      true,
    );
    expect(
      result.rows.every(
        (row) =>
          row.depositDate instanceof Date &&
          row.depositDate.toISOString() === '2026-03-20T10:32:05.000Z',
      ),
    ).toBe(true);
    expect(result.rows.map((row) => row.amountDescription)).toEqual([
      'Principal',
      'Product Tax',
      'Commission',
    ]);
  });

  it('parses Amazon currency text and accounting negatives exactly', () => {
    const result = parser.parse(
      workbookBuffer([
        [
          'settlement-id',
          'deposit-date',
          'transaction-type',
          'order-id',
          'amount-description',
          'amount',
        ],
        ['SET-3', '2026-07-17', 'Order', 'A-3', 'Principal', 'INR 4,471.04'],
        ['SET-3', '2026-07-17', 'Order', 'A-3', 'Commission', '(₹75.00)'],
      ]),
    );

    expect(result.rows.map((row) => row.amount)).toEqual([4471.04, -75]);
  });

  it('rejects a workbook with a missing required header', () => {
    const buffer = workbookBuffer([
      [
        'settlement-id',
        'deposit-date',
        'transaction-type',
        'order-id',
        'amount-description',
      ],
    ]);

    expect(() => parser.parse(buffer)).toThrow(BadRequestException);
  });

  it('rejects non-empty rows with invalid amount or deposit date', () => {
    const buffer = workbookBuffer([
      [
        'settlement-id',
        'deposit-date',
        'transaction-type',
        'order-id',
        'amount-description',
        'amount',
      ],
      ['SET-3', 'not-a-date', 'Order', 'A-2', 'Principal', 'not-a-number'],
    ]);

    expect(() => parser.parse(buffer)).toThrow(BadRequestException);
  });

  it('reports malformed rows while preserving valid rows', () => {
    const result = parser.parse(
      workbookBuffer([
        [
          'settlement-id',
          'deposit-date',
          'transaction-type',
          'order-id',
          'amount-description',
          'amount',
        ],
        ['SET-4', '2026-07-17', 'Order', 'A-4', 'Principal', 100],
        ['', '', 'Order', 'A-4', 'Commission', 'not-a-number'],
        ['', '', 'Order', 'A-4', 'Product Tax', 18],
      ]),
    );

    expect(result.rows).toHaveLength(2);
    expect(result.invalidRowCount).toBe(1);
    expect(result.validationErrors[0]).toContain('Row 3');
  });
});

