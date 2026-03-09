import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PlatformMarketplacesController } from './platform-marketplaces.controller';
import { PlatformMarketplacesService } from './platform-marketplaces.service';
import {
  PlatformMarketplace,
  PlatformMarketplaceSchema,
} from './schemas/platform-marketplace.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlatformMarketplace.name, schema: PlatformMarketplaceSchema },
    ]),
  ],
  controllers: [PlatformMarketplacesController],
  providers: [PlatformMarketplacesService],
  exports: [PlatformMarketplacesService],
})
export class PlatformMarketplacesModule {}
