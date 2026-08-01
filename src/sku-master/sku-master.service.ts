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
    const { filtered, allItems, gst } = await this.getFilteredItems(
      query,
      actor,
    );

    const summaryTotal = allItems.length;
    const mappedCount = allItems.filter((item) => item.status === 'MAPPED').length;
    const unmappedCount = summaryTotal - mappedCount;

    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 25)));
    const skip = (page - 1) * limit;
    const pageItems = filtered.slice(skip, skip + limit);

    return {
      success: true,
      data: pageItems,
      summary: {
        totalMarketplaceSkus: summaryTotal,
        mappedSkus: mappedCount,
        pendingMapping: unmappedCount,
      },
      pagination: {
        total: filtered.length,
        page,
        limit,
      },
      gst: gst
        ? {
            id: String(gst._id),
            gstNumber: String(gst.gstNumber ?? '').trim().toUpperCase(),
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
    const gstId = String(query.gstId ?? '').trim();
    if (!gstId) {
      return this.getFilteredItemsForAllGsts(query, actor);
    }

    const { gst, sellerScope } = await this.validateGstForSeller(
      gstId,
      actor,
    );
    const resolvedGstId = String(gst._id);
    const gstin = String(gst.gstNumber ?? '').trim().toUpperCase();

    const allItems = await this.buildSkuListFromImports(
      sellerScope,
      resolvedGstId,
      gstin,
      this.resolveBusinessName(gst),
    );

    const marketplace = String(query.marketplace ?? 'ALL').trim().toLowerCase();
    const status = String(query.status ?? 'ALL').trim().toUpperCase();
    const search = String(query.search ?? '').trim().toLowerCase();

    let filtered = allItems;
    if (marketplace && marketplace !== 'all') {
      filtered = filtered.filter((item) => item.marketplace === marketplace);
    }
    if (status === 'MAPPED') {
      filtered = filtered.filter((item) => item.status === 'MAPPED');
    } else if (status === 'UNMAPPED') {
      filtered = filtered.filter((item) => item.status === 'UNMAPPED');
    }
    if (search) {
      filtered = filtered.filter(
        (item) =>
          item.marketplaceSku.toLowerCase().includes(search) ||
          String(item.masterSku ?? '').toLowerCase().includes(search),
      );
    }

    return { allItems, filtered, gst };
  }

  private async getFilteredItemsForAllGsts(
    query: {
      marketplace?: string;
      status?: string;
      search?: string;
    },
    actor: RequestActor,
  ) {
    const sellerScope = await this.resolveSellerScope(actor);
    const gsts = await this.gstModel
      .find({ sellerId: { $in: sellerScope.aliases } })
      .lean()
      .exec();

    let allItems: SkuMasterListItem[] = [];
    for (const gst of gsts) {
      const items = await this.buildSkuListFromImports(
        sellerScope,
        String(gst._id),
        String(gst.gstNumber ?? '').trim().toUpperCase(),
        this.resolveBusinessName(gst),
      );
      allItems = allItems.concat(items);
    }

    const marketplace = String(query.marketplace ?? 'ALL').trim().toLowerCase();
    const status = String(query.status ?? 'ALL').trim().toUpperCase();
    const search = String(query.search ?? '').trim().toLowerCase();

    let filtered = allItems;
    if (marketplace && marketplace !== 'all') {
      filtered = filtered.filter((item) => item.marketplace === marketplace);
    }
    if (status === 'MAPPED') {
      filtered = filtered.filter((item) => item.status === 'MAPPED');
    } else if (status === 'UNMAPPED') {
      filtered = filtered.filter((item) => item.status === 'UNMAPPED');
    }
    if (search) {
      filtered = filtered.filter(
        (item) =>
          item.marketplaceSku.toLowerCase().includes(search) ||
          String(item.masterSku ?? '').toLowerCase().includes(search),
      );
    }

    return {
      allItems,
      filtered,
      gst: gsts[0] ?? null,
    };
  }

  async upsertMapping(dto: UpsertSkuMasterDto, actor: RequestActor) {
    const { gst, sellerScope } = await this.validateGstForSeller(
      dto.gstId,
      actor,
    );
    const rate = this.normalizeRate(dto.rate);
    if (rate === null) {
      throw new BadRequestException('Rate must be a number between 0 and 100');
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
      rate: number;
    }>,
    actor: RequestActor,
  ) {
    const updated: SkuMasterListItem[] = [];

    for (const item of items) {
      const { gst, sellerScope } = await this.validateGstForSeller(
        item.gstId,
        actor,
      );
      const rate = this.normalizeRate(item.rate);
      if (rate === null) {
        throw new BadRequestException(
          `Rate must be a number between 0 and 100 for SKU ${item.marketplaceSku}`,
        );
      }
      const doc = await this.saveMasterSku({
        sellerId: sellerScope.canonicalSellerId,
        gstId: String(gst._id),
        gstin: String(gst.gstNumber).trim().toUpperCase(),
        businessName: this.resolveBusinessName(gst),
        marketplace: this.normalizeMarketplace(item.marketplace),
        marketplaceSku: item.marketplaceSku.trim(),
        masterSku: item.masterSku.trim(),
        rate,
        updatedBy: this.actorId(actor),
      });
      updated.push(doc);
    }

    if (!updated.length) {
      throw new NotFoundException('No SKU mappings were updated');
    }

    return {
      success: true,
      data: updated,
      updatedCount: updated.length,
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
              ...(entry.category ? { category: entry.category } : {}),
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
        category: mapping?.category,
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
    rate: number;
    updatedBy?: string;
  }): Promise<SkuMasterListItem> {
    const marketplace = this.normalizeMarketplace(params.marketplace);
    const marketplaceSku = params.marketplaceSku.trim();
    const masterSku = params.masterSku.trim();
    const rate = this.normalizeRate(params.rate);
    if (!marketplace || !marketplaceSku || !masterSku) {
      throw new NotFoundException('Invalid SKU mapping payload');
    }
    if (rate === null) {
      throw new BadRequestException('Rate is required to complete mapping');
    }

    const rowKey = `${marketplace}:${marketplaceSku}`;
    const doc = await this.mappingModel
      .findOneAndUpdate(
        {
          sellerId: params.sellerId,
          gstId: params.gstId,
          marketplace,
          marketplaceSku,
        },
        {
          $set: {
            sellerId: params.sellerId,
            gstId: params.gstId,
            gstin: params.gstin,
            marketplace,
            marketplaceSku,
            masterSku,
            rate,
            status: 'MAPPED',
            updatedBy: params.updatedBy,
          },
          $setOnInsert: {
            createdBy: params.updatedBy,
          },
        },
        { upsert: true, new: true, lean: true },
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
      rate: saved.rate ?? rate,
      productName: saved.productName,
      category: saved.category,
      brand: saved.brand,
      status: 'MAPPED',
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
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return null;
    }
    return Math.round(rate * 100) / 100;
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

  private getSellerObjectIdString(seller: SellerDocument) {
    const id = seller?._id as Types.ObjectId | string | undefined;
    return typeof id === 'string' ? id : id?.toString?.() ?? '';
  }

  private async findSellerByIdentifier(identifier: string) {
    const value = String(identifier ?? '').trim();
    if (!value) return null;
    if (Types.ObjectId.isValid(value)) {
      const sellerById = await this.sellerModel.findById(value).exec();
      if (sellerById) return sellerById;
    }
    const sellerByPublicId = await this.sellerModel
      .findOne({ publicId: value })
      .exec();
    if (sellerByPublicId) return sellerByPublicId;

    const user = await this.findSellerUserByIdentifier(value);
    if (!user) return null;
    const email = String(user.email ?? '').trim().toLowerCase();
    if (!email) return null;
    return this.sellerModel
      .findOne({
        $or: [{ email }, { username: email }],
      })
      .exec();
  }

  private async findSellerUserByIdentifier(identifier: string) {
    const value = String(identifier ?? '').trim();
    if (!value) return null;
    if (Types.ObjectId.isValid(value)) {
      const byId = await this.userModel
        .findOne({ _id: value, role: 'seller' })
        .exec();
      if (byId) return byId;
    }
    return this.userModel
      .findOne({
        role: 'seller',
        $or: [{ publicId: value }, { email: value }, { username: value }],
      })
      .exec();
  }
}
