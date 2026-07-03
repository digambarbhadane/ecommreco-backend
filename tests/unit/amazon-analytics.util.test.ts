import {
  classifyAmazonTransactionType,
  isAmazonReturnCategory,
  isAmazonSaleCategory,
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
});
