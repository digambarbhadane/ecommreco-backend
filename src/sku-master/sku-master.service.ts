import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Gst, GstDocument } from '../gsts/schemas/gst.schema';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { User } from '../users/schemas/user.schema';
import { ImportRow } from '../report-import/schemas/import-row.schema';
import {
  Marketplace,
  MarketplaceDocument,
} from '../marketplaces/schemas/marketplace.schema';
import {
  PlatformMarketplace,
  PlatformMarketplaceDocument,
} from '../platform-marketplaces/schemas/platform-marketplace.schema';
import { parseObjectId } from '../common/mongo-id.util';
import { resolveGstDisplayName } from '../gsts/utils/gst-display.util';
import { ListSkuMasterQueryDto } from './dto/list-sku-master.query.dto';
import { UpsertSkuMasterDto } from './dto/upsert-sku-master.dto';
import { parseSkuRate } from './sku-rate.util';
import {
  SkuMasterMapping,
  SkuMasterMappingDocument,
} from './schemas/sku-master-mapping.schema';

type RequestActor = {
  id?: string;
  role?: string;
  email?: string;
};

type SkuMasterListItem = {
  id: string;
  rowKey: string;
  gstId: string;
  gstin: string;
  businessName?: string;
  marketplace: string;
  marketplaceSku: string;
  masterSku: string | null;
  rate: number | null;
  productName?: string;
  category?: string;
  brand?: string;
  status: 'MAPPED' | 'UNMAPPED';
  createdAt?: Date;
  updatedAt?: Date;
};

export type SellerScope = {
  canonicalSellerId: string;
  aliases: string[];
};

export type GstScope = {
  gst: {
    _id: Types.ObjectId;
    sellerId: string;
    gstNumber: string;
    businessName?: string;
    tradeName?: string;
  };
  sellerScope: SellerScope;
};

type MappingListContext = {
  sellerScope: SellerScope;
  gst: GstScope['gst'] | null;
  gstIds: string[];
};

type MappingFilter = Record<string, unknown>;

@Injectable()
export class SkuMasterService {
  private readonly logger = new Logger(SkuMasterService.name);
  private readonly marketplaceSlugCache = new Map<string, string>();

  constructor(
    @InjectModel(SkuMasterMapping.name)
    private readonly mappingModel: Model<SkuMasterMappingDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    @InjectModel(Gst.name)
    private readonly gstModel: Model<GstDocument>,
    @InjectModel(ImportRow.name)
    private readonly rowModel: Model<ImportRow>,
    @InjectModel(Marketplace.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
    @InjectModel(PlatformMarketplace.name)
    private readonly platformMarketplaceModel: Model<PlatformMarketplaceDocument>,
  ) {}

  async validateGstForSeller(
    gstId: string,
    actor: RequestActor,
  ): Promise<GstScope> {
    const sellerScope = await this.resolveSellerScope(actor);
    const gst = await this.gstModel
      .findById(parseObjectId(gstId, 'gst id'))
      .lean()
      .exec();
    if (!gst || !sellerScope.aliases.includes(String(gst.sellerId))) {
      throw new NotFoundException('GST profile not found');
    }
    return {
      gst: gst as GstScope['gst'],
      sellerScope,
    };
  }

  async list(query: ListSkuMasterQueryDto, actor: RequestActor) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 25)));
    const skip = (page - 1) * limit;

    const context = await this.resolveListContext(query.gstId, actor);
    if (!context) {
      return {
        success: true,
        data: [],
        summary: {
          totalMarketplaceSkus: 0,
          mappedSkus: 0,
          pendingMapping: 0,
        },
        pagination: { total: 0, page, limit },
      };
    }

    const tableFilter = this.buildMappingFilter(context, {
      marketplace: query.marketplace,
      status: query.status,
      search: query.search,
    });
    const summaryFilter = this.buildMappingFilter(context, {});

    const [pageRows, filteredTotal, summaryCounts] = await Promise.all([
      this.mappingModel
        .find(tableFilter)
        .sort({ marketplace: 1, marketplaceSku: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.mappingModel.countDocuments(tableFilter).exec(),
      this.mappingModel
        .aggregate<{ _id: string; count: number }>([
          { $match: summaryFilter },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ])
        .exec(),
    ]);

    const mappedSkus =
      summaryCounts.find((row) => row._id === 'MAPPED')?.count ?? 0;
    const unmappedSkus =
      summaryCounts.find((row) => row._id === 'UNMAPPED')?.count ?? 0;
    const totalMarketplaceSkus = mappedSkus + unmappedSkus;

    const gstNameById = await this.buildGstNameMap(
      context,
      pageRows.map((row) => String(row.gstId ?? '')),
    );

    return {
      success: true,
      data: pageRows.map((row) =>
        this.mappingToListItem(row, gstNameById.get(String(row.gstId ?? ''))),
      ),
      summary: {
        totalMarketplaceSkus,
        mappedSkus,
        pendingMapping: unmappedSkus,
      },
      pagination: {
        total: filteredTotal,
        page,
        limit,
      },
      gst: context.gst
        ? {
            id: String(context.gst._id),
            gstNumber: String(context.gst.gstNumber ?? '').trim().toUpperCase(),
          }
        : undefined,
    };
  }

  async getFilteredItems(
    query: {
      gstId?: string;
      marketplace?: string;
      status?: string;
      search?: string;
    },
    actor: RequestActor,
  ) {
    const context = await this.resolveListContext(query.gstId, actor);
    if (!context) {
      return { allItems: [], filtered: [], gst: null };
    }

    const tableFilter = this.buildMappingFilter(context, {
      marketplace: query.marketplace,
      status: query.status,
      search: query.search,
    });
    const rows = await this.mappingModel
      .find(tableFilter)
      .select(
        'gstId gstin marketplace marketplaceSku masterSku rate productName category brand status createdAt updatedAt',
      )
      .sort({ marketplace: 1, marketplaceSku: 1 })
      .lean()
      .exec();

    const gstNameById = await this.buildGstNameMap(
      context,
      rows.map((row) => String(row.gstId ?? '')),
    );
    const items = rows.map((row) =>
      this.mappingToListItem(row, gstNameById.get(String(row.gstId ?? ''))),
    );

    return { allItems: items, filtered: items, gst: context.gst };
  }

  async upsertMapping(dto: UpsertSkuMasterDto, actor: RequestActor) {
    const { gst, sellerScope } = await this.validateGstForSeller(
      dto.gstId,
      actor,
    );
    const hasRate = dto.rate !== undefined && dto.rate !== null;
    const rate = hasRate ? this.normalizeRate(dto.rate) : null;
    if (hasRate && rate === null) {
      throw new BadRequestException('Rate must be a number 0 or greater');
    }
    const doc = await this.saveMasterSku({
      sellerId: sellerScope.canonicalSellerId,
      gstId: String(gst._id),
      gstin: String(gst.gstNumber).trim().toUpperCase(),
      businessName: this.resolveBusinessName(gst),
      marketplace: this.normalizeMarketplace(dto.marketplace),
      marketplaceSku: dto.marketplaceSku.trim(),
      masterSku: dto.masterSku.trim(),
      rate,
      category: this.normalizeCategory(dto.category),
      updatedBy: this.actorId(actor),
    });

    return {
      success: true,
      data: doc,
    };
  }

  async bulkUpdate(
    items: Array<{
      gstId: string;
      marketplace: string;
      marketplaceSku: string;
      masterSku: string;
      rate?: number | null;
      category?: string | null;
    }>,
    actor: RequestActor,
  ) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new NotFoundException('No SKU mappings were updated');
    }

    const sellerScope = await this.resolveSellerScope(actor);
    const updatedBy = this.actorId(actor);
    const uniqueGstIds = [
      ...new Set(
        items.map((item) => String(item.gstId ?? '').trim()).filter(Boolean),
      ),
    ];
    if (!uniqueGstIds.length) {
      throw new BadRequestException('GST profile is required');
    }

    const gstDocs = await this.gstModel
      .find({
        _id: { $in: uniqueGstIds.map((id) => parseObjectId(id, 'gst id')) },
        sellerId: { $in: sellerScope.aliases },
      })
      .lean()
      .exec();
    const gstById = new Map(
      gstDocs.map((gst) => [String(gst._id), gst as GstScope['gst']]),
    );

    type PreparedRow = {
      gstId: string;
      gstin: string;
      businessName?: string;
      marketplace: string;
      marketplaceSku: string;
      masterSku: string;
      rate: number | null;
      hasRate: boolean;
      category: string | null;
      hasCategory: boolean;
    };

    const prepared: PreparedRow[] = [];
    for (const item of items) {
      const gstId = String(item.gstId ?? '').trim();
      const gst = gstById.get(gstId);
      if (!gst) {
        throw new NotFoundException(
          `GST profile not found for SKU ${item.marketplaceSku}`,
        );
      }
      const hasRate = item.rate !== undefined && item.rate !== null;
      const rate = hasRate ? this.normalizeRate(item.rate) : null;
      if (hasRate && rate === null) {
        throw new BadRequestException(
          `Rate must be a number 0 or greater for SKU ${item.marketplaceSku}`,
        );
      }
      const marketplace = this.normalizeMarketplace(item.marketplace);
      const marketplaceSku = String(item.marketplaceSku ?? '').trim();
      const masterSku = String(item.masterSku ?? '').trim();
      if (!marketplace || !marketplaceSku || !masterSku) {
        continue;
      }
      const hasCategory = item.category !== undefined;
      prepared.push({
        gstId,
        gstin: String(gst.gstNumber).trim().toUpperCase(),
        businessName: this.resolveBusinessName(gst),
        marketplace,
        marketplaceSku,
        masterSku,
        rate,
        hasRate,
        category: hasCategory ? this.normalizeCategory(item.category) ?? null : null,
        hasCategory,
      });
    }

    if (!prepared.length) {
      throw new NotFoundException('No SKU mappings were updated');
    }

    const existingGroups = new Map<
      string,
      { gstId: string; marketplace: string; skus: string[] }
    >();
    for (const row of prepared) {
      const groupKey = `${row.gstId}:${row.marketplace}`;
      const group = existingGroups.get(groupKey) ?? {
        gstId: row.gstId,
        marketplace: row.marketplace,
        skus: [],
      };
      group.skus.push(row.marketplaceSku);
      existingGroups.set(groupKey, group);
    }

    const needsExisting = prepared.some((row) => !row.hasRate || !row.hasCategory);
    const existing = needsExisting
      ? await this.mappingModel
          .find({
            sellerId: sellerScope.canonicalSellerId,
            $or: [...existingGroups.values()].map((group) => ({
              gstId: group.gstId,
              marketplace: group.marketplace,
              marketplaceSku: { $in: group.skus },
            })),
          })
          .select('gstId marketplace marketplaceSku rate category')
          .lean()
          .exec()
      : [];
    const existingByKey = new Map(
      existing.map((row) => [
        `${row.gstId}:${row.marketplace}:${row.marketplaceSku}`,
        row,
      ]),
    );

    const now = new Date();
    const ops = prepared.map((row) => {
      const previous = existingByKey.get(
        `${row.gstId}:${row.marketplace}:${row.marketplaceSku}`,
      );
      const nextRate = row.hasRate
        ? row.rate
        : previous?.rate === null || previous?.rate === undefined
          ? null
          : Number(previous.rate);
      const status = this.resolveMappingStatus(row.masterSku, nextRate);
      const setFields: Record<string, unknown> = {
        sellerId: sellerScope.canonicalSellerId,
        gstId: row.gstId,
        gstin: row.gstin,
        marketplace: row.marketplace,
        marketplaceSku: row.marketplaceSku,
        masterSku: row.masterSku,
        status,
        updatedBy,
        updatedAt: now,
      };
      if (row.hasRate) {
        setFields.rate = row.rate;
      }
      if (row.hasCategory) {
        setFields.category = row.category;
      }
      return {
        updateOne: {
          filter: {
            sellerId: sellerScope.canonicalSellerId,
            gstId: row.gstId,
            marketplace: row.marketplace,
            marketplaceSku: row.marketplaceSku,
          },
          update: {
            $set: setFields,
            $setOnInsert: {
              createdBy: updatedBy,
            },
          },
          upsert: true,
          timestamps: false,
        },
      };
    });

    await this.mappingModel.bulkWrite(ops, { ordered: false });

    const data: SkuMasterListItem[] = prepared.map((row) => {
      const previous = existingByKey.get(
        `${row.gstId}:${row.marketplace}:${row.marketplaceSku}`,
      );
      const nextRate = row.hasRate
        ? row.rate
        : previous?.rate === null || previous?.rate === undefined
          ? null
          : Number(previous.rate);
      const status = this.resolveMappingStatus(row.masterSku, nextRate);
      const nextCategory = row.hasCategory
        ? row.category
        : previous?.category
          ? String(previous.category).trim()
          : undefined;
      return {
        id: `${row.gstId}:${row.marketplace}:${row.marketplaceSku}`,
        rowKey: `${row.marketplace}:${row.marketplaceSku}`,
        gstId: row.gstId,
        gstin: row.gstin,
        businessName: row.businessName,
        marketplace: row.marketplace,
        marketplaceSku: row.marketplaceSku,
        masterSku: row.masterSku,
        rate: Number.isFinite(nextRate as number) ? (nextRate as number) : null,
        category: nextCategory || undefined,
        status,
      };
    });

    return {
      success: true,
      data,
      updatedCount: data.length,
    };
  }

  async upsertUnmappedSkus(params: {
    sellerId: string;
    gstId: string;
    gstin: string;
    marketplace: string;
    skus: Array<{
      marketplaceSku: string;
      productName?: string;
      category?: string;
      brand?: string;
    }>;
    createdBy?: string;
  }) {
    const sellerScope = await this.resolveSellerScopeById(params.sellerId);
    const marketplace = this.normalizeMarketplace(params.marketplace);
    const gstId = String(params.gstId ?? '').trim();
    const gstin = String(params.gstin ?? '').trim().toUpperCase();
    if (!marketplace || !params.skus.length || !gstId || !gstin) {
      return { inserted: 0, skipped: 0 };
    }

    let inserted = 0;
    let skipped = 0;
    const canonicalSellerId = sellerScope.canonicalSellerId;

    for (const entry of params.skus) {
      const marketplaceSku = String(entry.marketplaceSku ?? '').trim();
      if (!marketplaceSku) continue;

      try {
        const result = await this.mappingModel.updateOne(
          {
            sellerId: canonicalSellerId,
            gstId,
            marketplace,
            marketplaceSku,
          },
          {
            $setOnInsert: {
              sellerId: canonicalSellerId,
              gstId,
              gstin,
              marketplace,
              marketplaceSku,
              masterSku: null,
              status: 'UNMAPPED',
              createdBy: params.createdBy,
            },
            $set: {
              gstin,
              ...(entry.productName ? { productName: entry.productName } : {}),
              ...(entry.brand ? { brand: entry.brand } : {}),
            },
          },
          { upsert: true },
        );

        if (result.upsertedCount && result.upsertedCount > 0) {
          inserted += 1;
        } else {
          skipped += 1;
        }
      } catch (err: unknown) {
        const message =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message?: unknown }).message)
            : String(err);
        this.logger.warn(
          `SKU upsert skipped for ${marketplaceSku}: ${message}`,
        );
        skipped += 1;
      }
    }

    return { inserted, skipped };
  }

  async resolveSellerScopeById(identifier: string): Promise<SellerScope> {
    const seller = await this.findSellerByIdentifier(identifier);
    if (!seller) {
      throw new NotFoundException('Seller not found');
    }
    const canonicalSellerId = this.getSellerObjectIdString(seller);
    const aliases = new Set<string>();
    if (canonicalSellerId) aliases.add(canonicalSellerId);
    if (seller.publicId?.trim()) aliases.add(seller.publicId.trim());
    if (identifier.trim()) aliases.add(identifier.trim());
    return {
      canonicalSellerId,
      aliases: Array.from(aliases),
    };
  }

  private async buildSkuListFromImports(
    sellerScope: SellerScope,
    gstId: string,
    gstin: string,
    businessName?: string,
  ): Promise<SkuMasterListItem[]> {
    const gstinCandidates = Array.from(
      new Set([
        String(gstin ?? '').trim(),
        String(gstin ?? '').trim().toUpperCase(),
        String(gstin ?? '').trim().toLowerCase(),
      ].filter(Boolean)),
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

    if (!skuGroups.length) return [];

    const marketplaceIds = [
      ...new Set(
        skuGroups
          .map((row) => String(row.marketplaceId ?? '').trim())
          .filter(Boolean),
      ),
    ];
    const slugByMarketplaceId =
      await this.buildMarketplaceSlugMap(marketplaceIds);

    const mappings = await this.mappingModel
      .find({
        sellerId: sellerScope.canonicalSellerId,
        gstId,
      })
      .lean()
      .exec();

    const mappingByKey = new Map(
      mappings.map((row) => [
        `${row.marketplace}:${row.marketplaceSku}`,
        row,
      ]),
    );

    const items: SkuMasterListItem[] = [];
    for (const row of skuGroups) {
      const marketplaceSku = String(row.marketplaceSku ?? '').trim();
      if (!marketplaceSku) continue;

      const marketplace =
        slugByMarketplaceId.get(String(row.marketplaceId ?? '').trim()) ?? '';
      if (!marketplace) continue;

      const rowKey = `${marketplace}:${marketplaceSku}`;
      const mapping = mappingByKey.get(rowKey);
      const masterSku = mapping?.masterSku ?? null;
      const rate =
        mapping?.rate === null || mapping?.rate === undefined
          ? null
          : Number(mapping.rate);
      const status = this.resolveMappingStatus(masterSku, rate);

      items.push({
        id: mapping?._id ? String(mapping._id) : rowKey,
        rowKey,
        gstId,
        gstin,
        businessName,
        marketplace,
        marketplaceSku,
        masterSku,
        rate: Number.isFinite(rate as number) ? (rate as number) : null,
        productName: row.productName ? String(row.productName) : undefined,
        category: this.toOptionalText(mapping?.category),
        brand: mapping?.brand,
        status,
      });
    }

    items.sort((a, b) => {
      const marketplaceCmp = a.marketplace.localeCompare(b.marketplace);
      if (marketplaceCmp !== 0) return marketplaceCmp;
      return a.marketplaceSku.localeCompare(b.marketplaceSku);
    });

    return items;
  }

  private async saveMasterSku(params: {
    sellerId: string;
    gstId: string;
    gstin: string;
    businessName?: string;
    marketplace: string;
    marketplaceSku: string;
    masterSku: string;
    rate?: number | null;
    category?: string | null;
    updatedBy?: string;
  }): Promise<SkuMasterListItem> {
    const marketplace = this.normalizeMarketplace(params.marketplace);
    const marketplaceSku = params.marketplaceSku.trim();
    const masterSku = params.masterSku.trim();
    const rate =
      params.rate === undefined || params.rate === null
        ? null
        : this.normalizeRate(params.rate);
    if (!marketplace || !marketplaceSku || !masterSku) {
      throw new NotFoundException('Invalid SKU mapping payload');
    }
    if (params.rate !== undefined && params.rate !== null && rate === null) {
      throw new BadRequestException('Rate must be a number 0 or greater');
    }

    const existing = await this.mappingModel
      .findOne({
        sellerId: params.sellerId,
        gstId: params.gstId,
        marketplace,
        marketplaceSku,
      })
      .lean()
      .exec();

    const nextRate =
      rate ??
      (existing?.rate === null || existing?.rate === undefined
        ? null
        : Number(existing.rate));
    const status = this.resolveMappingStatus(masterSku, nextRate);

    const rowKey = `${marketplace}:${marketplaceSku}`;
    const setFields: Record<string, unknown> = {
      sellerId: params.sellerId,
      gstId: params.gstId,
      gstin: params.gstin,
      marketplace,
      marketplaceSku,
      masterSku,
      status,
      updatedBy: params.updatedBy,
    };
    if (rate !== null) {
      setFields.rate = rate;
    }
    if (params.category !== undefined) {
      setFields.category = params.category;
    }

    const doc = await this.mappingModel
      .findOneAndUpdate(
        {
          sellerId: params.sellerId,
          gstId: params.gstId,
          marketplace,
          marketplaceSku,
        },
        {
          $set: setFields,
          $setOnInsert: {
            createdBy: params.updatedBy,
          },
        },
        {
          upsert: true,
          new: true,
          lean: true,
          // Prevent schema defaults from also being written to $setOnInsert
          // (Mongo conflict → HTTP 500 on masterSku/rate/status).
          setDefaultsOnInsert: false,
        },
      )
      .exec();

    if (!doc) {
      throw new NotFoundException('Failed to save SKU mapping');
    }

    const saved = doc as SkuMasterMapping & { _id: Types.ObjectId };

    return {
      id: String(saved._id),
      rowKey,
      gstId: params.gstId,
      gstin: params.gstin,
      businessName: params.businessName,
      marketplace,
      marketplaceSku,
      masterSku: saved.masterSku ?? masterSku,
      rate:
        saved.rate === null || saved.rate === undefined
          ? null
          : Number(saved.rate),
      productName: saved.productName,
      category: this.toOptionalText(saved.category),
      brand: saved.brand,
      status,
    };
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
    const slug = String(platform?.slug ?? '').trim().toLowerCase();
    if (slug) this.marketplaceSlugCache.set(trimmed, slug);
    return slug;
  }

  private resolveBusinessName(gst: GstScope['gst']) {
    return resolveGstDisplayName(gst) || undefined;
  }

  private async resolveListContext(
    gstId: string | undefined,
    actor: RequestActor,
  ): Promise<MappingListContext | null> {
    const requestedGstId = String(gstId ?? '').trim();
    if (requestedGstId) {
      const { gst, sellerScope } = await this.validateGstForSeller(
        requestedGstId,
        actor,
      );
      return {
        sellerScope,
        gst,
        gstIds: [String(gst._id)],
      };
    }

    const sellerScope = await this.resolveSellerScope(actor);
    const gsts = await this.gstModel
      .find({ sellerId: { $in: sellerScope.aliases } })
      .select('_id sellerId gstNumber businessName tradeName')
      .lean()
      .exec();
    if (!gsts.length) return null;
    return {
      sellerScope,
      gst: gsts[0] as GstScope['gst'],
      gstIds: gsts.map((gst) => String(gst._id)),
    };
  }

  private buildMappingFilter(
    context: MappingListContext,
    query: {
      marketplace?: string;
      status?: string;
      search?: string;
    },
  ): MappingFilter {
    const clauses: MappingFilter[] = [
      { sellerId: { $in: context.sellerScope.aliases } },
    ];
    if (context.gstIds.length === 1) {
      clauses.push({ gstId: context.gstIds[0] });
    } else if (context.gstIds.length > 1) {
      clauses.push({ gstId: { $in: context.gstIds } });
    }

    const marketplace = String(query.marketplace ?? 'ALL').trim().toLowerCase();
    if (marketplace && marketplace !== 'all') {
      clauses.push({ marketplace });
    }

    const status = String(query.status ?? 'ALL').trim().toUpperCase();
    if (status === 'MAPPED' || status === 'UNMAPPED') {
      clauses.push({ status });
    }

    const search = String(query.search ?? '').trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      clauses.push({
        $or: [
          { marketplaceSku: { $regex: escaped, $options: 'i' } },
          { masterSku: { $regex: escaped, $options: 'i' } },
          { category: { $regex: escaped, $options: 'i' } },
        ],
      });
    }

    return clauses.length === 1 ? clauses[0] : { $and: clauses };
  }

  private async buildGstNameMap(
    context: MappingListContext,
    gstIds: string[],
  ) {
    const map = new Map<string, string | undefined>();
    if (context.gst && context.gstIds.length === 1) {
      map.set(String(context.gst._id), this.resolveBusinessName(context.gst));
      return map;
    }
    const uniqueIds = [...new Set(gstIds.filter(Boolean))];
    if (!uniqueIds.length) return map;
    const gsts = await this.gstModel
      .find({ _id: { $in: uniqueIds.map((id) => parseObjectId(id, 'gst id')) } })
      .select('_id gstNumber businessName tradeName')
      .lean()
      .exec();
    for (const gst of gsts) {
      map.set(
        String(gst._id),
        this.resolveBusinessName(gst as GstScope['gst']),
      );
    }
    return map;
  }

  private mappingToListItem(
    row: {
      _id?: Types.ObjectId | string;
      gstId?: string;
      gstin?: string;
      marketplace?: string;
      marketplaceSku?: string;
      masterSku?: string | null;
      rate?: number | null;
      productName?: string;
      category?: string | null;
      brand?: string;
      status?: 'MAPPED' | 'UNMAPPED';
      createdAt?: Date;
      updatedAt?: Date;
    },
    businessName?: string,
  ): SkuMasterListItem {
    const marketplace = this.normalizeMarketplace(String(row.marketplace ?? ''));
    const marketplaceSku = String(row.marketplaceSku ?? '').trim();
    const masterSku = row.masterSku ? String(row.masterSku).trim() : null;
    const rate =
      row.rate === null || row.rate === undefined ? null : Number(row.rate);
    const status =
      row.status === 'MAPPED' || row.status === 'UNMAPPED'
        ? row.status
        : this.resolveMappingStatus(masterSku, rate);
    return {
      id: row._id ? String(row._id) : `${marketplace}:${marketplaceSku}`,
      rowKey: `${marketplace}:${marketplaceSku}`,
      gstId: String(row.gstId ?? ''),
      gstin: String(row.gstin ?? '').trim().toUpperCase(),
      businessName,
      marketplace,
      marketplaceSku,
      masterSku,
      rate: Number.isFinite(rate as number) ? (rate as number) : null,
      productName: row.productName,
      category: this.toOptionalText(row.category),
      brand: row.brand,
      status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private resolveMappingStatus(
    masterSku: string | null | undefined,
    rate: number | null | undefined,
  ): 'MAPPED' | 'UNMAPPED' {
    const hasMasterSku = Boolean(String(masterSku ?? '').trim());
    const hasRate =
      rate !== null && rate !== undefined && Number.isFinite(Number(rate));
    return hasMasterSku && hasRate ? 'MAPPED' : 'UNMAPPED';
  }

  private normalizeRate(value: unknown): number | null {
    return parseSkuRate(value);
  }

  private normalizeCategory(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const text = String(value).trim();
    if (!text) return null;
    return text.slice(0, 120);
  }

  private toOptionalText(value: string | null | undefined): string | undefined {
    const text = String(value ?? '').trim();
    return text || undefined;
  }

  private actorId(actor: RequestActor) {
    return String(actor.id ?? actor.email ?? '').trim() || undefined;
  }

  private normalizeMarketplace(value: string) {
    return String(value ?? '').trim().toLowerCase();
  }

  private async resolveSellerScope(actor: RequestActor) {
    if (!actor?.id) {
      throw new ForbiddenException('Seller context is required');
    }
    if (actor.role !== 'seller') {
      throw new ForbiddenException('Only sellers can access SKU master mappings');
    }
    return this.resolveSellerScopeById(actor.id);
  }

  private getSellerObjectIdString(seller: {
    _id?: Types.ObjectId | string;
  }) {
    const id = seller?._id as Types.ObjectId | string | undefined;
    return typeof id === 'string' ? id : id?.toString?.() ?? '';
  }

  private async findSellerByIdentifier(identifier: string) {
    const value = String(identifier ?? '').trim();
    if (!value) return null;

    if (Types.ObjectId.isValid(value)) {
      const [sellerById, userById] = await Promise.all([
        this.sellerModel.findById(value).select('_id publicId').lean().exec(),
        this.userModel
          .findOne({ _id: value, role: 'seller' })
          .select('email sellerId')
          .lean()
          .exec(),
      ]);
      if (sellerById) return sellerById;
      if (userById?.sellerId) {
        const linked = await this.sellerModel
          .findById(userById.sellerId)
          .select('_id publicId')
          .lean()
          .exec();
        if (linked) return linked;
      }
      const email = String(userById?.email ?? '').trim().toLowerCase();
      if (email) {
        return this.sellerModel
          .findOne({ $or: [{ email }, { username: email }] })
          .select('_id publicId')
          .lean()
          .exec();
      }
    }

    const sellerByPublicId = await this.sellerModel
      .findOne({ publicId: value })
      .select('_id publicId')
      .lean()
      .exec();
    if (sellerByPublicId) return sellerByPublicId;

    const user = await this.findSellerUserByIdentifier(value);
    if (!user) return null;
    if (user.sellerId) {
      const linked = await this.sellerModel
        .findById(user.sellerId)
        .select('_id publicId')
        .lean()
        .exec();
      if (linked) return linked;
    }
    const email = String(user.email ?? '').trim().toLowerCase();
    if (!email) return null;
    return this.sellerModel
      .findOne({
        $or: [{ email }, { username: email }],
      })
      .select('_id publicId')
      .lean()
      .exec();
  }

  private async findSellerUserByIdentifier(identifier: string) {
    const value = String(identifier ?? '').trim();
    if (!value) return null;
    if (Types.ObjectId.isValid(value)) {
      const byId = await this.userModel
        .findOne({ _id: value, role: 'seller' })
        .select('email sellerId publicId username')
        .lean()
        .exec();
      if (byId) return byId;
    }
    return this.userModel
      .findOne({
        role: 'seller',
        $or: [{ publicId: value }, { email: value }, { username: value }],
      })
      .select('email sellerId publicId username')
      .lean()
      .exec();
  }
}
