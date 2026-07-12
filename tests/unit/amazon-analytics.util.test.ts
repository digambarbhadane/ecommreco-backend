import {
  classifyAmazonImportRowForSummary,
  classifyAmazonTransactionType,
  isAmazonB2bCancelRow,
  isAmazonCountableReturnTransaction,
  isAmazonReturnCategory,
  isAmazonSaleCategory,
  shouldSkipAmazonMtrImportRow,
} from '../../src/report-import/utils/amazon-analytics.util';

describe('amazon-analytics.util', () => {
  it('classifies Amazon MTR transaction types', () => {
    expect(classifyAmazonTransactionType('Shipment')).toBe('shipment');
    expect(classifyAmazonTransactionType('Refund')).toBe('refund');
    expect(classifyAmazonTransactionType('Cancel')).toBe('cancellation');
    expect(classifyAmazonTransactionType('Return')).toBe('return');
    expect(classifyAmazonTransactionType('Sale')).toBe('sale');
  });

  it('prefers cancellation over refund when both appear in label', () => {
    expect(classifyAmazonTransactionType('Refund Cancellation')).toBe('cancellation');
  });

  it('groups sale and return categories for summary helpers', () => {
    expect(isAmazonSaleCategory('shipment')).toBe(true);
    expect(isAmazonReturnCategory('refund')).toBe(true);
    expect(isAmazonReturnCategory('shipment')).toBe(false);
  });

  it('excludes Cancel from countable return transactions', () => {
    expect(shouldSkipAmazonMtrImportRow('Cancel', 'Cancel')).toBe(true);
    expect(shouldSkipAmazonMtrImportRow('Refund', 'Refund')).toBe(false);
    expect(
      isAmazonB2bCancelRow('b2b', 'Cancel', 'Cancel', '29ABCDE1234F1Z5'),
    ).toBe(true);
    expect(
      isAmazonCountableReturnTransaction(
        'Cancel',
        'Cancel',
        'b2b',
        '29ABCDE1234F1Z5',
      ),
    ).toBe(false);
    expect(
      isAmazonCountableReturnTransaction('Cancel', 'Cancel', 'b2c'),
    ).toBe(false);
    expect(
      isAmazonCountableReturnTransaction('Refund', 'Refund', 'b2b'),
    ).toBe(true);
  });

  it('classifies summary buckets including NA catch-all returns', () => {
    expect(
      classifyAmazonImportRowForSummary({
        documentType: 'Refund',
        voucherType: 'Refund',
        amazonMtrSource: 'b2c',
        amazonReturnSubType: 'na',
      }),
    ).toBe('na');
    expect(
      classifyAmazonImportRowForSummary({
        documentType: 'Return Report',
        amazonReturnSubType: 'na',
      }),
    ).toBe('na');
    expect(
      classifyAmazonImportRowForSummary({
        documentType: 'Cancel',
        voucherType: 'Cancel',
        amazonMtrSource: 'b2c',
      }),
    ).toBe('cancel');
    expect(
      classifyAmazonImportRowForSummary({
        documentType: 'Cancel',
        voucherType: 'Cancel',
        amazonMtrSource: 'b2b',
        customerGstNo: '29ABCDE1234F1Z5',
      }),
    ).toBe('b2b_cancel');
  });
});
