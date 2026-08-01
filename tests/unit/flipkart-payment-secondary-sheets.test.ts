import * as XLSX from 'xlsx';
import { FileParserService } from '../../src/report-import/services/file-parser.service';
import { matchSecondarySheetKind } from '../../src/report-import/payments/flipkart/sheets/flipkart-payment-sheet-kinds';
import { mapSecondarySheetRow } from '../../src/report-import/payments/flipkart/sheets/flipkart-payment-secondary.mapper';

function buildFlipkartPaymentMultiSheetBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();

  const orders = [
    ['Flipkart Payment Orders', '', '', ''],
    ['NEFT ID', 'Payment Date', 'Order ID', 'Bank Settlement Value (Rs.) = SUM(J:R)', 'Seller SKU', 'Quantity'],
    ['NEFT001', '2026-04-01', 'ORD-1', 100, 'SKU-1', 1],
    ['NEFT001', '2026-04-01', 'ORD-2', 50, 'SKU-2', 1],
  ];
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(orders),
    'Orders',
  );

  const storage = [
    ['Storage Recall', '', '', ''],
    ['NEFT ID', 'Payment Date', 'Settlement Value(Rs.) = SUM(J:K)', 'Service Name', '', '', '', '', '', 'Fee J', 'Fee K'],
    ['NEFT001', '2026-04-01', '', 'Storage', '', '', '', '', '', 10, 5],
    ['', '2026-04-01', '', 'Recall', '', '', '', '', '', 7, 3],
    ['NEFT001', '2026-04-01', 20, 'Storage', '', '', '', '', '', '', ''],
  ];
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(storage),
    'Storage_Recall',
  );

  const mpFee = [
    ['MP Fee Rebate', '', '', '', ''],
    ['NEFT ID', 'Neft Type', 'Payment Date', 'Settlement Value (Rs.)', 'Order ID'],
    ['NEFT001', 'Rebate', '2026-04-01', 12, 'ORD-1'],
    ['NEFT001', 'Rebate', '2026-04-01', 8, 'ORD-2'],
  ];
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(mpFee),
    'MP Fee Rebate',
  );

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('Flipkart payment secondary sheet parse + map', () => {
  const parser = new FileParserService();

  it('matches secondary sheet tab names', () => {
    expect(matchSecondarySheetKind('Storage_Recall')).toBe('storageRecall');
    expect(matchSecondarySheetKind('MP Fee Rebate')).toBe('mpFeeRebate');
    expect(matchSecondarySheetKind('Google Ads Services')).toBe('googleAdsServices');
    expect(matchSecondarySheetKind('Ads')).toBe('ads');
    expect(matchSecondarySheetKind('Google Ads')).toBeNull();
  });

  it('parses secondary sheets and keeps duplicate NEFT storage rows', () => {
    const workbook = parser.parseFlipkartPaymentAllSheetsWorkbook(
      buildFlipkartPaymentMultiSheetBuffer(),
    );

    expect(workbook.orders.rows.length).toBeGreaterThanOrEqual(2);

    const storage = workbook.secondary.find((s) => s.kind === 'storageRecall');
    expect(storage).toBeDefined();
    expect(storage!.rows.length).toBeGreaterThanOrEqual(2);

    const mapped = storage!.rows
      .map((row) => mapSecondarySheetRow('storageRecall', row))
      .filter(Boolean);
    expect(mapped.length).toBeGreaterThanOrEqual(2);
    expect(mapped.every((row) => row!.fields.neftId === 'NEFT001')).toBe(true);

    const mpFee = workbook.secondary.find((s) => s.kind === 'mpFeeRebate');
    expect(mpFee).toBeDefined();
    expect(mpFee!.rows.length).toBe(2);
  });
});
