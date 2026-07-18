import type { MarketplaceUploadKey } from './marketplace-upload.routes';

/** Backend multipart / session slot names present in upload payloads. */
export const MARKETPLACE_TRACKED_SLOTS: Record<MarketplaceUploadKey, string[]> = {
  flipkart: ['file', 'returnReportFile', 'paymentReportFile'],
  amazon: [
    'mtrB2cFile',
    'mtrB2bFile',
    'amazonReturnReportFile',
    'paymentReportFile',
  ],
  meesho: [
    'tcsSalesFile',
    'tcsSalesReturnFile',
    'orderReportFile',
    'returnInTransitReportFile',
    'returnOutForDeliveryReportFile',
    'returnDeliveryCompleteReportFile',
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

/** Primary import slot whose upload owns persisted import rows for a month. */
export const PRIMARY_IMPORT_SLOT: Record<MarketplaceUploadKey, string> = {
  flipkart: 'file',
  amazon: 'mtrB2cFile',
  meesho: 'tcsSalesFile',
  myntra: 'gstrReportPackedFile',
};

/** Slots required before a month is marked complete in the UI. */
export const MARKETPLACE_COMPLETION_SLOTS: Record<MarketplaceUploadKey, string[]> = {
  flipkart: ['file'],
  amazon: ['mtrB2cFile'],
  meesho: [
    'tcsSalesFile',
    'orderReportFile',
    'tcsSalesReturnFile',
    'returnInTransitReportFile',
    'returnOutForDeliveryReportFile',
    'returnDeliveryCompleteReportFile',
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
  { prefix: 'returnInTransit:', slot: 'returnInTransitReportFile' },
  { prefix: 'returnOutForDelivery:', slot: 'returnOutForDeliveryReportFile' },
  { prefix: 'returnDeliveryComplete:', slot: 'returnDeliveryCompleteReportFile' },
  { prefix: 'return:', slot: 'returnDeliveryCompleteReportFile' },
  { prefix: 'payment:', slot: 'paymentReportFile' },
  { prefix: 'return:', slot: 'returnReportFile' },
  { prefix: 'b2c:', slot: 'mtrB2cFile' },
  { prefix: 'b2b:', slot: 'mtrB2bFile' },
  { prefix: 'amazonReturn:', slot: 'amazonReturnReportFile' },
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

  if (hash.startsWith('flipkart-payment|')) {
    return ['paymentReportFile'];
  }

  if (hash.startsWith('amazon-payment|')) {
    return ['paymentReportFile'];
  }

  if (hash.startsWith('flipkart-return|')) {
    return ['returnReportFile'];
  }

  if (hash.startsWith('amazon-return|')) {
    return ['amazonReturnReportFile'];
  }

  if (hash.startsWith('amazon|')) {
    const slots: string[] = [];
    const b2cHash = hashSegmentValue(hash, 'b2c:');
    const b2bHash = hashSegmentValue(hash, 'b2b:');
    const returnHash = hashSegmentValue(hash, 'return:');
    if (b2cHash && b2cHash !== 'none') {
      slots.push('mtrB2cFile');
    }
    if (b2bHash && b2bHash !== 'none') {
      slots.push('mtrB2bFile');
    }
    if (returnHash && returnHash !== 'none') {
      slots.push('amazonReturnReportFile');
    }
    return slots;
  }

  if (hash.startsWith('flipkart|')) {
    const slots: string[] = [];
    const salesHash = hashSegmentValue(hash, 'sales:');
    const returnHash = hashSegmentValue(hash, 'return:');
    const paymentHash = hashSegmentValue(hash, 'payment:');
    if (salesHash && salesHash !== 'none') {
      slots.push('file');
    }
    if (returnHash && returnHash !== 'none') {
      slots.push('returnReportFile');
    }
    if (paymentHash && paymentHash !== 'none') {
      slots.push('paymentReportFile');
    }
    return slots;
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
