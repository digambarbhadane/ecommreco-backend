import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type LeadDocument = HydratedDocument<Lead>;

@Schema({ timestamps: true, collection: 'leads' })
export class Lead {
  @Prop({ unique: true, index: true, required: true })
  publicId: string;

  @Prop({ unique: true, index: true, required: true })
  leadId: string;

  @Prop({ index: true })
  fullName?: string;

  @Prop({ required: true, index: true })
  contactNumber: string;

  @Prop({ index: true })
  email?: string;

  @Prop()
  gstNumber?: string;

  @Prop({ type: [String] })
  gstNumbers?: string[];

  @Prop()
  gstCount?: number;

  @Prop({ type: [String] })
  marketplaces?: string[];

  @Prop()
  firmName?: string;

  @Prop()
  city?: string;

  @Prop()
  state?: string;

  @Prop()
  businessType?: string;

  @Prop({ default: true })
  gstAvailable: boolean;

  @Prop({
    type: [
      {
        content: { type: String, required: true },
        addedBy: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  })
  notes: {
    content: string;
    addedBy: string;
    createdAt: Date;
  }[];

  @Prop({
    type: [
      {
        action: { type: String, required: true },
        description: { type: String, required: true },
        performedBy: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        metadata: { type: Object },
      },
    ],
  })
  activityTimeline: {
    action: string;
    description: string;
    performedBy: string;
    timestamp: Date;
    metadata?: Record<string, any>;
  }[];

  @Prop({
    type: [
      {
        scheduledAt: { type: Date, required: true },
        status: {
          type: String,
          enum: ['pending', 'completed', 'missed'],
          default: 'pending',
        },
        notes: String,
        createdBy: String,
      },
    ],
  })
  followUps: {
    scheduledAt: Date;
    status: 'pending' | 'completed' | 'missed';
    notes?: string;
    createdBy?: string;
  }[];

  @Prop({
    type: [
      {
        scheduledAt: { type: Date, required: true },
        status: {
          type: String,
          enum: ['scheduled', 'done'],
          default: 'scheduled',
        },
        meetLink: { type: String, required: true },
        recipientEmail: String,
        emailSent: { type: Boolean, default: false },
        notes: String,
        createdBy: String,
        updatedAt: Date,
      },
    ],
    default: [],
  })
  demos: {
    scheduledAt: Date;
    status: 'scheduled' | 'done';
    meetLink: string;
    recipientEmail?: string;
    emailSent?: boolean;
    notes?: string;
    createdBy?: string;
    updatedAt?: Date;
  }[];

  @Prop({ type: String, enum: ['none', 'scheduled', 'done'], default: 'none' })
  demoStatus?: 'none' | 'scheduled' | 'done';

  @Prop({ type: Object })
  subscriptionConfig?: {
    gstSlots: number;
    durationYears: number;
    amount: number;
    updatedAt: Date;
    updatedBy: string;
  };

  @Prop({ type: Object })
  paymentDetails?: {
    link: string;
    status: 'pending' | 'sent' | 'completed' | 'failed' | 'expired';
    transactionId?: string;
    paymentDate?: Date;
    expiryDate?: Date;
    generatedBy?: string;
    generatedAt?: Date;
  };

  @Prop()
  sellerId?: string;

  @Prop()
  assignedSalesManager?: string; // ID or Name of the sales manager

  @Prop()
  assignedSalesManagerId?: string;

  @Prop({ index: true })
  assignedTo?: string;

  @Prop({ index: true })
  lastContactedAt?: Date;

  @Prop({ index: true })
  lastConnectedAt?: Date;

  @Prop({ index: true })
  convertedAt?: Date;

  @Prop()
  assignedBy?: string;

  @Prop()
  assignedAt?: Date;

  @Prop()
  assignedAccountsManager?: string;

  @Prop()
  conversionRequestedAt?: Date;

  @Prop()
  conversionRequestedBy?: string;

  @Prop()
  conversionSubscriptionId?: string;

  @Prop()
  conversionAmount?: number;

  @Prop()
  conversionLeadCreatedAt?: Date;

  @Prop({ default: 'new' })
  pipelineStage:
    | 'New Lead'
    | 'Contacted'
    | 'Interested'
    | 'Payment Link Generated'
    | 'Payment Pending'
    | 'Payment Completed'
    | 'Converted to Seller';

  @Prop({ default: 'new' })
  leadStatus: 'new' | 'contacted' | 'interested' | 'converted' | 'rejected';

  @Prop({
    type: String,
    enum: [
      'GENERATED',
      'CONTACTED',
      'CONNECTED',
      'FOLLOW_UP',
      'CONVERTED',
      'LOST',
    ],
    default: 'GENERATED',
    index: true,
  })
  status:
    | 'GENERATED'
    | 'CONTACTED'
    | 'CONNECTED'
    | 'FOLLOW_UP'
    | 'CONVERTED'
    | 'LOST';

  @Prop()
  source?: string;

  @Prop()
  ipAddress?: string;

  @Prop()
  userAgent?: string;

  @Prop({ default: 0 })
  leadScore: number;

  @Prop({ default: false })
  isMobileVerified: boolean;

  @Prop()
  verificationMethod?: 'otp' | 'manual';

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop()
  captchaScore?: number;

  @Prop()
  lastRegistrationAttempt?: Date;

  @Prop({ default: false })
  isDuplicate: boolean;

  @Prop()
  createdBy?: string;

  @Prop()
  createdByUserId?: string;

  @Prop()
  creatorRole?: string;
}

export const LeadSchema = SchemaFactory.createForClass(Lead);
// Text index for server-side search across key fields
LeadSchema.index({
  fullName: 'text',
  email: 'text',
  firmName: 'text',
});
LeadSchema.index({ assignedSalesManagerId: 1, createdAt: -1 });
LeadSchema.index({ assignedTo: 1, createdAt: -1 });
LeadSchema.index({ leadStatus: 1, updatedAt: -1 });
LeadSchema.index({ lastContactedAt: -1 });
LeadSchema.index({ lastConnectedAt: -1 });
LeadSchema.index({ convertedAt: -1 });
