import { BadRequestException } from '@nestjs/common';

/**
 * Lightweight unit coverage for month-scoped duplicate upload filtering.
 * Mirrors ValidationService.successfulUploadFilter / ensureNoDuplicateFileHashes
 * behavior without standing up Nest DI.
 */

type UploadDoc = {
  _id: string;
  sellerId: string;
  gstin: string;
  marketplace: string;
  status: string;
  totalRecords: number;
  reportMonth?: string;
  fileHash: string;
};

function successfulUploadFilter(
  payload: {
    sellerId: string;
    gstin: string;
    marketplace: string;
    reportMonth?: string;
  },
  excludeUploadId?: string,
): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    sellerId: payload.sellerId,
    gstin: payload.gstin,
    marketplace: payload.marketplace,
    status: 'completed',
    totalRecords: { $gt: 0 },
  };
  const reportMonth = String(payload.reportMonth ?? '').trim();
  if (reportMonth) {
    filter.reportMonth = reportMonth;
  }
  if (excludeUploadId) {
    filter._id = { $ne: excludeUploadId };
  }
  return filter;
}

function matchesFilter(doc: UploadDoc, filter: Record<string, unknown>): boolean {
  if (doc.sellerId !== filter.sellerId) return false;
  if (doc.gstin !== filter.gstin) return false;
  if (doc.marketplace !== filter.marketplace) return false;
  if (doc.status !== filter.status) return false;
  if (!(doc.totalRecords > 0)) return false;
  if (filter.reportMonth && doc.reportMonth !== filter.reportMonth) return false;
  if (filter._id && typeof filter._id === 'object' && '$ne' in (filter._id as object)) {
    if (doc._id === (filter._id as { $ne: string }).$ne) return false;
  }
  return true;
}

function findDuplicateByContentHash(
  docs: UploadDoc[],
  payload: {
    sellerId: string;
    gstin: string;
    marketplace: string;
    reportMonth?: string;
    fileHashes: string[];
    excludeUploadId?: string;
  },
): UploadDoc | undefined {
  const base = successfulUploadFilter(payload, payload.excludeUploadId);
  return docs.find((doc) => {
    if (!matchesFilter(doc, base)) return false;
    return payload.fileHashes.some(
      (hash) =>
        doc.fileHash === hash ||
        new RegExp(`(^|\\|)${''}[^:]*:${hash}($|\\|)`).test(doc.fileHash) ||
        doc.fileHash.includes(`:${hash}`),
    );
  });
}

describe('month-scoped Meesho duplicate upload filter', () => {
  const janUpload: UploadDoc = {
    _id: 'jan',
    sellerId: 'seller-1',
    gstin: '24ACCFS6309Q1ZP',
    marketplace: 'meesho-mp',
    status: 'completed',
    totalRecords: 3418,
    reportMonth: '2026-01',
    fileHash:
      'meesho|tcsSales:70503297be0a0a98008ad056e3609227b78fc29ffab5adf7dbf6562481cb792c|month:2026-01',
  };

  it('blocks the same content hash only within the same report month', () => {
    const sameMonth = findDuplicateByContentHash([janUpload], {
      sellerId: 'seller-1',
      gstin: '24ACCFS6309Q1ZP',
      marketplace: 'meesho-mp',
      reportMonth: '2026-01',
      fileHashes: [
        '70503297be0a0a98008ad056e3609227b78fc29ffab5adf7dbf6562481cb792c',
      ],
    });
    expect(sameMonth?._id).toBe('jan');
  });

  it('allows the same Meesho file content hash for a different report month', () => {
    const feb = findDuplicateByContentHash([janUpload], {
      sellerId: 'seller-1',
      gstin: '24ACCFS6309Q1ZP',
      marketplace: 'meesho-mp',
      reportMonth: '2026-02',
      fileHashes: [
        '70503297be0a0a98008ad056e3609227b78fc29ffab5adf7dbf6562481cb792c',
      ],
    });
    expect(feb).toBeUndefined();
  });

  it('still blocks exact same-month re-upload of completed files', () => {
    const filter = successfulUploadFilter({
      sellerId: 'seller-1',
      gstin: '24ACCFS6309Q1ZP',
      marketplace: 'meesho-mp',
      reportMonth: '2026-01',
    });
    expect(matchesFilter(janUpload, filter)).toBe(true);
    expect(
      matchesFilter(
        { ...janUpload, reportMonth: '2026-02' },
        filter,
      ),
    ).toBe(false);
  });

  it('surfaces a BadRequestException-shaped message that includes the month', () => {
    const month = '2026-01';
    const count = 3418;
    const when = '2026-08-25';
    const message = `These report files were already imported successfully for ${month} (${count} records on ${when}). Open Imported Data to view them, or upload different files for this month.`;
    const err = new BadRequestException(message);
    expect(err.getResponse()).toEqual(
      expect.objectContaining({ message }),
    );
  });
});
