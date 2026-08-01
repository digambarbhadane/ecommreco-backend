import { Connection, ClientSession, Types } from 'mongoose';

export type MarketplaceScopeToken = {
  linkId: string;
  platformId?: string;
  platformSlug?: string;
  platformName?: string;
};

export type DeletionScopeInput = {
  sellerAliases: string[];
  gstId: string;
  gstNumber?: string;
  marketplaceTokens?: MarketplaceScopeToken[];
  /** gst = remove one GST (+ its marketplaces). marketplace = remove one marketplace link only. */
  mode?: 'gst' | 'marketplace';
};

export type DeletionSummary = {
  deletedCollections: Array<{ collection: string; deletedCount: number }>;
  totalRecordsDeleted: number;
};

/**
 * Never cascade-delete these collections — they are shared or account-level.
 */
const PROTECTED_COLLECTIONS = new Set<string>([
  'users',
  'sellers',
  'roles',
  'subscription_packages',
  'subscriptions',
  'platformmarketplaces',
  'marketplaces',
  'gsts',
  'deletion_audit_logs',
  'counters',
  'leads',
  'pan_slot_requests',
  'pan_slot_transactions',
  'pan_slot_pricing',
  'gstinverifications',
  'notifications',
  'user_security',
  'user_activity_logs',
  'useractivitylogs',
  'usersecurity',
]);

function toObjectIds(values: string[]): Types.ObjectId[] {
  return values
    .filter((value) => Types.ObjectId.isValid(value))
    .map((value) => new Types.ObjectId(value));
}

function buildSellerFilters(sellerAliases: string[]): Record<string, unknown>[] {
  const sellerCandidates = Array.from(
    new Set(sellerAliases.map((value) => String(value).trim()).filter(Boolean)),
  );
  const sellerObjectIds = toObjectIds(sellerCandidates);
  const filters: Record<string, unknown>[] = [];
  if (sellerCandidates.length) {
    filters.push({ sellerId: { $in: sellerCandidates } });
  }
  if (sellerObjectIds.length) {
    filters.push({ sellerId: { $in: sellerObjectIds } });
  }
  return filters;
}

function buildGstOnlyFilters(input: DeletionScopeInput): Record<string, unknown>[] {
  const gstCandidates = [String(input.gstId ?? '').trim()].filter(Boolean);
  const gstObjectIds = toObjectIds(gstCandidates);
  const gstNumber = String(input.gstNumber ?? '').trim().toUpperCase();
  const filters: Record<string, unknown>[] = [];
  if (gstCandidates.length) {
    filters.push({ gstId: { $in: gstCandidates } });
  }
  if (gstObjectIds.length) {
    filters.push({ gstId: { $in: gstObjectIds } });
  }
  if (gstNumber) {
    filters.push({ gstin: gstNumber });
    filters.push({ gstNumber });
  }
  return filters;
}

/**
 * Marketplace deletes must use the marketplace *link* id only.
 * Never use platform slug/name (e.g. "flipkart") — that would wipe every
 * Flipkart row for the seller across all GSTs.
 */
function buildMarketplaceLinkFilters(
  tokens: MarketplaceScopeToken[],
): Record<string, unknown>[] {
  const linkIds = Array.from(
    new Set(
      tokens
        .map((token) => String(token.linkId ?? '').trim())
        .filter(Boolean),
    ),
  );
  if (!linkIds.length) return [];

  const linkObjectIds = toObjectIds(linkIds);
  const filters: Record<string, unknown>[] = [
    { marketplace: { $in: linkIds } },
    { marketplaceId: { $in: linkIds } },
    { linkId: { $in: linkIds } },
  ];
  if (linkObjectIds.length) {
    filters.push({ marketplace: { $in: linkObjectIds } });
    filters.push({ marketplaceId: { $in: linkObjectIds } });
    filters.push({ platformMarketplaceId: { $in: linkObjectIds } });
    filters.push({ linkId: { $in: linkObjectIds } });
  }
  return filters;
}

/**
 * Build a scoped delete filter.
 *
 * GST mode: seller AND (gstId OR gstin) only.
 * Marketplace mode: seller AND marketplace-link-id only.
 *
 * Never match on platform slug/name alone.
 * Never match on sellerId alone.
 */
export function buildCascadeDeleteFilter(
  input: DeletionScopeInput,
): Record<string, unknown> | null {
  const mode = input.mode ?? 'gst';
  const sellerFilters = buildSellerFilters(input.sellerAliases);

  if (mode === 'marketplace') {
    const marketplaceFilters = buildMarketplaceLinkFilters(
      input.marketplaceTokens ?? [],
    );
    if (!marketplaceFilters.length) return null;
    if (sellerFilters.length) {
      return {
        $and: [{ $or: sellerFilters }, { $or: marketplaceFilters }],
      };
    }
    return { $or: marketplaceFilters };
  }

  const gstFilters = buildGstOnlyFilters(input);
  if (!gstFilters.length) return null;
  if (sellerFilters.length) {
    return {
      $and: [{ $or: sellerFilters }, { $or: gstFilters }],
    };
  }
  return { $or: gstFilters };
}

export async function cascadeDeleteAcrossCollections(
  connection: Connection,
  input: DeletionScopeInput,
  session?: ClientSession | null,
): Promise<DeletionSummary> {
  const db = connection.db;
  if (!db) {
    throw new Error('MongoDB connection is not initialized');
  }

  const deleteQuery = buildCascadeDeleteFilter(input);
  if (!deleteQuery) {
    return { deletedCollections: [], totalRecordsDeleted: 0 };
  }

  const list = await db.listCollections().toArray();
  const collections = list
    .map((item) => String(item.name ?? '').trim())
    .filter(
      (collection) =>
        collection &&
        !PROTECTED_COLLECTIONS.has(collection) &&
        !collection.startsWith('system.'),
    );

  const deletedCollections: Array<{ collection: string; deletedCount: number }> =
    [];
  let totalRecordsDeleted = 0;

  const concurrency = 4;
  for (let i = 0; i < collections.length; i += concurrency) {
    const batch = collections.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (collection) => {
        const result = await db.collection(collection).deleteMany(
          deleteQuery,
          session ? { session } : undefined,
        );
        return {
          collection,
          deletedCount: Number(result.deletedCount ?? 0),
        };
      }),
    );
    for (const row of results) {
      if (row.deletedCount <= 0) continue;
      deletedCollections.push(row);
      totalRecordsDeleted += row.deletedCount;
    }
  }

  return { deletedCollections, totalRecordsDeleted };
}
