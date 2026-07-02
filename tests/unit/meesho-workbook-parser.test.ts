import * as XLSX from 'xlsx';
import { FileParserService } from '../../src/report-import/services/file-parser.service';

function buildMeeshoTcsSalesBuffer() {
  const data = [
    ['TCS Sales Report'],
    [''],
    [
      'gstin',
      'sub_order_num',
      'hsn_code',
      'quantity',
      'total_invoice_value',
      'total_taxable_sale_value',
      'gst_rate',
      'tax_amount',
      'order_date',
      'end_customer_state_new',
    ],
    [
      '27AAAAA0000A1Z5',
      'ORD-100',
      '6109',
      2,
      1000,
      900,
      12,
      108,
      '01/04/2026',
      'Maharashtra',
    ],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function buildMeeshoPaymentBuffer() {
  const data = [
    ['Payment Summary', '', 'Fees', ''],
    [
      'Sub Order No',
      'Live Order Status',
      'Transaction ID',
      'Payment Date',
      'Final Settlement Amount',
      'Price Type',
      'Total Sale Amount (Incl. Shipping & GST)',
      'TCS',
      'TDS',
    ],
    [
      'ORD-100',
      'Delivered',
      'TXN-1',
      '01/05/2026',
      850,
      'Standard',
      1000,
      10,
      5,
    ],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(data),
    'Order Payments',
  );
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function buildMeeshoLifecycleReturnBuffer() {
  const sellerMeta = Array.from({ length: 7 }, (_, i) => [
    `Seller field ${i + 1}`,
    'Sample seller info',
  ]);
  const data = [
    ...sellerMeta,
    [
      'Order Number',
      'Sub Order No',
      'Type of Return',
      'Sub Type',
      'Qty',
      'Return Reason',
      'Detailed Return Reason',
    ],
    [
      'ORD-100',
      'ORD-100',
      'Customer Return',
      'RTO',
      1,
      'Size issue',
      'Too small',
    ],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('FileParserService Meesho workbooks', () => {
  const parser = new FileParserService();

  it('parses TCS Sales Report rows with gstin and sub_order_num', () => {
    const parsed = parser.parseMeeshoWorkbook(
      buildMeeshoTcsSalesBuffer(),
      'tcsSales',
    );
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(parsed.headers.map((h) => h.toLowerCase())).toEqual(
      expect.arrayContaining(['gstin', 'sub_order_num']),
    );
    expect(String(parsed.rows[0].gstin).toUpperCase()).toContain('27AAAAA0000A1Z5');
    expect(String(parsed.rows[0].sub_order_num)).toBe('ORD-100');
  });

  it.each([
    'returnInTransit',
    'returnOutForDelivery',
    'returnDeliveryComplete',
  ] as const)(
    'parses %s with seller metadata rows before headers on row 8',
    (fileKind) => {
      const parsed = parser.parseMeeshoWorkbook(
        buildMeeshoLifecycleReturnBuffer(),
        fileKind,
      );
      expect(parsed.rows).toHaveLength(1);
      expect(String(parsed.rows[0]['Order Number'])).toBe('ORD-100');
      expect(String(parsed.rows[0]['Return Reason'])).toBe('Size issue');
    },
  );

  it('rejects lifecycle return report when headers are not on row 8', () => {
    const data = [
      [
        'Order Number',
        'Sub Order No',
        'Type of Return',
        'Sub Type',
        'Qty',
        'Return Reason',
        'Detailed Return Reason',
      ],
      [
        'ORD-100',
        'ORD-100',
        'Customer Return',
        'RTO',
        1,
        'Size issue',
        'Too small',
      ],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), 'Sheet1');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    expect(() =>
      parser.parseMeeshoWorkbook(buffer, 'returnInTransit'),
    ).toThrow(/row 8/i);
  });

  it('parses Order Payments sheet with headers on row 2', () => {
    const parsed = parser.parseMeeshoPaymentWorkbook(buildMeeshoPaymentBuffer());
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.headers).toEqual(
      expect.arrayContaining(['Sub Order No', 'Live Order Status', 'Transaction ID']),
    );
    expect(String(parsed.rows[0]['Sub Order No'])).toBe('ORD-100');
    expect(String(parsed.rows[0]['Live Order Status'])).toBe('Delivered');
    expect(String(parsed.rows[0]['Transaction ID'])).toBe('TXN-1');
  });

  it('parses payment report when the sheet is named Sheet1 (CSV-style export)', () => {
    const data = [
      ['Payment Summary', '', 'Fees', ''],
      [
        'Sub Order No',
        'Live Order Status',
        'Transaction ID',
        'Payment Date',
        'Final Settlement Amount',
        'Price Type',
        'Total Sale Amount (Incl. Shipping & GST)',
        'TCS',
        'TDS',
      ],
      [
        'ORD-200',
        'Delivered',
        'TXN-2',
        '01/06/2026',
        900,
        'Standard',
        1100,
        12,
        6,
      ],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), 'Sheet1');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const parsed = parser.parseMeeshoPaymentWorkbook(buffer);
    expect(parsed.rows).toHaveLength(1);
    expect(String(parsed.rows[0]['Sub Order No'])).toBe('ORD-200');
    expect(String(parsed.rows[0]['Final Settlement Amount'])).toBe('900');
  });
});
