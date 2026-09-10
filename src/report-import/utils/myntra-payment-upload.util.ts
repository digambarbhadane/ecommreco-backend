export const MYNTRA_PAYMENT_SLOTS = [
  'pgForwardSettledFile',
  'pgReverseSettledFile',
] as const;

export type MyntraPaymentSlot = (typeof MYNTRA_PAYMENT_SLOTS)[number];

export function isMyntraPaymentSlot(slot: string): boolean {
  return (MYNTRA_PAYMENT_SLOTS as readonly string[]).includes(slot);
}

export function hasMyntraPaymentFiles(
  files: Partial<Record<MyntraPaymentSlot | string, unknown>>,
): boolean {
  return MYNTRA_PAYMENT_SLOTS.some((slot) => Boolean(files[slot]));
}

export function inferMyntraPaymentSlotsFromFileHash(
  fileHash: string,
): string[] {
  const hash = String(fileHash ?? '').trim();
  if (!hash.startsWith('myntra-payment|')) return [];
  const slots: string[] = [];
  if (/forward:(?!none)/.test(hash)) {
    slots.push('pgForwardSettledFile');
  }
  if (/reverse:(?!none)/.test(hash)) {
    slots.push('pgReverseSettledFile');
  }
  if (!slots.length) {
    return ['pgForwardSettledFile'];
  }
  return slots;
}

export function buildMyntraPaymentFileHash(parts: {
  forwardHash?: string;
  reverseHash?: string;
  reportMonth?: string;
}): string {
  const forward = parts.forwardHash?.trim() || 'none';
  const reverse = parts.reverseHash?.trim() || 'none';
  const month = parts.reportMonth?.trim() || '';
  return `myntra-payment|forward:${forward}|reverse:${reverse}|month:${month}`;
}
