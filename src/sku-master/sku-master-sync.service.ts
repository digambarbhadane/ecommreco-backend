import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ImportUpload } from '../report-import/schemas/import-upload.schema';
import { ImportRow } from '../report-import/schemas/import-row.schema';
import {
  Marketplace,
  MarketplaceDocument,
} from '../marketplaces/schemas/marketplace.schema';
import {
  PlatformMarketplace,
  PlatformMarketplaceDocument,
} from '../platform-marketplaces/schemas/platform-marketplace.schema';
import { SkuMasterService } from './sku-master.service';

type RequestActor = {
  id?: string;
  role?: string;
  email?: string;
};

@Injectable()
export class SkuMasterSyncService {
  private readonly logger = new Logger(SkuMasterSyncService.name);
  private readonly marketplaceSlugCache = new Map<string, string>();
  /** Avoid re-aggregating imports on every pagination/search request. */
  private readonly lastSyncAtByKey = new Map<string, number>();
  private readonly syncTtlMs = 60_000;

  constructor(
    @InjectModel(ImportUpload.name)
    private readonly uploadModel: Model<ImportUpload>,
    @InjectModel(ImportRow.name)
    private readonly rowModel: Model<ImportRow>,
    @InjectModel(Marketplace.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
    @InjectModel(PlatformMarketplace.name)
    private readonly platformMarketplaceModel: Model<PlatformMarketplaceDocument>,
    private readonly skuMasterService: SkuMasterService,
  ) {}

  enqueueForUpload(uploadId: string) {
    if (!uploadId) return;
    setImmediate(() => {
      void this.syncFromUpload(uploadId);
    });
  }

  /**
   * Backfill UNMAPPED SKU master rows from import_rows for one GST or all
   * seller GSTs (when gstId is omitted). Safe to re-run — upserts only insert
   * missing marketplace SKUs.
   */
  async syncForScope(gstId: string | undefined, actor: RequestActor) {
    const requestedGstId = String(gstId ?? '').trim();
    const cacheKey = `${String(actor.id ?? actor.email ?? '')}:${requestedGstId || 'ALL'}`;
    const lastAt = this.lastSyncAtByKey.get(cacheKey) ?? 0;
    if (Date.now() - lastAt < this.syncTtlMs) {
      return { inserted: 0, skipped: 0 };
    }

    let result: { inserted: number; skipped: number };
    if (requestedGstId) {
      result = await this.syncForGst(requestedGstId, actor);
    } else {
      const gstIds = await this.skuMasterService.listAccessibleGstIds(actor);
      let inserted = 0;
      let skipped = 0;
      for (const id of gstIds) {
        const one = await this.syncForGst(id, actor);
        inserted += one.inserted;
        skipped += one.skipped;
      }
      result = { inserted, skipped };
    }

    this.lastSyncAtByKey.set(cacheKey, Date.now());
    return result;
  }

  async syncForGst(gstId: string, actor: RequestActor) {
    const { gst, sellerScope } =
      await this.skuMasterService.validateGstForSeller(gstId, actor);
    const gstin = String(gst.gstNumber ?? '')
      .trim()
      .toUpperCase();
    if (!gstin) return { inserted: 0, skipped: 0 };

    const gstinCandidates = Array.from(
      new Set(
        [
          gstin,
          gstin.toLowerCase(),
          String(gst.gstNumber ?? '').trim(),
        ].filter(Boolean),
      ),
    );

    const skuGroups = await this.rowModel
      .aggregate<{
        marketplaceId: string;
        marketplaceSku: string;
        productName?: string;
      }>([
        {
          $match: {
            sellerId: { $in: sellerScope.aliases },
            gstin: { $in: gstinCandidates },
            skuID: { $exists: true, $nin: [null, ''] },
          },
        },
        {
          $group: {
            _id: {
              marketplace: '$marketplace',
              skuID: '$skuID',
            },
            productName: { $first: '$buyerName' },
          },
        },
        {
          $project: {
            _id: 0,
            marketplaceId: '$_id.marketplace',
            marketplaceSku: '$_id.skuID',
            productName: 1,
          },
        },
      ])
      .allowDiskUse(true)
      .exec();

    if (!skuGroups.length) {
      return { inserted: 0, skipped: 0 };
    }

    const marketplaceIds = [
      ...new Set(
        skuGroups
          .map((row) => String(row.marketplaceId ?? '').trim())
          .filter(Boolean),
      ),
    ];
    const slugByMarketplaceId =
      await this.buildMarketplaceSlugMap(marketplaceIds);

    const groupedByMarketplace = new Map<
      string,
      Array<{ marketplaceSku: string; productName?: string }>
    >();

    for (const row of skuGroups) {
      const marketplaceSku = String(row.marketplaceSku ?? '').trim();
      if (!marketplaceSku) continue;
      const marketplace =
        slugByMarketplaceId.get(String(row.marketplaceId ?? '').trim()) ?? '';
      if (!marketplace) continue;

      const bucket = groupedByMarketplace.get(marketplace) ?? [];
      bucket.push({
        marketplaceSku,
        productName: row.productName ? String(row.productName) : undefined,
      });
      groupedByMarketplace.set(marketplace, bucket);
    }

    let inserted = 0;
    let skipped = 0;
    for (const [marketplace, skus] of groupedByMarketplace.entries()) {
      const result = await this.skuMasterService.upsertUnmappedSkus({
        sellerId: sellerScope.canonicalSellerId,
        gstId: String(gst._id),
        gstin,
        marketplace,
        skus,
        createdBy: actor.id ?? actor.email,
      });
      inserted += result.inserted;
      skipped += result.skipped;
    }

    if (inserted > 0) {
      this.logger.log(
        `GST SKU sync inserted=${inserted} skipped=${skipped} gst=${gstin} seller=${sellerScope.canonicalSellerId} marketplaces=${[...groupedByMarketplace.keys()].join(',')}`,
      );
    }

    return { inserted, skipped };
  }

  async syncFromUpload(uploadId: string) {
    try {
      const upload = await this.uploadModel.findById(uploadId).lean().exec();
      if (!upload || upload.status !== 'completed') return;

      const marketplaceSlug = await this.resolveMarketplaceSlug(
        String(upload.marketplace ?? ''),
      );
      if (!marketplaceSlug) {
        this.logger.warn(
          `SKU sync skipped: could not resolve marketplace slug for upload=${uploadId}`,
        );
        return;
      }

      const skuRows = await this.rowModel
        .aggregate<{
          _id: string;
          productName?: string;
        }>([
          {
            $match: {
              uploadId,
              skuID: { $exists: true, $nin: [null, ''] },
            },
          },
          {
            $group: {
              _id: '$skuID',
              productName: { $first: '$buyerName' },
            },
          },
        ])
        .exec();

      if (!skuRows.length) return;

      await this.skuMasterService.upsertUnmappedSkus({
        sellerId: String(upload.sellerId),
        gstId: String(upload.gstId),
        gstin: String(upload.gstin).trim().toUpperCase(),
        marketplace: marketplaceSlug,
        skus: skuRows.map((row) => ({
          marketplaceSku: String(row._id).trim(),
          productName: row.productName ? String(row.productName) : undefined,
        })),
        createdBy: upload.uploadedBy,
      });
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: unknown }).message)
          : String(err);
      this.logger.error(`SKU sync failed for upload=${uploadId}: ${message}`);
    }
  }

  private async buildMarketplaceSlugMap(marketplaceIds: string[]) {
    const map = new Map<string, string>();
    await Promise.all(
      marketplaceIds.map(async (marketplaceId) => {
        const slug = await this.resolveMarketplaceSlug(marketplaceId);
        if (slug) map.set(marketplaceId, slug);
      }),
    );
    return map;
  }

  private async resolveMarketplaceSlug(marketplaceId: string) {
    const trimmed = String(marketplaceId ?? '').trim();
    if (!trimmed) return '';

    const cached = this.marketplaceSlugCache.get(trimmed);
    if (cached) return cached;

    const lowered = trimmed.toLowerCase();
    const known = ['myntra', 'meesho', 'amazon', 'flipkart'];
    if (known.includes(lowered)) {
      this.marketplaceSlugCache.set(trimmed, lowered);
      return lowered;
    }

    const marketplace = await this.marketplaceModel
      .findById(marketplaceId)
      .lean()
      .exec();
    if (!marketplace?.platformMarketplaceId) return '';

    const platform = await this.platformMarketplaceModel
      .findById(marketplace.platformMarketplaceId)
      .lean()
      .exec();
    const slug = String(platform?.slug ?? '')
      .trim()
      .toLowerCase();
    if (slug) this.marketplaceSlugCache.set(trimmed, slug);
    return slug;
  }
}
