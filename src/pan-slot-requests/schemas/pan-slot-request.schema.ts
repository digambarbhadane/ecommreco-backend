import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PanSlotRequestDocument = PanSlotRequest & Document;

export const PAN_SLOT_REQUEST_STATUSES = [
  'PENDING',
  'PAYMENT_PENDING',
  'PAYMENT_RECEIVED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;

export type PanSlotRequestStatus = (typeof PAN_SLOT_REQUEST_STATUSES)[number];

export const PAN_SLOT_DURATION_TYPES = [
  'monthly',
  'quarterly',
  'half_yearly',
  'annual',
] as const;

export type PanSlotDurationType = (typeof PAN_SLOT_DURATION_TYPES)[number];

@Schema({ timestamps: true, collection: 'pan_slot_requests' })
export class PanSlotRequest {
  @Prop({ required: true, unique: true, index: true })
  requestNumber: string;

  @Prop({ required: true, index: true })
  sellerId: string;

  @Prop()
  sellerName?: string;

  @Prop()
  sellerEmail?: string;

  @Prop()
  currentPlanId?: string;

  @Prop()
  currentPlanName?: string;

  @Prop({ default: 0 })
  currentPanSlots: number;

  @Prop({ default: 0 })
  currentUsedPanSlots: number;

  @Prop({ required: true, min: 1 })
  requestedPanSlots: number;

  @Prop({ type: String, required: true, enum: PAN_SLOT_DURATION_TYPES })
  durationType: PanSlotDurationType;

  @Prop({ required: true, min: 1 })
  durationMonths: number;

  @Prop()
  remarks?: string;

  @Prop({
    type: String,
    required: true,
    enum: PAN_SLOT_REQUEST_STATUSES,
    default: 'PENDING',
    index: true,
  })
  status: PanSlotRequestStatus;

  @Prop({ default: 'unpaid' })
  paymentStatus: string;

  @Prop()
  paymentLink?: string;

  @Prop()
  /** Base amount before GST */
  estimatedBaseAmount?: number;

  @Prop()
  gstAmount?: number;

  /** Total payable (base + GST) */
  @Prop()
  paymentAmount?: number;

  @Prop()
  durationLabel?: string;

  @Prop()
  pricePerSlot?: number;

  @Prop()
  paymentReference?: string;

  @Prop()
  paymentProof?: string;

  @Prop()
  paymentLinkExpiresAt?: Date;

  @Prop()
  paymentLinkNotes?: string;

  @Prop()
  adminRemarks?: string;

  @Prop()
  approvedBy?: string;

  @Prop()
  approvedAt?: Date;

  @Prop()
  paymentVerifiedBy?: string;

  @Prop()
  paymentVerifiedAt?: Date;

  @Prop()
  slotsAssignedBy?: string;

  @Prop()
  slotsAssignedAt?: Date;

  @Prop({ default: false })
  slotsAssigned: boolean;
}

export const PanSlotRequestSchema = SchemaFactory.createForClass(PanSlotRequest);
