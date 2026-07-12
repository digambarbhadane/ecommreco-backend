import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateMarketplaceDto } from './dto/create-marketplace.dto';
import { Marketplace, MarketplaceDocument } from './schemas/marketplace.schema';
import {
  PlatformMarketplace,
  PlatformMarketplaceDocument,
} from '../platform-marketplaces/schemas/platform-marketplace.schema';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { rethrowMongoWriteError } from '../common/utils/mongo-errors';
import {
  findSellerByIdentifier,
  getSellerIdAliases,
  getSellerObjectIdString,
  resolveSellerIdAliases,
} from '../common/utils/seller-id.util';

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
    options?: { requesterId?: string; requesterRole?: string },
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid marketplace id',
        errorCode: 'INVALID_ID',
      });
    }

    const link = await this.findOwnedLink(id, options);
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
