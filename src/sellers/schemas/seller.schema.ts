import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SellerDocument = Seller & Document;

@Schema({ timestamps: true })
export class Seller {
  @Prop({ unique: true, index: true })
  publicId?: string;

  @Prop({ required: true, index: true })
  fullName: string;

  @Prop({ required: true })
  contactNumber: string;

  @Prop({ required: true, index: true })
  email: string;

  @Prop()
  firmName?: string;

  @Prop()
  address?: string;

  @Prop()
  bio?: string;

  @Prop()
  businessType?: string;

  @Prop({ required: true })
  gstNumber: string;

  @Prop()
  password?: string;

  @Prop()
  pendingPasswordCiphertext?: string;

  @Prop()
  pendingPasswordIv?: string;

  @Prop()
  pendingPasswordTag?: string;

  @Prop()
  username?: string;

  @Prop()
  leadId?: string;

  @Prop()
  gstSlots?: number;

  @Prop()
  gstSlotsPurchased?: number;

  @Prop({ default: 0 })
  gstSlotsUsed?: number;

  @Prop()
  durationYears?: number;

  @Prop()
  subscriptionDuration?: number;

  @Prop()
  amount?: number;

  @Prop()
  paymentLink?: string;

  @Prop()
  paymentLinkSentAt?: Date;

  @Prop()
  paymentCompletedAt?: Date;

  @Prop()
  paymentCompletedBy?: string;

  @Prop()
  paymentVerifiedAt?: Date;

  @Prop()
  paymentVerifiedBy?: string;

  @Prop()
  verificationNotes?: string;

  @Prop()
  credentialsGeneratedAt?: Date;

  @Prop()
  credentialGeneratedBy?: string;

  @Prop()
  credentialsApprovedAt?: Date;

  @Prop()
  credentialsApprovedBy?: string;

  @Prop()
  credentialsSentAt?: Date;

  @Prop()
  trainingCompletedAt?: Date;

  @Prop()
  trainingCompletedBy?: string;

  @Prop()
  subscriptionStartsAt?: Date;

  @Prop()
  subscriptionEndsAt?: Date;

  @Prop()
  subscriptionId?: string;

  @Prop()
  paymentStatus?: string;

  @Prop()
  paymentDate?: Date;

  @Prop()
  paymentAmount?: number;

  @Prop()
  paymentId?: string;

  @Prop()
  transactionId?: string;

  @Prop()
  salesManager?: string;

  @Prop()
  leadSource?: string;

  @Prop()
  leadCreatedAt?: Date;

  @Prop()
  leadContactedAt?: Date;

  @Prop()
  leadConvertedAt?: Date;

  @Prop()
  leadConvertedBy?: string;

  @Prop()
  leadCreatedBy?: string;

  @Prop()
  leadContactedBy?: string;

  @Prop()
  paymentLinkGeneratedBy?: string;

  @Prop()
  accountCreatedAt?: Date;

  @Prop()
  accountCreatedBy?: string;

  @Prop()
  adminApprovalRequestedAt?: Date;

  @Prop()
  adminApprovalRequestedBy?: string;

  @Prop()
  trainingStatus?: string;

  @Prop()
  city?: string;

  @Prop()
  state?: string;

  @Prop()
  salesNotes?: string;

  @Prop()
  assignedAccountsManager?: string;

  @Prop()
  assignedTrainingSupportManager?: string;

  @Prop()
  underReview?: boolean;

  @Prop({ default: 'payment_pending' })
  onboardingStatus:
    | 'lead_generated'
    | 'sales_contacted'
    | 'payment_pending'
    | 'payment_completed'
    | 'payment_verified'
    | 'account_created'
    | 'credentials_generated'
    | 'awaiting_super_admin_approval'
    | 'credentials_sent'
    | 'training_pending'
    | 'training_completed'
    | 'active';

  @Prop({ default: 'paused' })
  accountStatus: 'active' | 'paused' | 'suspended' | 'suspected';
}

export const SellerSchema = SchemaFactory.createForClass(Seller);
