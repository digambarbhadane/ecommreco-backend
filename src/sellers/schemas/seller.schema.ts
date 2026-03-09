import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SellerDocument = Seller & Document;

@Schema({ timestamps: true })
export class Seller {
  @Prop({ required: true, index: true })
  fullName: string;

  @Prop({ required: true })
  contactNumber: string;

  @Prop({ required: true, index: true })
  email: string;

  @Prop({ required: true })
  gstNumber: string;

  @Prop()
  password?: string;

  @Prop()
  leadId?: string;

  @Prop()
  gstSlots?: number;

  @Prop()
  durationYears?: number;

  @Prop()
  amount?: number;

  @Prop()
  paymentLink?: string;

  @Prop()
  paymentLinkSentAt?: Date;

  @Prop()
  paymentCompletedAt?: Date;

  @Prop()
  credentialsGeneratedAt?: Date;

  @Prop()
  credentialsApprovedAt?: Date;

  @Prop()
  credentialsSentAt?: Date;

  @Prop()
  trainingCompletedAt?: Date;

  @Prop()
  subscriptionStartsAt?: Date;

  @Prop()
  subscriptionEndsAt?: Date;

  @Prop({ default: 'payment_pending' })
  onboardingStatus:
    | 'lead_generated'
    | 'sales_contacted'
    | 'payment_pending'
    | 'payment_completed'
    | 'credentials_generated'
    | 'awaiting_super_admin_approval'
    | 'credentials_sent'
    | 'training_pending'
    | 'training_completed'
    | 'active';
}

export const SellerSchema = SchemaFactory.createForClass(Seller);
