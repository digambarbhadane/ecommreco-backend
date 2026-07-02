import type { MarketplaceUploadKey } from '../marketplace-upload.routes';

type UploadLike = {
  fileName?: string;
  fileHash?: string;
  fileSize?: number;
  totalRecords?: number;
  salesRecords?: number;
  cashbackRecords?: number;
};

type SlotRecordLike = {
  fileName?: string;
  fileSize?: number;
  totalRecords?: number;
  salesRecords?: number;
  cashbackRecords?: number;
  includeDbBreakdown?: boolean;
};

export type ResolvedSlotSummary = {
  fileName: string;
  fileSize?: number;
  totalRecords: number;
  salesRecords: number;
  cashbackRecords: number;
  includeDbBreakdown: boolean;
  hasStoredStats: boolean;
  hasResolvedStats: boolean;
};

const FILENAME_SLOT_ORDER: Record<
  MarketplaceUploadKey,
  Array<{ slot: string; hashPrefix: string }>
> = {
  meesho: [
    { slot: 'tcsSalesFile', hashPrefix: 'tcsSales:' },
    { slot: 'tcsSalesReturnFile', hashPrefix: 'tcsSalesReturn:' },
    { slot: 'orderReportFile', hashPrefix: 'order:' },
    { slot: 'returnInTransitReportFile', hashPrefix: 'returnInTransit:' },
    { slot: 'returnOutForDeliveryReportFile', hashPrefix: 'returnOutForDelivery:' },
    { slot: 'returnDeliveryCompleteReportFile', hashPrefix: 'returnDeliveryComplete:' },
    { slot: 'returnDeliveryCompleteReportFile', hashPrefix: 'return:' },
    { slot: 'paymentReportFile', hashPrefix: 'payment:' },
  ],
  flipkart: [
    { slot: 'file', hashPrefix: 'sales:' },
    { slot: 'paymentReportFile', hashPrefix: 'payment:' },
  ],
  amazon: [
    { slot: 'mtrB2bFile', hashPrefix: 'b2b:' },
    { slot: 'mtrB2cFile', hashPrefix: 'b2c:' },
  ],
  myntra: [
    { slot: 'gstrReportPackedFile', hashPrefix: 'gstr:' },
    { slot: 'mDirectOrdersReportFile', hashPrefix: 'mdirect:' },
    { slot: 'salesRevenuePackedB2cFile', hashPrefix: 'sales:' },
    { slot: 'gstrReportRtoFile', hashPrefix: 'rto:' },
    { slot: 'gstrReportRtFile', hashPrefix: 'rt:' },
    { slot: 'mDirectReturnsReportFile', hashPrefix: 'returns:' },
  ],
};

function hashSegmentValue(fileHash: string, prefix: string): string | null {
  const idx = fileHash.indexOf(prefix);
  if (idx === -1) return null;
  const raw = fileHash.slice(idx + prefix.length);
  const end = raw.indexOf('|');
  const value = (end === -1 ? raw : raw.slice(0, end)).trim();
  return value || null;
}

export function inferMarketplaceKeyFromFileHash(
  fileHash: string,
): MarketplaceUploadKey | undefined {
  const hash = String(fileHash ?? '').trim();
  if (hash.startsWith('meesho')) return 'meesho';
  if (hash.startsWith('flipkart')) return 'flipkart';
  if (hash.startsWith('amazon')) return 'amazon';
  if (hash.startsWith('myntra')) return 'myntra';
  if (hash.startsWith('single:')) return 'flipkart';
  return undefined;
}

export function getUploadedSlotsInFilenameOrder(
  marketplace: MarketplaceUploadKey,
  fileHash: string,
): string[] {
  const hash = String(fileHash ?? '').trim();
  if (hash.startsWith('single:')) {
    return ['file'];
  }

  return (FILENAME_SLOT_ORDER[marketplace] ?? [])
    .filter(({ hashPrefix }) => {
      const value = hashSegmentValue(hash, hashPrefix);
      return Boolean(value && value !== 'none');
    })
    .map(({ slot }) => slot);
}

export function extractSlotFileName(
  slot: string,
  marketplace: MarketplaceUploadKey | undefined,
  fileHash: string,
  combinedFileName: string,
): string {
  const combined = String(combinedFileName ?? '').trim();
  if (!combined) return '';

  const ownName = combined.includes(' + ') ? '' : combined;
  if (ownName) return ownName;

  if (!marketplace) return combined;

  const parts = combined
    .split(' + ')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? combined;

  const slotsInOrder = getUploadedSlotsInFilenameOrder(marketplace, fileHash);
  const idx = slotsInOrder.indexOf(slot);
  if (idx >= 0 && idx < parts.length) {
    return parts[idx]!;
  }

  return combined;
}

export function isPrimaryImportSlot(
  marketplace: MarketplaceUploadKey,
  slot: string,
  uploadedSlots: string[],
): boolean {
  switch (marketplace) {
    case 'meesho':
      return slot === 'tcsSalesFile';
    case 'flipkart':
      return slot === 'file';
    case 'myntra':
      return slot === 'gstrReportPackedFile';
    case 'amazon':
      if (slot === 'mtrB2cFile') return uploadedSlots.includes('mtrB2cFile');
      if (slot === 'mtrB2bFile') {
        return (
          uploadedSlots.includes('mtrB2bFile') &&
          !uploadedSlots.includes('mtrB2cFile')
        );
      }
      return false;
    default:
      return false;
  }
}

export function resolveSlotIncludeDbBreakdown(
  slotRecord: SlotRecordLike | null,
  marketplace: MarketplaceUploadKey | undefined,
  slot: string,
  uploadedSlots: string[],
  isPaymentOnly: boolean,
): boolean {
  if (isPaymentOnly) return false;
  if (slotRecord?.includeDbBreakdown === true) return true;
  if (uploadedSlots.length === 1 && uploadedSlots[0] === slot) return true;
  if (marketplace && isPrimaryImportSlot(marketplace, slot, uploadedSlots)) {
    return true;
  }
  return false;
}

export function resolveSlotSummary(input: {
  slot: string;
  marketplace?: MarketplaceUploadKey;
  uploadedSlots: string[];
  isPaymentOnly: boolean;
  upload: UploadLike;
  slotRecord: SlotRecordLike | null;
}): ResolvedSlotSummary {
  const { slot, uploadedSlots, isPaymentOnly, upload, slotRecord } = input;
  const marketplace =
    input.marketplace ??
    inferMarketplaceKeyFromFileHash(String(upload.fileHash ?? ''));

  const combinedName = slotRecord?.fileName ?? upload.fileName ?? '';
  const fileName = extractSlotFileName(
    slot,
    marketplace,
    String(upload.fileHash ?? ''),
    combinedName,
  );

  const hasStoredStats = slotRecord?.totalRecords != null;
  if (hasStoredStats) {
    return {
      fileName,
      fileSize: slotRecord?.fileSize,
      totalRecords: slotRecord!.totalRecords!,
      salesRecords: slotRecord?.salesRecords ?? 0,
      cashbackRecords: slotRecord?.cashbackRecords ?? 0,
      includeDbBreakdown: resolveSlotIncludeDbBreakdown(
        slotRecord,
        marketplace,
        slot,
        uploadedSlots,
        isPaymentOnly,
      ),
      hasStoredStats: true,
      hasResolvedStats: true,
    };
  }

  const includeDbBreakdown = resolveSlotIncludeDbBreakdown(
    slotRecord,
    marketplace,
    slot,
    uploadedSlots,
    isPaymentOnly,
  );

  if (isPaymentOnly) {
    return {
      fileName,
      fileSize: slotRecord?.fileSize ?? upload.fileSize,
      totalRecords: upload.totalRecords ?? 0,
      salesRecords: upload.salesRecords ?? 0,
      cashbackRecords: upload.cashbackRecords ?? 0,
      includeDbBreakdown: false,
      hasStoredStats: false,
      hasResolvedStats: (upload.totalRecords ?? 0) > 0,
    };
  }

  const isSingleSlotUpload =
    uploadedSlots.length === 1 && uploadedSlots[0] === slot;
  const isPrimary =
    marketplace != null &&
    isPrimaryImportSlot(marketplace, slot, uploadedSlots);

  if (isSingleSlotUpload || isPrimary) {
    return {
      fileName,
      fileSize: slotRecord?.fileSize ?? upload.fileSize,
      totalRecords: upload.totalRecords ?? 0,
      salesRecords: upload.salesRecords ?? 0,
      cashbackRecords: upload.cashbackRecords ?? 0,
      includeDbBreakdown,
      hasStoredStats: false,
      hasResolvedStats: (upload.totalRecords ?? 0) > 0,
    };
  }

  return {
    fileName,
    fileSize: slotRecord?.fileSize,
    totalRecords: 0,
    salesRecords: 0,
    cashbackRecords: 0,
    includeDbBreakdown: false,
    hasStoredStats: false,
    hasResolvedStats: false,
  };
}
