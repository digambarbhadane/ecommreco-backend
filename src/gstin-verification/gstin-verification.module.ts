import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { GstinVerificationController } from './gstin-verification.controller';
import { GstinVerificationService } from './gstin-verification.service';
import {
  GstinVerification,
  GstinVerificationSchema,
} from './schemas/gstin-verification.schema';
import { Gst, GstSchema } from '../gsts/schemas/gst.schema';

@Module({
  imports: [
    HttpModule.register({
      timeout: 8000,
      maxRedirects: 0,
    }),
    MongooseModule.forFeature([
      { name: GstinVerification.name, schema: GstinVerificationSchema },
      { name: Gst.name, schema: GstSchema },
    ]),
  ],
  controllers: [GstinVerificationController],
  providers: [GstinVerificationService],
  exports: [GstinVerificationService],
})
export class GstinVerificationModule {}
