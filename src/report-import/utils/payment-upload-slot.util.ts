import { isMyntraPaymentSlot } from './myntra-payment-upload.util';

export function isPaymentUploadSlot(slot: string): boolean {
  const key = String(slot ?? '').trim();
  return (
    key === 'paymentReportFile' ||
    key.startsWith('amazonPaymentFile:') ||
    isMyntraPaymentSlot(key)
  );
}
