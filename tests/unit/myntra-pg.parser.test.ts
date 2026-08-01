import * as XLSX from 'xlsx';
import { MYNTRA_PG_REVERSE_FIELD_CATALOG } from '../../src/report-import/config/importMappings/myntra-pg-reverse.mapping';
import { MyntraPgParser } from '../../src/report-import/payments/myntra/myntra-pg.parser';

function buildWorkbookBuffer(headers: string[], rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('MyntraPgParser', () => {
  const parser = new MyntraPgParser();

  it('parses PG Forward Settled rows with dynamic settlement columns', () => {
    const buffer = buildWorkbookBuffer(
      [
        'order_release_id',
        'order_line_id',
        'seller_gstn',
        'sku_code',
        'total_actual_settlement',
        'Settlement_on_2026_03_02',
      ],
      [['OR-1', 'OL-1', '29ABCDE1234F1Z5', 'SKU-1', 100.5, 100.5]],
    );

    const result = parser.parse(buffer, 'forward', 'forward.xlsx');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.orderReleaseId).toBe('OR-1');
    expect(result.rows[0]?.sellerGstn).toBe('29ABCDE1234F1Z5');
    expect(result.rows[0]?.rowData.settlement_on_2026_03_02).toBe(100.5);
    expect(result.fieldKeys).toContain('settlement_on_2026_03_02');
  });

  it('parses PG Reverse Settled rows with typed catalog fields and settlement columns', () => {
    const headers = [
      'order_release_id',
      'order_line_id',
      'return_type',
      'return_date',
      'packing_date',
      'delivery_date',
      'sku_code',
      'invoice_number',
      'packet_id',
      'seller_gstn',
      'seller_product_amount',
      'taxable_amount',
      'igst_amount',
      'total_settlement',
      'total_actual_settlement',
      'postpaid_payment',
      'return_id',
      'royaltyCharges_prepaid',
      'marketingContribution_postpaid',
      'Settlement_on_2026_03_02',
      'Settlement_on_2026_03_05',
    ];
    const buffer = buildWorkbookBuffer(headers, [
      [
        'OR-REV-1',
        'OL-REV-1',
        'Customer Return',
        '2026-03-02',
        '2026-02-28',
        '2026-03-01',
        'SKU-R1',
        'INV-100',
        'PKT-55',
        '29ABCDE1234F1Z5',
        999,
        847.46,
        152.54,
        -450,
        -450,
        -450,
        'RET-9001',
        12.5,
        8,
        -200,
        -250,
      ],
    ]);

    const result = parser.parse(buffer, 'reverse', 'reverse.xlsx');
    expect(result.rows).toHaveLength(1);

    const row = result.rows[0]!;
    expect(row.reportKind).toBe('reverse');
    expect(row.orderReleaseId).toBe('OR-REV-1');
    expect(row.orderLineId).toBe('OL-REV-1');
    expect(row.returnType).toBe('Customer Return');
    expect(row.returnId).toBe('RET-9001');
    expect(row.invoiceNumber).toBe('INV-100');
    expect(row.packetId).toBe('PKT-55');
    expect(row.sellerProductAmount).toBe(999);
    expect(row.taxableAmount).toBe(847.46);
    expect(row.igstAmount).toBe(152.54);
    expect(row.totalSettlement).toBe(-450);
    expect(row.totalActualSettlement).toBe(-450);
    expect(row.postpaidPayment).toBe(-450);
    expect(row.rowData.royaltycharges_prepaid).toBe(12.5);
    expect(row.rowData.marketingcontribution_postpaid).toBe(8);
    expect(row.rowData.settlement_on_2026_03_02).toBe(-200);
    expect(row.rowData.settlement_on_2026_03_05).toBe(-250);
    expect(row.settlementColumns).toEqual({
      settlement_on_2026_03_02: -200,
      settlement_on_2026_03_05: -250,
    });
    expect(row.rowKey).toContain('RET-9001');
  });

  it('requires reverse-specific headers', () => {
    const buffer = buildWorkbookBuffer(
      ['order_release_id', 'seller_gstn', 'total_actual_settlement'],
      [['OR-REV-1', '29ABCDE1234F1Z5', 50]],
    );

    expect(() => parser.parse(buffer, 'reverse', 'reverse.xlsx')).toThrow(
      /missing required columns:.*return_type.*return_date/i,
    );
  });

  it('defines reverse field catalog for all PG reverse export columns', () => {
    const keys = new Set(MYNTRA_PG_REVERSE_FIELD_CATALOG.map((field) => field.key));
    expect(keys.has('order_release_id')).toBe(true);
    expect(keys.has('return_id')).toBe(true);
    expect(keys.has('commission_tax_amount')).toBe(true);
    expect(keys.has('marketingcontribution_postpaid')).toBe(true);
    expect(MYNTRA_PG_REVERSE_FIELD_CATALOG.length).toBeGreaterThan(100);
  });
});
