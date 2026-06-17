import {
  BadRequestException,
  Injectable,
  Logger,
<<<<<<< HEAD
  OnModuleInit,
  NotFoundException,
=======
  NotFoundException,
  OnModuleInit,
>>>>>>> 86bbd8c0b784f5559b068c42e44fdc061bc3025a
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PlatformMarketplace,
  PlatformMarketplaceDocument,
} from './schemas/platform-marketplace.schema';
import { CreatePlatformMarketplaceDto } from './dto/create-platform-marketplace.dto';
import { UpdatePlatformMarketplaceDto } from './dto/update-platform-marketplace.dto';

@Injectable()
export class PlatformMarketplacesService implements OnModuleInit {
  private readonly logger = new Logger(PlatformMarketplacesService.name);

  constructor(
    @InjectModel(PlatformMarketplace.name)
    private readonly platformMarketplaceModel: Model<PlatformMarketplaceDocument>,
  ) {}

  async onModuleInit() {
    await this.ensureStatusDefaults();
    await this.seedDefaults();
  }

  private toView(item: PlatformMarketplaceDocument | (PlatformMarketplace & { _id?: unknown })) {
    const source = item as PlatformMarketplace & { _id?: unknown };
    return {
      ...source,
      isActive: source.status === 'active',
    };
  }

  private slugify(name: string) {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async list() {
    const data = await this.platformMarketplaceModel
      .find({ status: 'active' })
      .sort({ name: 1 })
      .lean()
      .exec();
    return {
      success: true,
      data: data.map((item) => this.toView(item)),
    };
  }

  async listAll() {
    const data = await this.platformMarketplaceModel
      .find({})
      .sort({ name: 1 })
      .lean()
      .exec();
    return {
      success: true,
      data: data.map((item) => this.toView(item)),
    };
  }

  async getById(id: string) {
    const marketplace = await this.platformMarketplaceModel.findById(id).lean().exec();
    if (!marketplace) {
      throw new NotFoundException('Marketplace not found');
    }
    return {
      success: true,
      data: this.toView(marketplace),
    };
  }

  async create(payload: {
    name: string;
    slug?: string;
    logoUrl?: string;
    description?: string;
    status?: 'active' | 'inactive';
  }) {
    const name = payload.name?.trim();
    if (!name) {
      throw new BadRequestException('Marketplace name is required');
    }
    const slug = (payload.slug?.trim() || this.slugify(name)).toLowerCase();
    if (!slug) {
      throw new BadRequestException('Unable to generate marketplace slug');
    }

    const existing = await this.platformMarketplaceModel.findOne({ slug }).lean().exec();
    if (existing) {
      throw new BadRequestException('Marketplace already exists');
    }

    const created = await this.platformMarketplaceModel.create({
      name,
      slug,
      logoUrl: payload.logoUrl?.trim() || undefined,
      description: payload.description?.trim() || undefined,
      status: payload.status === 'inactive' ? 'inactive' : 'active',
      isActive: payload.status !== 'inactive',
    });

    const saved = await this.platformMarketplaceModel.findById(created._id).lean().exec();
    return {
      success: true,
      data: this.toView(saved as PlatformMarketplace & { _id?: unknown }),
    };
  }

  async update(
    id: string,
    payload: Partial<{
      name: string;
      slug: string;
      logoUrl: string;
      description: string;
      status: 'active' | 'inactive';
    }>,
  ) {
    const current = await this.platformMarketplaceModel.findById(id).lean().exec();
    if (!current) {
      throw new NotFoundException('Marketplace not found');
    }

    const updatePayload: Record<string, unknown> = {};
    if (typeof payload.name === 'string' && payload.name.trim()) {
      updatePayload.name = payload.name.trim();
      if (!payload.slug) {
        updatePayload.slug = this.slugify(payload.name);
      }
    }
    if (typeof payload.slug === 'string' && payload.slug.trim()) {
      updatePayload.slug = this.slugify(payload.slug);
    }
    if (typeof payload.logoUrl === 'string') {
      updatePayload.logoUrl = payload.logoUrl.trim() || undefined;
    }
    if (typeof payload.description === 'string') {
      updatePayload.description = payload.description.trim() || undefined;
    }
    if (payload.status === 'active' || payload.status === 'inactive') {
      updatePayload.status = payload.status;
      updatePayload.isActive = payload.status === 'active';
    }

    const updated = await this.platformMarketplaceModel
      .findByIdAndUpdate(id, { $set: updatePayload }, { new: true })
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException('Marketplace not found');
    }

    return {
      success: true,
      data: this.toView(updated),
    };
  }

  async remove(id: string) {
    const removed = await this.platformMarketplaceModel.findByIdAndDelete(id).lean().exec();
    if (!removed) {
      throw new NotFoundException('Marketplace not found');
    }
    return {
      success: true,
      data: { deleted: true },
    };
  }

  async listAll() {
    const data = await this.platformMarketplaceModel
      .find({})
      .sort({ name: 1 })
      .lean()
      .exec();
    return {
      success: true,
      data: data.map((item) => ({
        ...item,
        isActive: item.status === 'active',
      })),
    };
  }

  async create(dto: CreatePlatformMarketplaceDto) {
    const name = typeof dto.name === 'string' ? dto.name.trim() : '';
    if (!name) {
      throw new BadRequestException({
        success: false,
        message: 'name is required',
      });
    }

    const baseSlug =
      typeof dto.slug === 'string' && dto.slug.trim().length > 0
        ? dto.slug.trim()
        : this.slugify(name);

    if (!baseSlug) {
      throw new BadRequestException({
        success: false,
        message: 'slug is invalid',
      });
    }

    const existingByName = await this.platformMarketplaceModel
      .findOne({ name: new RegExp(`^${this.escapeRegex(name)}$`, 'i') })
      .lean()
      .exec();
    if (existingByName) {
      throw new BadRequestException({
        success: false,
        message: 'Marketplace already exists',
        errorCode: 'DUPLICATE_MARKETPLACE',
      });
    }

    const slug = await this.ensureUniqueSlug(baseSlug);
    const status: 'active' | 'inactive' =
      dto.status === 'inactive' ? 'inactive' : 'active';

    const created = await this.platformMarketplaceModel.create({
      name,
      slug,
      logoUrl: dto.logoUrl,
      description: dto.description,
      status,
      isActive: status === 'active',
    });

    return { success: true, data: created.toObject() };
  }

  async update(id: string, dto: UpdatePlatformMarketplaceDto) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid marketplace id',
      });
    }

    const update: Record<string, unknown> = {};

    if (typeof dto.name === 'string' && dto.name.trim().length > 0) {
      update.name = dto.name.trim();
    }

    if (typeof dto.logoUrl === 'string') {
      update.logoUrl = dto.logoUrl.trim();
    }
    if (typeof dto.description === 'string') {
      update.description = dto.description.trim();
    }

    if (dto.status === 'active' || dto.status === 'inactive') {
      update.status = dto.status;
      update.isActive = dto.status === 'active';
    }

    if (typeof dto.slug === 'string' && dto.slug.trim().length > 0) {
      update.slug = await this.ensureUniqueSlug(dto.slug.trim(), id);
    } else if (typeof update.name === 'string') {
      update.slug = await this.ensureUniqueSlug(this.slugify(update.name), id);
    }

    const updated = await this.platformMarketplaceModel
      .findByIdAndUpdate(id, { $set: update }, { new: true })
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException({
        success: false,
        message: 'Marketplace not found',
      });
    }

    return { success: true, data: updated };
  }

  async getById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid marketplace id',
      });
    }
    const found = await this.platformMarketplaceModel
      .findById(id)
      .lean()
      .exec();
    if (!found) {
      throw new NotFoundException({
        success: false,
        message: 'Marketplace not found',
      });
    }
    return {
      success: true,
      data: { ...found, isActive: found.status === 'active' },
    };
  }

  async remove(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid marketplace id',
      });
    }
    const removed = await this.platformMarketplaceModel
      .findByIdAndDelete(id)
      .lean()
      .exec();
    if (!removed) {
      throw new NotFoundException({
        success: false,
        message: 'Marketplace not found',
      });
    }
    return { success: true, data: { deleted: true } };
  }

  private slugify(value: string) {
    return value
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async ensureUniqueSlug(base: string, excludeId?: string) {
    const normalized = this.slugify(base) || base;
    let candidate = normalized;
    let suffix = 2;

    while (true) {
      const exists = await this.platformMarketplaceModel
        .findOne({
          slug: new RegExp(`^${this.escapeRegex(candidate)}$`, 'i'),
          ...(excludeId && Types.ObjectId.isValid(excludeId)
            ? { _id: { $ne: excludeId } }
            : {}),
        })
        .select('_id')
        .lean()
        .exec();
      if (!exists) return candidate;
      candidate = `${normalized}-${suffix}`;
      suffix += 1;
      if (suffix > 200) {
        throw new BadRequestException({
          success: false,
          message: 'Unable to generate unique slug',
        });
      }
    }
  }

  private async ensureStatusDefaults() {
    await this.platformMarketplaceModel.updateMany(
      { status: { $exists: false }, isActive: true },
      { $set: { status: 'active' } },
    );
    await this.platformMarketplaceModel.updateMany(
      { status: { $exists: false }, isActive: false },
      { $set: { status: 'inactive' } },
    );
    await this.platformMarketplaceModel.updateMany(
      { status: { $exists: false }, isActive: { $exists: false } },
      { $set: { status: 'active', isActive: true } },
    );
  }

  private async seedDefaults() {
    const defaults: Array<{
      name: string;
      slug: string;
      logoUrl: string;
      description: string;
      status: 'active' | 'inactive';
    }> = [
      {
        name: 'Amazon',
        slug: 'amazon',
        logoUrl: 'https://cdn.worldvectorlogo.com/logos/amazon-icon-1.svg',
        description: 'Amazon Marketplace',
        status: 'active',
      },
      {
        name: 'Flipkart',
        slug: 'flipkart',
        logoUrl: 'https://cdn.worldvectorlogo.com/logos/flipkart.svg',
        description: 'Flipkart Marketplace',
        status: 'active',
      },
      {
        name: 'Meesho',
        slug: 'meesho',
        logoUrl: 'https://cdn.worldvectorlogo.com/logos/meesho-1.svg',
        description: 'Meesho Marketplace',
        status: 'active',
      },
      {
        name: 'Nykaa',
        slug: 'nykaa',
        logoUrl: 'https://cdn.worldvectorlogo.com/logos/nykaa-1.svg',
        description: 'Nykaa Marketplace',
        status: 'active',
      },
      {
        name: 'Myntra',
        slug: 'myntra',
        logoUrl: 'https://cdn.worldvectorlogo.com/logos/myntra-1.svg',
        description: 'Myntra Marketplace',
        status: 'active',
      },
      {
        name: 'Ajio',
        slug: 'ajio',
        logoUrl: 'https://cdn.worldvectorlogo.com/logos/ajio-1.svg',
        description: 'Ajio Marketplace',
        status: 'active',
      },
      {
        name: 'Shopify',
        slug: 'shopify',
        logoUrl: 'https://cdn.worldvectorlogo.com/logos/shopify.svg',
        description: 'Shopify Store',
        status: 'active',
      },
      {
        name: 'WooCommerce',
        slug: 'woocommerce',
        logoUrl: 'https://cdn.worldvectorlogo.com/logos/woocommerce.svg',
        description: 'WooCommerce Store',
        status: 'active',
      },
    ];

    const operations: Parameters<
      Model<PlatformMarketplaceDocument>['bulkWrite']
    >[0] = defaults.map((item) => ({
      updateOne: {
        filter: { name: item.name },
        update: { $set: { ...item, isActive: true } },
        upsert: true,
      },
    }));

    if (operations.length === 0) {
      return;
    }

    const result = await this.platformMarketplaceModel.bulkWrite(operations);
    if (result.upsertedCount > 0) {
      this.logger.log(`Seeded ${result.upsertedCount} marketplaces`);
    }
  }
}
