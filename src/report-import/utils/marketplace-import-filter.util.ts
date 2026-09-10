import { Types, type Model } from 'mongoose';
import type { MarketplaceDocument } from '../../marketplaces/schemas/marketplace.schema';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function resolveSellerMarketplaceLinkIds(
  marketplaceModel: Model<MarketplaceDocument>,
  sellerAliases: string[],
  marketplaceSlug: string,
  gstId?: string,
): Promise<string[]> {
  const slug = String(marketplaceSlug ?? '')
    .trim()
    .toLowerCase();
  if (!slug || sellerAliases.length === 0) return [];

  const filter: Record<string, unknown> = {
    sellerId: { $in: sellerAliases },
  };
  const scopedGstId = String(gstId ?? '').trim();
  if (scopedGstId) {
    filter.gstId = scopedGstId;
  }

  const links = await marketplaceModel
    .find(filter)
    .populate('platformMarketplaceId')
    .select({ _id: 1, platformMarketplaceId: 1 })
    .lean()
    .exec();

  const ids: string[] = [];
  for (const link of links) {
    const platform = link.platformMarketplaceId as
      | { slug?: string; name?: string }
      | null
      | undefined;
    const platformSlug = String(platform?.slug ?? '')
      .trim()
      .toLowerCase();
    const name = String(platform?.name ?? '')
      .trim()
      .toLowerCase();
    if (platformSlug === slug || name.includes(slug)) {
      ids.push(String(link._id));
    }
  }
  return ids;
}

/**
 * import_rows.marketplace is usually a seller-marketplace link ObjectId.
 * Card clicks and All-GST filters pass platform slugs (amazon/flipkart/…).
 * When gstId is provided, slug expansion is limited to that GST's links.
 */
export async function applyImportRowMarketplaceFilter(
  filter: Record<string, unknown>,
  marketplaceModel: Model<MarketplaceDocument>,
  sellerAliases: string[],
  marketplace?: string,
  gstId?: string,
): Promise<void> {
  const raw = String(marketplace ?? '').trim();
  if (!raw) return;

  const pushClause = (clause: Record<string, unknown>) => {
    if (Array.isArray(filter.$and)) {
      filter.$and.push(clause);
      return;
    }
    filter.$and = [clause];
  };

  if (Types.ObjectId.isValid(raw)) {
    pushClause({
      $or: [{ marketplace: raw }, { marketplace: new Types.ObjectId(raw) }],
    });
    return;
  }

  const slug = raw.toLowerCase();
  const linkIds = await resolveSellerMarketplaceLinkIds(
    marketplaceModel,
    sellerAliases,
    slug,
    gstId,
  );
  const clauses: Record<string, unknown>[] = [
    { marketplace: { $regex: new RegExp(`^${escapeRegex(slug)}`, 'i') } },
  ];
  if (linkIds.length > 0) {
    clauses.push({ marketplace: { $in: linkIds } });
    const objectIds = linkIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (objectIds.length > 0) {
      clauses.push({ marketplace: { $in: objectIds } });
    }
  }
  pushClause({ $or: clauses });
}

export function readSellerAliasesFromFilter(
  filter: Record<string, unknown>,
): string[] {
  const sellerId = filter.sellerId;
  if (
    sellerId &&
    typeof sellerId === 'object' &&
    Array.isArray((sellerId as { $in?: unknown }).$in)
  ) {
    return (sellerId as { $in: string[] }).$in.map(String).filter(Boolean);
  }
  if (typeof sellerId === 'string' && sellerId.trim()) {
    return [sellerId.trim()];
  }
  return [];
}
