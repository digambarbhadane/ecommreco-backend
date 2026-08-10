import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SellerDocument = Seller & Document;

@Schema({ timestamps: true })
export class Seller {
  @Prop({ unique: true, sparse: true, index: true })
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

  @Prop()
  tradeName?: string;

  @Prop()
  registrationDate?: string;

  @Prop()
  gstStatus?: string;

  @Prop({ default: '' })
  gstNumber?: string;

  @Prop()
  password?: string;

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

  /** PAN slots from base subscription plan */
  @Prop()
  allocatedPanSlots?: number;

  /** Additional PAN slots purchased via add-on requests */
  @Prop({ default: 0 })
  purchasedPanSlots?: number;

  @Prop()
  usedPanSlots?: number;

  @Prop()
  totalPanSlots?: number;

  @Prop({
    type: [
      {
        panNumber: { type: String, required: true },
        businessName: { type: String },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  panProfiles?: {
    panNumber: string;
    businessName?: string;
    createdAt: Date;
  }[];

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

  @Prop({ default: 'active' })
  accountStatus: 'active' | 'paused' | 'suspended' | 'suspected';

  @Prop()
  accountStatusReason?: string;

  @Prop()
  accountStatusUpdatedAt?: Date;

  /** Self-service trial flags — additive; admin-onboarded sellers remain unset/false. */
  @Prop({ default: false, index: true })
  isTrial?: boolean;

  @Prop({
    type: String,
    enum: [
      'pending_payment',
      'active',
      'expired',
      'converted',
      'suspended',
      'data_deleted',
    ],
    index: true,
  })
  trialStatus?:
    | 'pending_payment'
    | 'active'
    | 'expired'
    | 'converted'
    | 'suspended'
    | 'data_deleted';

  @Prop()
  trialStart?: Date;

  @Prop()
  trialEnd?: Date;

  @Prop({ default: false, index: true })
  convertedToPaid?: boolean;

  @Prop()
  convertedAt?: Date;

  @Prop()
  cleanupDate?: Date;

  @Prop({ uppercase: true, trim: true, index: true })
  panNumber?: string;

  @Prop()
  trialSubscriptionId?: string;

  @Prop({ default: false })
  trialDataDeleted?: boolean;

  @Prop()
  trialDataDeletedAt?: Date;

  /** single_gst | multi_gst_pan — set on trial→paid conversion */
  @Prop({ type: String, enum: ['single_gst', 'multi_gst_pan'] })
  subscriptionPlanType?: 'single_gst' | 'multi_gst_pan' | 'single_gst_multi_marketplace';

  /** Total marketplace links purchased on the current subscription. */
  @Prop({ default: 0 })
  marketplaceSlotsPurchased?: number;

  /** Locked PAN for multi_gst_pan plans — additional GSTs must match this PAN */
  @Prop({ uppercase: true, trim: true, index: true })
  lockedPanNumber?: string;

  /** YYYY-MM months purchased for reconciliation access */
  @Prop({ type: [String], default: [] })
  reconciliationMonths?: string[];

  /** Perione verification id captured at trial registration. */
  @Prop()
  gstVerificationId?: string;
  @Prop()
  subscriptionPlanLabel?: string;

  /** PAN-level pricing breakdown captured at purchase for billing display. */
  @Prop({ type: [Object] })
  subscriptionPanBreakdown?: Array<{
    panNumber: string;
    gstNumbers: string[];
    gstCount: number;
    marketplaceCount: number;
    monthlyRate: number;
    tierLabel: string;
    selectedMonthCount: number;
    billableMonthCount: number;
    lineSubtotal: number;
  }>;
}

export const SellerSchema = SchemaFactory.createForClass(Seller);
