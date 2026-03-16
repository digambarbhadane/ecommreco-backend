import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GstsController } from './gsts.controller';
import { GstsService } from './gsts.service';
import { Gst, GstSchema } from './schemas/gst.schema';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Gst.name, schema: GstSchema },
      { name: Seller.name, schema: SellerSchema },
    ]),
  ],
  controllers: [GstsController],
  providers: [GstsService],
  exports: [GstsService],
})
export class GstsModule {}
