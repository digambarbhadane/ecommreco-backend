import {
  buildAmazonPaymentFileHash,
  buildAmazonPaymentSlotKey,
  isAmazonPaymentSlot,
} from '../../src/report-import/utils/amazon-payment-upload.util';

describe('amazon-payment-upload.util', () => {
  it('builds stable slot and file hash keys', () => {
    const slot = buildAmazonPaymentSlotKey('abc123');
    expect(slot).toBe('amazonPaymentFile:abc123');
    expect(isAmazonPaymentSlot(slot)).toBe(true);
    expect(buildAmazonPaymentFileHash('abc123', '2025-03')).toBe(
      'amazon-payment|abc123|month:2025-03',
    );
  });
});
