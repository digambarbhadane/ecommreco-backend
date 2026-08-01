export const AMAZON_MAX_PAYMENT_FILES = 25;

export const AMAZON_PAYMENT_SLOT_PREFIX = 'amazonPaymentFile:';

export function buildAmazonPaymentSlotKey(contentHash: string): string {
  return `${AMAZON_PAYMENT_SLOT_PREFIX}${contentHash}`;
}

export function isAmazonPaymentSlot(slot: string): boolean {
  return (
    slot === 'paymentReportFile' || slot.startsWith(AMAZON_PAYMENT_SLOT_PREFIX)
  );
}

export function parseAmazonPaymentContentHash(slot: string): string | null {
  if (!slot.startsWith(AMAZON_PAYMENT_SLOT_PREFIX)) return null;
  const hash = slot.slice(AMAZON_PAYMENT_SLOT_PREFIX.length).trim();
  return hash || null;
}

export function buildAmazonPaymentFileHash(
  contentHash: string,
  reportMonth: string,
): string {
  return `amazon-payment|${contentHash}|month:${reportMonth}`;
}
