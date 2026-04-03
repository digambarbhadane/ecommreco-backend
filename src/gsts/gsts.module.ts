import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GstsController } from './gsts.controller';
import { GstsService } from './gsts.service';
import { Gst, GstSchema } from './schemas/gst.schema';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import {
  Marketplace,
  MarketplaceSchema,
} from '../marketplaces/schemas/marketplace.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Gst.name, schema: GstSchema },
      { name: Seller.name, schema: SellerSchema },
      { name: Marketplace.name, schema: MarketplaceSchema },
    ]),
  ],
  controllers: [GstsController],
  providers: [GstsService],
  exports: [GstsService],
})
export class GstsModule {}
