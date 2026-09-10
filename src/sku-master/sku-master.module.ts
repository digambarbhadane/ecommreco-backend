import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SkuMasterController } from './sku-master.controller';
import { SkuMasterService } from './sku-master.service';
import { SkuMasterExcelService } from './sku-master-excel.service';
import { SkuMasterSyncService } from './sku-master-sync.service';
import {
  SkuMasterMapping,
  SkuMasterMappingSchema,
} from './schemas/sku-master-mapping.schema';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Gst, GstSchema } from '../gsts/schemas/gst.schema';
import {
  ImportUpload,
  ImportUploadSchema,
} from '../report-import/schemas/import-upload.schema';
import {
  ImportRow,
  ImportRowSchema,
} from '../report-import/schemas/import-row.schema';
import {
  Marketplace,
  MarketplaceSchema,
} from '../marketplaces/schemas/marketplace.schema';
import {
  PlatformMarketplace,
  PlatformMarketplaceSchema,
} from '../platform-marketplaces/schemas/platform-marketplace.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SkuMasterMapping.name, schema: SkuMasterMappingSchema },
      { name: Seller.name, schema: SellerSchema },
      { name: User.name, schema: UserSchema },
      { name: Gst.name, schema: GstSchema },
      { name: ImportUpload.name, schema: ImportUploadSchema },
      { name: ImportRow.name, schema: ImportRowSchema },
      { name: Marketplace.name, schema: MarketplaceSchema },
      { name: PlatformMarketplace.name, schema: PlatformMarketplaceSchema },
    ]),
  ],
  controllers: [SkuMasterController],
  providers: [SkuMasterService, SkuMasterSyncService, SkuMasterExcelService],
  exports: [SkuMasterService, SkuMasterSyncService, SkuMasterExcelService],
})
export class SkuMasterModule {}
