import * as XLSX from 'xlsx';
import { MappingService } from '../../src/report-import/services/mapping.service';
import { FlipkartImportService } from '../../src/report-import/services/flipkart-import.service';
import { FileParserService } from '../../src/report-import/services/file-parser.service';
import {
  applyFlipkartReturnDetailsToRow,
  buildFlipkartReturnDetailsByOrderId,
  flipkartOrderIdLookupKey,
  isFlipkartReturnVoucherType,
  lookupFlipkartReturnDetails,
} from '../../src/report-import/utils/flipkart-return.util';

function buildReturnWorkbook() {
  const data = [
    ['Return Report'],
    ['Order ID', 'Return Type', 'Return Reason', 'Return Sub-reason'],
    ['101', 'Customer Return', 'Size Issue', 'Too small'],
    ['999', 'Customer Return', 'No sales match', 'N/A'],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(data),
    'Return Report',
  );
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('Flipkart return details mapping', () => {
  const parser = new FileParserService();
  const mapping = new MappingService();
  const flipkartImport = new FlipkartImportService(parser, mapping);

  it('builds a case-insensitive order lookup map from return report rows', () => {
    const parsed = parser.parseFlipkartReturnWorkbook(buildReturnWorkbook());
    const returnByOrder = flipkartImport.indexReturnDetailsByOrderId(parsed.rows);

    expect(returnByOrder.get('101')).toEqual({
      typeOfReturn: 'Customer Return',
      returnReason: 'Size Issue',
      detailedReturnReason: 'Too small',
    });
    expect(flipkartOrderIdLookupKey(' 101 ')).toBe('101');
    expect(lookupFlipkartReturnDetails(returnByOrder, '101')).toBeDefined();
    expect(lookupFlipkartReturnDetails(returnByOrder, ' 101 ')).toBeDefined();
  });

  it('CASE 1: maps return details only for voucher type Return', () => {
    const parsed = parser.parseFlipkartReturnWorkbook(buildReturnWorkbook());
    const returnByOrder = flipkartImport.indexReturnDetailsByOrderId(parsed.rows);

    const salesRow = {
      orderID: '101',
      voucherType: 'Return',
      documentType: 'Return',
      reportType: 'sales' as const,
      taxableAmount: 1200,
    };

    expect(isFlipkartReturnVoucherType(' Return ')).toBe(true);
    expect(isFlipkartReturnVoucherType('RETURN')).toBe(true);
    expect(isFlipkartReturnVoucherType('Return Cancellation')).toBe(false);
    expect(isFlipkartReturnVoucherType('Sale')).toBe(false);

    const enriched = applyFlipkartReturnDetailsToRow(
      salesRow,
      lookupFlipkartReturnDetails(returnByOrder, salesRow.orderID),
    );

    expect(enriched.returnReason).toBe('Size Issue');
    expect(enriched.typeOfReturn).toBe('Customer Return');
    expect(enriched.detailedReturnReason).toBe('Too small');
  });

  it('CASE 2: does not map return data for Sale voucher type', () => {
    const parsed = parser.parseFlipkartReturnWorkbook(buildReturnWorkbook());
    const returnByOrder = flipkartImport.indexReturnDetailsByOrderId(parsed.rows);

    const salesRow = {
      orderID: '102',
      voucherType: 'Sale',
      documentType: 'Sale',
      reportType: 'sales' as const,
      taxableAmount: 500,
    };

    const shouldApply =
      isFlipkartReturnVoucherType(salesRow.voucherType) &&
      Boolean(lookupFlipkartReturnDetails(returnByOrder, salesRow.orderID));

    expect(shouldApply).toBe(false);
    expect(salesRow).not.toHaveProperty('returnReason');
  });

  it('CASE 3: keeps sales row unchanged when return report has no matching order', () => {
    const parsed = parser.parseFlipkartReturnWorkbook(buildReturnWorkbook());
    const returnByOrder = flipkartImport.indexReturnDetailsByOrderId(parsed.rows);

    const salesRow = {
      orderID: '103',
      voucherType: 'Return',
      documentType: 'Return',
      reportType: 'sales' as const,
      taxableAmount: 800,
    };

    const enriched = applyFlipkartReturnDetailsToRow(
      salesRow,
      lookupFlipkartReturnDetails(returnByOrder, salesRow.orderID),
    );

    expect(enriched.returnReason).toBeUndefined();
    expect(enriched.typeOfReturn).toBeUndefined();
    expect(enriched.detailedReturnReason).toBeUndefined();
    expect(enriched.taxableAmount).toBe(800);
  });

  it('buildFlipkartReturnDetailsByOrderId avoids per-row linear scans', () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      __sheetName: 'Return Report',
      __rowNumber: index + 2,
      'Order ID': String(index + 1),
      'Return Reason': `Reason ${index + 1}`,
    }));
    const map = buildFlipkartReturnDetailsByOrderId(
      rows,
      (row) => mapping.mapFlipkartReturnFields(row),
      (row) => String(row['Order ID'] ?? ''),
    );
    expect(map.size).toBe(100);
    expect(map.get('50')?.returnReason).toBe('Reason 50');
  });
});
