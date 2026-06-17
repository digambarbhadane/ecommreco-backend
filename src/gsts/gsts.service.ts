import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateGstDto } from './dto/create-gst.dto';
import { VerifyGstDto } from './dto/verify-gst.dto';
import { PerioneGstVerificationService } from './perione-gst-verification.service';
import { normalizeGstin } from './gst-verification.constants';
import { Gst, GstDocument } from './schemas/gst.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Marketplace,
  MarketplaceDocument,
} from '../marketplaces/schemas/marketplace.schema';
import {
  PlatformMarketplace,
  PlatformMarketplaceDocument,
} from '../platform-marketplaces/schemas/platform-marketplace.schema';
import {
  ImportRow,
  ImportRowDocument,
} from '../report-import/schemas/import-row.schema';

@Injectable()
export class GstsService {
  constructor(
    @InjectModel(Gst.name) private readonly gstModel: Model<GstDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Marketplace.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
    @InjectModel(PlatformMarketplace.name)
    private readonly platformMarketplaceModel: Model<PlatformMarketplaceDocument>,
    @InjectModel(ImportRow.name)
    private readonly importRowModel: Model<ImportRowDocument>,
    private readonly perioneVerification: PerioneGstVerificationService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async verifyGst(dto: VerifyGstDto, sellerId?: string) {
    return this.perioneVerification.verifyGstNumber(dto.gstNumber, sellerId);
  }

  async create(
    dto: CreateGstDto,
    options?: {
      actorRole?: string;
      actorName?: string;
    },
  ) {
    const seller = await this.findSellerByIdentifier(dto.sellerId);
    if (!seller) {
      throw new NotFoundException('Seller not found');
    }
    const sellerId = this.getSellerObjectIdString(seller);
    const sellerIdAliases = this.getSellerIdAliases(seller, dto.sellerId);

    const verification = await this.perioneVerification.getRecentVerification(
      dto.verificationId,
      dto.gstNumber,
    );
    const gstNumber = normalizeGstin(verification.gstin);
    const extractedPan = this.extractPanFromGst(gstNumber);

    const existing = await this.gstModel.findOne({ gstNumber });
    if (existing) {
      const existingSellerId = String(existing.sellerId ?? '');
      const belongsToCurrentSeller = sellerIdAliases.some(
        (alias) => alias === existingSellerId,
      );
      if (belongsToCurrentSeller) {
        throw new BadRequestException('GST number already added.');
      }
      throw new BadRequestException(
        'This GST number is already registered with another seller.',
      );
    }

    const sellerGsts = await this.gstModel
      .find({ sellerId: { $in: sellerIdAliases } })
      .select('panNumber gstNumber')
      .lean()
      .exec();
    const sellerPanSet = new Set<string>();
    sellerGsts.forEach((item) => {
      const pan =
        typeof item.panNumber === 'string' && item.panNumber.length > 0
          ? item.panNumber.trim().toUpperCase()
          : this.extractPanFromGst(item.gstNumber);
      if (pan) {
        sellerPanSet.add(pan);
      }
    });
    if (Array.isArray(seller.panProfiles)) {
      seller.panProfiles.forEach((item) => {
        const pan =
          typeof item.panNumber === 'string'
            ? item.panNumber.trim().toUpperCase()
            : '';
        if (pan) {
          sellerPanSet.add(pan);
        }
      });
    }

    const isFirstGstForSeller = sellerGsts.length === 0;
    const isExistingPanForSeller = sellerPanSet.has(extractedPan);
    let purchasedPanSlots = Math.max(
      0,
      Number(seller.gstSlotsPurchased ?? seller.gstSlots ?? 0),
    );
    const usedPanSlots = sellerPanSet.size;
    const isSuperAdmin = options?.actorRole === 'super_admin';
    if (!isExistingPanForSeller && usedPanSlots >= purchasedPanSlots) {
      if (!isSuperAdmin) {
        throw new BadRequestException(
          'You have reached your GST limit. Please upgrade your plan to add a new PAN.',
        );
      }
      purchasedPanSlots += 1;
      seller.gstSlotsPurchased = purchasedPanSlots;
      seller.gstSlots = Math.max(
        Number(seller.gstSlots ?? 0),
        purchasedPanSlots,
      );
    }

    const panProfiles = Array.isArray(seller.panProfiles)
      ? [...seller.panProfiles]
      : [];
    const panIndex = panProfiles.findIndex(
      (item) => item.panNumber === extractedPan,
    );
    const businessName =
      verification.legalName?.trim() || verification.tradeName?.trim() || '';
    const tradeName = verification.tradeName?.trim() || businessName;
    const state =
      this.extractStateFromVerification(verification) || undefined;
    if (panIndex === -1) {
      panProfiles.push({
        panNumber: extractedPan,
        businessName: businessName || undefined,
        createdAt: new Date(),
      });
    } else if (businessName && !panProfiles[panIndex].businessName) {
      panProfiles[panIndex] = {
        ...panProfiles[panIndex],
        businessName,
      };
    }

    const verifiedAt = verification.lastVerifiedAt ?? new Date();
    const created = await this.gstModel.create({
      sellerId,
      gstNumber,
      panNumber: extractedPan,
      businessName,
      tradeName,
      state,
      status: 'active',
      taxpayerType: verification.taxpayerType ?? undefined,
      registrationDate: this.formatRegistrationDate(verification.registrationDate),
      address: verification.principalAddress ?? undefined,
      verifiedAt,
      verificationResponse: verification.rawResponse ?? undefined,
      gstinVerificationId: String(verification._id),
    });

    seller.panProfiles = panProfiles;
    seller.gstSlotsUsed = isExistingPanForSeller
      ? usedPanSlots
      : usedPanSlots + 1;

    if (isFirstGstForSeller) {
      this.applyFirstGstBusinessProfile(seller, {
        gstNumber,
        businessName,
        tradeName,
        state,
        taxpayerType: verification.taxpayerType ?? undefined,
        registrationDate: this.formatRegistrationDate(
          verification.registrationDate,
        ),
        address: verification.principalAddress ?? undefined,
        status: verification.status ?? undefined,
      });
      await this.syncSellerUserCompanyName(seller);
    }

    await seller.save();

    await this.logGstVerificationActivity({
      gstNumber,
      sellerName: seller.fullName ?? seller.email ?? 'Seller',
      actorName: options?.actorName ?? this.formatActorRole(options?.actorRole),
      verifiedAt,
    });

    return {
      success: true,
      data: created,
    };
  }

  private async createFromImportRow(
    dto: {
      sellerId: string;
      gstNumber: string;
      state?: string;
      status?: 'active' | 'inactive';
      businessName?: string;
    },
    options?: { actorRole?: string },
  ) {
    return this.createLegacyGst(dto, options);
  }

  async importRows(payload: {
    sellerId: string;
    rows: {
      gstNumber: string;
      state?: string;
      status?: 'active' | 'inactive';
      businessName?: string;
    }[];
  }) {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (rows.length === 0) {
      throw new BadRequestException('rows must contain at least one entry');
    }

    const seenInFile = new Set<string>();
    const created: Gst[] = [];
    const failed: { index: number; gstNumber: string; reason: string }[] = [];

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const gstNumber = String(row.gstNumber ?? '')
        .trim()
        .toUpperCase();
      if (!gstNumber) {
        failed.push({ index, gstNumber: '', reason: 'GST number is required' });
        continue;
      }
      if (seenInFile.has(gstNumber)) {
        failed.push({
          index,
          gstNumber,
          reason: 'Duplicate GST in uploaded file',
        });
        continue;
      }
      seenInFile.add(gstNumber);

      try {
        const result = await this.createFromImportRow({
          sellerId: payload.sellerId,
          gstNumber,
          state: row.state,
          status: row.status,
          businessName: row.businessName,
        });
        created.push(result.data as Gst);
      } catch (error) {
        const reason =
          error instanceof BadRequestException ||
          error instanceof NotFoundException
            ? String(error.message)
            : 'Failed to import GST row';
        failed.push({ index, gstNumber, reason });
      }
    }

    return {
      success: true,
      data: created,
      totalRows: rows.length,
      createdCount: created.length,
      failedCount: failed.length,
      failed,
    };
  }

  async list(params: { sellerId?: string; limit?: number; skip?: number }) {
    const { sellerId } = params;
    const limit = Math.max(0, params.limit ?? 10);
    const skip = Math.max(0, params.skip ?? 0);
    const filter: Record<string, unknown> = {};
    let resolvedSeller: Awaited<
      ReturnType<GstsService['findSellerByIdentifier']>
    > = null;
    if (sellerId) {
      resolvedSeller = await this.findSellerByIdentifier(sellerId);
      if (resolvedSeller) {
        filter.sellerId = {
          $in: this.getSellerIdAliases(resolvedSeller, sellerId),
        };
      } else {
        filter.sellerId = sellerId;
      }
    }

    const [facetResult, slotSummary] = await Promise.all([
      this.gstModel
        .aggregate<{
          data: unknown[];
          total: { count: number }[];
        }>([
          { $match: filter },
          {
            $facet: {
              data: [
                { $sort: { createdAt: -1 } },
                { $skip: skip },
                { $limit: limit },
              ],
              total: [{ $count: 'count' }],
            },
          },
        ])
        .exec(),
      sellerId
        ? this.buildGstSlotSummary(resolvedSeller, sellerId)
        : Promise.resolve(undefined),
    ]);

    const bucket = facetResult[0] ?? { data: [], total: [] };
    const data = (bucket.data ?? []) as Array<{
      panNumber?: string;
      gstNumber?: string;
    }>;
    const total = bucket.total[0]?.count ?? 0;

    const groupedByPan: Record<string, typeof data> = {};
    data.forEach((item) => {
      const panKey =
        typeof item.panNumber === 'string' && item.panNumber.length > 0
          ? item.panNumber
          : this.extractPanFromGst(item.gstNumber ?? '');
      if (!groupedByPan[panKey]) {
        groupedByPan[panKey] = [];
      }
      groupedByPan[panKey].push(item);
    });

    return {
      success: true,
      data,
      panGroups: Object.entries(groupedByPan).map(([panNumber, gsts]) => ({
        panNumber,
        gsts,
      })),
      total,
      limit,
      skip,
      slotSummary,
    };
  }

  private async buildGstSlotSummary(
    sellerForFilter: Awaited<
      ReturnType<GstsService['findSellerByIdentifier']>
    >,
    sellerId: string,
  ): Promise<
    | {
        purchased: number;
        used: number;
        remaining: number;
      }
    | undefined
  > {
    const sellerIdAliases = sellerForFilter
      ? this.getSellerIdAliases(sellerForFilter, sellerId)
      : [sellerId];
    const sellerGsts = await this.gstModel
      .find({ sellerId: { $in: sellerIdAliases } })
      .select('panNumber gstNumber')
      .lean()
      .exec();
    const sellerPanSet = new Set<string>();
    sellerGsts.forEach((item) => {
      const pan =
        typeof item.panNumber === 'string' && item.panNumber.length > 0
          ? item.panNumber.trim().toUpperCase()
          : this.extractPanFromGst(item.gstNumber);
      if (pan) {
        sellerPanSet.add(pan);
      }
    });
    const seller = sellerForFilter
      ? await this.sellerModel
          .findById(this.getSellerObjectIdString(sellerForFilter))
          .select('gstSlots gstSlotsPurchased panProfiles')
          .lean()
          .exec()
      : null;
    if (!seller) return undefined;

    if (Array.isArray(seller.panProfiles)) {
      seller.panProfiles.forEach((item) => {
        const pan =
          typeof item.panNumber === 'string'
            ? item.panNumber.trim().toUpperCase()
            : '';
        if (pan) {
          sellerPanSet.add(pan);
        }
      });
    }
    const purchased = Math.max(
      0,
      Number(seller.gstSlotsPurchased ?? seller.gstSlots ?? 0),
    );
    const used = sellerPanSet.size;
    return {
      purchased,
      used,
      remaining: Math.max(0, purchased - used),
    };
  }

  private resolveRiskLevel(input: {
    status?: string;
    marketplaceCount: number;
    revenue: number;
    returnRate: number;
  }): 'Low' | 'Medium' | 'High' {
    const status = String(input.status ?? 'active').toLowerCase();
    if (status === 'suspended' || status === 'blocked') return 'High';
    if (status === 'inactive' || status === 'under review') return 'Medium';
    if (input.returnRate >= 20) return 'Medium';
    if (input.marketplaceCount === 0 && input.revenue === 0) return 'Medium';
    return 'Low';
  }

  async getOversight() {
    const gsts = await this.gstModel.find().sort({ createdAt: -1 }).lean().exec();
    const sellerIds = Array.from(new Set(gsts.map((gst) => String(gst.sellerId ?? '')).filter(Boolean)));

    const sellerObjectIds = sellerIds.filter((id) => Types.ObjectId.isValid(id));
    const sellers = await this.sellerModel
      .find({
        $or: [
          { _id: { $in: sellerObjectIds } },
          { publicId: { $in: sellerIds } },
        ],
      })
      .select('fullName email publicId accountStatus onboardingStatus')
      .lean()
      .exec();

    const sellerByKey = new Map<string, (typeof sellers)[number]>();
    for (const seller of sellers) {
      sellerByKey.set(String(seller._id), seller);
      if (seller.publicId) sellerByKey.set(String(seller.publicId), seller);
    }

    const gstIds = gsts.map((gst) => String(gst._id));
    const marketplaces = await this.marketplaceModel
      .find({ gstId: { $in: gstIds } })
      .populate('platformMarketplaceId')
      .lean()
      .exec();

    const marketplacesByGstId = new Map<string, Array<{ id: string; name: string }>>();
    for (const mp of marketplaces) {
      const gstId = String(mp.gstId ?? '');
      if (!gstId) continue;
      const platform = mp.platformMarketplaceId as
        | { _id?: unknown; name?: string; slug?: string }
        | undefined;
      const name =
        String(platform?.name ?? platform?.slug ?? mp.storeName ?? 'Marketplace').trim() ||
        'Marketplace';
      const list = marketplacesByGstId.get(gstId) ?? [];
      list.push({ id: String(mp._id ?? ''), name });
      marketplacesByGstId.set(gstId, list);
    }

    const gstNumbers = gsts.map((gst) => String(gst.gstNumber ?? '').toUpperCase()).filter(Boolean);
    const revenueStats = gstNumbers.length
      ? await this.importRowModel
          .aggregate<{
            _id: string;
            revenue: number;
            salesCount: number;
            returnsCount: number;
          }>([
            { $match: { gstin: { $in: gstNumbers } } },
            {
              $addFields: {
                docUpper: { $toUpper: { $ifNull: ['$documentType', ''] } },
                inv: { $ifNull: ['$invoiceAmount', 0] },
              },
            },
            {
              $group: {
                _id: '$gstin',
                revenue: {
                  $sum: {
                    $cond: [
                      { $regexMatch: { input: '$docUpper', regex: 'SALE' } },
                      '$inv',
                      0,
                    ],
                  },
                },
                salesCount: {
                  $sum: {
                    $cond: [
                      { $regexMatch: { input: '$docUpper', regex: 'SALE' } },
                      1,
                      0,
                    ],
                  },
                },
                returnsCount: {
                  $sum: {
                    $cond: [
                      {
                        $or: [
                          { $regexMatch: { input: '$docUpper', regex: 'RETURN' } },
                          { $regexMatch: { input: '$docUpper', regex: 'RTO' } },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ])
          .exec()
      : [];

    const revenueByGstin = new Map<
      string,
      { revenue: number; salesCount: number; returnsCount: number }
    >();
    for (const row of revenueStats) {
      revenueByGstin.set(String(row._id ?? '').toUpperCase(), {
        revenue: Number(row.revenue ?? 0),
        salesCount: Number(row.salesCount ?? 0),
        returnsCount: Number(row.returnsCount ?? 0),
      });
    }

    const rows = gsts.map((gst) => {
      const gstId = String(gst._id);
      const seller = sellerByKey.get(String(gst.sellerId ?? ''));
      const linkedMarketplaces = marketplacesByGstId.get(gstId) ?? [];
      const stats = revenueByGstin.get(String(gst.gstNumber ?? '').toUpperCase()) ?? {
        revenue: 0,
        salesCount: 0,
        returnsCount: 0,
      };
      const returnRate =
        stats.salesCount > 0
          ? Math.round((stats.returnsCount / stats.salesCount) * 1000) / 10
          : 0;
      const status = String(gst.status ?? 'active');
      const riskLevel = this.resolveRiskLevel({
        status,
        marketplaceCount: linkedMarketplaces.length,
        revenue: stats.revenue,
        returnRate,
      });

      return {
        id: gstId,
        gstNumber: gst.gstNumber,
        businessName: gst.businessName ?? '—',
        state: gst.state ?? '—',
        panNumber: gst.panNumber,
        status,
        createdAt: (gst as { createdAt?: Date }).createdAt,
        sellerId: String(gst.sellerId ?? ''),
        sellerPublicId: seller?.publicId,
        sellerName: seller?.fullName ?? seller?.email ?? 'Unknown Seller',
        sellerAccountStatus: seller?.accountStatus,
        marketplaces: linkedMarketplaces,
        marketplaceCount: linkedMarketplaces.length,
        revenue: stats.revenue,
        salesCount: stats.salesCount,
        returnsCount: stats.returnsCount,
        returnRate,
        riskLevel,
      };
    });

    const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
    const flaggedGsts = rows.filter(
      (row) =>
        row.status.toLowerCase() !== 'active' ||
        row.riskLevel === 'High' ||
        row.riskLevel === 'Medium',
    ).length;
    const activeGsts = rows.filter((row) => row.status.toLowerCase() === 'active').length;
    const linkedMarketplaceTotal = rows.reduce((sum, row) => sum + row.marketplaceCount, 0);
    const uniqueStates = new Set(rows.map((row) => row.state).filter((state) => state && state !== '—'));

    return {
      success: true,
      data: {
        summary: {
          totalGsts: rows.length,
          activeGsts,
          flaggedGsts,
          totalRevenue,
          linkedMarketplaceTotal,
          uniqueStateCount: uniqueStates.size,
        },
        rows,
      },
    };
  }

  async update(
    id: string,
    payload: {
      businessName?: string;
      state?: string;
      status?: 'active' | 'inactive';
    },
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid GST id');
    }
    const gst = await this.gstModel.findById(id).exec();
    if (!gst) {
      throw new NotFoundException('GST not found');
    }

    const updates: Partial<{
      businessName: string | undefined;
      state: string | undefined;
      status: 'active' | 'inactive';
    }> = {};
    if (typeof payload.businessName === 'string') {
      updates.businessName = payload.businessName.trim() || undefined;
    }
    if (typeof payload.state === 'string') {
      updates.state = payload.state.trim() || undefined;
    }
    if (payload.status === 'active' || payload.status === 'inactive') {
      updates.status = payload.status;
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('No valid fields provided for update');
    }

    const updated = await this.gstModel
      .findByIdAndUpdate(id, { $set: updates }, { new: true })
      .lean()
      .exec();

    if (updates.businessName !== undefined) {
      const seller = await this.sellerModel.findById(gst.sellerId).exec();
      if (seller) {
        const panProfiles = Array.isArray(seller.panProfiles)
          ? [...seller.panProfiles]
          : [];
        const panIndex = panProfiles.findIndex(
          (item) => item.panNumber === gst.panNumber,
        );
        if (panIndex >= 0) {
          panProfiles[panIndex] = {
            ...panProfiles[panIndex],
            businessName: updates.businessName,
          };
          seller.panProfiles = panProfiles;
          await seller.save();
        }
      }
    }

    return {
      success: true,
      data: updated,
    };
  }

  async remove(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid GST id');
    }
    const gst = await this.gstModel.findById(id).lean().exec();
    if (!gst) {
      throw new NotFoundException('GST not found');
    }

    const linkedMarketplaces = await this.marketplaceModel.countDocuments({
      gstId: id,
    });
    if (linkedMarketplaces > 0) {
      throw new BadRequestException(
        'Cannot delete GST with linked marketplaces',
      );
    }

    await this.gstModel.findByIdAndDelete(id).exec();

    const remainingGsts = await this.gstModel
      .find({ sellerId: gst.sellerId })
      .select('panNumber gstNumber')
      .lean()
      .exec();
    const panSet = new Set<string>();
    remainingGsts.forEach((item) => {
      const pan =
        typeof item.panNumber === 'string' && item.panNumber.length > 0
          ? item.panNumber.trim().toUpperCase()
          : this.extractPanFromGst(item.gstNumber);
      if (pan) {
        panSet.add(pan);
      }
    });

    const seller = await this.sellerModel.findById(gst.sellerId).exec();
    if (seller) {
      const nextProfiles = Array.isArray(seller.panProfiles)
        ? seller.panProfiles.filter((item) => panSet.has(item.panNumber))
        : [];
      seller.panProfiles = nextProfiles;
      seller.gstSlotsUsed = panSet.size;
      await seller.save();
    }

    return {
      success: true,
      data: gst,
    };
  }

  private async createLegacyGst(
    dto: {
      sellerId: string;
      gstNumber: string;
      state?: string;
      status?: 'active' | 'inactive';
      businessName?: string;
    },
    options?: { actorRole?: string },
  ) {
    const seller = await this.findSellerByIdentifier(dto.sellerId);
    if (!seller) {
      throw new NotFoundException('Seller not found');
    }
    const sellerId = this.getSellerObjectIdString(seller);
    const sellerIdAliases = this.getSellerIdAliases(seller, dto.sellerId);
    const gstNumber = normalizeGstin(dto.gstNumber);
    const extractedPan = this.extractPanFromGst(gstNumber);

    const existing = await this.gstModel.findOne({ gstNumber });
    if (existing) {
      const existingSellerId = String(existing.sellerId ?? '');
      if (sellerIdAliases.some((alias) => alias === existingSellerId)) {
        throw new BadRequestException('GST number already added.');
      }
      throw new BadRequestException(
        'This GST number is already registered with another seller.',
      );
    }

    const sellerGsts = await this.gstModel
      .find({ sellerId: { $in: sellerIdAliases } })
      .select('panNumber gstNumber')
      .lean()
      .exec();
    const sellerPanSet = new Set<string>();
    sellerGsts.forEach((item) => {
      const pan =
        typeof item.panNumber === 'string' && item.panNumber.length > 0
          ? item.panNumber.trim().toUpperCase()
          : this.extractPanFromGst(item.gstNumber);
      if (pan) sellerPanSet.add(pan);
    });
    if (Array.isArray(seller.panProfiles)) {
      seller.panProfiles.forEach((item) => {
        const pan =
          typeof item.panNumber === 'string' ? item.panNumber.trim().toUpperCase() : '';
        if (pan) sellerPanSet.add(pan);
      });
    }

    const isExistingPanForSeller = sellerPanSet.has(extractedPan);
    let purchasedPanSlots = Math.max(
      0,
      Number(seller.gstSlotsPurchased ?? seller.gstSlots ?? 0),
    );
    const usedPanSlots = sellerPanSet.size;
    const isSuperAdmin = options?.actorRole === 'super_admin';
    if (!isExistingPanForSeller && usedPanSlots >= purchasedPanSlots) {
      if (!isSuperAdmin) {
        throw new BadRequestException(
          'You have reached your GST limit. Please upgrade your plan to add a new PAN.',
        );
      }
      purchasedPanSlots += 1;
      seller.gstSlotsPurchased = purchasedPanSlots;
      seller.gstSlots = Math.max(Number(seller.gstSlots ?? 0), purchasedPanSlots);
    }

    const panProfiles = Array.isArray(seller.panProfiles) ? [...seller.panProfiles] : [];
    const panIndex = panProfiles.findIndex((item) => item.panNumber === extractedPan);
    const businessName = dto.businessName?.trim();
    if (panIndex === -1) {
      panProfiles.push({
        panNumber: extractedPan,
        businessName: businessName || undefined,
        createdAt: new Date(),
      });
    } else if (businessName && !panProfiles[panIndex].businessName) {
      panProfiles[panIndex] = { ...panProfiles[panIndex], businessName };
    }

    const created = await this.gstModel.create({
      sellerId,
      gstNumber,
      panNumber: extractedPan,
      businessName,
      state: dto.state,
      status: dto.status ?? 'active',
    });

    seller.panProfiles = panProfiles;
    seller.gstSlotsUsed = isExistingPanForSeller ? usedPanSlots : usedPanSlots + 1;
    await seller.save();

    return { success: true, data: created };
  }

  private async logGstVerificationActivity(params: {
    gstNumber: string;
    sellerName: string;
    actorName: string;
    verifiedAt: Date;
  }) {
    const timestamp = params.verifiedAt.toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const message = [
      'GST Verified Successfully',
      '',
      `GST: ${params.gstNumber}`,
      `Verified By: ${params.actorName}`,
      `Seller: ${params.sellerName}`,
      `Date: ${timestamp}`,
    ].join('\n');

    await this.notificationsService.createNotification({
      event: 'gst_verified',
      recipientRole: 'super_admin',
      message,
    });
  }

  private formatActorRole(role?: string) {
    if (!role) return 'System';
    return role
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private extractStateFromVerification(verification: {
    principalAddress?: string | null;
    rawResponse?: Record<string, unknown>;
  }) {
    const raw = verification.rawResponse ?? {};
    const fromRaw =
      typeof raw.state === 'string'
        ? raw.state
        : typeof raw.state_name === 'string'
          ? raw.state_name
          : '';
    if (fromRaw.trim()) return fromRaw.trim();

    const address = verification.principalAddress ?? '';
    if (!address) return '';
    const parts = address.split(',').map((part) => part.trim()).filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 2] : parts[0] ?? '';
  }

  private formatRegistrationDate(value?: Date | string | null) {
    if (!value) return undefined;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    }
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    return undefined;
  }

  private applyFirstGstBusinessProfile(
    seller: SellerDocument,
    profile: {
      gstNumber: string;
      businessName: string;
      tradeName: string;
      state?: string;
      taxpayerType?: string;
      registrationDate?: string;
      address?: string;
      status?: string;
    },
  ) {
    if (profile.businessName) {
      seller.firmName = profile.businessName;
    }
    if (profile.tradeName) {
      seller.tradeName = profile.tradeName;
    }
    seller.gstNumber = profile.gstNumber;
    if (profile.taxpayerType) {
      seller.businessType = profile.taxpayerType;
    }
    if (profile.registrationDate) {
      seller.registrationDate = profile.registrationDate;
    }
    if (profile.address) {
      seller.address = profile.address;
    }
    if (profile.state) {
      seller.state = profile.state;
    }
    if (profile.status) {
      seller.gstStatus = profile.status;
    }
  }

  private async syncSellerUserCompanyName(seller: SellerDocument) {
    const email = String(seller.email ?? '')
      .trim()
      .toLowerCase();
    if (!email) return;
    await this.userModel
      .updateMany(
        { role: 'seller', email },
        { $set: { companyName: seller.firmName || seller.tradeName || '' } },
      )
      .exec();
  }

  private extractPanFromGst(gstNumber: string) {
    const normalized = gstNumber.trim().toUpperCase();
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[0-9A-Z]$/.test(normalized)) {
      throw new BadRequestException('GSTIN must match valid format');
    }
    return normalized.slice(2, 12);
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

    // Seller can be authenticated through users collection (role=seller).
    // In that case map user -> seller profile by email.
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

  private getSellerObjectIdString(seller: SellerDocument) {
    const id = seller?._id as Types.ObjectId | string | undefined;
    return typeof id === 'string' ? id : id?.toString?.() ?? '';
  }

  private getSellerIdAliases(seller: SellerDocument, requestedId?: string) {
    const aliases = new Set<string>();
    const objectId = this.getSellerObjectIdString(seller);
    if (objectId) aliases.add(objectId);
    if (typeof seller.publicId === 'string' && seller.publicId.trim()) {
      aliases.add(seller.publicId.trim());
    }
    if (typeof requestedId === 'string' && requestedId.trim()) {
      aliases.add(requestedId.trim());
    }
    return Array.from(aliases);
  }
}
