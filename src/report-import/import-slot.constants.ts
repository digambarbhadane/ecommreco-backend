import type { MarketplaceUploadKey } from './marketplace-upload.routes';

/** Backend multipart / session slot names present in upload payloads. */
export const MARKETPLACE_TRACKED_SLOTS: Record<MarketplaceUploadKey, string[]> = {
  flipkart: ['file'],
  amazon: ['mtrB2cFile', 'mtrB2bFile'],
  meesho: [
    'tcsSalesFile',
    'tcsSalesReturnFile',
    'orderReportFile',
    'returnReportFile',
    'paymentReportFile',
  ],
  myntra: [
    'gstrReportPackedFile',
    'salesRevenuePackedB2cFile',
    'gstrReportRtoFile',
    'gstrReportRtFile',
    'mDirectOrdersReportFile',
    'mDirectReturnsReportFile',
  ],
};

/** Slots required before a month is marked complete in the UI. */
export const MARKETPLACE_COMPLETION_SLOTS: Record<MarketplaceUploadKey, string[]> = {
  flipkart: ['file'],
  amazon: ['mtrB2cFile'],
  meesho: [
    'tcsSalesFile',
    'orderReportFile',
    'tcsSalesReturnFile',
    'returnReportFile',
    'paymentReportFile',
  ],
  myntra: [
    'gstrReportPackedFile',
    'salesRevenuePackedB2cFile',
    'gstrReportRtoFile',
    'gstrReportRtFile',
  ],
};

const FILE_HASH_SLOT_PREFIXES: Array<{ prefix: string; slot: string }> = [
  { prefix: 'tcsSales:', slot: 'tcsSalesFile' },
  { prefix: 'tcsSalesReturn:', slot: 'tcsSalesReturnFile' },
  { prefix: 'order:', slot: 'orderReportFile' },
  { prefix: 'return:', slot: 'returnReportFile' },
  { prefix: 'payment:', slot: 'paymentReportFile' },
  { prefix: 'b2c:', slot: 'mtrB2cFile' },
  { prefix: 'b2b:', slot: 'mtrB2bFile' },
  { prefix: 'gstr:', slot: 'gstrReportPackedFile' },
  { prefix: 'mdirect:', slot: 'mDirectOrdersReportFile' },
  { prefix: 'sales:', slot: 'salesRevenuePackedB2cFile' },
  { prefix: 'rto:', slot: 'gstrReportRtoFile' },
  { prefix: 'rt:', slot: 'gstrReportRtFile' },
  { prefix: 'returns:', slot: 'mDirectReturnsReportFile' },
];

function hashSegmentValue(fileHash: string, prefix: string): string | null {
  const idx = fileHash.indexOf(prefix);
  if (idx === -1) return null;
  const raw = fileHash.slice(idx + prefix.length);
  const end = raw.indexOf('|');
  const value = (end === -1 ? raw : raw.slice(0, end)).trim();
  return value || null;
}

/** Infer uploaded slots from legacy fileHash when uploadedSlots was not stored. */
export function inferUploadedSlotsFromFileHash(fileHash: string): string[] {
  const hash = String(fileHash ?? '').trim();
  if (!hash) return [];

  if (hash.startsWith('meesho-payment|')) {
    return ['paymentReportFile'];
  }

  if (hash.startsWith('single:')) {
    return ['file'];
  }

  const slots: string[] = [];
  for (const { prefix, slot } of FILE_HASH_SLOT_PREFIXES) {
    const value = hashSegmentValue(hash, prefix);
    if (value && value !== 'none') {
      slots.push(slot);
    }
  }
  return slots;
}

export function collectUploadedSlotsFromFiles(
  files: Record<string, { buffer?: Buffer } | undefined>,
): string[] {
  return Object.entries(files)
    .filter(([, file]) => Boolean(file?.buffer?.length))
    .map(([slot]) => slot);
}

export function isMonthComplete(
  marketplace: MarketplaceUploadKey,
  uploadedSlots: Set<string>,
): boolean {
  const required = MARKETPLACE_COMPLETION_SLOTS[marketplace] ?? [];
  return required.every((slot) => uploadedSlots.has(slot));
}
