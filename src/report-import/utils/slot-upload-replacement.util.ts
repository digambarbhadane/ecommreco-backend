import type { MarketplaceUploadKey } from '../marketplace-upload.routes';

export function buildSlotRowDeletionFilter(input: {
  marketplace: MarketplaceUploadKey;
  slot: string;
  uploadId: string;
  uploadSlots?: string[];
}): Record<string, unknown> {
  const { marketplace, slot, uploadId, uploadSlots = [] } = input;
  const base: Record<string, unknown> = { uploadId };

  if (marketplace === 'amazon') {
    if (slot === 'mtrB2cFile') {
      return { ...base, amazonMtrSource: 'b2c' };
    }
    if (slot === 'mtrB2bFile') {
      return { ...base, amazonMtrSource: 'b2b' };
    }
    return base;
  }

  if (uploadSlots.length === 1 && uploadSlots[0] === slot) {
    return base;
  }

  return base;
}

export function shouldRetireEntireUpload(
  uploadSlots: string[],
  slotBeingReplaced: string,
): boolean {
  return uploadSlots.length === 1 && uploadSlots[0] === slotBeingReplaced;
}
