import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';
import { OtpRepository } from './otp.repository';
import { otpConfig } from './otp.config';
import {
  OtpVerification,
  OtpVerificationSchema,
} from './schemas/otp-verification.schema';
import { OtpVerifiedGuard } from './guards/otp-verified.guard';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [
    ConfigModule.forFeature(otpConfig),
    MongooseModule.forFeature([
      { name: OtpVerification.name, schema: OtpVerificationSchema },
    ]),
    SmsModule,
  ],
  controllers: [OtpController],
  providers: [OtpService, OtpRepository, OtpVerifiedGuard],
  exports: [OtpService, OtpVerifiedGuard, OtpRepository],
})
export class OtpModule {}
