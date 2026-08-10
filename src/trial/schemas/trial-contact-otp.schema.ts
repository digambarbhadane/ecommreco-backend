import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TrialContactOtpDocument = TrialContactOtp & Document;

@Schema({ timestamps: true, collection: 'trial_contact_otps' })
export class TrialContactOtp {
  @Prop({ required: true, index: true })
  channel!: 'email' | 'mobile';

  @Prop({ required: true, index: true })
  target!: string;

  @Prop({ required: true, default: 'trial_registration' })
  purpose!: string;

  @Prop({ required: true })
  otpHash!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop()
  verifiedAt?: Date;

  @Prop()
  verificationId?: string;

  @Prop({ default: 0 })
  sendCount!: number;

  @Prop({ default: 0 })
  verifyAttempts!: number;

  @Prop()
  lastSentAt?: Date;
}

export const TrialContactOtpSchema =
  SchemaFactory.createForClass(TrialContactOtp);

TrialContactOtpSchema.index(
  { channel: 1, target: 1, purpose: 1 },
  { unique: true },
);
