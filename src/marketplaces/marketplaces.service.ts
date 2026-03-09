import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateMarketplaceDto } from './dto/create-marketplace.dto';
import { Marketplace, MarketplaceDocument } from './schemas/marketplace.schema';
import {
  PlatformMarketplace,
  PlatformMarketplaceDocument,
} from '../platform-marketplaces/schemas/platform-marketplace.schema';

@Injectable()
export class MarketplacesService {
  private readonly logger = new Logger(MarketplacesService.name);

  constructor(
    @InjectModel(Marketplace.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
    @InjectModel(PlatformMarketplace.name)
    private readonly platformMarketplaceModel: Model<PlatformMarketplaceDocument>,
  ) {}

  async create(dto: CreateMarketplaceDto) {
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
        sellerId: dto.sellerId,
        platformMarketplaceId: platform._id,
      })
      .lean()
      .exec();
    if (existing) {
      throw new BadRequestException({
        success: false,
        message: 'Marketplace already connected',
        errorCode: 'DUPLICATE_MARKETPLACE',
      });
    }

    const created = await this.marketplaceModel.create({
      sellerId: dto.sellerId,
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
      `Marketplace linked seller=${dto.sellerId} platform=${platform.name}`,
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
    const limit = Math.max(0, params.limit ?? 10);
    const skip = Math.max(0, params.skip ?? 0);
    const data = await this.marketplaceModel
      .find({ sellerId: params.sellerId })
      .populate('platformMarketplaceId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();
    const total = await this.marketplaceModel.countDocuments({
      sellerId: params.sellerId,
    });
    return {
      success: true,
      data: data.map((item) => this.mapMarketplace(item)),
      total,
      limit,
      skip,
    };
  }

  async remove(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid marketplace id',
        errorCode: 'INVALID_ID',
      });
    }
    const removed = await this.marketplaceModel
      .findByIdAndDelete(id)
      .lean()
      .exec();
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
    return {
      _id: item._id?.toString?.() ?? item._id,
      sellerId: item.sellerId,
      gstId: item.gstId,
      status,
      name: platformName ?? item.storeName ?? 'Marketplace',
      storeName: item.storeName,
      platformMarketplaceId: platform
        ? {
            _id: platform._id?.toString?.() ?? platform._id,
            name: platform.name,
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
