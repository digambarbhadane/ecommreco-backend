import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { GstsController } from './gsts.controller';
import { GstAliasController } from './gst-alias.controller';
import { GstsService } from './gsts.service';
import { PerioneGstVerificationService } from './perione-gst-verification.service';
import { Gst, GstSchema } from './schemas/gst.schema';
import {
  GstinVerification,
  GstinVerificationSchema,
} from '../gstin-verification/schemas/gstin-verification.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  Marketplace,
  MarketplaceSchema,
} from '../marketplaces/schemas/marketplace.schema';
import {
  PlatformMarketplace,
  PlatformMarketplaceSchema,
} from '../platform-marketplaces/schemas/platform-marketplace.schema';
import {
  ImportRow,
  ImportRowSchema,
} from '../report-import/schemas/import-row.schema';
import {
  DeletionAuditLog,
  DeletionAuditLogSchema,
} from './schemas/deletion-audit-log.schema';
import { TrialModule } from '../trial/trial.module';

@Module({
  imports: [
    HttpModule.register({
      timeout: 15000,
      maxRedirects: 0,
    }),
    NotificationsModule,
    forwardRef(() => TrialModule),
    MongooseModule.forFeature([
      { name: Gst.name, schema: GstSchema },
      { name: GstinVerification.name, schema: GstinVerificationSchema },
      { name: Seller.name, schema: SellerSchema },
      { name: User.name, schema: UserSchema },
      { name: Marketplace.name, schema: MarketplaceSchema },
      { name: PlatformMarketplace.name, schema: PlatformMarketplaceSchema },
      { name: ImportRow.name, schema: ImportRowSchema },
      { name: DeletionAuditLog.name, schema: DeletionAuditLogSchema },
    ]),
  ],
  controllers: [GstsController, GstAliasController],
  providers: [GstsService, PerioneGstVerificationService],
  exports: [GstsService, PerioneGstVerificationService],
})
export class GstsModule {}
