import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { CreateMarketplaceDto } from './dto/create-marketplace.dto';
import { Marketplace, MarketplaceDocument } from './schemas/marketplace.schema';
import {
  PlatformMarketplace,
  PlatformMarketplaceDocument,
} from '../platform-marketplaces/schemas/platform-marketplace.schema';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Gst, GstDocument } from '../gsts/schemas/gst.schema';
import {
  DeletionAuditLog,
  DeletionAuditLogDocument,
} from '../gsts/schemas/deletion-audit-log.schema';
import { rethrowMongoWriteError } from '../common/utils/mongo-errors';
import {
  findSellerByIdentifier,
  getSellerIdAliases,
  getSellerObjectIdString,
  resolveSellerIdAliases,
} from '../common/utils/seller-id.util';
import {
  cascadeDeleteAcrossCollections,
  type MarketplaceScopeToken,
} from '../common/utils/permanent-delete.util';

@Injectable()
export class MarketplacesService implements OnModuleInit {
  private readonly logger = new Logger(MarketplacesService.name);

  constructor(
    @InjectModel(Marketplace.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
    @InjectModel(PlatformMarketplace.name)
    private readonly platformMarketplaceModel: Model<PlatformMarketplaceDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Gst.name)
    private readonly gstModel: Model<GstDocument>,
    @InjectModel(DeletionAuditLog.name)
    private readonly deletionAuditModel: Model<DeletionAuditLogDocument>,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  async onModuleInit() {
    try {
      await this.marketplaceModel.collection.dropIndex('sellerId_1_platformMarketplaceId_1');
      this.logger.log('Dropped legacy marketplace unique index (seller + platform only)');
    } catch {
      // Index may not exist on fresh databases.
    }
    try {
      await this.marketplaceModel.syncIndexes();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Marketplace index sync warning: ${message}`);
    }
  }

  async create(dto: CreateMarketplaceDto) {
    const seller = await findSellerByIdentifier(
      this.sellerModel,
      this.userModel,
      dto.sellerId,
    );
    if (!seller) {
      throw new NotFoundException({
        success: false,
        message: 'Seller not found',
        errorCode: 'SELLER_NOT_FOUND',
      });
    }
    const sellerId = getSellerObjectIdString(seller);
    const sellerIdAliases = getSellerIdAliases(seller, dto.sellerId);

    const platform = await this.resolvePlatform(dto);
    if (platform.status !== 'active') {
      throw new BadRequestException({
        success: false,
        message: 'Marketplace is inactive',
        errorCode: 'MARKETPLACE_INACTIVE',
      });
    }

    const existing = await this.marketplaceModel
      .findOne({
        sellerId: { $in: sellerIdAliases },
        platformMarketplaceId: platform._id,
        gstId: dto.gstId,
      })
      .lean()
      .exec();
    if (existing) {
      throw new BadRequestException({
        success: false,
        message: 'This marketplace is already connected to the selected GST profile',
        errorCode: 'DUPLICATE_MARKETPLACE',
      });
    }

    if (seller.subscriptionPlanType === 'single_gst') {
      const linkedCount = await this.marketplaceModel.countDocuments({
        sellerId: { $in: sellerIdAliases },
      });
      if (linkedCount >= 1) {
        throw new BadRequestException({
          success: false,
          message:
            'Single GST plan allows only one marketplace portal. Upgrade to Multi GST / PAN to connect more.',
          errorCode: 'SINGLE_GST_MARKETPLACE_LIMIT',
        });
      }
    } else if (seller.subscriptionPlanType === 'single_gst_multi_marketplace') {
      const maxLinks = Math.max(
        0,
        Number(seller.marketplaceSlotsPurchased ?? 0),
      );
      if (maxLinks > 0) {
        const linkedCount = await this.marketplaceModel.countDocuments({
          sellerId: { $in: sellerIdAliases },
        });
        if (linkedCount >= maxLinks) {
          throw new BadRequestException({
            success: false,
            message:
              'You have reached your marketplace limit for this subscription. Purchase additional capacity to connect more.',
            errorCode: 'MARKETPLACE_SLOT_LIMIT',
          });
        }
      }
    }

    const created = await this.marketplaceModel.create({
      sellerId,
      platformMarketplaceId: platform._id,
      gstId: dto.gstId,
      storeName: dto.storeName,
      status: 'active',
    });

    const populated = await this.marketplaceModel
      .findById(created._id)
      .populate('platformMarketplaceId')
      .lean()
      .exec();

    this.logger.log(
      `Marketplace linked seller=${sellerId} platform=${platform.name}`,
    );

    return {
      success: true,
      data: this.mapMarketplace(populated),
    };
  }

  async listSeller(params: {
    sellerId: string;
    limit?: number;
    skip?: number;
  }) {
    const sellerAliases = await resolveSellerIdAliases(
      this.sellerModel,
      this.userModel,
      params.sellerId,
    );
    const limit = Math.max(0, params.limit ?? 500);
    const skip = Math.max(0, params.skip ?? 0);
    const data = await this.marketplaceModel
      .find({ sellerId: { $in: sellerAliases } })
      .populate('platformMarketplaceId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();
    const total = await this.marketplaceModel.countDocuments({
      sellerId: { $in: sellerAliases },
    });
    return {
      success: true,
      data: data.map((item) => this.mapMarketplace(item)),
      total,
      limit,
      skip,
    };
  }

  async getById(
    id: string,
    options?: { requesterId?: string; requesterRole?: string },
  ) {
    const link = await this.findOwnedLink(id, options);
    const populated = await this.marketplaceModel
      .findById(link._id)
      .populate('platformMarketplaceId')
      .lean()
      .exec();
    return {
      success: true,
      data: this.mapMarketplace(populated),
    };
  }

  async remove(
    id: string,
    options?: {
      requesterId?: string;
      requesterRole?: string;
      permanentDelete?: boolean;
      confirmedGstNumber?: string;
      confirmationText?: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid marketplace id',
        errorCode: 'INVALID_ID',
      });
    }

    const link = await this.findOwnedLink(id, options);
    if (!options?.permanentDelete) {
      let removed;
      try {
        removed = await this.marketplaceModel
          .findByIdAndDelete(link._id)
          .lean()
          .exec();
      } catch (error) {
        rethrowMongoWriteError(error);
      }
      if (!removed) {
        throw new NotFoundException({
          success: false,
          message: 'Marketplace not found',
          errorCode: 'NOT_FOUND',
        });
      }
      return {
        success: true,
        data: this.mapMarketplace(removed),
      };
    }

    const confirmationText = String(options.confirmationText ?? '').trim();
    if (confirmationText !== 'DELETE') {
      throw new BadRequestException('Confirmation text must be DELETE.');
    }

    const gst = await this.gstModel.findById(String(link.gstId ?? '')).lean().exec();
    if (!gst) {
      throw new NotFoundException('GST not found');
    }
    const confirmedGst = String(options.confirmedGstNumber ?? '')
      .trim()
      .toUpperCase();
    if (confirmedGst !== String(gst.gstNumber ?? '').trim().toUpperCase()) {
      throw new BadRequestException('Entered GST Number does not match.');
    }

    const sellerAliases =
      options?.requesterRole === 'seller' && options.requesterId
        ? await resolveSellerIdAliases(
            this.sellerModel,
            this.userModel,
            options.requesterId,
          )
        : [String(link.sellerId ?? '')];
    const platform = await this.platformMarketplaceModel
      .findById(link.platformMarketplaceId)
      .lean()
      .exec();
    const marketplaceTokens: MarketplaceScopeToken[] = [
      {
        linkId: String(link._id ?? ''),
        platformId: String(link.platformMarketplaceId ?? ''),
        platformSlug: String(platform?.slug ?? '').trim().toLowerCase(),
        platformName: String(platform?.name ?? '').trim().toLowerCase(),
      },
    ];
    const marketplaceLabel =
      String(platform?.slug ?? '').trim().toLowerCase() ||
      String(platform?.name ?? '').trim().toLowerCase() ||
      '';

    try {
      await this.marketplaceModel.deleteOne({ _id: link._id }).exec();

      const auditInsert = await this.deletionAuditModel.collection.insertOne({
        sellerId: String(link.sellerId ?? ''),
        userId: String(options?.requesterId ?? ''),
        action: 'disconnect_marketplace_permanently',
        gstNumber: String(gst.gstNumber ?? ''),
        marketplace: marketplaceLabel,
        deletedCollections: [],
        totalRecordsDeleted: 0,
        cleanupStatus: 'pending',
        deletedAt: new Date(),
        ipAddress: options?.ipAddress,
        userAgent: options?.userAgent,
      });

      void this.runMarketplaceCascadeCleanup({
        auditId: auditInsert.insertedId,
        sellerAliases,
        gstId: String(link.gstId ?? ''),
        gstNumber: String(gst.gstNumber ?? ''),
        marketplaceTokens,
        marketplaceLabel,
      });
    } catch (error) {
      rethrowMongoWriteError(error);
      throw error;
    }

    return {
      success: true,
      message:
        'Marketplace disconnected successfully. Associated data cleanup is running in the background. Other marketplaces connected to this GST remain unaffected.',
      data: this.mapMarketplace(link as never),
    };
  }

  private async runMarketplaceCascadeCleanup(input: {
    auditId: Types.ObjectId;
    sellerAliases: string[];
    gstId: string;
    gstNumber: string;
    marketplaceTokens: MarketplaceScopeToken[];
    marketplaceLabel: string;
  }) {
    try {
      const summary = await cascadeDeleteAcrossCollections(this.connection, {
        sellerAliases: input.sellerAliases,
        gstId: input.gstId,
        gstNumber: input.gstNumber,
        marketplaceTokens: input.marketplaceTokens,
        mode: 'marketplace',
      });
      await this.deletionAuditModel.collection.updateOne(
        { _id: input.auditId },
        {
          $set: {
            deletedCollections: summary.deletedCollections,
            totalRecordsDeleted: summary.totalRecordsDeleted,
            cleanupStatus: 'completed',
          },
        },
      );
      this.logger.log(
        `Marketplace cascade cleanup completed for ${input.marketplaceLabel || input.gstNumber}: ${summary.totalRecordsDeleted} records`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown cascade cleanup error';
      this.logger.error(
        `Marketplace cascade cleanup failed for ${input.marketplaceLabel || input.gstNumber}: ${message}`,
      );
      try {
        await this.deletionAuditModel.collection.updateOne(
          { _id: input.auditId },
          {
            $set: {
              cleanupStatus: 'failed',
              cleanupError: message,
            },
          },
        );
      } catch {
        // ignore secondary audit update failures
      }
    }
  }

  private async findOwnedLink(
    id: string,
    options?: { requesterId?: string; requesterRole?: string },
  ) {
    const trimmed = String(id ?? '').trim();
    if (!Types.ObjectId.isValid(trimmed)) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid marketplace id',
        errorCode: 'INVALID_ID',
      });
    }

    let link = await this.marketplaceModel.findById(trimmed).lean().exec();

    if (!link && options?.requesterId) {
      const sellerAliases = await resolveSellerIdAliases(
        this.sellerModel,
        this.userModel,
        options.requesterId,
      );
      if (sellerAliases.length) {
        link = await this.marketplaceModel
          .findOne({
            platformMarketplaceId: new Types.ObjectId(trimmed),
            sellerId: { $in: sellerAliases },
          })
          .lean()
          .exec();
      }
    }

    if (!link) {
      throw new NotFoundException({
        success: false,
        message: 'Marketplace not found',
        errorCode: 'NOT_FOUND',
      });
    }

    if (options?.requesterRole === 'seller' && options.requesterId) {
      const sellerAliases = await resolveSellerIdAliases(
        this.sellerModel,
        this.userModel,
        options.requesterId,
      );
      const ownerId = String(link.sellerId ?? '');
      if (!sellerAliases.includes(ownerId)) {
        throw new ForbiddenException({
          success: false,
          message: 'You can only remove your own marketplace connections',
          errorCode: 'FORBIDDEN',
        });
      }
    }

    return link;
  }

  private mapMarketplace(
    item:
      | (MarketplaceDocument & {
          platformMarketplaceId?: PlatformMarketplaceDocument | Types.ObjectId;
        })
      | null,
  ) {
    if (!item) {
      return null;
    }
    const platformCandidate = item.platformMarketplaceId;
    const platform =
      platformCandidate &&
      typeof platformCandidate === 'object' &&
      'name' in platformCandidate
        ? (platformCandidate as PlatformMarketplaceDocument)
        : undefined;
    const platformName = platform?.name;
    const platformLogo = platform?.logoUrl;
    const status = item.status ?? 'active';
    const linkId = item._id?.toString?.() ?? String(item._id ?? '');
    return {
      _id: linkId,
      id: linkId,
      sellerId: item.sellerId,
      gstId: item.gstId,
      status,
      name: platformName ?? item.storeName ?? 'Marketplace',
      storeName: item.storeName,
      platformSlug: platform?.slug ?? '',
      platformMarketplaceId: platform
        ? {
            _id: platform._id?.toString?.() ?? platform._id,
            name: platform.name,
            slug: platform.slug,
            logoUrl: platform.logoUrl,
            description: platform.description,
            status: platform.status,
            isActive: platform.status === 'active',
          }
        : item.platformMarketplaceId,
      logoUrl: platformLogo,
    };
  }

  private async resolvePlatform(dto: CreateMarketplaceDto) {
    if (dto.platformMarketplaceId) {
      if (!Types.ObjectId.isValid(dto.platformMarketplaceId)) {
        throw new BadRequestException({
          success: false,
          message: 'Invalid platform marketplace id',
          errorCode: 'INVALID_PLATFORM_ID',
        });
      }
      const found = await this.platformMarketplaceModel
        .findById(dto.platformMarketplaceId)
        .lean()
        .exec();
      if (!found) {
        throw new NotFoundException({
          success: false,
          message: 'Platform marketplace not found',
          errorCode: 'PLATFORM_NOT_FOUND',
        });
      }
      return found;
    }
    const name = dto.name?.trim();
    const found = await this.platformMarketplaceModel
      .findOne({ name: new RegExp(`^${this.escapeRegex(name ?? '')}$`, 'i') })
      .lean()
      .exec();
    if (!found) {
      throw new NotFoundException({
        success: false,
        message: 'Platform marketplace not found',
        errorCode: 'PLATFORM_NOT_FOUND',
      });
    }
    return found;
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
