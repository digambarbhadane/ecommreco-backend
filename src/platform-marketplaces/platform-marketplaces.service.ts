import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PlatformMarketplace,
  PlatformMarketplaceDocument,
} from './schemas/platform-marketplace.schema';

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

  async list() {
    const data = await this.platformMarketplaceModel
      .find({ status: 'active' })
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
