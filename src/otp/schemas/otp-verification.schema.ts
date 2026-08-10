import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import type { OtpPurpose } from '../otp.constants';

export type OtpVerificationDocument = OtpVerification & Document;

@Schema({ timestamps: true, collection: 'otp_verifications' })
export class OtpVerification {
  @Prop({ required: true, index: true })
  mobile!: string;

  @Prop({ required: true, index: true })
  purpose!: OtpPurpose;

  @Prop()
  otpHash?: string;

  @Prop({ default: 0 })
  attempts!: number;

  @Prop({ default: false })
  verified!: boolean;

  @Prop()
  expiresAt?: Date;

  @Prop()
  verifiedAt?: Date;

  @Prop()
  requestedIp?: string;

  @Prop()
  requestedUserAgent?: string;

  @Prop({ default: 0 })
  requestCount!: number;

  @Prop()
  blockedUntil?: Date;

  @Prop()
  lastSentAt?: Date;

  @Prop()
  verificationProofExpiresAt?: Date;

  @Prop()
  msg91ReqId?: string;
}

export const OtpVerificationSchema =
  SchemaFactory.createForClass(OtpVerification);

OtpVerificationSchema.index({ mobile: 1, purpose: 1 }, { unique: true });
