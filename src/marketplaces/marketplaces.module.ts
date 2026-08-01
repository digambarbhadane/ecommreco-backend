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
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Gst, GstSchema } from '../gsts/schemas/gst.schema';
import {
  DeletionAuditLog,
  DeletionAuditLogSchema,
} from '../gsts/schemas/deletion-audit-log.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Marketplace.name, schema: MarketplaceSchema },
      { name: PlatformMarketplace.name, schema: PlatformMarketplaceSchema },
      { name: Seller.name, schema: SellerSchema },
      { name: User.name, schema: UserSchema },
      { name: Gst.name, schema: GstSchema },
      { name: DeletionAuditLog.name, schema: DeletionAuditLogSchema },
    ]),
    PlatformMarketplacesModule,
  ],
  controllers: [MarketplacesController],
  providers: [MarketplacesService],
  exports: [MarketplacesService],
})
export class MarketplacesModule {}
