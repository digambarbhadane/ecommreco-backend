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

  @Prop({ required: true })
  gstNumber: string;

  @Prop()
  password?: string;

  @Prop()
  leadId?: string;

  @Prop()
  gstSlots?: number;

  @Prop()
  gstSlotsPurchased?: number;

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
  paymentVerifiedBy?: string;

  @Prop()
  credentialsGeneratedAt?: Date;

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

  @Prop()
  firmName: string;

  @Prop()
  city: string;

  @Prop()
  state: string;

  @Prop()
  address?: string;

  @Prop()
  bio?: string;

  @Prop()
  subscriptionId: string;

  @Prop()
  gstSlotsUsed: number;

  @Prop()
  paymentStatus: string;

  @Prop()
  paymentId: string;

  @Prop()
  transactionId: string;

  @Prop()
  paymentDate: Date;

  @Prop()
  paymentAmount: number;

  @Prop()
  username: string;

  @Prop()
  trainingStatus: string;

  @Prop()
  salesManager: string;

  @Prop()
  assignedAccountsManager?: string;

  @Prop()
  assignedTrainingSupportManager?: string;

  @Prop()
  salesNotes: string;

  @Prop()
  verificationNotes: string;

  @Prop()
  credentialGeneratedBy: string;

  @Prop()
  businessType: string;

  @Prop()
  leadSource: string;

  @Prop()
  paymentVerifiedAt: Date;

  @Prop()
  accountCreatedAt: Date;

  @Prop()
  leadCreatedAt: Date;

  @Prop()
  leadContactedAt: Date;

  @Prop()
  leadConvertedAt: Date;

  @Prop()
  leadConvertedBy: string;

  @Prop()
  leadCreatedBy: string;

  @Prop()
  leadContactedBy: string;

  @Prop()
  paymentLinkGeneratedBy: string;

  @Prop()
  accountCreatedBy: string;

  @Prop()
  adminApprovalRequestedBy: string;

  @Prop()
  adminApprovalRequestedAt: Date;
}

export const SellerSchema = SchemaFactory.createForClass(Seller);
