import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketplacesController } from './marketplaces.controller';
import { MarketplacesService } from './marketplaces.service';
import { Marketplace, MarketplaceSchema } from './schemas/marketplace.schema';
import { PlatformMarketplacesModule } from '../platform-marketplaces/platform-marketplaces.module';
import {
  PlatformMarketplace,
  PlatformMarketplaceSchema,
} from '../platform-marketplaces/schemas/platform-marketplace.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Marketplace.name, schema: MarketplaceSchema },
      { name: PlatformMarketplace.name, schema: PlatformMarketplaceSchema },
    ]),
    PlatformMarketplacesModule,
  ],
  controllers: [MarketplacesController],
  providers: [MarketplacesService],
})
export class MarketplacesModule {}
